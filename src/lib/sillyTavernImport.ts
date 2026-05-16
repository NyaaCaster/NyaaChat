import { CharacterSettings, WorldInfoRule } from "../types";
import { newId } from "./id";

// Hard cap on imported card size. SillyTavern PNG cards in the wild rarely
// exceed a few hundred KB; anything larger is almost certainly an attack on
// memory (the whole file is held as ArrayBuffer + base64 + JSON in parallel).
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Parse SillyTavern PNG card: reads tEXt chunks to find 'chara' key (base64 JSON)
export async function parseSillyTavernPng(file: File): Promise<CharacterSettings> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`PNG 文件过大（${(file.size / 1024 / 1024).toFixed(2)} MB），上限 5 MB`);
  }
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Verify PNG signature before walking chunks.
  if (bytes.length < 8 || !PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    throw new Error("不是有效的 PNG 文件");
  }

  // PNG signature is 8 bytes, then chunks follow
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = (bytes[offset] << 24 | bytes[offset+1] << 16 | bytes[offset+2] << 8 | bytes[offset+3]) >>> 0;
    // Reject chunks that claim to extend beyond the file or wrap around. The
    // +12 covers length field (4) + type (4) + crc (4).
    if (length > bytes.length || offset + 8 + length + 4 > bytes.length) {
      throw new Error("PNG 文件已损坏或被篡改");
    }
    const type = String.fromCharCode(bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]);
    if (type === "tEXt") {
      const data = bytes.slice(offset + 8, offset + 8 + length);
      // tEXt: keyword\0text
      const nullIdx = data.indexOf(0);
      if (nullIdx < 0) {
        offset += 8 + length + 4;
        continue;
      }
      const keyword = new TextDecoder().decode(data.slice(0, nullIdx));
      if (keyword === "chara") {
        const b64Bytes = data.slice(nullIdx + 1);
        const b64 = new TextDecoder('ascii').decode(b64Bytes);
        // atob gives Latin-1 bytes; re-encode to Uint8Array then decode as UTF-8
        const raw = atob(b64);
        const utf8Bytes = Uint8Array.from(raw, c => c.charCodeAt(0));
        const jsonStr = new TextDecoder('utf-8').decode(utf8Bytes);
        const json = JSON.parse(jsonStr);
        return convertSillyTavernCharacter(json);
      }
    }
    offset += 8 + length + 4; // length + type + data + crc
  }
  throw new Error("PNG 文件中未找到角色数据（chara chunk）");
}

function isSillyTavernFormat(parsed: any): boolean {
  return (
    parsed?.spec === "chara_card_v3" ||
    (parsed?.data?.name !== undefined && parsed?.data?.description !== undefined)
  );
}

// Detect UI-rendering entries (status bars, formatted output templates)
// that rely on SillyTavern's frontend rendering and are useless in NyaaChat
function isUiRenderingEntry(entry: any): boolean {
  const content: string = entry.content ?? "";
  const comment: string = entry.comment ?? "";

  // Check tavern_helper script references by comment name
  const scripts: any[] = entry._scripts ?? [];
  if (scripts.length > 0) return true;

  // Detect status-bar / formatted-output patterns
  const uiPatterns = [
    /请严格按照以下格式输出/,
    /\[异界状态/,
    /\[环境信息\]/,
    /\[状态栏\]/,
    /<(div|span|table|style)[^>]*>/i,
    /每次回复.*结束后.*格式/,
  ];
  return uiPatterns.some(p => p.test(content) || p.test(comment));
}

// Collect comment names referenced by tavern_helper scripts
function getScriptReferencedComments(data: any): Set<string> {
  const referenced = new Set<string>();
  const scripts: any[] = data.extensions?.tavern_helper?.scripts ?? [];
  for (const script of scripts) {
    // Scripts typically reference world info by name in their source
    const src: string = script.script ?? script.source ?? JSON.stringify(script);
    const entries: any[] = data.character_book?.entries ?? [];
    for (const entry of entries) {
      if (entry.comment && src.includes(entry.comment)) {
        referenced.add(entry.comment);
      }
    }
  }
  return referenced;
}

export function convertSillyTavernCharacter(parsed: any): CharacterSettings {
  const data = parsed.data ?? parsed;

  const scriptReferenced = getScriptReferencedComments(data);
  const entries: any[] = data.character_book?.entries ?? [];
  const worldInfo: WorldInfoRule[] = entries
    .filter((e: any) => e.enabled !== false)
    .filter((e: any) => !scriptReferenced.has(e.comment))
    .filter((e: any) => !isUiRenderingEntry(e))
    .map((e: any) => ({
      id: e.id != null ? String(e.id) : newId(),
      name: e.comment || `Rule ${e.id}`,
      triggerType: e.constant ? "permanent" : "keywords",
      keywords: e.constant ? undefined : (e.keys ?? []).join(","),
      position: e.position === "after_char" ? "assistant" : "system",
      content: e.content ?? "",
      enabled: e.enabled ?? true,
    }));

  return {
    id: newId(),
    name: data.name,
    description: data.description,
    firstMes: data.first_mes || undefined,
    worldInfo,
  };
}

export { isSillyTavernFormat };