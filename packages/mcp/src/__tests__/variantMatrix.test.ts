import { describe, it, expect } from 'vitest';
import { deriveAxes, resolveVariant, isValueAvailable } from '../ui/variantMatrix.js';
import type { ProductCardVariant } from '../cards/types.js';

const V = (id: string, size: string, colour: string, inStock = true): ProductCardVariant => ({
  variantId: id, title: `${size}/${colour}`, price: 'GHS 120.00', inStock,
  attributes: [{ name: 'Size', value: size }, { name: 'Colour', value: colour }],
});

const variants: ProductCardVariant[] = [
  V('1', 'S', 'Red'), V('2', 'M', 'Red'), V('3', 'L', 'Blue'), V('4', 'M', 'Green', false),
];

describe('deriveAxes', () => {
  it('groups attributes into ordered axes with distinct first-seen values', () => {
    expect(deriveAxes(variants)).toEqual([
      { name: 'Size', values: ['S', 'M', 'L'] },
      { name: 'Colour', values: ['Red', 'Blue', 'Green'] },
    ]);
  });
  it('returns empty when variants have no attributes', () => {
    expect(deriveAxes([{ variantId: 'x', title: 'x', price: '1', inStock: true }])).toEqual([]);
  });
});

describe('resolveVariant', () => {
  it('returns the variant matching all selected axis values', () => {
    expect(resolveVariant(variants, { Size: 'M', Colour: 'Red' })?.variantId).toBe('2');
  });
  it('returns undefined when the selection is incomplete', () => {
    expect(resolveVariant(variants, { Size: 'M' })).toBeUndefined();
  });
  it('returns undefined when no variant matches', () => {
    expect(resolveVariant(variants, { Size: 'S', Colour: 'Blue' })).toBeUndefined();
  });
});

describe('isValueAvailable', () => {
  it('true when an in-stock variant exists for the value given the rest of the selection', () => {
    expect(isValueAvailable(variants, { Colour: 'Red' }, 'Size', 'M')).toBe(true);
  });
  it('false when the only matching variant is out of stock', () => {
    expect(isValueAvailable(variants, { Size: 'M' }, 'Colour', 'Green')).toBe(false);
  });
});

import { buildProductListCard } from '../cards/build.js';

describe('buildProductListCard — variant price range', () => {
  const variantProduct = {
    product_id: 'p1', title: 'Tee', availability: 'in_stock',
    price: { amount: '150.00', currency: 'GHS' },
    variants: [
      { variant_id: 'a', title: 'S', availability: 'in_stock', price: { amount: '120.00', currency: 'GHS' }, attributes: [] },
      { variant_id: 'b', title: 'L', availability: 'in_stock', price: { amount: '140.00', currency: 'GHS' }, attributes: [] },
    ],
  };
  const simpleProduct = { product_id: 'p2', title: 'Mug', availability: 'in_stock', price: { amount: '15.00', currency: 'GHS' } };

  it('shows "from {min variant price}" for a variable product', () => {
    const card = buildProductListCard([variantProduct], 's1');
    expect(card.products[0].price).toBe('from GHS 120.00');
  });
  it('keeps the single price for a product with no variants', () => {
    const card = buildProductListCard([simpleProduct], 's1');
    expect(card.products[0].price).toBe('GHS 15.00');
  });
});
