// Compat layer installer — the single entry point that wires NyaaChat's
// SillyTavern compatibility surface onto the page.
//
// `installCompatLayer()` is called once from main.tsx. It:
//   1. mounts window.SillyTavern.getContext (the entry ST extensions use),
//   2. installs the minimal window globals (toastr),
//   3. exposes the event bus and macro engine for app code to import.
//
// IDEMPOTENCY is mandatory: main.tsx runs under React StrictMode, whose effects
// fire twice in development, and HMR can re-run this module. Installing twice
// must be harmless — we guard with a flag and never re-create the singletons
// (eventSource, runtimeStore state) which live at module scope anyway.
//
// React → compat data flow is set up here via providers/accessors; the actual
// push of live data happens from ChatInterface (see syncChat/syncMeta). This
// module only declares HOW the compat layer reads app state, not WHEN.

import { eventSource, event_types } from "./events";
import { getContext } from "./stContext";
import { installGlobals } from "./globals";
import { setChatAccessor } from "./macros";
import { getChat } from "./runtimeStore";
import { createTavernHelper } from "./tavernHelper";
import { loadEnabledExtensions } from "./extensions";

let installed = false;

/**
 * Install the compatibility layer. Safe to call multiple times — only the
 * first call has effect.
 */
export function installCompatLayer(): void {
  if (installed) return;
  if (typeof window === "undefined") return;
  installed = true;

  // Macros read the live chat through runtimeStore. Wire the accessor once so
  // {{lastMessage}} etc. resolve against the current mirror.
  setChatAccessor(() => getChat());

  installGlobals();

  // The ST global. getContext() returns a fresh object with live getters on
  // each call (matching ST), so we expose the function, not a snapshot.
  const w = window as unknown as Record<string, unknown>;
  w.SillyTavern = {
    getContext,
    // ST also exposes these at the top level for some older extensions.
    eventSource,
    event_types,
  };

  // Front-end cards reach for window.TavernHelper. Install the real
  // implementation (P5). Don't clobber a richer one if already present.
  if (!w.TavernHelper) {
    w.TavernHelper = createTavernHelper();
  }

  // Load build-time bundled extensions (decision B-revised). Fire-and-forget:
  // extension loading is async (fetch registry + manifests + inject scripts)
  // and must not block compat-layer install. The globals above are already in
  // place, so an extension's entry script can use window.SillyTavern /
  // TavernHelper as soon as it runs.
  void loadEnabledExtensions().catch((err) =>
    console.error("[compat] extension loading failed", err),
  );
}

// Re-export the pieces app code imports directly, so callers can pull from a
// single module: `import { eventSource, substituteParams } from "@/compat"`.
export { eventSource, event_types } from "./events";
export type { EventType } from "./events";
export { substituteParams, substituteParamsExtended, setDefaultEnvProvider } from "./macros";
export type { MacroEnv } from "./macros";
export {
  syncChat,
  syncMeta,
  subscribe as subscribeRuntime,
  getChat,
  getMeta,
  getMessageByMesId,
  setMessageWriter,
  emitUserMessageRendered,
  emitCharacterMessageRendered,
  emitMessageUpdated,
  emitMessageDeleted,
} from "./runtimeStore";
export type { RuntimeMessage, RuntimeMeta, MessageWriter } from "./runtimeStore";
export { getContext, setContextProvider } from "./stContext";
export { setToastSink } from "./globals";
export {
  getRegexedString,
  runRegexScript,
  regex_placement,
  substitute_find_regex,
  getEffectiveRegexScripts,
  loadGlobalRegexScripts,
  saveGlobalRegexScripts,
} from "./regex";
export type { RegexParams } from "./regex";
export { FrontendCard } from "./render/FrontendCard";
export { isFrontendHtml, extractFrontendHtml } from "./render/detect";
export {
  getVariables,
  replaceVariables,
  insertOrAssignVariables,
  insertVariables,
  deleteVariable,
  updateVariablesWith,
  resetTransientVariables,
  setActiveChatScope,
} from "./variables";
export type { VariableScope, VariableOption } from "./variables";
export { setGenerateApiResolver } from "./generate";
export {
  loadEnabledExtensions,
  isExtensionLoaded,
  resolveExtensions,
  loadUserPrefs,
  saveUserPref,
} from "./extensions";
export type {
  ExtensionManifest,
  RegistryEntry,
  ResolvedExtension,
} from "./extensions";
