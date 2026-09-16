import { ChatSession } from "../types";
import { getItem, setItem, removeItem } from "./idbStorage";

export const STORAGE_KEY = "nyaachat_sessions";
const LAST_SESSION_KEY = "nyaachat_last_session_id";

// ---------------------------------------------------------------------------
// Retired-field hygiene
//
// A ChatSession used to carry a session-level `metadata` field owned by the
// removed SillyTavern extension compatibility layer. Nothing writes it any
// more, but a session list can still *arrive* carrying it — an old
// `nyaachat_sessions` blob in IndexedDB, or a cloud chat backup uploaded by a
// pre-removal client (decryptChatPayload returns the server JSON verbatim).
// Every write therefore strips it, so the local store can never re-persist
// dead data.
//
// 🔺 2026-09-16（插件系统 V1 第二阶段 · D3①）：**message 级守门已撤销**。
//     `Message.variables` 不再是"死数据"——它是 JS-Slash-Runner 插件的 MVU
//     变量存储（见 `src/lib/variables/`、SSOT §2.5 / §3）。原先这里的
//     `RETIRED_MESSAGE_KEYS = ["variables"]` 会在每次写会话时把楼层变量剥掉，
//     表现为"写入后刷新即消失"，故按拍板结论只撤销 **message 级**那一半：
//     session 级 `metadata` **仍然被剥离**（`RETIRED_TOP_LEVEL_KEYS` 一侧同理，
//     `src/lib/settingsBackup.ts` 一行未改）。
//
// The clean case — by far the common one — is allocation-free: a session is
// returned untouched unless the retired key is actually present, so the
// per-message autosave path pays only a property lookup per session.
// ---------------------------------------------------------------------------

const RETIRED_SESSION_KEYS = ["metadata"] as const;

function hasRetiredKeys(value: unknown, keys: readonly string[]): boolean {
  if (!value || typeof value !== "object") return false;
  return keys.some((k) => k in (value as Record<string, unknown>));
}

function stripRetiredSessionFields(session: ChatSession): ChatSession {
  if (!hasRetiredKeys(session, RETIRED_SESSION_KEYS)) return session;

  const cleanSession = { ...(session as unknown as Record<string, unknown>) };
  for (const key of RETIRED_SESSION_KEYS) delete cleanSession[key];
  return cleanSession as unknown as ChatSession;
}

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
    const parsed = raw ? JSON.parse(raw) : [];
    sessionsCache = Array.isArray(parsed) ? parsed.map(stripRetiredSessionFields) : parsed;
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
  sessionsCache = [stripRetiredSessionFields(session), ...all];
  // Quota / IO errors propagate to the auto-save path, which surfaces a warning.
  await setItem(STORAGE_KEY, JSON.stringify(sessionsCache));
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

/** Replace ALL local sessions at once (used by cloud chat-session download).
 *  A backup uploaded by a pre-removal client may still carry the retired
 *  session-level `metadata` field; it is stripped here so the local store never
 *  accepts it back. (Message-level `variables` is **kept** since 2026-09-16 —
 *  it is live MVU state now, see the header note.) */
export async function replaceAllSessions(sessions: ChatSession[]): Promise<void> {
  sessionsCache = sessions.map(stripRetiredSessionFields);
  try {
    await setItem(STORAGE_KEY, JSON.stringify(sessionsCache));
  } catch (err) {
    console.error("Failed to persist bulk session replacement", err);
    throw err;
  }
}
