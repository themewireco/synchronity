// sdk/mcp/src/cards/renderCard.ts
import type { MCPContent } from '../types.js';
import type { CardModel, CardToolResult } from './types.js';
import { markdownFallback } from './markdown.js';

/** A single Markdown text content block. Product images are embedded inline in the Markdown. */
export function textResult(markdown: string): { content: MCPContent[] } {
  return { content: [{ type: 'text', text: markdown }] };
}

/** Map a CardModel kind to its registered MCP Apps UI resource URI. */
const RESOURCE_URI: Record<CardModel['kind'], string> = {
  product: 'ui://synchronity/product',
  productList: 'ui://synchronity/product-list',
  cart: 'ui://synchronity/cart',
  checkout: 'ui://synchronity/checkout',
  delegation: 'ui://synchronity/delegation',
};

/**
 * Dual-output tool result: a Markdown text block (fallback for non-Apps hosts) PLUS the
 * CardModel as `structuredContent` and a `_meta.ui.resourceUri` link to the View resource.
 * Hosts with MCP Apps support render the interactive View; others show the Markdown.
 * The `openai/outputTemplate` alias keeps ChatGPT rendering the same resource.
 */
export function cardResult(model: CardModel): CardToolResult {
  const resourceUri = RESOURCE_URI[model.kind];
  return {
    content: [{ type: 'text', text: markdownFallback(model) }],
    structuredContent: model,
    _meta: {
      ui: { resourceUri },
      'openai/outputTemplate': resourceUri,
    },
  };
}
