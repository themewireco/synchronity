import { describe, it, expect } from 'vitest';
import { listUiResources, listUiResourceTemplates, readUiResource, RESOURCE_MIME_TYPE, OPENAI_MIME_TYPE } from '../cards/resources.js';

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

describe('UI resources carry ChatGPT widget polish meta', () => {
  it('every resource has openai/widgetDescription and toolInvocation strings', () => {
    for (const r of listUiResources() as any[]) {
      expect(r._meta?.['openai/widgetDescription'], `${r.uri}`).toBeTruthy();
      expect(r._meta?.['openai/toolInvocation/invoking'], `${r.uri}`).toBeTruthy();
      expect(r._meta?.['openai/toolInvocation/invoked'], `${r.uri}`).toBeTruthy();
    }
  });
});

describe('resources/templates/list exposes the Views (ChatGPT discovery probe)', () => {
  it('lists every View as a resource template with uriTemplate', () => {
    const tpls = listUiResourceTemplates() as any[];
    const uris = tpls.map((t) => t.uriTemplate).sort();
    expect(uris).toEqual(['ui://synchronity/cart', 'ui://synchronity/multi-cart', 'ui://synchronity/product', 'ui://synchronity/product-list']);
    for (const t of tpls) {
      expect(t.uriTemplate).toBeTruthy();
      expect((t as any).uri).toBeUndefined();
    }
  });

  it('serves skybridge mime + widgetAccessible to ChatGPT templates', () => {
    for (const t of listUiResourceTemplates({ openai: true }) as any[]) {
      expect(t.mimeType).toBe(OPENAI_MIME_TYPE);
      expect(t._meta['openai/widgetAccessible']).toBe(true);
    }
  });
});

describe('per-client resource mime (ChatGPT skybridge vs Claude profile)', () => {
  it('serves skybridge mime + openai/widgetCSP to ChatGPT clients', () => {
    for (const r of listUiResources({ openai: true }) as any[]) {
      expect(r.mimeType).toBe(OPENAI_MIME_TYPE);
      expect(r._meta['openai/widgetCSP']).toBeDefined();
      expect(r._meta['openai/widgetCSP'].resource_domains).toContain('https:');
    }
    const read = readUiResource('ui://synchronity/product', { openai: true })!;
    expect(read.contents[0].mimeType).toBe(OPENAI_MIME_TYPE);
    expect((read.contents[0] as any)._meta['openai/widgetCSP']).toBeDefined();
  });

  it('serves the MCP-Apps profile mime + no openai CSP to non-ChatGPT clients', () => {
    for (const r of listUiResources() as any[]) {
      expect(r.mimeType).toBe(RESOURCE_MIME_TYPE);
      expect(r._meta['openai/widgetCSP']).toBeUndefined();
    }
    const read = readUiResource('ui://synchronity/product')!;
    expect(read.contents[0].mimeType).toBe(RESOURCE_MIME_TYPE);
    expect((read.contents[0] as any)._meta['openai/widgetCSP']).toBeUndefined();
  });
});
