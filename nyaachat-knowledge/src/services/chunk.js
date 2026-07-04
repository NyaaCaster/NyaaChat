/**
 * Split text into character windows of `size` with `overlap` shared characters
 * between adjacent chunks. Empty/whitespace-only windows are dropped.
 */
export function splitIntoChunks(text, size, overlap) {
  const clean = text.trim();
  if (!clean) return [];
  const safeSize = Math.max(1, size);
  const safeOverlap = Math.min(Math.max(0, overlap), safeSize - 1);
  const step = safeSize - safeOverlap;

  const chunks = [];
  for (let start = 0; start < clean.length; start += step) {
    const piece = clean.slice(start, start + safeSize).trim();
    if (piece) chunks.push(piece);
    if (start + safeSize >= clean.length) break;
  }
  return chunks;
}
