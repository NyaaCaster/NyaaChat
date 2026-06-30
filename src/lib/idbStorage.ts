// Shared IndexedDB key-value store — replaces localStorage for all persisted
// app data.  Mirrors localStorage's flat key→string model but backs it with
// IndexedDB, which has a per-origin quota typically 60 % of disk space instead
// of localStorage's 5–10 MB ceiling.
//
// Consumers should load data into an in-memory cache via the hydrate pattern
// (already used by extensionSettings, regex, variables, metadataBridge) and
// read from that cache synchronously.  Writes update the cache first, then
// persist to IDB asynchronously (fire-and-forget unless the caller needs to
// surface errors).

const DB_NAME = "nyaachat_storage";
const STORE_NAME = "kv";
const DB_VERSION = 1;

/** Key stored inside IDB itself to mark a completed localStorage→IDB migration. */
const MIGRATION_SENTINEL = "__idb_migrated__";

// ---------------------------------------------------------------------------
// Planning ceiling for import guards / storage-bar fallback.  The real limit
// is the Storage API quota (much larger); this is a conservative guardrail.
// ---------------------------------------------------------------------------
export const APP_STORAGE_QUOTA = 200 * 1024 * 1024; // 200 MB (100+100 per-category ceilings)

// ---------------------------------------------------------------------------
// DB helper — follows the exact Promise-wrapping idiom from coverStorage.ts
// ---------------------------------------------------------------------------

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB unavailable"));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function getItem(key: string): Promise<string | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  try {
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(typeof req.result === "string" ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function removeItem(key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Return every key in the kv store (useful for debugging; not in the hot path). */
export async function getAllKeys(): Promise<string[]> {
  if (typeof indexedDB === "undefined") return [];
  const db = await openDb();
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAllKeys();
      req.onsuccess = () => resolve((req.result as IDBValidKey[]).map((k) => String(k)));
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Migration helpers
// ---------------------------------------------------------------------------

/** Check whether the one-shot localStorage→IDB migration has already run. */
export async function isMigrationDone(): Promise<boolean> {
  try {
    return !!(await getItem(MIGRATION_SENTINEL));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// One-shot migration: copy every localStorage key → IDB, then clear
// localStorage.  Idempotent — the sentinel inside IDB prevents re-runs.
// ---------------------------------------------------------------------------

export async function migrateFromLocalStorage(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  if (typeof localStorage === "undefined") return;

  // Already migrated?
  if (await isMigrationDone()) return;

  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) keys.push(k);
    }
  } catch {
    return; // localStorage unavailable — nothing to migrate
  }

  let failed = false;

  for (const key of keys) {
    try {
      const value = localStorage.getItem(key);
      if (value != null) {
        await setItem(key, value);
      }
    } catch (err) {
      console.error("[idbStorage] migrate: failed to copy key", key, err);
      failed = true;
    }
  }

  if (!failed) {
    // Only purge localStorage when ALL keys copied successfully.
    for (const key of keys) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Non-fatal — the key is already in IDB; stale localStorage copy is harmless.
      }
    }
    try {
      await setItem(MIGRATION_SENTINEL, "1");
    } catch {
      // Sentinel write failed, but data is in IDB.  Next load will re-attempt
      // migration, which is a no-op since localStorage is already cleared.
    }
  }
}
