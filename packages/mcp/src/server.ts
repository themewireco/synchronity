/**
 * FastMCP Server Implementation for Synchronity
 *
 * Exposes all 14 Synchronity tools via Model Context Protocol.
 * Supports both stdio (for Claude Desktop, Cursor) and HTTP modes.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { Synchronity } from '@synchronity/sdk';
import { getConfig } from './config.js';
import { getToolImplementation } from './tools.js';
import { COUNTRY_CODES } from './countries.js';
import type { MCPContent } from './types.js';
import type { CardToolResult } from './cards/types.js';
import { listUiResources, listUiResourceTemplates, readUiResource } from './cards/resources.js';
import { TOOL_OUTPUT_SCHEMAS } from './cards/outputSchemas.js';

// The schema module types its values as plain JSON-schema records; the MCP Tool
// type wants `outputSchema?: { type: 'object'; ... }`. Re-type the map once here
// so each descriptor below can reference it without a per-tool cast.
const OUTPUT_SCHEMAS = TOOL_OUTPUT_SCHEMAS as Record<string, Tool['outputSchema']>;

/**
 * Tool definitions as per MCP spec
 */
export const TOOL_DEFINITIONS: Tool[] = [
  {
    name: 'list_sites',
    annotations: { title: 'List connected stores', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    description: 'List all registered e-commerce sites. Use this first to find a site by name (e.g. "Pronto Partners") and get its site_id, which is required by all other tools.',
    outputSchema: OUTPUT_SCHEMAS['list_sites'],
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'search_products',
    annotations: { title: 'Search products', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: {
      ui: { resourceUri: 'ui://synchronity/product-list' },
      'openai/outputTemplate': 'ui://synchronity/product-list',
    },
    outputSchema: OUTPUT_SCHEMAS['search_products'],
    description:
      'Find products on a registered store. To BROWSE a store\'s catalog (open-ended requests like "what do they sell", "show me what\'s available"), call with NO query — this returns the store\'s products. To SEARCH, pass `query` (a product name/keyword). Returns paginated products as an interactive card. ALWAYS translate a buyer\'s budget or price constraint into the price params on THIS call instead of filtering in your reply: "under/below/within X" or "X budget" → `max_price: X`; "over/above/at least X" → `min_price: X`; "between X and Y" → both. Likewise pass `in_stock: true` for "available"/"in stock" and `category` when they name one. The card renders exactly what this call returns, so the filter MUST be applied here — never fetch the full catalog and then narrow it in text. Call once with your best intent (browse OR a single query); if a real search is genuinely empty, ask the user to clarify rather than re-firing reworded queries. The card shows products, prices, IDs, and Add-to-cart controls — keep your text reply to one brief sentence and do not re-list what the card shows.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID (e.g., "site_abc123" or "shopify_store_1")' },
        query: { type: 'string', description: 'Optional single search term (product name/keyword). OMIT to browse; for several names use `queries`.' },
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: 'Search several product names at once (e.g. when the buyer lists multiple items). Returns all matches in ONE call/card instead of searching one at a time. Use `query` for a single search, `queries` for several, or omit both to browse.',
        },
        category: { type: 'string', description: 'Filter by product category (optional)' },
        min_price: {
          type: 'string',
          description: 'Minimum price filter in store currency, format: "19.99" (optional)',
        },
        max_price: {
          type: 'string',
          description: 'Maximum price filter in store currency, format: "199.99" (optional)',
        },
        in_stock: { type: 'boolean', description: 'Filter to in-stock items only (default: false)' },
        page: { type: 'integer', description: 'Page number (1-indexed, default: 1)' },
        per_page: {
          type: 'integer',
          description: 'Results per page (default: 20, max: 100)',
          minimum: 1,
          maximum: 100,
        },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'get_product',
    annotations: { title: 'Get product details', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: {
      ui: { resourceUri: 'ui://synchronity/product' },
      'openai/outputTemplate': 'ui://synchronity/product',
    },
    outputSchema: OUTPUT_SCHEMAS['get_product'],
    description: 'Retrieve detailed information about a specific product including variants, pricing, images, and availability. May also return `addons` — customer-selectable options defined by the store (e.g. engraving, gift wrap, size add-ons). When a product has addons, present them to the buyer and collect every addon with `required: true` before calling add_to_cart; for any option carrying a `price_modifier`, show that surcharge so the buyer knows the added cost. The card already shows the product details to the user, so keep your text reply brief and do not re-describe what the card displays.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        product_id: { type: 'string', description: 'Product ID from the site (platform-specific format)' },
      },
      required: ['site_id', 'product_id'],
    },
  },
  {
    name: 'get_product_reviews',
    annotations: { title: 'Get product reviews', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['get_product_reviews'],
    description:
      '🔍 **RECOMMENDED STEP** — Fetch product reviews and authenticity consensus before making purchase decisions. Returns: average rating, trust score (0.0-1.0), review sentiment analysis, authenticity flags (fake reviews, seller issues, negative trends), and recent reviews with verified purchase status. Always call this for each product before adding to cart to verify quality and detect scams.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        product_id: { type: 'string', description: 'Product ID' },
        limit: { type: 'integer', description: 'Max reviews to return (default: 10)', minimum: 1, maximum: 100 },
        page: { type: 'integer', description: 'Page number (default: 1)' },
      },
      required: ['site_id', 'product_id'],
    },
  },
  {
    name: 'request_back_in_stock',
    annotations: { title: 'Notify me when back in stock', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['request_back_in_stock'],
    description:
      'Subscribe the buyer to a back-in-stock alert for an out-of-stock product. Use when the buyer asks to be notified/told/pinged when an item restocks ("notify me when X is back", "let me know when it\'s in stock"). Collect the buyer\'s email so the alert can reach them (without it only the demand is recorded for the merchant). The buyer is emailed when the product is next seen in stock. Returns whether an email alert was armed.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        product_id: { type: 'string', description: 'Product ID to watch' },
        variant_id: { type: 'string', description: 'Specific variant to watch (optional)' },
        email: { type: 'string', description: "Buyer's email for the restock alert (recommended — without it no alert is sent)" },
        product_title: { type: 'string', description: 'Product name, for a clearer alert + merchant view (optional)' },
      },
      required: ['site_id', 'product_id'],
    },
  },
  {
    name: 'compare_products',
    annotations: { title: 'Compare products across stores', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['compare_products'],
    description:
      'Compare products across multiple registered e-commerce sites simultaneously. Uses fail-open strategy: partial results from successful sites are returned even if some sites time out.',
    inputSchema: {
      type: 'object',
      properties: {
        site_ids: { type: 'array', items: { type: 'string' }, description: 'List of registered site IDs to compare across' },
        query: { type: 'string', description: 'Search query for product comparison' },
        category: { type: 'string', description: 'Filter by category (optional)' },
        min_price: { type: 'string', description: 'Minimum price filter (optional)' },
        max_price: { type: 'string', description: 'Maximum price filter (optional)' },
        in_stock: { type: 'boolean', description: 'Filter to in-stock items only (optional)' },
      },
      required: ['site_ids', 'query'],
    },
  },
  {
    name: 'create_cart',
    annotations: { title: 'Create cart', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['create_cart'],
    description:
      'Create a new shopping cart for a specific site. Returns a cart_id. IMPORTANT: Reuse the active cart_id across multiple products in the same session. Do NOT call create_cart again if you already have a cart_id for this site in the chat history.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        currency: { type: 'string', description: 'ISO 4217 currency code (e.g., "USD", "EUR", "GBP"). Defaults to site currency.' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'add_to_cart',
    annotations: { title: 'Add item to cart', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: {
      ui: { resourceUri: 'ui://synchronity/cart' },
      'openai/outputTemplate': 'ui://synchronity/cart',
    },
    outputSchema: OUTPUT_SCHEMAS['add_to_cart'],
    description: 'Add a product variant (or base product) to an existing cart. Reuse the active cart_id from the chat history if one already exists. Only call create_cart first if no cart exists yet.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        cart_id: { type: 'string', description: 'Cart ID to add the product to' },
        product_id: { type: 'string', description: 'Product ID to add' },
        quantity: { type: 'integer', description: 'Quantity to add (must be >= 1)' },
        variant_id: { type: 'string', description: 'Optional product variant ID (e.g., for size/color selection)' },
        addons: {
          type: 'object',
          description: "Selected product add-ons as a map of addon_id -> chosen value(s). For select/radio/boolean pass a single value; for checkbox/multi pass an array; for text/number pass the value. Values for choice add-ons MUST come from the product's addons[].options[].value. Collect any addon with required:true before checkout.",
        },
        items: {
          type: 'array',
          description: 'Add several products in ONE call instead of calling this tool repeatedly. Each entry: { product_id, quantity, variant_id?, addons? }. Out-of-stock items are reported; pass `email` to auto-arm a back-in-stock alert for them.',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'string' },
              quantity: { type: 'integer' },
              variant_id: { type: 'string' },
              addons: { type: 'object' },
            },
            required: ['product_id', 'quantity'],
          },
        },
        email: { type: 'string', description: "Buyer email; arms a back-in-stock alert for any out-of-stock item in items[]." },
      },
      // Only site_id is hard-required: cart_id is resolved/created by the impl, and
      // product_id+quantity are the single-add alternative to items[] (enforced at runtime).
      required: ['site_id'],
    },
  },
  {
    name: 'quick_checkout',
    annotations: { title: 'Quick checkout (build carts)', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['quick_checkout'],
    description:
      'Assemble checkout-ready cart(s) in ONE call for a multi-product (and optionally multi-store) request. Creates a cart per store, adds all items, and sets the shipping address — then returns the cart(s) with delivery options to choose. Use this when the buyer lists several products at once (optionally across stores) and/or gives their address up front, instead of calling create_cart/add_to_cart/set_shipping_address separately. Does NOT select delivery, check out, or pay — the buyer picks delivery (select_shipping_option) and approves checkout/payment per store afterward. Out-of-stock items are reported; pass customer.email to auto-arm a back-in-stock alert for them.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: 'Products to buy. Each entry: { site_id, product_id, quantity, variant_id?, addons? }. Items may span multiple stores (grouped by site_id).',
          items: {
            type: 'object',
            properties: {
              site_id: { type: 'string' },
              product_id: { type: 'string' },
              quantity: { type: 'integer' },
              variant_id: { type: 'string' },
              addons: { type: 'object' },
            },
            required: ['site_id', 'product_id', 'quantity'],
          },
        },
        shipping_address: {
          type: 'object',
          description: 'Buyer delivery address (applied to every store).',
          properties: {
            country_code: { type: 'string', description: '2-letter ISO country code (required).' },
            postal_code: { type: 'string' },
            state: { type: 'string' },
            city: { type: 'string' },
          },
          required: ['country_code'],
        },
        customer: {
          type: 'object',
          description: 'Optional buyer contact carried for checkout; customer.email arms back-in-stock alerts for out-of-stock items.',
          properties: { name: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' } },
        },
      },
      required: ['items', 'shipping_address'],
    },
  },
  {
    name: 'remove_from_cart',
    annotations: { title: 'Remove item from cart', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    _meta: {
      ui: { resourceUri: 'ui://synchronity/cart' },
      'openai/outputTemplate': 'ui://synchronity/cart',
    },
    outputSchema: OUTPUT_SCHEMAS['remove_from_cart'],
    description: 'Remove a line item from the cart. Requires the item_id from the cart contents.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        cart_id: { type: 'string', description: 'Cart ID' },
        item_id: { type: 'string', description: 'Line item ID from the cart (cart.items[].item_id)' },
      },
      required: ['site_id', 'cart_id', 'item_id'],
    },
  },
  {
    name: 'set_cart_quantity',
    annotations: { title: 'Set item quantity', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    _meta: {
      ui: { resourceUri: 'ui://synchronity/cart' },
      'openai/outputTemplate': 'ui://synchronity/cart',
    },
    outputSchema: OUTPUT_SCHEMAS['set_cart_quantity'],
    description: "Set a cart line's quantity (the server cart is the checkout source of truth, so this updates it live). Requires the item_id from the cart contents and the new absolute quantity. A quantity of 0 removes the line. Returns the updated cart card.",
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        cart_id: { type: 'string', description: 'Cart ID' },
        item_id: { type: 'string', description: 'Line item ID from the cart (cart.items[].item_id)' },
        quantity: { type: 'integer', description: 'New absolute quantity for the line (>= 0; 0 removes the line)' },
      },
      required: ['site_id', 'cart_id', 'item_id', 'quantity'],
    },
  },
  {
    name: 'apply_coupon',
    annotations: { title: 'Apply coupon', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: {
      ui: { resourceUri: 'ui://synchronity/cart' },
      'openai/outputTemplate': 'ui://synchronity/cart',
    },
    outputSchema: OUTPUT_SCHEMAS['apply_coupon'],
    description: 'Apply a discount or promotional code to the cart. Returns the updated cart with discount applied.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        cart_id: { type: 'string', description: 'Cart ID' },
        code: { type: 'string', description: 'Coupon or promotional code string' },
      },
      required: ['site_id', 'cart_id', 'code'],
    },
  },
  {
    name: 'get_cart',
    annotations: { title: 'View cart', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: {
      ui: { resourceUri: 'ui://synchronity/cart' },
      'openai/outputTemplate': 'ui://synchronity/cart',
    },
    outputSchema: OUTPUT_SCHEMAS['get_cart'],
    description: 'Retrieve current cart contents, including items, pricing, discounts, and totals. The card already shows the line items and totals to the user, so keep your text reply to one brief sentence — do not re-list the cart contents.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        cart_id: { type: 'string', description: 'Cart ID (optional if an active cart exists for the site)' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'get_active_cart',
    annotations: { title: 'Resume active cart', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    _meta: {
      ui: { resourceUri: 'ui://synchronity/cart' },
      'openai/outputTemplate': 'ui://synchronity/cart',
    },
    outputSchema: OUTPUT_SCHEMAS['get_active_cart'],
    description: "Retrieve the buyer's in-progress cart for a site (resumes a conversation). Call this before assuming a new cart when a shopping conversation continues or after a cart error. Returns the cart with its items rebuilt if the connector cart expired, or null if no cart exists.",
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'set_shipping_address',
    annotations: { title: 'Set shipping address', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['set_shipping_address'],
    description: 'Set the cart shipping destination (collected from the buyer) and return available shipping options with costs. Call after items are in the cart and before select_shipping_option. country_code is required; include postal_code/state for accurate rates.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        cart_id: { type: 'string', description: 'Cart ID' },
        country_code: { type: 'string', enum: COUNTRY_CODES, description: 'ISO-3166 alpha-2 country code (e.g. US)' },
        postal_code: { type: 'string', description: 'Postal/ZIP code for accurate rates' },
        state: { type: 'string', description: 'State/province/region code where carriers need it' },
        city: { type: 'string', description: 'City' },
      },
      required: ['site_id', 'cart_id', 'country_code'],
    },
  },
  {
    name: 'select_shipping_option',
    annotations: { title: 'Select shipping option', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['select_shipping_option'],
    description: 'Select one of the shipping options returned by set_shipping_address. Binds the rate to the cart so the total includes shipping; call before execute_checkout so the hosted checkout opens pre-filled.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        cart_id: { type: 'string', description: 'Cart ID' },
        option_id: { type: 'string', description: 'option_id from cart.shipping_options' },
      },
      required: ['site_id', 'cart_id', 'option_id'],
    },
  },
  {
    name: 'execute_checkout',
    annotations: { title: 'Place order (checkout)', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['execute_checkout'],
    description:
      'Execute checkout for a cart to create an order. Requires a buyer delegation token (from user auth) and a shipping address. The order is created UNPAID (status "pending"). IMPORTANT — do NOT stop here or just hand the user the payment_url. Immediately continue the in-chat payment flow: call get_payment_methods for the returned order_id, present the available channels to the buyer, and ask which they want to use; then drive initiate_payment → (submit_payment_otp if needed) → poll get_payment_status until the order is paid. The payment_url in the response is only a manual fallback if the buyer declines in-chat payment. Always offer to collect payment in the chat first.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        cart_id: { type: 'string', description: 'Cart ID to checkout' },
        buyer_delegation_token: { type: 'string', description: 'Delegation token from buyer (OAuth-like flow)' },
        customer_name: { type: 'string', description: 'Full name of the customer placing the order' },
        customer_email: { type: 'string', description: 'Email address of the customer placing the order' },
        customer_phone: { type: 'string', description: 'Customer contact / billing phone number (E.164 preferred, e.g. +233201234567)' },
        shipping_name: { type: 'string', description: 'Recipient full name' },
        shipping_line1: { type: 'string', description: 'Shipping address line 1 (street)' },
        shipping_line2: { type: 'string', description: 'Shipping address line 2 (apt/suite) [optional]' },
        shipping_city: { type: 'string', description: 'Shipping city' },
        shipping_state: { type: 'string', description: 'Shipping state or province' },
        shipping_postal_code: { type: 'string', description: 'Shipping postal code' },
        shipping_country: { type: 'string', enum: COUNTRY_CODES, description: 'ISO 3166-1 alpha-2 country code (e.g., "US", "GB")' },
        shipping_phone: { type: 'string', description: 'Recipient phone for the shipping address (E.164 preferred); defaults to customer_phone if omitted' },
        notes: { type: 'string', description: 'Optional order notes' },
      },
      required: [
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
      ],
    },
  },
  {
    name: 'get_order',
    annotations: { title: 'Get order details', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['get_order'],
    description: 'Retrieve details for an order by its ID, including items, status, shipping, and tracking information. Orders are buyer-private — pass `buyer_delegation_token` (the delegation token from this buyer\'s checkout approval) so the gateway can confirm the buyer owns this order. If checking if an order is paid: a status of \'pending\' or \'pending_payment\' means the order has NOT been paid. Do NOT assume that the vendor storefront has synchronization delays or database lag; treat \'pending\' as unpaid. When an order is unpaid, offer to collect payment in the chat by starting the in-chat payment flow (get_payment_methods → initiate_payment → get_payment_status) rather than only pointing the user at the payment_url. Do not mark the purchase task as successful until the status updates to \'processing\' or \'completed\'.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        order_id: { type: 'string', description: 'Order ID' },
        buyer_delegation_token: { type: 'string', description: 'The buyer\'s delegation token (from their checkout approval); required to read their order.' },
      },
      required: ['site_id', 'order_id'],
    },
  },
  {
    name: 'list_orders',
    annotations: { title: 'List orders', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['list_orders'],
    description: 'List recent orders for a site, optionally filtered by status (pending, processing, completed, cancelled, refunded). Orders are buyer-private — pass `buyer_delegation_token` (from this buyer\'s checkout approval); only that buyer\'s orders are returned.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID' },
        status: {
          type: 'string',
          description: 'Filter by order status',
          enum: ['pending', 'processing', 'completed', 'cancelled', 'refunded'],
        },
        page: { type: 'integer', description: 'Page number (1-indexed, default: 1)' },
        per_page: { type: 'integer', description: 'Results per page (max 100, default: 20)' },
        buyer_delegation_token: { type: 'string', description: 'The buyer\'s delegation token (from their checkout approval); required to list their orders.' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'request_delegation',
    annotations: { title: 'Request buyer approval', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['request_delegation'],
    description: 'Start the human delegation (approval) flow needed for checkout/payment. PREFERRED: pass the buyer\'s `email` — the gateway emails them a 6-digit code and returns a device_code; ask the user for the code and call submit_delegation_otp. This keeps approval fully in-chat (no link) and you never see the code, so you cannot approve on their behalf. If you omit `email`, it falls back to a browser approval link (device flow) which the user must open; then poll check_delegation. You can never approve a delegation yourself.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Site ID requiring delegation' },
        email: { type: 'string', description: "Buyer's email. When provided, a one-time approval code is emailed to them and approval happens in-chat via submit_delegation_otp (recommended)." },
        scopes: {
          type: 'array',
          items: { type: 'string', enum: ['read_products', 'manage_cart', 'execute_checkout', 'read_orders'] },
          description: 'Scopes to request (defaults to all four scopes)',
        },
        marketing_opt_in: { type: 'boolean', description: 'Set true ONLY if the buyer explicitly agreed to receive marketing/deals emails (e.g. ticked the opt-in box). Subscribes their email to the consumer mailing list.' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'submit_delegation_otp',
    annotations: { title: 'Submit approval code', readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['submit_delegation_otp'],
    description: 'Submit the 6-digit code the buyer received by email (from request_delegation with an email) to approve the delegation in-chat. On success returns a delegation_token to use as buyer_delegation_token for checkout/payment. You cannot obtain this code yourself — the user must read it from their email and give it to you.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID (optional if DEFAULT_SITE_ID is set)' },
        device_code: { type: 'string', description: 'device_code returned by request_delegation' },
        code: { type: 'string', description: 'The 6-digit code the buyer read from their email' },
      },
      required: ['device_code', 'code'],
    },
  },
  {
    name: 'check_delegation',
    annotations: { title: 'Check approval status', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['check_delegation'],
    description: 'Poll for human approval of a delegation request. When status is "approved", returns the delegation_token to use as buyer_delegation_token in execute_checkout.',
    inputSchema: {
      type: 'object',
      properties: {
        device_code: { type: 'string', description: 'device_code returned by request_delegation' },
      },
      required: ['device_code'],
    },
  },
  {
    name: 'get_payment_methods',
    annotations: { title: 'Get payment methods', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['get_payment_methods'],
    description:
      'STEP 1 of the in-chat payment flow. Returns the payment channels available for an order (e.g. "mobile_money", "card") plus a `gateways` array of the enabled payment gateways (each with id, label, and its channels). When more than one gateway is listed, ask the buyer which they want to use and pass it as `gateway` to initiate_payment. Call this first, after an order exists. Then call initiate_payment with the chosen channel (and gateway if more than one). site_id falls back to DEFAULT_SITE_ID if omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID (optional if DEFAULT_SITE_ID is set)' },
        order_id: { type: 'string', description: 'Order ID to pay for' },
      },
      required: ['order_id'],
    },
  },
  {
    name: 'initiate_payment',
    annotations: { title: 'Start payment', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['initiate_payment'],
    description:
      'STEP 2 of the in-chat payment flow. Starts a payment session for an order and returns a PaymentSession with an `instruction` the agent renders in chat. REQUIRES a buyer_delegation_token — obtain it exactly like execute_checkout: call request_delegation, have the user approve in chat, then check_delegation to get the token (spending money always needs human approval). For channel "mobile_money" you MUST collect the buyer\'s `phone` (Ghana: 055… or +233…) and `provider` — use codes mtn, vod (Vodafone/Telecel), or tgo (AirtelTigo); aliases telecel→vod, tigo→tgo are accepted. ALWAYS quote the **Show this instruction to the buyer** line from the response verbatim (Paystack display_text). For channel "card", no phone/provider is needed; the response instruction contains an `authorization_url` you send the user to. After calling: if instruction.action == "submit_otp", ask the user for the OTP and call submit_payment_otp. If instruction.action == "approve_on_phone", tell the user to approve the prompt on their phone, then poll get_payment_status. If instruction.action == "redirect" (card), send the user the authorization_url, then poll get_payment_status.',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID (optional if DEFAULT_SITE_ID is set)' },
        order_id: { type: 'string', description: 'Order ID to pay for' },
        channel: {
          type: 'string',
          enum: ['mobile_money', 'card'],
          description: 'Payment channel chosen by the buyer (from get_payment_methods)',
        },
        phone: { type: 'string', description: 'Buyer mobile-money phone number (required for channel "mobile_money")' },
        provider: {
          type: 'string',
          enum: ['mtn', 'vod', 'tgo', 'telecel', 'vodafone', 'tigo', 'airteltigo'],
          description:
            'Mobile-money provider (required for channel "mobile_money"). Codes: mtn, vod (Vodafone/Telecel), tgo (AirtelTigo).',
        },
        gateway: {
          type: 'string',
          enum: ['paystack', 'stripe', 'paypal'],
          description:
            'Payment gateway to use when the store has more than one enabled (see get_payment_methods.gateways[].id). Optional — defaults to the store\'s first enabled gateway.',
        },
        buyer_delegation_token: {
          type: 'string',
          description: 'Delegation token from the buyer (from request_delegation/check_delegation). Required — payments always need human approval.',
        },
      },
      required: ['order_id', 'channel'],
    },
  },
  {
    name: 'submit_payment_otp',
    annotations: { title: 'Submit payment code', readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['submit_payment_otp'],
    description:
      'STEP 3 (mobile_money only, when initiate_payment returned instruction.action == "submit_otp"). Submits the one-time password the buyer received to authorise the mobile-money charge. REQUIRES the same buyer_delegation_token used for initiate_payment. After submitting, poll get_payment_status until payment_status is "paid"/"processing" or "failed".',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID (optional if DEFAULT_SITE_ID is set)' },
        order_id: { type: 'string', description: 'Order ID being paid for' },
        otp: { type: 'string', description: 'One-time password entered by the buyer' },
        buyer_delegation_token: {
          type: 'string',
          description: 'Delegation token from the buyer (same one used for initiate_payment). Required.',
        },
      },
      required: ['order_id', 'otp'],
    },
  },
  {
    name: 'get_payment_status',
    annotations: { title: 'Check payment status', readOnlyHint: true, destructiveHint: false, openWorldHint: true },
    outputSchema: OUTPUT_SCHEMAS['get_payment_status'],
    description:
      'FINAL STEP of the in-chat payment flow. Returns the current PaymentSession for an order. Poll this (every ~5 seconds) after initiate_payment/submit_payment_otp until payment_status becomes "paid" or "processing" (success — the order is confirmed) or "failed" (tell the user; they can retry by initiating a new payment). Do NOT treat the purchase as complete until this returns "paid" or "processing". No delegation needed (read-only).',
    inputSchema: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'Registered site ID (optional if DEFAULT_SITE_ID is set)' },
        order_id: { type: 'string', description: 'Order ID to check payment status for' },
      },
      required: ['order_id'],
    },
  },
];

/**
 * Per-View "tool is running / done" status text + the `openai/widgetAccessible`
 * flag that ChatGPT REQUIRES to render a widget. Without `openai/widgetAccessible`
 * (which defaults to false) ChatGPT runs the tool and shows the structuredContent
 * as text but never mounts the View. `openai/toolInvocation/*` belong on the tool
 * descriptor (per the Apps SDK reference), not just the resource. Keyed by the
 * descriptor's existing `_meta.ui.resourceUri`. Claude ignores these openai/* keys.
 */
const VIEW_TOOL_INVOCATION: Record<string, { invoking: string; invoked: string }> = {
  'ui://synchronity/product': { invoking: 'Loading product…', invoked: 'Product ready' },
  'ui://synchronity/product-list': { invoking: 'Searching products…', invoked: 'Products ready' },
  'ui://synchronity/cart': { invoking: 'Updating cart…', invoked: 'Cart ready' },
};

for (const tool of TOOL_DEFINITIONS) {
  const meta = tool._meta as Record<string, unknown> | undefined;
  const uri = (meta?.ui as { resourceUri?: string } | undefined)?.resourceUri;
  if (!meta || !uri) continue;
  meta['openai/widgetAccessible'] = true;
  const inv = VIEW_TOOL_INVOCATION[uri];
  if (inv) {
    meta['openai/toolInvocation/invoking'] = inv.invoking;
    meta['openai/toolInvocation/invoked'] = inv.invoked;
  }
}

/**
 * Ensure token is valid, attempting refresh if expired
 * This function now handles BOTH cases:
 * 1. Token is about to expire (within 5 min buffer) - normal refresh
 * 2. Token is fully expired - recovery refresh (gateway now allows expired tokens)
 */
async function ensureValidToken(runtime: any) {
  const now = Date.now();
  const bufferMs = 5 * 60 * 1000; // 5-minute buffer

  // Check if token is expired or about to expire
  if (runtime.expiresAt && runtime.expiresAt - bufferMs < now) {
    // Token is expired or about to expire — refresh it proactively
    try {
      const response = await fetch(`${runtime.gatewayUrl}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${runtime.ait}` },
        body: JSON.stringify({}),
      });

      if (response.ok) {
        const data = (await response.json()) as { token: string; expires_in?: number };
        runtime.ait = data.token; // Mutate the runtime token
        if (data.expires_in) {
          runtime.expiresAt = now + data.expires_in * 1000;
        }
        if (runtime.debug) {
          console.error('[MCP] Token refreshed successfully');
        }
        return true;
      } else {
        if (runtime.debug) {
          console.error(`[MCP] Token refresh failed: ${response.status} ${response.statusText}`);
        }
        return false;
      }
    } catch (err) {
      if (runtime.debug) {
        console.error('[MCP] Token refresh error:', err instanceof Error ? err.message : String(err));
      }
      return false;
    }
  }

  // Token is still valid
  return true;
}

// Unused legacy function - kept for compatibility
async function _legacyTokenRefresh(config: any) {
  try {
    // Legacy token refresh logic - not used in gateway-hosted scenarios
    if (config.debug) {
      console.warn('[MCP] Legacy token refresh attempted but not implemented');
    }
    return false;
  } catch (err) {
    if (config.debug) {
      console.warn('[MCP] Token refresh failed:', err instanceof Error ? err.message : String(err));
    }
    // Continue with current token and let HTTP layer handle 401
    // Gateway now accepts expired tokens for refresh, so this should rarely happen
    return false;
  }
}

/** Normalize a tool return (string | MCPContent[] | CardToolResult) into a CallToolResult. */
export function toCallToolResult(result: string | MCPContent[] | CardToolResult) {
  if (typeof result === 'string') return { content: [{ type: 'text', text: result }] as MCPContent[] };
  if (Array.isArray(result)) return { content: result };
  // CardToolResult
  return { content: result.content, structuredContent: result.structuredContent, _meta: result._meta };
}

/**
 * Create a configured MCP Server with all Synchronity tools registered.
 * Does NOT connect to any transport — caller is responsible for that.
 * Used by both stdio startup and the hosted /mcp gateway endpoint.
 */
export function createMCPServer(config: {
  gatewayUrl: string;
  ait: string;
  timeout?: number;
  debug?: boolean;
  /**
   * Canonical client name (e.g. 'ChatGPT', 'Claude') from the gateway's client
   * detection. ChatGPT needs the skybridge resource mime to render widgets; all
   * other hosts get the MCP-Apps standard mime.
   */
  clientName?: string;
}): Server {
  const resourceOpts = { openai: config.clientName === 'ChatGPT' };
  // Mutable runtime state — ensureValidToken() mutates .ait when refreshed
  const runtime = { ait: config.ait, gatewayUrl: config.gatewayUrl, debug: config.debug };

  const SERVER_INSTRUCTIONS = [
    'Synchronity lets you shop across the user\'s connected e-commerce stores and complete real purchases on their behalf.',
    'WHEN TO USE: invoke these tools whenever the user expresses any shopping, product, or buying intent — even when they do NOT name "Synchronity" and even when the request is indirect. Treat all of these as triggers: naming any store, shop, brand, bakery, restaurant or business and asking to see it ("show me Sorella Bakery\'s catalogue", "what does Pronto Partners carry", "browse <store>", "<store>\'s menu/products/shop"); naming or describing a product or category they want ("I need coffee beans", "some red wine for tonight", "a birthday gift under 200"); asking what a store has or sells ("show me the catalog", "what do they sell"); asking about price/availability ("how much is the Burgo Viejo", "is it in stock", "do they ship to Ghana"); comparison ("which store is cheapest for X"); or any add/buy/order phrasing ("add 2 to my cart", "get me 5 of …", "order …", "buy …", "check out", "I\'ll take it"). When intent is implicit, act on it — do not ask "should I search Synchronity?" first. You do not need permission to call the discovery tools (list_sites, search_products, get_product, compare_products); just use them.',
    'GETTING STARTED: call list_sites FIRST — before anything else — to find the store + its site_id (every other tool needs site_id). CRITICAL: when the user names a specific store/brand/shop, do NOT web-search or fetch the store\'s website to find its catalogue, menu, or products before calling list_sites. A store you do not recognise may still be connected to Synchronity, and list_sites is the only way to know. Match the named store against list_sites (fuzzy/partial name is fine); if it is there, use the Synchronity tools and never the open web. Only if list_sites clearly does not contain that store may you consider another approach.',
    'BROWSING vs SEARCHING: to show what a store carries (open-ended "what do they have", "show me the catalog"), call search_products with NO query — that returns the store\'s catalog. Only pass a query for a specific search (a product name/keyword). Do not invent a query for an open-ended browse request.',
    'CART: build the cart with add_to_cart; change a line\'s amount with set_cart_quantity (pass the new absolute quantity; 0 removes the line) and remove a line with remove_from_cart. Read totals with get_cart — never compute prices yourself; the server cart is the source of truth for checkout.',
    'RESUMING: if a shopping conversation continues, or after any cart error, call get_active_cart(site_id) before assuming a new cart — it restores the buyer\'s in-progress items so they don\'t restart.',
    'CHECKOUT: checkout + payment require the buyer\'s explicit approval (a one-time emailed code). Never approve on the buyer\'s behalf, never guess the code, and never claim a purchase succeeded until payment status is paid or the order is processing/completed.',
  ].join('\n');

  const server = new Server(
    { name: 'synchronity-mcp', version: '0.2.0' },
    { capabilities: { tools: {}, resources: {} }, instructions: SERVER_INSTRUCTIONS },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: TOOL_DEFINITIONS,
  }));

  // MCP Apps UI resources (product / product-list Views). Hosts that support MCP
  // Apps fetch these and render the interactive card; others use the Markdown text.
  server.setRequestHandler(ListResourcesRequestSchema, () => ({
    resources: listUiResources(resourceOpts),
  }));

  // ChatGPT's widget discovery probes resources/templates/list; without this
  // handler the low-level server returns -32601, which can abort outputTemplate
  // registration so the View never mounts. Expose the Views as templates too.
  server.setRequestHandler(ListResourceTemplatesRequestSchema, () => ({
    resourceTemplates: listUiResourceTemplates(resourceOpts),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, (request) => {
    const result = readUiResource(request.params.uri, resourceOpts);
    if (!result) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    return result;
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = request.params.arguments || {};

    if (config.debug) {
      console.error(`[MCP] Calling tool: ${toolName}`, args);
    }

    try {
      const implementation = getToolImplementation(toolName);
      if (!implementation) {
        return {
          content: [{ type: 'text', text: `Error: Unknown tool "${toolName}"` }],
          isError: true,
        };
      }

      const startedAt = Date.now();
      const result = await Promise.race([
        (async () => {
          // Ensure token is fresh before executing tool (mutates runtime.ait if refreshed)
          await ensureValidToken(runtime);
          // Recreate client if token was refreshed
          const currentClient = new Synchronity({ agentToken: runtime.ait, baseUrl: runtime.gatewayUrl });
          return implementation(currentClient, args, runtime, server);
        })(),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Tool execution timeout')), config.timeout ?? 30_000),
        ),
      ]);

      const mapped = toCallToolResult(result);
      if (config.debug) {
        const bytes = mapped.content.reduce((n, c) => {
          if ('text' in c && c.text) return n + c.text.length;
          return n;
        }, 0);
        console.error(`[MCP] tool=${toolName} latency_ms=${Date.now() - startedAt} text_chars=${bytes}`);
      }
      return mapped;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (config.debug) console.error(`[MCP] Tool error: ${message}`);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}

/**
 * Start the MCP server
 */
export async function startServer() {
  const config = await getConfig();

  const server = createMCPServer({
    gatewayUrl: config.gatewayUrl!,
    ait: config.ait!,
    timeout: config.timeout,
    debug: config.debug,
  });

  if (config.mode === 'stdio') {
    const transport = new StdioServerTransport();
    await server.connect(transport);

    if (config.debug) {
      console.error('[MCP] Server started in stdio mode');
    }
  } else {
    throw new Error('HTTP mode is not yet implemented via startServer(); use createMCPServer() directly.');
  }
}
