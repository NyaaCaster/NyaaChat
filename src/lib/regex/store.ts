// 正则脚本的存储与作用域解析。
//
// 正则脚本有两个来源，按固定优先级串成一条链：
//   - GLOBAL：用户在 IndexedDB 里维护的全局脚本，对所有会话生效。
//   - SCOPED：角色卡自带脚本（CharacterSettings.regexScripts），仅在该角色
//     激活时生效。
//
// 合并顺序是 GLOBAL 在前、SCOPED 在后（全局先跑，角色脚本在其结果上精修）。
// getRegexedString 消费这条合并后的数组并按顺序链式执行。
//
// ⚠️ 存储键 `nyaachat_regex_global` 是对外冻结的：改它等于让所有用户已保存的
// 全局正则脚本凭空消失。

import type { CharacterSettings, RegexScript } from "../../types";
import { getItem, setItem } from "../idbStorage";

const STORAGE_KEY = "nyaachat_regex_global";

// In-memory cache of the parsed global scripts. The display pipeline reads this
// on every message render during streaming, so we avoid an IDB get+JSON.parse
// per render. Populated at bootstrap by hydrateRegexScripts().
let globalCache: RegexScript[] | null = null;

// Subscribers notified whenever the global scripts change (the management UI
// saving). Lets the display pipeline re-derive its effective script chain and
// re-run regex on the visible chat immediately, instead of only on the next
// character switch / reload.
const subscribers = new Set<() => void>();

/** Subscribe to global regex script changes. Returns an unsubscribe fn. */
export function subscribeRegexScripts(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function notifyRegexChange(): void {
  for (const cb of [...subscribers]) {
    try {
      cb();
    } catch (err) {
      console.error("[regex] subscriber threw", err);
    }
  }
}

/** Pre-fill the in-memory cache from IndexedDB.  Called once at bootstrap
 *  before React mounts so the hot display path never awaits. */
export async function hydrateRegexScripts(): Promise<void> {
  try {
    const raw = await getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    globalCache = Array.isArray(parsed) ? parsed : [];
  } catch {
    globalCache = [];
  }
}

/** Load the user's global regex scripts from the in-memory cache.  Returns []
 *  on missing/corrupt data so a bad entry never breaks message rendering. */
export function loadGlobalRegexScripts(): RegexScript[] {
  return globalCache ?? [];
}

/** Persist the user's global regex scripts to IndexedDB.  Errors are logged but
 *  not surfaced — losing a save is recoverable, crashing the UI is not.
 *  Notifies subscribers so the display pipeline refreshes live. */
export function saveGlobalRegexScripts(scripts: RegexScript[]): void {
  globalCache = scripts;
  try {
    void setItem(STORAGE_KEY, JSON.stringify(scripts));
  } catch (err) {
    console.error("[regex] failed to persist global regex scripts", err);
  }
  notifyRegexChange();
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
