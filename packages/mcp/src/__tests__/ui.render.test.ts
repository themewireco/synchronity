// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderProduct, renderProductList, type ViewCtx } from '../ui/render.js';
import type { ProductCardModel, ProductListCardModel } from '../cards/types.js';

// Cart state is keyed in sessionStorage; isolate every test so one test's cart
// does not leak into the next (and skip the create_cart a fresh add expects).
beforeEach(() => sessionStorage.clear());

function ctxWithCart(): { ctx: ViewCtx; calls: Array<[string, Record<string, unknown>]> } {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const ctx: ViewCtx = {
    callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push([name, args]);
      if (name === 'create_cart') return { content: [{ type: 'text', text: '{"cart_id":"c1"}' }] };
      if (name === 'add_to_cart') return { content: [{ type: 'text', text: 'ok' }], structuredContent: { items: [{ qty: 1 }] } };
      return { content: [{ type: 'text', text: 'ok' }] };
    }),
  };
  return { ctx, calls };
}

const listModel: ProductListCardModel = {
  kind: 'productList',
  siteId: 's1',
  products: [
    {
      productId: 'p1', title: 'Vintage Tee', price: '$26.00', inStock: true,
      image: 'https://img.test/tee.jpg',
      addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p1', quantity: 1 } },
    },
  ],
};

describe('renderProductList', () => {
  it('renders a row per product with price + Add to cart', () => {
    const root = document.createElement('div');
    const { ctx } = ctxWithCart();
    renderProductList(root, listModel, ctx);
    expect(root.querySelectorAll('.syn-row')).toHaveLength(1);
    expect(root.textContent).toContain('Vintage Tee');
    expect(root.textContent).toContain('$26.00');
    expect(root.querySelector('.syn-btn-primary')).toBeTruthy();
  });

  it('Add to cart with no cart_id chains create_cart → add_to_cart (qty merged)', async () => {
    const root = document.createElement('div');
    const { ctx, calls } = ctxWithCart();
    renderProductList(root, listModel, ctx);
    // bump quantity to 2
    const plus = root.querySelector('.syn-qty button:last-child') as HTMLButtonElement;
    plus.click();
    (root.querySelector('.syn-btn-primary') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(calls.find((c) => c[0] === 'add_to_cart')).toBeTruthy());
    const activeCalls = calls.filter((c) => c[0] !== 'get_cart');
    expect(activeCalls[0][0]).toBe('create_cart');
    expect(activeCalls[0][1]).toEqual({ site_id: 's1' });
    const add = activeCalls.find((c) => c[0] === 'add_to_cart')!;
    expect(add[1]).toMatchObject({ site_id: 's1', product_id: 'p1', quantity: 2, cart_id: 'c1' });
  });

  const twoProductModel: ProductListCardModel = {
    kind: 'productList',
    siteId: 's1',
    products: [
      listModel.products[0],
      {
        productId: 'p2', title: 'Silent Night Chai', price: '$1.00', inStock: true,
        addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p2', quantity: 1 } },
      },
    ],
  };

  it('multiple adds reuse one cart — create_cart fires exactly once', async () => {
    const root = document.createElement('div');
    const { ctx, calls } = ctxWithCart();
    renderProductList(root, twoProductModel, ctx);
    const buttons = root.querySelectorAll('.syn-btn-primary');

    (buttons[0] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'add_to_cart')).toHaveLength(1));
    (buttons[1] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'add_to_cart')).toHaveLength(2));

    expect(calls.filter((c) => c[0] === 'create_cart')).toHaveLength(1);
    const adds = calls.filter((c) => c[0] === 'add_to_cart');
    expect(adds[0][1].cart_id).toBe('c1');
    expect(adds[1][1].cart_id).toBe('c1');
  });

  it('two simultaneous adds still create only one cart (race latch)', async () => {
    const root = document.createElement('div');
    const { ctx, calls } = ctxWithCart();
    renderProductList(root, twoProductModel, ctx);
    const buttons = root.querySelectorAll('.syn-btn-primary');

    // Fire both clicks before the first create_cart resolves — the race.
    (buttons[0] as HTMLButtonElement).click();
    (buttons[1] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'add_to_cart')).toHaveLength(2));

    expect(calls.filter((c) => c[0] === 'create_cart')).toHaveLength(1);
    const adds = calls.filter((c) => c[0] === 'add_to_cart');
    expect(adds[0][1].cart_id).toBe('c1');
    expect(adds[1][1].cart_id).toBe('c1');
  });

  function bagCtx() {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const results: unknown[] = [];
    const messages: string[] = [];
    const ctx: ViewCtx = {
      callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push([name, args]);
        if (name === 'create_cart') return { content: [{ type: 'text', text: '{"cart_id":"c1"}' }] };
        if (name === 'add_to_cart') return { content: [{ type: 'text', text: 'ok' }], structuredContent: { items: [{ qty: 1 }] } };
        if (name === 'get_cart') return {
          content: [{ type: 'text', text: 'cart' }],
          structuredContent: { kind: 'cart', siteId: 's1', cartId: 'c1', items: [{ itemId: 'i1', title: 'Vintage Tee', qty: 1, unitPrice: '$26.00', lineTotal: '$26.00' }], subtotal: '$26.00', total: '$26.00' },
        };
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
      onResult: (r) => results.push(r),
      sendMessage: (t) => messages.push(t),
    };
    return { ctx, calls, results, messages };
  }

  it('after an add, the bag opens the cart in-frame (get_cart, no chat round-trip)', async () => {
    const root = document.createElement('div');
    const { ctx, calls, results, messages } = bagCtx();
    renderProductList(root, listModel, ctx);
    (root.querySelector('.syn-btn-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.find((c) => c[0] === 'add_to_cart')).toBeTruthy());

    (root.querySelector('.syn-bag') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.find((c) => c[0] === 'get_cart')).toBeTruthy());

    expect(calls.find((c) => c[0] === 'get_cart')![1]).toMatchObject({ site_id: 's1', cart_id: 'c1' });
    expect(messages).toHaveLength(0);          // never punts to the model
    expect(results.length).toBeGreaterThan(0); // cart rendered in-place
  });

  it('bag click with an empty cart does not round-trip the model', async () => {
    const root = document.createElement('div');
    const { ctx, calls, messages } = bagCtx();
    renderProductList(root, listModel, ctx);
    (root.querySelector('.syn-bag') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(messages).toHaveLength(0);
    expect(calls.find((c) => c[0] === 'get_cart')).toBeFalsy();
  });

  it('adopts the server-returned cart_id when an add swaps the cart', async () => {
    sessionStorage.setItem('active_cart_s1', 'old_cart'); // stale id from a prior conversation
    const root = document.createElement('div');
    const calls: Array<[string, Record<string, unknown>]> = [];
    const ctx: ViewCtx = {
      callTool: vi.fn(async (name: string, args: Record<string, unknown>) => {
        calls.push([name, args]);
        if (name === 'add_to_cart') return { content: [{ type: 'text', text: 'ok' }], structuredContent: { kind: 'cart', cartId: 'new_cart', items: [{ qty: 1 }] } };
        if (name === 'get_cart') return { content: [{ type: 'text', text: 'ok' }], structuredContent: { kind: 'cart', siteId: 's1', cartId: 'new_cart', items: [{ qty: 1 }], subtotal: '', total: '' } };
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
      onResult: vi.fn(),
    };
    renderProductList(root, listModel, ctx);
    (root.querySelector('.syn-btn-primary') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.find((c) => c[0] === 'add_to_cart')).toBeTruthy());
    expect(calls.find((c) => c[0] === 'add_to_cart')![1].cart_id).toBe('old_cart');

    (root.querySelector('.syn-bag') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(calls.find((c) => c[0] === 'get_cart')).toBeTruthy());
    expect(calls.find((c) => c[0] === 'get_cart')![1].cart_id).toBe('new_cart');
  });

  it('bag clears a stale cart when get_cart reports Cart not found', async () => {
    sessionStorage.setItem('active_cart_s1', 'gone_cart'); // points at an expired/gone cart
    sessionStorage.setItem('cart_count_s1', '3');
    const root = document.createElement('div');
    const ctx: ViewCtx = {
      callTool: vi.fn(async (name: string) => {
        if (name === 'get_cart') return { content: [{ type: 'text', text: 'Error: Cart not found.' }], isError: true };
        return { content: [{ type: 'text', text: 'ok' }] };
      }),
      onResult: vi.fn(),
    };
    renderProductList(root, listModel, ctx);
    (root.querySelector('.syn-bag') as HTMLButtonElement).click();

    await vi.waitFor(() => expect(sessionStorage.getItem('active_cart_s1')).toBeNull());
    expect(sessionStorage.getItem('cart_count_s1')).toBeNull();
  });
});

const productModel: ProductCardModel = {
  kind: 'product',
  siteId: 's1', productId: 'p1', title: 'Custom Mug', price: '$15.00', inStock: true,
  images: ['https://img.test/1.jpg', 'https://img.test/2.jpg'],
  image: 'https://img.test/1.jpg',
  addons: [
    { addonId: 'engraving', label: 'Engraving', type: 'select', required: true,
      options: [{ value: 'gold', label: 'Gold' }, { value: 'silver', label: 'Silver' }] },
  ],
  addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p1', quantity: 1 } },
};

describe('renderProduct', () => {
  it('renders the wizard hero image for an options product', () => {
    const root = document.createElement('div');
    const { ctx } = ctxWithCart();
    renderProduct(root, productModel, ctx);
    const hero = root.querySelector('.syn-wizard-hero img') as HTMLImageElement;
    expect(hero).toBeTruthy();
    expect(hero.src).toContain('img.test/1.jpg');
  });

  it('a required addon opens the customize wizard directly (dropdown, no add yet)', async () => {
    const root = document.createElement('div');
    const { ctx, calls } = ctxWithCart();
    renderProduct(root, productModel, ctx); // productModel has a required addon
    expect(root.querySelector('.syn-wizard')).toBeTruthy();
    expect(root.querySelector('.syn-dd')).toBeTruthy(); // addon dropdown, no "Select options" gate
    await new Promise((r) => setTimeout(r, 0));
    expect(calls.filter((c) => c[0] !== 'get_cart')).toHaveLength(0);
  });

  it('a simple product (no variants, no addons) renders a list row with Add to cart', async () => {
    const simple: ProductCardModel = {
      kind: 'product', siteId: 's1', productId: 'p2', title: 'Plain Tee', price: '$10.00', inStock: true,
      addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p2', quantity: 1 } },
    };
    const root = document.createElement('div');
    const { ctx, calls } = ctxWithCart();
    renderProduct(root, simple, ctx);
    expect(root.querySelector('.syn-row')).toBeTruthy(); // rendered as a list row, not a detail card
    const addBtn = root.querySelector('.syn-btn-primary') as HTMLButtonElement;
    expect(addBtn.textContent).toContain('Add to cart');
    addBtn.click();
    await vi.waitFor(() => expect(calls.find((c) => c[0] === 'add_to_cart')).toBeTruthy());
  });

  it('a product with attribute-less variants opens the wizard with a Variant dropdown', () => {
    const variantModel: ProductCardModel = {
      kind: 'product', siteId: 's1', productId: 'p3', title: 'Wine', price: '$20.00', inStock: true,
      variants: [
        { variantId: 'v1', title: 'Reserva', price: '$20.00', inStock: true },
        { variantId: 'v2', title: 'Crianza', price: '$22.00', inStock: true },
      ],
      addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p3', quantity: 1 } },
    };
    const root = document.createElement('div');
    const { ctx } = ctxWithCart();
    renderProduct(root, variantModel, ctx);
    expect(root.querySelector('.syn-dd')).toBeTruthy();
    // Reserva + Crianza option rows
    expect(root.querySelectorAll('.syn-dd-opt')).toHaveLength(2);
  });
});

const matrixModel: ProductCardModel = {
  kind: 'product', siteId: 's1', productId: 'p9', title: 'Merino Tee', price: 'GHS 120.00', inStock: true,
  image: 'https://img.test/base.jpg',
  variants: [
    { variantId: '1', title: 'S/Red', price: 'GHS 120.00', inStock: true, image: 'https://img.test/red.jpg', attributes: [{ name: 'Size', value: 'S' }, { name: 'Colour', value: 'Red' }] },
    { variantId: '2', title: 'M/Red', price: 'GHS 120.00', inStock: true, image: 'https://img.test/red.jpg', attributes: [{ name: 'Size', value: 'M' }, { name: 'Colour', value: 'Red' }] },
    { variantId: '3', title: 'M/Green', price: 'GHS 120.00', inStock: false, attributes: [{ name: 'Size', value: 'M' }, { name: 'Colour', value: 'Green' }] },
  ],
  addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p9', quantity: 1 } },
};

// Open a wizard dropdown (by its visible label) and click the option with `value`.
const pickOption = (root: HTMLElement, label: string, value: string) => {
  const rows = Array.from(root.querySelectorAll('.syn-optrow'));
  const row = rows.find((r) => (r.querySelector('.syn-optlabel')?.textContent || '').startsWith(label));
  const dd = row!.querySelector('.syn-dd') as HTMLElement;
  (dd.querySelector('.syn-dd-trigger') as HTMLButtonElement).click(); // open panel
  const opt = Array.from(dd.querySelectorAll('.syn-dd-opt')).find((o) => o.textContent?.includes(value)) as HTMLButtonElement;
  opt.click();
};
const clickByText = (root: HTMLElement, text: string) => {
  const btn = Array.from(root.querySelectorAll('.syn-btn-primary')).find((b) => (b.textContent || '').toLowerCase().includes(text.toLowerCase())) as HTMLButtonElement;
  btn.click();
};

describe('renderProduct — attribute matrix', () => {
  it('opens the wizard with one dropdown per axis', () => {
    const root = document.createElement('div'); const { ctx } = ctxWithCart();
    renderProduct(root, matrixModel, ctx);
    const rows = root.querySelectorAll('.syn-optrow');
    expect(rows.length).toBe(2); // Size + Colour
    const labels = Array.from(root.querySelectorAll('.syn-optlabel')).map((l) => l.textContent);
    expect(labels.some((l) => l!.startsWith('Size'))).toBe(true);
    expect(labels.some((l) => l!.startsWith('Colour'))).toBe(true);
    expect(root.querySelectorAll('.syn-dd').length).toBe(2);
  });

  it('keeps the shopping bag visible in the wizard', () => {
    const root = document.createElement('div'); const { ctx } = ctxWithCart();
    renderProduct(root, matrixModel, ctx);
    expect(root.querySelector('.syn-bag')).toBeTruthy(); // floats on the hero
  });

  it('marks an out-of-stock-only value as a disabled option', () => {
    const root = document.createElement('div'); const { ctx } = ctxWithCart();
    renderProduct(root, matrixModel, ctx);
    // Green only exists as M/Green which is out of stock → its option button is disabled.
    const colourRow = Array.from(root.querySelectorAll('.syn-optrow')).find((r) => (r.querySelector('.syn-optlabel')?.textContent || '').startsWith('Colour'));
    const green = Array.from(colourRow!.querySelectorAll('.syn-dd-opt')).find((o) => o.textContent === 'Green') as HTMLButtonElement;
    expect(green.disabled).toBe(true);
  });

  it('renders a single Variant dropdown when variants have no attributes', () => {
    const flat: ProductCardModel = { ...matrixModel, variants: matrixModel.variants!.map((v) => ({ ...v, attributes: undefined })) };
    const root = document.createElement('div'); const { ctx } = ctxWithCart();
    renderProduct(root, flat, ctx);
    const rows = root.querySelectorAll('.syn-optrow');
    expect(rows.length).toBe(1);
    expect(root.querySelector('.syn-optlabel')!.textContent).toContain('Variant');
    // 3 variant option rows in the panel
    expect(root.querySelectorAll('.syn-dd-opt')).toHaveLength(3);
  });
});

describe('renderProduct — variant resolution → add / hero', () => {
  it('resolving a variant carries variant_id on Add and shows that variant’s price at review', async () => {
    const root = document.createElement('div');
    const { ctx, calls } = ctxWithCart();
    renderProduct(root, matrixModel, ctx);

    // Resolve S/Red (variantId '1', in stock).
    pickOption(root, 'Size', 'S');
    pickOption(root, 'Colour', 'Red');
    clickByText(root, 'Next'); // customize → review

    // Review reflects the resolved variant's price.
    expect(root.textContent).toContain('GHS 120.00');

    clickByText(root, 'Add to cart');
    await vi.waitFor(() => expect(calls.find((c) => c[0] === 'add_to_cart')).toBeTruthy());
    const add = calls.find((c) => c[0] === 'add_to_cart')!;
    expect(add[1]).toMatchObject({ site_id: 's1', product_id: 'p9', quantity: 1, variant_id: '1', cart_id: 'c1' });
  });

  it('swaps the hero image to the selected variant’s image once a full set is picked', () => {
    const root = document.createElement('div');
    const { ctx } = ctxWithCart();
    renderProduct(root, matrixModel, ctx);
    const hero = root.querySelector('.syn-wizard-hero img') as HTMLImageElement;
    expect(hero.src).toContain('img.test/base.jpg'); // base image before any selection

    pickOption(root, 'Size', 'S');
    pickOption(root, 'Colour', 'Red'); // resolves S/Red, whose image is red.jpg

    expect((root.querySelector('.syn-wizard-hero img') as HTMLImageElement).src).toContain('img.test/red.jpg');
  });

  it('reverts the hero to the product base image when the resolved variant has no image', () => {
    // S has its own image, M does not. Selecting M must fall back to the base image.
    const mixedImgModel: ProductCardModel = {
      kind: 'product', siteId: 's1', productId: 'p11', title: 'Mixed Tee', price: 'GHS 90.00', inStock: true,
      image: 'https://img.test/base.jpg',
      variants: [
        { variantId: 'x', title: 'S', price: 'GHS 90.00', inStock: true, image: 'https://img.test/red.jpg', attributes: [{ name: 'Size', value: 'S' }] },
        { variantId: 'y', title: 'M', price: 'GHS 90.00', inStock: true, attributes: [{ name: 'Size', value: 'M' }] },
      ],
      addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p11', quantity: 1 } },
    };
    const root = document.createElement('div');
    const { ctx } = ctxWithCart();
    renderProduct(root, mixedImgModel, ctx);

    pickOption(root, 'Size', 'S'); // resolves variant 'x' → hero shows its image
    expect((root.querySelector('.syn-wizard-hero img') as HTMLImageElement).src).toContain('img.test/red.jpg');

    pickOption(root, 'Size', 'M'); // resolves variant 'y' (no image) → hero reverts to base image
    expect((root.querySelector('.syn-wizard-hero img') as HTMLImageElement).src).toContain('img.test/base.jpg');
  });
});

describe('renderProductList — products needing options', () => {
  const listWithOptions: ProductListCardModel = {
    kind: 'productList', siteId: 's1',
    products: [
      { productId: 'p1', title: 'Simple Tee', price: 'GHS 10.00', inStock: true,
        addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p1', quantity: 1 } } },
      { productId: 'p2', title: 'Wine (variants)', price: 'from GHS 120.00', inStock: true, hasOptions: true,
        addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p2', quantity: 1 } } },
    ],
  };

  it('renders "Add to cart" that opens the options wizard for a product that needs options', async () => {
    const root = document.createElement('div');
    const calls: Array<[string, Record<string, unknown>]> = [];
    const ctx: ViewCtx = {
      callTool: vi.fn(async (n: string, a: Record<string, unknown>) => { calls.push([n, a]); return { content: [{ type: 'text', text: 'ok' }], structuredContent: { kind: 'product', siteId: 's1', productId: 'p2', title: 'Wine', price: 'GHS 120.00', inStock: true } }; }),
      onResult: vi.fn(),
    };
    renderProductList(root, listWithOptions, ctx);
    const rows = root.querySelectorAll('.syn-row');
    // p2's row (Figma parity): an "Add to cart" button + a qty stepper; the button
    // opens the customize wizard (get_product) rather than adding directly.
    const p2 = rows[1];
    const btn = p2.querySelector('.syn-btn-primary') as HTMLButtonElement;
    expect(btn.textContent).toContain('Add to cart');
    expect(p2.querySelector('.syn-qty')).not.toBeNull();
    // clicking it fetches the full product (in-frame) and renders via onResult
    btn.click();
    await vi.waitFor(() => expect(calls.find((c) => c[0] === 'get_product')).toBeTruthy());
    expect(calls.find((c) => c[0] === 'get_product')![1]).toMatchObject({ site_id: 's1', product_id: 'p2' });
    expect(ctx.onResult).toHaveBeenCalled();
  });

  it('keeps inline qty + Add to cart for a simple product', () => {
    const root = document.createElement('div'); const { ctx } = ctxWithCart();
    renderProductList(root, listWithOptions, ctx);
    const p1 = root.querySelectorAll('.syn-row')[0];
    expect(p1.querySelector('.syn-qty')).toBeTruthy();
    expect((p1.querySelector('.syn-btn-primary') as HTMLButtonElement).textContent).toContain('Add to cart');
  });
});

describe('renderProduct — many optional radios reaches a usable review step', () => {
  const radioAddon = (id: string, n: number) => ({
    addonId: id, label: id, type: 'radio' as const, required: false, multiple: false,
    options: Array.from({ length: n }, (_, i) => ({ value: `${id}-${i}`, label: `${id} ${i}` })),
  });
  const cakeModel: ProductCardModel = {
    kind: 'product', siteId: 's1', productId: '1200', title: 'Customise Your Cake', price: 'GHS 10.00', inStock: true,
    addons: [radioAddon('size', 3), radioAddon('icing', 3), radioAddon('base', 18), radioAddon('filling', 7), radioAddon('buttercream', 6), radioAddon('topping', 7), radioAddon('decorations', 8)],
    addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: '1200', quantity: 1 } },
  };

  it('reaches the review step with a working Add to cart (no blank body)', () => {
    const root = document.createElement('div'); const { ctx } = ctxWithCart();
    renderProduct(root, cakeModel, ctx);
    (root.querySelector('.syn-btn-primary') as HTMLButtonElement).click(); // open wizard (Select options)
    // advance: addons step → review (these are all optional, so Next should proceed)
    const clickNext = () => {
      const next = Array.from(root.querySelectorAll('.syn-btn-primary')).find((b) => b.textContent === 'Next') as HTMLButtonElement | undefined;
      if (next) next.click();
    };
    clickNext(); // addons -> review
    // review step must offer Add to cart
    const addBtn = Array.from(root.querySelectorAll('.syn-btn-primary')).find((b) => (b.textContent || '').toLowerCase().includes('add to cart'));
    expect(addBtn, 'review step should render an Add to cart button').toBeTruthy();
  });
});

describe('renderProduct — no-options layout', () => {
  const simple: ProductCardModel = { kind: 'product', siteId: 's1', productId: 'p1', title: 'Plain', price: 'GHS 10.00', inStock: true, addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p1', quantity: 1 } } };
  it('a no-options product renders as a single list row (no bespoke detail card)', () => {
    const root = document.createElement('div'); const { ctx } = ctxWithCart();
    renderProduct(root, simple, ctx);
    expect(root.querySelector('.syn-row')).toBeTruthy();
    expect(root.querySelector('.syn-wizard')).toBeNull();
  });
});

describe('renderProduct — always shows the bag', () => {
  const simple2: ProductCardModel = { kind: 'product', siteId: 's1', productId: 'p1', title: 'Plain', price: 'GHS 10.00', inStock: true, addToCart: { label: 'Add to cart', toolName: 'add_to_cart', params: { site_id: 's1', product_id: 'p1', quantity: 1 } } };
  it('renders the shopping bag even before any cart exists', () => {
    const root = document.createElement('div'); const { ctx } = ctxWithCart();
    renderProduct(root, simple2, ctx);
    expect(root.querySelector('.syn-bag')).toBeTruthy();
  });
});
