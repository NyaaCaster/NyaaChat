/**
 * 最小 YAML 输出器（SSOT §2.2 的 `yamlOut.ts`）。
 *
 * 只服务于 `{{format_*_variable::路径}}` 这一个用途：把变量值渲染成**合法的
 * YAML 块**（样例卡的世界书条目 `变量列表` 就是靠它把 `stat_data` 送给模型）。
 *
 * 设计取舍：
 *  · **不引入新依赖**（`yaml` 包只被脚本宿主 iframe 内的 `YAML` 全局使用，见
 *    SSOT §5.2；核心里再引一份是浪费，且会进主 bundle）；
 *  · 于是这里只实现"输出"所需的子集：嵌套映射 / 序列 / 标量 / 多行字符串 /
 *    空容器。**不做**锚点、标记、流式样式等；
 *  · 需要引号时直接复用 `JSON.stringify` 的转义结果 —— YAML 1.2 是 JSON 的
 *    超集，JSON 的双引号字符串是合法 YAML 标量，这样能避免自己写转义表。
 */

const PLAIN_SAFE_RE = /^[^\s\-?:,[\]{}#&*!|>'"%@`][^\n]*$/;
const RESERVED = new Set([
  "true", "false", "yes", "no", "on", "off", "null", "~",
  "True", "False", "Yes", "No", "On", "Off", "Null", "NULL",
  "TRUE", "FALSE", "YES", "NO", "ON", "OFF",
]);

function looksNumeric(s: string): boolean {
  return /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s);
}

/** 标量是否需要加引号。 */
function needsQuote(s: string): boolean {
  if (s === "") return true;
  if (RESERVED.has(s)) return true;
  if (looksNumeric(s)) return true;
  if (s !== s.trim()) return true;              // 前后空白
  if (s.includes("\n") || s.includes("\r")) return true;
  if (!PLAIN_SAFE_RE.test(s)) return true;
  if (s.includes(": ")) return true;
  // 任何含 `:` 的字符串一律加引号：既覆盖 `": "`，也覆盖 `07:00` 这类
  // **YAML 1.1 的六十进制整数**写法（`yaml` 包按 1.2 会当字符串，但 1.1 解析器
  // 会算成 420 —— 送给模型的内容不值得冒这个歧义）与 `http://…` 这类含冒号值。
  if (s.includes(":")) return true;
  if (s.includes(" #")) return true;
  return false;
}

export function scalarToYaml(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return Number.isFinite(value) ? String(value) : "null";
    case "bigint":
      return String(value);
    case "string":
      return needsQuote(value) ? JSON.stringify(value) : value;
    default:
      return JSON.stringify(value);
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function emitKey(key: string): string {
  return needsQuote(key) ? JSON.stringify(key) : key;
}

function isScalarLike(v: unknown): boolean {
  return v === null || v === undefined || typeof v !== "object";
}

function emit(value: unknown, indent: number, lines: string[]): void {
  const pad = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return; // 由调用方写成 `[]`
    for (const item of value) {
      if (isScalarLike(item)) {
        lines.push(`${pad}- ${scalarToYaml(item)}`);
      } else if (Array.isArray(item)) {
        if (item.length === 0) {
          lines.push(`${pad}- []`);
        } else {
          lines.push(`${pad}-`);
          emit(item, indent + 2, lines);
        }
      } else {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length === 0) {
          lines.push(`${pad}- {}`);
          continue;
        }
        // 首个键接在 "- " 之后，其余键缩进对齐（YAML 的紧凑序列映射写法）。
        const sub: string[] = [];
        emit(item, indent + 2, sub);
        lines.push(`${pad}- ${sub[0].slice(indent + 2)}`);
        for (let i = 1; i < sub.length; i++) lines.push(sub[i]);
      }
    }
    return;
  }

  if (isPlainObject(value)) {
    if (Object.keys(value).length === 0) return;
    for (const [key, v] of Object.entries(value)) {
      const k = emitKey(key);
      if (isScalarLike(v)) {
        lines.push(`${pad}${k}: ${scalarToYaml(v)}`);
      } else if (Array.isArray(v) && v.length === 0) {
        lines.push(`${pad}${k}: []`);
      } else if (isPlainObject(v) && Object.keys(v).length === 0) {
        lines.push(`${pad}${k}: {}`);
      } else {
        lines.push(`${pad}${k}:`);
        emit(v, indent + 2, lines);
      }
    }
    return;
  }

  lines.push(`${pad}${scalarToYaml(value)}`);
}

/** 把值渲染成 YAML 文本（无尾随换行）。 */
export function toYaml(value: unknown): string {
  if (isScalarLike(value)) return scalarToYaml(value);
  if (Array.isArray(value) && value.length === 0) return "[]";
  if (isPlainObject(value) && Object.keys(value).length === 0) return "{}";
  const lines: string[] = [];
  emit(value, 0, lines);
  return lines.join("\n");
}
