// sdk/mcp/src/ui/styles.ts
//
// Brand stylesheet for the Synchronity MCP App Views. Injected once into the
// sandboxed iframe document. Tokens mirror dashboard/src/app/globals.css
// (Synchronity palette). Fonts loaded from Google Fonts (allowed via font-src).

export const CSS = /* css */ `
:root {
  --syn-green-deep: #1e4632;
  --syn-green: #2d6a4f;
  --syn-mint: #52b788;
  --syn-ink: #101828;
  --syn-muted: #475467;
  --syn-bg: #ffffff;
  --syn-surface: #ffffff;
  --syn-border: #e4e7ec;
  --syn-shadow: 0 1px 2px rgba(16,24,40,.04), 0 12px 32px rgba(16,24,40,.08);
  --syn-radius: 18px;
  --syn-font-display: 'Space Grotesk', system-ui, sans-serif;
  --syn-font-body: 'Inter', system-ui, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: transparent; }
body {
  font-family: var(--syn-font-body);
  color: var(--syn-ink);
  -webkit-font-smoothing: antialiased;
}
.syn-display { font-family: var(--syn-font-display); letter-spacing: -.02em; }

/* Card shell */
.syn-card {
  background: var(--syn-surface);
  border: 1px solid var(--syn-border);
  border-radius: var(--syn-radius);
  box-shadow: var(--syn-shadow);
  overflow: hidden;
}
.syn-card-product { max-width: 460px; margin: 0 auto; }

/* Buttons (rounded-full pills) */
.syn-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  border: 0; border-radius: 999px; cursor: pointer;
  font-family: var(--syn-font-body); font-weight: 600; font-size: 14px;
  padding: 10px 18px; transition: opacity .15s ease, background .15s ease, transform .05s ease;
  white-space: nowrap;
}
.syn-btn:active { transform: translateY(1px); }
.syn-btn-primary { background: var(--syn-green); color: #fff; }
.syn-btn-primary:hover { background: var(--syn-green-deep); }
.syn-btn-primary:disabled { opacity: .45; cursor: not-allowed; }
.syn-btn-ghost { background: #fff; color: var(--syn-green-deep); border: 1px solid var(--syn-border); }
.syn-btn-ghost:hover { border-color: #cfd4dc; }

/* Quantity stepper */
.syn-qty { display: inline-flex; align-items: center; border: 1px solid var(--syn-border); border-radius: 999px; }
.syn-qty button {
  width: 30px; height: 30px; border: 0; background: transparent; cursor: pointer;
  font-size: 17px; line-height: 1; color: var(--syn-ink); border-radius: 999px;
}
.syn-qty button:hover { background: #f2f4f7; }
.syn-qty button:disabled { opacity: .35; cursor: not-allowed; }
.syn-qty span { min-width: 26px; text-align: center; font-weight: 600; font-size: 14px; font-variant-numeric: tabular-nums; }

/* Stock chip */
.syn-chip { font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; }
.syn-in { background: rgba(82,183,136,.14); color: var(--syn-green-deep); }
.syn-out { background: #f2f4f7; color: var(--syn-muted); }

/* Addon pills */
.syn-pillgroup { display: flex; flex-direction: column; gap: 7px; }
.syn-pillrow { display: flex; flex-wrap: wrap; gap: 7px; }
.syn-pilllabel { font-size: 13px; font-weight: 600; color: var(--syn-ink); }
.syn-pilllabel .req { color: #b42318; margin-left: 3px; }
.syn-pilllabel .opt { color: var(--syn-muted); font-weight: 500; margin-left: 4px; }
.syn-pill {
  border: 1px solid var(--syn-border); background: #fff; color: var(--syn-ink);
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
.syn-price { font-family: var(--syn-font-display); font-weight: 700; }
.syn-muted { color: var(--syn-muted); }
.syn-err { color: #b42318; font-size: 12px; }

/* ── Product list ── */
.syn-list { display: flex; flex-direction: column; }
.syn-listhead { padding: 14px 18px 8px; font-size: 13px; font-weight: 600; color: var(--syn-muted); }
.syn-row { display: flex; align-items: center; gap: 14px; padding: 12px 18px; border-top: 1px solid var(--syn-border); }
.syn-row:first-child { border-top: 0; }
.syn-thumb { width: 56px; height: 56px; border-radius: 12px; object-fit: cover; background: #f2f4f7; flex: none; }
.syn-rowbody { flex: 1 1 auto; min-width: 0; }
.syn-rowtitle { font-weight: 600; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.syn-rowmeta { display: flex; align-items: center; gap: 8px; margin-top: 3px; }
.syn-rowactions { display: flex; align-items: center; gap: 10px; flex: none; }

/* ── Cart ── */
.syn-cartempty { padding: 16px 18px; font-size: 14px; }
.syn-carttotals { border-top: 1px solid var(--syn-border); padding: 12px 18px 14px; display: flex; flex-direction: column; gap: 6px; }
.syn-totline { display: flex; align-items: center; justify-content: space-between; font-size: 14px; }
.syn-totline-grand { font-family: var(--syn-font-display); font-weight: 700; font-size: 16px; }

/* Shopping-bag button + count badge */
.syn-bag { gap: 5px; padding-left: 14px; padding-right: 14px; }
.syn-bag-icon { font-size: 15px; line-height: 1; }
.syn-bag-count {
  background: var(--syn-green); color: #fff; border-radius: 999px;
  min-width: 18px; height: 18px; display: inline-flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; padding: 0 5px;
}

/* ── Single product ── */
.syn-hero { background: #f7f8fa; aspect-ratio: 16 / 10; max-height: 220px; display: flex; align-items: center; justify-content: center; position: relative; }
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

/* Forms */
.syn-form { display: flex; flex-direction: column; gap: 14px; padding: 18px 20px; }
.syn-form-group { display: flex; flex-direction: column; gap: 6px; }
.syn-form-label { font-size: 13px; font-weight: 600; color: var(--syn-ink); }
.syn-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.syn-form-select { border: 1px solid var(--syn-border); border-radius: 12px; padding: 8px 12px; font: inherit; background: #fff; width: 100%; cursor: pointer; }

/* Radio cards */
.syn-radio-card {
  display: flex; flex-direction: column; gap: 4px; padding: 12px 14px;
  border: 1px solid var(--syn-border); border-radius: 12px; cursor: pointer;
  transition: border-color .15s ease, background .15s ease; text-align: left; background: #fff; width: 100%;
}
.syn-radio-card:hover { border-color: var(--syn-mint); }
.syn-radio-card[aria-checked="true"] { border-color: var(--syn-green); background: rgba(45,106,79,.04); }
.syn-radio-title { font-weight: 600; font-size: 14px; color: var(--syn-ink); }
.syn-radio-desc { font-size: 12px; color: var(--syn-muted); }
.syn-radio-cost { font-weight: 700; font-size: 14px; color: var(--syn-green); margin-top: 4px; }

/* Checkout footer */
.syn-checkout-footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 18px; padding: 0 20px 20px; }

/* Loading spinner */
.syn-loader-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; padding: 32px 20px; }
.syn-loader {
  width: 36px; height: 36px; border: 3px solid rgba(45,106,79,.2); border-radius: 50%;
  border-top-color: var(--syn-green); animation: syn-spin .8s linear infinite;
}
@keyframes syn-spin { to { transform: rotate(360deg); } }

/* Success state */
.syn-success-wrap { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; gap: 14px; padding: 40px 20px; }
.syn-success-icon {
  width: 56px; height: 56px; border-radius: 50%; background: rgba(82,183,136,.2);
  color: var(--syn-green); display: flex; align-items: center; justify-content: center;
  font-size: 28px; font-weight: bold;
}

/* Accordion Customizer */
.syn-accordion { display: flex; flex-direction: column; gap: 8px; margin-bottom: 14px; width: 100%; }
.syn-acc-item { border: 1px solid var(--syn-border); border-radius: 12px; overflow: hidden; background: #fff; }
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
