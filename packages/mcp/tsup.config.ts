import { defineConfig } from 'tsup';

export default defineConfig([
  // Server / library build (Node, ESM+CJS).
  {
    entry: ['src/index.ts', 'src/server.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    splitting: false,
    shims: true,
    external: ['@modelcontextprotocol/sdk', '@synchronity/sdk'],
  },
  // MCP Apps View bundles (browser, self-contained IIFE). ext-apps + sdk client
  // are bundled IN so the served HTML needs no external scripts. Output JS is
  // inlined into an HTML shell at resource-read time (see src/ui/htmlShell.ts).
  {
    entry: { product: 'src/ui/product.ts', 'product-list': 'src/ui/product-list.ts', cart: 'src/ui/cart.ts' },
    outDir: 'dist/ui',
    format: ['iife'],
    platform: 'browser',
    target: 'es2020',
    dts: false,
    sourcemap: false,
    clean: false,
    splitting: false,
    minify: true,
    noExternal: [/@modelcontextprotocol\/.*/, 'zod', '@standard-schema/spec'],
  },
]);
