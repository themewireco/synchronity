// sdk/mcp/src/__tests__/cards.build.test.ts
import { describe, it, expect } from 'vitest';
import { buildCheckoutCard, buildCartCard, buildProductCard, buildDelegationCard, buildProductListCard } from '../cards/build.js';

const cart = {
  cart_id: 'c1', site_id: 's1', currency: 'USD',
  items: [{ item_id: 'i1', product_id: 'p1', title: 'Vintage Tee', quantity: 1,
            unit_price: { amount: '26.00', currency: 'USD' }, line_total: { amount: '26.00', currency: 'USD' } }],
  subtotal: { amount: '26.00', currency: 'USD' },
  total: { amount: '31.00', currency: 'USD' },
  shipping_total: { amount: '5.00', currency: 'USD' },
  shipping_options: [{ option_id: 'std', title: 'Standard', description: '5-7 business days', cost: { amount: '5.00', currency: 'USD' } }],
  selected_shipping_option_id: 'std',
};

describe('card model builders', () => {
  it('buildCheckoutCard maps line items, shipping, and totals', () => {
    const m = buildCheckoutCard(cart as any, 's1');
    expect(m.kind).toBe('checkout');
    expect(m.siteId).toBe('s1');
    expect(m.items[0]).toMatchObject({ itemId: 'i1', title: 'Vintage Tee', qty: 1, unitPrice: '$26.00' });
    expect(m.shippingOptions[0]).toMatchObject({ optionId: 'std', label: 'Standard', cost: '$5.00' });
    expect(m.selectedShippingId).toBe('std');
    expect(m.total).toBe('$31.00');
    expect(m.subtotal).toBe('$26.00');
  });

  it('buildCartCard produces an editable cart model with a remove action per item', () => {
    const m = buildCartCard(cart as any, 's1');
    expect(m.kind).toBe('cart');
    expect(m.items[0].itemId).toBe('i1');
  });

  it('buildProductCard maps a lean product', () => {
    const m = buildProductCard({ product_id: 'p1', title: 'Vintage Tee', price: { amount: '26.00', currency: 'USD' },
      availability: 'in_stock', image_url: 'https://img/x.jpg' } as any, 's1');
    expect(m.kind).toBe('product');
    expect(m).toMatchObject({ productId: 'p1', title: 'Vintage Tee', price: '$26.00', image: 'https://img/x.jpg', inStock: true });
  });

  it('buildDelegationCard carries the device code, scopes, and approval url', () => {
    const m = buildDelegationCard({ device_code: 'd1', user_code: 'WXYZ', scopes: ['execute_checkout'],
      siteName: 'My Store', approvalUrl: 'https://gw/authorize?user_code=WXYZ', otp: true } as any);
    expect(m.kind).toBe('delegation');
    expect(m).toMatchObject({ deviceCode: 'd1', userCode: 'WXYZ', siteName: 'My Store', otpEntry: true });
  });
});

describe('buildProductListCard', () => {
  it('maps lean products into a list card with per-item add actions', () => {
    const m = buildProductListCard([
      { product_id: 'p1', title: 'Tee', price: { amount: '26.00', currency: 'USD' }, availability: 'in_stock', image_url: 'https://i/x.jpg' },
      { product_id: 'p2', title: 'Cap', price: { amount: '12.00', currency: 'USD' }, availability: 'out_of_stock' },
    ] as any, 's1');
    expect(m.kind).toBe('productList');
    expect(m.products[0]).toMatchObject({ productId: 'p1', title: 'Tee', price: '$26.00', inStock: true, image: 'https://i/x.jpg' });
    expect(m.products[0].addToCart).toMatchObject({ toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p1', quantity: 1 } });
    expect(m.products[1].inStock).toBe(false);
  });
});
