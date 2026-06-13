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
import { setChatAccessor, setDefaultEnvProvider } from "./macros";
import { getChat, getMeta, subscribe as subscribeRuntime } from "./runtimeStore";
import { createTavernHelper } from "./tavernHelper";
import { installSlashCommands } from "./slash";
import { ensureExtensionSettingsHost, loadEnabledExtensions } from "./extensions";

let installed = false;

// Handshake realm the shim host (public/scripts/_compat-host.js) checks before
// trusting window.__NYAA_COMPAT__. Both sides hold the same literal; swapping it
// for any other unique string on both sides leaves behaviour unchanged — it only
// has to agree. Guards a shim against binding to a foreign object that happens to
// squat the same global key.
const BRIDGE_REALM = "Nyaa be with you.";

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

  // Wire the baseline macro env so {{user}} / {{char}} (and <USER>/<BOT>) resolve
  // against the active identity. Reads live from runtimeStore meta on each call,
  // so a character/role switch is reflected without re-registering. Without this
  // those macros stay literal everywhere substituteParams runs (regex pipelines,
  // slash commands, card text).
  setDefaultEnvProvider(() => {
    const m = getMeta();
    return { user: m.userName ?? "user", char: m.characterName ?? "" };
  });

  installGlobals();

  // Register the built-in slash commands so getContext().executeSlashCommands
  // and TavernHelper.triggerSlash work, and extensions can register their own.
  installSlashCommands();

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

  // Private bridge for the ESM-import shim modules (public/script.js,
  // public/scripts/*.js). Those files are RAW static JS served same-origin and
  // loaded by an extension's `import` graph — they live OUTSIDE the Vite bundle
  // and so cannot import from src/compat directly. They reach the compat layer
  // through this single global instead. Kept on a private key (not on the ST
  // surface) so it never collides with anything an extension probes.
  //
  // `subscribe` lets a shim re-export ST's *live bindings* faithfully: ST's
  // `chat` / `name1` / `characters` are `export let` that ST reassigns, and an
  // importer's binding tracks the new value. Our runtimeStore replaces its chat
  // array on each sync, so a captured snapshot would go stale. The shim instead
  // reassigns its own module-scope `let` on every notify; ESM live bindings then
  // propagate the fresh value to every importer. The callback is fired with no
  // args — the shim re-reads getContext() for a consistent view.
  w.__NYAA_COMPAT__ = {
    realm: BRIDGE_REALM,
    getContext,
    eventSource,
    event_types,
    subscribe: (cb: () => void) => subscribeRuntime(() => cb()),
  };

  // ST extensions poll/query this container during module init and append their
  // own settings panels into it. Create it before asset injection; the React
  // modal later moves this same node into view without changing its identity.
  ensureExtensionSettingsHost();

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
export {
  getContext,
  setContextProvider,
  setSettingsPersister,
  saveSettingsDebounced,
} from "./stContext";
export {
  extension_settings,
  loadExtensionSettingsFromStorage,
  saveExtensionSettingsNow,
  loadExtensionSettingsFromIndexedDb,
  saveExtensionSettingsToIndexedDb,
} from "./extensionSettings";
export { setToastSink } from "./globals";
export {
  getRegexedString,
  runRegexScript,
  regex_placement,
  substitute_find_regex,
  getEffectiveRegexScripts,
  loadGlobalRegexScripts,
  saveGlobalRegexScripts,
  subscribeRegexScripts,
  regexExportFileName,
  serializeRegexScript,
  parseImportedRegexScripts,
} from "./regex";
export type { RegexParams } from "./regex";
export { FrontendCard } from "./render/FrontendCard";
export { isFrontendHtml, extractFrontendHtml, splitFrontendContent } from "./render/detect";
export type { FrontendContentPart } from "./render/detect";
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
  executeSlashCommands,
  registerSlashCommand,
  addCommandObject as addSlashCommand,
  listSlashCommands,
  setSlashCommandHost,
} from "./slash";
export type { SlashResult, SlashHost } from "./slash";
export {
  loadEnabledExtensions,
  isExtensionLoaded,
  resolveExtensions,
  loadUserPrefs,
  saveUserPref,
  ensureExtensionSettingsHost,
  attachExtensionSettingsHost,
  parkExtensionSettingsHost,
} from "./extensions";
export type {
  ExtensionManifest,
  RegistryEntry,
  ResolvedExtension,
} from "./extensions";
