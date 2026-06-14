import { describe, it, expect } from 'vitest';
import type { CardToolResult, ProductListCardModel, CardModel } from '../cards/types.js';

describe('new card types', () => {
  it('ProductListCardModel is part of the CardModel union', () => {
    const m: ProductListCardModel = {
      kind: 'productList', siteId: 's1',
      products: [{ productId: 'p1', title: 'Tee', price: '$26.00', inStock: true,
        addToCart: { label: 'Add', toolName: 'add_to_cart', params: {} } }],
    };
    const card: CardModel = m;
    expect(card.kind).toBe('productList');
  });

  it('CardToolResult carries content + structuredContent + _meta', () => {
    const r: CardToolResult = {
      content: [{ type: 'text', text: 'fallback' }],
      structuredContent: { card: { kind: 'cart' } },
      _meta: { 'openai/outputTemplate': 'ui://synchronity/cart' },
    };
    expect(r.content.length).toBe(1);
  });
});
