import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { inlineCardImages } from '../cards/inlineImages.js';
import type { ProductCardModel } from '../cards/types.js';

// Deterministic: SYN_INLINE_IMAGES on + fetch returns a tiny PNG for every image,
// so toDataUri() always yields a data: URI. We assert which fields get rewritten.
const TINY_PNG = Buffer.from('89504e470d0a1a0a', 'hex'); // 8 bytes, content-type image/png

beforeEach(() => {
  process.env.SYN_INLINE_IMAGES = '1';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(TINY_PNG, { headers: { 'content-type': 'image/png' } })));
});
afterEach(() => {
  delete process.env.SYN_INLINE_IMAGES;
  vi.unstubAllGlobals();
});

const model = (): ProductCardModel => ({
  kind: 'product', siteId: 's1', productId: 'p1', title: 'Tee', price: 'GHS 10', inStock: true,
  image: 'https://cdn.test/main.jpg',
  variants: [
    { variantId: 'v1', title: 'Red', price: 'GHS 10', inStock: true, image: 'https://cdn.test/red.jpg' },
    { variantId: 'v2', title: 'Blue', price: 'GHS 10', inStock: true, image: 'https://cdn.test/blue.jpg' },
  ],
  addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p1', quantity: 1 } },
});

describe('inlineCardImages — variant images', () => {
  it('inlines variant images to data: URIs (not just the product image)', async () => {
    const out = await inlineCardImages(model());
    expect(out.image?.startsWith('data:image/')).toBe(true);          // product hero (already worked)
    expect(out.variants?.[0].image?.startsWith('data:image/')).toBe(true); // variant 1 (regression)
    expect(out.variants?.[1].image?.startsWith('data:image/')).toBe(true); // variant 2
  });

  it('is a no-op when inlining is disabled', async () => {
    delete process.env.SYN_INLINE_IMAGES;
    const out = await inlineCardImages(model());
    expect(out.variants?.[0].image).toBe('https://cdn.test/red.jpg');
  });
});
