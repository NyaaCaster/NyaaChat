// Local persistence for SillyTavern-compatible extension_settings.
//
// ST extensions treat extension_settings as a shared mutable object: they keep a
// reference, mutate nested fields, then call saveSettingsDebounced(). Therefore
// the exported object identity must never change. We hydrate it in-place from
// localStorage and serialize the same object back on save.

export type ExtensionSettingsRecord = Record<string, unknown>;

const STORAGE_KEY = "nyaachat_extension_settings";
const IDB_DB_NAME = "nyaachat_extension_settings";
const IDB_STORE_NAME = "objects";
const IDB_MAIN_KEY = "extension_settings";

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

function loadFromLocalStorage(): ExtensionSettingsRecord {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return isPlainRecord(parsed) ? parsed : {};
  } catch (err) {
    console.error("[compat] failed to load extension_settings", err);
    return {};
  }
}

function saveToLocalStorage(value: ExtensionSettingsRecord): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch (err) {
    console.error("[compat] failed to persist extension_settings", err);
  }
}

/** Hydrate the stable extension_settings object from the browser-local backing
 *  store. Called at module evaluation so imported shim modules see restored data
 *  before extensions run. */
export function loadExtensionSettingsFromStorage(): void {
  replaceContents(extension_settings, loadFromLocalStorage());
}

/** Persist the current stable object. Extensions usually reach this through
 *  getContext().saveSettingsDebounced(). */
export function saveExtensionSettingsNow(): void {
  saveToLocalStorage(extension_settings);
}

// IndexedDB reserve path for large script libraries. P1 keeps localStorage as the
// synchronous source of truth because ST's saveSettingsDebounced() is sync-facing;
// these helpers give later phases a narrow place to move oversized objects
// without changing the extension_settings API surface.
function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveExtensionSettingsToIndexedDb(
  value: ExtensionSettingsRecord = extension_settings,
): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openIndexedDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).put(deepClone(value), IDB_MAIN_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadExtensionSettingsFromIndexedDb(): Promise<ExtensionSettingsRecord> {
  if (typeof indexedDB === "undefined") return {};
  const db = await openIndexedDb();
  try {
    return await new Promise<ExtensionSettingsRecord>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_STORE_NAME).get(IDB_MAIN_KEY);
      req.onsuccess = () => resolve(isPlainRecord(req.result) ? req.result : {});
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

loadExtensionSettingsFromStorage();
