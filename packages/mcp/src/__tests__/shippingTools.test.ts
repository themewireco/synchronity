import { describe, it, expect, vi } from 'vitest';
import { setShippingAddress, selectShippingOption } from '../tools.js';

describe('shipping tools', () => {
  it('set_shipping_address calls the SDK with all args', async () => {
    const client = {
      cart: { setShippingAddress: vi.fn(async () => ({ cart_id: 'c1' })) },
    } as any;
    const out = await setShippingAddress(client, {
      site_id: 's1',
      cart_id: 'c1',
      country_code: 'US',
      postal_code: '90210',
      state: 'CA',
      city: 'Beverly Hills',
    }, {} as any);
    expect(client.cart.setShippingAddress).toHaveBeenCalledWith('s1', 'c1', {
      country_code: 'US',
      postal_code: '90210',
      state: 'CA',
      city: 'Beverly Hills',
    });
    const arr = (out as any).content ?? [];
    const textBlock = arr.find((b: any) => b.type === 'text');
    expect(textBlock.text).toContain('c1');
  });

  it('set_shipping_address calls the SDK with only required args', async () => {
    const client = {
      cart: { setShippingAddress: vi.fn(async () => ({ cart_id: 'c1' })) },
    } as any;
    const out = await setShippingAddress(client, {
      site_id: 's1',
      cart_id: 'c1',
      country_code: 'US',
    }, {} as any);
    expect(client.cart.setShippingAddress).toHaveBeenCalledWith('s1', 'c1', {
      country_code: 'US',
      postal_code: undefined,
      state: undefined,
      city: undefined,
    });
    const arr = (out as any).content ?? [];
    const textBlock = arr.find((b: any) => b.type === 'text');
    expect(textBlock.text).toContain('c1');
  });

  it('set_shipping_address throws if required args are missing', async () => {
    const client = {
      cart: { setShippingAddress: vi.fn() },
    } as any;
    await expect(
      setShippingAddress(client, { site_id: 's1', cart_id: 'c1' }, {} as any),
    ).rejects.toThrow('site_id, cart_id, and country_code are required');
  });

  it('select_shipping_option calls the SDK', async () => {
    const client = {
      cart: { selectShippingOption: vi.fn(async () => ({ cart_id: 'c1' })) },
    } as any;
    const out = await selectShippingOption(client, {
      site_id: 's1',
      cart_id: 'c1',
      option_id: 'g1|standard',
    }, {} as any);
    expect(client.cart.selectShippingOption).toHaveBeenCalledWith('s1', 'c1', 'g1|standard');
    const arr = (out as any).content ?? [];
    const textBlock = arr.find((b: any) => b.type === 'text');
    expect(textBlock.text).toContain('c1');
  });

  it('select_shipping_option throws if required args are missing', async () => {
    const client = {
      cart: { selectShippingOption: vi.fn() },
    } as any;
    await expect(
      selectShippingOption(client, { site_id: 's1', cart_id: 'c1' }, {} as any),
    ).rejects.toThrow('site_id, cart_id, and option_id are required');
  });
});
