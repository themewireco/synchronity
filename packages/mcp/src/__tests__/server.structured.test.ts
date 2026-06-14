// sdk/mcp/src/__tests__/server.structured.test.ts
import { describe, it, expect } from 'vitest';
import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createMCPServer, toCallToolResult } from '../server.js';

describe('CallTool forwards Apps SDK fields', () => {
  it('registers a CallTool handler (structuredContent forwarding is unit-tested via toCallToolResult below)', async () => {
    const server = createMCPServer({ gatewayUrl: 'https://gw.test', ait: 't' }) as any;
    const method = CallToolRequestSchema.shape.method.value;
    const h = server['_requestHandlers'].get(method);
    expect(typeof h).toBe('function');
  });
});

describe('toCallToolResult', () => {
  it('wraps a string', () => {
    expect(toCallToolResult('hi')).toEqual({ content: [{ type: 'text', text: 'hi' }] });
  });
  it('wraps an MCPContent[]', () => {
    const r = toCallToolResult([{ type: 'text', text: 'x' }] as any);
    expect(r.content[0]).toEqual({ type: 'text', text: 'x' });
    expect(r.structuredContent).toBeUndefined();
  });
  it('forwards CardToolResult fields', () => {
    const r = toCallToolResult({ content: [{ type: 'text', text: 'f' }] as any,
      structuredContent: { card: { kind: 'cart' } }, _meta: { 'openai/outputTemplate': 'ui://synchronity/cart' } });
    expect(r.structuredContent).toEqual({ card: { kind: 'cart' } });
    expect(r._meta).toEqual({ 'openai/outputTemplate': 'ui://synchronity/cart' });
    expect(r.content[0]).toEqual({ type: 'text', text: 'f' });
  });
});
