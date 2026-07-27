import { loadSessions } from "./sessionStorage";
import { heartbeatMemory } from "./knowledgeApi";
import { loadStoredAccount } from "./sharedAccountApi";
import { getItem, setItem } from "./idbStorage";

const HEARTBEAT_AT_KEY = "nyaachat_memory_heartbeat_at";
const HEARTBEAT_MIN_GAP_MS = 60 * 60 * 1000; // 1 hour
const MAX_HEARTBEAT_SESSIONS = 500;

/**
 * Touch every local session in one go so the server knows they're still alive.
 * Only fires at most once per hour to prevent request storms from multi-tab or
 * rapid page refreshes. Never sends an empty session list.
 */
export async function maybeHeartbeat(): Promise<void> {
  const stored = await loadStoredAccount();
  if (!stored) return;
  const lastAt = Number((await getItem(HEARTBEAT_AT_KEY)) ?? 0);
  if (Date.now() - lastAt < HEARTBEAT_MIN_GAP_MS) return;
  const sessions = loadSessions();
  const ids = sessions
    .slice(0, MAX_HEARTBEAT_SESSIONS)
    .map((s) => s.id)
    .filter(Boolean) as string[];
  if (ids.length === 0) return; // invariant: never send empty
  await setItem(HEARTBEAT_AT_KEY, String(Date.now()));
  try {
    const r = await heartbeatMemory(stored.token, ids);
    if (r.kind === "ok" && r.data.swept > 0) {
      console.info("[memory] TTL swept", r.data.swept, "documents");
    }
  } catch {
    // Fire-and-forget — heartbeat is best-effort, TTL is the backstop.
  }
}
