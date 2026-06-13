// Module-level runtime mirror of the live chat.
//
// SillyTavern keeps `chat` (and `characters`, `this_chid`, …) as module-level
// globals that extensions read synchronously via getContext(). NyaaChat instead
// holds messages in ChatInterface component state (useState) — not reachable
// from outside React, and not synchronous for extension code.
//
// This store bridges the gap: ChatInterface pushes its state in here on every
// change (one-way: React → store, never the reverse), and the compat layer
// (stContext, macros, the render pipeline) reads from here. It is deliberately
// framework-agnostic and dependency-free, mirroring events.ts.
//
// One-way sync is the whole point. The store never calls back into React to
// mutate messages; if an extension needs to change a message it goes through an
// explicit compat API that ends up calling a React setter. That keeps React the
// single writer of its own state and avoids the "external jQuery mutates the
// DOM React owns" class of bugs (hard bone #1).

import { eventSource, event_types } from "./events";
import type { MacroChatMessage } from "./macros";

/** Chat message shape the runtime exposes. Superset of MacroChatMessage with
 *  the fields the render pipeline needs to map a DOM bubble back to a message
 *  (mesid) and ST-flavoured metadata. Kept structurally close to the app's
 *  `Message` so syncing is a shallow map, not a transform. */
export interface RuntimeMessage extends MacroChatMessage {
  /** Stable app-side id (Message.id). */
  id: string;
  /** Floor number = index in the chat array. ST extensions and the render
   *  pipeline reference messages by this, not by `id`. */
  mesid: number;
  role: "system" | "user" | "assistant";
  content: string;
  isSystem?: boolean;
  /** True for the character's name side, mirrors ST's `is_user` inverse. */
  name?: string;
  /** Message-scoped front-end-card variables (ST: `message.variables`). Mirror
   *  of Message.variables; the durable source is React state. The variable
   *  compat layer reads from here and writes back via commandSetMessageVariables
   *  so the data persists with the session. */
  variables?: Record<string, unknown>;
}

/** Active-context metadata, the slice of getContext() that is not the chat
 *  array itself. Populated from app state by ChatInterface. */
export interface RuntimeMeta {
  characterId: string | null;
  characterName: string | null;
  userName: string | null;
  /** ST exposes the active character index as `this_chid`. We map the active
   *  character's position in the characters list, or null when none. */
  chid: number | null;
}

interface RuntimeState {
  chat: RuntimeMessage[];
  meta: RuntimeMeta;
}

type Subscriber = (state: RuntimeState) => void;

const EMPTY_META: RuntimeMeta = {
  characterId: null,
  characterName: null,
  userName: null,
  chid: null,
};

const state: RuntimeState = {
  chat: [],
  meta: { ...EMPTY_META },
};

const subscribers = new Set<Subscriber>();

/** Read-only snapshot of the chat array. Callers MUST treat it as immutable;
 *  mutating it would desync from React. Returns the live reference (no copy)
 *  for cheap synchronous reads — this matches ST where `chat` is the global. */
export function getChat(): RuntimeMessage[] {
  return state.chat;
}

export function getMeta(): RuntimeMeta {
  return state.meta;
}

/** Look up a message by floor number (mesid). Returns null if out of range. */
export function getMessageByMesId(mesid: number): RuntimeMessage | null {
  return state.chat[mesid] ?? null;
}

function notify(): void {
  for (const fn of [...subscribers]) {
    try {
      fn(state);
    } catch (err) {
      console.error("[compat] runtimeStore subscriber threw", err);
    }
  }
}

/** Subscribe to store changes. Returns an unsubscribe fn. */
export function subscribe(fn: Subscriber): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

/**
 * Push the latest chat from React into the store. ChatInterface calls this in
 * an effect keyed on its `messages` state. `mesid` is assigned here as the
 * array index so it always agrees with positions in `chat`.
 *
 * Lifecycle events are intentionally NOT emitted here — message-level events
 * (USER_MESSAGE_RENDERED, CHARACTER_MESSAGE_RENDERED, …) have semantics tied to
 * *which* message and *why* it changed, which this bulk-sync can't infer. The
 * caller emits those explicitly at the right moments. This function only keeps
 * the mirror current and fires subscribers.
 */
export function syncChat(
  messages: Array<{
    id: string;
    role: RuntimeMessage["role"];
    content: string;
    variables?: Record<string, unknown>;
  }>,
): void {
  state.chat = messages.map((m, i) => ({
    id: m.id,
    mesid: i,
    role: m.role,
    content: m.content,
    isSystem: m.role === "system",
    variables: m.variables,
  }));
  notify();
}

/** Update active-context metadata (character / user). Separate from syncChat
 *  because it changes on a different cadence (character switch, role switch). */
export function syncMeta(meta: Partial<RuntimeMeta>): void {
  state.meta = { ...state.meta, ...meta };
  notify();
}

/** Reset to empty. Used on teardown / tests; idempotent. */
export function resetRuntime(): void {
  state.chat = [];
  state.meta = { ...EMPTY_META };
  notify();
}

// --- write-back channel (store → React) ------------------------------------
//
// The store mirrors React state ONE WAY (React → store via syncChat). But some
// compat APIs (TavernHelper.setChatMessage / createChatMessages /
// deleteChatMessages, used by front-end cards) need to MUTATE the chat. To keep
// React the single writer of its own state, the store never edits its mirror
// directly — instead ChatInterface registers a MessageWriter, and these command
// functions forward intent to it. React applies the change, then syncChat flows
// the result back into the mirror. If no writer is registered (e.g. tests), the
// commands are no-ops that warn.

export interface MessageWriter {
  /** Replace the content of the message at floor `mesid`. */
  setMessage: (mesid: number, content: string) => void;
  /** Insert a message at `index` (clamped; index >= length appends). */
  insertMessage: (index: number, msg: { role: RuntimeMessage["role"]; content: string }) => void;
  /** Delete the message at floor `mesid`. */
  deleteMessage: (mesid: number) => void;
  /** Replace the message-scoped variables of the message at floor `mesid`.
   *  Keeps React the single writer of Message.variables so the change persists
   *  with the session. */
  setMessageVariables: (mesid: number, variables: Record<string, unknown>) => void;
}

let writer: MessageWriter | null = null;

/** Register the React-side writer. Called by ChatInterface; passing null
 *  detaches (teardown). */
export function setMessageWriter(w: MessageWriter | null): void {
  writer = w;
}

function requireWriter(op: string): MessageWriter | null {
  if (!writer) {
    console.warn(`[compat] runtimeStore.${op}: no MessageWriter registered (host not ready?)`);
    return null;
  }
  return writer;
}

/** Command: set a message's content by floor number. */
export function commandSetMessage(mesid: number, content: string): void {
  requireWriter("setMessage")?.setMessage(mesid, content);
}

/** Command: insert a message at a position (default append). */
export function commandInsertMessage(
  index: number,
  msg: { role: RuntimeMessage["role"]; content: string },
): void {
  requireWriter("insertMessage")?.insertMessage(index, msg);
}

/** Command: delete a message by floor number. */
export function commandDeleteMessage(mesid: number): void {
  requireWriter("deleteMessage")?.deleteMessage(mesid);
}

/** Command: replace a message's message-scoped variables by floor number. Used
 *  by the variable compat layer so per-floor card variables flow into React
 *  state and persist with the session. */
export function commandSetMessageVariables(mesid: number, variables: Record<string, unknown>): void {
  requireWriter("setMessageVariables")?.setMessageVariables(mesid, variables);
}

// --- convenience emit helpers ----------------------------------------------
//
// Thin wrappers so ChatInterface doesn't have to import event_types directly
// for the common lifecycle moments. They keep the (mesid) payload convention
// ST extensions expect.

export function emitUserMessageRendered(mesid: number): void {
  eventSource.emit(event_types.USER_MESSAGE_RENDERED, mesid);
}

export function emitCharacterMessageRendered(mesid: number): void {
  eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, mesid);
}

export function emitMessageUpdated(mesid: number): void {
  eventSource.emit(event_types.MESSAGE_UPDATED, mesid);
}

export function emitMessageDeleted(mesid: number): void {
  eventSource.emit(event_types.MESSAGE_DELETED, mesid);
}
