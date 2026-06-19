import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { TOOL_OUTPUT_SCHEMAS, productListSchema, productSchema, cartSchema, checkoutSchema, multiCartSchema } from '../cards/outputSchemas.js';
import { buildProductListCard, buildProductCard, buildCartCard, buildCheckoutCard, buildMultiCartCard } from '../cards/build.js';
import { TOOL_DEFINITIONS } from '../server.js';

const ajv = new Ajv({ allErrors: true, strict: false });

const ampsProduct = {
  product_id: 'p1', site_id: 's1', title: 'Tee',
  price: { amount: '26.00', currency: 'USD' }, availability: 'in_stock',
  images: [], variants: [],
};
const ampsCart = {
  cart_id: 'c1', site_id: 's1',
  items: [{ item_id: 'i1', product_id: 'p1', title: 'Tee', quantity: 1, unit_price: { amount: '26.00', currency: 'USD' }, line_total: { amount: '26.00', currency: 'USD' } }],
  subtotal: { amount: '26.00', currency: 'USD' }, total: { amount: '26.00', currency: 'USD' },
};

describe('every tool declares an outputSchema', () => {
  it('TOOL_DEFINITIONS each have a valid outputSchema present in the map', () => {
    for (const tool of TOOL_DEFINITIONS as any[]) {
      expect(tool.outputSchema, `${tool.name} missing outputSchema`).toBeDefined();
      expect(TOOL_OUTPUT_SCHEMAS[tool.name], `${tool.name} not in map`).toBeDefined();
      expect(() => ajv.compile(tool.outputSchema)).not.toThrow();
    }
  });
});

describe('View-backed tools advertise the openai/outputTemplate alias', () => {
  const viewTools = ['search_products', 'get_product', 'add_to_cart', 'remove_from_cart', 'set_cart_quantity', 'apply_coupon', 'get_cart', 'get_active_cart'];
  it('each has matching ui.resourceUri and openai/outputTemplate', () => {
    for (const name of viewTools) {
      const tool = (TOOL_DEFINITIONS as any[]).find((t) => t.name === name);
      const uri = tool?._meta?.ui?.resourceUri;
      expect(uri, `${name} missing ui.resourceUri`).toBeTruthy();
      expect(tool?._meta?.['openai/outputTemplate'], `${name} missing alias`).toBe(uri);
    }
  });

  it('each is openai/widgetAccessible and carries descriptor toolInvocation status', () => {
    for (const name of viewTools) {
      const tool = (TOOL_DEFINITIONS as any[]).find((t) => t.name === name);
      // Required for ChatGPT to render the widget (defaults to false otherwise).
      expect(tool?._meta?.['openai/widgetAccessible'], `${name} not widgetAccessible`).toBe(true);
      expect(tool?._meta?.['openai/toolInvocation/invoking'], `${name} missing invoking`).toBeTruthy();
      expect(tool?._meta?.['openai/toolInvocation/invoked'], `${name} missing invoked`).toBeTruthy();
    }
  });

  it('non-View tools are not marked widgetAccessible', () => {
    const tool = (TOOL_DEFINITIONS as any[]).find((t) => t.name === 'list_sites');
    expect(tool?._meta?.['openai/widgetAccessible']).toBeUndefined();
  });
});

describe('card builders produce schema-conformant structuredContent', () => {
  it('productList', () => {
    const model = buildProductListCard([ampsProduct], 's1', 'Store');
    expect(ajv.validate(productListSchema, model), JSON.stringify(ajv.errors)).toBe(true);
  });
  it('product', () => {
    const model = buildProductCard(ampsProduct as any, 's1');
    expect(ajv.validate(productSchema, model), JSON.stringify(ajv.errors)).toBe(true);
  });
  it('cart', () => {
    const model = buildCartCard(ampsCart as any, 's1');
    expect(ajv.validate(cartSchema, model), JSON.stringify(ajv.errors)).toBe(true);
  });
  it('checkout', () => {
    const model = buildCheckoutCard(ampsCart as any, 's1');
    expect(ajv.validate(checkoutSchema, model), JSON.stringify(ajv.errors)).toBe(true);
  });
  it('multiCart', () => {
    const model = buildMultiCartCard([{ siteId: 's1', storeName: 'Store', cart: ampsCart, warnings: [] }] as any);
    expect(ajv.validate(multiCartSchema, model), JSON.stringify(ajv.errors)).toBe(true);
  });
});
