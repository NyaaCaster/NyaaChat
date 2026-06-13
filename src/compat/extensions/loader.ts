// Extension loader.
//
// Injects the js/css of effective extensions into the page, ordered by
// loading_order (ascending, ST semantics). Mirrors SillyTavern's injection:
// <script type="module"> appended to <body>, <link rel="stylesheet"> to <head>,
// both id-guarded so a double call (StrictMode, re-resolve) can't double-inject.
//
// "Effective" = rootEnabled && (userPref ?? defaultUserEnabled), computed by the
// registry resolver. The loader itself only loads; it does not decide policy.
//
// NOTE (hard bone #2): this loads the extension's entry script as-is. Extensions
// that import ST internal ESM modules ("../../../script.js") will fail to
// resolve those URLs — only "global API" extensions (those that read
// window.SillyTavern / window.TavernHelper, installed by the compat layer) work
// today. A shim layer for ESM-import extensions is future work.

import { EXTENSIONS_BASE, resolveExtensions } from "./registry";
import type { ResolvedExtension } from "./types";

const loadedScripts = new Set<string>();
const loadedStyles = new Set<string>();

function injectCss(id: string, href: string): void {
  const elId = `ext-css-${id}`;
  if (document.getElementById(elId)) return;
  const link = document.createElement("link");
  link.id = elId;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
  loadedStyles.add(id);
}

function injectScript(id: string, src: string): Promise<void> {
  const elId = `ext-js-${id}`;
  if (document.getElementById(elId)) return Promise.resolve();
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.id = elId;
    script.type = "module";
    script.src = src;
    script.async = true;
    script.onload = () => {
      loadedScripts.add(id);
      resolve();
    };
    script.onerror = (err) => {
      console.error(`[compat] extension "${id}" script failed to load`, err);
      // Resolve anyway — one broken extension shouldn't block the rest.
      resolve();
    };
    document.body.appendChild(script);
  });
}

/** Load one resolved extension's assets (css then js). */
async function loadExtension(ext: ResolvedExtension): Promise<void> {
  const dir = `${EXTENSIONS_BASE}/${ext.id}`;
  if (ext.manifest.css) {
    injectCss(ext.id, `${dir}/${ext.manifest.css}`);
  }
  if (ext.manifest.js) {
    await injectScript(ext.id, `${dir}/${ext.manifest.js}`);
  }
}

/**
 * Resolve the registry and load every effective extension, in loading_order.
 * Idempotent: assets already injected (by id) are skipped, so calling this
 * again after a user toggles a preference only injects the newly-enabled ones.
 *
 * Once-loaded scripts cannot be un-injected from a live page — disabling an
 * extension takes effect on the next reload. The user panel communicates this.
 */
export async function loadEnabledExtensions(): Promise<ResolvedExtension[]> {
  const all = await resolveExtensions();
  const enabled = all
    .filter((e) => e.effective)
    .sort((a, b) => (a.manifest.loading_order ?? 100) - (b.manifest.loading_order ?? 100));

  for (const ext of enabled) {
    await loadExtension(ext);
  }
  return all;
}

/** Whether an extension's script has been injected this page session. Used by
 *  the panel to tell the user a reload is needed to fully disable one. */
export function isExtensionLoaded(id: string): boolean {
  return loadedScripts.has(id) || loadedStyles.has(id);
}
