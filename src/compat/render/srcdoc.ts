// iframe document assembly for front-end card rendering.
//
// JS-Slash-Runner builds an srcdoc HTML document around the card markup that
// (a) injects a "bridge" so code inside the card can reach the host's
// SillyTavern / TavernHelper APIs via window.parent (same-origin, no sandbox),
// and (b) auto-sizes the iframe to its content (SSOT §2.4).
//
// We reproduce that document here, but the bridge is written in plain JS with
// no lodash/jQuery dependency (ST's predefine.js leans on window.parent._ and
// $, which NyaaChat doesn't ship). The card itself may still pull jQuery/Vue/
// etc. from a CDN if it wants them — that's the card's concern, inside the
// iframe.
//
// SECURITY NOTE: this iframe is intentionally same-origin and NOT sandboxed —
// that is the whole point of ST card compatibility (cards reach back into the
// host to read chat state, call generate, etc.). It means card HTML runs with
// full access to the host page. Cards come from the model / character author,
// which the user has already chosen to trust by loading that character. This is
// the same trust model as ST. Do not render arbitrary untrusted HTML through
// this path.

/** Inline bridge script. Runs first inside the iframe. Exposes the host's
 *  compat globals to card code via window.parent. Mirrors predefine.js but
 *  dependency-free. */
const BRIDGE_SCRIPT = `
(function () {
  try {
    var P = window.parent;
    // Forward the SillyTavern global as a live getter so a card capturing it
    // still sees current host state (matches ST's predefine behaviour).
    Object.defineProperty(window, 'SillyTavern', {
      configurable: true,
      get: function () { return P.SillyTavern; },
    });
    if (P.TavernHelper) {
      window.TavernHelper = P.TavernHelper;
    }
    if (P.toastr) { window.toastr = P.toastr; }
  } catch (e) {
    // Cross-origin would throw; we are same-origin by construction, so a throw
    // here means something is misconfigured. Surface it for debugging.
    console.error('[compat] card bridge failed', e);
  }
})();
`;

/** Height auto-sizing script. A ResizeObserver on <body> writes the measured
 *  height straight to frameElement.style.height — only possible because the
 *  iframe is same-origin (SSOT §2.4). Throttled via rAF. */
const HEIGHT_SCRIPT = `
(function () {
  var scheduled = false;
  function measure() {
    scheduled = false;
    try {
      var h = document.body ? document.body.scrollHeight : 0;
      if (!isFinite(h) || h <= 0) return;
      if (window.frameElement) window.frameElement.style.height = h + 'px';
    } catch (e) {}
  }
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(measure);
    else setTimeout(measure, 100);
  }
  function start() {
    schedule();
    try {
      if (document.body && typeof ResizeObserver === 'function') {
        new ResizeObserver(schedule).observe(document.body);
      }
    } catch (e) {}
    window.addEventListener('load', schedule);
    // Re-measure once images/fonts settle.
    setTimeout(schedule, 300);
    setTimeout(schedule, 1000);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
`;

/**
 * Build the full srcdoc document for a card. `origin` lets relative URLs in the
 * card resolve against the host origin (ST uses a <base> tag for this).
 */
export function buildCardSrcdoc(html: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${origin ? `<base href="${origin}/">` : ""}
<style>
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0;padding:0;max-width:100%;}
body{overflow:hidden;}
</style>
<script>${BRIDGE_SCRIPT}</script>
</head>
<body>
${html}
<script>${HEIGHT_SCRIPT}</script>
</body>
</html>`;
}
