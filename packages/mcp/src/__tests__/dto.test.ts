import { describe, it, expect } from 'vitest';
import { toLeanProduct } from '../dto.js';

const full = {
  product_id: 'p1', site_id: 's1', title: 'Vintage Tee', description: 'A'.repeat(5000),
  price: { amount: '26.00', currency: 'USD' }, availability: 'in_stock', sku: 'VT-1',
  categories: ['apparel'], tags: ['new', 'sale'], attributes: [{ name: 'material', value: 'cotton' }],
  variants: [{ variant_id: 'v1', title: 'Grey - Large', price: { amount: '26.00', currency: 'USD' }, availability: 'in_stock' }],
  image_url: 'https://img/x.jpg', images: [{ url: 'https://img/x.jpg' }, { url: 'https://img/y.jpg' }],
  url: 'https://store/p1', metadata: { internal: 'noise' },
};

describe('toLeanProduct', () => {
  it('keeps only fields the model/card needs', () => {
    expect(toLeanProduct(full as any)).toEqual({
      product_id: 'p1', title: 'Vintage Tee', price: { amount: '26.00', currency: 'USD' },
      availability: 'in_stock', image_url: 'https://img/x.jpg', url: 'https://store/p1',
      variants: [{ variant_id: 'v1', title: 'Grey - Large', price: { amount: '26.00', currency: 'USD' }, availability: 'in_stock' }],
    });
  });
  it('drops description, metadata, tags, and full images array', () => {
    const lean = toLeanProduct(full as any) as unknown as Record<string, unknown>;
    expect(lean.description).toBeUndefined();
    expect(lean.metadata).toBeUndefined();
    expect(lean.tags).toBeUndefined();
    expect(lean.images).toBeUndefined();
  });
  it('falls back to images[0] when image_url is absent', () => {
    const lean = toLeanProduct({ ...full, image_url: null } as any) as unknown as Record<string, unknown>;
    expect(lean.image_url).toBe('https://img/x.jpg');
  });
  it('passes through addons when present', () => {
    const lean = toLeanProduct({ ...full, addons: [{ addon_id: 'a1', label: 'Engraving', type: 'text', required: true, multiple: false }] } as any) as unknown as Record<string, unknown>;
    expect(lean.addons).toEqual([{ addon_id: 'a1', label: 'Engraving', type: 'text', required: true, multiple: false }]);
  });
});
