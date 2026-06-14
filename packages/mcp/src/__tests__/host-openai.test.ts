// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isOpenAiHost, bootOpenAi } from '../ui/host-openai.js';
import type { CardModel } from '../cards/types.js';

describe('host-openai adapter', () => {
  beforeEach(() => { delete (window as any).openai; });
  afterEach(() => { delete (window as any).openai; });

  it('isOpenAiHost is false without window.openai, true with it', () => {
    expect(isOpenAiHost()).toBe(false);
    (window as any).openai = {};
    expect(isOpenAiHost()).toBe(true);
  });

  it('renders the initial toolOutput model', () => {
    const model = { kind: 'cart', siteId: 's1', cartId: 'c1', items: [], subtotal: '0', total: '0' };
    (window as any).openai = { toolOutput: model };
    const root = document.createElement('div');
    const render = vi.fn();
    bootOpenAi(root, render);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0]).toBe(model);
  });

  it('re-renders on the openai:set_globals event', () => {
    const first = { kind: 'cart', siteId: 's1', cartId: 'c1', items: [], subtotal: '0', total: '0' };
    (window as any).openai = { toolOutput: first };
    const root = document.createElement('div');
    const render = vi.fn();
    bootOpenAi(root, render);

    const next = { kind: 'cart', siteId: 's1', cartId: 'c1', items: [], subtotal: '5', total: '5' };
    (window as any).openai.toolOutput = next;
    window.dispatchEvent(new CustomEvent('openai:set_globals', { detail: { globals: { toolOutput: next } } }));
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1][0]).toBe(next);
  });

  it('routes ctx.callTool through window.openai.callTool and normalises the result', async () => {
    const toolResult = { structuredContent: { kind: 'cart', siteId: 's1', cartId: 'c1', items: [], subtotal: '0', total: '0' } };
    const callTool = vi.fn(async () => toolResult);
    (window as any).openai = { toolOutput: { kind: 'cart', siteId: 's1', cartId: 'c1', items: [], subtotal: '0', total: '0' }, callTool };
    const root = document.createElement('div');
    let captured: any;
    bootOpenAi(root, (_m, ctx) => { captured = ctx; });
    const res = await captured.callTool('get_cart', { site_id: 's1', cart_id: 'c1' });
    expect(callTool).toHaveBeenCalledWith('get_cart', { site_id: 's1', cart_id: 'c1' });
    expect((res as any).structuredContent).toEqual(toolResult.structuredContent);
  });

  it('wraps a bare CardModel return as structuredContent', async () => {
    const bare = { kind: 'cart', siteId: 's1', cartId: 'c1', items: [], subtotal: '0', total: '0' } as CardModel;
    const callTool = vi.fn(async () => bare);
    (window as any).openai = { toolOutput: bare, callTool };
    const root = document.createElement('div');
    let captured: any;
    bootOpenAi(root, (_m, ctx) => { captured = ctx; });
    const res = await captured.callTool('get_cart', {});
    expect((res as any).structuredContent).toBe(bare);
  });

  it('tags the document with the openai host + theme for the Apps-SDK style overrides', () => {
    (window as any).openai = { toolOutput: { kind: 'cart', siteId: 's1', cartId: 'c1', items: [], subtotal: '0', total: '0' }, theme: 'dark', locale: 'en-US' };
    const root = document.createElement('div');
    bootOpenAi(root, () => {});
    expect(document.documentElement.getAttribute('data-syn-host')).toBe('openai');
    expect(document.documentElement.getAttribute('data-syn-theme')).toBe('dark');
    expect(document.documentElement.lang).toBe('en-US');
  });

  it('sendMessage maps to sendFollowupMessage', () => {
    const sendFollowupMessage = vi.fn();
    (window as any).openai = { toolOutput: { kind: 'cart', siteId: 's1', cartId: 'c1', items: [], subtotal: '0', total: '0' }, sendFollowupMessage };
    const root = document.createElement('div');
    let captured: any;
    bootOpenAi(root, (_m, ctx) => { captured = ctx; });
    captured.sendMessage('keep shopping');
    expect(sendFollowupMessage).toHaveBeenCalledWith({ prompt: 'keep shopping' });
  });
});
