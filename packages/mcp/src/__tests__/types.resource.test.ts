// sdk/mcp/src/__tests__/types.resource.test.ts
import { describe, it, expect } from 'vitest';
import type { MCPContent, MCPResourceContent } from '../types.js';

describe('MCPResourceContent', () => {
  it('is assignable to MCPContent and carries an embedded ui:// resource', () => {
    const block: MCPResourceContent = {
      type: 'resource',
      resource: { uri: 'ui://synchronity/product', mimeType: 'text/html', text: '<div></div>' },
    };
    const content: MCPContent[] = [block];
    expect(content[0].type).toBe('resource');
  });
});
