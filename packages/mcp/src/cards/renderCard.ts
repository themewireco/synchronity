// sdk/mcp/src/cards/renderCard.ts
import type { MCPContent } from '../types.js';

/** A single Markdown text content block. Product images are embedded inline in the Markdown. */
export function textResult(markdown: string): { content: MCPContent[] } {
  return { content: [{ type: 'text', text: markdown }] };
}
