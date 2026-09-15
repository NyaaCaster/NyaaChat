// 正则脚本的导入 / 导出（`.nyaa` 文件）。
//
// 导出（`JSON.stringify(script, null, 4)`）与通行的 regex 脚本 JSON 形状一致，
// 因此 NyaaChat 的导出文件可以被同类工具直接读取，反向也一样 —— 这是刻意保留的
// 互通能力（用户需求：导入/导出不受影响）。唯一有意的差异是文件扩展名：NyaaChat
// 用 `.nyaa`。文件名主干沿用 `sanitizeRegexFileName`，所以 `regex-<name>` 这一
// 段与外部工具逐字节一致（例如 regex-🐈g·rpg状态栏）。
//
// 导入同时接受 `.nyaa` 与 `.json`、单个对象或数组，并对每一项做校验 + 归一化成
// NyaaChat 的 RegexScript 形状（总是分配新 id）。

import type { RegexScript } from "../../types";
import { newId } from "../id";

/** Collapse whitespace, path separators and reserved characters to '_' and
 *  lowercase. Emoji / CJK pass through unchanged. */
export function sanitizeRegexFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, "_").toLowerCase();
}

/** Export filename: `regex-<sanitized>` stem with NyaaChat's `.nyaa`. */
export function regexExportFileName(scriptName: string): string {
  return `regex-${sanitizeRegexFileName(scriptName)}.nyaa`;
}

/** Serialize one script with 4-space indentation and the shared field layout so
 *  the file is interchangeable with other regex-script tools. */
export function serializeRegexScript(script: RegexScript): string {
  return JSON.stringify(script, null, 4);
}

/** Validate + normalize one raw imported object into a RegexScript, or null if
 *  it isn't a compliant regex script. A fresh id is always assigned. */
function normalizeRegexScript(raw: unknown): RegexScript | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.scriptName !== "string" || r.scriptName.trim() === "") return null;
  if (typeof r.findRegex !== "string" || r.findRegex.trim() === "") return null;

  const placement = Array.isArray(r.placement)
    ? r.placement.filter((n): n is number => typeof n === "number")
    : [];

  return {
    id: newId(),
    scriptName: r.scriptName,
    findRegex: r.findRegex,
    replaceString: typeof r.replaceString === "string" ? r.replaceString : "",
    trimStrings: Array.isArray(r.trimStrings)
      ? r.trimStrings.filter((s): s is string => typeof s === "string")
      : [],
    placement: placement.length ? placement : [2],
    disabled: r.disabled === true,
    markdownOnly: r.markdownOnly === true,
    promptOnly: r.promptOnly === true,
    runOnEdit: r.runOnEdit === true,
    substituteRegex: r.substituteRegex === 1 || r.substituteRegex === 2 ? r.substituteRegex : 0,
    minDepth: typeof r.minDepth === "number" ? r.minDepth : null,
    maxDepth: typeof r.maxDepth === "number" ? r.maxDepth : null,
  };
}

/**
 * Parse an imported regex file's text into validated scripts. Accepts a single
 * object or an array. Throws on malformed JSON or when no compliant script is
 * found — the caller surfaces the message to the user.
 */
export function parseImportedRegexScripts(text: string): RegexScript[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("无效的 JSON 文件");
  }
  const items = Array.isArray(parsed) ? parsed : [parsed];
  const out: RegexScript[] = [];
  for (const item of items) {
    const norm = normalizeRegexScript(item);
    if (norm) out.push(norm);
  }
  if (out.length === 0) {
    throw new Error("未找到有效的正则脚本（需含 scriptName 与 findRegex）");
  }
  return out;
}
