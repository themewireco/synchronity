// sdk/mcp/src/cards/resources.ts
//
// MCP Apps UI resources for the Synchronity product Views. Each resource is a
// self-contained HTML document: the tsup-built browser bundle (ext-apps + SDK +
// view code) inlined into a minimal shell. Served by the gateway/stdio server's
// resources/read handler. `_meta.ui` carries the CSP + border preference the host
// enforces on the sandboxed iframe.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// MCP-Apps standard mime (Claude / spec-compliant hosts key on this).
export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';
// OpenAI Apps SDK mime. ChatGPT's bridge ONLY treats a resource as a renderable
// widget when it is served as `text/html+skybridge`; given the standard mime it
// falls back to plain text. We serve this variant to ChatGPT clients only, so
// Claude (which needs the profile mime) is unaffected.
export const OPENAI_MIME_TYPE = 'text/html+skybridge';

/** Options controlling host-specific resource serialisation. */
export interface ResourceServeOpts {
  /** True when the connected client is ChatGPT/OpenAI → emit skybridge mime + CSP. */
  openai?: boolean;
}

function mimeFor(opts?: ResourceServeOpts): string {
  return opts?.openai ? OPENAI_MIME_TYPE : RESOURCE_MIME_TYPE;
}

/** One UI resource: a ui:// URI mapped to its built browser bundle. */
interface UiResourceDef {
  uri: string;
  name: string;
  description: string;
  bundle: string; // filename in dist/ui/ (tsup IIFE output)
  widgetDescription: string;
  invoking: string;
  invoked: string;
}

const RESOURCES: UiResourceDef[] = [
  {
    uri: 'ui://synchronity/product',
    name: 'Synchronity product card',
    description: 'Interactive single-product card with quantity, addon pills, and Add to cart.',
    bundle: 'product.global.js',
    widgetDescription: 'Interactive product card with quantity and add-to-cart.',
    invoking: 'Loading product…',
    invoked: 'Product ready',
  },
  {
    uri: 'ui://synchronity/product-list',
    name: 'Synchronity product list',
    description: 'Interactive product list with per-row quantity and Add to cart.',
    bundle: 'product-list.global.js',
    widgetDescription: 'Interactive product list with per-item add-to-cart.',
    invoking: 'Searching products…',
    invoked: 'Products ready',
  },
  {
    uri: 'ui://synchronity/cart',
    name: 'Synchronity cart',
    description: 'Interactive cart card with line items, totals, and remove actions.',
    bundle: 'cart.global.js',
    widgetDescription: 'Interactive cart with line items and totals.',
    invoking: 'Updating cart…',
    invoked: 'Cart ready',
  },
  {
    uri: 'ui://synchronity/multi-cart',
    name: 'Synchronity multi-store cart',
    description: 'Rich cart card per store for a multi-store quick checkout.',
    bundle: 'multi-cart.global.js',
    widgetDescription: 'Per-store carts for multi-store checkout.',
    invoking: 'Assembling carts…',
    invoked: 'Carts ready',
  },
];

// Views make no network calls of their own (all data/actions flow through the
// host bridge) → `connectDomains` empty. `resourceDomains` must cover arbitrary
// merchant image CDNs plus the Google Fonts origins; mapped by the host to
// img/script/style/font/media-src.
//
// Merchant product images come from arbitrary HTTPS CDNs that can't be enumerated,
// so "allow any https" is required. The two host dialects express that differently
// AND validate it differently, so the resourceDomains list must be per-client:
//  - Claude / MCP-Apps maps resourceDomains onto a Content-Security-Policy source
//    list, where the scheme-source `https:` is the only way to allow any https
//    (a bare host wildcard like `https://*` is NOT a valid CSP source and strict
//    hosts drop it → images blocked).
//  - ChatGPT's Apps scanner validates every entry as a URL and REJECTS the bare
//    scheme `https:`, so it needs the wildcard URL form `https://*`.
const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
const CLAUDE_RESOURCE_DOMAINS = ['https:', ...FONT_ORIGINS];
const OPENAI_RESOURCE_DOMAINS = ['https://*', ...FONT_ORIGINS];

/** `_meta.ui` for a product View, with the resourceDomains dialect the client needs. */
function uiMeta(opts?: ResourceServeOpts) {
  return {
    csp: {
      connectDomains: [] as string[],
      resourceDomains: opts?.openai ? OPENAI_RESOURCE_DOMAINS : CLAUDE_RESOURCE_DOMAINS,
    },
    prefersBorder: false,
  };
}

/** Escape only the `</script` sequence so the inlined bundle can't close the tag. */
function safeScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

/** Lazily read + cache each bundle's HTML (built artifact lives in dist/ui/). */
const htmlCache = new Map<string, string>();

/**
 * Locate a built View bundle. At runtime this module is inlined into `dist/server.js`,
 * so `./ui/<f>` resolves to `dist/ui/`. When running from source (tests), fall back to
 * the repo's `dist/ui/`.
 */
function resolveBundle(bundleFile: string): string {
  const candidates = [
    `./ui/${bundleFile}`, // built: dist/server.js → dist/ui/
    `../../dist/ui/${bundleFile}`, // source: src/cards/resources.ts → dist/ui/
  ];
  for (const rel of candidates) {
    const p = fileURLToPath(new URL(rel, import.meta.url));
    if (existsSync(p)) return p;
  }
  // Default to the built location for a clear ENOENT if truly missing.
  return fileURLToPath(new URL(`./ui/${bundleFile}`, import.meta.url));
}

function buildHtml(bundleFile: string): string {
  const cached = htmlCache.get(bundleFile);
  if (cached) return cached;
  const js = readFileSync(resolveBundle(bundleFile), 'utf8');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Synchronity</title>
</head>
<body>
<div id="syn-root"></div>
<script>${safeScript(js)}</script>
</body>
</html>`;
  htmlCache.set(bundleFile, html);
  return html;
}

/**
 * OpenAI-dialect CSP for ChatGPT, in the field names the ChatGPT sandbox reads;
 * without it merchant product images (arbitrary HTTPS CDNs) are blocked even
 * once the widget renders. Uses the URL-valid domain list (no bare `https:`).
 */
const OPENAI_WIDGET_CSP = {
  connect_domains: [] as string[],
  resource_domains: OPENAI_RESOURCE_DOMAINS,
};

/** Shared `_meta` for a resource descriptor (list + templates). */
function resourceMeta(r: UiResourceDef, opts?: ResourceServeOpts) {
  return {
    ui: uiMeta(opts),
    'openai/widgetDescription': r.widgetDescription,
    'openai/toolInvocation/invoking': r.invoking,
    'openai/toolInvocation/invoked': r.invoked,
    ...(opts?.openai
      ? { 'openai/widgetCSP': OPENAI_WIDGET_CSP, 'openai/widgetAccessible': true }
      : {}),
  };
}

/** Resource descriptors for `resources/list`. */
export function listUiResources(opts?: ResourceServeOpts) {
  return RESOURCES.map((r) => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: mimeFor(opts),
    _meta: resourceMeta(r, opts),
  }));
}

/**
 * Resource-TEMPLATE descriptors for `resources/templates/list`. ChatGPT's widget
 * discovery probes this method; a low-level MCP server that only handles
 * `resources/list` returns JSON-RPC -32601 (method not found) here, which can
 * abort ChatGPT's outputTemplate registration (so the View never mounts). We
 * expose the same `ui://` Views as (non-parameterised) templates so the probe
 * succeeds and finds them. `uriTemplate` is the literal URI (no RFC-6570 vars).
 */
export function listUiResourceTemplates(opts?: ResourceServeOpts) {
  return RESOURCES.map((r) => ({
    uriTemplate: r.uri,
    name: r.name,
    description: r.description,
    mimeType: mimeFor(opts),
    _meta: resourceMeta(r, opts),
  }));
}

/**
 * `resources/read` handler body for a ui:// URI. Returns undefined for unknown URIs
 * so the caller can surface a proper error.
 */
export function readUiResource(uri: string, opts?: ResourceServeOpts) {
  const def = RESOURCES.find((r) => r.uri === uri);
  if (!def) return undefined;
  return {
    contents: [
      {
        uri: def.uri,
        mimeType: mimeFor(opts),
        text: buildHtml(def.bundle),
        _meta: {
          ui: uiMeta(opts),
          ...(opts?.openai ? { 'openai/widgetCSP': OPENAI_WIDGET_CSP } : {}),
        },
      },
    ],
  };
}
