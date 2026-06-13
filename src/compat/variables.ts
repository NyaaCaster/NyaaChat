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
//   - script:  in-memory, keyed by script id. Lives for the page session.
//   - message: in-memory, keyed by message floor (mesid). Lives for the page
//              session. (ST stores these on the message object; persisting them
//              into the saved chat is a later refinement.)
//
// All scopes return deep clones on read so a card mutating the returned object
// can't corrupt our store — writes must go through the setters. Matches ST's
// klona-on-read contract.

export type VariableScope = "global" | "chat" | "script" | "message" | "character" | "preset";

export interface VariableOption {
  type: VariableScope;
  /** For type 'message'. -1 / 'latest' = last message. */
  message_id?: number | "latest";
  /** For type 'script'. */
  script_id?: string;
}

const GLOBAL_KEY = "nyaachat_vars_global";
const CHAT_KEY = "nyaachat_vars_chat";

// In-memory scopes.
const scriptVars = new Map<string, Record<string, unknown>>();
const messageVars = new Map<number, Record<string, unknown>>();
// character / preset have no NyaaChat home yet — kept in memory so reads/writes
// are coherent within a session without throwing.
const characterVars: Record<string, unknown> = {};
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
  if (!chatCache) chatCache = loadPersisted(CHAT_KEY);
  return chatCache;
}

/** Resolve the live backing object for a scope (NOT cloned — internal use). */
function resolveStore(option: VariableOption): Record<string, unknown> {
  switch (option.type) {
    case "global":
      return getGlobalStore();
    case "chat":
      return getChatStore();
    case "character":
      return characterVars;
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
    case "message": {
      const id = option.message_id === undefined || option.message_id === "latest" ? -1 : option.message_id;
      let m = messageVars.get(id);
      if (!m) {
        m = {};
        messageVars.set(id, m);
      }
      return m;
    }
    default:
      return {};
  }
}

function persistIfNeeded(option: VariableOption): void {
  if (option.type === "global") savePersisted(GLOBAL_KEY, getGlobalStore());
  else if (option.type === "chat") savePersisted(CHAT_KEY, getChatStore());
}

/** Read a scope's variables (deep clone). */
export function getVariables(option: VariableOption = { type: "chat" }): Record<string, unknown> {
  return deepClone(resolveStore(option));
}

/** Replace a scope's variables wholesale. */
export function replaceVariables(
  variables: Record<string, unknown>,
  option: VariableOption = { type: "chat" },
): void {
  const next = deepClone(variables) ?? {};
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
    case "message": {
      const id = option.message_id === undefined || option.message_id === "latest" ? -1 : option.message_id;
      messageVars.set(id, next);
      break;
    }
    case "character":
      Object.keys(characterVars).forEach((k) => delete characterVars[k]);
      Object.assign(characterVars, next);
      break;
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
  const store = resolveStore(option);
  Object.assign(store, deepClone(variables));
  persistIfNeeded(option);
}

/** Insert only keys that don't already exist (ST insertVariables). */
export function insertVariables(
  variables: Record<string, unknown>,
  option: VariableOption = { type: "chat" },
): void {
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

/** Clear in-memory message/script scopes. Called on chat switch so a new
 *  conversation doesn't inherit the previous one's transient state. Persisted
 *  global stays; chat is reset too (it's conceptually per-conversation). */
export function resetTransientVariables(): void {
  scriptVars.clear();
  messageVars.clear();
  chatCache = {};
  savePersisted(CHAT_KEY, {});
}
