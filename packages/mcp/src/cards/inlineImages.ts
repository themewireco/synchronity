// sdk/mcp/src/cards/inlineImages.ts
//
// Workaround for a known Claude.ai / Claude Desktop bug: its MCP Apps sandbox
// IGNORES `_meta.ui.csp.resourceDomains`, so remote (https) product images never
// load there (anthropics/claude-ai-mcp#40). The sandbox DOES allow `data:` URIs,
// so when enabled we embed images as data: URIs in the CardModel.
//
// BUT Claude Desktop also caps a tool result at 1MB. Full-size images base64'd
// into a product list blow past that, so we fetch a small RESIZED thumbnail (via
// the images.weserv.nl resize proxy) — typically a few KB each — and enforce a
// total inline budget well under 1MB. Anything that doesn't fit keeps its remote
// URL (still renders on spec-compliant hosts: MCPJam, ChatGPT).
//
// OPT-IN via SYN_INLINE_IMAGES. Best-effort: any failure falls back to the URL.

import type { CardModel } from './types.js';

const THUMB_PX = 200;                  // resized thumbnail edge (smaller = more fit the budget)
const PER_IMAGE_MAX_BYTES = 120 * 1024; // skip a thumb if somehow larger than ~120KB
const TOTAL_BUDGET_BYTES = 850 * 1024;  // hard cap on summed inlined bytes (<1MB result limit)
const PER_IMAGE_TIMEOUT_MS = 6000;
// Cap fetch fan-out so big lists don't stall the tool call. Covers a full default
// catalog page (search_products per_page = 20) so every row's image inlines on
// Claude; the byte budget above is the real limiter for very large pages.
const MAX_IMAGES = 30;

/** Whether image inlining is enabled (env flag). */
export function inlineImagesEnabled(): boolean {
  const v = process.env.SYN_INLINE_IMAGES;
  return v === '1' || v === 'true';
}

/** Build a weserv resize-proxy URL that returns a small webp thumbnail. */
function thumbUrl(url: string): string {
  // weserv: drop scheme; https sources use the `ssl:` prefix.
  const stripped = url.replace(/^https:\/\//i, 'ssl:').replace(/^http:\/\//i, '');
  return `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}&w=${THUMB_PX}&h=${THUMB_PX}&fit=cover&output=webp&q=72`;
}

/** Fetch a resized thumbnail and return a data: URI, or undefined to keep the remote URL. */
async function toDataUri(url: string): Promise<string | undefined> {
  if (!/^https?:\/\//i.test(url)) return undefined;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PER_IMAGE_TIMEOUT_MS);
  try {
    const res = await fetch(thumbUrl(url), { signal: ctrl.signal });
    if (!res.ok) return undefined;
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) return undefined;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > PER_IMAGE_MAX_BYTES) return undefined;
    return `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Collect every image URL referenced by a card model. */
function collectUrls(model: CardModel): string[] {
  const urls = new Set<string>();
  if (model.kind === 'product') {
    if (model.image) urls.add(model.image);
    for (const u of model.images ?? []) urls.add(u);
    for (const v of model.variants ?? []) if (v.image) urls.add(v.image);
  } else if (model.kind === 'productList') {
    for (const p of model.products) if (p.image) urls.add(p.image);
  } else if (model.kind === 'cart' || model.kind === 'checkout') {
    // Cart/checkout line thumbnails need the same data: URI treatment so they
    // render in the Claude sandbox (remote URLs are blocked there).
    for (const it of model.items) if (it.image) urls.add(it.image);
  }
  return [...urls];
}

/**
 * Replace remote image URLs in a product/productList model with small data: URIs
 * (in place), staying under a total byte budget so the tool result fits Claude's
 * 1MB limit. No-op for other kinds or when disabled. Returns the same model.
 */
export async function inlineCardImages<T extends CardModel>(model: T): Promise<T> {
  if (!inlineImagesEnabled()) return model;
  const urls = collectUrls(model).slice(0, MAX_IMAGES);
  if (urls.length === 0) return model;

  // Fetch thumbnails in parallel, then accept them in order until the budget runs out.
  const fetched = await Promise.all(urls.map(async (u) => [u, await toDataUri(u)] as const));
  const map = new Map<string, string>();
  let used = 0;
  for (const [u, data] of fetched) {
    if (!data) continue;
    if (used + data.length > TOTAL_BUDGET_BYTES) continue; // keep remote URL beyond budget
    map.set(u, data);
    used += data.length;
  }
  if (map.size === 0) return model;

  if (model.kind === 'product') {
    if (model.image && map.has(model.image)) model.image = map.get(model.image);
    if (model.images) model.images = model.images.map((u) => map.get(u) ?? u);
    for (const v of model.variants ?? []) if (v.image && map.has(v.image)) v.image = map.get(v.image);
  } else if (model.kind === 'productList') {
    for (const p of model.products) if (p.image && map.has(p.image)) p.image = map.get(p.image);
  } else if (model.kind === 'cart' || model.kind === 'checkout') {
    for (const it of model.items) if (it.image && map.has(it.image)) it.image = map.get(it.image);
  }
  return model;
}
