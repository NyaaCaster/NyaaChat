import { CharacterSettings, RegexScript, WorldInfoRule } from "../types";
import { newId } from "./id";

// Hard cap on imported card size. SillyTavern PNG cards in the wild rarely
// exceed a few hundred KB; anything larger is almost certainly an attack on
// memory (the whole file is held as ArrayBuffer + base64 + JSON in parallel).
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// Parse SillyTavern PNG card: reads tEXt chunks to find 'chara' key (base64 JSON)
/** Walk a PNG's chunks and return the parsed `chara` tEXt JSON (the raw card
 *  object — could be an ST card or a NyaaChat-native card). Throws when the file
 *  isn't a valid PNG or carries no chara chunk. Shared by both the ST and native
 *  import paths so format dispatch happens on the parsed object. */
export async function extractCharaJson(file: File): Promise<any> {
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
        return json;
      }
    }
    offset += 8 + length + 4; // length + type + data + crc
  }
  throw new Error("PNG 文件中未找到角色数据（chara chunk）");
}

/** Back-compat wrapper: extract + convert as a SillyTavern card. */
export async function parseSillyTavernPng(file: File): Promise<CharacterSettings> {
  return convertSillyTavernCharacter(await extractCharaJson(file));
}

/** Convert a NyaaChat-native card JSON (the object embedded in our own PNG
 *  export, `format: "nyaachat-character"`) into CharacterSettings. Reads our own
 *  top-level fields directly — regex under `regexScripts`, character variables /
 *  ST data under `extensions`, plus the shared-system metadata groundwork. */
export function convertNativeCard(parsed: any): CharacterSettings {
  if (!parsed.name || typeof parsed.name !== "string") throw new Error('Missing or invalid "name"');
  if (!parsed.description || typeof parsed.description !== "string") {
    throw new Error('Missing or invalid "description"');
  }
  const passthroughExt =
    parsed.extensions && typeof parsed.extensions === "object" && !Array.isArray(parsed.extensions)
      ? (parsed.extensions as Record<string, unknown>)
      : undefined;
  return {
    id: newId(),
    name: parsed.name,
    description: parsed.description,
    firstMes: typeof parsed.firstMes === "string" && parsed.firstMes.trim() ? parsed.firstMes : undefined,
    worldInfo: Array.isArray(parsed.worldInfo) ? parsed.worldInfo : [],
    ...(Array.isArray(parsed.regexScripts) && parsed.regexScripts.length
      ? { regexScripts: parsed.regexScripts }
      : {}),
    ...(passthroughExt ? { extensions: passthroughExt } : {}),
    ...(typeof parsed.version === "number" ? { version: parsed.version } : {}),
    ...(typeof parsed.author === "string" && parsed.author ? { author: parsed.author } : {}),
    ...(parsed.source === "original" || parsed.source === "reposted" ? { source: parsed.source } : {}),
    ...(typeof parsed.intro === "string" && parsed.intro ? { intro: parsed.intro } : {}),
  };
}

function isSillyTavernFormat(parsed: any): boolean {
  return (
    parsed?.spec === "chara_card_v3" ||
    (parsed?.data?.name !== undefined && parsed?.data?.description !== undefined)
  );
}

// Map a SillyTavern character card's `data.extensions.regex_scripts` into our
// RegexScript model (the scoped/local regex that travels with the card and
// applies only while this character is active). ST uses the same field names,
// so this is mostly a defensive copy with sane fallbacks. Entries with no find
// pattern are dropped.
function convertRegexScripts(data: any): RegexScript[] {
  const raw: any[] = data.extensions?.regex_scripts ?? data.regex_scripts ?? [];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r: any): RegexScript => ({
      id: r.id != null ? String(r.id) : newId(),
      scriptName: typeof r.scriptName === "string" ? r.scriptName : "导入的正则",
      findRegex: typeof r.findRegex === "string" ? r.findRegex : "",
      replaceString: typeof r.replaceString === "string" ? r.replaceString : "",
      trimStrings: Array.isArray(r.trimStrings) ? r.trimStrings.filter((s: any) => typeof s === "string") : [],
      placement: Array.isArray(r.placement) && r.placement.length ? r.placement : [2],
      disabled: r.disabled === true,
      markdownOnly: r.markdownOnly === true,
      promptOnly: r.promptOnly === true,
      runOnEdit: r.runOnEdit === true,
      substituteRegex: r.substituteRegex === 1 || r.substituteRegex === 2 ? r.substituteRegex : 0,
      minDepth: typeof r.minDepth === "number" ? r.minDepth : null,
      maxDepth: typeof r.maxDepth === "number" ? r.maxDepth : null,
    }))
    .filter((s) => s.findRegex.trim() !== "");
}

// SillyTavern world_info_position enum (authoritative value lives in
// `entry.extensions.position`; the V3-spec top-level `entry.position` string is
// a lossy fallback — ST writes "after_char" even for at-depth entries).
const ST_POS_AT_DEPTH = 4;
// extensions.role on an at-depth entry: 0=system, 1=user, 2=assistant.
const ST_ROLE_ASSISTANT = 2;

// Project a SillyTavern world-info entry's insertion position onto NyaaChat's
// two injection roles. Per .docs/llm-chat-prompt-architecture-standard.md we do
// NOT reproduce ST's depth/before-after physical placement (mid-history
// insertion breaks the prefix cache and is the doc's worst anti-pattern). The
// `position` field here is an injection ROLE, not a location: where the entry
// actually lands (static prefix vs. trailing <session_rules>) is decided by
// triggerType, not by this.
//
//   @D 🤖 AI (atDepth, role=assistant) → assistant  (the only AI-voice case)
//   @D ⚙ system / @D 👤 user           → system
//   before_char / after_char           → system
//   AN前后 / EM前后 (no NyaaChat slot)  → system (keep content, drop fine position)
//
// User-role depth injection is intentionally folded to system: NyaaChat has no
// user injection slot and the standard forbids recreating one. Reading from
// extensions (not the top-level string) is what lets us tell @D ⚙ system rules
// apart from @D 🤖 assistant notes — the V3 string would mislabel both.
function mapEntryPosition(entry: any): "system" | "assistant" {
  const ext = entry.extensions ?? {};
  if (ext.position === ST_POS_AT_DEPTH && ext.role === ST_ROLE_ASSISTANT) {
    return "assistant";
  }
  return "system";
}

export function convertSillyTavernCharacter(parsed: any): CharacterSettings {
  const data = parsed.data ?? parsed;

  // Import every world-info entry the card carries — no filtering. Earlier
  // versions dropped status-bar / UI-rendering entries (and entries referenced
  // by tavern_helper scripts) because NyaaChat could not render them; now that
  // frontend rendering exists, those entries must survive the import intact.
  // Disabled entries are kept as well, preserving their disabled state below,
  // so nothing in the card is silently lost.
  const entries: any[] = data.character_book?.entries ?? [];
  const worldInfo: WorldInfoRule[] = entries
    .map((e: any) => ({
      id: e.id != null ? String(e.id) : newId(),
      name: e.comment || `Rule ${e.id}`,
      triggerType: e.constant ? "permanent" : "keywords",
      keywords: e.constant ? undefined : (e.keys ?? []).join(","),
      position: mapEntryPosition(e),
      // ST has no hard/soft authority concept; nothing in the card justifies
      // auto-promoting an entry to a hard constraint. Per the prompt-architecture
      // standard (§6.1 / §7.8) imported lore defaults to soft — the user
      // manually promotes the few true rules (e.g. TRPG check mechanics) after.
      hard: false,
      // Collapse ST's two recursion limiters into one switch: an entry only
      // participates in NyaaChat's recursion chain if ST left it fully open
      // (neither exclude_recursion nor prevent_recursion set). delay_until_recursion
      // has no equivalent and is dropped.
      allowRecursion: !(
        (e.extensions?.exclude_recursion ?? false) ||
        (e.extensions?.prevent_recursion ?? false)
      ),
      content: e.content ?? "",
      enabled: e.enabled ?? true,
    }));

  const regexScripts = convertRegexScripts(data);

  return {
    id: newId(),
    name: data.name,
    description: data.description,
    firstMes: data.first_mes || undefined,
    worldInfo,
    ...(regexScripts.length ? { regexScripts } : {}),
  };
}

export { isSillyTavernFormat };