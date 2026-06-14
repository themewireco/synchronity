import { describe, it, expect, vi, afterEach } from 'vitest';
import { getProduct, requestDelegation, searchProducts } from '../tools.js';

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
