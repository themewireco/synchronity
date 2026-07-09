// sdk/mcp/src/ui/host-openai.ts
//
// ChatGPT / Codex host adapter for the Synchronity Views (OpenAI Apps SDK).
//
// The SAME render core (render.ts) drives both Claude (MCP Apps bridge, see boot.ts)
// and ChatGPT/Codex. This module maps the host-agnostic `ViewCtx` onto the
// `window.openai` bridge: the initial CardModel comes from `window.openai.toolOutput`,
// re-deliveries arrive via the `openai:set_globals` CustomEvent, and a View action
// calls back through `window.openai.callTool`. This path must NOT change the Claude
// behavior — it's a second transport for the identical UI.

import type { ViewCtx, ToolCallResult } from './render.js';
import type { CardModel } from '../cards/types.js';

/** Minimal shape of the `window.openai` bridge we depend on (Apps SDK). */
interface OpenAiGlobals {
  toolOutput?: unknown;
  toolInput?: unknown;
  displayMode?: string;
  theme?: string;
  locale?: string;
}
interface OpenAiBridge extends OpenAiGlobals {
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  sendFollowupMessage?: (args: { prompt: string }) => void | Promise<void>;
  requestDisplayMode?: (args: { mode: string }) => void | Promise<void>;
}

declare global {
  interface Window {
    openai?: OpenAiBridge;
  }
}

/** True when running inside ChatGPT/Codex (the Apps SDK bridge is present). */
export function isOpenAiHost(): boolean {
  return typeof window !== 'undefined' && !!window.openai;
}

/** Normalise whatever `window.openai.callTool` resolves to into a ToolCallResult. */
function toToolResult(raw: unknown): ToolCallResult {
  if (raw && typeof raw === 'object') {
    const r = raw as Record<string, unknown>;
    // Already a tool-call result shape.
    if ('structuredContent' in r || 'content' in r || 'isError' in r) {
      return r as ToolCallResult;
    }
    // A bare CardModel (some hosts hand back the structured payload directly).
    if ('kind' in r) return { structuredContent: r };
  }
  return { structuredContent: raw };
}

/**
 * Boot a View under ChatGPT/Codex. `render` paints a CardModel into the root.
 * Reads the initial model from `toolOutput`, re-renders on `openai:set_globals`,
 * and wires `ViewCtx` actions onto the `window.openai` bridge.
 */
export function bootOpenAi(root: HTMLElement, render: (model: CardModel, ctx: ViewCtx) => void): void {
  const bridge = window.openai!;

  // Tag the document as the ChatGPT/Codex surface so the stylesheet applies the
  // Apps-SDK overrides (system font, neutral surface, theme). Mirror locale +
  // theme, and keep theme in sync via openai:set_globals.
  const applyHostChrome = () => {
    try {
      const root = document.documentElement;
      root.setAttribute('data-syn-host', 'openai');
      const theme = window.openai?.theme;
      if (theme) root.setAttribute('data-syn-theme', theme);
      if (window.openai?.locale) root.lang = window.openai.locale;
    } catch {
      /* non-fatal */
    }
  };
  applyHostChrome();

  const ctx: ViewCtx = {
    callTool: async (name, args) => {
      if (!bridge.callTool) {
        return { isError: true, content: [{ type: 'text', text: 'Tool calls are not available in this host.' }] };
      }
      const raw = await bridge.callTool(name, args);
      return toToolResult(raw);
    },
    // A View action's result is rendered in place (the host also re-delivers via
    // set_globals, but rendering here keeps feedback instant).
    onResult: (result) => {
      const model = (result as ToolCallResult).structuredContent as CardModel | undefined;
      if (model && typeof model === 'object') render(model, ctx);
    },
    // ChatGPT shows tool-call results in the transcript itself; updateModelContext
    // has no analogue, so notifyModel is a no-op here.
    notifyModel: () => undefined,
    sendMessage: (text) => {
      try {
        void bridge.sendFollowupMessage?.({ prompt: text });
      } catch (err) {
        console.warn('[syn-view] sendFollowupMessage failed:', err);
      }
    },
    // Card payment redirect: ask for fullscreen, then open the secure page.
    openLink: (url) => {
      try {
        void bridge.requestDisplayMode?.({ mode: 'fullscreen' });
      } catch {
        /* optional */
      }
      try {
        window.open(url, '_blank', 'noopener,noreferrer');
      } catch (err) {
        console.warn('[syn-view] open payment link failed:', err);
      }
    },
  };

  const paintModel = (model: unknown) => {
    if (model && typeof model === 'object') render(model as CardModel, ctx);
  };

  // Repaint from `toolOutput` only when it ACTUALLY changes. ChatGPT fires
  // `openai:set_globals` after every widget-initiated callTool — including the ones
  // that navigate the View in place (cart icon → get_cart, variant "Add" →
  // get_product). Those events still carry the toolOutput of the tool that MOUNTED
  // this component (e.g. search_products → productList), so an unconditional repaint
  // would clobber the cart/wizard that `onResult` just rendered and snap back to the
  // product list. Dedupe by a content signature so only a genuinely new tool output
  // repaints; an in-View navigation survives the spurious set_globals.
  let lastOutputSig: string | undefined;
  const sigOf = (m: unknown) => { try { return JSON.stringify(m); } catch { return String(m); } };
  const paint = () => {
    const out = window.openai?.toolOutput;
    const sig = sigOf(out);
    if (sig === lastOutputSig) return;
    lastOutputSig = sig;
    paintModel(out);
  };

  // Re-apply theme/locale on every set_globals, but only repaint on a real
  // toolOutput change (see paint() dedupe above).
  window.addEventListener('openai:set_globals', () => { applyHostChrome(); paint(); });

  // Modern ChatGPT delivers the tool result over the MCP-Apps bridge
  // (`ui/notifications/tool-result` postMessage — the SAME channel Claude uses),
  // NOT always via `window.openai.toolOutput`. Without this listener the View
  // mounts but never receives data → blank → ChatGPT falls back to text. Read the
  // CardModel from whichever envelope shape the host sends.
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    const msg = event.data as { method?: string; params?: Record<string, unknown> } | undefined;
    if (!msg || msg.method !== 'ui/notifications/tool-result') return;
    const p = (msg.params ?? {}) as Record<string, any>;
    paintModel(p.structuredContent ?? p.result?.structuredContent ?? p.toolResult?.structuredContent ?? p.toolOutput);
  });

  // Initial render from the tool output already present at boot (if any).
  paint();
}
