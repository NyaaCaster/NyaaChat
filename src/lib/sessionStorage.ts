import { ChatSession } from "../types";

const STORAGE_KEY = "nyaachat_sessions";

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
