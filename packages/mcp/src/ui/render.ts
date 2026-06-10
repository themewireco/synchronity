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
function qtyStepper(onChange?: (qty: number) => void): { node: HTMLElement; get: () => number } {
  let qty = 1;
  const wrap = el('div', 'syn-qty');
  const minus = el('button', undefined, '−'); // −
  const val = el('span', undefined, '1');
  const plus = el('button', undefined, '+');
  minus.type = 'button'; plus.type = 'button';
  minus.setAttribute('aria-label', 'Decrease quantity');
  plus.setAttribute('aria-label', 'Increase quantity');
  const sync = () => {
    val.textContent = String(qty);
    minus.disabled = qty <= 1;
    onChange?.(qty);
  };
  minus.onclick = () => { if (qty > 1) { qty--; sync(); } };
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

/** Show a transient line of text beside a button (Desktop has no console for the iframe). */
function showButtonNote(btn: HTMLElement, msg: string): void {
  const host = btn.parentElement ?? btn;
  let line = host.querySelector(':scope > .syn-err') as HTMLElement | null;
  if (!line) {
    line = el('div', 'syn-err');
    host.appendChild(line);
  }
  line.textContent = msg.slice(0, 160);
  setTimeout(() => { line?.remove(); }, 6000);
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
/** Remember a site's display name (set on the product-list model) so later steps —
 *  e.g. the order-confirmation message — can show "at <Store>" instead of a raw UUID. */
function setSiteName(siteId: string, name?: string): void {
  if (name) sessionStorage.setItem(`site_name_${siteId}`, name);
}
function getSiteName(siteId: string): string {
  return sessionStorage.getItem(`site_name_${siteId}`) || '';
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

/** Shopping-bag button (icon + item-count badge) that opens the cart in-place. */
function viewCartButton(siteId: string, ctx: ViewCtx): BagButton {
  const btn = el('button', 'syn-btn syn-btn-ghost syn-bag') as BagButton;
  btn.type = 'button';
  const paint = () => {
    const c = cartCount(siteId);
    btn.replaceChildren();
    btn.appendChild(el('span', 'syn-bag-icon', '🛍'));
    if (c > 0) btn.appendChild(el('span', 'syn-bag-count', String(c)));
    else btn.appendChild(el('span', undefined, 'Cart'));
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
  setSiteName(model.siteId, model.siteName); // cache for later steps (e.g. order-confirmation message)
  const card = el('div', 'syn-card');
  if (model.products.length === 0) {
    card.appendChild(el('div', 'syn-listhead', 'No products matched that search.'));
    root.appendChild(card);
    return;
  }
  
  const header = el('div', 'syn-listhead');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  
  const titleSpan = el('span', undefined, `${model.products.length} product${model.products.length === 1 ? '' : 's'}${model.siteName ? ` at ${model.siteName}` : ''}`);
  header.appendChild(titleSpan);
  
  const cartBtnContainer = el('span');
  header.appendChild(cartBtnContainer);
  card.appendChild(header);

  // Seed the active cart from any server-prefilled param so the bag opens it on first click.
  for (const p of model.products) {
    const pid = p.addToCart.params.cart_id as string | undefined;
    if (pid) { setActiveCartId(model.siteId, pid); break; }
  }

  // One bag for the whole list; adds repaint it (count + newly-known cart id).
  const bag = viewCartButton(model.siteId, ctx);
  cartBtnContainer.appendChild(bag);

  const list = el('div', 'syn-list');

  for (const p of model.products) {
    const row = el('div', 'syn-row');
    const thumb = el('img', 'syn-thumb');
    thumb.src = p.image ?? '';
    thumb.alt = p.title;
    thumb.loading = 'lazy';
    const body = el('div', 'syn-rowbody');
    body.appendChild(el('div', 'syn-rowtitle', p.title));
    const meta = el('div', 'syn-rowmeta');
    meta.appendChild(el('span', 'syn-price', p.price));
    meta.appendChild(stockChip(p.inStock));
    body.appendChild(meta);

    const actions = el('div', 'syn-rowactions');
    if (p.hasOptions) {
      const selectBtn = el('button', 'syn-btn syn-btn-primary syn-btn-sm', 'Select options') as HTMLButtonElement;
      selectBtn.type = 'button';
      selectBtn.disabled = !p.inStock;
      selectBtn.onclick = async () => {
        selectBtn.disabled = true;
        const original = selectBtn.textContent;
        selectBtn.textContent = '…';
        try {
          const res = await ctx.callTool('get_product', {
            site_id: (p.addToCart.params.site_id as string),
            product_id: p.productId,
          });
          if (res.isError) throw new Error(textOf(res) || 'Could not load options');
          ctx.onResult?.(res); // renders the single-product card (with wizard) in-frame
        } catch (err) {
          selectBtn.disabled = false;
          selectBtn.textContent = original;
          showButtonError(selectBtn, err);
        }
      };
      actions.append(selectBtn);
    } else {
      // existing inline qty + Add-to-cart path (unchanged)
      const qty = qtyStepper();
      const btn = addToCartButton(
        p.addToCart, ctx,
        () => ({ quantity: qty.get(), missing: [] }),
        'sm',
      );
      btn.disabled = !p.inStock;

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
  const card = el('div', 'syn-card syn-card-product');
  const heroImg = buildHero(card, model);

  const body = el('div', 'syn-body');
  const head = el('div');
  head.appendChild(el('div', 'syn-title syn-display', model.title));
  if (model.description) {
    head.appendChild(el('div', 'syn-muted syn-desc', model.description));
  }
  body.appendChild(head);

  // Cart-id session tracking + an always-visible shopping bag (reads the live cart
  // at click time, mirroring renderProductList — so the buyer can always reach the
  // cart/checkout, including right after the first add).
  const sessionKey = `active_cart_${model.siteId}`;
  let currentCartId = sessionStorage.getItem(sessionKey) || (model.addToCart.params.cart_id as string) || '';
  // The bag floats over the hero (on the card, NOT in the body) so it survives the
  // options wizard re-rendering the body — the buyer can reach the cart from any step.
  const cartBtnContainer = el('span', 'syn-prodbag');
  const bag = viewCartButton(model.siteId, ctx);
  cartBtnContainer.appendChild(bag);
  card.appendChild(cartBtnContainer);
  const updateCartId = (cId?: string) => {
    if (!cId) return;
    currentCartId = cId;
    sessionStorage.setItem(sessionKey, cId);
    model.addToCart.params.cart_id = cId;
    bag.repaint();
  };
  if (currentCartId) updateCartId(currentCartId);

  if (needsOptionsWizard(model)) {
    // Products with variants / multiple / required options open a stepped wizard.
    const footer = el('div', 'syn-footer');
    const priceblk = el('div', 'syn-priceblk');
    priceblk.appendChild(el('span', 'syn-price', model.price));
    priceblk.appendChild(stockChip(model.inStock));
    footer.appendChild(priceblk);

    const right = el('div', 'syn-rowactions');
    const selectBtn = el('button', 'syn-btn syn-btn-primary', 'Select options');
    selectBtn.type = 'button';
    selectBtn.disabled = !model.inStock;
    selectBtn.onclick = () => renderOptionsWizard(body, model, ctx, updateCartId, heroImg);
    right.append(selectBtn);
    footer.appendChild(right);
    body.appendChild(footer);
  } else {
    // Simple product (no variants, ≤1 optional addon): inline add.
    const base = parsePrice(model.price);
    const priceEl = el('span', 'syn-price', model.price);
    let qty: ReturnType<typeof qtyStepper> | undefined;
    let addons: ReturnType<typeof addonGroups> | undefined;
    const updatePrice = () => {
      const mod = addons ? addons.collect().modifierTotal : 0;
      priceEl.textContent = formatPriceLike((base.amount + mod) * (qty ? qty.get() : 1), base);
    };
    addons = model.addons && model.addons.length > 0 ? addonGroups(model.addons, updatePrice) : undefined;
    if (addons) body.appendChild(addons.node);
    qty = qtyStepper(updatePrice);

    const footer = el('div', 'syn-footer');
    const priceblk = el('div', 'syn-priceblk');
    priceblk.appendChild(priceEl);
    priceblk.appendChild(stockChip(model.inStock));
    footer.appendChild(priceblk);

    const btn = addToCartButton(
      model.addToCart, ctx,
      () => {
        const c = addons?.collect();
        return { quantity: qty!.get(), addons: c?.values, missing: c?.missing ?? [] };
      },
      'lg',
    );
    btn.disabled = !model.inStock;
    const origin = btn.onclick;
    btn.onclick = async (e) => {
      await (origin as ((this: HTMLButtonElement, ev: PointerEvent) => unknown) | null)?.call(btn, e);
      updateCartId(model.addToCart.params.cart_id as string);
      bag.repaint(); // count grew; the cart id is now known to the shared bag
    };

    const right = el('div', 'syn-rowactions');
    right.append(qty.node, btn);
    footer.appendChild(right);
    body.appendChild(footer);
  }

  card.appendChild(body);
  root.appendChild(card);
}

/** Stepped options wizard: variant step → addons step → review → Add to cart. Renders into `body`. */
function renderOptionsWizard(
  body: HTMLElement,
  model: ProductCardModel,
  ctx: ViewCtx,
  updateCartId: (cId?: string) => void,
  heroImg?: HTMLImageElement,
): void {
  const base = parsePrice(model.price);
  let selectedVariant: ProductCardVariant | undefined;
  const selectedAxis: Record<string, string> = {};
  const addons = model.addons && model.addons.length > 0 ? addonGroups(model.addons) : undefined;
  const qtyState = { n: 1 };

  const steps: Array<'variant' | 'addons' | 'review'> = [];
  if (model.variants && model.variants.length > 0) steps.push('variant');
  if (model.addons && model.addons.length > 0) steps.push('addons');
  steps.push('review');
  let stepIdx = 0;

  const variantBase = () => (selectedVariant ? parsePrice(selectedVariant.price).amount : base.amount);
  const lineTotal = () => {
    const mod = addons ? addons.collect().modifierTotal : 0;
    return formatPriceLike((variantBase() + mod) * qtyState.n, base);
  };

  const render = () => {
    body.replaceChildren();
    const step = steps[stepIdx];

    body.appendChild(el('div', 'syn-listhead', `Step ${stepIdx + 1} of ${steps.length} · ${model.title}`));
    const hint = el('div', 'syn-err');

    if (step === 'variant') {
      const variants = model.variants ?? [];
      const axes = deriveAxes(variants);

      if (axes.length === 0) {
        // Fallback: variants have no attributes — keep the flat radio-card list.
        const wrap = el('div', 'syn-form');
        for (const v of variants) {
          const cardBtn = el('button', 'syn-radio-card');
          cardBtn.type = 'button';
          cardBtn.setAttribute('aria-checked', selectedVariant?.variantId === v.variantId ? 'true' : 'false');
          cardBtn.appendChild(el('div', 'syn-radio-title', v.title));
          cardBtn.appendChild(el('div', 'syn-radio-cost', v.inStock ? v.price : `${v.price} · Out of stock`));
          cardBtn.disabled = !v.inStock;
          cardBtn.onclick = () => { selectedVariant = v; render(); };
          wrap.appendChild(cardBtn);
        }
        body.appendChild(wrap);
      } else {
        const wrap = el('div', 'syn-form');
        for (const axis of axes) {
          wrap.appendChild(el('div', 'syn-axis', axis.name));
          const row = el('div', 'syn-pillrow');
          for (const value of axis.values) {
            const available = isValueAvailable(variants, selectedAxis, axis.name, value);
            const pill = el('button', 'syn-pill' + (selectedAxis[axis.name] === value ? ' syn-pill-sel' : '') + (available ? '' : ' syn-pill-oos'), value) as HTMLButtonElement;
            pill.type = 'button';
            pill.disabled = !available;
            pill.setAttribute('aria-checked', selectedAxis[axis.name] === value ? 'true' : 'false');
            pill.onclick = () => {
              selectedAxis[axis.name] = value;
              selectedVariant = resolveVariant(variants, selectedAxis);
              // When a variant resolves, show its image if present, else fall back to the
              // product's base image (spec §2). Don't touch the hero on partial selection.
              if (heroImg && selectedVariant) heroImg.src = selectedVariant.image || model.image || heroImg.src;
              render();
            };
            row.appendChild(pill);
          }
          wrap.appendChild(row);
        }
        body.appendChild(wrap);
      }
    } else if (step === 'addons' && addons) {
      body.appendChild(addons.node);
    } else {
      const wrap = el('div', 'syn-form');
      if (selectedVariant) wrap.appendChild(reviewRow('Variant', selectedVariant.title));
      if (addons) {
        const sel = addons.collect().values;
        for (const a of model.addons ?? []) {
          const v = sel[a.addonId];
          if (v != null && v !== '') wrap.appendChild(reviewRow(a.label, Array.isArray(v) ? v.join(', ') : String(v)));
        }
      }
      const totEl = el('span', 'syn-price', lineTotal());
      // Use the qty the stepper passes in: qtyStepper() fires onChange during its
      // own construction (sync()), before this `const qStep` is initialised, so
      // reading qStep.get() here threw a TDZ ReferenceError and blanked the review step.
      const qStep = qtyStepper((n) => { qtyState.n = n; totEl.textContent = lineTotal(); });
      const qRow = el('div', 'syn-totline');
      qRow.append(el('span', 'syn-muted', 'Quantity'), qStep.node);
      wrap.appendChild(qRow);
      const tot = el('div', 'syn-totline syn-totline-grand');
      tot.append(el('span', undefined, 'Total'), totEl);
      wrap.appendChild(tot);
      body.appendChild(wrap);
    }

    body.appendChild(hint);

    const nav = el('div', 'syn-checkout-footer');
    if (stepIdx > 0) {
      const back = el('button', 'syn-btn syn-btn-ghost', 'Back');
      back.type = 'button';
      back.onclick = () => { stepIdx--; render(); };
      nav.appendChild(back);
    } else {
      nav.appendChild(el('span'));
    }

    if (step !== 'review') {
      const next = el('button', 'syn-btn syn-btn-primary', 'Next');
      next.type = 'button';
      next.onclick = () => {
        if (step === 'variant' && !selectedVariant) { hint.textContent = 'Please choose an option.'; return; }
        if (step === 'addons' && addons) {
          const miss = addons.collect().missing;
          if (miss.length > 0) { hint.textContent = `Please choose ${miss[0]}.`; return; }
        }
        stepIdx++;
        render();
      };
      nav.appendChild(next);
    } else {
      const add = addToCartButton(
        model.addToCart, ctx,
        () => {
          const c = addons?.collect();
          return { quantity: qtyState.n, addons: c?.values, variantId: selectedVariant?.variantId, missing: c?.missing ?? [] };
        },
        'lg',
      );
      const origin = add.onclick;
      add.onclick = async (e) => {
        await (origin as ((this: HTMLButtonElement, ev: PointerEvent) => unknown) | null)?.call(add, e);
        updateCartId(model.addToCart.params.cart_id as string);
      };
      nav.appendChild(add);
    }
    body.appendChild(nav);
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
  };
  checkoutModel?: any;
  selectedOptionId?: string;
  delegationEmail?: string;
  deviceCode?: string;
  delegationToken?: string;
  customerInfo?: {
    name: string;
    email: string;
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
  const card = el('div', 'syn-card');

  const header = el('div', 'syn-listhead');
  header.appendChild(document.createTextNode('Your cart'));
  if (model.cartId) {
    const idSpan = el('span', 'syn-cart-id', ` (ID: ${model.cartId})`);
    idSpan.style.fontSize = '0.8em';
    idSpan.style.opacity = '0.7';
    idSpan.style.marginLeft = '8px';
    header.appendChild(idSpan);
  }
  card.appendChild(header);

  if (model.items.length === 0) {
    card.appendChild(el('div', 'syn-cartempty syn-muted', 'Cart is empty.'));
  } else {
    const list = el('div', 'syn-list');
    for (const it of model.items) {
      const r = el('div', 'syn-row');
      if (it.image) {
        const thumb = el('img', 'syn-thumb');
        thumb.src = it.image;
        thumb.alt = it.title;
        thumb.loading = 'lazy';
        r.appendChild(thumb);
      }
      const body = el('div', 'syn-rowbody');
      body.appendChild(el('div', 'syn-rowtitle', it.title));
      const metaBits = [`Qty ${it.qty}`, it.unitPrice];
      if (it.variantTitle) metaBits.push(it.variantTitle);
      const meta = el('div', 'syn-rowmeta');
      meta.appendChild(el('span', 'syn-muted', metaBits.join(' · ')));
      body.appendChild(meta);
      if (it.addonsSummary) body.appendChild(el('div', 'syn-muted', it.addonsSummary));
      const actions = el('div', 'syn-rowactions');
      actions.appendChild(el('span', 'syn-price', it.lineTotal));
      if (it.removeAction) actions.appendChild(simpleActionButton(it.removeAction, ctx));
      r.append(body, actions);
      list.appendChild(r);
    }
    card.appendChild(list);
  }

  const totals = el('div', 'syn-carttotals');
  const sub = el('div', 'syn-totline');
  sub.append(el('span', 'syn-muted', 'Subtotal'), el('span', undefined, model.subtotal));
  const tot = el('div', 'syn-totline syn-totline-grand');
  tot.append(el('span', undefined, 'Total'), el('span', 'syn-price', model.total));
  totals.append(sub, tot);
  card.appendChild(totals);

  if (model.items.length > 0) {
    const cartFooter = el('div', 'syn-checkout-footer');

    const cont = el('button', 'syn-btn syn-btn-ghost', '← Continue shopping');
    cont.type = 'button';
    cont.onclick = () => {
      ctx.sendMessage?.('I want to keep shopping — please show me the product list again.');
    };

    const checkoutBtn = el('button', 'syn-btn syn-btn-primary', 'Proceed to Checkout');
    checkoutBtn.type = 'button';
    checkoutBtn.onclick = () => transitionTo('shipping_address');

    cartFooter.append(cont, checkoutBtn);
    card.appendChild(cartFooter);
  }

  root.appendChild(card);
}

function renderShippingAddressStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  root.replaceChildren();
  const card = el('div', 'syn-card');

  const header = el('div', 'syn-listhead', 'Shipping Address');
  card.appendChild(header);

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
  const selectCountry = el('select', 'syn-form-select');
  const optGH = el('option', undefined, 'Ghana'); optGH.value = 'GH';
  const optUS = el('option', undefined, 'United States'); optUS.value = 'US';
  const optGB = el('option', undefined, 'United Kingdom'); optGB.value = 'GB';
  selectCountry.append(optGH, optUS, optGB);
  selectCountry.value = state.address?.country || 'GH';
  groupCountry.appendChild(selectCountry);

  form.append(groupLine1, groupCity, row, groupCountry);
  card.appendChild(form);

  const footer = el('div', 'syn-checkout-footer');
  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back');
  backBtn.onclick = () => transitionTo('cart');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Calculate Shipping');
  nextBtn.onclick = async () => {
    const country = selectCountry.value;
    const city = inputCity.value.trim();
    const st = inputState.value.trim();
    const postal = inputPostal.value.trim();
    const line1 = inputLine1.value.trim();

    if (!line1 || !city || !country) {
      showButtonError(nextBtn, new Error('Please fill in Street Address, City, and Country.'));
      return;
    }

    nextBtn.disabled = true;
    nextBtn.textContent = 'Calculating…';

    try {
      state.address = { line1, city, state: st, postalCode: postal, country };
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

  footer.append(backBtn, nextBtn);
  card.appendChild(footer);
  root.appendChild(card);
}

function renderShippingMethodsStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  root.replaceChildren();
  const card = el('div', 'syn-card');

  const header = el('div', 'syn-listhead', 'Select Shipping Method');
  card.appendChild(header);

  const options = state.checkoutModel?.shippingOptions || [];
  const list = el('div', 'syn-list');
  list.style.padding = '0 20px';
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '10px';

  let selectedId = state.selectedOptionId || (options[0]?.optionId || '');

  if (options.length === 0) {
    const empty = el('div', 'syn-muted', 'No shipping options available for this address.');
    empty.style.padding = '20px 0';
    list.appendChild(empty);
  } else {
    for (const opt of options) {
      const row = el('button', 'syn-radio-card');
      row.type = 'button';
      row.setAttribute('aria-checked', opt.optionId === selectedId ? 'true' : 'false');
      
      const title = el('div', 'syn-radio-title', opt.label);
      row.appendChild(title);
      
      if (opt.description) {
        row.appendChild(el('div', 'syn-radio-desc', opt.description));
      }
      
      row.appendChild(el('div', 'syn-radio-cost', opt.cost));

      row.onclick = () => {
        selectedId = opt.optionId;
        for (const child of list.children) {
          child.setAttribute('aria-checked', 'false');
        }
        row.setAttribute('aria-checked', 'true');
      };

      list.appendChild(row);
    }
  }

  card.appendChild(list);

  const footer = el('div', 'syn-checkout-footer');
  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back');
  backBtn.onclick = () => transitionTo('shipping_address');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Apply Shipping');
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

  footer.append(backBtn, nextBtn);
  card.appendChild(footer);
  root.appendChild(card);
}

function renderDelegationRequestStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  root.replaceChildren();
  const card = el('div', 'syn-card');

  const header = el('div', 'syn-listhead', 'Verification & Delegation');
  card.appendChild(header);

  const body = el('div', 'syn-body');
  const note = el('div', 'syn-muted', 'Because payments and checkouts spend money, we require explicit buyer delegation. Enter your email to receive a 6-digit approval code.');
  body.appendChild(note);

  const form = el('form', 'syn-form');
  form.onsubmit = (e) => e.preventDefault();
  form.style.padding = '0';

  const groupEmail = el('div', 'syn-form-group');
  groupEmail.appendChild(el('label', 'syn-form-label', 'Buyer Email Address'));
  const inputEmail = el('input', 'syn-input');
  inputEmail.type = 'email';
  inputEmail.placeholder = 'e.g. buyer@example.com';
  inputEmail.value = state.delegationEmail || '';
  groupEmail.appendChild(inputEmail);
  form.appendChild(groupEmail);
  body.appendChild(form);
  card.appendChild(body);

  const footer = el('div', 'syn-checkout-footer');
  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back');
  backBtn.onclick = () => transitionTo('shipping_methods');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Send Code');
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

  footer.append(backBtn, nextBtn);
  card.appendChild(footer);
  root.appendChild(card);
}

function renderDelegationVerifyStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  root.replaceChildren();
  const card = el('div', 'syn-card');

  const header = el('div', 'syn-listhead', 'Verify Approval Code');
  card.appendChild(header);

  const body = el('div', 'syn-body');
  const note = el('div', 'syn-muted', `We've sent a 6-digit verification code to ${state.delegationEmail || 'your email'}. Enter it below to approve checkout.`);
  body.appendChild(note);

  const form = el('form', 'syn-form');
  form.onsubmit = (e) => e.preventDefault();
  form.style.padding = '0';

  const groupCode = el('div', 'syn-form-group');
  groupCode.appendChild(el('label', 'syn-form-label', '6-Digit Code'));
  const inputCode = el('input', 'syn-input');
  inputCode.type = 'text';
  inputCode.maxLength = 6;
  inputCode.placeholder = 'e.g. 123456';
  inputCode.style.textAlign = 'center';
  inputCode.style.fontSize = '20px';
  inputCode.style.letterSpacing = '6px';
  groupCode.appendChild(inputCode);
  form.appendChild(groupCode);
  body.appendChild(form);
  card.appendChild(body);

  const footer = el('div', 'syn-checkout-footer');
  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back');
  backBtn.onclick = () => transitionTo('delegation_request');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Verify Code');
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

  footer.append(backBtn, nextBtn);
  card.appendChild(footer);
  root.appendChild(card);
}

function renderCustomerInfoStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  root.replaceChildren();
  const card = el('div', 'syn-card');

  const header = el('div', 'syn-listhead', 'Checkout Details');
  card.appendChild(header);

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

  form.append(groupName, groupEmail);

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

  const footer = el('div', 'syn-checkout-footer');
  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back');
  backBtn.onclick = () => transitionTo('delegation_verify');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Place Order');
  nextBtn.onclick = async () => {
    const name = inputName.value.trim();
    const email = inputEmail.value.trim();
    const sName = isPickup ? name : inputShipName.value.trim();
    const sLine1 = isPickup ? 'Local Pickup' : inputShipLine1.value.trim();

    if (!name || !email || !sName || !sLine1) {
      showButtonError(nextBtn, new Error('Please fill in all details.'));
      return;
    }

    nextBtn.disabled = true;
    nextBtn.textContent = 'Placing Order…';

    try {
      state.customerInfo = { name, email, shippingName: sName, shippingLine1: sLine1 };
      saveState();

      const res = await ctx.callTool('execute_checkout', {
        site_id: state.siteId,
        cart_id: state.cartId,
        buyer_delegation_token: state.delegationToken,
        customer_name: name,
        customer_email: email,
        shipping_name: sName,
        shipping_line1: sLine1,
        shipping_city: state.address?.city || 'Accra',
        shipping_state: state.address?.state || 'Greater Accra',
        shipping_postal_code: state.address?.postalCode || '00233',
        shipping_country: state.address?.country || 'GH',
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

  footer.append(backBtn, nextBtn);
  card.appendChild(footer);
  root.appendChild(card);
}

function renderPaymentMethodStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  root.replaceChildren();
  const card = el('div', 'syn-card');

  const header = el('div', 'syn-listhead', 'Choose Payment Method');
  card.appendChild(header);

  const body = el('div', 'syn-loader-wrap');
  body.appendChild(el('div', 'syn-loader'));
  body.appendChild(el('div', 'syn-muted', 'Fetching payment options…'));
  card.appendChild(body);
  root.appendChild(card);

  ctx.callTool('get_payment_methods', {
    site_id: state.siteId,
    order_id: state.orderId,
  }).then((res) => {
    if (res.isError) throw new Error(textOf(res) || 'Failed to load payment methods');

    const sc = res.structuredContent as any;
    const channels = sc?.channels || ['mobile_money', 'card'];

    root.replaceChildren();
    const cleanCard = el('div', 'syn-card');
    cleanCard.appendChild(el('div', 'syn-listhead', 'Select Payment Option'));

    const list = el('div', 'syn-list');
    list.style.padding = '0 20px';
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '10px';

    for (const channel of channels) {
      const item = el('button', 'syn-radio-card');
      item.type = 'button';
      
      const title = el('div', 'syn-radio-title', channel === 'mobile_money' ? 'Mobile Money' : 'Credit / Debit Card');
      item.appendChild(title);
      
      const desc = el('div', 'syn-radio-desc', channel === 'mobile_money' ? 'Pay directly from your MTN, Vodafone, or AirtelTigo account.' : 'Secure online payment powered by Paystack.');
      item.appendChild(desc);

      item.onclick = async () => {
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
            item.disabled = false;
            showButtonError(item, err);
          }
        }
      };

      list.appendChild(item);
    }
    cleanCard.appendChild(list);

    const footer = el('div', 'syn-checkout-footer');
    const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back');
    backBtn.onclick = () => transitionTo('customer_info');
    footer.appendChild(backBtn);
    cleanCard.appendChild(footer);
    root.appendChild(cleanCard);

  }).catch((err) => {
    root.replaceChildren();
    const errCard = el('div', 'syn-card');
    errCard.appendChild(el('div', 'syn-listhead', 'Payment Method Error'));
    const errBody = el('div', 'syn-body');
    const errMsg = el('div', 'syn-err', err.message || 'Could not fetch payment methods.');
    errBody.appendChild(errMsg);
    errCard.appendChild(errBody);

    const footer = el('div', 'syn-checkout-footer');
    const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back');
    backBtn.onclick = () => transitionTo('customer_info');
    footer.appendChild(backBtn);
    errCard.appendChild(footer);
    root.appendChild(errCard);
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
  root.replaceChildren();
  const card = el('div', 'syn-card');

  const header = el('div', 'syn-listhead', 'Mobile Money Payment');
  card.appendChild(header);

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
  const selectProvider = el('select', 'syn-form-select');
  const optMTN = el('option', undefined, 'MTN'); optMTN.value = 'mtn';
  const optVod = el('option', undefined, 'Telecel (Vodafone)'); optVod.value = 'vod';
  const optTgo = el('option', undefined, 'AirtelTigo'); optTgo.value = 'tgo';
  selectProvider.append(optMTN, optVod, optTgo);
  groupProvider.appendChild(selectProvider);

  form.append(groupPhone, groupProvider);
  card.appendChild(form);

  const footer = el('div', 'syn-checkout-footer');
  const backBtn = el('button', 'syn-btn syn-btn-ghost', 'Back');
  backBtn.onclick = () => transitionTo('payment_method');

  const nextBtn = el('button', 'syn-btn syn-btn-primary', 'Pay Now');
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

  footer.append(backBtn, nextBtn);
  card.appendChild(footer);
  root.appendChild(card);
}

function renderPaymentPollStep(
  root: HTMLElement,
  model: CartCardModel,
  ctx: ViewCtx,
  state: CheckoutState,
  transitionTo: (step: CheckoutState['step']) => void,
  saveState: () => void,
): void {
  root.replaceChildren();
  const card = el('div', 'syn-card');

  const header = el('div', 'syn-listhead', 'Authorising Payment');
  card.appendChild(header);

  const session = state.paymentSession;
  const isCard = state.paymentMethod === 'card';
  const inst = session?.instruction || {};
  const action = inst.action || '';

  const body = el('div', 'syn-body');
  
  if (isCard) {
    // Only ever follow an https payment URL. authorization_url comes from the
    // connector/Paystack; refusing other schemes blocks a malicious connector from
    // injecting a javascript:/data: link (which would run in this iframe) or a
    // non-https redirect.
    const raw = String(inst.authorization_url || '');
    const link = /^https:\/\//i.test(raw) ? raw : '';
    body.appendChild(el('div', 'syn-muted', 'Please complete the card payment in the secure window.'));

    const payBtn = el('a', 'syn-btn syn-btn-primary');
    payBtn.href = link || '#';
    payBtn.target = '_blank';
    payBtn.rel = 'noopener noreferrer';
    payBtn.textContent = 'Open Secure Payment Page';
    payBtn.style.display = 'inline-flex';
    payBtn.style.textDecoration = 'none';
    payBtn.style.margin = '10px 0';
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
    loaderWrap.appendChild(el('div', 'syn-muted', 'Verifying payment status…'));
    body.appendChild(loaderWrap);
  }

  card.appendChild(body);
  root.appendChild(card);

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
          
          root.replaceChildren();
          const cleanCard = el('div', 'syn-card');
          cleanCard.appendChild(el('div', 'syn-listhead', 'Payment Failed'));
          const errBody = el('div', 'syn-body');
          errBody.appendChild(el('div', 'syn-err', currentSession.message || 'Your payment failed.'));
          cleanCard.appendChild(errBody);

          const footer = el('div', 'syn-checkout-footer');
          const retryBtn = el('button', 'syn-btn syn-btn-primary', 'Retry');
          retryBtn.onclick = () => transitionTo('payment_method');
          footer.appendChild(retryBtn);
          cleanCard.appendChild(footer);
          root.appendChild(cleanCard);
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
  
  const icon = el('div', 'syn-success-icon', '✓');
  wrap.appendChild(icon);
  
  const title = el('div', 'syn-title syn-display', 'Order Confirmed!');
  wrap.appendChild(title);

  const msg = el('div', 'syn-muted', `Thank you for your purchase! Your order #${state.orderId} was successfully paid and placed.`);
  wrap.appendChild(msg);

  const totalLine = el('div', 'syn-totline syn-totline-grand');
  totalLine.style.marginTop = '10px';
  totalLine.append(el('span', undefined, 'Total Paid:'), el('span', 'syn-price', state.checkoutModel?.total || model.total));
  wrap.appendChild(totalLine);

  const doneBtn = el('button', 'syn-btn syn-btn-primary', 'Done');
  doneBtn.style.marginTop = '20px';
  doneBtn.onclick = () => {
    const orderId = state.orderId;
    const siteId = state.siteId;

    // Clear checkout state from sessionStorage
    const stateKey = `checkout_state_${state.siteId}`;
    sessionStorage.removeItem(stateKey);

    // Clear active cart from sessionStorage since it's checked out
    const sessionKey = `active_cart_${state.siteId}`;
    sessionStorage.removeItem(sessionKey);

    if (ctx.sendMessage && orderId) {
      // Human-readable: show the store name, not the raw site UUID. The model still
      // has the site_id in context from the checkout it just completed.
      const storeName = getSiteName(siteId);
      ctx.sendMessage(
        storeName
          ? `Please show the status of my order #${orderId} at ${storeName}.`
          : `Please show the status of my order #${orderId}.`,
      );
    } else {
      // Fallback
      state.step = 'cart';
      state.address = undefined;
      state.checkoutModel = undefined;
      state.selectedOptionId = undefined;
      state.delegationEmail = undefined;
      state.deviceCode = undefined;
      state.delegationToken = undefined;
      state.customerInfo = undefined;
      state.orderId = undefined;
      state.paymentMethod = undefined;
      state.paymentSession = undefined;
      saveState();
      transitionTo('cart');
    }
  };
  wrap.appendChild(doneBtn);

  card.appendChild(wrap);
  root.appendChild(card);
}
