// Regex script import/export — SillyTavern-compatible serialization.
//
// Export mirrors ST exactly (`JSON.stringify(script, null, 4)`) so a NyaaChat
// regex file is structurally an ST regex script and round-trips with it. The
// only intentional difference is the file extension (`.nyaa` instead of ST's
// `.json`); the filename stem uses ST's own `sanitizeFileName`, so the
// "regex-<name>" part matches ST byte for byte (e.g. regex-🐈g·rpg状态栏).
//
// Import accepts both `.nyaa` and `.json`, a single object or an array (ST does
// too), and validates + normalizes each entry into our RegexScript shape with a
// fresh id — the compliance check the spec asks for.

import type { RegexScript } from "../../types";
import { newId } from "../../lib/id";

/** ST's sanitizeFileName (extensions/regex/index.js): collapse whitespace, path
 *  separators and reserved characters to '_' and lowercase. Emoji / CJK pass
 *  through unchanged, matching ST's output. */
export function sanitizeRegexFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\s.<>:"/\\|?*\x00-\x1F\x7F]/g, "_").toLowerCase();
}

/** Export filename: ST's `regex-<sanitized>` stem with NyaaChat's `.nyaa`. */
export function regexExportFileName(scriptName: string): string {
  return `regex-${sanitizeRegexFileName(scriptName)}.nyaa`;
}

/** Serialize one script. ST writes `JSON.stringify(script, null, 4)`; we match
 *  the indentation and field layout so the file is interchangeable with ST. */
export function serializeRegexScript(script: RegexScript): string {
  return JSON.stringify(script, null, 4);
}

/** Validate + normalize one raw imported object into a RegexScript, or null if
 *  it isn't a compliant regex script. A fresh id is always assigned (as ST does
 *  on import). */
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
