// @vitest-environment jsdom
//
// HITL guard: the product/list/cart Views must NEVER let the agent self-approve
// delegation or trigger spend. Buttons may only ever call cart-safe tools through
// the host bridge — never execute_checkout / initiate_payment / submit_payment_otp
// or any delegation tool. (Checkout/payment/delegation Views are not in this phase.)
import { describe, it, expect, vi } from 'vitest';
import { renderProduct, renderProductList, renderCart, type ViewCtx } from '../ui/render.js';
import type { ProductCardModel, ProductListCardModel, CartCardModel } from '../cards/types.js';

const ALLOWED = new Set(['create_cart', 'add_to_cart', 'remove_from_cart', 'get_cart']);
const FORBIDDEN = [
  'execute_checkout', 'initiate_payment', 'submit_payment_otp',
  'request_delegation', 'submit_delegation_otp', 'check_delegation',
];

function spyCtx(): { ctx: ViewCtx; names: () => string[] } {
  const called: string[] = [];
  const ctx: ViewCtx = {
    callTool: vi.fn(async (name: string) => {
      called.push(name);
      if (name === 'create_cart') return { content: [{ type: 'text', text: '{"cart_id":"c1"}' }] };
      return { content: [{ type: 'text', text: 'ok' }] };
    }),
  };
  return { ctx, names: () => called };
}

/** Click every button in the subtree and let async handlers settle. */
async function clickAll(root: HTMLElement) {
  for (const b of root.querySelectorAll('button')) (b as HTMLButtonElement).click();
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
}

const product: ProductCardModel = {
  kind: 'product', siteId: 's1', productId: 'p1', title: 'Mug', price: '$9', inStock: true,
  addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p1', quantity: 1 } },
};
const list: ProductListCardModel = {
  kind: 'productList', siteId: 's1',
  products: [{ productId: 'p1', title: 'Mug', price: '$9', inStock: true,
    addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p1', quantity: 1 } } }],
};
const cart: CartCardModel = {
  kind: 'cart', siteId: 's1', cartId: 'c1', subtotal: '$9', total: '$9',
  items: [{ itemId: 'i1', title: 'Mug', qty: 1, unitPrice: '$9', lineTotal: '$9',
    removeAction: { label: 'Remove', toolName: 'remove_from_cart', params: { site_id: 's1', cart_id: 'c1', item_id: 'i1' } } }],
};

describe('HITL guard — Views only fire cart-safe tools', () => {
  for (const [name, run] of [
    ['product', (root: HTMLElement, ctx: ViewCtx) => renderProduct(root, product, ctx)],
    ['productList', (root: HTMLElement, ctx: ViewCtx) => renderProductList(root, list, ctx)],
    ['cart', (root: HTMLElement, ctx: ViewCtx) => renderCart(root, cart, ctx)],
  ] as const) {
    it(`${name}: every button call is in the cart-safe allowlist`, async () => {
      const root = document.createElement('div');
      const { ctx, names } = spyCtx();
      run(root, ctx);
      await clickAll(root);
      const called = names();
      expect(called.length).toBeGreaterThan(0);
      for (const n of called) expect(ALLOWED.has(n)).toBe(true);
      for (const forbidden of FORBIDDEN) expect(called).not.toContain(forbidden);
    });
  }
});
