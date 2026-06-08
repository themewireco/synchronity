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
import { textResult } from './cards/renderCard.js';
import { buildProductCard, buildProductListCard, buildCartCard, buildCheckoutCard, buildDelegationCard } from './cards/build.js';
import { markdownFallback, orderMarkdown, orderListMarkdown, siteListMarkdown } from './cards/markdown.js';

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
  const { site_id, query, category, min_price, max_price, in_stock, page = 1, per_page = 20 } = args;

  if (!site_id || !query) {
    throw new Error('site_id and query are required');
  }

  const results = await client.products.search(site_id as string, {
    q: query as string,
    category: category as string | undefined,
    min_price: min_price as number | undefined,
    max_price: max_price as number | undefined,
    in_stock: in_stock as boolean | undefined,
    page: page as number,
    limit: per_page as number,
  });

  // @synchronity/sdk's products.search() returns { products, total, page, total_pages };
  // keep `data` as a defensive fallback for the raw paginated API shape.
  const r = results as { products?: Array<unknown>; data?: Array<unknown> };
  const products = r.products ?? r.data ?? [];
  const listModel = buildProductListCard(products as any[], site_id as string);
  return textResult(markdownFallback(listModel));
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
  return textResult(markdownFallback(productModel));
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
  return JSON.stringify({ ...(comparison as object), results: leanResults ?? (comparison as any).results });
};

/**
 * Tool: Create a new cart
 */
export const createCart: ToolImplementation = async (client, args) => {
  const { site_id, currency } = args;

  if (!site_id) {
    throw new Error('site_id is required');
  }

  const cart = await client.cart.create(site_id as string, currency as string | undefined);

  return JSON.stringify(cart);
};

/**
 * Tool: Add item to cart
 */
export const addToCart: ToolImplementation = async (client, args) => {
  const { site_id, cart_id, product_id, quantity, variant_id, addons } = args;

  if (!site_id || !cart_id || !product_id || !quantity) {
    throw new Error('site_id, cart_id, product_id, and quantity are required');
  }

  const updatedCart = await client.cart.addItem(site_id as string, cart_id as string, {
    product_id: product_id as string,
    quantity: quantity as number,
    variant_id: variant_id as string | undefined,
    ...(addons ? { addons: addons as Record<string, string | string[] | boolean | number> } : {}),
  });

  const c = updatedCart as any;
  const cartModel = buildCartCard(c, site_id as string);
  return textResult(markdownFallback(cartModel));
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
  return textResult(markdownFallback(cartModel));
};

/**
 * Tool: Apply coupon to cart
 */
export const applyCoupon: ToolImplementation = async (client, args) => {
  const { site_id, cart_id, code } = args;

  if (!site_id || !cart_id || !code) {
    throw new Error('site_id, cart_id, and code are required');
  }

  const updatedCart = await client.cart.applyCoupon(site_id as string, cart_id as string, code as string);
  return JSON.stringify(updatedCart);
};

/**
 * Tool: Get cart contents
 */
export const getCart: ToolImplementation = async (client, args) => {
  const { site_id, cart_id } = args;

  if (!site_id || !cart_id) {
    throw new Error('site_id and cart_id are required');
  }

  const cart = await client.cart.get(site_id as string, cart_id as string);
  const c = cart as any;
  const cartModel = buildCartCard(c, site_id as string);
  return textResult(markdownFallback(cartModel));
};

/**
 * Tool: Execute checkout
 */
export const executeCheckout: ToolImplementation = async (client, args) => {
  const {
    site_id,
    cart_id,
    buyer_delegation_token,
    customer_name,
    customer_email,
    shipping_name,
    shipping_line1,
    shipping_line2,
    shipping_city,
    shipping_state,
    shipping_postal_code,
    shipping_country,
    notes,
  } = args;

  const required = [
    'site_id',
    'cart_id',
    'buyer_delegation_token',
    'customer_name',
    'customer_email',
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
    notes: notes as string | undefined,
    shipping_address: {
      name: shipping_name as string,
      line1: shipping_line1 as string,
      line2: shipping_line2 as string | undefined,
      city: shipping_city as string,
      state: shipping_state as string,
      postal_code: shipping_postal_code as string,
      country: shipping_country as string,
    },
  });

  return `Order placed.\n\n${orderMarkdown(order)}\n\n_To pay, use \`get_payment_methods\` then \`initiate_payment\` with order_id \`${(order as any).order_id}\`._`;
};

/**
 * Tool: Get order details
 */
export const getOrder: ToolImplementation = async (client, args) => {
  const { site_id, order_id } = args;

  if (!site_id || !order_id) {
    throw new Error('site_id and order_id are required');
  }

  const order = await client.orders.get(site_id as string, order_id as string);
  return orderMarkdown(order);
};

/**
 * Tool: List orders
 */
export const listOrders: ToolImplementation = async (client, args) => {
  const { site_id, status, page = 1, limit = 20 } = args;

  if (!site_id) {
    throw new Error('site_id is required');
  }

  const orders = await client.orders.list(site_id as string, {
    status: status as 'pending' | 'processing' | 'completed' | 'cancelled' | 'refunded' | undefined,
    page: page as number,
    limit: limit as number,
  });

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
  return siteListMarkdown(data);
};

/**
 * Tool: Request human delegation (device flow initiation)
 */
export const requestDelegation: ToolImplementation = async (client, args, config, server) => {
  const { site_id, scopes, email } = args;
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
    body: JSON.stringify({ site_id, scopes: resolvedScopes, ...(email ? { email } : {}) }),
  });
  const data = await res.json() as Record<string, unknown>;
  if (!res.ok) throw new Error(JSON.stringify(data));

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
    return textResult(markdownFallback(delegationModel) + expiresNote);
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
  return textResult(markdownFallback(delegationModel) + expiresNote);
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

  return JSON.stringify({
    status: data.status,
    delegation_token: data.delegation_token,
    expires_at: data.expires_at,
    message: 'Approved. Use delegation_token as buyer_delegation_token for checkout and payment.',
  });
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
  if (!res.ok) throw new Error(JSON.stringify(data));

  if (data.status === 'approved' && data.ait) {
    return JSON.stringify({
      status: 'approved',
      delegation_token: data.ait,
      message: 'Human has approved. Use this delegation_token as buyer_delegation_token in execute_checkout.',
    });
  }

  return JSON.stringify({
    status: data.status,
    message: data.status === 'pending'
      ? 'Human has not approved yet. Poll again in a few seconds.'
      : `Delegation status: ${data.status}`,
  });
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

  return JSON.stringify(reviews, null, 2);
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
  const checkoutModel = buildCheckoutCard(cart as any, site_id as string);
  return textResult(markdownFallback(checkoutModel));
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
  return JSON.stringify(methods);
};

/**
 * Tool: Initiate a payment session for an order (requires delegation).
 */
export const initiatePayment: ToolImplementation = async (client, args) => {
  const siteId = resolveSiteId(args);
  const { order_id, channel, phone, provider, buyer_delegation_token } = args;
  if (!order_id) throw new Error('order_id is required');
  if (channel !== 'mobile_money' && channel !== 'card') {
    throw new Error('channel must be "mobile_money" or "card"');
  }
  if (channel === 'mobile_money' && (!phone || !provider)) {
    throw new Error('phone and provider are required for mobile_money');
  }

  const session = await client.payments.initiate(siteId, order_id as string, {
    channel: channel as 'mobile_money' | 'card',
    phone: phone as string | undefined,
    provider: provider as 'mtn' | 'vod' | 'tgo' | undefined,
    buyer_delegation_token: buyer_delegation_token as string | undefined,
  });
  return JSON.stringify(session);
};

/**
 * Tool: Submit an OTP for a mobile-money payment (requires delegation).
 */
export const submitPaymentOtp: ToolImplementation = async (client, args) => {
  const siteId = resolveSiteId(args);
  const { order_id, otp, buyer_delegation_token } = args;
  if (!order_id) throw new Error('order_id is required');
  if (!otp) throw new Error('otp is required');

  const session = await client.payments.submitOtp(siteId, order_id as string, {
    otp: otp as string,
    buyer_delegation_token: buyer_delegation_token as string | undefined,
  });
  return JSON.stringify(session);
};

/**
 * Tool: Get current payment status for an order; the agent polls this.
 */
export const getPaymentStatus: ToolImplementation = async (client, args) => {
  const siteId = resolveSiteId(args);
  const { order_id } = args;
  if (!order_id) throw new Error('order_id is required');

  const session = await client.payments.getStatus(siteId, order_id as string);
  return JSON.stringify(session);
};

/** Tool: Select a shipping option, binding it to the cart total */
export const selectShippingOption: ToolImplementation = async (client, args) => {
  const { site_id, cart_id, option_id } = args;
  if (!site_id || !cart_id || !option_id) {
    throw new Error('site_id, cart_id, and option_id are required');
  }
  const cart = await client.cart.selectShippingOption(site_id as string, cart_id as string, option_id as string);
  const checkoutModel = buildCheckoutCard(cart as any, site_id as string);
  return textResult(markdownFallback(checkoutModel));
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
  compare_products: compareProducts,
  create_cart: createCart,
  add_to_cart: addToCart,
  remove_from_cart: removeFromCart,
  apply_coupon: applyCoupon,
  get_cart: getCart,
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
