import { CharacterSettings, RegexScript, WorldInfoRule } from "../types";
import { newId } from "./id";
import { readNativeCardScripts, readSillyTavernScripts } from "./sillyTavernScripts";

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

// ─────────────────────────── 角色卡文件类型（.png / .json）───────────────────────────

/** 角色卡文件类型。UI 的 `accept` 与这里的判定必须一致（两处各写一份必然漂移）。 */
export type CardFileKind = "png" | "json";

/** 由**文件名**判定卡片类型；不支持的类型返回 `null`（调用方负责给用户可读文案）。 */
export function cardFileKind(fileName: string): CardFileKind | null {
  const lower = (fileName || "").toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".json")) return "json";
  return null;
}

/**
 * 解析 `.json` 角色卡文本。**纯函数** —— 判据可以直接喂字符串，不必造 `File`。
 *
 * 兼容三类：SillyTavern v2/v3（`data` 包裹）、SillyTavern v1（扁平）、
 * NyaaChat 原生卡（`format: "nyaachat-character"`）。**这里只做"是不是一个 JSON 对象"**，
 * 具体是哪种卡交给 `isSillyTavernFormat` 分派、字段校验交给两个 converter。
 *
 * ⚠️ 必须剥 **UTF-8 BOM**：`JSON.parse("\uFEFF{…}")` 会抛 `Unexpected token`，而中文卡
 * 常由 Windows 工具（记事本 / PowerShell `Out-File`）导出 ⇒ BOM 很常见，不剥就是"看着是合法
 * JSON 却导不进来"。
 */
export function parseCardJsonText(text: string): any {
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  if (!cleaned.trim()) throw new Error("JSON 文件是空的");
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err: any) {
    throw new Error(`不是有效的 JSON：${err?.message ?? String(err)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON 角色卡必须是一个对象（不支持数组或裸值）");
  }
  return parsed;
}

/** 读取 `.json` 角色卡文件。大小上限与 PNG 路径一致（`MAX_IMPORT_BYTES`）。 */
export async function extractCardJson(file: File): Promise<any> {
  if (file.size > MAX_IMPORT_BYTES) {
    throw new Error(`JSON 文件过大（${(file.size / 1024 / 1024).toFixed(2)} MB），上限 5 MB`);
  }
  return parseCardJsonText(await file.text());
}

/** Convert a NyaaChat-native card JSON (the object embedded in our own PNG
 *  export, `format: "nyaachat-character"`) into CharacterSettings. Reads our own
 *  top-level fields directly — regex under `regexScripts`, card JS scripts under
 *  `scripts`, plus the shared-system metadata groundwork. A legacy card that
 *  still carries `extensions` (the character-level blob of the removed extension
 *  compatibility layer) imports fine; that retired field is ignored, not copied.
 *  `name` must be a non-empty string; `description` may be empty (or absent ⇒ `""`)
 *  — see the note in the body — because cards in the wild carry the persona in
 *  their world book instead.
 */
export function convertNativeCard(parsed: any): CharacterSettings {
  if (!parsed.name || typeof parsed.name !== "string") throw new Error('Missing or invalid "name"');
  // `description` 允许为空串：**空 description 是合法卡型**（样例 MVU 卡即如此 ——
  // persona 主要靠世界书承载），而我们自己的原生卡导出器
  // （`sillyTavernScripts.toNativeCardJson`）对空 description 就写出 `""`。
  // 若在此把"空"当缺失拒绝，"原生卡导出 → 再导入"这条往返路径对这类卡直接失败。
  // 口径（t11）：字符串（含 `""`）直接用；`undefined` 视为 `""`（原生卡 JSON 由我们
  // 自己的导出器写出，缺失等价于空）；其它类型（number/object/null）仍抛错 ——
  // 保留对畸形文件的防御，不把校验削弱成"什么都收"。
  if (parsed.description !== undefined && typeof parsed.description !== "string") {
    throw new Error('Missing or invalid "description"');
  }
  const description: string = parsed.description ?? "";
  // 卡片脚本（原生卡与 `CharacterSettings` 同名同形，直接读写 `scripts`）。
  const scripts = readNativeCardScripts(parsed);
  // t17：共享系统预留字段。**与导出侧 `toNativeCardJson` 一一对应**；这里的口径是
  // "类型不符即忽略、绝不抛错" —— 它们是可选元数据，一个畸形值不该让整张卡导不进来。
  // `tags` 与导出侧对称：过滤非字符串，过滤后为空则视为"没有标签"（≡ 不写出该键）。
  const tags: string[] = Array.isArray(parsed.tags)
    ? parsed.tags.filter((tag: unknown) => typeof tag === "string")
    : [];
  return {
    id: newId(),
    name: parsed.name,
    description,
    firstMes: typeof parsed.firstMes === "string" && parsed.firstMes.trim() ? parsed.firstMes : undefined,
    worldInfo: Array.isArray(parsed.worldInfo) ? parsed.worldInfo : [],
    ...(Array.isArray(parsed.regexScripts) && parsed.regexScripts.length
      ? { regexScripts: parsed.regexScripts }
      : {}),
    ...(scripts.length ? { scripts } : {}),
    ...(typeof parsed.version === "number" ? { version: parsed.version } : {}),
    ...(typeof parsed.author === "string" && parsed.author ? { author: parsed.author } : {}),
    ...(parsed.source === "original" || parsed.source === "reposted" ? { source: parsed.source } : {}),
    ...(typeof parsed.intro === "string" && parsed.intro ? { intro: parsed.intro } : {}),
    ...(typeof parsed.globalId === "string" && parsed.globalId ? { globalId: parsed.globalId } : {}),
    ...(typeof parsed.owner === "string" && parsed.owner ? { owner: parsed.owner } : {}),
    // 显式 `false` 也读回（与导出侧 `typeof === "boolean"` 对称）。
    ...(typeof parsed.shared === "boolean" ? { shared: parsed.shared } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

/**
 * 判定"这张卡是不是 **SillyTavern 卡**"（否则按 NyaaChat 原生卡处理）。
 *
 * 判定顺序有意如此（2026-09-18 放宽 `.json` 导入时重写，旧实现在注释里点出的两个坑已修）：
 *  1. **原生卡的显式标记优先** —— `format: "nyaachat-character"` 直接判原生，免得被下面
 *     按形状的规则抢走；
 *  2. ST v2/v3：`spec` 以 `chara_card_` 开头（前缀匹配，兼容将来的 v4）；
 *  3. **缺 `spec` 的 ST 野卡**：`data` 下有 `name` / `character_book` / `first_mes` 任一。
 *     ⚠️ 旧实现要求 `data.name` 与 `data.description` **同时存在** ⇒ 少写 `description`
 *     的 v2 卡会被误判成原生卡，再因顶层没有 `name` 而抛 `Missing or invalid "name"`；
 *  4. ST v1 **扁平卡**：顶层蛇形字段（`first_mes` / `character_book` / `mes_example`）
 *     且**没有**原生驼形字段（`firstMes` / `worldInfo` / `regexScripts`）。
 *     （旧实现不看这一条 ⇒ v1 扁平卡走原生分支，`first_mes` 与世界书被**静默丢弃**。）
 */
function isSillyTavernFormat(parsed: any): boolean {
  if (!parsed || typeof parsed !== "object") return false;
  if (parsed.format === "nyaachat-character") return false;
  if (typeof parsed.spec === "string" && parsed.spec.startsWith("chara_card_")) return true;
  const data = parsed.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    if (data.name !== undefined || data.character_book !== undefined || data.first_mes !== undefined) {
      return true;
    }
  }
  const looksFlatSt =
    parsed.first_mes !== undefined || parsed.character_book !== undefined || parsed.mes_example !== undefined;
  const looksNative =
    parsed.firstMes !== undefined || parsed.worldInfo !== undefined || Array.isArray(parsed.regexScripts);
  return looksFlatSt && !looksNative;
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
  // versions dropped status-bar / UI-rendering entries because NyaaChat could
  // not render them; now that frontend rendering exists, those entries must
  // survive the import intact.
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
      hard: e.extensions?.nyaa_hard === true,
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
      linkedKbIds: (() => {
        const ids = Array.isArray(e.extensions?.linkedKbIds)
          ? (e.extensions.linkedKbIds as string[]).filter((id: unknown) => typeof id === "string")
          : [];
        return ids.length > 0 ? ids : undefined;
      })(),
      _linkedKbCache: (e.extensions?._linkedKbCache as Record<string, { name: string; charTotal: number }>) ?? undefined,
    }));

  const regexScripts = convertRegexScripts(data);
  // 卡片自带的 JS 脚本（ST: `data.extensions.tavern_helper.scripts`）。映射只在
  // `sillyTavernScripts.ts` 里实现一次；这里不解释任何 ST 字段。
  const scripts = readSillyTavernScripts(data);

  return {
    id: newId(),
    name: data.name,
    description: data.description,
    firstMes: data.first_mes || undefined,
    worldInfo,
    ...(regexScripts.length ? { regexScripts } : {}),
    ...(scripts.length ? { scripts } : {}),
    ...(data.tags?.length ? { tags: data.tags as string[] } : {}),
  };
}

export { isSillyTavernFormat };