// sdk/mcp/src/ui/render.ts
//
// Framework-free DOM renderers for the Synchronity product Views. Each renderer
// turns a CardModel into DOM and wires its buttons to `ctx.callTool`, which the
// boot layer maps to `App.callServerTool` (a `tools/call` over the host bridge).

import type {
  ProductCardModel,
  ProductListCardModel,
  ProductCardAddon,
  ProductCardVariant,
  CartCardModel,
  CheckoutCardModel,
  CardAction,
} from '../cards/types.js';
import { deriveAxes, resolveVariant, isValueAvailable } from './variantMatrix.js';
import { COUNTRIES, DIAL_CODES, dialCodeFor } from '../countries.js';

/** Result shape returned by the host bridge for a tools/call. */
export interface ToolCallResult {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: any;
  isError?: boolean;
}

export interface ViewCtx {
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolCallResult>;
  /** Re-render the View from a tool result's structuredContent (so a View action's
   *  result — e.g. the updated cart after a remove — is shown even when the host
   *  doesn't echo it). */
  onResult?: (result: ToolCallResult) => void;
  /** Silently update the model's context (no chat response) so Claude knows cart
   *  state — a View's tool-call result does NOT otherwise reach the conversation. */
  notifyModel?: (text: string) => void;
  /** Send a message to the host chat session on behalf of the user. */
  sendMessage?: (text: string) => void;
  /** Open an external URL via the host (sandboxed iframes cannot navigate on their
   *  own). Used for the card payment redirect to Paystack. */
  openLink?: (url: string) => void;
}

/** Build a short cart summary from a cart tool result for the model's context. */
function cartSummary(res: ToolCallResult): string | undefined {
  const c = res.structuredContent as
    | { kind?: string; cartId?: string; siteId?: string; total?: string;
        items?: Array<{ title: string; qty: number; lineTotal: string }> }
    | undefined;
  if (!c || c.kind !== 'cart') return undefined;
  const lines = (c.items ?? []).map((it) => `- ${it.qty}× ${it.title} (${it.lineTotal})`);
  return [
    `Cart updated (cart_id: ${c.cartId ?? '?'}, site_id: ${c.siteId ?? '?'}).`,
    ...lines,
    `Total: ${c.total ?? '?'}.`,
    `The buyer is still shopping — do not summarise the cart or start checkout unless they ask.`,
  ].join('\n');
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
};

function stockChip(inStock: boolean): HTMLElement {
  return el('span', `syn-chip ${inStock ? 'syn-in' : 'syn-out'}`, inStock ? 'In stock' : 'Out of stock');
}

/**
 * Point a thumbnail <img> at a URL with a graceful fallback. Empty/missing or a
 * load failure (e.g. a remote image the Claude sandbox blocks — only data: URIs
 * render there) collapses to a clean tinted box instead of a broken-image icon.
 */
function setThumb(img: HTMLImageElement, url: string | undefined, alt: string): void {
  img.alt = alt;
  if (!url) { img.classList.add('syn-thumb-empty'); return; }
  img.src = url;
  img.onerror = () => {
    img.removeAttribute('src');
    img.classList.add('syn-thumb-empty');
    img.onerror = null;
  };
}

/**
 * Internationalized phone field: a dial-code prefix selector (all countries) plus
 * a national-number input. getValue() returns an E.164 string ("+233201234567")
 * or '' when empty. defaultCountry seeds the dial code; existing parses a saved
 * E.164 value back into prefix + national number.
 */
function buildPhoneField(
  defaultCountry: string,
  existing?: string,
): { row: HTMLElement; getValue: () => string } {
  const row = el('div', 'syn-phone-row');

  const dial = el('select', 'syn-form-select syn-phone-dial') as HTMLSelectElement;
  for (const c of COUNTRIES) {
    const code = DIAL_CODES[c.code];
    if (!code) continue;
    const opt = el('option', undefined, `${c.code} ${code}`) as HTMLOptionElement;
    opt.value = c.code;
    dial.appendChild(opt);
  }

  const num = el('input', 'syn-input syn-phone-num') as HTMLInputElement;
  num.type = 'tel';
  num.placeholder = 'Phone number';

  // Seed from an existing E.164 value by matching the longest dial-code prefix.
  let seededCountry = defaultCountry;
  if (existing) {
    const match = COUNTRIES
      .map((c) => ({ c: c.code, d: DIAL_CODES[c.code] }))
      .filter((x) => x.d && existing.startsWith(x.d))
      .sort((a, b) => b.d!.length - a.d!.length)[0];
    if (match) {
      seededCountry = match.c;
      num.value = existing.slice(match.d!.length);
    } else {
      num.value = existing.replace(/^\+/, '');
    }
  }
  dial.value = DIAL_CODES[seededCountry] ? seededCountry : 'GH';

  row.append(dial, num);

  return {
    row,
    getValue: () => {
      const national = num.value.replace(/[^\d]/g, '').replace(/^0+/, '');
      if (!national) return '';
      return `${dialCodeFor(dial.value)}${national}`;
    },
  };
}

function parsePrice(priceStr: string): { amount: number; prefix: string; suffix: string } {
  const match = priceStr.match(/([0-9.,]+)/);
  if (!match) {
    return { amount: 0, prefix: priceStr, suffix: '' };
  }
  const rawNumericStr = match[1];
  const idx = priceStr.indexOf(rawNumericStr);
  const prefix = priceStr.slice(0, idx);
  const suffix = priceStr.slice(idx + rawNumericStr.length);
  const cleanNumericStr = rawNumericStr.replace(/,/g, '');
  let amount = parseFloat(cleanNumericStr) || 0;
  if (prefix.includes('-')) {
    amount = -amount;
  }
  return { amount, prefix, suffix };
}

function formatPriceLike(amount: number, template: { prefix: string; suffix: string }): string {
  const cleanPrefix = template.prefix.replace(/^[+-]\s*/, '');
  if (!Number.isFinite(amount)) amount = 0; // never render "NaN"
  const formatted = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return `${cleanPrefix}${formatted}${template.suffix}`;
}

function getModifierValue(modStr?: string): number {
  if (!modStr) return 0;
  const parsed = parsePrice(modStr);
  return parsed.amount;
}

/** Quantity stepper. Returns the element plus a live getter for the current value. */
function qtyStepper(
  onChange?: (qty: number) => void,
  opts?: { start?: number; min?: number; disabled?: boolean },
): { node: HTMLElement; get: () => number } {
  const min = opts?.min ?? 1;
  let qty = opts?.start ?? 1;
  const wrap = el('div', 'syn-qty');
  const minus = el('button', undefined, '−'); // −
  const val = el('span', undefined, String(qty));
  const plus = el('button', undefined, '+');
  minus.type = 'button'; plus.type = 'button';
  minus.setAttribute('aria-label', 'Decrease quantity');
  plus.setAttribute('aria-label', 'Increase quantity');
  const sync = () => {
    val.textContent = String(qty);
    minus.disabled = !!opts?.disabled || qty <= min;
    plus.disabled = !!opts?.disabled;
    onChange?.(qty);
  };
  minus.onclick = () => { if (qty > min) { qty--; sync(); } };
  plus.onclick = () => { qty++; sync(); };
  sync();
  wrap.append(minus, val, plus);
  return { node: wrap, get: () => qty };
}

/**
 * Render addon groups as an accordion. Returns the element plus a collector that yields
 * the selected `{ addon_id: value | value[] }` map, whether all required groups
 * are satisfied, and the total of selected option price modifiers.
 */
function addonGroups(
  addons: ProductCardAddon[],
  onChange?: () => void
): {
  node: HTMLElement;
  collect: () => { values: Record<string, unknown>; missing: string[]; modifierTotal: number };
} {
  const wrap = el('div', 'syn-accordion');
  // Per-group selection state.
  const state = new Map<string, Set<string>>();
  const textInputs = new Map<string, HTMLInputElement>();

  for (const a of addons) {
    const multi = a.type === 'checkbox';
    const isText = a.type === 'text' || a.type === 'number';
    state.set(a.addonId, new Set());

    const item = el('div', 'syn-acc-item');
    item.setAttribute('aria-expanded', 'false');

    const header = el('button', 'syn-acc-header');
    header.type = 'button';

    const titleWrap = el('div', 'syn-acc-title-wrap');
    const titleEl = el('div', 'syn-acc-title');
    titleEl.append(document.createTextNode(a.label));
    titleEl.appendChild(el('span', a.required ? 'req' : 'opt', a.required ? '*' : ' (optional)'));
    titleWrap.appendChild(titleEl);

    const summaryEl = el('div', 'syn-acc-summary');
    titleWrap.appendChild(summaryEl);
    header.appendChild(titleWrap);

    const indicator = el('span', 'syn-acc-indicator', '▾');
    header.appendChild(indicator);
    item.appendChild(header);

    const content = el('div', 'syn-acc-content');
    if (a.help) content.appendChild(el('div', 'syn-muted', a.help));

    const updateSummary = () => {
      let summaryText = '';
      let hasSelection = false;

      if (isText) {
        const input = textInputs.get(a.addonId);
        if (input) {
          const v = input.value.trim();
          if (v) {
            summaryText = v;
            hasSelection = true;
          }
        }
      } else {
        const sel = state.get(a.addonId)!;
        if (sel.size > 0) {
          hasSelection = true;
          const opts = a.options ?? (a.type === 'boolean' ? [{ value: 'true', label: 'Yes' }] : []);
          const labels = Array.from(sel)
            .map(val => opts.find(o => o.value === val)?.label || val);
          summaryText = labels.join(', ');
        }
      }

      if (hasSelection) {
        summaryEl.textContent = summaryText;
        summaryEl.style.color = 'var(--syn-green)';
      } else {
        summaryEl.textContent = a.required ? 'Required *' : 'None';
        summaryEl.style.color = 'var(--syn-muted)';
      }
    };

    header.onclick = (e) => {
      e.preventDefault();
      const isExpanded = item.getAttribute('aria-expanded') === 'true';
      if (!isExpanded) {
        // Close other accordion items when one opens (mutually exclusive) to save space
        for (const sibling of wrap.querySelectorAll('.syn-acc-item')) {
          sibling.setAttribute('aria-expanded', 'false');
        }
      }
      item.setAttribute('aria-expanded', isExpanded ? 'false' : 'true');
    };

    if (isText) {
      const input = el('input', 'syn-input');
      input.type = a.type === 'number' ? 'number' : 'text';
      input.placeholder = a.label;
      textInputs.set(a.addonId, input);
      content.appendChild(input);

      input.oninput = () => {
        updateSummary();
        onChange?.();
      };
    } else {
      const row = el('div', 'syn-pillrow');
      const opts = a.options ?? (a.type === 'boolean' ? [{ value: 'true', label: 'Yes' }] : []);
      for (const o of opts) {
        const pill = el('button', 'syn-pill');
        pill.type = 'button';
        pill.append(document.createTextNode(o.label));
        if (o.priceModifier) pill.appendChild(el('span', 'mod', o.priceModifier));
        pill.setAttribute('aria-pressed', 'false');
        
        pill.onclick = () => {
          const sel = state.get(a.addonId)!;
          const on = pill.getAttribute('aria-pressed') === 'true';
          if (multi) {
            if (on) { sel.delete(o.value); pill.setAttribute('aria-pressed', 'false'); }
            else { sel.add(o.value); pill.setAttribute('aria-pressed', 'true'); }
          } else {
            sel.clear();
            for (const sib of row.querySelectorAll('.syn-pill')) sib.setAttribute('aria-pressed', 'false');
            if (!on) { sel.add(o.value); pill.setAttribute('aria-pressed', 'true'); }
          }
          updateSummary();
          onChange?.();
        };
        row.appendChild(pill);
      }
      content.appendChild(row);
    }
    
    // Initialize summary
    updateSummary();

    item.appendChild(content);
    wrap.appendChild(item);
  }

  const collect = () => {
    const values: Record<string, unknown> = {};
    const missing: string[] = [];
    let modifierTotal = 0;

    for (const a of addons) {
      if (a.type === 'text' || a.type === 'number') {
        const v = textInputs.get(a.addonId)!.value.trim();
        if (v) values[a.addonId] = a.type === 'number' ? Number(v) : v;
        else if (a.required) missing.push(a.label);
      } else {
        const sel = [...(state.get(a.addonId) ?? [])];
        if (sel.length === 0) {
          if (a.required) missing.push(a.label);
        } else {
          values[a.addonId] = a.type === 'checkbox' ? sel : sel[0];
          
          // Sum up option modifiers
          const opts = a.options ?? (a.type === 'boolean' ? [{ value: 'true', label: 'Yes' }] : []);
          for (const val of sel) {
            const opt = opts.find(o => o.value === val);
            if (opt?.priceModifier) {
              modifierTotal += getModifierValue(opt.priceModifier);
            }
          }
        }
      }
    }
    return { values, missing, modifierTotal };
  };

  return { node: wrap, collect };
}

/** Build an Add-to-cart button bound to a CardAction; chains create_cart when needed. */
function addToCartButton(
  action: CardAction,
  ctx: ViewCtx,
  getExtra: () => { quantity: number; addons?: Record<string, unknown>; variantId?: string; missing: string[] },
  size: 'sm' | 'lg',
): HTMLButtonElement {
  const btn = el('button', `syn-btn syn-btn-primary${size === 'sm' ? ' syn-btn-sm' : ''}`);
  btn.type = 'button';
  const setLabel = (t: string) => { btn.textContent = t; };
  setLabel(action.label || 'Add to cart');

  btn.onclick = async () => {
    const extra = getExtra();
    if (extra.missing.length > 0) {
      setLabel(`Choose ${extra.missing[0]}`);
      setTimeout(() => setLabel(action.label || 'Add to cart'), 1800);
      return;
    }
    btn.disabled = true;
    setLabel('Adding…');
    try {
      const params: Record<string, unknown> = { ...action.params, quantity: extra.quantity };
      if (extra.addons && Object.keys(extra.addons).length > 0) params.addons = extra.addons;
      if (extra.variantId) params.variant_id = extra.variantId;
      const siteId = params.site_id as string;
      // Reuse this browse session's cart; mint one (once, even under concurrent
      // clicks) only when none exists yet.
      params.cart_id = (params.cart_id as string) || (await ensureCart(siteId, ctx));
      const res = await ctx.callTool('add_to_cart', params);
      if (res.isError) throw new Error(textOf(res) || 'Add to cart failed');
      const sc = res.structuredContent as { cartId?: string; items?: Array<{ qty?: number }> } | undefined;
      // The gateway may swap a stale/expired cart for a fresh one — adopt whatever
      // cart it actually used so the bag and later adds track the live cart.
      if (sc?.cartId) setActiveCartId(siteId, sc.cartId);
      setLabel('Added ✓');
      setCartCount(siteId, sc?.items);
      // Repaint every shopping bag on the page so the badge updates immediately
      // (the wizard/list/product bags are separate instances).
      for (const b of document.querySelectorAll('.syn-bag')) (b as BagButton).repaint?.();
      // Silently tell the model what's in the cart (don't switch to cart view —
      // the buyer is still browsing and may add more products).
      const summary = cartSummary(res);
      if (summary) ctx.notifyModel?.(summary);
    } catch (err) {
      setLabel('Try again');
      showButtonError(btn, err);
    } finally {
      setTimeout(() => { btn.disabled = false; setLabel(action.label || 'Add to cart'); }, 2600);
    }
  };
  return btn;
}

/**
 * Show a transient toast (Desktop has no console for the iframe). Floats at the
 * bottom of the view instead of injecting inline next to the button, so it never
 * reflows the card. `btn` is kept for call-site compatibility (unused for layout).
 */
function showButtonNote(_btn: HTMLElement, msg: string): void {
  let host = document.getElementById('syn-toasts');
  if (!host) {
    host = el('div', 'syn-toasts');
    host.id = 'syn-toasts';
    document.body.appendChild(host);
  }
  const toast = el('div', 'syn-toast');
  toast.textContent = msg.slice(0, 200);
  host.appendChild(toast);
  // Fade out then remove.
  setTimeout(() => { toast.classList.add('syn-toast-out'); }, 4200);
  setTimeout(() => { toast.remove(); }, 4800);
}

/** Surface a tool-call error visibly next to a button (and to the console). */
function showButtonError(btn: HTMLElement, err: unknown): void {
  console.error('[syn-view] tool call failed:', err);
  showButtonNote(btn, err instanceof Error ? err.message : String(err));
}

/** A small ghost button that fires a CardAction's tool with its prefilled params (no extra input). */
function simpleActionButton(action: CardAction, ctx: ViewCtx): HTMLButtonElement {
  const btn = el('button', 'syn-btn syn-btn-ghost', action.label || 'Update');
  btn.type = 'button';
  btn.onclick = async () => {
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = '…';
    try {
      const res = await ctx.callTool(action.toolName, action.params as Record<string, unknown>);
      if (res.isError) throw new Error(textOf(res) || `${action.toolName} failed`);
      // The result is a fresh cart card; re-render it in-View.
      ctx.onResult?.(res);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Try again';
      showButtonError(btn, err);
      setTimeout(() => { btn.textContent = original; }, 2600);
    }
  };
  return btn;
}

function textOf(r: ToolCallResult): string {
  return (r.content ?? []).map((c) => c.text ?? '').join('\n');
}

/** create_cart returns the cart as a JSON text block (no structuredContent); parse defensively. */
function extractCartId(r: ToolCallResult): string | undefined {
  const sc = r.structuredContent as any;
  if (sc?.cart_id) return sc.cart_id;
  if (sc?.cartId) return sc.cartId;
  try {
    const parsed = JSON.parse(textOf(r));
    return parsed.cart_id ?? parsed.cartId ?? parsed.id;
  } catch {
    return undefined;
  }
}

/** Total item count for a site's cart, tracked in session storage so the bag badge stays fresh. */
function cartCount(siteId: string): number {
  const n = parseInt(sessionStorage.getItem(`cart_count_${siteId}`) || '', 10);
  return Number.isFinite(n) ? n : 0;
}

/** Record the cart's total quantity from a cart model's items (drives the bag badge). */
function setCartCount(siteId: string, items?: Array<{ qty?: number }>): void {
  if (!Array.isArray(items)) return;
  const total = items.reduce((s, it) => s + (it.qty ?? 0), 0);
  sessionStorage.setItem(`cart_count_${siteId}`, String(total));
}

/**
 * The active cart id for a site, the single source of truth shared across every
 * Add-to-cart button and the bag in this View. Persisted in sessionStorage so it
 * survives the per-tool-result re-renders the host issues — one cart per browse
 * session, never a fresh cart per add.
 */
function getActiveCartId(siteId: string): string {
  return sessionStorage.getItem(`active_cart_${siteId}`) || '';
}
function setActiveCartId(siteId: string, cartId: string): void {
  if (cartId) sessionStorage.setItem(`active_cart_${siteId}`, cartId);
}
/** Forget a site's cart — used when the gateway reports it no longer exists (a
 *  stale id left in sessionStorage by a previous conversation or an expiry). */
function clearActiveCart(siteId: string): void {
  sessionStorage.removeItem(`active_cart_${siteId}`);
  sessionStorage.removeItem(`cart_count_${siteId}`);
}

// In-flight create_cart latch, keyed by site. Two Add-to-cart clicks fired before
// the first create_cart resolves would otherwise each see "no cart" and spawn a
// duplicate. Concurrent callers share the one promise; it self-clears on settle.
const cartCreateInFlight = new Map<string, Promise<string>>();

/** The active cart id for a site, creating one if needed. Safe under concurrent calls. */
async function ensureCart(siteId: string, ctx: ViewCtx): Promise<string> {
  const existing = getActiveCartId(siteId);
  if (existing) return existing;
  let inflight = cartCreateInFlight.get(siteId);
  if (!inflight) {
    inflight = (async () => {
      const created = await ctx.callTool('create_cart', { site_id: siteId });
      const cartId = extractCartId(created) || '';
      if (!cartId) throw new Error('Could not create cart');
      setActiveCartId(siteId, cartId);
      return cartId;
    })();
    cartCreateInFlight.set(siteId, inflight);
    void inflight.catch(() => undefined).finally(() => cartCreateInFlight.delete(siteId));
  }
  return inflight;
}

type BagButton = HTMLButtonElement & { repaint: () => void };

/** Shopping-basket glyph matching the Figma (outline basket in a white circle). */
const BASKET_SVG =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M5.5 10h13l-1.1 7.2a2 2 0 0 1-2 1.8H8.6a2 2 0 0 1-2-1.8L5.5 10Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M9 10 11.2 4.8a1 1 0 0 1 1.8 0L15 10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>' +
  '<path d="M3.5 10h17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
  '<path d="M10 13.2v2.4M14 13.2v2.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

/** Trash/delete glyph for cart line removal (matches the Figma red trash icon). */
const TRASH_SVG =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M4 7h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
  '<path d="M9.5 7V5.5a1.5 1.5 0 0 1 1.5-1.5h2a1.5 1.5 0 0 1 1.5 1.5V7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>' +
  '<path d="M6 7l.8 11a2 2 0 0 0 2 1.9h6.4a2 2 0 0 0 2-1.9L18 7" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
  '<path d="M10 11v5M14 11v5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

/** Shopping-basket button (icon + item-count badge) that opens the cart in-place. */
function viewCartButton(siteId: string, ctx: ViewCtx): BagButton {
  const btn = el('button', 'syn-bag') as BagButton;
  btn.type = 'button';
  btn.setAttribute('aria-label', 'View cart');
  const paint = () => {
    const c = cartCount(siteId);
    btn.replaceChildren();
    const icon = el('span', 'syn-bag-icon');
    icon.innerHTML = BASKET_SVG;
    btn.appendChild(icon);
    // The Figma always shows the count badge (incl. 0).
    btn.appendChild(el('span', 'syn-bag-count', String(c)));
  };
  btn.repaint = paint;
  paint();
  btn.onclick = async () => {
    // Read the cart id at click time — an add may have created it after the bag
    // was first painted. Everything stays in this iframe; never round-trip the model.
    const cartId = getActiveCartId(siteId);
    if (!cartId) {
      showButtonNote(btn, 'Your cart is empty — add something first.');
      return;
    }
    btn.disabled = true;
    try {
      const res = await ctx.callTool('get_cart', { site_id: siteId, cart_id: cartId });
      if (res.isError) {
        const msg = textOf(res);
        if (/not found/i.test(msg)) {
          // Stale id from a previous conversation / expiry — reset so the buyer can
          // start fresh instead of erroring against a cart that no longer exists.
          clearActiveCart(siteId);
          btn.disabled = false;
          paint();
          showButtonNote(btn, 'Your cart expired — add items again.');
          return;
        }
        throw new Error(msg || 'Failed to load cart');
      }
      setCartCount(siteId, (res.structuredContent as { items?: Array<{ qty?: number }> })?.items);
      ctx.onResult?.(res);
    } catch (err) {
      btn.disabled = false;
      showButtonError(btn, err);
    } finally {
      paint();
    }
  };
  return btn;
}

/** Render a product-list card (search_products). */
export function renderProductList(root: HTMLElement, model: ProductListCardModel, ctx: ViewCtx): void {
  root.replaceChildren();

  // Seed the active cart from any server-prefilled param so the bag opens it on first click.
  for (const p of model.products) {
    const pid = p.addToCart.params.cart_id as string | undefined;
    if (pid) { setActiveCartId(model.siteId, pid); break; }
  }

  // Header bar: "{n} product at {store}" left, basket button right.
  const headerBar = el('div', 'syn-listhead-bar');
  const n = model.products.length;
  headerBar.appendChild(
    el('span', 'syn-listhead-title', `${n} product${n === 1 ? '' : 's'}${model.siteName ? ` at ${model.siteName}` : ''}`),
  );
  const bag = viewCartButton(model.siteId, ctx);
  headerBar.appendChild(bag);
  root.appendChild(headerBar);

  const card = el('div', 'syn-card');
  if (n === 0) {
    card.appendChild(el('div', 'syn-listempty', 'No products matched that search.'));
    root.appendChild(card);
    return;
  }

  const list = el('div', 'syn-list');
  for (const p of model.products) {
    const row = el('div', 'syn-row');
    const thumb = el('img', 'syn-thumb');
    setThumb(thumb, p.image, p.title);
    thumb.loading = 'lazy';

    const body = el('div', 'syn-rowbody');
    const titleLine = el('div', 'syn-rowtitle-line');
    titleLine.append(el('span', 'syn-rowtitle', p.title), stockChip(p.inStock));
    body.append(titleLine, el('div', 'syn-price', p.price));

    const actions = el('div', 'syn-rowactions');
    if (!p.inStock) {
      // Out of stock: a disabled 0-stepper + a live "Notify me" (matches Figma).
      const qty = qtyStepper(undefined, { start: 0, min: 0, disabled: true });
      const notify = el('button', 'syn-btn syn-btn-primary', 'Notify me') as HTMLButtonElement;
      notify.type = 'button';
      notify.onclick = () => {
        ctx.sendMessage?.(`Please notify me when "${p.title}" is back in stock.`);
        showButtonNote(notify, "We'll let you know.");
      };
      actions.append(qty.node, notify);
    } else if (p.hasOptions) {
      // Options/variations → open the Customize wizard. Stepper shown for parity
      // with the simple rows; final quantity is confirmed in the wizard's review step.
      const qty = qtyStepper();
      const btn = el('button', 'syn-btn syn-btn-primary', 'Add to cart') as HTMLButtonElement;
      btn.type = 'button';
      btn.onclick = async () => {
        btn.disabled = true;
        const original = btn.textContent;
        btn.textContent = '…';
        try {
          const res = await ctx.callTool('get_product', {
            site_id: (p.addToCart.params.site_id as string),
            product_id: p.productId,
          });
          if (res.isError) throw new Error(textOf(res) || 'Could not load options');
          ctx.onResult?.(res); // renders the customize wizard in-frame
        } catch (err) {
          btn.disabled = false;
          btn.textContent = original;
          showButtonError(btn, err);
        }
      };
      actions.append(qty.node, btn);
    } else {
      const qty = qtyStepper();
      const btn = addToCartButton(p.addToCart, ctx, () => ({ quantity: qty.get(), missing: [] }));
      btn.textContent = 'Add to cart';
      const originalOnclick = btn.onclick;
      btn.onclick = async (e) => {
        await (originalOnclick as ((this: HTMLButtonElement, ev: PointerEvent) => unknown) | null)?.call(btn, e);
        bag.repaint(); // count grew; the cart id is now known to the shared bag
      };
      actions.append(qty.node, btn);
    }

    row.append(thumb, body, actions);
    list.appendChild(row);
  }
  card.appendChild(list);
  root.appendChild(card);
}

/** Render a single-product card (get_product) with optional image carousel + addon pills. */
/** True when the product needs the stepped options wizard: variants, OR ≥2 addons, OR any required addon. */
function needsOptionsWizard(model: ProductCardModel): boolean {
  const addonCount = model.addons?.length ?? 0;
  const hasRequired = !!model.addons?.some((a) => a.required);
  return !!(model.variants && model.variants.length > 0) || addonCount >= 2 || hasRequired;
}

/** Build the hero image / carousel into a card; returns the hero <img> (for variant
 *  image-swap) or undefined when the product has no images. */
function buildHero(card: HTMLElement, model: ProductCardModel): HTMLImageElement | undefined {
  const images = model.images && model.images.length > 0 ? model.images : (model.image ? [model.image] : []);
  if (images.length === 0) return undefined;
  const hero = el('div', 'syn-hero');
  const img = el('img');
  img.alt = model.title;
  const dots: HTMLButtonElement[] = [];
  const show = (i: number) => {
    const idx = (i + images.length) % images.length;
    img.src = images[idx];
    dots.forEach((d, k) => d.setAttribute('aria-current', k === idx ? 'true' : 'false'));
  };
  hero.appendChild(img);
  if (images.length > 1) {
    const dotwrap = el('div', 'syn-dots');
    images.forEach((_, i) => {
      const d = el('button', 'syn-dot');
      d.type = 'button';
      d.setAttribute('aria-label', `Image ${i + 1}`);
      d.onclick = () => show(i);
      dots.push(d);
      dotwrap.appendChild(d);
    });
    hero.appendChild(dotwrap);
  }
  show(0);
  card.appendChild(hero);
  return img;
}

/** A label/value review row. */
function reviewRow(label: string, value: string): HTMLElement {
  const r = el('div', 'syn-totline');
  r.append(el('span', 'syn-muted', label), el('span', undefined, value));
  return r;
}

export function renderProduct(root: HTMLElement, model: ProductCardModel, ctx: ViewCtx): void {
  root.replaceChildren();
  if ((root as any)._cartPollInterval) {
    clearInterval((root as any)._cartPollInterval);
    (root as any)._cartPollInterval = null;
  }

  const sessionKey = `active_cart_${model.siteId}`;
  const seedCartId = sessionStorage.getItem(sessionKey) || (model.addToCart.params.cart_id as string) || '';
  if (seedCartId) {
    sessionStorage.setItem(sessionKey, seedCartId);
    model.addToCart.params.cart_id = seedCartId;
  }
  const updateCartId = (cId?: string) => {
    if (!cId) return;
    sessionStorage.setItem(sessionKey, cId);
    model.addToCart.params.cart_id = cId;
  };

  if (needsOptionsWizard(model)) {
    // Options/variations → the Customize wizard (Figma: Customize Your Brew → Review).
    renderOptionsWizard(root, model, ctx, updateCartId);
    return;
  }

  // No-options product: render it as a single-row list card (per product-list
  // design) rather than a bespoke detail view.
  const headerBar = el('div', 'syn-listhead-bar');
  headerBar.appendChild(el('span', 'syn-listhead-title', model.siteName ? `${model.siteName}` : ''));
  const bag = viewCartButton(model.siteId, ctx);
  headerBar.appendChild(bag);
  root.appendChild(headerBar);

  const card = el('div', 'syn-card');
  const list = el('div', 'syn-list');
  const row = el('div', 'syn-row');
  const thumb = el('img', 'syn-thumb');
  setThumb(thumb, model.image ?? model.images?.[0], model.title);
  thumb.loading = 'lazy';
  const rb = el('div', 'syn-rowbody');
  const titleLine = el('div', 'syn-rowtitle-line');
  titleLine.append(el('span', 'syn-rowtitle', model.title), stockChip(model.inStock));
  rb.append(titleLine, el('div', 'syn-price', model.price));

  const actions = el('div', 'syn-rowactions');
  if (!model.inStock) {
    const qty = qtyStepper(undefined, { start: 0, min: 0, disabled: true });
    const notify = el('button', 'syn-btn syn-btn-primary', 'Notify me') as HTMLButtonElement;
    notify.type = 'button';
    notify.onclick = () => {
      ctx.sendMessage?.(`Please notify me when "${model.title}" is back in stock.`);
      showButtonNote(notify, "We'll let you know.");
    };
    actions.append(qty.node, notify);
  } else {
    const qty = qtyStepper();
    const btn = addToCartButton(model.addToCart, ctx, () => ({ quantity: qty.get(), missing: [] }));
    btn.textContent = 'Add to cart';
    const origin = btn.onclick;
    btn.onclick = async (e) => {
      await (origin as ((this: HTMLButtonElement, ev: PointerEvent) => unknown) | null)?.call(btn, e);
      updateCartId(model.addToCart.params.cart_id as string);
      bag.repaint();
    };
    actions.append(qty.node, btn);
  }
  row.append(thumb, rb, actions);
  list.appendChild(row);
  card.appendChild(list);
  root.appendChild(card);
}

/** Seamless white check for the selected option in a multi-select dropdown. */
const CHECK_SVG =
  '<svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** A grind/roast-style option group, unified across variant axes and addons. */
interface WizardOption { value: string; label: string; disabled?: boolean; priceLabel?: string }
interface WizardGroup { key: string; label: string; isVariantAxis: boolean; multiple: boolean; options: WizardOption[] }

/**
 * Custom dropdown matching the Figma: a trigger box that expands an option panel.
 * Single-select rows fill emerald when chosen and the panel closes; multi-select
 * rows fill emerald with a white check and the panel stays open so more can be
 * picked. Options carry an optional right-aligned price label.
 */
function customDropdown(args: {
  options: WizardOption[];
  multiple: boolean;
  placeholder: string;
  selected: string[];
  onChange: (values: string[]) => void;
}): HTMLElement {
  const dd = el('div', 'syn-dd');
  dd.setAttribute('aria-expanded', 'false');
  const sel = new Set(args.selected);

  const trigger = el('button', 'syn-dd-trigger') as HTMLButtonElement;
  trigger.type = 'button';
  const valEl = el('span', 'val');
  trigger.append(valEl, el('span', 'chev'));

  const panel = el('div', 'syn-dd-panel');
  const optButtons = new Map<string, HTMLButtonElement>();
  const labelFor = (v: string) => args.options.find((o) => o.value === v)?.label ?? v;
  const paintTrigger = () => {
    const vals = [...sel];
    valEl.textContent = vals.length === 0 ? args.placeholder : vals.map(labelFor).join(', ');
  };
  const paintOpts = () => {
    for (const [v, b] of optButtons) b.classList.toggle('is-sel', sel.has(v));
  };

  for (const o of args.options) {
    const b = el('button', 'syn-dd-opt') as HTMLButtonElement;
    b.type = 'button';
    b.disabled = !!o.disabled;
    b.appendChild(el('span', undefined, o.label));
    const end = el('span', 'syn-dd-end');
    if (o.priceLabel) end.appendChild(el('span', 'price', o.priceLabel));
    if (args.multiple) {
      const check = el('span', 'syn-dd-check');
      check.innerHTML = CHECK_SVG;
      end.appendChild(check);
    }
    b.appendChild(end);
    b.onclick = () => {
      if (args.multiple) {
        if (sel.has(o.value)) sel.delete(o.value);
        else sel.add(o.value);
        paintOpts(); paintTrigger();
        args.onChange([...sel]); // stays open for more picks
      } else {
        sel.clear(); sel.add(o.value);
        paintOpts(); paintTrigger();
        dd.setAttribute('aria-expanded', 'false');
        args.onChange([...sel]);
      }
    };
    optButtons.set(o.value, b);
    panel.appendChild(b);
  }

  trigger.onclick = () => {
    dd.setAttribute('aria-expanded', dd.getAttribute('aria-expanded') === 'true' ? 'false' : 'true');
  };
  paintTrigger(); paintOpts();
  dd.append(trigger, panel);
  return dd;
}

/**
 * Customize wizard (Figma): hero banner + "Step n of 2" + an inset panel of dropdown
 * option rows ("Select Your Grind (optional)" → None ▾) → Review (chosen options,
 * quantity, total) → Add to cart. Variant axes and single-select addons both render
 * as dropdowns; the chosen axis values resolve a variant via the variant matrix.
 * Renders the whole view into `root`.
 */
function renderOptionsWizard(
  root: HTMLElement,
  model: ProductCardModel,
  ctx: ViewCtx,
  updateCartId: (cId?: string) => void,
): void {
  const base = parsePrice(model.price);
  const variants = model.variants ?? [];
  const axes = deriveAxes(variants);

  // Modifier amount per option value, keyed by group, so totals + the variant
  // resolver can look them up without re-parsing.
  const modifiers = new Map<string, number>();
  const modKey = (gk: string, v: string) => `${gk} ${v}`;

  // Build a unified list of option groups (variant axes first, then addons).
  const groups: WizardGroup[] = [];
  for (const axis of axes) {
    groups.push({
      key: `axis:${axis.name}`,
      label: axis.name,
      isVariantAxis: true,
      multiple: false,
      options: axis.values.map((v) => ({ value: v, label: v })),
    });
  }
  // Variants with no attributes → a single "Variant" dropdown of titles.
  if (variants.length > 0 && axes.length === 0) {
    groups.push({
      key: '__variant',
      label: 'Variant',
      isVariantAxis: false,
      multiple: false,
      options: variants.map((v) => ({ value: v.title, label: v.title, disabled: !v.inStock, priceLabel: v.price })),
    });
  }
  for (const a of model.addons ?? []) {
    const multiple = a.type === 'checkbox' || (a as any).multiple === true;
    const gk = `addon:${a.addonId}`;
    groups.push({
      key: gk,
      label: a.label,
      isVariantAxis: false,
      multiple,
      options: (a.options ?? []).map((o: any) => {
        const value = typeof o === 'string' ? o : (o.value ?? o.label);
        const label = typeof o === 'string' ? o : (o.label ?? o.value);
        // priceModifier may arrive as a number (1) or a formatted string ("GHS 1.00").
        // Coerce robustly so the total never becomes NaN and the label isn't double-prefixed.
        const rawMod = typeof o === 'string' ? 0 : (o.priceModifier ?? o.price_modifier);
        const mod = typeof rawMod === 'number' ? rawMod : getModifierValue(rawMod ? String(rawMod) : undefined);
        modifiers.set(modKey(gk, value), mod);
        return { value, label, priceLabel: mod ? `+${formatPriceLike(mod, base)}` : undefined };
      }),
    });
  }

  // Selection state: group key → chosen values (single-select groups hold ≤1).
  const selected: Record<string, string[]> = {};
  const selectedAxis: Record<string, string> = {};
  let selectedVariant: ProductCardVariant | undefined;
  const qtyState = { n: 1 };
  let stepIdx = 0; // 0 = customize, 1 = review

  const resolve = () => {
    for (const g of groups) {
      if (g.isVariantAxis) {
        const name = g.label;
        const v = selected[g.key]?.[0];
        if (v) selectedAxis[name] = v;
        else delete selectedAxis[name];
      }
    }
    const variantPick = selected['__variant']?.[0];
    if (variantPick) {
      selectedVariant = variants.find((v) => v.title === variantPick);
    } else {
      selectedVariant = Object.keys(selectedAxis).length ? resolveVariant(variants, selectedAxis) : undefined;
    }
  };
  const variantBase = () => (selectedVariant ? parsePrice(selectedVariant.price).amount : base.amount);
  const addonMod = () =>
    groups
      .filter((g) => g.key.startsWith('addon:'))
      .reduce((s, g) => s + (selected[g.key] ?? []).reduce((t, v) => t + (modifiers.get(modKey(g.key, v)) ?? 0), 0), 0);
  const lineTotal = () => formatPriceLike((variantBase() + addonMod()) * qtyState.n, base);

  const heroImageUrl = () =>
    (selectedVariant?.image) || model.image || model.images?.[0] || '';

  const render = () => {
    root.replaceChildren();
    const wizard = el('div', 'syn-wizard');

    // Hero banner with floating basket.
    const heroUrl = heroImageUrl();
    if (heroUrl) {
      const hero = el('div', 'syn-wizard-hero');
      const img = el('img');
      img.src = heroUrl; img.alt = model.title;
      hero.appendChild(img);
      const bagWrap = el('span', 'syn-wizard-bag');
      bagWrap.appendChild(viewCartButton(model.siteId, ctx));
      hero.appendChild(bagWrap);
      wizard.appendChild(hero);
    }

    // Step label: "Step 1 of 2  -  Customize" / "Step 2 of 2  -  Review".
    const label = el('div', 'syn-step-label');
    label.append(
      document.createTextNode(`Step ${stepIdx + 1} of 2  -  `),
      el('b', undefined, stepIdx === 0 ? 'Customize Your Order' : 'Review'),
    );
    wizard.appendChild(label);

    const inset = el('div', 'syn-inset');

    if (stepIdx === 0) {
      // Customize: a white card of labelled dropdown rows.
      const optcard = el('div', 'syn-optcard');
      if (groups.length === 0) {
        optcard.appendChild(el('div', 'syn-optlabel', 'No options to customise — continue to review.'));
      }
      for (const g of groups) {
        const rowEl = el('div', 'syn-optrow');
        const hint = g.multiple ? ' (choose any)' : ' (optional)';
        rowEl.appendChild(el('label', 'syn-optlabel', `${g.label}${hint}`));
        // Disable axis values not available given current sibling-axis picks.
        const options = g.options.map((o) => ({
          ...o,
          disabled: o.disabled || (g.isVariantAxis
            ? !isValueAvailable(variants, { ...selectedAxis, [g.label]: o.value }, g.label, o.value)
            : false),
        }));
        rowEl.appendChild(customDropdown({
          options,
          multiple: g.multiple,
          placeholder: 'None',
          selected: selected[g.key] ?? [],
          onChange: (vals) => {
            selected[g.key] = vals;
            resolve();
            // Re-render only on variant changes (hero/availability shift); multi-select
            // addons stay open and update totals on the review step, so avoid a re-render
            // that would collapse the panel mid-pick.
            if (g.isVariantAxis || g.key === '__variant') render();
          },
        }));
        optcard.appendChild(rowEl);
      }
      inset.appendChild(optcard);
    } else {
      // Review: chosen options, quantity, total.
      const card = el('div', 'syn-review-card');
      const chosen = groups.filter((g) => (selected[g.key]?.length ?? 0) > 0);
      for (const g of chosen) {
        const r = el('div', 'syn-review-row');
        r.append(el('span', 'k', g.label), el('span', 'v', selected[g.key].join(', ')));
        card.appendChild(r);
      }
      if (chosen.length) card.appendChild(el('div', 'syn-review-divider'));

      // totV declared before the stepper: qtyStepper fires onChange during its own
      // construction (sync()), so the closure must not reference an uninitialised var.
      const totV = el('span', 'v', lineTotal());
      const qRow = el('div', 'syn-review-row');
      const qStep = qtyStepper((n) => { qtyState.n = n; totV.textContent = lineTotal(); }, { start: qtyState.n });
      qRow.append(el('span', 'k', 'Quantity'), qStep.node);
      card.appendChild(qRow);
      card.appendChild(el('div', 'syn-review-divider'));

      const totRow = el('div', 'syn-review-row syn-review-total');
      totRow.append(el('span', 'k', 'Total'), totV);
      card.appendChild(totRow);
      inset.appendChild(card);
    }
    wizard.appendChild(inset);

    // Footer: Back (left) + Next/Add to cart (right).
    const foot = el('div', 'syn-wizard-foot');
    if (stepIdx > 0) {
      const back = el('button', 'syn-btn syn-btn-ghost', 'Back');
      back.type = 'button';
      back.onclick = () => { stepIdx--; render(); };
      foot.appendChild(back);
    }
    foot.appendChild(el('span', 'spacer'));
    if (stepIdx === 0) {
      const next = el('button', 'syn-btn syn-btn-primary', 'Next');
      next.type = 'button';
      next.onclick = () => { stepIdx = 1; render(); };
      foot.appendChild(next);
    } else {
      const add = addToCartButton(
        model.addToCart, ctx,
        () => {
          const addonValues: Record<string, string | string[]> = {};
          for (const g of groups) {
            if (!g.key.startsWith('addon:')) continue;
            const vals = selected[g.key] ?? [];
            if (vals.length === 0) continue;
            addonValues[g.key.replace(/^addon:/, '')] = g.multiple ? vals : vals[0];
          }
          return { quantity: qtyState.n, addons: addonValues, variantId: selectedVariant?.variantId, missing: [] };
        },
        'lg',
      );
      add.textContent = 'Add to cart';
      const origin = add.onclick;
      add.onclick = async (e) => {
        await (origin as ((this: HTMLButtonElement, ev: PointerEvent) => unknown) | null)?.call(add, e);
        updateCartId(model.addToCart.params.cart_id as string);
      };
      foot.appendChild(add);
    }
    wizard.appendChild(foot);
    root.appendChild(wizard);
  };

  render();
}

/** Render a cart card (get_cart / add_to_cart / remove_from_cart results). */
export interface CheckoutState {
  step: 'cart' | 'shipping_address' | 'shipping_methods' | 'delegation_request' | 'delegation_verify' | 'customer_info' | 'payment_method' | 'payment_initiate_mm' | 'payment_poll' | 'success';
  siteId: string;
  cartId: string;
  address?: {
    line1: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
    phone?: string;
  };
  checkoutModel?: any;
  selectedOptionId?: string;
  delegationEmail?: string;
  deviceCode?: string;
  delegationToken?: string;
  customerInfo?: {
    name: string;
    email: string;
    phone: string;
    shippingName: string;
    shippingLine1: string;
  };
  orderId?: string;
  paymentMethod?: 'mobile_money' | 'card';
  paymentSession?: any;
}

/** Render a cart card (get_cart / add_to_cart / remove_from_cart results). */
export function renderCart(root: HTMLElement, model: CartCardModel, ctx: ViewCtx): void {
  if ((root as any)._cartPollInterval) {
    clearInterval((root as any)._cartPollInterval);
    (root as any)._cartPollInterval = null;
  }
  if ((root as any)._paymentPollInterval) {
    clearInterval((root as any)._paymentPollInterval);
    (root as any)._paymentPollInterval = null;
  }

  if (model.cartId) {
    const sessionKey = `active_cart_${model.siteId}`;
    sessionStorage.setItem(sessionKey, model.cartId);
  }

  const stateKey = `checkout_state_${model.siteId}`;
  let state: CheckoutState;
  try {
    const raw = sessionStorage.getItem(stateKey);
    if (raw) {
      state = JSON.parse(raw);
      if (state.cartId !== model.cartId) {
        state = { step: 'cart', siteId: model.siteId, cartId: model.cartId };
      }
    } else {
      state = { step: 'cart', siteId: model.siteId, cartId: model.cartId };
    }
  } catch {
    state = { step: 'cart', siteId: model.siteId, cartId: model.cartId };
  }

  const saveState = () => {
    try {
      sessionStorage.setItem(stateKey, JSON.stringify(state));
    } catch {}
  };

  const transitionTo = (newStep: CheckoutState['step']) => {
    state.step = newStep;
    saveState();
    renderCart(root, model, ctx);
  };

  switch (state.step) {
    case 'shipping_address':
      renderShippingAddressStep(root, model, ctx, state, transitionTo, saveState);
      break;
    case 'shipping_methods':
      renderShippingMethodsStep(root, model, ctx, state, transitionTo, saveState);
      break;
    case 'delegation_request':
      renderDelegationRequestStep(root, model, ctx, state, transitionTo, saveState);
      break;
    case 'delegation_verify':
      renderDelegationVerifyStep(root, model, ctx, state, transitionTo, saveState);
      break;
    case 'customer_info':
      renderCustomerInfoStep(root, model, ctx, state, transitionTo, saveState);
      break;
    case 'payment_method':
      renderPaymentMethodStep(root, model, ctx, state, transitionTo, saveState);
      break;
    case 'payment_initiate_mm':
      renderPaymentInitiateMMStep(root, model, ctx, state, transitionTo, saveState);
      break;
    case 'payment_poll':
      renderPaymentPollStep(root, model, ctx, state, transitionTo, saveState);
      break;
    case 'success':
      renderSuccessStep(root, model, ctx, state, transitionTo, saveState);
      break;
    case 'cart':
    default:
      renderCartStep(root, model, ctx, state, transitionTo);
      break;
  }
}

function renderCartStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
): void {
  root.replaceChildren();
  setCartCount(model.siteId, model.items);

  // Header bar: "Your cart" left, "#ID: {cartId}" right.
  const head = el('div', 'syn-cart-head');
  head.appendChild(el('span', 't', 'Your cart'));
  if (model.cartId) head.appendChild(el('span', 'id', `#ID: ${model.cartId}`));
  root.appendChild(head);

  const stack = el('div', 'syn-stack');

  if (model.items.length === 0) {
    const empty = el('div', 'syn-card syn-card-pad syn-muted');
    empty.textContent = 'Your cart is empty.';
    stack.appendChild(empty);
    root.appendChild(stack);
    return;
  }

  // Summary card: any line customizations (variant/addons) + Subtotal + Total.
  const summary = el('div', 'syn-card syn-summary-card');
  summary.appendChild(el('div', 'syn-summary-title', 'Order Summary'));
  let hasCustom = false;
  for (const it of model.items) {
    const bits = [it.variantTitle, it.addonsSummary].filter(Boolean) as string[];
    if (bits.length === 0) continue;
    hasCustom = true;
    const r = el('div', 'syn-review-row');
    r.append(el('span', 'k', it.title), el('span', 'v', bits.join(' · ')));
    summary.appendChild(r);
  }
  if (hasCustom) summary.appendChild(el('div', 'syn-review-divider'));
  const subRow = el('div', 'syn-review-row');
  subRow.append(el('span', 'k', 'Subtotal'), el('span', 'v', model.subtotal));
  summary.appendChild(subRow);
  const totRow = el('div', 'syn-review-row syn-review-total');
  totRow.append(el('span', 'k', 'Total'), el('span', 'v', model.total));
  summary.appendChild(totRow);
  stack.appendChild(summary);

  // Items card: one row per line — thumbnail · title + In stock · price · stepper + trash.
  const card = el('div', 'syn-card');
  const list = el('div', 'syn-list');
  for (const it of model.items) {
    const r = el('div', 'syn-row');
    const thumb = el('img', 'syn-thumb');
    setThumb(thumb, it.image, it.title);
    thumb.loading = 'lazy';

    const body = el('div', 'syn-rowbody');
    const titleLine = el('div', 'syn-rowtitle-line');
    titleLine.append(el('span', 'syn-rowtitle', it.title), stockChip(true));
    body.append(titleLine, el('div', 'syn-price', it.unitPrice));

    const actions = el('div', 'syn-rowactions');
    // Quantity edits write through to the server cart (the checkout source of truth)
    // via set_cart_quantity, then re-render. Debounced so holding +/- coalesces into
    // one write of the final quantity. Falls back to a chat-message hint if the host
    // has no set-quantity tool. The first onChange (stepper construction) is skipped.
    let qtyTimer: ReturnType<typeof setTimeout> | undefined;
    let primed = false;
    const qty = qtyStepper((n) => {
      if (!primed) { primed = true; return; } // ignore the initial sync()
      if (!it.setQtyAction) {
        ctx.sendMessage?.(`Please set "${it.title}" quantity to ${n} in my cart.`);
        return;
      }
      if (qtyTimer) clearTimeout(qtyTimer);
      qtyTimer = setTimeout(async () => {
        try {
          const res = await ctx.callTool(it.setQtyAction!.toolName, {
            ...(it.setQtyAction!.params as Record<string, unknown>),
            quantity: n,
          });
          if (res.isError) throw new Error(textOf(res) || 'Could not update quantity');
          ctx.onResult?.(res);
        } catch (err) {
          showButtonError(qty.node, err);
        }
      }, 450);
    }, { start: it.qty });
    actions.appendChild(qty.node);
    if (it.removeAction) {
      const trash = el('button', 'syn-trash') as HTMLButtonElement;
      trash.type = 'button';
      trash.setAttribute('aria-label', `Remove ${it.title}`);
      trash.innerHTML = TRASH_SVG;
      trash.onclick = async () => {
        trash.disabled = true;
        try {
          const res = await ctx.callTool(it.removeAction!.toolName, it.removeAction!.params as Record<string, unknown>);
          if (res.isError) throw new Error(textOf(res) || 'Could not remove item');
          ctx.onResult?.(res);
        } catch (err) {
          trash.disabled = false;
          showButtonError(trash, err);
        }
      };
      actions.appendChild(trash);
    }
    r.append(thumb, body, actions);
    list.appendChild(r);
  }
  card.appendChild(list);
  stack.appendChild(card);
  root.appendChild(stack);

  // Footer: Continue shopping (ghost) + Proceed to checkout (primary).
  const foot = el('div', 'syn-cart-foot');
  const cont = el('button', 'syn-btn syn-btn-ghost', 'Continue shopping');
  cont.type = 'button';
  cont.onclick = () => ctx.sendMessage?.('I want to keep shopping — please show me the product list again.');
  const checkoutBtn = el('button', 'syn-btn syn-btn-primary', 'Proceed to checkout');
  checkoutBtn.type = 'button';
  checkoutBtn.onclick = () => transitionTo('shipping_address');
  foot.append(cont, checkoutBtn);
  root.appendChild(foot);
}

/** Big check glyph for the order-confirmed badge. */
const SUCCESS_CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/**
 * Checkout-step scaffold (Figma): a dark heading on the mint canvas, an optional
 * explanatory note, a white card for the step's body, and a canvas footer. Returns
 * the card (caller fills it) + the footer (caller adds Back / CTA buttons).
 */
function stepScaffold(root: HTMLElement, title: string, note?: string): { card: HTMLElement; foot: HTMLElement } {
  root.replaceChildren();
  root.appendChild(el('div', 'syn-step-h', title));
  if (note) root.appendChild(el('div', 'syn-step-note', note));
  const card = el('div', 'syn-card');
  root.appendChild(card);
  const foot = el('div', 'syn-step-foot');
  root.appendChild(foot);
  return { card, foot };
}

/** Append Back (left) + CTA (right) to a step footer; CTA right-aligned even without Back. */
function stepFooter(foot: HTMLElement, back: HTMLElement | null, cta: HTMLElement): void {
  if (back) foot.appendChild(back);
  foot.appendChild(el('span', 'spacer'));
  foot.appendChild(cta);
}

function renderShippingAddressStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  const { card, foot } = stepScaffold(root, 'Shipping Address');

  const form = el('form', 'syn-form');
  form.onsubmit = (e) => e.preventDefault();

  const groupLine1 = el('div', 'syn-form-group');
  groupLine1.appendChild(el('label', 'syn-form-label', 'Street Address'));
  const inputLine1 = el('input', 'syn-input');
  inputLine1.placeholder = 'e.g. 12 Oxford Street';
  inputLine1.value = state.address?.line1 || '';
  groupLine1.appendChild(inputLine1);

  const groupCity = el('div', 'syn-form-group');
  groupCity.appendChild(el('label', 'syn-form-label', 'City'));
  const inputCity = el('input', 'syn-input');
  inputCity.placeholder = 'e.g. Accra';
  inputCity.value = state.address?.city || '';
  groupCity.appendChild(inputCity);

  const row = el('div', 'syn-form-row');
  const groupState = el('div', 'syn-form-group');
  groupState.appendChild(el('label', 'syn-form-label', 'Region / State'));
  const inputState = el('input', 'syn-input');
  inputState.placeholder = 'e.g. Greater Accra';
  inputState.value = state.address?.state || '';
  groupState.appendChild(inputState);

  const groupPostal = el('div', 'syn-form-group');
  groupPostal.appendChild(el('label', 'syn-form-label', 'Postal / ZIP Code'));
  const inputPostal = el('input', 'syn-input');
  inputPostal.placeholder = 'e.g. GA-184-2938';
  inputPostal.value = state.address?.postalCode || '';
  groupPostal.appendChild(inputPostal);
  row.append(groupState, groupPostal);

  const groupCountry = el('div', 'syn-form-group');
  groupCountry.appendChild(el('label', 'syn-form-label', 'Country'));
  const selectCountry = el('select', 'syn-form-select') as HTMLSelectElement;
  for (const c of COUNTRIES) {
    const opt = el('option', undefined, c.name) as HTMLOptionElement;
    opt.value = c.code;
    selectCountry.appendChild(opt);
  }
  selectCountry.value = state.address?.country || 'GH';
  groupCountry.appendChild(selectCountry);

  const groupPhone = el('div', 'syn-form-group');
  groupPhone.appendChild(el('label', 'syn-form-label', 'Phone Number'));
  const phoneField = buildPhoneField(state.address?.country || 'GH', state.address?.phone);
  groupPhone.appendChild(phoneField.row);
  // Keep the dial code in sync when the country selection changes.
  selectCountry.addEventListener('change', () => {
    const dialSel = phoneField.row.querySelector('select') as HTMLSelectElement | null;
    if (dialSel && DIAL_CODES[selectCountry.value]) dialSel.value = selectCountry.value;
  });

  form.append(groupLine1, groupCity, row, groupCountry, groupPhone);
  card.appendChild(form);

  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back') as HTMLButtonElement;
  backBtn.type = 'button';
  backBtn.onclick = () => transitionTo('cart');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Calculate Shipping') as HTMLButtonElement;
  nextBtn.type = 'button';
  nextBtn.onclick = async () => {
    const country = selectCountry.value;
    const city = inputCity.value.trim();
    const st = inputState.value.trim();
    const postal = inputPostal.value.trim();
    const line1 = inputLine1.value.trim();
    const phone = phoneField.getValue();

    if (!line1 || !city || !country || !phone) {
      showButtonError(nextBtn, new Error('Please fill in Street Address, City, Country, and Phone Number.'));
      return;
    }

    nextBtn.disabled = true;
    nextBtn.textContent = 'Calculating…';

    try {
      state.address = { line1, city, state: st, postalCode: postal, country, phone };
      saveState();

      const res = await ctx.callTool('set_shipping_address', {
        site_id: state.siteId,
        cart_id: state.cartId,
        country_code: country,
        city: city,
        state: st,
        postal_code: postal,
      });

      if (res.isError) throw new Error(textOf(res) || 'Failed to calculate shipping');

      state.checkoutModel = res.structuredContent;
      saveState();
      transitionTo('shipping_methods');
    } catch (err) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Calculate Shipping';
      showButtonError(nextBtn, err);
    }
  };

  stepFooter(foot, backBtn, nextBtn);
}

function renderShippingMethodsStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  const { card, foot } = stepScaffold(root, 'Select Shipping Method');

  const options = state.checkoutModel?.shippingOptions || [];
  const list = el('div', 'syn-options');

  let selectedId = state.selectedOptionId || (options[0]?.optionId || '');

  if (options.length === 0) {
    const empty = el('div', 'syn-muted', 'No shipping options available for this address.');
    empty.style.padding = '8px 4px';
    list.appendChild(empty);
  } else {
    for (const opt of options) {
      const row = el('button', 'syn-option') as HTMLButtonElement;
      row.type = 'button';
      row.setAttribute('aria-checked', opt.optionId === selectedId ? 'true' : 'false');

      const main = el('div', 'syn-opt-main');
      main.appendChild(el('div', 'ttl', opt.label));
      if (opt.description) main.appendChild(el('div', 'sub', opt.description));
      row.appendChild(main);
      if (opt.cost) row.appendChild(el('div', 'meta', opt.cost));

      row.onclick = () => {
        selectedId = opt.optionId;
        for (const child of list.children) child.setAttribute('aria-checked', 'false');
        row.setAttribute('aria-checked', 'true');
      };
      list.appendChild(row);
    }
  }
  card.appendChild(list);

  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back') as HTMLButtonElement;
  backBtn.type = 'button';
  backBtn.onclick = () => transitionTo('shipping_address');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Apply Shipping') as HTMLButtonElement;
  nextBtn.type = 'button';
  nextBtn.disabled = options.length === 0;
  nextBtn.onclick = async () => {
    nextBtn.disabled = true;
    nextBtn.textContent = 'Applying…';

    try {
      state.selectedOptionId = selectedId;
      saveState();

      const res = await ctx.callTool('select_shipping_option', {
        site_id: state.siteId,
        cart_id: state.cartId,
        option_id: selectedId,
      });

      if (res.isError) throw new Error(textOf(res) || 'Failed to apply shipping');

      state.checkoutModel = res.structuredContent;
      saveState();
      transitionTo('delegation_request');
    } catch (err) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Apply Shipping';
      showButtonError(nextBtn, err);
    }
  };

  stepFooter(foot, backBtn, nextBtn);
}

function renderDelegationRequestStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  const { card, foot } = stepScaffold(
    root,
    'Verification & Delegation',
    'Because payments and checkouts spend money, we require explicit buyer delegation. Enter your email to receive a 6-digit approval code.',
  );

  const form = el('form', 'syn-form');
  form.onsubmit = (e) => e.preventDefault();

  const groupEmail = el('div', 'syn-form-group');
  groupEmail.appendChild(el('label', 'syn-form-label', 'Buyer Email Address'));
  const inputEmail = el('input', 'syn-input');
  inputEmail.type = 'email';
  inputEmail.placeholder = 'e.g. buyer@example.com';
  inputEmail.value = state.delegationEmail || '';
  groupEmail.appendChild(inputEmail);
  form.appendChild(groupEmail);
  card.appendChild(form);

  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back') as HTMLButtonElement;
  backBtn.type = 'button';
  backBtn.onclick = () => transitionTo('shipping_methods');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Send Code') as HTMLButtonElement;
  nextBtn.type = 'button';
  nextBtn.onclick = async () => {
    const email = inputEmail.value.trim();
    if (!email) {
      showButtonError(nextBtn, new Error('Please enter a valid email address.'));
      return;
    }

    nextBtn.disabled = true;
    nextBtn.textContent = 'Sending…';

    try {
      state.delegationEmail = email;
      saveState();

      const res = await ctx.callTool('request_delegation', {
        site_id: state.siteId,
        email: email,
      });

      if (res.isError) throw new Error(textOf(res) || 'Failed to request delegation');

      state.deviceCode = (res.structuredContent as { device_code?: string }).device_code;
      saveState();
      transitionTo('delegation_verify');
    } catch (err) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Send Code';
      showButtonError(nextBtn, err);
    }
  };

  stepFooter(foot, backBtn, nextBtn);
}

function renderDelegationVerifyStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  const { card, foot } = stepScaffold(
    root,
    'Verify Approval Code',
    `We've sent a 6-digit verification code to ${state.delegationEmail || 'your email'}. Enter it below to approve checkout.`,
  );

  const form = el('form', 'syn-form');
  form.onsubmit = (e) => e.preventDefault();

  const groupCode = el('div', 'syn-form-group');
  groupCode.appendChild(el('label', 'syn-form-label', '6-Digit Code'));
  const inputCode = el('input', 'syn-input');
  inputCode.type = 'text';
  inputCode.maxLength = 6;
  inputCode.placeholder = 'e.g. 123456';
  inputCode.style.textAlign = 'center';
  inputCode.style.fontSize = '22px';
  inputCode.style.letterSpacing = '8px';
  groupCode.appendChild(inputCode);
  form.appendChild(groupCode);
  card.appendChild(form);

  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back') as HTMLButtonElement;
  backBtn.type = 'button';
  backBtn.onclick = () => transitionTo('delegation_request');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Verify Code') as HTMLButtonElement;
  nextBtn.type = 'button';
  nextBtn.onclick = async () => {
    const code = inputCode.value.trim();
    if (code.length !== 6) {
      showButtonError(nextBtn, new Error('Verification code must be exactly 6 digits.'));
      return;
    }

    nextBtn.disabled = true;
    nextBtn.textContent = 'Verifying…';

    try {
      const res = await ctx.callTool('submit_delegation_otp', {
        site_id: state.siteId,
        device_code: state.deviceCode,
        code: code,
      });

      if (res.isError) throw new Error(textOf(res) || 'Invalid code');

      state.delegationToken = res.structuredContent.delegation_token;
      saveState();
      transitionTo('customer_info');
    } catch (err) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Verify Code';
      showButtonError(nextBtn, err);
    }
  };

  stepFooter(foot, backBtn, nextBtn);
}

function renderCustomerInfoStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  const { card, foot } = stepScaffold(root, 'Checkout Details');

  const form = el('form', 'syn-form');
  form.onsubmit = (e) => e.preventDefault();

  const groupName = el('div', 'syn-form-group');
  groupName.appendChild(el('label', 'syn-form-label', 'Your Full Name'));
  const inputName = el('input', 'syn-input');
  inputName.placeholder = 'e.g. Jane Doe';
  inputName.value = state.customerInfo?.name || '';
  groupName.appendChild(inputName);

  const groupEmail = el('div', 'syn-form-group');
  groupEmail.appendChild(el('label', 'syn-form-label', 'Your Email'));
  const inputEmail = el('input', 'syn-input');
  inputEmail.type = 'email';
  inputEmail.placeholder = 'e.g. customer@example.com';
  inputEmail.value = state.customerInfo?.email || state.delegationEmail || '';
  groupEmail.appendChild(inputEmail);

  const groupPhone = el('div', 'syn-form-group');
  groupPhone.appendChild(el('label', 'syn-form-label', 'Phone Number'));
  const phoneField = buildPhoneField(
    state.address?.country || 'GH',
    state.customerInfo?.phone || state.address?.phone,
  );
  groupPhone.appendChild(phoneField.row);

  form.append(groupName, groupEmail, groupPhone);

  const selectedOption = state.checkoutModel?.shippingOptions?.find((o: any) => o.optionId === state.selectedOptionId);
  const selectedLabel = selectedOption?.label || '';
  const isPickup = selectedLabel.toLowerCase().includes('pickup') || selectedLabel.toLowerCase().includes('pick up') || selectedLabel.toLowerCase().includes('collect') || selectedLabel.toLowerCase().includes('in-store');

  let inputShipName: HTMLInputElement;
  let inputShipLine1: HTMLInputElement;

  if (!isPickup) {
    const groupShipName = el('div', 'syn-form-group');
    groupShipName.appendChild(el('label', 'syn-form-label', 'Recipient Full Name'));
    inputShipName = el('input', 'syn-input');
    inputShipName.placeholder = 'e.g. Jane Doe';
    inputShipName.value = state.customerInfo?.shippingName || '';
    groupShipName.appendChild(inputShipName);

    const groupShipLine1 = el('div', 'syn-form-group');
    groupShipLine1.appendChild(el('label', 'syn-form-label', 'Shipping Street Address'));
    inputShipLine1 = el('input', 'syn-input');
    inputShipLine1.placeholder = 'e.g. 12 Oxford Street';
    inputShipLine1.value = state.customerInfo?.shippingLine1 || state.address?.line1 || '';
    groupShipLine1.appendChild(inputShipLine1);

    form.append(groupShipName, groupShipLine1);
  }

  card.appendChild(form);

  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back') as HTMLButtonElement;
  backBtn.type = 'button';
  backBtn.onclick = () => transitionTo('delegation_verify');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Place Order') as HTMLButtonElement;
  nextBtn.type = 'button';
  nextBtn.onclick = async () => {
    const name = inputName.value.trim();
    const email = inputEmail.value.trim();
    const phone = phoneField.getValue();
    const sName = isPickup ? name : inputShipName.value.trim();
    const sLine1 = isPickup ? 'Local Pickup' : inputShipLine1.value.trim();

    if (!name || !email || !phone || !sName || !sLine1) {
      showButtonError(nextBtn, new Error('Please fill in all details, including phone number.'));
      return;
    }

    nextBtn.disabled = true;
    nextBtn.textContent = 'Placing Order…';

    try {
      state.customerInfo = { name, email, phone, shippingName: sName, shippingLine1: sLine1 };
      saveState();

      const res = await ctx.callTool('execute_checkout', {
        site_id: state.siteId,
        cart_id: state.cartId,
        buyer_delegation_token: state.delegationToken,
        customer_name: name,
        customer_email: email,
        customer_phone: phone,
        shipping_name: sName,
        shipping_line1: sLine1,
        shipping_city: state.address?.city || 'Accra',
        shipping_state: state.address?.state || 'Greater Accra',
        shipping_postal_code: state.address?.postalCode || '00233',
        shipping_country: state.address?.country || 'GH',
        shipping_phone: state.address?.phone || phone,
      });

      if (res.isError) throw new Error(textOf(res) || 'Checkout failed');

      state.orderId = res.structuredContent.order_id || res.structuredContent.id;
      saveState();
      transitionTo('payment_method');
    } catch (err) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Place Order';
      showButtonError(nextBtn, err);
    }
  };

  stepFooter(foot, backBtn, nextBtn);
}

function renderPaymentMethodStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  {
    const { card } = stepScaffold(root, 'Select Payment Option');
    const body = el('div', 'syn-loader-wrap');
    body.appendChild(el('div', 'syn-loader'));
    body.appendChild(el('div', 'syn-verify', 'Fetching payment options…'));
    card.appendChild(body);
  }

  ctx.callTool('get_payment_methods', {
    site_id: state.siteId,
    order_id: state.orderId,
  }).then((res) => {
    if (res.isError) throw new Error(textOf(res) || 'Failed to load payment methods');

    const sc = res.structuredContent as any;
    const channels = sc?.channels || ['mobile_money', 'card'];

    const { card, foot } = stepScaffold(root, 'Select Payment Option');
    const list = el('div', 'syn-options');

    for (const channel of channels) {
      const item = el('button', 'syn-option') as HTMLButtonElement;
      item.type = 'button';
      const main = el('div', 'syn-opt-main');
      main.appendChild(el('div', 'ttl', channel === 'mobile_money' ? 'Mobile Money' : 'Credit / Debit Card'));
      main.appendChild(el('div', 'sub', channel === 'mobile_money'
        ? 'Pay directly from your MTN, Telecel, or AirtelTigo account.'
        : 'Secure online payment powered by Paystack.'));
      item.appendChild(main);

      item.onclick = async () => {
        item.classList.add('is-sel');
        item.disabled = true;
        if (channel === 'mobile_money') {
          state.paymentMethod = 'mobile_money';
          saveState();
          transitionTo('payment_initiate_mm');
        } else {
          try {
            const initRes = await ctx.callTool('initiate_payment', {
              site_id: state.siteId,
              order_id: state.orderId,
              channel: 'card',
              buyer_delegation_token: state.delegationToken,
            });
            if (initRes.isError) throw new Error(textOf(initRes) || 'Failed to initiate card payment');
            state.paymentMethod = 'card';
            state.paymentSession = initRes.structuredContent;
            saveState();
            transitionTo('payment_poll');
          } catch (err) {
            item.classList.remove('is-sel');
            item.disabled = false;
            showButtonError(item, err);
          }
        }
      };
      list.appendChild(item);
    }
    card.appendChild(list);

    const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back') as HTMLButtonElement;
    backBtn.type = 'button';
    backBtn.onclick = () => transitionTo('customer_info');
    foot.appendChild(backBtn);

  }).catch((err) => {
    const { card, foot } = stepScaffold(root, 'Payment Method Error');
    const errBody = el('div', 'syn-form');
    errBody.appendChild(el('div', 'syn-err', err.message || 'Could not fetch payment methods.'));
    card.appendChild(errBody);
    const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back') as HTMLButtonElement;
    backBtn.type = 'button';
    backBtn.onclick = () => transitionTo('customer_info');
    foot.appendChild(backBtn);
  });
}

function renderPaymentInitiateMMStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  const { card, foot } = stepScaffold(root, 'Mobile Money Payment');

  const form = el('form', 'syn-form');
  form.onsubmit = (e) => e.preventDefault();

  const groupPhone = el('div', 'syn-form-group');
  groupPhone.appendChild(el('label', 'syn-form-label', 'Ghana Phone Number'));
  const inputPhone = el('input', 'syn-input');
  inputPhone.placeholder = 'e.g. 0551234987';
  inputPhone.value = '';
  groupPhone.appendChild(inputPhone);

  const groupProvider = el('div', 'syn-form-group');
  groupProvider.appendChild(el('label', 'syn-form-label', 'Provider'));
  const selectProvider = el('select', 'syn-form-select') as HTMLSelectElement;
  const optMTN = el('option', undefined, 'MTN'); optMTN.value = 'mtn';
  const optVod = el('option', undefined, 'Telecel (Vodafone)'); optVod.value = 'vod';
  const optTgo = el('option', undefined, 'AirtelTigo'); optTgo.value = 'tgo';
  selectProvider.append(optMTN, optVod, optTgo);
  groupProvider.appendChild(selectProvider);

  form.append(groupPhone, groupProvider);
  card.appendChild(form);

  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back') as HTMLButtonElement;
  backBtn.type = 'button';
  backBtn.onclick = () => transitionTo('payment_method');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Pay Now') as HTMLButtonElement;
  nextBtn.type = 'button';
  nextBtn.onclick = async () => {
    const phone = inputPhone.value.trim();
    const provider = selectProvider.value;

    if (!phone) {
      showButtonError(nextBtn, new Error('Please enter your phone number.'));
      return;
    }

    nextBtn.disabled = true;
    nextBtn.textContent = 'Initiating…';

    try {
      const res = await ctx.callTool('initiate_payment', {
        site_id: state.siteId,
        order_id: state.orderId,
        channel: 'mobile_money',
        phone: phone,
        provider: provider,
        buyer_delegation_token: state.delegationToken,
      });

      if (res.isError) throw new Error(textOf(res) || 'Payment initiation failed');

      state.paymentSession = res.structuredContent;
      saveState();
      transitionTo('payment_poll');
    } catch (err) {
      nextBtn.disabled = false;
      nextBtn.textContent = 'Pay Now';
      showButtonError(nextBtn, err);
    }
  };

  stepFooter(foot, backBtn, nextBtn);
}

function renderPaymentPollStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  const { card } = stepScaffold(root, 'Authorizing Payment');

  const session = state.paymentSession;
  const isCard = state.paymentMethod === 'card';
  const inst = session?.instruction || {};
  const action = inst.action || '';

  const body = el('div', 'syn-form');

  if (isCard) {
    // Only ever follow an https payment URL. authorization_url comes from the
    // connector/Paystack; refusing other schemes blocks a malicious connector from
    // injecting a javascript:/data: link (which would run in this iframe) or a
    // non-https redirect.
    const raw = String(inst.authorization_url || '');
    const link = /^https:\/\//i.test(raw) ? raw : '';
    body.appendChild(el('div', 'syn-muted', 'Please complete the card payment in the secure window.'));

    const payBtn = el('a', 'syn-btn syn-btn-primary syn-btn-block');
    payBtn.href = link || '#';
    payBtn.target = '_blank';
    payBtn.rel = 'noopener noreferrer';
    payBtn.textContent = 'Open Secure Payment Page';
    payBtn.style.textDecoration = 'none';
    // A sandboxed iframe cannot open target=_blank itself — route through the
    // host's open-link capability. The href stays as a fallback for hosts without it.
    payBtn.onclick = (e) => {
      if (!link) {
        e.preventDefault();
        showButtonNote(payBtn, 'Payment link unavailable — please retry.');
        return;
      }
      // Host with open-link: route through it. Without it, fall through to the
      // anchor's default https navigation.
      if (ctx.openLink) {
        e.preventDefault();
        ctx.openLink(link);
      }
    };
    body.appendChild(payBtn);
  } else if (action === 'submit_otp') {
    body.appendChild(el('div', 'syn-muted', inst.display_text || 'Enter the OTP code sent to your phone.'));
    
    const form = el('form', 'syn-form');
    form.onsubmit = (e) => e.preventDefault();
    form.style.padding = '10px 0';
    
    const groupOtp = el('div', 'syn-form-group');
    const inputOtp = el('input', 'syn-input');
    inputOtp.placeholder = 'e.g. 123456';
    inputOtp.style.textAlign = 'center';
    inputOtp.style.fontSize = '18px';
    groupOtp.appendChild(inputOtp);
    form.appendChild(groupOtp);
    
    const submitBtn = el('button', 'syn-btn syn-btn-primary', 'Submit OTP');
    submitBtn.onclick = async () => {
      const otp = inputOtp.value.trim();
      if (!otp) return;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
      try {
        const res = await ctx.callTool('submit_payment_otp', {
          site_id: state.siteId,
          order_id: state.orderId,
          otp: otp,
          buyer_delegation_token: state.delegationToken,
        });
        if (res.isError) throw new Error(textOf(res) || 'Failed to submit OTP');
        state.paymentSession = res.structuredContent;
        saveState();
        transitionTo('payment_poll');
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit OTP';
        showButtonError(submitBtn, err);
      }
    };
    form.appendChild(submitBtn);
    body.appendChild(form);

    // Let the buyer go back to fix a wrong number (re-initiates a fresh charge
    // with the new phone). Stop polling the old reference first.
    const changeBtn = el('button', 'syn-btn syn-btn-ghost', '← Change phone number');
    changeBtn.type = 'button';
    changeBtn.onclick = () => {
      if ((root as any)._paymentPollInterval) {
        clearInterval((root as any)._paymentPollInterval);
        (root as any)._paymentPollInterval = null;
      }
      transitionTo('payment_initiate_mm');
    };
    body.appendChild(changeBtn);
  } else {
    body.appendChild(el('div', 'syn-muted', inst.display_text || 'An approval prompt was sent to your phone. Please approve the prompt on your phone screen to complete the transaction.'));
  }

  if (action !== 'submit_otp') {
    const loaderWrap = el('div', 'syn-loader-wrap');
    loaderWrap.appendChild(el('div', 'syn-loader'));
    loaderWrap.appendChild(el('div', 'syn-verify', 'Verifying payment status…'));
    body.appendChild(loaderWrap);
  }

  card.appendChild(body);

  if ((root as any)._paymentPollInterval) {
    clearInterval((root as any)._paymentPollInterval);
  }

  const pollFunc = async () => {
    try {
      const res = await ctx.callTool('get_payment_status', {
        site_id: state.siteId,
        order_id: state.orderId,
      });

      if (!res.isError && res.structuredContent) {
        const currentSession = res.structuredContent as any;
        const currentStatus = currentSession.payment_status || '';
        
        if (currentStatus === 'paid') {
          clearInterval((root as any)._paymentPollInterval);
          (root as any)._paymentPollInterval = null;
          transitionTo('success');
        } else if (currentStatus === 'failed') {
          clearInterval((root as any)._paymentPollInterval);
          (root as any)._paymentPollInterval = null;

          const { card: failCard, foot } = stepScaffold(root, 'Payment Failed');
          const errBody = el('div', 'syn-form');
          errBody.appendChild(el('div', 'syn-err', currentSession.message || 'Your payment failed.'));
          failCard.appendChild(errBody);
          const retryBtn = el('button', 'syn-btn syn-btn-primary', 'Retry') as HTMLButtonElement;
          retryBtn.type = 'button';
          retryBtn.onclick = () => transitionTo('payment_method');
          stepFooter(foot, null, retryBtn);
        }
      }
    } catch (err) {
      // Keep polling
    }
  };

  (root as any)._paymentPollInterval = setInterval(pollFunc, 3000);
}

function renderSuccessStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  if ((root as any)._paymentPollInterval) {
    clearInterval((root as any)._paymentPollInterval);
    (root as any)._paymentPollInterval = null;
  }

  root.replaceChildren();
  const card = el('div', 'syn-card');

  const wrap = el('div', 'syn-success-wrap');

  const halo = el('div', 'syn-success-halo');
  const icon = el('div', 'syn-success-icon');
  icon.innerHTML = SUCCESS_CHECK_SVG;
  halo.appendChild(icon);
  wrap.appendChild(halo);

  wrap.appendChild(el('div', 'syn-success-title', 'Order Confirmed!'));
  wrap.appendChild(el('div', 'syn-success-msg', `Thank you for your purchase! Your order #${state.orderId} was successfully paid and placed.`));

  const totalLine = el('div', 'syn-success-total');
  const totalVal = el('b', undefined, state.checkoutModel?.total || model.total || '—');
  totalLine.append(document.createTextNode('Total Paid  '), totalVal);
  wrap.appendChild(totalLine);

  // The estimate above can drift from what was actually charged (addons/shipping
  // applied server-side). Fetch the real order total and correct the line in place.
  if (state.orderId && state.delegationToken) {
    void ctx.callTool('get_order', { site_id: state.siteId, order_id: state.orderId, buyer_delegation_token: state.delegationToken })
      .then((res) => {
        const t = (res?.structuredContent as any)?.total as { amount?: string; currency?: string } | undefined;
        if (t?.amount) totalVal.textContent = `${t.currency ?? ''} ${t.amount}`.trim();
      })
      .catch(() => { /* keep the estimate */ });
  }

  const doneBtn = el('button', 'syn-btn syn-btn-primary', 'Done') as HTMLButtonElement;
  doneBtn.type = 'button';
  doneBtn.style.marginTop = '12px';
  doneBtn.style.minWidth = '150px';
  doneBtn.onclick = async () => {
    const orderId = state.orderId;
    const siteId = state.siteId;
    const token = state.delegationToken;

    sessionStorage.removeItem(`active_cart_${siteId}`); // checked out

    // Orders are buyer-private: only the View holds the buyer's delegation token
    // (the agent never sees it — the HITL boundary). So fetch + show the order
    // status IN-FRAME with that token, instead of asking the model (which has no
    // token and would fail).
    if (orderId && token) {
      doneBtn.disabled = true;
      doneBtn.textContent = 'Loading…';
      try {
        const res = await ctx.callTool('get_order', {
          site_id: siteId,
          order_id: orderId,
          buyer_delegation_token: token,
        });
        if (res.isError) throw new Error(textOf(res) || 'Could not load order');
        sessionStorage.removeItem(`checkout_state_${siteId}`);
        renderOrderStatusPanel(root, res.structuredContent as Record<string, unknown> | undefined, orderId);
        return;
      } catch (err) {
        doneBtn.disabled = false;
        doneBtn.textContent = 'Done';
        showButtonError(doneBtn, err);
        return;
      }
    }

    // No token (shouldn't happen right after checkout) — acknowledge in-frame; do
    // NOT punt a token-gated lookup to the model.
    sessionStorage.removeItem(`checkout_state_${siteId}`);
    renderOrderStatusPanel(root, undefined, orderId);
  };
  wrap.appendChild(doneBtn);

  card.appendChild(wrap);
  root.appendChild(card);
}

/** Render a compact in-frame order-status panel (after Done fetches the order). */
function renderOrderStatusPanel(root: HTMLElement, order: Record<string, unknown> | undefined, fallbackOrderId?: string): void {
  root.replaceChildren();
  const card = el('div', 'syn-card');

  const wrap = el('div', 'syn-success-wrap');
  const halo = el('div', 'syn-success-halo');
  const icon = el('div', 'syn-success-icon');
  icon.innerHTML = SUCCESS_CHECK_SVG;
  halo.appendChild(icon);
  wrap.appendChild(halo);
  wrap.appendChild(el('div', 'syn-success-title', 'Order Confirmed!'));

  const orderId = (order?.order_id as string) ?? fallbackOrderId ?? '';
  const status = (order?.status as string) ?? 'processing';
  wrap.appendChild(el('div', 'syn-success-msg', `Order #${orderId} — ${status}`));

  const total = order?.total as { amount?: string; currency?: string } | undefined;
  if (total?.amount) {
    const tot = el('div', 'syn-success-total');
    tot.append(document.createTextNode('Total Paid  '), el('b', undefined, `${total.currency ?? ''} ${total.amount}`.trim()));
    wrap.appendChild(tot);
  }

  card.appendChild(wrap);
  root.appendChild(card);
}
