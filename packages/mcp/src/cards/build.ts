// sdk/mcp/src/cards/build.ts
import type {
  CardModel, ProductCardModel, CartCardModel, CheckoutCardModel, DelegationCardModel, CartLine, ProductListCardModel, ProductCardAddon, ProductCardVariant,
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

/** Summarise selected addons on a cart item as "Label: value, value2" lines. */
function addonsSummary(raw: any): string | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const parts = raw
    .map((a: any) => {
      const label = a.label ?? a.name ?? a.addon_id ?? '';
      const val = Array.isArray(a.values)
        ? a.values.map((v: any) => v?.label ?? v?.value ?? v).join(', ')
        : a.value_label ?? a.value ?? '';
      return label && val ? `${label}: ${val}` : label || String(val);
    })
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : undefined;
}

function lines(cart: any, siteId: string): CartLine[] {
  return (cart.items ?? []).map((it: any) => ({
    itemId: it.item_id,
    title: it.title,
    qty: it.quantity,
    unitPrice: money(it.unit_price),
    lineTotal: money(it.line_total),
    image: it.image_url ?? it.image ?? undefined,
    variantTitle: it.variant_title ?? undefined,
    addonsSummary: addonsSummary(it.addons),
    removeAction: {
      label: 'Remove',
      toolName: 'remove_from_cart',
      params: { site_id: siteId, cart_id: cart.cart_id, item_id: it.item_id },
    },
  }));
}

/** Strip HTML to a short plain-text snippet for the card (avoids dumping full product
 *  descriptions — allergen lists, sizing tables, broken inline images — into the View). */
function shortDescription(raw?: string): string | undefined {
  if (!raw) return undefined;
  const text = String(raw)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return undefined;
  return text.length > 200 ? `${text.slice(0, 200).trimEnd()}…` : text;
}

/** Collect product image URLs (AMPS `images[].url` or single `image_url`), de-duped, first = primary. */
function productImages(p: any): string[] {
  const urls = Array.isArray(p.images)
    ? p.images.map((i: any) => (typeof i === 'string' ? i : i?.url)).filter(Boolean)
    : [];
  if (p.image_url && !urls.includes(p.image_url)) urls.unshift(p.image_url);
  return [...new Set(urls)] as string[];
}

export function buildProductCard(p: any, siteId: string, cartId?: string): ProductCardModel {
  // add_to_cart requires cart_id. During browse no cart exists yet, so cart_id is
  // included only when a cart context is known; otherwise the host must create a
  // cart (create_cart) and merge cart_id into the action params (see CARDS.md).
  const images = productImages(p);
  return {
    kind: 'product',
    siteId,
    productId: p.product_id,
    title: p.title,
    description: shortDescription(p.short_description ?? p.description),
    price: money(p.price),
    image: images[0],
    images: images.length > 0 ? images : undefined,
    url: p.url ?? undefined,
    inStock: p.availability === 'in_stock',
    addons: buildAddons(p.addons),
    variants: buildVariants(p.variants),
    addToCart: { label: 'Add to cart', toolName: 'add_to_cart',
      params: { site_id: siteId, product_id: p.product_id, quantity: 1, ...(cartId ? { cart_id: cartId } : {}) } },
  };
}

/** Map AMPS product variants into the lean card variant shape (undefined when none). */
function buildVariants(raw: any): ProductCardVariant[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((v: any) => ({
    variantId: v.variant_id,
    title: v.title,
    price: money(v.price),
    image: v.image_url ?? undefined,
    inStock: v.availability ? v.availability === 'in_stock' : true,
    attributes: Array.isArray(v.attributes)
      ? v.attributes.map((a: any) => ({ name: a.name ?? a.key ?? '', value: a.value ?? '' }))
      : undefined,
  }));
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

export function buildProductListCard(products: any[], siteId: string, siteName?: string): ProductListCardModel {
  return {
    kind: 'productList',
    siteId,
    siteName,
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
