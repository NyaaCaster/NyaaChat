// Regex script storage and scope resolution.
//
// ST sources regex scripts from three scopes (global / preset / character) and
// chains them in a fixed priority order. NyaaChat has no preset system, so we
// implement two scopes:
//   - GLOBAL: user-managed scripts in localStorage, applied to every chat.
//   - SCOPED: character-card scripts (CharacterSettings.regexScripts), applied
//     only when that character is active.
//
// The combined order is GLOBAL then SCOPED, matching ST's effective ordering
// for these two scopes (global runs first, character scripts refine after).
// getRegexedString consumes the combined array and chains them.

import type { CharacterSettings, RegexScript } from "../../types";

const STORAGE_KEY = "nyaachat_regex_global";

// In-memory cache of the parsed global scripts. The display pipeline reads this
// on every message render during streaming, so we avoid a getItem+JSON.parse
// per render. Invalidated on save and lazily repopulated on next read.
let globalCache: RegexScript[] | null = null;

/** Load the user's global regex scripts. Returns [] on missing/corrupt data so
 *  a bad localStorage entry never breaks message rendering. Cached in memory. */
export function loadGlobalRegexScripts(): RegexScript[] {
  if (globalCache) return globalCache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    globalCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    globalCache = [];
  }
  return globalCache;
}

/** Persist the user's global regex scripts. Quota errors are swallowed with a
 *  console warning — losing a save is recoverable, crashing the UI is not. */
export function saveGlobalRegexScripts(scripts: RegexScript[]): void {
  globalCache = scripts;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scripts));
  } catch (err) {
    console.error("[compat] failed to persist global regex scripts", err);
  }
}

/**
 * Assemble the effective regex script chain for the active character. Disabled
 * scripts are filtered out here so callers (the hot display/prompt paths) don't
 * re-check on every message. Order: global first, then character-scoped.
 */
export function getEffectiveRegexScripts(character: CharacterSettings | null | undefined): RegexScript[] {
  const global = loadGlobalRegexScripts();
  const scoped = character?.regexScripts ?? [];
  return [...global, ...scoped].filter((s) => s && !s.disabled);
}
