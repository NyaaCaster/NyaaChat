/**
 * Status-bar tint for the installed (standalone) PWA.
 *
 * WHY THIS EXISTS
 *   In `display: standalone` Android keeps the system status bar and tints it
 *   with the `theme-color` the page declares. That tint must therefore be the
 *   app's *background* colour — using the brand blue would paint an opaque blue
 *   band above the UI (which is exactly the bug this module fixes).
 *
 * SINGLE SOURCE OF TRUTH
 *   These two hex values are mirrored by an inline bootstrap script in
 *   index.html. That copy is unavoidable: it must run before React mounts, and
 *   a module import would arrive too late to avoid a wrong-coloured first
 *   frame. If you change a value here, change it there too — this is the one
 *   duplicated constant in the PWA plumbing.
 *
 *   The values themselves must match the app background in two places:
 *     - `index.css` `@layer base { body { … } }`
 *     - `ChatInterface.tsx` root container (`bg-[#FCFCFD] dark:bg-[#0A0A0A]`)
 */

export const LIGHT_BG = "#FCFCFD";
export const DARK_BG = "#0A0A0A";

/** The app's resolved theme, matching the `light`/`dark` classes on <html>. */
export type ResolvedTheme = "light" | "dark";

/**
 * Paint the <meta name="theme-color"> tag to match the resolved theme.
 *
 * Called whenever the effective theme changes — including a *manual* switch in
 * settings, which the index.html bootstrap cannot know about because the
 * preference lives in IndexedDB rather than in a synchronously readable store.
 * Safe to call on every theme change; it is idempotent.
 */
export function applyThemeColor(theme: ResolvedTheme): void {
  const isDark = theme === "dark";
  const color = isDark ? DARK_BG : LIGHT_BG;

  // There should be exactly one theme-color tag (declared in index.html), but
  // query all and update each so a duplicate added by a plugin cannot win.
  const metas = document.querySelectorAll("meta[name='theme-color']");
  if (metas.length === 0) {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    meta.setAttribute("content", color);
    document.head.appendChild(meta);
    return;
  }
  metas.forEach((meta) => meta.setAttribute("content", color));
}

/**
 * Resolve the theme the app will actually apply, given the user's setting.
 *
 * Mirrors the resolution in App.tsx's theme effect: "system" defers to the OS
 * media query, otherwise the explicit choice wins. Kept here so the two call
 * sites (App.tsx and any future consumer) agree by construction.
 */
export function resolveTheme(setting: "light" | "dark" | "system"): ResolvedTheme {
  if (setting === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return setting;
}
