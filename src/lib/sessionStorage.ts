import { ChatSession } from "../types";

const STORAGE_KEY = "nyaachat_sessions";
const LAST_SESSION_KEY = "nyaachat_last_session_id";

/**
 * Approximate per-origin localStorage capacity floor. Browsers typically
 * allocate 5–10 MB; we use 10 MB as the safe planning ceiling. When current
 * usage approaches this number the UI warns and cloud-sync logic treats it as
 * the "full" threshold.
 */
export const LOCAL_STORAGE_QUOTA = 10 * 1024 * 1024; // 10 MB

/** Estimate current localStorage usage in bytes (UTF-16 = 2 bytes per char). */
export function getLocalStorageUsage(): number {
  try {
    let bytes = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) bytes += (k.length + (localStorage.getItem(k)?.length ?? 0)) * 2;
    }
    return bytes;
  } catch {
    return 0;
  }
}

export function loadSessions(): ChatSession[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

export function saveSession(session: ChatSession) {
  const sessions = loadSessions().filter((s) => s.id !== session.id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([session, ...sessions]));
  } catch (err: any) {
    if (err?.name === "QuotaExceededError" || /quota/i.test(err?.message || "")) {
      throw new Error("浏览器存储空间已满，无法保存会话。请在「聊天记录」中删除部分历史。");
    }
    throw err;
  }
}

export function deleteSession(id: string) {
  const sessions = loadSessions().filter((s) => s.id !== id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.error("Failed to delete session", err);
  }
}

// Tracks which session was active when the page was last left, so a hard
// refresh can resume in the same conversation instead of always starting a
// new one. Null (or a missing id) means "blank/new chat" — explicitly
// preserved so that refreshing while on the new-chat scratchpad keeps you
// there rather than jumping into the most recent saved session.
export function loadLastSessionId(): string | null {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    return raw && raw.length > 0 ? raw : null;
  } catch {
    return null;
  }
}

export function saveLastSessionId(id: string | null) {
  try {
    if (id) localStorage.setItem(LAST_SESSION_KEY, id);
    else localStorage.removeItem(LAST_SESSION_KEY);
  } catch {
    // Quota errors are not actionable here — losing the resume hint is fine,
    // it just falls back to the new-chat blank state on next load.
  }
}
