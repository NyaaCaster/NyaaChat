// Per-category storage estimation for the two UI storage bars:
//   ChatHistoryModal  → "聊天记录储存"  (64 MB ceiling)
//   CharacterSelectionModal → "角色卡储存"  (64 MB ceiling)
//
// Both categories live in IndexedDB (the main kv store + the character-covers
// database).  The Storage API (navigator.storage.estimate()) reports the whole
// origin, so we measure each category manually by reading its keys / blobs and
// summing their sizes.

import { CharacterSettings } from "../types";
import { getItem } from "./idbStorage";
import { loadCover, COVER_MARKER } from "./coverStorage";

// ---------------------------------------------------------------------------
// Per-category quota ceilings — DEFAULT values (32 MB each, initial free tier).
// When the user is logged in, the account profile's charStorageMax / chatStorageMax
// take precedence (expandable via catfood). These defaults apply when logged out.
// ---------------------------------------------------------------------------

export const DEFAULT_CHAT_STORAGE_QUOTA = 32 * 1024 * 1024; // 32 MB
export const DEFAULT_CHARACTER_STORAGE_QUOTA = 32 * 1024 * 1024; // 32 MB

// Total guardrail kept as a fallback for paths that still reference it.
export const APP_STORAGE_QUOTA = 64 * 1024 * 1024; // 64 MB (32+32)

// Key constants — must match sessionStorage.ts
const SESSIONS_KEY = "nyaachat_sessions";
const LAST_SESSION_KEY = "nyaachat_last_session_id";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Approximate on-disk bytes for a UTF-16 string (what IndexedDB stores). */
function jsonBytes(value: unknown): number {
  return new Blob([JSON.stringify(value)]).size;
}

/** Raw string byte size (the string is already serialized). */
function rawStringBytes(s: string): number {
  return new Blob([s]).size;
}

// ---------------------------------------------------------------------------
// Public estimators
// ---------------------------------------------------------------------------

/** Estimate the total IndexedDB footprint of chat sessions. */
export async function estimateChatStorage(): Promise<number> {
  let total = 0;

  try {
    const sessionsRaw = await getItem(SESSIONS_KEY);
    if (sessionsRaw) total += rawStringBytes(sessionsRaw);
  } catch { /* key missing — add 0 */ }

  try {
    const lastId = await getItem(LAST_SESSION_KEY);
    if (lastId) total += rawStringBytes(lastId);
  } catch { /* ignore */ }

  // 旧的「每会话 chat_metadata」键随 ST 扩展兼容系统一并删除，产品不再产生该
  // 数据，因此这里也不再统计它。
  return total;
}

/** Estimate the IndexedDB footprint of character settings + covers. */
export async function estimateCharacterStorage(
  characters: CharacterSettings[],
): Promise<number> {
  // 1. The characters array as it lives inside the settings JSON.
  let total = jsonBytes(characters);

  // 2. Each character's cover WebP blob (stored in a separate IDB database).
  for (const c of characters) {
    if (c.coverImage === COVER_MARKER) {
      try {
        const blob = await loadCover(c.id);
        if (blob) total += blob.size;
      } catch { /* blob read failed — skip */ }
    }
  }

  return total;
}
