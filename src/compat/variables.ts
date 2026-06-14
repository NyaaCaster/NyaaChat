// Variable system for front-end cards (TavernHelper variables.*).
//
// Front-end cards lean heavily on the variable API to persist state (HP bars,
// quest progress, counters, …) across re-renders and turns. ST exposes five
// scopes (global / chat / character / preset / message) plus an internal
// `script` scope; NyaaChat has no Pinia store / chat_metadata, so this is a
// lightweight re-implementation of the scopes cards actually use:
//
//   - global:  persisted to localStorage, shared across all chats.
//   - chat:    persisted to localStorage (single key for now — NOT yet
//              partitioned per session; see TODO). Survives reload.
//   - character: persisted through the active CharacterSettings.extensions via
//              metadataBridge/writeExtensionField. Used by character script
//              variables and bindings from ST-style extensions.
//   - preset:  in-memory placeholder; NyaaChat has no ST preset store yet.
//   - script:  in-memory, keyed by script id. Lives for the page session.
//   - message: stored ON the message object (Message.variables) in React state,
//              so it serializes with the session and follows the message under
//              insert/delete — per-floor card state survives reloads and chat
//              switches. The variable layer here reads it through the runtime
//              store and writes it back via commandSetMessageVariables (React is
//              the single writer). A small write-through overlay keyed by stable
//              message id gives synchronous read-after-write coherence before
//              React round-trips the change. Matches ST, which keeps these on
//              `chat[id].variables`.
//
// All scopes return deep clones on read so a card mutating the returned object
// can't corrupt our store — writes must go through the setters. Matches ST's
// klona-on-read contract.

import { getChat, getMessageByMesId, commandSetMessageVariables } from "./runtimeStore";
import { getMeta } from "./runtimeStore";
import { getContext } from "./stContext";
import { getCharacterExtensions, writeExtensionField } from "./metadataBridge";

export type VariableScope = "global" | "chat" | "script" | "message" | "character" | "preset";

export interface VariableOption {
  type: VariableScope;
  /** For type 'message'. -1 / 'latest' = last message. */
  message_id?: number | "latest";
  /** For type 'script'. */
  script_id?: string;
}

const GLOBAL_KEY = "nyaachat_vars_global";
// Chat variables are partitioned per session (ST: variables follow the chat
// file). The active scope id is the current session id, or "__draft__" for the
// unsaved scratch chat. Keys look like `nyaachat_vars_chat::<sessionId>`.
const CHAT_KEY_PREFIX = "nyaachat_vars_chat";
const DRAFT_SCOPE = "__draft__";

let activeChatScope = DRAFT_SCOPE;

function chatKey(scope: string): string {
  return `${CHAT_KEY_PREFIX}::${scope}`;
}

// In-memory scopes.
const scriptVars = new Map<string, Record<string, unknown>>();
// Optimistic write-through overlay for message-scoped variables, keyed by the
// STABLE message id (not the floor index). The durable source of truth is
// Message.variables in React state (persisted with the session); this overlay
// only ensures synchronous read-after-write coherence within a tick before
// React re-renders and syncChat refreshes the mirror. Keying by message id (not
// mesid) keeps entries attached to the right message under insert/delete index
// shifts. Seeded lazily from the runtime store; cleared on session change.
const messageVarOverlay = new Map<string, Record<string, unknown>>();
// character variables are read from the active character's extension field and
// write back through metadataBridge, so they survive refresh with character settings.
const CHARACTER_VARIABLE_FIELD = "TavernHelper_characterScriptVariables";
const presetVars: Record<string, unknown> = {};

function deepClone<T>(v: T): T {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v ?? null));
  }
}

function loadPersisted(key: string): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePersisted(key: string, value: Record<string, unknown>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error(`[compat] failed to persist variables (${key})`, err);
  }
}

// Cache persisted scopes in memory; localStorage is the durable backing.
let globalCache: Record<string, unknown> | null = null;
let chatCache: Record<string, unknown> | null = null;

function getGlobalStore(): Record<string, unknown> {
  if (!globalCache) globalCache = loadPersisted(GLOBAL_KEY);
  return globalCache;
}
function getChatStore(): Record<string, unknown> {
  if (!chatCache) chatCache = loadPersisted(chatKey(activeChatScope));
  return chatCache;
}

function getCharacterStore(): Record<string, unknown> {
  const chid = getMeta().chid;
  const character = typeof chid === "number" ? getContext().characters?.[chid] : undefined;
  const extensions = getCharacterExtensions(character);
  const vars = extensions[CHARACTER_VARIABLE_FIELD];
  return vars && typeof vars === "object" && !Array.isArray(vars) ? (vars as Record<string, unknown>) : {};
}

function commitCharacterStore(store: Record<string, unknown>): void {
  const chid = getMeta().chid;
  if (typeof chid !== "number") return;
  void writeExtensionField(chid, CHARACTER_VARIABLE_FIELD, deepClone(store));
}

/** Switch the active chat-variable scope (called on session change). Persists
 *  the current scope first, then loads the new one. Passing null = draft scope.
 *  Message-scoped vars persist on their messages; only the optimistic overlay
 *  cache is dropped here so stale message ids don't leak across conversations. */
export function setActiveChatScope(sessionId: string | null): void {
  const next = sessionId || DRAFT_SCOPE;
  if (next === activeChatScope) return;
  // Flush current scope before switching.
  if (chatCache) savePersisted(chatKey(activeChatScope), chatCache);
  activeChatScope = next;
  chatCache = loadPersisted(chatKey(activeChatScope));
  // Message vars live on the new session's messages (rehydrated when React
  // loads them); drop the previous conversation's overlay so stale ids don't
  // bleed across.
  messageVarOverlay.clear();
}

/** Resolve a message floor index from a VariableOption. 'latest'/undefined =>
 *  last floor; negative => counted from the end (ST semantics). Returns -1 when
 *  there is no such floor. */
function resolveMessageId(option: VariableOption): number {
  const len = getChat().length;
  const raw = option.message_id;
  const idx = raw === undefined || raw === "latest" ? len - 1 : raw < 0 ? len + raw : raw;
  return idx >= 0 && idx < len ? idx : -1;
}

/** Live (mutable) overlay object for a message's variables, seeded from the
 *  runtime store on first touch. Returns null when the floor doesn't exist. */
function liveMessageVars(mesid: number): { id: string; store: Record<string, unknown> } | null {
  const m = getMessageByMesId(mesid);
  if (!m) return null;
  let store = messageVarOverlay.get(m.id);
  if (!store) {
    store = m.variables && typeof m.variables === "object" ? deepClone(m.variables) : {};
    messageVarOverlay.set(m.id, store);
  }
  return { id: m.id, store };
}

/** Commit a message's variables to React state (persists with the session). */
function commitMessageVars(mesid: number, store: Record<string, unknown>): void {
  commandSetMessageVariables(mesid, deepClone(store));
}

/** Resolve the live backing object for a scope (NOT cloned — internal use). */
function resolveStore(option: VariableOption): Record<string, unknown> {
  switch (option.type) {
    case "global":
      return getGlobalStore();
    case "chat":
      return getChatStore();
    case "character":
      return getCharacterStore();
    case "preset":
      return presetVars;
    case "script": {
      const id = option.script_id ?? "__default__";
      let s = scriptVars.get(id);
      if (!s) {
        s = {};
        scriptVars.set(id, s);
      }
      return s;
    }
    default:
      return {};
  }
}

function persistIfNeeded(option: VariableOption): void {
  if (option.type === "global") savePersisted(GLOBAL_KEY, getGlobalStore());
  else if (option.type === "chat") savePersisted(chatKey(activeChatScope), getChatStore());
  else if (option.type === "character") commitCharacterStore(getCharacterStore());
}

/** Read a scope's variables (deep clone). */
export function getVariables(option: VariableOption = { type: "chat" }): Record<string, unknown> {
  if (option.type === "message") {
    const live = liveMessageVars(resolveMessageId(option));
    return live ? deepClone(live.store) : {};
  }
  return deepClone(resolveStore(option));
}

/** Replace a scope's variables wholesale. */
export function replaceVariables(
  variables: Record<string, unknown>,
  option: VariableOption = { type: "chat" },
): void {
  const next = deepClone(variables) ?? {};
  if (option.type === "message") {
    const mesid = resolveMessageId(option);
    const m = mesid >= 0 ? getMessageByMesId(mesid) : null;
    if (!m) return;
    messageVarOverlay.set(m.id, next);
    commitMessageVars(mesid, next);
    return;
  }
  switch (option.type) {
    case "global":
      globalCache = next;
      break;
    case "chat":
      chatCache = next;
      break;
    case "script":
      scriptVars.set(option.script_id ?? "__default__", next);
      break;
    case "character":
      commitCharacterStore(next);
      return;
    case "preset":
      Object.keys(presetVars).forEach((k) => delete presetVars[k]);
      Object.assign(presetVars, next);
      break;
  }
  persistIfNeeded(option);
}

/** Shallow-merge `variables` into a scope (ST insertOrAssignVariables). */
export function insertOrAssignVariables(
  variables: Record<string, unknown>,
  option: VariableOption = { type: "chat" },
): void {
  if (option.type === "message") {
    const mesid = resolveMessageId(option);
    const live = liveMessageVars(mesid);
    if (!live) return;
    Object.assign(live.store, deepClone(variables));
    commitMessageVars(mesid, live.store);
    return;
  }
  const store = resolveStore(option);
  Object.assign(store, deepClone(variables));
  persistIfNeeded(option);
}

/** Insert only keys that don't already exist (ST insertVariables). */
export function insertVariables(
  variables: Record<string, unknown>,
  option: VariableOption = { type: "chat" },
): void {
  if (option.type === "message") {
    const mesid = resolveMessageId(option);
    const live = liveMessageVars(mesid);
    if (!live) return;
    const incoming = deepClone(variables);
    for (const k in incoming) {
      if (Object.hasOwn(incoming, k) && !Object.hasOwn(live.store, k)) {
        live.store[k] = incoming[k];
      }
    }
    commitMessageVars(mesid, live.store);
    return;
  }
  const store = resolveStore(option);
  const incoming = deepClone(variables);
  for (const k in incoming) {
    if (Object.hasOwn(incoming, k) && !Object.hasOwn(store, k)) {
      store[k] = incoming[k];
    }
  }
  persistIfNeeded(option);
}

/** Delete a single key (dot-paths not supported yet). Returns whether it
 *  existed. */
export function deleteVariable(key: string, option: VariableOption = { type: "chat" }): boolean {
  if (option.type === "message") {
    const mesid = resolveMessageId(option);
    const live = liveMessageVars(mesid);
    if (!live || !Object.hasOwn(live.store, key)) return false;
    delete live.store[key];
    commitMessageVars(mesid, live.store);
    return true;
  }
  const store = resolveStore(option);
  if (Object.hasOwn(store, key)) {
    delete store[key];
    persistIfNeeded(option);
    return true;
  }
  return false;
}

/** Read-modify-write helper (ST updateVariablesWith). The updater receives a
 *  live clone and must return the new full variable object. */
export function updateVariablesWith(
  updater: (vars: Record<string, unknown>) => Record<string, unknown>,
  option: VariableOption = { type: "chat" },
): Record<string, unknown> {
  const current = getVariables(option);
  const next = updater(current) ?? current;
  replaceVariables(next, option);
  return next;
}

/** Clear in-memory script scope, and the message-variable overlay. Called on
 *  character switch for truly transient state. Chat variables are NOT cleared
 *  here — they're partitioned per session and managed by setActiveChatScope, so
 *  they persist with their conversation. Message variables live on the messages
 *  themselves (the overlay is just an optimistic cache), so clearing the overlay
 *  here only drops the cache — the durable per-floor state goes away naturally
 *  when buildFirstMes replaces the chat with fresh message objects. Persisted
 *  global stays. */
export function resetTransientVariables(): void {
  scriptVars.clear();
  messageVarOverlay.clear();
}

// One-time migration: P5a stored chat variables under a single un-partitioned
// key `nyaachat_vars_chat`. Now that chat vars are per-session, fold any legacy
// data into the draft scope and remove the stale key so it doesn't linger.
(function migrateLegacyChatVars() {
  try {
    if (typeof localStorage === "undefined") return;
    const legacy = localStorage.getItem(CHAT_KEY_PREFIX);
    if (legacy === null) return;
    const draftKey = chatKey(DRAFT_SCOPE);
    if (localStorage.getItem(draftKey) === null) {
      localStorage.setItem(draftKey, legacy);
    }
    localStorage.removeItem(CHAT_KEY_PREFIX);
  } catch {
    // Migration is best-effort; a failure just leaves the legacy key in place.
  }
})();
