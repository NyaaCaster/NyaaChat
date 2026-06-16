// IndexedDB persistence for character cover images (512×768 WebP blobs).
//
// Cover pixels are deliberately kept OUT of the localStorage settings blob:
// the whole AppState is serialized as one JSON string on every save
// (App.tsx → nyaachat_settings) and is already brushing up against the ~5 MB
// localStorage quota (see the QuotaExceededError handling there and in
// sessionStorage.ts). A single 512×768 cover is far too large to live there.
//
// Instead each cover is stored as a binary Blob in IndexedDB keyed by the
// character `id`. The settings blob only carries a lightweight `coverImage`
// marker (see CharacterSettings). This mirrors the IndexedDB approach already
// used for extension settings (compat/extensionSettings.ts).

const IDB_DB_NAME = "nyaachat_character_covers";
const IDB_STORE_NAME = "covers";
const IDB_VERSION = 1;

/** Marker written into CharacterSettings.coverImage. Truthy = "a cover blob
 *  exists in IndexedDB under this character id". Kept as an opaque string so a
 *  future shared-library phase can repurpose it to hold a remote URL. */
export const COVER_MARKER = "idb";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, IDB_VERSION);
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

/** Store (or replace) a character's cover blob. Resolves once committed. */
export async function saveCover(characterId: string, blob: Blob): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).put(blob, characterId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Read a character's cover blob, or null when none is stored. */
export async function loadCover(characterId: string): Promise<Blob | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  try {
    return await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_STORE_NAME).get(characterId);
      req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Remove a character's cover blob. Safe to call when none exists. */
export async function deleteCover(characterId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).delete(characterId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
