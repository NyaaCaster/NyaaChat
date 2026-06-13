// TavernHelper API implementation (P5).
//
// Front-end cards call into `window.TavernHelper.*` for chat data, variables,
// events, etc. P4 shipped a no-op stub so cards wouldn't crash on load; P5
// replaces it with real implementations of the domains cards actually use,
// backed by NyaaChat's own state (runtimeStore, the variable system, the event
// bus). Per decision A3 this is the rendering-relevant subset, not the full ST
// surface — unimplemented corners still warn rather than throw.
//
// Scope of P5:
//   - variables.*   : real, persisted (see variables.ts)
//   - chat reads    : getChatMessages / getLastMessageId from runtimeStore
//   - events        : eventOn/eventEmit/... forwarded to the shared eventSource
//   - misc reads    : getCharData, version
//   - generate      : deferred — wired to the real LLM client in a later pass;
//                     stays a warning no-op so a card calling it degrades.

import { eventSource } from "./events";
import { getChat, getMeta } from "./runtimeStore";
import {
  getVariables,
  replaceVariables,
  insertOrAssignVariables,
  insertVariables,
  deleteVariable,
  updateVariablesWith,
} from "./variables";

const warned = new Set<string>();
function warnOnce(name: string): void {
  if (warned.has(name)) return;
  warned.add(name);
  console.warn(`[compat] TavernHelper.${name} is not implemented yet (P5 scope)`);
}

// --- chat message reads -----------------------------------------------------

interface ChatMessageView {
  message_id: number;
  name: string;
  role: "system" | "assistant" | "user";
  is_hidden: boolean;
  message: string;
}

/** Parse ST's range syntax: a number, "N", "a-b", with negative = from end. */
function parseRange(input: string | number, min: number, max: number): { start: number; end: number } | null {
  const clamp = (v: number) => Math.max(min, Math.min(max, v < 0 ? max + v + 1 : v));
  const s = String(input).trim();
  if (/^-?\d+$/.test(s)) {
    const n = clamp(Number(s));
    return { start: n, end: n };
  }
  const m = s.match(/^(-?\d+)-(-?\d+)$/);
  if (!m) return null;
  const a = clamp(Number(m[1]));
  const b = clamp(Number(m[2]));
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

function roleToView(role: "system" | "user" | "assistant"): ChatMessageView["role"] {
  return role;
}

function getChatMessages(
  range: string | number,
  opts: { role?: "all" | "system" | "assistant" | "user"; hide_state?: "all" | "hidden" | "unhidden" } = {},
): ChatMessageView[] {
  const { role = "all", hide_state = "all" } = opts;
  const chat = getChat();
  if (chat.length === 0) return [];
  const r = parseRange(range, 0, chat.length - 1);
  if (!r) return [];

  const out: ChatMessageView[] = [];
  for (let i = r.start; i <= r.end; i++) {
    const m = chat[i];
    if (!m) continue;
    const viewRole = roleToView(m.role);
    if (role !== "all" && viewRole !== role) continue;
    const hidden = !!m.isSystem;
    if (hide_state === "hidden" && !hidden) continue;
    if (hide_state === "unhidden" && hidden) continue;
    out.push({
      message_id: i,
      name: m.name ?? (m.role === "user" ? getMeta().userName ?? "user" : getMeta().characterName ?? ""),
      role: viewRole,
      is_hidden: hidden,
      message: m.content ?? "",
    });
  }
  return out;
}

function getLastMessageId(): number {
  return getChat().length - 1;
}

// --- event forwarding -------------------------------------------------------
//
// Cards register listeners and emit events through TavernHelper; forward all of
// it to the shared eventSource so host code and cards see one bus.

type Listener = (...args: any[]) => void | Promise<void>;

// --- the real TavernHelper object ------------------------------------------

export function createTavernHelper(): Record<string, unknown> {
  return {
    // chat reads
    getChatMessages,
    getLastMessageId,

    // variables — real, persisted
    getVariables,
    replaceVariables,
    insertOrAssignVariables,
    insertVariables,
    deleteVariable,
    updateVariablesWith,

    // events — forwarded to the shared bus
    eventOn: (event: string, fn: Listener) => eventSource.on(event, fn),
    eventOnce: (event: string, fn: Listener) => eventSource.once(event, fn),
    eventMakeFirst: (event: string, fn: Listener) => eventSource.makeFirst(event, fn),
    eventMakeLast: (event: string, fn: Listener) => eventSource.makeLast(event, fn),
    eventRemoveListener: (event: string, fn: Listener) => eventSource.removeListener(event, fn),
    eventClearEvent: (event: string) => eventSource.clearEvent(event),
    eventClearAll: () => eventSource.clearAll(),
    eventEmit: (event: string, ...args: unknown[]) => eventSource.emit(event, ...args),
    eventEmitAndWait: (event: string, ...args: unknown[]) => eventSource.emitAndWait(event, ...args),

    // misc reads
    getCharData: () => {
      const meta = getMeta();
      return meta.characterId ? { name: meta.characterName } : null;
    },
    getCurrentCharacterName: () => getMeta().characterName ?? "",
    getTavernRegexes: () => [],
    version: () => "nyaachat-compat",

    // deferred to a later pass — degrade with a warning, don't throw
    generate: () => {
      warnOnce("generate");
      return Promise.resolve("");
    },
    generateRaw: () => {
      warnOnce("generateRaw");
      return Promise.resolve("");
    },
    triggerSlash: () => {
      warnOnce("triggerSlash");
      return Promise.resolve("");
    },

    // predefine.js flattens TavernHelper._bind onto globals; we don't ship that
    // mechanism, so expose an empty _bind to keep the bridge defensive.
    _bind: {},
  };
}
