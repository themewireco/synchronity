import { describe, it, expect } from 'vitest';
import {
  markdownFallback,
  orderMarkdown,
  orderListMarkdown,
  siteListMarkdown,
} from '../cards/markdown.js';
import type {
  ProductCardModel,
  ProductListCardModel,
  CartCardModel,
  CheckoutCardModel,
  DelegationCardModel,
} from '../cards/types.js';

describe('markdownFallback', () => {
  it('renders a product as readable Markdown (no raw JSON)', () => {
    const m: ProductCardModel = {
      kind: 'product', siteId: 's1', productId: 'p1', title: 'Vintage Tee',
      price: '$26.00', inStock: true, url: 'https://x/p1',
      addToCart: { label: 'Add', toolName: 'add_to_cart', params: {} },
    };
    const md = markdownFallback(m);
    expect(md).toContain('**Vintage Tee**');
    expect(md).toContain('$26.00');
    expect(md).toContain('In stock');
    expect(md).toContain('p1');
    expect(md).not.toContain('"kind"');
  });

  it('renders product addons (label, required flag, options with price modifiers)', () => {
    const m: ProductCardModel = {
      kind: 'product', siteId: 's1', productId: 'p1', title: 'Engraved Mug',
      price: '$20.00', inStock: true,
      addons: [
        { addonId: 'engraving', label: 'Engraving', type: 'select', required: true, help: 'Up to 12 chars',
          options: [
            { value: 'none', label: 'None' },
            { value: 'initials', label: 'Initials', priceModifier: '+$5.00' },
          ] },
      ],
      addToCart: { label: 'Add', toolName: 'add_to_cart', params: {} },
    };
    const md = markdownFallback(m);
    expect(md).toContain('**Options**');
    expect(md).toContain('**Engraving**');
    expect(md).toContain('_(required)_');
    expect(md).toContain('`engraving`');
    expect(md).toContain('Up to 12 chars');
    expect(md).toContain('Initials (+$5.00)');
    expect(md).toContain('value `initials`');
    // hint nudges the agent to pass an addons map
    expect(md).toContain('addons');
  });

  it('renders a product list as Markdown blocks (with inline images) and escapes pipes in titles', () => {
    const m: ProductListCardModel = {
      kind: 'productList', siteId: 's1',
      products: [
        { productId: 'p1', title: 'A | B', price: '$1', inStock: true, image: 'https://img.test/a.jpg',
          addToCart: { label: 'Add', toolName: 'add_to_cart', params: {} } },
        { productId: 'p2', title: 'C', price: '$2', inStock: false,
          addToCart: { label: 'Add', toolName: 'add_to_cart', params: {} } },
      ],
    };
    const md = markdownFallback(m);
    expect(md).toContain('2 products');
    expect(md).toContain('A \\| B'); // pipe escaped so the title is safe
    expect(md).toContain('![A \\| B](https://img.test/a.jpg)'); // inline image when present
    expect(md).toContain('`p1`');
    expect(md).toContain('Out of stock');
  });

  it('renders an empty product list gracefully', () => {
    const m: ProductListCardModel = { kind: 'productList', siteId: 's1', products: [] };
    expect(markdownFallback(m)).toContain('No products matched');
  });

  it('renders a cart with totals', () => {
    const m: CartCardModel = {
      kind: 'cart', siteId: 's1', cartId: 'c1',
      items: [{ itemId: 'i1', title: 'Tee', qty: 2, unitPrice: '$10', lineTotal: '$20' }],
      subtotal: '$20', total: '$20',
    };
    const md = markdownFallback(m);
    expect(md).toContain('c1');
    expect(md).toContain('**Total: $20**');
    expect(md).toContain('| Tee | 2 | $10 | $20 |');
  });

  it('renders checkout shipping options and flags the selected one', () => {
    const m: CheckoutCardModel = {
      kind: 'checkout', siteId: 's1', cartId: 'c1', items: [],
      shippingOptions: [
        { optionId: 'std', label: 'Standard', cost: '$5' },
        { optionId: 'exp', label: 'Express', cost: '$15' },
      ],
      selectedShippingId: 'exp', subtotal: '$20', shipping: '$15', total: '$35',
    };
    const md = markdownFallback(m);
    expect(md).toContain('Express ✓');
    expect(md).toContain('Shipping: $15');
    expect(md).toContain('**Total: $35**');
  });

  it('renders delegation OTP path with submit instruction', () => {
    const m: DelegationCardModel = {
      kind: 'delegation', deviceCode: 'd1', userCode: '', siteName: 'Skin Gourmet',
      scopes: ['🔍 Browse products'], approvalUrl: '', otpEntry: true,
    };
    const md = markdownFallback(m);
    expect(md).toContain('Skin Gourmet');
    expect(md).toContain('submit_delegation_otp');
    expect(md).toContain('d1');
  });

  it('renders delegation link path with approval link', () => {
    const m: DelegationCardModel = {
      kind: 'delegation', deviceCode: 'd2', userCode: 'WXYZ', siteName: 'Store',
      scopes: [], approvalUrl: 'https://gw/authorize?user_code=WXYZ', otpEntry: false,
    };
    const md = markdownFallback(m);
    expect(md).toContain('[Approve the request](https://gw/authorize?user_code=WXYZ)');
    expect(md).toContain('check_delegation');
  });
});

describe('order / list formatters', () => {
  it('orderMarkdown shows status, items, total and tracking', () => {
    const md = orderMarkdown({
      order_id: 'o1', status: 'processing',
      items: [{ title: 'Tee', quantity: 1, line_total: { amount: '26.00', currency: 'USD' } }],
      total: { amount: '26.00', currency: 'USD' }, tracking_number: 'TRK1',
    });
    expect(md).toContain('o1');
    expect(md).toContain('processing');
    expect(md).toContain('$26.00');
    expect(md).toContain('TRK1');
  });

  it('orderListMarkdown handles wrapped and empty results', () => {
    expect(orderListMarkdown({ orders: [{ order_id: 'o1', status: 'pending', total: { amount: '1', currency: 'USD' } }] }))
      .toContain('o1');
    expect(orderListMarkdown({ orders: [] })).toContain('No orders');
  });

  it('siteListMarkdown lists connected stores', () => {
    const md = siteListMarkdown({ sites: [{ id: 's1', name: 'Skin Gourmet', platform: 'woocommerce' }] });
    expect(md).toContain('Skin Gourmet');
    expect(md).toContain('woocommerce');
    expect(md).toContain('s1');
    expect(siteListMarkdown({ sites: [] })).toContain('No connected stores');
  });
});
