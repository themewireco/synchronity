import { describe, it, expect, vi, afterEach } from 'vitest';
import Ajv from 'ajv';
import { getProduct, listOrders, listSites, requestDelegation, searchProducts } from '../tools.js';
import { orderListSchema, siteListSchema } from '../cards/outputSchemas.js';

const product = { product_id: 'p1', site_id: 's1', title: 'Vintage Tee',
  price: { amount: '26.00', currency: 'USD' }, availability: 'in_stock',
  image_url: 'https://img.test/tee.jpg', images: [], variants: [] };
const fakeClient = { products: { getById: async () => product } } as any;

/** Pull the single Markdown text block every tool now returns. */
function textOf(out: any): string {
  const block = (out.content ?? []).find((b: any) => b.type === 'text');
  return block?.text ?? '';
}

describe('getProduct returns an MCP Apps product card', () => {
  it('emits Markdown text + structuredContent + _meta.ui.resourceUri (dual output)', async () => {
    const out: any = await getProduct(fakeClient, { site_id: 's1', product_id: 'p1' }, {} as any);
    // Content is still text-only (the View is linked via _meta, not a content block).
    expect(out.content.every((b: any) => b.type === 'text')).toBe(true);
    expect(out.content.some((b: any) => b.type === 'resource')).toBe(false);
    // New: structuredContent carries the product CardModel for the View to render.
    expect(out.structuredContent).toMatchObject({ kind: 'product', productId: 'p1', siteId: 's1' });
    // New: tool→View link in the result _meta (nested + openai alias).
    expect(out._meta?.ui?.resourceUri).toBe('ui://synchronity/product');
    expect(out._meta?.['openai/outputTemplate']).toBe('ui://synchronity/product');
  });

  it('embeds the product image inline as Markdown and the add_to_cart hint', async () => {
    const out: any = await getProduct(fakeClient, { site_id: 's1', product_id: 'p1' }, {} as any);
    const text = textOf(out);
    expect(text).toContain('![Vintage Tee](https://img.test/tee.jpg)');
    expect(text).toContain('Vintage Tee');
    expect(text).toContain('add_to_cart');
  });
});

describe('searchProducts returns an MCP Apps product list', () => {
  const client = { products: { search: async () => ({ products: [product] }) } } as any;

  it('emits Markdown text + product-list structuredContent + _meta.ui.resourceUri', async () => {
    const out: any = await searchProducts(client, { site_id: 's1', query: 'tee' }, {} as any);
    expect(out.content.every((b: any) => b.type === 'text')).toBe(true);
    expect(out.structuredContent).toMatchObject({ kind: 'productList', siteId: 's1' });
    expect(out.structuredContent.products[0]).toMatchObject({ productId: 'p1', title: 'Vintage Tee' });
    expect(out._meta?.ui?.resourceUri).toBe('ui://synchronity/product-list');
    const text = textOf(out);
    expect(text).toContain('1 product');
    expect(text).toContain('Vintage Tee');
    expect(text).toContain('![Vintage Tee](https://img.test/tee.jpg)');
    expect(text).toContain('`p1`');
  });

  it('browses (no query) — does NOT throw and omits q to the SDK', async () => {
    const search = vi.fn(async () => ({ products: [product] }));
    const browseClient = { products: { search } } as any;
    const out: any = await searchProducts(browseClient, { site_id: 's1' }, {} as any);
    expect(out.structuredContent).toMatchObject({ kind: 'productList', siteId: 's1' });
    // Browse must reach the catalog with no `q` (an empty/whitespace query counts as browse).
    expect(search).toHaveBeenCalledWith('s1', expect.objectContaining({ q: undefined }));
  });

  it('treats an empty/whitespace query as a browse (no throw)', async () => {
    const search = vi.fn(async () => ({ products: [product] }));
    const browseClient = { products: { search } } as any;
    await searchProducts(browseClient, { site_id: 's1', query: '   ' }, {} as any);
    expect(search).toHaveBeenCalledWith('s1', expect.objectContaining({ q: undefined }));
  });

  it('budget: drops out-of-budget items from the card even if the connector ignores max_price', async () => {
    const inBudget = { ...product, product_id: 'cheap', title: 'Cheap Tee', price: { amount: '26.00', currency: 'USD' } };
    const overBudget = { ...product, product_id: 'pricey', title: 'Pricey Box', price: { amount: '580.00', currency: 'USD' } };
    // Connector returns BOTH (ignores the price filter); the handler must still drop the over-budget one.
    const client = { products: { search: async () => ({ products: [inBudget, overBudget] }) } } as any;
    const out: any = await searchProducts(client, { site_id: 's1', max_price: 150 }, {} as any);
    const ids = out.structuredContent.products.map((p: any) => p.productId);
    expect(ids).toContain('cheap');
    expect(ids).not.toContain('pricey');
  });
});

describe('request_delegation returns a Markdown delegation card', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('email-OTP path: device_code, expires, and submit_delegation_otp survive in text; no localhost link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ device_code: 'd1', delivery: 'email', contact: 'u@x.com', expires_in: 600 }),
    })) as any);
    const cfg = { gatewayUrl: 'https://gw.example.com', ait: 'tok' } as any;
    const out: any = await requestDelegation(fakeClient, { site_id: 's1', email: 'u@x.com' }, cfg);
    expect(out.content.every((b: any) => b.type === 'text')).toBe(true);
    const text = textOf(out);
    expect(text).toContain('d1');
    expect(text).toContain('600');
    expect(text).toContain('submit_delegation_otp');
    expect(text).not.toContain('localhost:3000');
  });

  it('link path: gateway approval link is present in text; no localhost link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ device_code: 'd2', user_code: 'WXYZ', verification_uri: 'https://gw.example.com/authorize', expires_in: 600 }),
    })) as any);
    const cfg = { gatewayUrl: 'https://gw.example.com', ait: 'tok' } as any;
    const out: any = await requestDelegation(fakeClient, { site_id: 's1' }, cfg);
    const text = textOf(out);
    expect(text).toContain('https://gw.example.com/authorize');
    expect(text).not.toContain('localhost:3000');
  });
});

describe('text-list tools now carry schema-conformant structuredContent', () => {
  const ajvList = new Ajv({ allErrors: true, strict: false });

  it('list_sites returns { sites: [...] }', async () => {
    const cfg = { gatewayUrl: 'https://gw.example.com', ait: 'tok' } as any;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ sites: [{ id: 's1', name: 'Store', platform: 'shopify' }] }) })) as any);
    const out: any = await listSites({} as any, {}, cfg);
    expect(ajvList.validate(siteListSchema, out.structuredContent), JSON.stringify(ajvList.errors)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('list_orders returns { orders: [...] }', async () => {
    const client = { orders: { list: async () => ({ orders: [{ order_id: 'o1', status: 'completed', total: { amount: '10', currency: 'USD' } }] }) } } as any;
    const out: any = await listOrders(client, { site_id: 's1' }, {} as any);
    expect(ajvList.validate(orderListSchema, out.structuredContent), JSON.stringify(ajvList.errors)).toBe(true);
  });
});
