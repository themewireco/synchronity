// sdk/mcp/src/cards/outputSchemas.ts
//
// JSON Schema (draft-07) descriptions of each tool's `structuredContent`,
// declared as `outputSchema` on the MCP tool descriptors. Schemas are
// DESCRIPTIVE, not strict: `additionalProperties` is left default so backend
// field additions never break conformance, while documented fields guide the
// model and let ChatGPT bind structuredContent to a widget.
//
// Shapes mirror cards/types.ts (CardModel) and the markdown builders.

type JsonSchema = Record<string, unknown>;

const money: JsonSchema = {
  type: 'object',
  properties: { amount: { type: 'string' }, currency: { type: 'string' } },
};

const cardAction: JsonSchema = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    toolName: { type: 'string' },
    params: { type: 'object' },
  },
};

const cartLine: JsonSchema = {
  type: 'object',
  properties: {
    itemId: { type: 'string' },
    title: { type: 'string' },
    qty: { type: 'number' },
    unitPrice: { type: 'string' },
    lineTotal: { type: 'string' },
    image: { type: 'string' },
    variantTitle: { type: 'string' },
    addonsSummary: { type: 'string' },
    removeAction: cardAction,
    setQtyAction: cardAction,
  },
};

const shippingChoice: JsonSchema = {
  type: 'object',
  properties: {
    optionId: { type: 'string' },
    label: { type: 'string' },
    description: { type: 'string' },
    cost: { type: 'string' },
  },
};

export const productSchema: JsonSchema = {
  type: 'object',
  properties: {
    kind: { const: 'product' },
    siteId: { type: 'string' },
    productId: { type: 'string' },
    title: { type: 'string' },
    description: { type: 'string' },
    price: { type: 'string' },
    image: { type: 'string' },
    images: { type: 'array', items: { type: 'string' } },
    url: { type: 'string' },
    inStock: { type: 'boolean' },
    addToCart: cardAction,
  },
  required: ['kind', 'siteId', 'productId', 'title', 'price', 'inStock'],
};

export const productListSchema: JsonSchema = {
  type: 'object',
  properties: {
    kind: { const: 'productList' },
    siteId: { type: 'string' },
    siteName: { type: 'string' },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          productId: { type: 'string' },
          title: { type: 'string' },
          price: { type: 'string' },
          image: { type: 'string' },
          url: { type: 'string' },
          inStock: { type: 'boolean' },
          hasOptions: { type: 'boolean' },
          addToCart: cardAction,
        },
        required: ['productId', 'title', 'price', 'inStock'],
      },
    },
  },
  required: ['kind', 'siteId', 'products'],
};

export const cartSchema: JsonSchema = {
  type: 'object',
  properties: {
    kind: { const: 'cart' },
    siteId: { type: 'string' },
    cartId: { type: 'string' },
    items: { type: 'array', items: cartLine },
    discounts: {
      type: 'array',
      items: {
        type: 'object',
        properties: { code: { type: 'string' }, amount: { type: 'string' } },
      },
    },
    subtotal: { type: 'string' },
    total: { type: 'string' },
  },
  required: ['kind', 'siteId', 'cartId', 'items', 'subtotal', 'total'],
};

export const checkoutSchema: JsonSchema = {
  type: 'object',
  properties: {
    kind: { const: 'checkout' },
    siteId: { type: 'string' },
    cartId: { type: 'string' },
    items: { type: 'array', items: cartLine },
    shippingOptions: { type: 'array', items: shippingChoice },
    selectedShippingId: { type: 'string' },
    subtotal: { type: 'string' },
    shipping: { type: 'string' },
    total: { type: 'string' },
  },
  required: ['kind', 'siteId', 'cartId', 'items', 'subtotal', 'total'],
};

export const multiCartSchema: JsonSchema = {
  type: 'object',
  properties: {
    kind: { const: 'multiCart' },
    carts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          siteId: { type: 'string' },
          storeName: { type: 'string' },
          cartId: { type: 'string' },
          items: { type: 'array', items: cartLine },
          subtotal: { type: 'string' },
          shippingOptions: { type: 'array', items: shippingChoice },
          error: { type: 'string' },
        },
        required: ['siteId', 'storeName', 'cartId', 'items'],
      },
    },
  },
  required: ['kind', 'carts'],
};

export const quickCheckoutSchema: JsonSchema = {
  // `type: 'object'` keeps the schema valid as an MCP `Tool['outputSchema']`
  // (which requires a top-level object); `oneOf` discriminates checkout vs
  // multiCart by their `kind` const.
  type: 'object',
  oneOf: [checkoutSchema, multiCartSchema],
};

// ── Non-card structuredContent ────────────────────────────────────────────

export const delegationStatusSchema: JsonSchema = {
  type: 'object',
  properties: {
    device_code: { type: 'string' },
    user_code: { type: 'string' },
    delivery: { type: 'string' },
    approvalUrl: { type: 'string' },
    status: { type: 'string' },
    delegation_token: { type: 'string' },
  },
};

const orderSchema_: JsonSchema = {
  type: 'object',
  properties: {
    order_id: { type: 'string' },
    status: { type: 'string' },
    total: money,
    created_at: { type: 'string' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          name: { type: 'string' },
          quantity: { type: 'number' },
          line_total: money,
        },
      },
    },
  },
};
export const orderSchema = orderSchema_;

export const orderListSchema: JsonSchema = {
  type: 'object',
  properties: { orders: { type: 'array', items: orderSchema_ } },
  required: ['orders'],
};

export const siteListSchema: JsonSchema = {
  type: 'object',
  properties: {
    sites: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          site_id: { type: 'string' },
          name: { type: 'string' },
          platform: { type: 'string' },
        },
      },
    },
  },
  required: ['sites'],
};

export const reviewsSchema: JsonSchema = {
  type: 'object',
  properties: {
    reviews: { type: 'array', items: { type: 'object' } },
    authenticity_consensus: {
      type: 'object',
      properties: {
        average_rating: { type: 'number' },
        trust_score: { type: 'number' },
        verified_percentage: { type: 'number' },
        flags: { type: 'array', items: { type: 'string' } },
      },
    },
  },
};

export const paymentSessionSchema: JsonSchema = {
  type: 'object',
  properties: {
    payment_status: { type: 'string' },
    reference: { type: 'string' },
    message: { type: 'string' },
    instruction: {
      type: 'object',
      properties: {
        action: { type: 'string' },
        provider: { type: 'string' },
        authorization_url: { type: 'string' },
      },
    },
  },
};

export const paymentMethodsSchema: JsonSchema = {
  type: 'object',
  properties: {
    mobile_money_provider_labels: { type: 'object' },
  },
};

export const compareSchema: JsonSchema = {
  type: 'object',
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          site_name: { type: 'string' },
          products: { type: 'array', items: { type: 'object' } },
        },
      },
    },
  },
};

export const cartRawSchema: JsonSchema = {
  type: 'object',
  properties: {
    cart_id: { type: 'string' },
    items: { type: 'array' },
  },
};

export const backInStockSchema: JsonSchema = {
  type: 'object',
};

/** Tool name → declared outputSchema. The single source consumed by server.ts. */
export const TOOL_OUTPUT_SCHEMAS: Record<string, JsonSchema> = {
  list_sites: siteListSchema,
  search_products: productListSchema,
  get_product: productSchema,
  get_product_reviews: reviewsSchema,
  request_back_in_stock: backInStockSchema,
  compare_products: compareSchema,
  create_cart: cartRawSchema,
  add_to_cart: cartSchema,
  quick_checkout: quickCheckoutSchema,
  remove_from_cart: cartSchema,
  set_cart_quantity: cartSchema,
  apply_coupon: cartSchema,
  get_cart: cartSchema,
  get_active_cart: cartSchema,
  set_shipping_address: checkoutSchema,
  select_shipping_option: checkoutSchema,
  execute_checkout: orderSchema,
  get_order: orderSchema,
  list_orders: orderListSchema,
  request_delegation: delegationStatusSchema,
  submit_delegation_otp: delegationStatusSchema,
  check_delegation: delegationStatusSchema,
  get_payment_methods: paymentMethodsSchema,
  initiate_payment: paymentSessionSchema,
  submit_payment_otp: paymentSessionSchema,
  get_payment_status: paymentSessionSchema,
};
