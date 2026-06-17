/**
 * Synchronity MCP Tool Implementations
 *
 * All 15 tools mapped to Synchronity SDK client methods:
 * 1. list_sites
 * 2. search_products
 * 3. get_product
 * 4. get_product_reviews
 * 5. compare_products
 * 6. create_cart
 * 7. add_to_cart
 * 8. remove_from_cart
 * 9. apply_coupon
 * 10. get_cart
 * 11. execute_checkout
 * 12. get_order
 * 13. list_orders
 * 14. request_delegation
 * 15. check_delegation
 */

import type { Synchronity } from '@synchronity/sdk';
import type { Tool, TextContent } from '@modelcontextprotocol/sdk/types.js';
import type { MCPServerConfig } from './config.js';
import type { MCPContent } from './types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { toLeanProduct } from './dto.js';
import { textResult, cardResult } from './cards/renderCard.js';
import { buildProductCard, buildProductListCard, buildCartCard, buildCheckoutCard, buildDelegationCard, buildMultiCartCard } from './cards/build.js';
import { markdownFallback, orderMarkdown, orderListMarkdown, siteListMarkdown } from './cards/markdown.js';
import { rememberSiteNames, siteNameFor } from './cards/siteNames.js';
import { inlineCardImages } from './cards/inlineImages.js';
import {
  formatPaymentSessionMarkdown,
  normalizeGhanaPhone,
  normalizeMobileMoneyProvider,
} from './paymentNormalize.js';

/** Tool result shape: a content array of Markdown text blocks. */
export interface ToolResult { content: MCPContent[] }

export type ToolImplementation = (
  client: Synchronity,
  args: Record<string, unknown>,
  config: MCPServerConfig,
  server?: Server
) => Promise<string | MCPContent[] | ToolResult>;

/**
 * Tool: Search products on a site
 */
export const searchProducts: ToolImplementation = async (client, args) => {
  const { site_id, query, queries, category, min_price, max_price, in_stock, page = 1, per_page = 20 } = args;

  // query is OPTIONAL: omit it to browse the store's full catalog. Only site_id
  // is required. Passing an empty/whitespace query is treated as a browse.
  if (!site_id) {
    throw new Error('site_id is required');
  }

  const filters = {
    category: category as string | undefined,
    min_price: min_price as number | undefined,
    max_price: max_price as number | undefined,
    in_stock: in_stock as boolean | undefined,
    page: page as number,
    limit: per_page as number,
  };

  // @synchronity/sdk's products.search() returns { products, total, page, total_pages };
  // keep `data` as a defensive fallback for the raw paginated API shape.
  const extractProducts = (results: unknown): any[] => {
    const r = results as { products?: Array<unknown>; data?: Array<unknown> };
    return (r.products ?? r.data ?? []) as any[];
  };

  // BATCH: several product names in one call. Search per query, flatten + dedupe
  // by product_id, and summarise per-query matches in the card text.
  const queryList = Array.isArray(queries)
    ? (queries as string[]).map((q) => String(q).trim()).filter(Boolean)
    : [];
  if (queryList.length > 0) {
    const seen = new Set<string>();
    const merged: any[] = [];
    const summary: string[] = [];
    for (const q of queryList) {
      let found: any[] = [];
      try {
        found = extractProducts(await client.products.search(site_id as string, { q, ...filters }));
      } catch (err) {
        summary.push(`"${q}": search failed${err instanceof Error ? ` (${err.message})` : ''}`);
        continue;
      }
      if (found.length === 0) {
        summary.push(`"${q}": no match`);
        continue;
      }
      summary.push(`"${q}": ${found.length} match${found.length === 1 ? '' : 'es'}`);
      for (const p of found) {
        const id = String(p.product_id ?? p.id ?? '');
        if (id && seen.has(id)) continue;
        if (id) seen.add(id);
        merged.push(p);
      }
    }
    const listModel = buildProductListCard(merged, site_id as string, siteNameFor(site_id as string));
    const card = cardResult(await inlineCardImages(listModel));
    const note = `Search matches — ${summary.join('; ')}.`;
    card.content = [{ type: 'text', text: `${(card.content?.[0] as any)?.text ?? ''}\n\n_${note}_` }];
    return card;
  }

  // SINGLE / BROWSE: unchanged behavior.
  const trimmedQuery = typeof query === 'string' ? query.trim() : '';
  const results = await client.products.search(site_id as string, {
    q: trimmedQuery ? trimmedQuery : undefined,
    ...filters,
  });
  const listModel = buildProductListCard(extractProducts(results), site_id as string, siteNameFor(site_id as string));
  return cardResult(await inlineCardImages(listModel));
};

/**
 * Tool: Get product details
 */
export const getProduct: ToolImplementation = async (client, args) => {
  const { site_id, product_id } = args;

  if (!site_id || !product_id) {
    throw new Error('site_id and product_id are required');
  }

  const product = await client.products.getById(site_id as string, product_id as string);
  const productModel = buildProductCard(product as any, site_id as string);
  return cardResult(await inlineCardImages(productModel));
};

/**
 * Tool: Compare products across sites
 */
export const compareProducts: ToolImplementation = async (client, args) => {
  const { site_ids, query, min_price, max_price, in_stock } = args;

  if (!site_ids || !Array.isArray(site_ids) || !query) {
    throw new Error('site_ids (array) and query are required');
  }

  const comparison = await client.products.compare(site_ids as string[], {
    q: query as string,
    min_price: min_price as number | undefined,
    max_price: max_price as number | undefined,
    in_stock: in_stock as boolean | undefined,
  });

  const c = comparison as { results?: Array<{ products?: unknown[] }> };
  const leanResults = c.results?.map((r) => ({ ...r, products: (r.products ?? []).map((p) => toLeanProduct(p as any)) }));
  const structured = { ...(comparison as object), results: leanResults ?? (comparison as any).results };

  // Human-readable per-store summary; structuredContent keeps the full lean data.
  const lines: string[] = [`**Comparing "${query}" across ${(leanResults ?? []).length} store(s):**`, ''];
  for (const r of (leanResults ?? []) as Array<any>) {
    const storeName = siteNameFor(String(r.site_id ?? '')) || r.site_name || r.site_id || 'Store';
    const prods = (r.products ?? []) as Array<any>;
    lines.push(`**${storeName}**`);
    if (prods.length === 0) {
      lines.push('- No matches');
    } else {
      for (const p of prods.slice(0, 5)) {
        const price = p.price ? `${p.price.currency ?? ''} ${p.price.amount ?? ''}`.trim() : '';
        lines.push(`- ${p.title}${price ? ` — ${price}` : ''}`);
      }
      if (prods.length > 5) lines.push(`- …and ${prods.length - 5} more`);
    }
    lines.push('');
  }
  return { content: [{ type: 'text', text: lines.join('\n').trimEnd() }], structuredContent: structured };
};

/** True if an error from the gateway means the cart no longer exists (expired/consumed). */
function isCartNotFound(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes('cart not found') || msg.includes('404');
}

/**
 * Tool: Create a new cart
 */
export const createCart: ToolImplementation = async (client, args) => {
  const { site_id, currency } = args;

  if (!site_id) {
    throw new Error('site_id is required');
  }

  const cart = await client.cart.create(site_id as string, currency as string | undefined);
  const cartId = (cart as any)?.cart_id ?? '';
  return {
    content: [{ type: 'text', text: `New cart created${cartId ? ` (ID: \`${cartId}\`)` : ''}. Add items with add_to_cart.` }],
    structuredContent: cart,
  };
};

/**
 * Tool: Add item(s) to cart
 * Accepts either a single product (product_id + quantity, back-compat) or an
 * items[] array so multiple products can be added in ONE tool call.
 */
export const addToCart: ToolImplementation = async (client, args) => {
  const { site_id, product_id, quantity, variant_id, addons, email, items } = args as any;
  let cart_id = args.cart_id as string | undefined;
  if (!site_id) throw new Error('site_id is required');

  const itemList: AddItemInput[] = Array.isArray(items) && items.length > 0
    ? items
    : (product_id && quantity
        ? [{ product_id, quantity, variant_id, ...(addons ? { addons } : {}) }]
        : []);
  if (itemList.length === 0) {
    throw new Error('Provide either items[] or product_id + quantity');
  }

  // Ensure a cart exists (resume in-progress, else create) — unchanged behavior.
  if (!cart_id) {
    const active = await client.cart.getActive(site_id as string).catch(() => null);
    cart_id = active && (active as any).cart_id
      ? (active as any).cart_id
      : (await client.cart.create(site_id as string)).cart_id;
  }

  let { cart, warnings } = await addItemsWithStockCheck(
    client as any, site_id as string, cart_id as string, itemList, { email: email as string | undefined },
  );

  // A supplied cart_id may be stale (cart expired/consumed after a prior checkout in the same
  // session). The helper records that as add_failed warnings carrying the error message; detect
  // it, resume/create a fresh cart, and retry the batch once — preserving the old retry semantics.
  if (warnings.some((w) => w.reason === 'add_failed' && isCartNotFound(w.message ?? ''))) {
    const active = await client.cart.getActive(site_id as string).catch(() => null);
    cart_id = active && (active as any).cart_id
      ? (active as any).cart_id
      : (await client.cart.create(site_id as string)).cart_id;
    ({ cart, warnings } = await addItemsWithStockCheck(
      client as any, site_id as string, cart_id as string, itemList, { email: email as string | undefined },
    ));
  }

  const cartModel = buildCartCard(cart as any, site_id as string);
  const card = cardResult(await inlineCardImages(cartModel));
  if (warnings.length > 0) {
    const note = warnings.map((w) =>
      w.reason === 'out_of_stock'
        ? `${w.product_id} is out of stock${w.restock_armed ? " — I'll email you when it's back" : ''}`
        : `${w.product_id} could not be added${w.message ? ` (${w.message})` : ''}`,
    ).join('; ');
    card.content = [{ type: 'text', text: `${(card.content?.[0] as any)?.text ?? ''}\n\n_Note: ${note}._` }];
  }
  return card;
};

/**
 * Tool: Remove item from cart
 */
export const removeFromCart: ToolImplementation = async (client, args) => {
  const { site_id, cart_id, item_id } = args;

  if (!site_id || !cart_id || !item_id) {
    throw new Error('site_id, cart_id, and item_id are required');
  }

  const updatedCart = await client.cart.removeItem(site_id as string, cart_id as string, item_id as string);
  const c = updatedCart as any;
  const cartModel = buildCartCard(c, site_id as string);
  return cardResult(await inlineCardImages(cartModel));
};

/**
 * Tool: Set a cart line's quantity (live, server-side; checkout reads the server cart).
 */
export const setCartQuantity: ToolImplementation = async (client, args) => {
  const { site_id, cart_id, item_id, quantity } = args;

  if (!site_id || !cart_id || !item_id || quantity == null) {
    throw new Error('site_id, cart_id, item_id, and quantity are required');
  }
  const qty = Number(quantity);
  if (!Number.isInteger(qty) || qty < 0) {
    throw new Error('quantity must be a non-negative integer');
  }

  const updatedCart = await client.cart.setItemQuantity(
    site_id as string,
    cart_id as string,
    item_id as string,
    qty,
  );
  const cartModel = buildCartCard(updatedCart as any, site_id as string);
  return cardResult(await inlineCardImages(cartModel));
};

/**
 * Tool: Apply coupon to cart
 */
export const applyCoupon: ToolImplementation = async (client, args) => {
  const { site_id, cart_id, code } = args;

  if (!site_id || !cart_id || !code) {
    throw new Error('site_id, cart_id, and code are required');
  }

  let updatedCart;
  try {
    updatedCart = await client.cart.applyCoupon(site_id as string, cart_id as string, code as string);
  } catch (err) {
    // Surface a human-readable message (the View shows it as a toast), not raw JSON.
    const msg = (err as any)?.error?.message ?? (err instanceof Error ? err.message : String(err));
    throw new Error(String(msg));
  }
  const cartModel = buildCartCard(updatedCart as any, site_id as string);
  return cardResult(await inlineCardImages(cartModel));
};

/**
 * Tool: Get cart contents
 */
export const getCart: ToolImplementation = async (client, args) => {
  const site_id = args.site_id as string | undefined;
  const cart_id = args.cart_id as string | undefined;

  if (!site_id || !cart_id) {
    throw new Error('site_id and cart_id are required');
  }

  const cart = await client.cart.get(site_id, cart_id);
  const c = cart as any;
  const cartModel = buildCartCard(c, site_id);
  return cardResult(await inlineCardImages(cartModel));
};

/**
 * Tool: Get active (in-progress) cart for a site — resumes a shopping conversation.
 */
export const getActiveCart: ToolImplementation = async (client, args) => {
  const site_id = args.site_id as string | undefined;
  if (!site_id) throw new Error('site_id is required');

  const result = await client.cart.getActive(site_id);
  const c = result as any;
  if (!c || !c.cart_id) {
    return textResult('No active cart found for this store yet — add an item with add_to_cart to start one.');
  }
  const cartModel = buildCartCard(c, site_id);
  return cardResult(await inlineCardImages(cartModel));
};

export const executeCheckout: ToolImplementation = async (client, args) => {
  const {
    site_id,
    cart_id,
    buyer_delegation_token,
    customer_name,
    customer_email,
    customer_phone,
    shipping_name,
    shipping_line1,
    shipping_line2,
    shipping_city,
    shipping_state,
    shipping_postal_code,
    shipping_country,
    shipping_phone,
    notes,
  } = args;

  const required = [
    'site_id',
    'cart_id',
    'buyer_delegation_token',
    'customer_name',
    'customer_email',
    'customer_phone',
    'shipping_name',
    'shipping_line1',
    'shipping_city',
    'shipping_state',
    'shipping_postal_code',
    'shipping_country',
  ];
  for (const field of required) {
    if (!args[field]) {
      throw new Error(`${field} is required`);
    }
  }

  const order = await client.checkout.execute(site_id as string, {
    cart_id: cart_id as string,
    buyer_delegation_token: buyer_delegation_token as string,
    customer_name: customer_name as string,
    customer_email: customer_email as string,
    customer_phone: customer_phone as string | undefined,
    notes: notes as string | undefined,
    shipping_address: {
      name: shipping_name as string,
      line1: shipping_line1 as string,
      line2: shipping_line2 as string | undefined,
      city: shipping_city as string,
      state: shipping_state as string,
      postal_code: shipping_postal_code as string,
      country: shipping_country as string,
      phone: (shipping_phone ?? customer_phone) as string | undefined,
    },
  });

  return {
    content: [{ type: 'text', text: `Order placed.\n\n${orderMarkdown(order)}\n\n_To pay, use \`get_payment_methods\` then \`initiate_payment\` with order_id \`${(order as any).order_id}\`._` }],
    structuredContent: order,
  };
};

/**
 * Tool: Get order details
 */
export const getOrder: ToolImplementation = async (client, args) => {
  const { site_id, order_id, buyer_delegation_token } = args;

  if (!site_id || !order_id) {
    throw new Error('site_id and order_id are required');
  }

  // Orders are buyer-private; pass the buyer's delegation token so the gateway
  // confirms the caller owns this order.
  const order = await client.orders.get(site_id as string, order_id as string, buyer_delegation_token as string | undefined);
  // Dual output: markdown text (fallback for non-View hosts) + the order as
  // structuredContent so the View can render the status in-frame after checkout.
  return { content: [{ type: 'text', text: orderMarkdown(order) }], structuredContent: order };
};

/**
 * Tool: List orders
 */
export const listOrders: ToolImplementation = async (client, args) => {
  const { site_id, status, page = 1, limit = 20, buyer_delegation_token } = args;

  if (!site_id) {
    throw new Error('site_id is required');
  }

  const orders = await client.orders.list(site_id as string, {
    status: status as 'pending' | 'processing' | 'completed' | 'cancelled' | 'refunded' | undefined,
    page: page as number,
    limit: limit as number,
  }, buyer_delegation_token as string | undefined);

  return orderListMarkdown(orders);
};

/**
 * Tool: List registered sites (so Claude can resolve site names to IDs)
 */
export const listSites: ToolImplementation = async (client, args, config) => {
  const base = (config.gatewayUrl ?? '').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/sites`, {
    headers: { Authorization: `Bearer ${config.ait}` },
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(JSON.stringify(data));
  rememberSiteNames(data);   // cache id -> name for human-readable output elsewhere
  return siteListMarkdown(data);
};

/**
 * Tool: Request human delegation (device flow initiation)
 */
export const requestDelegation: ToolImplementation = async (client, args, config, server) => {
  const { site_id, scopes, email, marketing_opt_in } = args;
  if (!site_id) throw new Error('site_id is required');
  const resolvedScopes = Array.isArray(scopes) && scopes.length > 0
    ? scopes
    : ['read_products', 'manage_cart', 'execute_checkout', 'read_orders'];

  const base = (config.gatewayUrl ?? '').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/auth/delegate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ait}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      site_id,
      scopes: resolvedScopes,
      ...(email ? { email } : {}),
      ...(marketing_opt_in === true ? { marketing_opt_in: true } : {}),
    }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    // Surface a human-readable message, not a raw JSON dump.
    const msg = (data as any)?.error?.message ?? (data as any)?.message ?? `Delegation request failed (HTTP ${res.status}).`;
    throw new Error(String(msg));
  }

  const device_code = data.device_code as string;

  // Email-OTP path: the buyer gets a code by email; the agent never sees it.
  if (data.delivery === 'email') {
    const delegationModel = buildDelegationCard({
      device_code,
      user_code: (data.user_code as string) ?? '',
      scopes: resolvedScopes.map(scopeToLabel),
      siteName: 'Connected Store',
      approvalUrl: '',
      otp: true,
    });
    const expiresNote = data.expires_in ? `\n\n_This code expires in ${data.expires_in} seconds._` : '';
    return {
      content: [{ type: 'text', text: markdownFallback(delegationModel) + expiresNote }],
      structuredContent: { device_code, user_code: data.user_code, delivery: 'email' },
    };
  }

  // Link fallback (no email supplied or email transport unavailable).
  // Human approval MUST happen out-of-band on a channel the agent does not control.
  const approvalUrl = `${data.verification_uri}?user_code=${encodeURIComponent(data.user_code as string)}`;
  const delegationModel = buildDelegationCard({
    device_code,
    user_code: (data.user_code as string) ?? '',
    scopes: resolvedScopes.map(scopeToLabel),
    siteName: 'Connected Store',
    approvalUrl,
    otp: false,
  });
  const expiresNote = data.expires_in ? `\n\n_This link expires in ${data.expires_in} seconds._` : '';
  return {
    content: [{ type: 'text', text: markdownFallback(delegationModel) + expiresNote }],
    structuredContent: { device_code, user_code: data.user_code, delivery: 'link', approvalUrl },
  };
};

/**
 * Tool: Submit the email OTP the buyer received, to approve a delegation in-chat.
 */
export const submitDelegationOtp: ToolImplementation = async (client, args, config) => {
  const { device_code, code } = args;
  if (!device_code) throw new Error('device_code is required');
  if (!code) throw new Error('code is required');

  const base = (config.gatewayUrl ?? '').replace(/\/$/, '');
  const res = await fetch(`${base}/v1/auth/delegate/otp/verify`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.ait}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ device_code, code: String(code) }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(JSON.stringify(data));

  const payload = {
    status: data.status,
    delegation_token: data.delegation_token,
    expires_at: data.expires_at,
    message: 'Approved. Use delegation_token as buyer_delegation_token for checkout and payment.',
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
};

/**
 * Tool: Check delegation approval status and retrieve token
 */
export const checkDelegation: ToolImplementation = async (client, args, config) => {
  const { device_code } = args;
  if (!device_code) throw new Error('device_code is required');

  const base = (config.gatewayUrl ?? '').replace(/\/$/, '');
  const res = await fetch(
    `${base}/v1/auth/delegate/status?device_code=${encodeURIComponent(device_code as string)}`,
    {
      headers: { Authorization: `Bearer ${config.ait}` },
    },
  );
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) {
    const msg = (data as any)?.error?.message ?? (data as any)?.message ?? `Could not check delegation status (HTTP ${res.status}).`;
    throw new Error(String(msg));
  }

  if (data.status === 'approved' && data.ait) {
    return {
      content: [{ type: 'text', text: 'Approved ✓ — the buyer authorized this. Proceeding to checkout/payment.' }],
      structuredContent: { status: 'approved', delegation_token: data.ait },
    };
  }

  const msg = data.status === 'pending'
    ? 'Not approved yet — waiting on the buyer. Poll again in a few seconds.'
    : `Delegation status: ${data.status}.`;
  return {
    content: [{ type: 'text', text: msg }],
    structuredContent: { status: data.status },
  };
};

/**
 * Tool: Get product reviews and authenticity consensus
 */
export const getProductReviews: ToolImplementation = async (client, args) => {
  const { site_id, product_id, limit = 10, page = 1 } = args;

  if (!site_id || !product_id) {
    throw new Error('site_id and product_id are required');
  }

  const reviews = await client.reviews.getProductReviews(site_id as string, product_id as string, {
    limit: limit as number,
    page: page as number,
  });

  const r = reviews as any;
  const cons = r?.authenticity_consensus ?? {};
  const list = (r?.reviews ?? r?.data ?? []) as Array<any>;
  const lines: string[] = ['**Reviews & authenticity**', ''];
  if (cons.average_rating != null) lines.push(`Average rating: ${cons.average_rating}★`);
  if (cons.trust_score != null) lines.push(`Trust score: ${Math.round(Number(cons.trust_score) * 100)}%`);
  if (cons.verified_percentage != null) lines.push(`Verified purchases: ${cons.verified_percentage}%`);
  if (Array.isArray(cons.flags) && cons.flags.length > 0) lines.push(`⚠ Flags: ${cons.flags.join(', ')}`);
  if (list.length > 0) {
    lines.push('', '**Recent reviews:**');
    for (const rv of list.slice(0, 5)) {
      const rating = rv.rating != null ? `${rv.rating}★ ` : '';
      const verified = rv.verified_purchase ? ' _(verified)_' : '';
      const body = String(rv.body ?? rv.text ?? rv.comment ?? '').slice(0, 160);
      lines.push(`- ${rating}${body}${verified}`);
    }
  } else {
    lines.push('', '_No reviews yet._');
  }
  return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: reviews };
};

/**
 * Tool: Request a back-in-stock alert for an out-of-stock product.
 */
export const requestBackInStock: ToolImplementation = async (client, args) => {
  const { site_id, product_id, variant_id, email, product_title } = args;

  if (!site_id || !product_id) {
    throw new Error('site_id and product_id are required');
  }

  const result = await client.products.notifyRestock(site_id as string, product_id as string, {
    ...(variant_id ? { variant_id: variant_id as string } : {}),
    ...(email ? { email: email as string } : {}),
    ...(product_title ? { product_title: product_title as string } : {}),
  });

  const r = result as any;
  const name = (product_title as string) || 'this item';
  const text = r?.will_email
    ? `Done — we'll email you when ${name} is back in stock.`
    : (r?.message ?? `Noted: your interest in ${name} was recorded. Add an email to get a restock alert.`);
  return { content: [{ type: 'text', text: String(text) }], structuredContent: result };
};

/** Tool: Set the cart's shipping destination and return available rates */
export const setShippingAddress: ToolImplementation = async (client, args) => {
  const { site_id, cart_id, country_code, postal_code, state, city } = args;
  if (!site_id || !cart_id || !country_code) {
    throw new Error('site_id, cart_id, and country_code are required');
  }
  const cart = await client.cart.setShippingAddress(site_id as string, cart_id as string, {
    country_code: country_code as string,
    postal_code: postal_code as string | undefined,
    state: state as string | undefined,
    city: city as string | undefined,
  });
  const checkoutModel = await inlineCardImages(buildCheckoutCard(cart as any, site_id as string));
  return {
    content: [{ type: 'text', text: markdownFallback(checkoutModel) }],
    structuredContent: checkoutModel,
  };
};

/** Resolve a site_id from the tool args, falling back to the DEFAULT_SITE_ID env var. */
function resolveSiteId(args: Record<string, unknown>): string {
  const siteId = (args.site_id as string | undefined) ?? process.env.DEFAULT_SITE_ID;
  if (!siteId) {
    throw new Error('site_id is required (no DEFAULT_SITE_ID configured)');
  }
  return siteId;
}

/**
 * Tool: List available payment channels for an order.
 * First step of the in-chat payment flow.
 */
export const getPaymentMethods: ToolImplementation = async (client, args) => {
  const siteId = resolveSiteId(args);
  const { order_id } = args;
  if (!order_id) throw new Error('order_id is required');

  const methods = await client.payments.getMethods(siteId, order_id as string);
  const labels = (methods as { mobile_money_provider_labels?: Record<string, string> })
    .mobile_money_provider_labels;
  const labelHint =
    labels && Object.keys(labels).length > 0
      ? `\n\n**Mobile money providers:** ${Object.entries(labels)
          .map(([code, label]) => `${label} (\`${code}\`)`)
          .join(', ')}`
      : '';
  return {
    content: [{ type: 'text', text: JSON.stringify(methods) + labelHint }],
    structuredContent: methods,
  };
};

export const initiatePayment: ToolImplementation = async (client, args) => {
  const siteId = resolveSiteId(args);
  const { order_id, channel, phone, provider, gateway, buyer_delegation_token } = args;
  if (!order_id) throw new Error('order_id is required');
  if (channel !== 'mobile_money' && channel !== 'card') {
    throw new Error('channel must be "mobile_money" or "card"');
  }
  if (channel === 'mobile_money' && (!phone || !provider)) {
    throw new Error('phone and provider are required for mobile_money');
  }

  let normalizedProvider: 'mtn' | 'vod' | 'tgo' | undefined;
  if (channel === 'mobile_money') {
    normalizedProvider = normalizeMobileMoneyProvider(provider as string);
    if (!normalizedProvider) {
      throw new Error(
        'provider must be mtn, vod, or tgo (aliases: telecel/vodafone → vod, airteltigo/tigo → tgo)',
      );
    }
  }

  const session = await client.payments.initiate(siteId, order_id as string, {
    channel: channel as 'mobile_money' | 'card',
    phone: channel === 'mobile_money' ? normalizeGhanaPhone(phone as string) : undefined,
    provider: normalizedProvider,
    ...(gateway ? { gateway: gateway as 'paystack' | 'stripe' } : {}),
    buyer_delegation_token: buyer_delegation_token as string | undefined,
  });
  return {
    content: [{ type: 'text', text: formatPaymentSessionMarkdown(session as any) }],
    structuredContent: session,
  };
};

export const submitPaymentOtp: ToolImplementation = async (client, args) => {
  const siteId = resolveSiteId(args);
  const { order_id, otp, buyer_delegation_token } = args;
  if (!order_id) throw new Error('order_id is required');
  if (!otp) throw new Error('otp is required');

  const session = await client.payments.submitOtp(siteId, order_id as string, {
    otp: otp as string,
    buyer_delegation_token: buyer_delegation_token as string | undefined,
  });
  return {
    content: [{ type: 'text', text: formatPaymentSessionMarkdown(session as any) }],
    structuredContent: session,
  };
};

export const getPaymentStatus: ToolImplementation = async (client, args) => {
  const siteId = resolveSiteId(args);
  const { order_id } = args;
  if (!order_id) throw new Error('order_id is required');

  const session = await client.payments.getStatus(siteId, order_id as string);
  return {
    content: [{ type: 'text', text: formatPaymentSessionMarkdown(session as any) }],
    structuredContent: session,
  };
};

/** Tool: Select a shipping option, binding it to the cart total */
export const selectShippingOption: ToolImplementation = async (client, args) => {
  const { site_id, cart_id, option_id } = args;
  if (!site_id || !cart_id || !option_id) {
    throw new Error('site_id, cart_id, and option_id are required');
  }
  const cart = await client.cart.selectShippingOption(site_id as string, cart_id as string, option_id as string);
  const checkoutModel = await inlineCardImages(buildCheckoutCard(cart as any, site_id as string));
  return {
    content: [{ type: 'text', text: markdownFallback(checkoutModel) }],
    structuredContent: checkoutModel,
  };
};

// ── addItemsWithStockCheck ───────────────────────────────────────────────────

export interface AddItemInput {
  product_id: string;
  quantity: number;
  variant_id?: string;
  addons?: Record<string, string | string[] | boolean | number>;
}

export interface CartWarning {
  product_id: string;
  reason: 'out_of_stock' | 'add_failed';
  restock_armed: boolean;
  /** Underlying error message for a non-stock `add_failed` (surfaceable to the buyer). */
  message?: string;
}

/**
 * Add items to a cart one at a time so each item's outcome is known. On a failed add,
 * check the product's availability; if out of stock, record a warning and (when an email
 * is given) arm a back-in-stock alert. Other failures become a plain warning. Never throws
 * for a single bad item — returns the latest cart + the collected warnings.
 */
export async function addItemsWithStockCheck(
  client: any,
  siteId: string,
  cartId: string,
  items: AddItemInput[],
  opts: { email?: string },
): Promise<{ cart: any; warnings: CartWarning[] }> {
  const warnings: CartWarning[] = [];
  let cart: any;
  for (const item of items) {
    const payload = {
      product_id: item.product_id,
      quantity: item.quantity,
      variant_id: item.variant_id,
      ...(item.addons ? { addons: item.addons } : {}),
    };
    try {
      cart = await client.cart.addItem(siteId, cartId, payload);
    } catch (addErr) {
      let availability: string | undefined;
      let title: string | undefined;
      try {
        const product = await client.products.getById(siteId, item.product_id);
        availability = product?.availability;
        title = product?.title;
      } catch {
        // getById failed — fall through to a generic add_failed warning.
      }
      if (availability === 'out_of_stock') {
        let armed = false;
        if (opts.email) {
          try {
            await client.products.notifyRestock(siteId, item.product_id, {
              email: opts.email,
              ...(item.variant_id ? { variant_id: item.variant_id } : {}),
              ...(title ? { product_title: title } : {}),
            });
            armed = true;
          } catch {
            armed = false; // best-effort; never abort the cart build
          }
        }
        warnings.push({ product_id: item.product_id, reason: 'out_of_stock', restock_armed: armed });
      } else {
        warnings.push({
          product_id: item.product_id,
          reason: 'add_failed',
          restock_armed: false,
          message: addErr instanceof Error ? addErr.message : String(addErr),
        });
      }
    }
  }
  if (!cart) {
    // Honor the no-throw contract even if the cart itself is gone.
    cart = await client.cart.get(siteId, cartId).catch(() => null);
  }
  return { cart, warnings };
}

/**
 * Tool: Assemble checkout-ready cart(s) in one call, grouping items by site_id.
 * Single store → returns a checkout card; multi-store → returns a multiCart card.
 */
export const quickCheckout: ToolImplementation = async (client, args) => {
  const items = (args as any).items as Array<{ site_id: string } & AddItemInput>;
  const shipping = (args as any).shipping_address as { country_code: string; postal_code?: string; state?: string; city?: string };
  const customer = (args as any).customer as { name?: string; email?: string; phone?: string } | undefined;
  if (!Array.isArray(items) || items.length === 0) throw new Error('items[] is required');
  if (!shipping?.country_code) throw new Error('shipping_address.country_code is required');

  // Group items by site_id (one cart per store).
  const bySite = new Map<string, AddItemInput[]>();
  for (const it of items) {
    if (!it.site_id) throw new Error('each item needs a site_id');
    const list = bySite.get(it.site_id) ?? [];
    list.push({ product_id: it.product_id, quantity: it.quantity, ...(it.variant_id ? { variant_id: it.variant_id } : {}), ...(it.addons ? { addons: it.addons } : {}) });
    bySite.set(it.site_id, list);
  }

  const destination = {
    country_code: shipping.country_code,
    ...(shipping.postal_code ? { postal_code: shipping.postal_code } : {}),
    ...(shipping.state ? { state: shipping.state } : {}),
    ...(shipping.city ? { city: shipping.city } : {}),
  };

  // Assemble one cart per store — isolated so one store's failure doesn't abort the rest.
  const perStore: Array<{ siteId: string; cart: any; warnings: CartWarning[]; error?: string }> = [];
  for (const [siteId, siteItems] of bySite) {
    try {
      // quick_checkout starts a FRESH cart per store for the given item list (unlike add_to_cart,
      // which resumes an active cart) — the buyer is specifying exactly what they want to buy now.
      const created = await client.cart.create(siteId);
      const { cart, warnings } = await addItemsWithStockCheck(client as any, siteId, created.cart_id, siteItems, { email: customer?.email });
      const withShipping = await client.cart.setShippingAddress(siteId, created.cart_id, destination);
      perStore.push({ siteId, cart: withShipping ?? cart, warnings });
    } catch (err) {
      perStore.push({ siteId, cart: { cart_id: '', items: [] }, warnings: [], error: (err as Error).message });
    }
  }

  // Single store → existing rich checkout card; multi → multiCart View.
  if (perStore.length === 1) {
    const s = perStore[0];
    const model = await inlineCardImages(buildCheckoutCard(s.cart as any, s.siteId));
    const card = cardResult(model);
    if (s.warnings.length || s.error) {
      const note = s.error
        ? `Could not set up this store: ${s.error}`
        : s.warnings.map((w) => `${w.product_id} ${w.reason === 'out_of_stock' ? `out of stock${w.restock_armed ? ' — alert armed' : ''}` : `could not be added${w.message ? ` (${w.message})` : ''}`}`).join('; ');
      card.content = [{ type: 'text', text: `${(card.content?.[0] as any)?.text ?? ''}\n\n_Note: ${note}._` }];
    }
    return card;
  }

  const multi = buildMultiCartCard(perStore.map((s) => ({
    siteId: s.siteId,
    storeName: siteNameFor(s.siteId),
    cart: s.cart,
    warnings: s.warnings,
    ...(s.error ? { error: s.error } : {}),
  })));
  return cardResult(multi);
};

/**
 * Map scope codes to user-friendly labels
 */
function scopeToLabel(scope: string): string {
  const labels: Record<string, string> = {
    read_products: '🔍 Browse products',
    manage_cart: '🛒 Manage shopping cart',
    execute_checkout: '💳 Execute checkout & place orders',
    read_orders: '📦 Read order history',
  };
  return labels[scope] ?? scope;
}

/**
 * Map tool names to their implementations
 */
export const TOOL_IMPLEMENTATIONS: Record<string, ToolImplementation> = {
  list_sites: listSites,
  search_products: searchProducts,
  get_product: getProduct,
  get_product_reviews: getProductReviews,
  request_back_in_stock: requestBackInStock,
  compare_products: compareProducts,
  create_cart: createCart,
  add_to_cart: addToCart,
  quick_checkout: quickCheckout,
  remove_from_cart: removeFromCart,
  set_cart_quantity: setCartQuantity,
  apply_coupon: applyCoupon,
  get_cart: getCart,
  get_active_cart: getActiveCart,
  set_shipping_address: setShippingAddress,
  select_shipping_option: selectShippingOption,
  execute_checkout: executeCheckout,
  get_order: getOrder,
  list_orders: listOrders,
  request_delegation: requestDelegation,
  submit_delegation_otp: submitDelegationOtp,
  check_delegation: checkDelegation,
  get_payment_methods: getPaymentMethods,
  initiate_payment: initiatePayment,
  submit_payment_otp: submitPaymentOtp,
  get_payment_status: getPaymentStatus,
};

/**
 * Get the implementation for a tool by name
 */
export function getToolImplementation(toolName: string): ToolImplementation | undefined {
  return TOOL_IMPLEMENTATIONS[toolName];
}
