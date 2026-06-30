// Shared cover-image utilities used by both the shared-character publish flow
// (characters.js) and the per-user cloud-settings cover sync (account.js).
//
// Kept in a standalone module so the two routers don't have to import from each
// other.

/** Maximum file size for a single cover image (generous ceiling for 512×768 WebP). */
export const COVER_MAX_BYTES = 4 * 1024 * 1024; // 4 MB

/** Verify a buffer begins with a RIFF....WEBP container header. */
export function isWebp(buf) {
  return (
    buf.length > 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // "RIFF"
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50    // "WEBP"
  );
}
