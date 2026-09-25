/**
 * SillyTavern ⇄ `ScriptRecord` 映射 —— **宿主侧唯一实现**（SSOT §2.5）。
 *
 * 调用方只有宿主侧的这三处：
 *   - `src/lib/sillyTavernImport.ts`：`convertSillyTavernCharacter` / `convertNativeCard`
 *   - `src/lib/sillyTavernExport.ts`：`convertToSillyTavernCharacter`
 *   - `src/components/CharacterEditModal.tsx`：`toNativeCardJson`（原生卡导出）
 *
 * 插件侧（`plugins/js-slash-runner/**`）**完全不认识** ST 结构：它只处理
 * `CharacterSettings.scripts` 的 `ScriptRecord[]`（读 / 写 / 启停 / 排序）。
 * 因此 ST 的字段名与路径（`data.extensions.tavern_helper.scripts`、`export_with`）
 * 在 NyaaChat 里只允许出现在本文件；其它地方再出现一份就是"同一份映射写了两遍"。
 * 原生卡的 `scripts` 字段同样只由本文件写出（`nativeCardScriptsField`）。
 *
 * 本文件是**纯函数**集合：不 import 任何运行时依赖（只有类型）、不读写存储、无副作用
 * （返回值均为新对象，与入参不共享可变结构）。
 */

import type { CharacterSettings, ScriptRecord } from "../types";

/** ST 卡里脚本数组的路径：`data.extensions.tavern_helper.scripts`。 */
const ST_HELPER_KEY = "tavern_helper";
const ST_SCRIPTS_KEY = "scripts";

/** 已知字段名。除 `export_with` ⇄ `exportWith` 外全部同名直传。 */
const KNOWN_KEYS = new Set([
  "id",
  "name",
  "content",
  "enabled",
  "type",
  "info",
  "button",
  "data",
  "export_with",
  "exportWith",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 深拷贝 JSON 系结构（保留 `undefined` 值，不做 JSON 往返）。 */
function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepCopy(item)) as unknown as T;
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = deepCopy(item);
    return out as T;
  }
  return value;
}

/**
 * 把一条 ST 形态（或原生卡 `scripts` 里的）脚本对象规范化为 `ScriptRecord`。
 *
 * - `id` 缺失/空串 ⇒ `st-<n>`（`n` 为脚本在数组中的 **1-based** 序号，仅在该脚本
 *   自身缺 id 时使用；不会与已有 id 冲突，因为后者原样保留）。
 * - `name` 缺失/空串 ⇒ `脚本 <n>`。
 * - `enabled` 非布尔（含缺失/`null`）⇒ `true`（对应 SSOT 的 `enabled ?? true`）。
 * - `type/info/button/data` 原样搬（`button`/`data` 深拷贝）。
 * - `export_with` ⇒ `exportWith`（反向亦接受已映射的 `exportWith`，便于幂等）。
 * - **未知字段原样保留**在本对象上 ⇒ 导出时逐字段写回，往返保真。
 */
function toScriptRecord(raw: Record<string, unknown>, index: number): ScriptRecord {
  const ordinal = index + 1;
  const record: Record<string, unknown> = {};

  // 未知字段先搬（它们的键序无关紧要；导出时同样会被逐字段写回）。
  for (const [key, value] of Object.entries(raw)) {
    if (!KNOWN_KEYS.has(key)) record[key] = deepCopy(value);
  }

  record.id = raw.id == null || raw.id === "" ? `st-${ordinal}` : String(raw.id);
  record.name = typeof raw.name === "string" && raw.name !== "" ? raw.name : `脚本 ${ordinal}`;
  record.content = typeof raw.content === "string" ? raw.content : "";
  record.enabled = typeof raw.enabled === "boolean" ? raw.enabled : true;
  if (typeof raw.type === "string") record.type = raw.type;
  if (typeof raw.info === "string") record.info = raw.info;
  if (raw.button !== undefined) record.button = deepCopy(raw.button);
  if (raw.data !== undefined) record.data = deepCopy(raw.data);
  const exportWith = raw.export_with !== undefined ? raw.export_with : raw.exportWith;
  if (exportWith !== undefined) record.exportWith = deepCopy(exportWith);

  return record as unknown as ScriptRecord;
}

/** 数组形态的规范化（非数组 ⇒ `[]`；非对象项跳过，但序号仍按原下标计）。 */
function toScriptRecords(raw: unknown): ScriptRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item, index) => (isPlainObject(item) ? [toScriptRecord(item, index)] : []));
}

/**
 * 读 ST 卡附带的脚本：`data.extensions.tavern_helper.scripts`。
 *
 * `stData` 传 `parsed.data ?? parsed`（即 ST v3 的 `data` 块）。缺字段/形状不对 ⇒ `[]`。
 */
export function readSillyTavernScripts(stData: unknown): ScriptRecord[] {
  const extensions = isPlainObject(stData) ? (stData as any).extensions : undefined;
  const helper = isPlainObject(extensions) ? (extensions as Record<string, unknown>)[ST_HELPER_KEY] : undefined;
  const scripts = isPlainObject(helper) ? (helper as Record<string, unknown>)[ST_SCRIPTS_KEY] : undefined;
  return toScriptRecords(scripts);
}

/**
 * 读 NyaaChat **原生卡**的脚本：顶层 `scripts` 字段（原生 JSON 是
 * `CharacterSettings` 的无损往返，字段名与类型一致）。
 */
export function readNativeCardScripts(parsedCard: unknown): ScriptRecord[] {
  return toScriptRecords(isPlainObject(parsedCard) ? (parsedCard as Record<string, unknown>).scripts : undefined);
}

/**
 * `ScriptRecord[]` → ST 形态脚本数组（`exportWith` 写回 `export_with`）。
 *
 * 键序刻意与 ST 自己写出的顺序一致（`type, enabled, name, id, content, info, button,
 * data, export_with`），让导出的卡对 ST 侧读者保持熟悉的形状。可选字段只在有值时写出；
 * 未知字段追加在末尾，保证往返保真。
 */
export function toSillyTavernScripts(scripts: readonly ScriptRecord[] | undefined): Array<Record<string, unknown>> {
  if (!Array.isArray(scripts)) return [];
  return scripts.map((script) => {
    const src = script as unknown as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    if (typeof script.type === "string") out.type = script.type;
    out.enabled = typeof script.enabled === "boolean" ? script.enabled : true;
    out.name = script.name;
    out.id = script.id;
    out.content = script.content;
    if (typeof script.info === "string") out.info = script.info;
    if (script.button !== undefined) out.button = deepCopy(script.button);
    if (script.data !== undefined) out.data = deepCopy(script.data);
    if (script.exportWith !== undefined) out.export_with = deepCopy(script.exportWith);
    for (const [key, value] of Object.entries(src)) {
      if (!KNOWN_KEYS.has(key)) out[key] = deepCopy(value);
    }
    return out;
  });
}

/**
 * 返回**新的** ST `extensions` 对象：保留既有内容，并在有脚本时写入
 * `tavern_helper.scripts`（无脚本时返回不改动的副本，即不写出空数组 —— 与
 * `regex_scripts` 的处理对称）。
 *
 * 目的：让"ST 路径长什么样"只在本文件出现一次，调用方只做一次赋值。
 */
export function withSillyTavernScripts(
  extensions: Record<string, unknown>,
  scripts: readonly ScriptRecord[] | undefined,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...extensions };
  if (!Array.isArray(scripts) || scripts.length === 0) return next;
  const existingHelper = isPlainObject(next[ST_HELPER_KEY])
    ? (next[ST_HELPER_KEY] as Record<string, unknown>)
    : {};
  next[ST_HELPER_KEY] = { ...existingHelper, [ST_SCRIPTS_KEY]: toSillyTavernScripts(scripts) };
  return next;
}

/**
 * 原生卡顶层 `scripts` 字段（无脚本时返回 `{}`，便于 `...spread`）。
 *
 * 这是原生卡 `scripts` 字段名的唯一出现点；`toNativeCardJson` 与
 * `src/components/CharacterEditModal.tsx` 都只经由它写该字段。
 */
export function nativeCardScriptsField(scripts: readonly ScriptRecord[] | undefined): { scripts?: ScriptRecord[] } {
  return Array.isArray(scripts) && scripts.length ? { scripts: deepCopy(scripts) } : {};
}

/**
 * 原生卡 JSON 的**格式**版本，与 `format: "nyaachat-character"` 配套。
 *
 * ⚠️ 与 `CharacterSettings.version`（共享系统的**本地修订号**）**共用 `version` 这一个键**
 * ——这是既有形状，不是本次新增的重载。没有读者校验格式版本（判别格式靠 `format` 字符串），
 * 而导入侧 `convertNativeCard` 恰好把 `parsed.version` 读成修订号 ⇒ 导出侧只有在卡片
 * 自己**没有**修订号时才写本常量，保证老卡导出结果逐字节不变（见 `toNativeCardJson`）。
 */
export const NATIVE_CARD_FORMAT_VERSION = 1;

/**
 * 共享系统**预留字段**（`types.ts` 的 `CharacterSettings.globalId/owner/shared/tags`）
 * 写进原生卡 JSON 的规则：**存在才写**、类型不符即忽略（与 `author`/`source`/`intro`
 * 的既有写法同口径）。`version` 不在这里 —— 它有格式版本兜底，见上。
 *
 * 抽成独立的私有函数是为了让"哪些字段要往返"只有一处定义，且能被断言逐字段核对；
 * 老卡（这些字段全空）不会因此凭空多出键。
 */
function nativeCardSharedFields(char: CharacterSettings): Record<string, unknown> {
  const tags = Array.isArray(char.tags) ? char.tags.filter((tag) => typeof tag === "string") : [];
  return {
    ...(typeof char.globalId === "string" && char.globalId ? { globalId: char.globalId } : {}),
    ...(typeof char.owner === "string" && char.owner ? { owner: char.owner } : {}),
    // 显式 `false` 也写出（"本地卡"是一个真实状态，往返后不该变成 undefined）。
    ...(typeof char.shared === "boolean" ? { shared: char.shared } : {}),
    ...(tags.length ? { tags } : {}),
  };
}

/**
 * 组装 NyaaChat **原生卡**（PNG tEXt `chara` 里的 JSON）的顶层对象 —— 与 ST 侧的
 * `sillyTavernExport.convertToSillyTavernCharacter` 对称。
 *
 * 抽成纯函数的理由：原生卡导出的形状此前散在 `CharacterEditModal.exportNyaaChat`
 * 的内联字面量里，无法在 node 里断言（t9 收口）。现在导出路径只调用本函数，
 * 于是"原生卡导出是否带 scripts / 与源角色卡逐字段相等"变成可复验的断言。
 *
 * 字段集合与既有内联写法**逐字段一致**（format/version/name/description/firstMes/
 * worldInfo/regexScripts/author/source/intro）——不新增、不删除字段，唯一的增量是
 * `scripts`（与 `regexScripts` 对称：有值才写）。`coverImage` 不进 JSON（像素走
 * PNG 像素 + `coverImage` 标记由导入侧回填），与既有行为一致。
 *
 * ## t17：补齐共享系统预留字段的往返（`tags` / `globalId` / `owner` / `shared`）
 *
 * 这些字段在 `types.ts` 里的存在理由就是"**可无迁移往返**"（共享角色系统的地基），
 * 但带这些字段的卡一旦导出成原生 PNG 再导入，`tags` 与共享元数据会**静默丢失** ——
 * 于是 `import-export.md` 的"不会丢失任何数据"对原生格式并不成立。现在补齐：
 *
 *  · 新键**排在 `intro` 之后、`scripts` 之前** ⇒ 老卡（四个新键都为空）的输出**键序与
 *    字节与之前完全一致**，既有各键的行为一个字没变；
 *  · `version`：卡片有修订号（number）就写它，否则写格式版本 `1`（老卡行为不变）；
 *  · `tags`：**过滤掉非字符串后非空**才写（空数组 ≡ 不存在，与 `regexScripts` /
 *    `scripts` 同口径），因此不会给老卡凭空加字段；写出的恒是干净 `string[]`。
 *
 * 与导入侧 `convertNativeCard` 的读取规则**一一对应**（那里对类型不符的值一律忽略、
 * 不抛错）。两侧不对称就会重现"导出有、导入无"的静默丢字段，改动本函数时请同步改
 * `dev-server/tools/check-card-scripts.ts` 的 [3b] 逐字段往返断言。
 */
export function toNativeCardJson(char: CharacterSettings): Record<string, unknown> {
  return {
    format: "nyaachat-character",
    // 见 `NATIVE_CARD_FORMAT_VERSION`：有修订号写修订号，没有才写格式版本 1。
    version:
      typeof char.version === "number" && Number.isFinite(char.version)
        ? char.version
        : NATIVE_CARD_FORMAT_VERSION,
    name: char.name,
    description: char.description,
    ...(char.firstMes ? { firstMes: char.firstMes } : {}),
    ...(char.alternateGreetings && char.alternateGreetings.length
      ? { alternateGreetings: char.alternateGreetings }
      : {}),
    worldInfo: char.worldInfo ?? [],
    ...(char.regexScripts && char.regexScripts.length ? { regexScripts: char.regexScripts } : {}),
    ...(char.author ? { author: char.author } : {}),
    ...(char.source ? { source: char.source } : {}),
    ...(char.intro ? { intro: char.intro } : {}),
    // t17：共享系统预留字段（存在才写；老卡不新增键）。
    ...nativeCardSharedFields(char),
    // 卡片脚本：原生卡与 `CharacterSettings` 同名同形，直接读写 `scripts`。
    ...nativeCardScriptsField(char.scripts),
  };
}
