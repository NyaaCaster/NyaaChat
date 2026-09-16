/**
 * 提示词侧的变量宏（SSOT §2.6）。
 *
 * 支持的宏（6 个 = `get_` / `format_` × `message` / `chat` / `global`）：
 *
 *   {{get_message_variable::stat_data}}      → 一行 JSON
 *   {{format_message_variable::stat_data}}   → YAML 块（样例卡「变量列表」用的就是这个）
 *   {{get_chat_variable::路径}} / {{format_chat_variable::路径}}
 *   {{get_global_variable::路径}} / {{format_global_variable::路径}}
 *   （路径可省略 = 整个作用域对象；分隔符 `/` 或 `.` 都接受）
 *
 * 未提供 character / preset / script / extension 四个变体（那四个作用域不在本阶段
 * 范围，见 SSOT §0.1 NG8）——它们会**原样保留**在文本里，不会被误替换。
 *
 * 供 `src/lib/chatPipeline.ts` 在**动态尾部**渲染世界书条目时调用（D6-①'）。
 */
import { getVariableAtPath } from "./api";
import type { VariableScope } from "./types";
import { toYaml } from "./yamlOut";

const MACRO_RE =
  /\{\{\s*(get|format)_(message|chat|global)_variable(?:\s*::\s*([^}]*?))?\s*\}\}/g;
const MACRO_TEST_RE =
  /\{\{\s*(get|format)_(message|chat|global)_variable(?:\s*::\s*([^}]*?))?\s*\}\}/;

/** 文本里是否含本阶段支持的变量宏（`chatPipeline` 用它决定条目归静态前缀还是动态尾部）。 */
export function hasVariableMacro(text: string): boolean {
  return typeof text === "string" && MACRO_TEST_RE.test(text);
}

/** 同一个 (作用域, 路径) 只 warn 一次，避免逐轮刷屏。 */
const warnedKeys = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}

/** 仅供测试：清空"已警告"集合。 */
export function resetMacroWarningsForTests(): void {
  warnedKeys.clear();
}

/** 把文本里的变量宏替换成当前值。 */
export function substituteVariableMacros(text: string): string {
  if (typeof text !== "string" || text.indexOf("{{") === -1) return text;

  return text.replace(MACRO_RE, (_full, kind: string, scope: string, rawPath?: string) => {
    const path = (rawPath ?? "").trim();
    let value: unknown;
    try {
      value = getVariableAtPath(path, scope as VariableScope);
    } catch (err) {
      warnOnce(
        `${scope}:${path}:error`,
        `[variables] 变量宏 {{${kind}_${scope}_variable::${path}}} 取值失败：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return "";
    }

    if (value === undefined) {
      warnOnce(
        `${scope}:${path}:missing`,
        `[variables] 变量宏 {{${kind}_${scope}_variable::${path}}} 的路径不存在，已替换为空串`,
      );
      return "";
    }

    if (kind === "format") {
      try {
        return toYaml(value);
      } catch (err) {
        warnOnce(
          `${scope}:${path}:yaml`,
          `[variables] 变量宏 {{format_${scope}_variable::${path}}} 渲染 YAML 失败：${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return "";
      }
    }

    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
}
