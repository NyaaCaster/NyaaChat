/**
 * 脚本集合的读写（SSOT §2.4 的 `scripts/store.ts`）。
 *
 * ⚠️ 本文件**不认识 ST 结构** —— ST ⇄ `ScriptRecord` 的映射只在宿主
 * `src/lib/sillyTavernScripts.ts` 一处实现（导入角色卡时生效）。这里只处理
 * "当前角色的脚本列表"本身：启停 / 排序 / 删除的语义已由 UI 组件导出
 * （`ScriptLibraryModal` 的 `moveScript` / `toggleScriptEnabled` / `removeScript`），
 * 本文件只补"从文件导入"与 id 生成，避免同一份逻辑写两遍。
 */
import type { ScriptRecord } from "../../../src/types";

/** 生成一个不与现有列表冲突的脚本 id。 */
export function nextScriptId(scripts: readonly ScriptRecord[]): string {
  const used = new Set(scripts.map((s) => s.id));
  for (let i = 1; i < 10_000; i++) {
    const candidate = `script-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `script-${Date.now()}`;
}

interface ImportedScriptShape {
  id?: unknown;
  name?: unknown;
  content?: unknown;
  enabled?: unknown;
  type?: unknown;
  info?: unknown;
  button?: unknown;
  data?: unknown;
  exportWith?: unknown;
}

function toRecord(raw: ImportedScriptShape, index: number, existing: readonly ScriptRecord[]): ScriptRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const content = typeof raw.content === "string" ? raw.content : "";
  if (!content) return null;
  const id =
    typeof raw.id === "string" && raw.id && !existing.some((s) => s.id === raw.id)
      ? raw.id
      : nextScriptId([...existing, { id: "" } as ScriptRecord]);
  const record: ScriptRecord = {
    id,
    name: typeof raw.name === "string" && raw.name ? raw.name : `脚本 ${index + 1}`,
    content,
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
  };
  if (typeof raw.type === "string") record.type = raw.type;
  if (typeof raw.info === "string") record.info = raw.info;
  if (raw.button !== undefined) record.button = raw.button;
  if (raw.data !== undefined) record.data = raw.data;
  // ⚠️ 只认 `exportWith`（camelCase）。**刻意不支持 `export_with`** ——
  // ST 结构 ↔ ScriptRecord 的映射（含 `export_with ↔ exportWith`）只允许在宿主
  // `src/lib/sillyTavernScripts.ts` 一处出现（t3 建立的唯一性性质，有全仓断言守着）。
  if (raw.exportWith !== undefined) {
    record.exportWith = raw.exportWith as ScriptRecord["exportWith"];
  }
  return record;
}

/**
 * 解析"从文件导入"的 JSON：
 *  · `ScriptRecord[]`
 *  · `{ scripts: [...] }`
 *  · `{ data: { extensions: { tavern_helper: { scripts: [...] } } } }`（ST 卡原始 JSON）
 * 三种形态都接受 —— 后两种只是为了"把已有的脚本 JSON 直接粘进来"，**不做字段翻译**
 * （ST → NyaaChat 的正式映射仍只在导入角色卡时由宿主执行）。
 */
export function parseScriptsFile(text: string, existing: readonly ScriptRecord[]): ScriptRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("不是合法的 JSON 文件");
  }
  const candidates: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { scripts?: unknown })?.scripts)
      ? ((parsed as { scripts: unknown[] }).scripts)
      : Array.isArray(
            (parsed as { data?: { extensions?: { tavern_helper?: { scripts?: unknown } } } })?.data
              ?.extensions?.tavern_helper?.scripts,
          )
        ? ((parsed as { data: { extensions: { tavern_helper: { scripts: unknown[] } } } }).data.extensions
            .tavern_helper.scripts)
        : [];

  if (candidates.length === 0) throw new Error("文件里没有找到脚本数组");

  const out: ScriptRecord[] = [];
  candidates.forEach((raw, index) => {
    const record = toRecord(raw as ImportedScriptShape, index, [...existing, ...out]);
    if (record) out.push(record);
  });
  if (out.length === 0) throw new Error("文件里的脚本缺少 content 字段，无法导入");
  return out;
}
