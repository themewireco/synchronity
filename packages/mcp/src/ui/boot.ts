// sdk/mcp/src/ui/boot.ts
//
// Shared boot for the Synchronity product Views. Connects to the host via the
// MCP Apps bridge (ext-apps `App`), receives the tool result (carrying the
// CardModel as `structuredContent`), and renders the matching card. Buttons call
// back into Synchronity tools through `App.callServerTool` (a `tools/call`).

import {
  App,
  applyHostStyleVariables,
  applyHostFonts,
  applyDocumentTheme,
} from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { injectStyles } from './styles.js';
import { renderProduct, renderProductList, renderCart, type ViewCtx } from './render.js';
import type { CardModel } from '../cards/types.js';

function getRoot(): HTMLElement {
  let root = document.getElementById('syn-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'syn-root';
    document.body.appendChild(root);
  }
  return root;
}

function applyHostTheme(app: App): void {
  const ctx = app.getHostContext();
  if (!ctx) return;
  try {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
    if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  } catch (err) {
    console.warn('[syn-view] theme apply failed:', err);
  }
}

function dispatch(root: HTMLElement, ctx: ViewCtx, result: CallToolResult): void {
  const model = result.structuredContent as CardModel | undefined;
  if (!model || typeof model !== 'object') return;
  if (model.kind === 'productList') renderProductList(root, model, ctx);
  else if (model.kind === 'product') renderProduct(root, model, ctx);
  else if (model.kind === 'cart') renderCart(root, model, ctx);
}

/** Start a View. Idempotent per document. */
export async function boot(): Promise<void> {
  injectStyles();
  const root = getRoot();

  const app = new App({ name: 'synchronity-view', version: '0.1.0' });
  const ctx: ViewCtx = {
    callTool: (name, args) => app.callServerTool({ name, arguments: args }),
    // A View action's result (e.g. the updated cart) is rendered in-place, so the
    // user sees feedback even when the host doesn't echo tool results to the chat.
    onResult: (result) => dispatch(root, ctx, result as CallToolResult),
    // Silently update the model's context so Claude knows cart state. The host
    // defers delivery until the next user turn — no chat response is triggered.
    notifyModel: (text) => {
      try {
        app.updateModelContext({ content: [{ type: 'text', text }] });
      } catch (err) {
        console.warn('[syn-view] updateModelContext failed (host may not support it):', err);
      }
    },
    sendMessage: (text) => {
      try {
        app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
      } catch (err) {
        console.warn('[syn-view] sendMessage failed (host may not support it):', err);
      }
    },
    // Sandboxed iframes can't navigate to external URLs; ask the host to open it
    // (used for the card payment redirect to Paystack).
    openLink: (url) => {
      try {
        void app.openLink({ url });
      } catch (err) {
        console.warn('[syn-view] openLink failed (host may not support it):', err);
      }
    },
  };

  // Render whenever the host delivers (or re-delivers) the tool result.
  app.ontoolresult = (result) => {
    dispatch(root, ctx, result);
  };
  // React to host theme changes after the initial connect.
  app.onhostcontextchanged = () => applyHostTheme(app);

  await app.connect();
  applyHostTheme(app);
}
