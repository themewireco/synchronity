// sdk/mcp/src/cards/markdown.ts
//
// Markdown renderers for MCP card models. Every tool returns a single
// `type: 'text'` block of Markdown — hosts (Claude, ChatGPT, …) render it
// directly, including inline product images via `![](url)`. The CardModel is
// the shared data shape these formatters read from.

import type {
  CardModel,
  ProductCardModel,
  ProductCardAddon,
  ProductListCardModel,
  CartCardModel,
  CheckoutCardModel,
  DelegationCardModel,
} from './types.js';

function stock(inStock: boolean): string {
  return inStock ? 'In stock' : 'Out of stock';
}

/** Escape Markdown table-cell pipes so titles with `|` don't break the table. */
function cell(s: string): string {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim();
}

function addonLines(addons: ProductCardAddon[]): string[] {
  const out: string[] = ['', '**Options**'];
  for (const a of addons) {
    const req = a.required ? ' _(required)_' : ' _(optional)_';
    out.push('', `- **${cell(a.label)}**${req} — \`${a.addonId}\` (${a.type})`);
    if (a.help) out.push(`  ${cell(a.help)}`);
    for (const o of a.options ?? []) {
      const mod = o.priceModifier ? ` (${o.priceModifier})` : '';
      out.push(`  - ${cell(o.label)}${mod} — value \`${o.value}\``);
    }
  }
  return out;
}

function product(m: ProductCardModel): string {
  const lines: string[] = [];
  // Inline image so it renders in the host's response (not just the tool-result panel).
  if (m.image) lines.push(`![${cell(m.title)}](${m.image})`, '');
  lines.push(`**${cell(m.title)}** — ${m.price}  \n${stock(m.inStock)}`);
  if (m.url) lines.push(`[View product](${m.url})`);
  if (m.addons?.length) lines.push(...addonLines(m.addons));
  const hint = m.addons?.length
    ? `_To add to a cart, use \`add_to_cart\` with product_id \`${m.productId}\`, site_id \`${m.siteId}\`, and an \`addons\` map (collect every required option first)._`
    : `_To add to a cart, use \`add_to_cart\` with product_id \`${m.productId}\` and site_id \`${m.siteId}\`._`;
  lines.push('', hint);
  return lines.join('\n');
}

function productList(m: ProductListCardModel): string {
  if (m.products.length === 0) return 'No products matched that search.';
  // Render each product as a block (not a table) so inline images render in the response.
  const blocks = m.products.map((p) => {
    const head = p.url ? `**[${cell(p.title)}](${p.url})**` : `**${cell(p.title)}**`;
    const lines = [head];
    if (p.image) lines.push(`![${cell(p.title)}](${p.image})`);
    lines.push(`${p.price} · ${stock(p.inStock)} · ID \`${p.productId}\``);
    return lines.join('\n');
  });
  return [
    `**${m.products.length} product${m.products.length === 1 ? '' : 's'}** on site \`${m.siteId}\``,
    '',
    blocks.join('\n\n'),
    '',
    '_Use `add_to_cart` with a product ID above to add an item._',
  ].join('\n');
}

function cartLines(items: CartCardModel['items']): string[] {
  if (items.length === 0) return ['_Cart is empty._'];
  return [
    '| Item | Qty | Unit | Line total |',
    '| --- | ---: | ---: | ---: |',
    ...items.map(
      (it) => `| ${cell(it.title)} | ${it.qty} | ${it.unitPrice} | ${it.lineTotal} |`,
    ),
  ];
}

function cart(m: CartCardModel): string {
  return [
    `**Cart** \`${m.cartId}\``,
    '',
    ...cartLines(m.items),
    '',
    `Subtotal: ${m.subtotal}  \n**Total: ${m.total}**`,
  ].join('\n');
}

function checkout(m: CheckoutCardModel): string {
  const out = [`**Checkout** — cart \`${m.cartId}\``, '', ...cartLines(m.items), ''];

  if (m.shippingOptions.length > 0) {
    out.push('**Shipping options**', '', '| Option | Cost | ID |', '| --- | ---: | --- |');
    for (const o of m.shippingOptions) {
      const sel = o.optionId === m.selectedShippingId ? ' ✓' : '';
      const label = o.description ? `${o.label} — ${o.description}` : o.label;
      out.push(`| ${cell(label)}${sel} | ${o.cost} | \`${o.optionId}\` |`);
    }
    out.push('');
    if (!m.selectedShippingId) {
      out.push('_Use `select_shipping_option` with an option ID above._', '');
    }
  }

  out.push(`Subtotal: ${m.subtotal}`);
  if (m.shipping) out.push(`Shipping: ${m.shipping}`);
  out.push(`**Total: ${m.total}**`);
  return out.join('\n');
}

function delegation(m: DelegationCardModel): string {
  const scopeList = m.scopes.length ? m.scopes.map((s) => `- ${s}`).join('\n') : '- (no scopes listed)';
  const head = [`**Approval required for ${m.siteName}**`, '', 'Requested permissions:', scopeList, ''];

  if (m.otpEntry) {
    head.push(
      'A 6-digit approval code was emailed to the buyer.',
      '',
      'Ask the buyer to read the code from their email and tell it to you here, then call `submit_delegation_otp` with this device code and the code.',
      '',
      `Device code: \`${m.deviceCode}\``,
      '',
      '_You cannot approve on their behalf — only the buyer has the code._',
    );
  } else {
    head.push(
      `Share this approval link with the buyer so **they** can approve:`,
      '',
      m.approvalUrl ? `[Approve the request](${m.approvalUrl})` : '_(approval link unavailable)_',
      '',
      `Device code: \`${m.deviceCode}\``,
      '',
      'After they approve, call `check_delegation` with the device code to retrieve the token.',
      '',
      '_You cannot approve for them. Tip: pass the buyer\'s email to `request_delegation` for an in-chat code instead of a link._',
    );
  }
  return head.join('\n');
}

/** Format a MonetaryAmount-ish value defensively (handles missing/partial data). */
function money(m: any): string {
  if (m == null) return '';
  if (typeof m === 'string' || typeof m === 'number') return String(m);
  const sym = m.currency === 'USD' ? '$' : m.currency ? `${m.currency} ` : '';
  return `${sym}${m.amount ?? ''}`.trim();
}

/** Markdown for a single order (order confirmation / get_order). */
export function orderMarkdown(o: any): string {
  if (!o || typeof o !== 'object') return String(o ?? '');
  const out = [`**Order \`${o.order_id ?? '—'}\`** — ${cell(o.status ?? 'unknown')}`];
  const items = Array.isArray(o.items) ? o.items : [];
  if (items.length > 0) {
    out.push(
      '',
      '| Item | Qty | Line total |',
      '| --- | ---: | ---: |',
      ...items.map(
        (it: any) => `| ${cell(it.title ?? it.name ?? '')} | ${it.quantity ?? ''} | ${money(it.line_total)} |`,
      ),
    );
  }
  out.push('', `**Total: ${money(o.total)}**`);
  if (o.tracking_number) out.push(`Tracking: \`${o.tracking_number}\``);
  if (o.estimated_delivery) out.push(`Estimated delivery: ${cell(o.estimated_delivery)}`);
  return out.join('\n');
}

/** Markdown for a list of orders (list_orders). */
export function orderListMarkdown(data: any): string {
  const orders = Array.isArray(data) ? data : data?.orders ?? data?.data ?? [];
  if (!Array.isArray(orders) || orders.length === 0) return 'No orders found.';
  return [
    `**${orders.length} order${orders.length === 1 ? '' : 's'}**`,
    '',
    '| Order | Status | Total | Created |',
    '| --- | --- | ---: | --- |',
    ...orders.map(
      (o: any) =>
        `| \`${o.order_id ?? '—'}\` | ${cell(o.status ?? '')} | ${money(o.total)} | ${cell((o.created_at ?? '').slice(0, 10))} |`,
    ),
  ].join('\n');
}

/** Markdown for the registered-sites list (list_sites). */
export function siteListMarkdown(data: any): string {
  const sites = Array.isArray(data) ? data : data?.sites ?? data?.data ?? [];
  if (!Array.isArray(sites) || sites.length === 0) return 'No connected stores found.';
  return [
    `**${sites.length} connected store${sites.length === 1 ? '' : 's'}**`,
    '',
    '| Store | Platform | Site ID |',
    '| --- | --- | --- |',
    ...sites.map(
      (s: any) => `| ${cell(s.name ?? '')} | ${cell(s.platform ?? '')} | \`${s.id ?? s.site_id ?? ''}\` |`,
    ),
  ].join('\n');
}

/** Render a CardModel as a Markdown text fallback for hosts without widget support. */
export function markdownFallback(model: CardModel): string {
  switch (model.kind) {
    case 'product':
      return product(model);
    case 'productList':
      return productList(model);
    case 'cart':
      return cart(model);
    case 'checkout':
      return checkout(model);
    case 'delegation':
      return delegation(model);
    default: {
      // Exhaustiveness guard — keeps this in sync if a new card kind is added.
      const _never: never = model;
      return JSON.stringify(_never);
    }
  }
}
