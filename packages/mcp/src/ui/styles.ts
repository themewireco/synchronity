// sdk/mcp/src/ui/styles.ts
//
// Brand stylesheet for the Synchronity MCP App Views. Injected once into the
// sandboxed iframe document. Tokens mirror dashboard/src/app/globals.css
// (Synchronity palette). Fonts loaded from Google Fonts (allowed via font-src).

export const CSS = /* css */ `
:root {
  /* Synchronity MCP-render tokens — extracted from the designer's Figma
     (BJU1PdCioBQaTlGUvF4aC6). Clean / breathable: mint canvas, white cards. */
  --syn-canvas: #f1f8f4;       /* page tint behind cards */
  --syn-canvas-inset: #eef6f1; /* soft inner panel (wizard) */
  --syn-green-deep: #1e4632;
  --syn-green: #2d6a4f;        /* primary button + selected fill */
  --syn-mint: #52b788;         /* badge dot, count badge, success icon */
  --syn-mint-soft: #dff1e7;    /* in-stock pill bg, success halo */
  --syn-ink: #1b4332;          /* headings / emphasis */
  --syn-ink-title: #1f2a24;    /* product/line titles (near-black) */
  --syn-ink-strong: #14331f;   /* totals */
  --syn-muted: #6b7b72;        /* labels, secondary */
  --syn-muted-head: #3d4f46;   /* list header / step label */
  --syn-danger: #c2410c;       /* out-of-stock / trash */
  --syn-danger-soft: #fbe9e1;
  --syn-bg: #ffffff;
  --syn-surface: #ffffff;
  --syn-border: #e7efea;       /* hairline dividers, input borders */
  --syn-disabled: #cbd5cf;     /* disabled button bg */
  --syn-shadow: 0 1px 2px rgba(16,40,28,.04), 0 10px 30px rgba(16,40,28,.07);
  --syn-radius: 20px;
  --syn-radius-sm: 14px;
  --syn-font-display: 'Space Grotesk', system-ui, sans-serif;
  --syn-font-body: 'Inter', system-ui, sans-serif;
}
/* ── ChatGPT / Codex surface overrides (Apps SDK UI guidelines) ──────────────
   Applied only when boot detects the window.openai host (html[data-syn-host=
   "openai"]). Inherit the system font stack, drop the brand canvas tint to a
   neutral surface, and keep brand accents on buttons/badges only. The Claude /
   mcpb surface keeps the full Synchronity styling. */
html[data-syn-host="openai"] {
  --syn-font-display: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --syn-font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
  --syn-canvas: transparent;
  --syn-canvas-inset: rgba(0,0,0,.03);
  --syn-shadow: 0 1px 2px rgba(0,0,0,.04), 0 6px 18px rgba(0,0,0,.06);
}
/* Dark theme (ChatGPT dark mode reports theme="dark"). Neutral dark surfaces;
   emerald/mint accents retained for brand recognition on actions. */
html[data-syn-host="openai"][data-syn-theme="dark"] {
  --syn-canvas: transparent;
  --syn-canvas-inset: rgba(255,255,255,.05);
  --syn-bg: #1f2023;
  --syn-surface: #1f2023;
  --syn-ink: #e7efe9;
  --syn-ink-title: #f3f5f4;
  --syn-ink-strong: #f3f5f4;
  --syn-muted: rgba(255,255,255,.62);
  --syn-muted-head: rgba(255,255,255,.78);
  --syn-border: rgba(255,255,255,.12);
  --syn-mint-soft: rgba(82,183,136,.18);
  --syn-danger-soft: rgba(194,65,12,.18);
  --syn-disabled: rgba(255,255,255,.18);
  --syn-shadow: 0 1px 2px rgba(0,0,0,.3), 0 6px 18px rgba(0,0,0,.4);
}
/* Plain ring spinner instead of the conic gradient on the ChatGPT surface. */
html[data-syn-host="openai"] .syn-loader {
  background: none;
  border: 3px solid var(--syn-border);
  border-top-color: var(--syn-green);
  -webkit-mask: none;
  mask: none;
}
html[data-syn-host="openai"][data-syn-theme="dark"] .syn-loader { border-top-color: var(--syn-mint); }

* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  font-family: var(--syn-font-body);
  color: var(--syn-ink-title);
  background: var(--syn-canvas);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
/* Breathable mint canvas with the content centered inside it. */
#syn-root { padding: 18px; max-width: 880px; margin: 0 auto; }
.syn-display { font-family: var(--syn-font-display); letter-spacing: -.01em; }

/* Card shell */
.syn-card {
  background: var(--syn-surface);
  border: 0;
  border-radius: var(--syn-radius);
  box-shadow: var(--syn-shadow);
  overflow: hidden;
}
.syn-card-product { max-width: 460px; margin: 0 auto; position: relative; }
/* Shopping bag floats over the hero so it stays visible through the options wizard
   (which re-renders the card body). */
.syn-prodbag { position: absolute; top: 10px; right: 10px; z-index: 2; }
.syn-prodbag .syn-bag { background: var(--syn-surface); box-shadow: var(--syn-shadow); }

/* Buttons (rounded-full pills) */
.syn-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 0; border-radius: 999px; cursor: pointer;
  font-family: var(--syn-font-body); font-weight: 600; font-size: 14px;
  padding: 12px 22px; transition: opacity .15s ease, background .15s ease, transform .05s ease;
  white-space: nowrap;
}
.syn-btn:active { transform: translateY(1px); }
.syn-btn-sm { padding: 11px 18px; font-size: 13.5px; }
.syn-btn-primary { background: var(--syn-green); color: #fff; }
.syn-btn-primary:hover { background: var(--syn-green-deep); }
.syn-btn-primary:disabled { background: var(--syn-disabled); color: #fff; cursor: not-allowed; }
.syn-btn-ghost { background: var(--syn-surface); color: var(--syn-green-deep); border: 1px solid var(--syn-border); }
.syn-btn-ghost:hover { border-color: #cfd9d1; }
.syn-btn-block { width: 100%; }

/* Quantity stepper (pill) */
.syn-qty { display: inline-flex; align-items: center; gap: 2px; border: 1px solid var(--syn-border); border-radius: 999px; background: var(--syn-surface); padding: 3px; }
.syn-qty button {
  width: 30px; height: 30px; border: 0; background: transparent; cursor: pointer;
  font-size: 18px; line-height: 1; color: var(--syn-ink); border-radius: 999px;
  display: inline-flex; align-items: center; justify-content: center;
}
.syn-qty button:hover { background: var(--syn-canvas); }
.syn-qty button:disabled { opacity: .3; cursor: not-allowed; }
.syn-qty span { min-width: 28px; text-align: center; font-weight: 600; font-size: 14px; color: var(--syn-ink-title); font-variant-numeric: tabular-nums; }

/* Stock chip */
.syn-chip { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 500; padding: 3px 11px 3px 9px; border-radius: 999px; }
.syn-chip::before { content: ""; width: 6px; height: 6px; border-radius: 999px; background: currentColor; flex: none; }
.syn-in { background: var(--syn-mint-soft); color: var(--syn-green); }
.syn-out { background: var(--syn-danger-soft); color: var(--syn-danger); }

/* Addon pills */
.syn-pillgroup { display: flex; flex-direction: column; gap: 7px; }
.syn-pillrow { display: flex; flex-wrap: wrap; gap: 7px; }
.syn-pilllabel { font-size: 13px; font-weight: 600; color: var(--syn-ink); }
.syn-pilllabel .req { color: #b42318; margin-left: 3px; }
.syn-pilllabel .opt { color: var(--syn-muted); font-weight: 500; margin-left: 4px; }
.syn-pill {
  border: 1px solid var(--syn-border); background: var(--syn-surface); color: var(--syn-ink);
  border-radius: 999px; padding: 7px 13px; font-size: 13px; cursor: pointer;
  transition: border-color .12s ease, background .12s ease;
}
.syn-pill:hover { border-color: var(--syn-mint); }
.syn-pill[aria-pressed="true"] {
  border-color: var(--syn-green); background: var(--syn-green); color: #fff;
}
.syn-pill .mod { opacity: .8; margin-left: 4px; font-size: 12px; }
.syn-pill-sel { border-color: var(--syn-green); background: var(--syn-green); color: #fff; }
.syn-axis { font-size: 11px; font-weight: 600; color: var(--syn-muted); text-transform: uppercase; letter-spacing: .04em; margin: 8px 0 4px; }
.syn-pill-oos { color: #c4c7cd; border-color: #eceef1; text-decoration: line-through; cursor: not-allowed; }
.syn-input { border: 1px solid var(--syn-border); border-radius: 12px; padding: 8px 12px; font: inherit; width: 100%; }

/* Price / text */
.syn-price { font-family: var(--syn-font-display); font-weight: 700; color: var(--syn-ink); font-size: 18px; }
.syn-muted { color: var(--syn-muted); }
.syn-err { color: var(--syn-danger); font-size: 12px; }

/* Toast stack — sticky-fixed at the bottom of the viewport so add-to-cart
   confirmations and errors stay visible without reflowing a card. */
.syn-toasts { position: fixed; left: 0; right: 0; bottom: 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; z-index: 9999; }
.syn-toast {
  max-width: min(440px, 90vw); background: var(--syn-ink-title); color: #fff; font-size: 13.5px; line-height: 1.4; font-weight: 500;
  padding: 11px 16px; border-radius: 12px; box-shadow: 0 6px 20px rgba(16,40,28,.22);
  opacity: 1; transform: translateY(0); transition: opacity .4s ease, transform .4s ease;
}
/* Add-to-cart confirmation: brand-green with a leading check. */
.syn-toast-success { background: var(--syn-green); }
.syn-toast-success::before {
  content: ""; display: inline-block; width: 15px; height: 15px; margin-right: 8px; vertical-align: -2px;
  background: no-repeat center / contain url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none'%3E%3Cpath d='M5 13l4 4L19 7' stroke='%23ffffff' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
}
.syn-toast-out { opacity: 0; transform: translateY(8px); }

/* ── Product list ── */
/* Header holds the shopping bag; sticky so it (and the live count) stay in reach
   as the buyer scrolls a long catalogue on hosts that scroll the widget. The
   canvas background masks rows sliding under it. */
.syn-listhead-bar { position: sticky; top: 0; z-index: 20; background: var(--syn-canvas); display: flex; align-items: center; justify-content: space-between; padding: 12px 6px 14px; }
html[data-syn-host="openai"] .syn-listhead-bar { background: var(--syn-bg); }
.syn-listhead-title { font-size: 15px; font-weight: 500; color: var(--syn-muted-head); }
.syn-list { display: flex; flex-direction: column; }
.syn-listempty { padding: 22px; font-size: 14px; color: var(--syn-muted); text-align: center; }
.syn-row { display: flex; align-items: center; gap: 16px; padding: 18px 22px; border-top: 1px solid var(--syn-border); }
.syn-row:first-child { border-top: 0; }
.syn-thumb { width: 64px; height: 64px; border-radius: var(--syn-radius-sm); object-fit: cover; background: var(--syn-canvas); flex: none; }
/* Fallback when an image is missing or blocked (renders a clean tinted box, no
   broken-image icon or alt text). */
.syn-thumb-empty { color: transparent; font-size: 0; }
.syn-thumb-empty::after { content: ""; display: block; width: 100%; height: 100%; background: var(--syn-canvas); border-radius: inherit; }
.syn-rowbody { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
.syn-rowtitle-line { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.syn-rowtitle { font-family: var(--syn-font-display); font-weight: 600; font-size: 16px; color: var(--syn-ink-title); letter-spacing: -.01em; }
.syn-rowmeta { display: flex; align-items: center; gap: 8px; }
.syn-rowactions { display: flex; align-items: center; gap: 12px; flex: none; }

/* ── Cart ── */
.syn-cartempty { padding: 16px 18px; font-size: 14px; }
.syn-carttotals { border-top: 1px solid var(--syn-border); padding: 12px 18px 14px; display: flex; flex-direction: column; gap: 6px; }
.syn-totline { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
.syn-totline-grand { font-family: var(--syn-font-display); font-weight: 700; font-size: 16px; }

/* Shopping-basket button (white circle) + count badge */
.syn-bag {
  position: relative; width: 52px; height: 52px; padding: 0; border-radius: 999px;
  background: var(--syn-surface); border: 1px solid var(--syn-border); box-shadow: var(--syn-shadow);
  color: var(--syn-ink-title); cursor: pointer; transition: border-color .12s ease, transform .05s ease;
}
.syn-bag:hover { border-color: var(--syn-mint); }
.syn-bag:active { transform: translateY(1px); }
.syn-bag .syn-bag-icon { width: 22px; height: 22px; display: inline-flex; }
.syn-bag .syn-bag-icon svg { width: 22px; height: 22px; }
.syn-bag-count {
  position: absolute; top: -2px; right: -2px;
  background: var(--syn-mint); color: #fff; border-radius: 999px;
  min-width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; padding: 0 5px; border: 2px solid #fff;
}

/* ── Single product ── */
.syn-hero { background: #f7f8fa; aspect-ratio: 16 / 10; display: flex; align-items: center; justify-content: center; position: relative; }
.syn-hero img { width: 100%; height: 100%; object-fit: cover; }
.syn-dots { position: absolute; bottom: 12px; left: 0; right: 0; display: flex; justify-content: center; gap: 6px; }
.syn-dot { width: 7px; height: 7px; border-radius: 999px; background: #d0d5dd; border: 0; padding: 0; cursor: pointer; }
.syn-dot[aria-current="true"] { background: var(--syn-ink); }
.syn-body { padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 10px; }
.syn-title { font-size: 16px; font-weight: 700; }
.syn-desc { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.syn-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.syn-priceblk { display: flex; flex-direction: column; }
.syn-priceblk .syn-price { font-size: 22px; }

/* ── Checkout steps (Figma): heading on canvas → white card → canvas footer ── */
.syn-step-h { font-family: var(--syn-font-display); font-weight: 600; font-size: 18px; color: var(--syn-ink); letter-spacing: -.01em; margin: 4px 4px 16px; }
.syn-step-note { color: var(--syn-muted); font-size: 15px; margin: -6px 4px 16px; line-height: 1.6; }
.syn-step-foot { display: flex; align-items: center; gap: 12px; margin-top: 20px; }
.syn-step-foot .spacer { flex: 1; }

/* Forms */
.syn-form { display: flex; flex-direction: column; gap: 20px; padding: 26px 28px; }
.syn-form-group { display: flex; flex-direction: column; gap: 10px; }
.syn-form-label { font-size: 14px; font-weight: 400; color: var(--syn-muted); }
.syn-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.syn-input, .syn-form-select {
  border: 1px solid var(--syn-border); border-radius: var(--syn-radius-sm);
  padding: 15px 18px; font: inherit; font-size: 16px; color: var(--syn-ink); width: 100%; background: var(--syn-surface);
}
.syn-input::placeholder { color: #9aa8a0; }
.syn-input:focus, .syn-form-select:focus { outline: none; border-color: var(--syn-mint); }
.syn-form-select {
  appearance: none; -webkit-appearance: none; cursor: pointer; padding-right: 42px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%236b7b72' stroke-width='2' fill='none' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 18px center;
}
.syn-phone-row { display: grid; grid-template-columns: 132px 1fr; gap: 10px; }
.syn-phone-dial { min-width: 0; }
.syn-phone-num { min-width: 0; }

/* Option tiles (shipping method, payment option) */
.syn-options { display: flex; flex-direction: column; gap: 14px; padding: 22px 24px; }
.syn-option {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  border: 1px solid var(--syn-border); border-radius: var(--syn-radius-sm);
  padding: 18px 22px; cursor: pointer; background: var(--syn-surface); text-align: left; width: 100%; font: inherit;
  transition: border-color .12s ease, background .12s ease;
}
.syn-option:hover { border-color: #cfd9d1; }
.syn-option .syn-opt-main { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.syn-option .ttl { font-family: var(--syn-font-display); font-weight: 600; font-size: 17px; color: var(--syn-ink-title); letter-spacing: -.01em; }
.syn-option .sub { font-size: 14px; color: var(--syn-muted); }
.syn-option .meta { font-size: 16px; color: var(--syn-ink); font-weight: 500; flex: none; }
.syn-option[aria-checked="true"], .syn-option.is-sel { background: var(--syn-green); border-color: var(--syn-green); }
.syn-option[aria-checked="true"] .ttl, .syn-option.is-sel .ttl,
.syn-option[aria-checked="true"] .sub, .syn-option.is-sel .sub,
.syn-option[aria-checked="true"] .meta, .syn-option.is-sel .meta { color: #fff; }

/* Dotted-ring spinner (Figma) + verifying text */
.syn-loader-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 28px 20px 8px; }
.syn-loader {
  width: 46px; height: 46px; border-radius: 50%;
  background: conic-gradient(from 0deg, var(--syn-green), rgba(45,106,79,.08) 75%, transparent);
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px));
          mask: radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px));
  animation: syn-spin .9s linear infinite;
}
.syn-verify { font-size: 18px; color: var(--syn-muted); }
@keyframes syn-spin { to { transform: rotate(360deg); } }

/* Success state (Figma: mint halo + check, confirmed) */
.syn-success-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 16px; padding: 36px 24px; }
.syn-success-halo { width: 86px; height: 86px; border-radius: 50%; background: var(--syn-mint-soft); display: grid; place-items: center; }
.syn-success-icon {
  width: 54px; height: 54px; border-radius: 50%; background: var(--syn-mint);
  color: #fff; display: flex; align-items: center; justify-content: center;
}
.syn-success-icon svg { width: 26px; height: 26px; }
.syn-success-title { font-family: var(--syn-font-display); font-weight: 700; font-size: 26px; color: var(--syn-ink); letter-spacing: -.01em; }
.syn-success-msg { color: var(--syn-muted); font-size: 16px; max-width: 440px; line-height: 1.6; }
.syn-success-total { font-size: 18px; color: var(--syn-muted); }
.syn-success-total b { color: var(--syn-ink); font-weight: 700; }

/* Accordion Customizer */
.syn-accordion { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; width: 100%; }
.syn-acc-item { border: 1px solid var(--syn-border); border-radius: 12px; overflow: hidden; background: var(--syn-surface); }
.syn-acc-header {
  display: flex; align-items: center; justify-content: space-between; padding: 12px 16px;
  background: #f9fafb; cursor: pointer; border: 0; width: 100%; text-align: left;
  font-family: inherit; transition: background .12s ease;
}
.syn-acc-header:hover { background: #f2f4f7; }
.syn-acc-title-wrap { display: flex; flex-direction: column; gap: 2px; }
.syn-acc-title { font-weight: 600; font-size: 14px; color: var(--syn-ink); }
.syn-acc-summary { font-size: 12px; color: var(--syn-green); font-weight: 500; }
.syn-acc-indicator { font-size: 14px; color: var(--syn-muted); transition: transform 250ms cubic-bezier(0.23, 1, 0.32, 1); }
.syn-acc-item[aria-expanded="true"] .syn-acc-indicator { transform: rotate(180deg); }
.syn-acc-item[aria-expanded="true"] .syn-acc-header { border-bottom: 1px solid var(--syn-border); background: #f2f4f7; }
.syn-acc-content {
  max-height: 0; opacity: 0; overflow: hidden;
  transition: max-height 250ms cubic-bezier(0.23, 1, 0.32, 1), opacity 200ms ease, padding 200ms ease;
  padding: 0 16px; display: flex; flex-direction: column; gap: 12px;
}
.syn-acc-item[aria-expanded="true"] .syn-acc-content {
  max-height: 500px;
  opacity: 1;
  padding: 14px 16px;
}

/* ── Customize wizard (Figma: Customize Your Brew → Review) ── */
.syn-wizard { display: flex; flex-direction: column; }
.syn-wizard-hero {
  position: relative; border-radius: var(--syn-radius); overflow: hidden;
  aspect-ratio: 16 / 6; background: var(--syn-canvas);
}
.syn-wizard-hero img { width: 100%; height: 100%; object-fit: cover; display: block; }
.syn-wizard-bag { position: absolute; top: 14px; right: 14px; }
.syn-step-label { margin: 20px 2px 14px; font-size: 15px; color: var(--syn-muted); }
.syn-step-label b {
  color: var(--syn-ink); font-family: var(--syn-font-display); font-weight: 600;
  letter-spacing: -.01em; margin-left: 4px;
}
.syn-inset { background: var(--syn-canvas-inset); border-radius: var(--syn-radius); padding: 18px; }
.syn-optcard {
  background: var(--syn-surface); border-radius: var(--syn-radius-sm); box-shadow: var(--syn-shadow);
  padding: 6px 24px; display: flex; flex-direction: column;
}
.syn-optrow { display: flex; flex-direction: column; gap: 12px; padding: 20px 0; }
.syn-optrow + .syn-optrow { border-top: 1px solid var(--syn-border); }
.syn-optlabel { font-size: 14px; color: var(--syn-muted); }
/* Custom dropdown (Figma): trigger box + expanding option panel. */
.syn-dd { position: relative; }
.syn-dd-trigger {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  background: var(--syn-surface); border: 1px solid var(--syn-border); border-radius: var(--syn-radius-sm);
  padding: 15px 18px; font: inherit; font-size: 16px; color: var(--syn-ink);
  width: 100%; cursor: pointer; text-align: left;
}
.syn-dd-trigger:hover { border-color: #cfd9d1; }
.syn-dd-trigger .val { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.syn-dd-trigger .chev {
  width: 10px; height: 10px; flex: none; transform: rotate(45deg) translateY(-2px);
  border-right: 2px solid var(--syn-muted); border-bottom: 2px solid var(--syn-muted);
  transition: transform .18s ease;
}
.syn-dd[aria-expanded="true"] .syn-dd-trigger .chev { transform: rotate(-135deg) translateY(-2px); }
.syn-dd-panel {
  margin-top: 10px; background: var(--syn-surface); border-radius: var(--syn-radius); box-shadow: var(--syn-shadow);
  padding: 8px; display: none; flex-direction: column; gap: 2px;
}
.syn-dd[aria-expanded="true"] .syn-dd-panel { display: flex; }
.syn-dd-opt {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 16px 18px; border-radius: var(--syn-radius-sm); cursor: pointer;
  font-size: 16px; color: var(--syn-ink-title); background: var(--syn-surface); border: 0; width: 100%; text-align: left;
  font-family: var(--syn-font-display); font-weight: 600; letter-spacing: -.01em;
}
.syn-dd-opt:hover { background: var(--syn-canvas); }
.syn-dd-opt .price { font-weight: 700; color: var(--syn-ink); }
.syn-dd-opt.is-sel { background: var(--syn-green); color: #fff; }
.syn-dd-opt.is-sel .price { color: #fff; }
.syn-dd-opt:disabled { opacity: .4; cursor: not-allowed; text-decoration: line-through; }
/* Multi-select: seamless white check on the selected (emerald) row. */
.syn-dd-check { width: 18px; height: 18px; flex: none; display: none; }
.syn-dd-opt.is-sel .syn-dd-check { display: inline-flex; }
.syn-dd-opt .syn-dd-end { display: inline-flex; align-items: center; gap: 12px; }
/* Review step (Figma step 2) */
.syn-review-card {
  background: var(--syn-surface); border-radius: var(--syn-radius-sm); box-shadow: var(--syn-shadow);
  padding: 24px 26px; display: flex; flex-direction: column; gap: 18px;
}
.syn-review-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.syn-review-row .k { font-size: 15px; color: var(--syn-muted); }
.syn-review-row .v { font-size: 16px; font-weight: 600; color: var(--syn-ink); font-family: var(--syn-font-display); }
.syn-review-divider { height: 1px; background: var(--syn-border); }
.syn-review-total .k { font-size: 18px; font-weight: 700; color: var(--syn-ink); }
.syn-review-total .v { font-size: 22px; font-weight: 700; }
/* Wizard footer (Back left / Next|Add to cart right) */
.syn-wizard-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 18px; }
.syn-wizard-foot .spacer { flex: 1; }

/* ── Cart (Figma: Your cart) ── */
.syn-cart-head { position: sticky; top: 0; z-index: 20; background: var(--syn-canvas); display: flex; align-items: center; justify-content: space-between; padding: 12px 6px 14px; }
html[data-syn-host="openai"] .syn-cart-head { background: var(--syn-bg); }
.syn-cart-head .t { font-size: 16px; color: var(--syn-ink-title); }
.syn-cart-head .id { font-size: 14px; color: var(--syn-muted); }
.syn-stack { display: flex; flex-direction: column; gap: 18px; }
.syn-card-pad { padding: 24px 26px; }
/* Summary card: breathable vertical rhythm between rows (Figma). */
.syn-summary-card { padding: 26px 28px; display: flex; flex-direction: column; gap: 18px; }
.syn-summary-card .syn-review-divider { margin: 2px 0; }
.syn-summary-title { font-family: var(--syn-font-display); font-weight: 600; font-size: 18px; color: var(--syn-ink); letter-spacing: -.01em; }
.syn-trash {
  width: 44px; height: 44px; border-radius: var(--syn-radius-sm); border: 1px solid var(--syn-border);
  background: var(--syn-surface); color: var(--syn-danger); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; flex: none;
}
.syn-trash:hover { background: var(--syn-danger-soft); }
.syn-trash svg { width: 18px; height: 18px; }
.syn-cart-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 22px; }

/* ── Mobile / narrow widget (Claude + ChatGPT mobile) ── */
@media (max-width: 480px) {
  #syn-root { padding: 12px; }
  .syn-listhead-bar { padding: 2px 2px 12px; }
  .syn-listhead-title { font-size: 14px; }
  /* Product / cart rows: let the action cluster wrap full-width below the item. */
  .syn-row { flex-wrap: wrap; gap: 12px; padding: 16px; }
  .syn-rowactions { margin-left: 64px; flex: 1 1 100%; justify-content: flex-end; }
  .syn-rowtitle { font-size: 15px; }
  /* Cards + forms: tighter padding. */
  .syn-card-pad, .syn-summary-card { padding: 18px 18px; }
  .syn-form { padding: 18px 18px; gap: 16px; }
  .syn-form-row { grid-template-columns: 1fr; }
  .syn-optcard { padding: 4px 16px; }
  .syn-review-card { padding: 20px 18px; }
  .syn-options { padding: 16px; }
  /* Wizard hero: shorter on mobile so the options sit in view. */
  .syn-wizard-hero { aspect-ratio: 16 / 9; }
  .syn-step-h { font-size: 16px; }
  /* Footers: full-width stacked buttons, primary on top. */
  .syn-step-foot, .syn-wizard-foot, .syn-cart-foot { flex-direction: column-reverse; align-items: stretch; gap: 10px; }
  .syn-step-foot .spacer, .syn-wizard-foot .spacer { display: none; }
  .syn-step-foot .syn-btn, .syn-wizard-foot .syn-btn, .syn-cart-foot .syn-btn { width: 100%; }
  .syn-bag { width: 46px; height: 46px; }
}
`;

/** Inject the brand stylesheet into the document head exactly once. */
export function injectStyles(): void {
  if (document.getElementById('syn-styles')) return;
  const fonts = document.createElement('link');
  fonts.rel = 'stylesheet';
  fonts.href =
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&display=swap';
  document.head.appendChild(fonts);

  const style = document.createElement('style');
  style.id = 'syn-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}
