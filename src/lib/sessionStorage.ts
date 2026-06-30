import { ChatSession } from "../types";
import { getItem, setItem, removeItem } from "./idbStorage";

export const STORAGE_KEY = "nyaachat_sessions";
const LAST_SESSION_KEY = "nyaachat_last_session_id";

// ---------------------------------------------------------------------------
// In-memory caches — populated at bootstrap by hydrateSessions(), then kept
// in sync on every write so synchronous reads (React render bodies, useState
// initialisers) always return the latest data without awaiting.
// ---------------------------------------------------------------------------

let sessionsCache: ChatSession[] | null = null;
let lastSessionIdCache: string | null = null;

/** Load session data from IndexedDB into the in-memory caches.  Called once
 *  during bootstrap before React mounts. */
export async function hydrateSessions(): Promise<void> {
  try {
    const raw = await getItem(STORAGE_KEY);
    sessionsCache = raw ? JSON.parse(raw) : [];
  } catch {
    sessionsCache = [];
  }
  try {
    const raw = await getItem(LAST_SESSION_KEY);
    lastSessionIdCache = raw && raw.length > 0 ? raw : null;
  } catch {
    lastSessionIdCache = null;
  }
}

// ---------------------------------------------------------------------------
// Synchronous reads (safe because hydrateSessions() runs before first render)
// ---------------------------------------------------------------------------

export function loadSessions(): ChatSession[] {
  return sessionsCache ?? [];
}

export function loadLastSessionId(): string | null {
  return lastSessionIdCache;
}

// ---------------------------------------------------------------------------
// Async writes — update cache synchronously, then persist to IDB
// ---------------------------------------------------------------------------

export async function saveSession(session: ChatSession): Promise<void> {
  const all = (sessionsCache ?? []).filter((s) => s.id !== session.id);
  sessionsCache = [session, ...all];
  try {
    await setItem(STORAGE_KEY, JSON.stringify(sessionsCache));
  } catch (err: any) {
    // Surface quota / IO errors so the auto-save path can show a warning.
    throw err;
  }
}

export async function deleteSession(id: string): Promise<void> {
  sessionsCache = (sessionsCache ?? []).filter((s) => s.id !== id);
  try {
    await setItem(STORAGE_KEY, JSON.stringify(sessionsCache));
  } catch (err) {
    console.error("Failed to persist session deletion", err);
  }
}

export async function saveLastSessionId(id: string | null): Promise<void> {
  lastSessionIdCache = id;
  try {
    if (id) await setItem(LAST_SESSION_KEY, id);
    else await removeItem(LAST_SESSION_KEY);
  } catch {
    // Non-fatal — losing the resume hint just falls back to new-chat on reload.
  }
}
