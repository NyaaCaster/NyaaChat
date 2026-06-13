// Event bus compatible with SillyTavern's `eventSource` + `event_types`.
//
// SillyTavern extensions (and JS-Slash-Runner's render pipeline) drive
// themselves off ST's global `eventSource`. They call `eventSource.on(...)`
// and react to lifecycle events like CHARACTER_MESSAGE_RENDERED. To host
// those extensions, NyaaChat exposes a work-alike bus and emits the same
// event names at the equivalent points in its own message lifecycle.
//
// This file is intentionally dependency-free and framework-agnostic: React
// drives it (see ChatInterface) but the bus itself knows nothing about React.

/**
 * ST event name constants. Only the subset NyaaChat actually emits or that
 * the render pipeline (P4) listens for is enumerated here; the table can grow
 * as more extensions are supported. Names mirror ST's `event_types` exactly
 * so extension code that imports them by name keeps working.
 */
export const event_types = {
  APP_READY: "app_ready",
  CHAT_CHANGED: "chat_id_changed",
  CHAT_LOADED: "chatLoaded",
  MESSAGE_SENT: "message_sent",
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_EDITED: "message_edited",
  MESSAGE_DELETED: "message_deleted",
  MESSAGE_UPDATED: "message_updated",
  MESSAGE_SWIPED: "message_swiped",
  USER_MESSAGE_RENDERED: "user_message_rendered",
  CHARACTER_MESSAGE_RENDERED: "character_message_rendered",
  MORE_MESSAGES_LOADED: "more_messages_loaded",
  GENERATION_STARTED: "generation_started",
  GENERATION_ENDED: "generation_ended",
} as const;

export type EventType = (typeof event_types)[keyof typeof event_types];

type Listener = (...args: any[]) => void | Promise<void>;

/**
 * Minimal async-capable event emitter matching the surface ST extensions use:
 * on / once / emit / emitAndWait / makeFirst / makeLast / removeListener /
 * clearEvent / clearAll.
 *
 * `emitAndWait` awaits async listeners in registration order — some extensions
 * rely on a listener finishing (e.g. mutating a message) before generation
 * proceeds, so this is not fire-and-forget.
 */
export class EventBus {
  private listeners = new Map<string, Listener[]>();

  on(event: string, fn: Listener): void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(fn);
    this.listeners.set(event, arr);
  }

  makeLast(event: string, fn: Listener): void {
    this.on(event, fn);
  }

  makeFirst(event: string, fn: Listener): void {
    const arr = this.listeners.get(event) ?? [];
    arr.unshift(fn);
    this.listeners.set(event, arr);
  }

  once(event: string, fn: Listener): void {
    const wrapper: Listener = (...args) => {
      this.removeListener(event, wrapper);
      return fn(...args);
    };
    this.on(event, wrapper);
  }

  removeListener(event: string, fn: Listener): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    const next = arr.filter((l) => l !== fn);
    if (next.length) this.listeners.set(event, next);
    else this.listeners.delete(event);
  }

  clearEvent(event: string): void {
    this.listeners.delete(event);
  }

  clearAll(): void {
    this.listeners.clear();
  }

  /** Fire-and-forget: synchronous listeners run inline; async ones are kicked
   *  off but not awaited. Errors are isolated so one bad listener can't break
   *  the emit chain or the React render that triggered it. */
  emit(event: string, ...args: any[]): void {
    const arr = this.listeners.get(event);
    if (!arr) return;
    for (const fn of [...arr]) {
      try {
        void fn(...args);
      } catch (err) {
        console.error(`[compat] listener for "${event}" threw`, err);
      }
    }
  }

  /** Awaits each listener in registration order. Use when a caller needs all
   *  side effects applied before continuing (ST's `emitAndWait`). */
  async emitAndWait(event: string, ...args: any[]): Promise<void> {
    const arr = this.listeners.get(event);
    if (!arr) return;
    for (const fn of [...arr]) {
      try {
        await fn(...args);
      } catch (err) {
        console.error(`[compat] async listener for "${event}" threw`, err);
      }
    }
  }
}

/** Process-wide singleton, mirroring ST's single global `eventSource`. */
export const eventSource = new EventBus();
