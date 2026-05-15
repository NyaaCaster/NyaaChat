import { CharacterSettings, WorldInfoRule } from "../types";

// Parse SillyTavern PNG card: reads tEXt chunks to find 'chara' key (base64 JSON)
export async function parseSillyTavernPng(file: File): Promise<CharacterSettings> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // PNG signature is 8 bytes, then chunks follow
  let offset = 8;
  while (offset < bytes.length) {
    const length = (bytes[offset] << 24 | bytes[offset+1] << 16 | bytes[offset+2] << 8 | bytes[offset+3]) >>> 0;
    const type = String.fromCharCode(bytes[offset+4], bytes[offset+5], bytes[offset+6], bytes[offset+7]);
    if (type === "tEXt") {
      const data = bytes.slice(offset + 8, offset + 8 + length);
      // tEXt: keyword\0text
      const nullIdx = data.indexOf(0);
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
      id: String(e.id ?? Date.now() + Math.random()),
      name: e.comment || `Rule ${e.id}`,
      triggerType: e.constant ? "permanent" : "keywords",
      keywords: e.constant ? undefined : (e.keys ?? []).join(","),
      position: e.position === "after_char" ? "assistant" : "system",
      content: e.content ?? "",
      enabled: e.enabled ?? true,
    }));

  return {
    id: Date.now().toString(),
    name: data.name,
    description: data.description,
    firstMes: data.first_mes || undefined,
    worldInfo,
  };
}

export { isSillyTavernFormat };