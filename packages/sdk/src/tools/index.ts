/**
 * @synchronity/sdk/tools
 *
 * Ready-to-use tool definition objects for major LLM frameworks.
 * Covers the full Synchronity capability surface across 11 tools.
 *
 * Usage:
 *   import { anthropicTools, openaiTools, langchainTools, ToolExecutor } from '@synchronity/sdk/tools';
 */

import type { Synchronity } from '../client.js';
import { z } from 'zod';

// ─── Canonical tool definitions ────────────────────────────────────────────────

interface ToolParam {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: { type: string };
  properties?: Record<string, ToolParam>;
  required?: string[];
}

interface CanonicalToolDef {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParam>;
    required: string[];
  };
}

const TOOL_DEFS: CanonicalToolDef[] = [
  {
    name: 'search_products',
    description:
      'Search for products on a registered Synchronity site. Returns a paginated list of matching products with prices, availability, and variants.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The Synchronity site ID to search.' },
        query: { type: 'string', description: 'Full-text search query, e.g. "laptop" or "red sneakers size 10".' },
        category: { type: 'string', description: 'Filter by product category slug.' },
        min_price: { type: 'number', description: 'Minimum price filter in the site\'s default currency.' },
        max_price: { type: 'number', description: 'Maximum price filter in the site\'s default currency.' },
        in_stock: { type: 'boolean', description: 'When true, only return in-stock products.' },
        page: { type: 'integer', description: 'Page number (1-based). Defaults to 1.' },
        limit: { type: 'integer', description: 'Number of results per page (max 100). Defaults to 20.' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'get_product',
    description:
      'Get full details for a specific product by its ID, including all variants, images, attributes, and pricing.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The Synchronity site ID.' },
        product_id: { type: 'string', description: 'The unique product ID.' },
      },
      required: ['site_id', 'product_id'],
    },
  },
  {
    name: 'compare_products',
    description:
      'Compare products matching a query across one or more Synchronity sites. Useful for finding the best price or availability across multiple stores.',
    parameters: {
      type: 'object',
      properties: {
        site_ids: {
          type: 'array',
          description: 'List of Synchronity site IDs to compare across.',
          items: { type: 'string' },
        },
        query: { type: 'string', description: 'The product search query to compare across sites.' },
        min_price: { type: 'number', description: 'Minimum price filter.' },
        max_price: { type: 'number', description: 'Maximum price filter.' },
        in_stock: { type: 'boolean', description: 'Only include in-stock results.' },
      },
      required: ['site_ids', 'query'],
    },
  },
  {
    name: 'create_cart',
    description:
      'Create a new shopping cart on a site. Returns a cart_id that must be used in subsequent cart operations.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The Synchronity site ID.' },
        currency: { type: 'string', description: 'ISO 4217 currency code (e.g. "USD", "EUR"). Defaults to the site\'s primary currency.' },
      },
      required: ['site_id'],
    },
  },
  {
    name: 'add_to_cart',
    description: 'Add a product (and optionally a specific variant) to an existing cart.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The Synchronity site ID.' },
        cart_id: { type: 'string', description: 'The cart ID returned by create_cart.' },
        product_id: { type: 'string', description: 'The product ID to add.' },
        quantity: { type: 'integer', description: 'Number of units to add.' },
        variant_id: { type: 'string', description: 'Optional variant ID (e.g. for a specific size/color).' },
      },
      required: ['site_id', 'cart_id', 'product_id', 'quantity'],
    },
  },
  {
    name: 'remove_from_cart',
    description: 'Remove a specific line item from the cart by its item_id.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The Synchronity site ID.' },
        cart_id: { type: 'string', description: 'The cart ID.' },
        item_id: { type: 'string', description: 'The item_id of the cart line item to remove (from cart.items[].item_id).' },
      },
      required: ['site_id', 'cart_id', 'item_id'],
    },
  },
  {
    name: 'apply_coupon',
    description: 'Apply a discount coupon code to a cart. Returns the updated cart with the discount reflected.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The Synchronity site ID.' },
        cart_id: { type: 'string', description: 'The cart ID.' },
        code: { type: 'string', description: 'The coupon/promo code string.' },
      },
      required: ['site_id', 'cart_id', 'code'],
    },
  },
  {
    name: 'get_cart',
    description: 'Retrieve the current contents of a cart, including items, subtotal, discounts, and total.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The Synchronity site ID.' },
        cart_id: { type: 'string', description: 'The cart ID.' },
      },
      required: ['site_id', 'cart_id'],
    },
  },
  {
    name: 'execute_checkout',
    description:
      'Execute checkout for a cart. Requires a buyer delegation token (obtained via the Synchronity auth flow), shipping address, and payment method. Returns a confirmed order.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The Synchronity site ID.' },
        cart_id: { type: 'string', description: 'The cart ID to check out.' },
        buyer_delegation_token: {
          type: 'string',
          description: 'The buyer\'s delegation token from the Synchronity auth flow.',
        },
        shipping_name: { type: 'string', description: 'Full name of the shipping recipient.' },
        shipping_line1: { type: 'string', description: 'Shipping address line 1.' },
        shipping_line2: { type: 'string', description: 'Shipping address line 2 (optional).' },
        shipping_city: { type: 'string', description: 'Shipping city.' },
        shipping_state: { type: 'string', description: 'Shipping state or province.' },
        shipping_postal_code: { type: 'string', description: 'Shipping postal/ZIP code.' },
        shipping_country: {
          type: 'string',
          description: 'ISO 3166-1 alpha-2 country code for the shipping address (e.g. "US", "GB").',
        },
      },
      required: [
        'site_id',
        'cart_id',
        'buyer_delegation_token',
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
    description: 'Get the details of a specific order by its order ID, including items, status, and tracking info. If checking if an order is paid: a status of \'pending\' or \'pending_payment\' means the order has NOT been paid. Do NOT assume that the vendor storefront has synchronization delays or database lag; treat \'pending\' as unpaid, instruct the user to complete payment via the payment_url, and do not mark the purchase task as successful until the status updates to \'processing\' or \'completed\'.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The Synchronity site ID.' },
        order_id: { type: 'string', description: 'The unique order ID.' },
      },
      required: ['site_id', 'order_id'],
    },
  },
  {
    name: 'list_orders',
    description: 'List recent orders, optionally filtered by status.',
    parameters: {
      type: 'object',
      properties: {
        site_id: { type: 'string', description: 'The Synchronity site ID.' },
        status: {
          type: 'string',
          description: 'Filter by order status.',
          enum: ['pending', 'processing', 'completed', 'cancelled', 'refunded'],
        },
        page: { type: 'integer', description: 'Page number (1-based).' },
        limit: { type: 'integer', description: 'Results per page (max 100).' },
      },
      required: ['site_id'],
    },
  },
];

// ─── Anthropic format ──────────────────────────────────────────────────────────

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

/**
 * Tool definitions in Anthropic Claude format.
 * Pass directly to Claude's `tools` parameter.
 *
 * @example
 * const response = await anthropic.messages.create({
 *   model: 'claude-opus-4-5',
 *   tools: anthropicTools,
 *   messages: [{ role: 'user', content: 'Find me a laptop under $1000' }],
 * });
 */
export const anthropicTools: AnthropicTool[] = TOOL_DEFS.map((def) => ({
  name: def.name,
  description: def.description,
  input_schema: def.parameters,
}));

// ─── OpenAI format ─────────────────────────────────────────────────────────────

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

/**
 * Tool definitions in OpenAI function-calling format.
 * Pass directly to OpenAI's `tools` parameter.
 *
 * @example
 * const response = await openai.chat.completions.create({
 *   model: 'gpt-4o',
 *   tools: openaiTools,
 *   messages: [{ role: 'user', content: 'Find me a laptop under $1000' }],
 * });
 */
export const openaiTools: OpenAITool[] = TOOL_DEFS.map((def) => ({
  type: 'function',
  function: {
    name: def.name,
    description: def.description,
    parameters: def.parameters,
  },
}));

// ─── LangChain format ──────────────────────────────────────────────────────────

export interface LangChainToolDef {
  name: string;
  description: string;
  /** JSON Schema representation of the tool's input. */
  schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
  /** Returns a Zod schema object when zod is available in the consumer's project. */
  toZodSchema: () => unknown;
}

function buildZodSchema(properties: Record<string, ToolParam>, required: string[]): unknown {

  const shape: Record<string, unknown> = {};

  for (const [key, param] of Object.entries(properties)) {
    let field: ReturnType<typeof z.string>;

    switch (param.type) {
      case 'string':
        field = param.enum
          ? (z.enum(param.enum as [string, ...string[]]) as unknown as ReturnType<typeof z.string>)
          : z.string();
        break;
      case 'number':
        field = z.number() as unknown as ReturnType<typeof z.string>;
        break;
      case 'integer':
        field = z.number().int() as unknown as ReturnType<typeof z.string>;
        break;
      case 'boolean':
        field = z.boolean() as unknown as ReturnType<typeof z.string>;
        break;
      case 'array':
        field = z.array(z.string()) as unknown as ReturnType<typeof z.string>;
        break;
      default:
        field = z.unknown() as unknown as ReturnType<typeof z.string>;
    }

    field = field.describe(param.description) as ReturnType<typeof z.string>;

    if (!required.includes(key)) {
      shape[key] = (field as unknown as { optional(): unknown }).optional();
    } else {
      shape[key] = field;
    }
  }

  return z.object(shape as Parameters<typeof z.object>[0]);
}

/**
 * Tool definitions compatible with LangChain's StructuredTool interface.
 * Each entry includes `name`, `description`, a JSON `schema`, and a `toZodSchema()` helper.
 *
 * @example
 * // With LangChain:
 * import { DynamicStructuredTool } from 'langchain/tools';
 * const tools = langchainTools.map(t => new DynamicStructuredTool({
 *   name: t.name,
 *   description: t.description,
 *   schema: t.toZodSchema(),
 *   func: async (args) => JSON.stringify(await executor.execute(t.name, args)),
 * }));
 */
export const langchainTools: LangChainToolDef[] = TOOL_DEFS.map((def) => ({
  name: def.name,
  description: def.description,
  schema: def.parameters,
  toZodSchema: () => buildZodSchema(def.parameters.properties, def.parameters.required),
}));

// ─── ToolExecutor ──────────────────────────────────────────────────────────────

export type ToolName =
  | 'search_products'
  | 'get_product'
  | 'compare_products'
  | 'create_cart'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'apply_coupon'
  | 'get_cart'
  | 'execute_checkout'
  | 'get_order'
  | 'list_orders';

/**
 * Executes Synchronity tool calls from an LLM's tool-use response.
 * Wraps `Synchronity` client methods with a dispatch table keyed by tool name.
 *
 * @example
 * const executor = new ToolExecutor(client);
 * const result = await executor.execute('search_products', { site_id: 'site_123', query: 'laptop' });
 */
export class ToolExecutor {
  constructor(private readonly client: Synchronity) {}

  async execute(name: ToolName | string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case 'search_products': {
        const searchParams: import('../modules/index.js').SearchProductsParams = {};
        if (args['query'] !== undefined) searchParams.q = args['query'] as string;
        if (args['category'] !== undefined) searchParams.category = args['category'] as string;
        if (args['min_price'] !== undefined) searchParams.min_price = args['min_price'] as number;
        if (args['max_price'] !== undefined) searchParams.max_price = args['max_price'] as number;
        if (args['in_stock'] !== undefined) searchParams.in_stock = args['in_stock'] as boolean;
        if (args['page'] !== undefined) searchParams.page = args['page'] as number;
        if (args['limit'] !== undefined) searchParams.limit = args['limit'] as number;
        return this.client.products.search(args['site_id'] as string, searchParams);
      }

      case 'get_product':
        return this.client.products.getById(
          args['site_id'] as string,
          args['product_id'] as string,
        );

      case 'compare_products': {
        const compareParams: import('../modules/index.js').SearchProductsParams = {
          q: args['query'] as string,
        };
        if (args['min_price'] !== undefined) compareParams.min_price = args['min_price'] as number;
        if (args['max_price'] !== undefined) compareParams.max_price = args['max_price'] as number;
        if (args['in_stock'] !== undefined) compareParams.in_stock = args['in_stock'] as boolean;
        return this.client.products.compare(args['site_ids'] as string[], compareParams);
      }

      case 'create_cart':
        return this.client.cart.create(
          args['site_id'] as string,
          args['currency'] as string | undefined,
        );

      case 'add_to_cart': {
        const addParams: import('../modules/index.js').AddItemParams = {
          product_id: args['product_id'] as string,
          quantity: args['quantity'] as number,
        };
        if (args['variant_id'] !== undefined) addParams.variant_id = args['variant_id'] as string;
        return this.client.cart.addItem(
          args['site_id'] as string,
          args['cart_id'] as string,
          addParams,
        );
      }

      case 'remove_from_cart':
        return this.client.cart.removeItem(
          args['site_id'] as string,
          args['cart_id'] as string,
          args['item_id'] as string,
        );

      case 'apply_coupon':
        return this.client.cart.applyCoupon(
          args['site_id'] as string,
          args['cart_id'] as string,
          args['code'] as string,
        );

      case 'get_cart':
        return this.client.cart.get(
          args['site_id'] as string,
          args['cart_id'] as string,
        );

      case 'execute_checkout': {
        const shippingAddress: import('../modules/index.js').ShippingAddressParams = {
          name: args['shipping_name'] as string,
          line1: args['shipping_line1'] as string,
          city: args['shipping_city'] as string,
          state: args['shipping_state'] as string,
          postal_code: args['shipping_postal_code'] as string,
          country: args['shipping_country'] as string,
        };
        if (args['shipping_line2'] !== undefined) {
          shippingAddress.line2 = args['shipping_line2'] as string;
        }
        return this.client.checkout.execute(args['site_id'] as string, {
          cart_id: args['cart_id'] as string,
          buyer_delegation_token: args['buyer_delegation_token'] as string,
          shipping_address: shippingAddress,
        });
      }

      case 'get_order':
        return this.client.orders.get(
          args['site_id'] as string,
          args['order_id'] as string,
        );

      case 'list_orders': {
        const listParams: import('../modules/index.js').ListOrdersParams = {};
        if (args['page'] !== undefined) listParams.page = args['page'] as number;
        if (args['limit'] !== undefined) listParams.limit = args['limit'] as number;
        if (args['status'] !== undefined) {
          listParams.status = args['status'] as 'pending' | 'processing' | 'completed' | 'cancelled' | 'refunded';
        }
        return this.client.orders.list(args['site_id'] as string, listParams);
      }

      default:
        throw new Error(`Unknown Synchronity tool: "${name}"`);
    }
  }
}
