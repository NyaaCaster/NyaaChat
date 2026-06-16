import { useEffect, useState } from "react";
import { loadCover } from "../lib/coverStorage";

/**
 * Resolve a character's cover blob (IndexedDB) into a data URL for <img>.
 *
 * - Returns null while loading or when the character has no cover.
 * - Re-reads when `characterId` changes, or when `version` is bumped by the
 *   caller (used to force a refresh after a cover is replaced under the same id,
 *   since the id itself doesn't change).
 *
 * Why a data URL (FileReader) and not URL.createObjectURL: object URLs must be
 * manually revoked and die the moment they are — any over-eager cleanup, async
 * race, or remount leaves the <img> pointing at a freed blob (the src string
 * stays in the DOM but the image renders blank / flashes once). A data URL is a
 * self-contained string: it never expires, needs no revoke, and survives any
 * re-render. Covers are small 512×768 WebP (tens of KB), so the base64 cost is
 * negligible.
 *
 * Pass `enabled: false` (e.g. the marker field is empty) to skip the lookup
 * entirely so we don't hit IndexedDB for cover-less characters.
 */
export function useCoverObjectUrl(
  characterId: string | undefined,
  enabled: boolean,
  version = 0,
): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!characterId || !enabled) {
      setUrl(null);
      return;
    }

    loadCover(characterId)
      .then(
        (blob) =>
          new Promise<void>((resolve) => {
            if (cancelled) return resolve();
            if (!blob) {
              setUrl(null);
              return resolve();
            }
            const reader = new FileReader();
            reader.onload = () => {
              if (!cancelled) setUrl(typeof reader.result === "string" ? reader.result : null);
              resolve();
            };
            reader.onerror = () => {
              if (!cancelled) setUrl(null);
              resolve();
            };
            reader.readAsDataURL(blob);
          }),
      )
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => {
      cancelled = true;
    };
  }, [characterId, enabled, version]);

  return url;
}
