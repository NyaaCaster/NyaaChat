// PNG character-card encoding/decoding helpers.
//
// Character cards are exported as PNG images that carry the character JSON in a
// tEXt chunk under the `chara` keyword (base64-encoded UTF-8), the same
// convention SillyTavern uses — so a NyaaChat-format card and an ST-format card
// share one container and the ST ecosystem can read our ST exports directly.
// The visible pixels are the character's cover image (512×768), or a generated
// placeholder when the character has none.
//
// Re-encoding the carrier through a canvas guarantees the output PNG contains
// ONLY our freshly-written tEXt chunk and clean pixels — no metadata from the
// source image survives, satisfying the "pure image, no stray data" rule.

const COVER_W = 512;
const COVER_H = 768;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// --- CRC32 (PNG polynomial) ----------------------------------------------
const CRC_TABLE: number[] = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// --- base64 of UTF-8 JSON (chunked to avoid call-stack overflow) ----------
function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function buildTextChunk(keyword: string, text: string): Uint8Array {
  const enc = new TextEncoder();
  const kw = enc.encode(keyword);
  // tEXt text is Latin-1; our base64 payload is pure ASCII so this is safe.
  const txt = Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
  const dataLen = kw.length + 1 + txt.length;
  const chunk = new Uint8Array(12 + dataLen);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, dataLen);
  chunk.set(enc.encode("tEXt"), 4);
  chunk.set(kw, 8);
  chunk[8 + kw.length] = 0; // null separator
  chunk.set(txt, 8 + kw.length + 1);
  const crc = crc32(chunk.subarray(4, 8 + dataLen));
  dv.setUint32(8 + dataLen, crc);
  return chunk;
}

/** Insert a tEXt chunk into PNG bytes immediately before IEND. */
function insertTextChunk(png: Uint8Array, chunk: Uint8Array): Uint8Array {
  // Walk chunks to find IEND's start offset.
  let offset = 8;
  let iendStart = png.length - 12; // fallback
  while (offset + 8 <= png.length) {
    const len = new DataView(png.buffer, png.byteOffset + offset, 4).getUint32(0);
    const type = String.fromCharCode(png[offset + 4], png[offset + 5], png[offset + 6], png[offset + 7]);
    if (type === "IEND") {
      iendStart = offset;
      break;
    }
    offset += 12 + len;
  }
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, iendStart), 0);
  out.set(chunk, iendStart);
  out.set(png.subarray(iendStart), iendStart + chunk.length);
  return out;
}

/** Load a Blob into an HTMLImageElement via object URL. */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片解码失败"));
    };
    img.src = url;
  });
}

/** Draw a built-in placeholder cover onto the context (used when a character
 *  has no cover but we still need PNG pixels to carry the data). */
function drawPlaceholder(ctx: CanvasRenderingContext2D, name: string) {
  const grad = ctx.createLinearGradient(0, 0, COVER_W, COVER_H);
  grad.addColorStop(0, "#1e3a8a");
  grad.addColorStop(1, "#0f172a");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, COVER_W, COVER_H);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "120px sans-serif";
  ctx.fillText("🐱", COVER_W / 2, COVER_H / 2 - 60);
  ctx.font = "bold 40px sans-serif";
  const label = (name || "NyaaChat").slice(0, 12);
  ctx.fillText(label, COVER_W / 2, COVER_H / 2 + 60);
}

/**
 * Encode a character (JSON object) into a PNG card. The cover blob — if any —
 * becomes the visible 512×768 pixels (cover-fit); otherwise a placeholder is
 * drawn. The JSON is embedded in a tEXt `chara` chunk.
 */
export async function exportCharacterPng(jsonObj: unknown, coverBlob: Blob | null): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_W;
  canvas.height = COVER_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");

  if (coverBlob) {
    const img = await loadImage(coverBlob);
    ctx.drawImage(img, 0, 0, COVER_W, COVER_H);
  } else {
    const name = (jsonObj as { name?: string })?.name ?? "";
    drawPlaceholder(ctx, name);
  }

  const basePng: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG 编码失败"))), "image/png"),
  );
  const baseBytes = new Uint8Array(await basePng.arrayBuffer());
  const chunk = buildTextChunk("chara", utf8ToBase64(JSON.stringify(jsonObj)));
  const out = insertTextChunk(baseBytes, chunk);
  return new Blob([out], { type: "image/png" });
}

/**
 * Re-encode an arbitrary image blob (e.g. the visible pixels of an imported PNG
 * card) into a 512×768 WebP cover for IndexedDB storage. Cover-fit (center-crop)
 * so the stored cover always matches the editor/cropper aspect.
 */
export async function imageBlobToCoverWebp(blob: Blob): Promise<Blob> {
  const img = await loadImage(blob);
  const canvas = document.createElement("canvas");
  canvas.width = COVER_W;
  canvas.height = COVER_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  // Cover-fit: scale so the image fully covers 512×768, center-cropping excess.
  const scale = Math.max(COVER_W / img.naturalWidth, COVER_H / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (COVER_W - dw) / 2, (COVER_H - dh) / 2, dw, dh);
  return await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("WebP 编码失败"))), "image/webp", 0.9),
  );
}

export { PNG_SIGNATURE, COVER_W, COVER_H };

/**
 * Render the built-in placeholder cover to a standalone 512×768 WebP blob. Used
 * by the share flow when a character has no cover of its own — the shared
 * backend requires a cover, and a json-free re-encoded WebP is exactly what the
 * design's anti-theft rule wants (no embedded card data). Mirrors the pixels
 * `exportCharacterPng` would draw for a coverless card.
 */
export async function makePlaceholderCoverWebp(name: string): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_W;
  canvas.height = COVER_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建画布");
  drawPlaceholder(ctx, name ?? "");
  return await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("WebP 编码失败"))), "image/webp", 0.9),
  );
}
