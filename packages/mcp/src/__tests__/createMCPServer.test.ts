import { describe, it, expect } from 'vitest';
import { createMCPServer } from '../server.js';

const EXPECTED_TOOLS = [
  'list_sites',
  'search_products',
  'get_product',
  'get_product_reviews',
  'request_back_in_stock',
  'compare_products',
  'create_cart',
  'add_to_cart',
  'quick_checkout',
  'remove_from_cart',
  'set_cart_quantity',
  'apply_coupon',
  'get_cart',
  'get_active_cart',
  'set_shipping_address',
  'select_shipping_option',
  'execute_checkout',
  'get_order',
  'list_orders',
  'request_delegation',
  'submit_delegation_otp',
  'check_delegation',
  'get_payment_methods',
  'initiate_payment',
  'submit_payment_otp',
  'get_payment_status',
];

const PAYMENT_TOOLS = [
  'get_payment_methods',
  'initiate_payment',
  'submit_payment_otp',
  'get_payment_status',
];

describe('createMCPServer()', () => {
  it('returns a Server instance with all tools registered', async () => {
    const server = createMCPServer({
      gatewayUrl: 'https://api.synchronity.app',
      ait: 'test-ait',
    });

    expect(server).toBeDefined();
    expect(typeof server.connect).toBe('function');
    expect(typeof server.setRequestHandler).toBe('function');

    const listToolsHandler = (server as any)._requestHandlers?.get('tools/list');
    expect(listToolsHandler).toBeTypeOf('function');

    const response = await listToolsHandler?.({ method: 'tools/list', params: {} }, undefined);
    const toolNames = response?.tools?.map((tool: { name: string }) => tool.name) ?? [];

    expect(toolNames).toEqual(expect.arrayContaining(EXPECTED_TOOLS));
    expect(toolNames).toHaveLength(EXPECTED_TOOLS.length);
  });

  it('registers the four inline-payment tools with correct schemas', async () => {
    const server = createMCPServer({ gatewayUrl: 'https://example.test', ait: 'test-ait' });
    const listToolsHandler = (server as any)._requestHandlers?.get('tools/list');
    const response = await listToolsHandler?.({ method: 'tools/list', params: {} }, undefined);
    const tools: Array<{ name: string; inputSchema: any }> = response?.tools ?? [];

    const byName = (n: string) => tools.find((t) => t.name === n);

    for (const name of PAYMENT_TOOLS) {
      const tool = byName(name);
      expect(tool, `tool ${name} should be registered`).toBeDefined();
      // site_id is always optional (resolves from DEFAULT_SITE_ID); order_id always required.
      expect(tool!.inputSchema.properties.site_id).toBeDefined();
      expect(tool!.inputSchema.required).toContain('order_id');
      expect(tool!.inputSchema.required).not.toContain('site_id');
    }

    expect(byName('initiate_payment')!.inputSchema.required).toEqual(
      expect.arrayContaining(['order_id', 'channel']),
    );
    expect(byName('initiate_payment')!.inputSchema.properties.channel.enum).toEqual([
      'mobile_money',
      'card',
    ]);
    expect(byName('initiate_payment')!.inputSchema.properties.provider.enum).toEqual(
      expect.arrayContaining(['mtn', 'vod', 'tgo', 'telecel', 'vodafone']),
    );
    expect(byName('initiate_payment')!.inputSchema.properties.buyer_delegation_token).toBeDefined();

    expect(byName('submit_payment_otp')!.inputSchema.required).toEqual(
      expect.arrayContaining(['order_id', 'otp']),
    );
  });

  it('exposes an optional addons property on add_to_cart', async () => {
    const server = createMCPServer({ gatewayUrl: 'https://example.test', ait: 'test-ait' });
    const listToolsHandler = (server as any)._requestHandlers?.get('tools/list');
    const response = await listToolsHandler?.({ method: 'tools/list', params: {} }, undefined);
    const tools: Array<{ name: string; inputSchema: any }> = response?.tools ?? [];

    const addToCart = tools.find((t) => t.name === 'add_to_cart');
    expect(addToCart).toBeDefined();
    expect(addToCart!.inputSchema.properties.addons).toBeDefined();
    expect(addToCart!.inputSchema.properties.addons.type).toBe('object');
    // addons is optional. Only site_id is hard-required now: cart_id is resolved/created by the
    // impl, and product_id+quantity are the single-add alternative to the items[] batch param.
    expect(addToCart!.inputSchema.required).not.toContain('addons');
    expect(addToCart!.inputSchema.required).toEqual(['site_id']);
    // items[] batch param is exposed and optional.
    expect(addToCart!.inputSchema.properties.items).toBeDefined();
    expect(addToCart!.inputSchema.required).not.toContain('items');
  });
});

describe('payment tool implementations', () => {
  it('call the correct gateway paths', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = [];

    // Minimal fake client mirroring the SDK payments module surface used by tools.
    const client = {
      payments: {
        getMethods: async (siteId: string, orderId: string) => {
          calls.push({ method: 'GET', path: `/v1/sites/${siteId}/orders/${orderId}/payment/methods` });
          return { channels: ['mobile_money', 'card'] };
        },
        initiate: async (siteId: string, orderId: string, params: any) => {
          calls.push({ method: 'POST', path: `/v1/sites/${siteId}/orders/${orderId}/payment/initiate`, body: params });
          return { order_id: orderId, reference: 'ref', channel: params.channel, payment_status: 'awaiting_user' };
        },
        submitOtp: async (siteId: string, orderId: string, params: any) => {
          calls.push({ method: 'POST', path: `/v1/sites/${siteId}/orders/${orderId}/payment/submit-otp`, body: params });
          return { order_id: orderId, reference: 'ref', channel: 'mobile_money', payment_status: 'processing' };
        },
        getStatus: async (siteId: string, orderId: string) => {
          calls.push({ method: 'GET', path: `/v1/sites/${siteId}/orders/${orderId}/payment/status` });
          return { order_id: orderId, reference: 'ref', channel: 'card', payment_status: 'paid' };
        },
      },
    } as any;

    const config = { gatewayUrl: 'https://example.test', ait: 'test-ait' } as any;

    const { getToolImplementation } = await import('../tools.js');

    await getToolImplementation('get_payment_methods')!(client, { site_id: 's1', order_id: 'o1' }, config);
    await getToolImplementation('initiate_payment')!(
      client,
      { site_id: 's1', order_id: 'o1', channel: 'mobile_money', phone: '0241234567', provider: 'mtn', buyer_delegation_token: 'tok' },
      config,
    );
    await getToolImplementation('submit_payment_otp')!(
      client,
      { site_id: 's1', order_id: 'o1', otp: '123456', buyer_delegation_token: 'tok' },
      config,
    );
    await getToolImplementation('get_payment_status')!(client, { site_id: 's1', order_id: 'o1' }, config);

    expect(calls).toEqual([
      { method: 'GET', path: '/v1/sites/s1/orders/o1/payment/methods' },
      {
        method: 'POST',
        path: '/v1/sites/s1/orders/o1/payment/initiate',
        body: { channel: 'mobile_money', phone: '0241234567', provider: 'mtn', buyer_delegation_token: 'tok' },
      },
      { method: 'POST', path: '/v1/sites/s1/orders/o1/payment/submit-otp', body: { otp: '123456', buyer_delegation_token: 'tok' } },
      { method: 'GET', path: '/v1/sites/s1/orders/o1/payment/status' },
    ]);
  });

  it('initiate_payment requires phone+provider for mobile_money', async () => {
    const { getToolImplementation } = await import('../tools.js');
    const client = { payments: {} } as any;
    await expect(
      getToolImplementation('initiate_payment')!(
        client,
        { site_id: 's1', order_id: 'o1', channel: 'mobile_money' },
        {} as any,
      ),
    ).rejects.toThrow(/phone and provider/);
  });
});
