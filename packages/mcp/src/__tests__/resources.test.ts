import { describe, it, expect } from 'vitest';
import { listUiResources, readUiResource, RESOURCE_MIME_TYPE } from '../cards/resources.js';

describe('MCP Apps UI resources', () => {
  it('lists the two product Views with the mcp-app mime + _meta.ui CSP', () => {
    const res = listUiResources();
    const uris = res.map((r) => r.uri).sort();
    expect(uris).toEqual(['ui://synchronity/cart', 'ui://synchronity/multi-cart', 'ui://synchronity/product', 'ui://synchronity/product-list']);
    for (const r of res) {
      expect(r.mimeType).toBe(RESOURCE_MIME_TYPE);
      expect((r as any)._meta.ui.csp).toBeDefined();
      expect((r as any)._meta.ui.csp.connectDomains).toEqual([]);
    }
  });

  it('reads a known View as self-contained HTML carrying the inlined bundle', () => {
    const out = readUiResource('ui://synchronity/product');
    expect(out).toBeDefined();
    const c = out!.contents[0];
    expect(c.uri).toBe('ui://synchronity/product');
    expect(c.mimeType).toBe(RESOURCE_MIME_TYPE);
    expect(c.text).toContain('<!doctype html>');
    expect(c.text).toContain('id="syn-root"');
    expect(c.text).toContain('<script>');
    // Bundle is non-trivial (ext-apps + sdk + view code inlined).
    expect(c.text.length).toBeGreaterThan(10_000);
    // The </script escape guard must not leave a raw closing tag inside the script.
    const scriptBody = c.text.slice(c.text.indexOf('<script>') + 8, c.text.lastIndexOf('</script>'));
    expect(scriptBody.toLowerCase()).not.toContain('</script');
  });

  it('returns undefined for an unknown resource URI', () => {
    expect(readUiResource('ui://synchronity/nope')).toBeUndefined();
  });
});
