// sdk/mcp/src/cards/resources.ts
//
// MCP Apps UI resources for the Synchronity product Views. Each resource is a
// self-contained HTML document: the tsup-built browser bundle (ext-apps + SDK +
// view code) inlined into a minimal shell. Served by the gateway/stdio server's
// resources/read handler. `_meta.ui` carries the CSP + border preference the host
// enforces on the sandboxed iframe.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';

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

/**
 * `_meta.ui` for every product View. Views make no network calls of their own
 * (all data/actions flow through the host bridge) → `connectDomains` empty.
 * `resourceDomains` must cover arbitrary merchant image CDNs plus the Google Fonts
 * origins; mapped by the host to img/script/style/font/media-src.
 * NOTE: broad image allow-listing — revisit if a host rejects `https://*` (see
 * design doc risk #3; fallback is inlining images).
 */
const UI_META = {
  csp: {
    connectDomains: [] as string[],
    // CSP scheme-source: allow ALL https static resources (images, fonts). Merchant
    // product images come from arbitrary HTTPS CDNs, so a bare host list can't cover
    // them. A bare `https://*` is NOT a valid CSP source (only `https://*.host` is) and
    // strict hosts (Claude Desktop) drop it → images blocked. `https:` is the valid
    // "any https" scheme-source. Explicit font origins kept as belt-and-suspenders.
    resourceDomains: [
      'https:',
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com',
    ],
  },
  prefersBorder: false,
};

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

/** Resource descriptors for `resources/list`. */
export function listUiResources() {
  return RESOURCES.map((r) => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: RESOURCE_MIME_TYPE,
    _meta: {
      ui: UI_META,
      'openai/widgetDescription': r.widgetDescription,
      'openai/toolInvocation/invoking': r.invoking,
      'openai/toolInvocation/invoked': r.invoked,
    },
  }));
}

/**
 * `resources/read` handler body for a ui:// URI. Returns undefined for unknown URIs
 * so the caller can surface a proper error.
 */
export function readUiResource(uri: string) {
  const def = RESOURCES.find((r) => r.uri === uri);
  if (!def) return undefined;
  return {
    contents: [
      {
        uri: def.uri,
        mimeType: RESOURCE_MIME_TYPE,
        text: buildHtml(def.bundle),
        _meta: { ui: UI_META },
      },
    ],
  };
}
