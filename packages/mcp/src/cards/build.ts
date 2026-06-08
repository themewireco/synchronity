// sdk/mcp/src/cards/build.ts
import type {
  CardModel, ProductCardModel, CartCardModel, CheckoutCardModel, DelegationCardModel, CartLine, ProductListCardModel, ProductCardAddon,
} from './types.js';

function money(m?: { amount: string; currency: string }): string {
  if (!m) return '';
  const sym = m.currency === 'USD' ? '$' : `${m.currency} `;
  return `${sym}${m.amount}`;
}

/** Map AMPS product addons (snake_case) into the lean card addon shape. */
function buildAddons(raw: any): ProductCardAddon[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((a: any) => ({
    addonId: a.addon_id,
    label: a.label,
    type: a.type,
    required: !!a.required,
    help: a.help ?? undefined,
    options: Array.isArray(a.options)
      ? a.options.map((o: any) => ({
          value: o.value,
          label: o.label,
          priceModifier: o.price_modifier ? `+${money(o.price_modifier)}` : undefined,
        }))
      : undefined,
  }));
}

function lines(cart: any, siteId: string): CartLine[] {
  return (cart.items ?? []).map((it: any) => ({
    itemId: it.item_id,
    title: it.title,
    qty: it.quantity,
    unitPrice: money(it.unit_price),
    lineTotal: money(it.line_total),
    removeAction: {
      label: 'Remove',
      toolName: 'remove_from_cart',
      params: { site_id: siteId, cart_id: cart.cart_id, item_id: it.item_id },
    },
  }));
}

export function buildProductCard(p: any, siteId: string, cartId?: string): ProductCardModel {
  // add_to_cart requires cart_id. During browse no cart exists yet, so cart_id is
  // included only when a cart context is known; otherwise the host must create a
  // cart (create_cart) and merge cart_id into the action params (see CARDS.md).
  return {
    kind: 'product',
    siteId,
    productId: p.product_id,
    title: p.title,
    price: money(p.price),
    image: p.image_url ?? p.images?.[0]?.url ?? undefined,
    url: p.url ?? undefined,
    inStock: p.availability === 'in_stock',
    addons: buildAddons(p.addons),
    addToCart: { label: 'Add to cart', toolName: 'add_to_cart',
      params: { site_id: siteId, product_id: p.product_id, quantity: 1, ...(cartId ? { cart_id: cartId } : {}) } },
  };
}

export function buildCartCard(cart: any, siteId: string): CartCardModel {
  return {
    kind: 'cart',
    siteId,
    cartId: cart.cart_id,
    items: lines(cart, siteId),
    subtotal: money(cart.subtotal),
    total: money(cart.total),
  };
}

export function buildCheckoutCard(cart: any, siteId: string): CheckoutCardModel {
  return {
    kind: 'checkout',
    siteId,
    cartId: cart.cart_id,
    items: lines(cart, siteId),
    shippingOptions: (cart.shipping_options ?? []).map((o: any) => ({
      optionId: o.option_id, label: o.title, description: o.description, cost: money(o.cost),
    })),
    selectedShippingId: cart.selected_shipping_option_id,
    subtotal: money(cart.subtotal),
    shipping: cart.shipping_total ? money(cart.shipping_total) : undefined,
    total: money(cart.total),
  };
}

export function buildDelegationCard(d: any): DelegationCardModel {
  return {
    kind: 'delegation',
    deviceCode: d.device_code,
    userCode: d.user_code,
    siteName: d.siteName ?? 'Connected Store',
    scopes: d.scopes ?? [],
    approvalUrl: d.approvalUrl,
    otpEntry: !!d.otp,
  };
}

export function buildProductListCard(products: any[], siteId: string): ProductListCardModel {
  return {
    kind: 'productList',
    siteId,
    products: (products ?? []).map((p) => ({
      productId: p.product_id,
      title: p.title,
      price: money(p.price),
      image: p.image_url ?? p.images?.[0]?.url ?? undefined,
      url: p.url ?? undefined,
      inStock: p.availability === 'in_stock',
      addToCart: { label: 'Add to cart', toolName: 'add_to_cart',
        params: { site_id: siteId, product_id: p.product_id, quantity: 1 } },
    })),
  };
}

export type { CardModel };
