import { describe, it, expect } from 'vitest';
import { searchProducts, getProduct } from '../tools.js';

const product = { product_id: 'p1', site_id: 's1', title: 'Vintage Tee', description: 'X'.repeat(4000),
  price: { amount: '26.00', currency: 'USD' }, availability: 'in_stock', sku: 'VT', categories: [],
  tags: ['a'], attributes: [], variants: [], image_url: null, images: [], url: 'https://s/p1', metadata: { noise: 1 } };
// Matches the real @synchronity/sdk shape: products.search() returns { products, ... }.
const fakeClient = { products: { search: async () => ({ products: [product], page: 1, total: 1, total_pages: 1 }), getById: async () => product } } as any;

describe('browse tools return lean payloads', () => {
  it('searchProducts text block omits description/metadata', async () => {
    const out: any = await searchProducts(fakeClient, { site_id: 's1', query: 'tee' }, {} as any);
    const arr = out.content ?? [];
    const textBlock = arr.find((b: any) => b.type === 'text');
    const text = textBlock?.text ?? '';
    expect(text).not.toContain('description'); expect(text).not.toContain('metadata'); expect(text).toContain('Vintage Tee');
  });
  it('getProduct text block omits description/metadata', async () => {
    const out: any = await getProduct(fakeClient, { site_id: 's1', product_id: 'p1' }, {} as any);
    const arr = out.content ?? [];
    const textBlock = arr.find((b: any) => b.type === 'text');
    const text = textBlock?.text ?? '';
    expect(text).not.toContain('description'); expect(text).not.toContain('"metadata"');
  });
});
