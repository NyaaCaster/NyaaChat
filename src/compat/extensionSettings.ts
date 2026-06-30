// Persistence for SillyTavern-compatible extension_settings — backed by
// IndexedDB (via the shared idbStorage kv store).
//
// ST extensions treat extension_settings as a shared mutable object: they keep a
// reference, mutate nested fields, then call saveSettingsDebounced(). Therefore
// the exported object identity must never change. We hydrate it in-place from
// IndexedDB (once at bootstrap) and serialise the same object back on save.

import { getItem, setItem } from "../lib/idbStorage";

export type ExtensionSettingsRecord = Record<string, unknown>;

const STORAGE_KEY = "nyaachat_extension_settings";

export const extension_settings: ExtensionSettingsRecord = {};

function isPlainRecord(value: unknown): value is ExtensionSettingsRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function deepClone<T>(value: T): T {
  try {
    return structuredClone(value);
  } catch {
    return JSON.parse(JSON.stringify(value ?? null));
  }
}

function replaceContents(target: ExtensionSettingsRecord, source: ExtensionSettingsRecord): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, deepClone(source));
}

// ---------------------------------------------------------------------------
// Hydration (called once at bootstrap before extensions run)
// ---------------------------------------------------------------------------

/** Load extension_settings from IndexedDB and populate the stable
 *  `extension_settings` object in-place.  Must be awaited before
 *  `installCompatLayer()` so extensions see restored data. */
export async function hydrateExtensionSettings(): Promise<void> {
  try {
    const raw = await getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (isPlainRecord(parsed)) {
      replaceContents(extension_settings, parsed);
    }
  } catch (err) {
    console.error("[compat] failed to load extension_settings", err);
  }
}

// ---------------------------------------------------------------------------
// Synchronous read (kept for backward compat — returns the live object)
// ---------------------------------------------------------------------------

/** Synchronous hydration from the old localStorage path.  No longer called at
 *  module evaluation; retained so existing importers that call it manually
 *  still compile and behave safely (it accesses the live object which is
 *  already hydrated via `hydrateExtensionSettings()` at bootstrap). */
export function loadExtensionSettingsFromStorage(): void {
  // The live object is already hydrated; this is a no-op compatibility stub.
}

// ---------------------------------------------------------------------------
// Persist
// ---------------------------------------------------------------------------

/** Persist the current `extension_settings` to IndexedDB.  Fire-and-forget —
 *  errors are logged but not surfaced (matching the prior localStorage
 *  behaviour).  Extensions reach this through
 *  getContext().saveSettingsDebounced(). */
export function saveExtensionSettingsNow(): void {
  try {
    void setItem(STORAGE_KEY, JSON.stringify(extension_settings));
  } catch (err) {
    console.error("[compat] failed to persist extension_settings", err);
  }
}

// ---------------------------------------------------------------------------
// Legacy IndexedDB reserve helpers — kept for backward compatibility.
// They now delegate to the shared idbStorage store instead of a separate DB.
// ---------------------------------------------------------------------------

/** @deprecated Use `saveExtensionSettingsNow()` — the shared idbStorage kv
 *  store is now the single source of truth. */
export async function saveExtensionSettingsToIndexedDb(
  _value?: ExtensionSettingsRecord,
): Promise<void> {
  saveExtensionSettingsNow();
}

/** @deprecated Use `hydrateExtensionSettings()` — the shared idbStorage kv
 *  store is now the single source of truth. */
export async function loadExtensionSettingsFromIndexedDb(): Promise<ExtensionSettingsRecord> {
  return extension_settings;
}
