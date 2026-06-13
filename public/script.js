// Shim for SillyTavern's public/script.js — served at the web root so an
// extension's `import { ... } from "../../../../script.js"` resolves here (the
// extension is served at /scripts/extensions/third-party/<id>/, the same depth
// ST uses). Exposes the high-frequency subset of script.js's exports, backed by
// the compat layer through the host bridge.
//
// LIVE BINDINGS: ST's `chat`, `name1`, `name2`, `characters`, `this_chid` are
// `export let` that ST reassigns; importers see the new value. We mirror that by
// reassigning these module-scope `let`s on every host change — ESM live bindings
// then propagate to every importer, so an extension reading `chat` always sees
// the current array (our runtimeStore swaps the array reference on each sync).

import { ctx, eventSource, event_types, onHostChange, warnOnce, forward } from "./scripts/_compat-host.js";

export { eventSource, event_types };

// --- live state -------------------------------------------------------------
export let chat = ctx().chat;
export let characters = ctx().characters;
export let this_chid = ctx().this_chid;
export let name1 = ctx().name1;
export let name2 = ctx().name2;
export let chat_metadata = ctx().chat_metadata;

onHostChange(() => {
  const c = ctx();
  chat = c.chat;
  characters = c.characters;
  this_chid = c.this_chid;
  name1 = c.name1;
  name2 = c.name2;
  chat_metadata = c.chat_metadata;
});

// --- the entry extensions reach for ----------------------------------------
export function getContext() {
  return ctx();
}

// --- events / macros / settings (forward to compat) ------------------------
export const saveSettingsDebounced = (...a) => ctx().saveSettingsDebounced(...a);
export const substituteParams = (...a) => ctx().substituteParams(...a);
export const substituteParamsExtended = (...a) => ctx().substituteParamsExtended(...a);
export const setExtensionPrompt = (...a) => ctx().setExtensionPrompt(...a);
export function getRequestHeaders() {
  return ctx().getRequestHeaders();
}
export function messageFormatting(text) {
  return ctx().messageFormatting(text);
}

// --- extension prompt enums (constants in ST; reproduced) ------------------
export const extension_prompt_types = { IN_PROMPT: 0, IN_CHAT: 1, BEFORE_PROMPT: 2 };
export const extension_prompt_roles = { SYSTEM: 0, USER: 1, ASSISTANT: 2 };
export const MAX_INJECTION_DEPTH = 1000;
export const systemUserName = "System";

// --- chat lifecycle (best-effort / not wired) ------------------------------
export function getCurrentChatId() {
  // NyaaChat sessions aren't exposed to the compat layer as a chat id yet.
  return undefined;
}
export const saveChat = () => Promise.resolve();
export const saveChatConditional = () => Promise.resolve();
export const reloadCurrentChat = () => Promise.resolve();
export const addOneMessage = forward("addOneMessage", undefined);

// --- generation (warn-once stubs; semantics differ from TavernHelper) -------
export function generate(...args) {
  void args;
  warnOnce("generate() from script.js is not wired; use TavernHelper.generate");
  return Promise.resolve("");
}
export function generateRaw(...args) {
  void args;
  warnOnce("generateRaw() from script.js is not wired; use TavernHelper.generateRaw");
  return Promise.resolve("");
}
export function generateQuietPrompt(...args) {
  void args;
  warnOnce("generateQuietPrompt() is not implemented in the NyaaChat compat layer");
  return Promise.resolve("");
}

// --- popups (re-exported from the popup shim for `import { callPopup }`) ----
export { callPopup, callGenericPopup, Popup, POPUP_TYPE, POPUP_RESULT } from "./scripts/popup.js";
