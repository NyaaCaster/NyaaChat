/**
 * EJS 定界符扫描 —— `compile.ts` 的前半段（上游 `ejs.js` 的 `generateSource` 之解析部分）。
 *
 * 语义基准：`.ref/ST-Prompt-Template/src/3rdparty/ejs.js`（ejs 3.1.9，browserify UMD bundle）。
 * 规格出处：`.docs/plugin-system/插件开发_EJS-template/EJS技术性说明.md` §3.1 / §3.2 / §3.4。
 *
 * ⚠️ 本文件是 **captain 自办**（t1）——引擎核心，P1 成败所系（风险 K4：语义偏差）。
 * ⚠️ 全程**不使用 `eval` / `new Function`**：这里只做「模板文本 → token 串」的纯字符串处理。
 * ⚠️ 与 npm 原版 EJS 存在差异（本份是改造版）：`[ \t]*<%_` / `_%>[ \t]*` 预处理与**嵌套标签平衡**
 *    都以**本份**为准（见技术性说明 §3.8）。
 */

/** 与 `ejs.js:56-58` 一致的默认定界符。 */
export const DEFAULT_OPEN_DELIMITER = "<";
export const DEFAULT_CLOSE_DELIMITER = ">";
export const DEFAULT_DELIMITER = "%";

/**
 * 与 `ejs.js:61` **逐字一致**。
 * ⚠️ 顺序即**最长匹配优先级**：`<%%` 必须排在 `<%` 之前，`%%>` / `-%>` / `_%>` 必须排在 `%>` 之前。
 */
export const REGEX_STRING = "(<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>)";

/** 与 `ejs.js:552-558` 的 `Template.modes` 对应。 */
export type EjsMode = "eval" | "escaped" | "raw" | "comment" | "literal";

/** token 的分类：仅用于调试/断言，`compile.ts` 主要消费 `raw`（与上游 `scanLine` 一致）。 */
export type EjsTokenKind = "open" | "close" | "text" | "literal-open" | "literal-close";

export interface EjsToken {
  /** 预处理 + 嵌套平衡后的 token 串 —— `scanLine` 直接对它做 `switch`。 */
  raw: string;
  kind: EjsTokenKind;
  /** 仅当 `kind === "open"` 时给出该开标签开启的模式。 */
  mode?: EjsMode;
}

export interface TokenizeOptions {
  delimiter?: string;
  openDelimiter?: string;
  closeDelimiter?: string;
  /** 对应上游的 `rmWhitespace`（默认 **false**，与上游调用 opts 一致）。 */
  collapseWhitespace?: boolean;
}

export interface Delimiters {
  delimiter: string;
  openDelimiter: string;
  closeDelimiter: string;
}

export function resolveDelimiters(opts: TokenizeOptions = {}): Delimiters {
  return {
    delimiter: opts.delimiter ?? DEFAULT_DELIMITER,
    openDelimiter: opts.openDelimiter ?? DEFAULT_OPEN_DELIMITER,
    closeDelimiter: opts.closeDelimiter ?? DEFAULT_CLOSE_DELIMITER,
  };
}

/** 标准正则元字符转义（对默认定界符 `<` / `>` / `%` 为恒等 —— 与 `ejs.js:1030` 的意图一致）。 */
export function escapeRegExpChars(input: string): string {
  if (!input) return "";
  return String(input).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 对应 `ejs.js:561-570` 的 `createRegex()`。注意：**不带 `g` 标志**（`parseTemplateText` 依赖这一点）。 */
export function createTemplateRegex(delims: Delimiters): RegExp {
  const pattern = REGEX_STRING.replace(/%/g, escapeRegExpChars(delims.delimiter))
    .replace(/</g, escapeRegExpChars(delims.openDelimiter))
    .replace(/>/g, escapeRegExpChars(delims.closeDelimiter));
  return new RegExp(pattern);
}

/**
 * 对应 `ejs.js:796-821` 的 `parseTemplateText()`：把模板切成「字面量段 + 定界符」的交替序列。
 * 该正则无 `g` 标志，`exec` 每次返回**首个**匹配 ⇒ 逐段剥离。
 */
export function parseTemplateText(text: string, regex: RegExp): string[] {
  let rest = text;
  const out: string[] = [];
  let match = regex.exec(rest);
  while (match) {
    const firstPos = match.index;
    if (firstPos !== 0) {
      out.push(rest.substring(0, firstPos));
      rest = rest.slice(firstPos);
    }
    out.push(match[0]);
    rest = rest.slice(match[0].length);
    match = regex.exec(rest);
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * 对应 `ejs.js:743-793` 的**嵌套标签平衡**（本份 ejs.js 的特有实现）。
 *
 * 作用：把「开标签 … 闭标签」之间出现的**嵌套标签**合并成**单个 token**，
 * 使模板里写 `<% const s = "<% x %>" %>` 这类内容时，内层 `<% %>` 被当作普通文本而非新标签。
 *
 * 判定与上游逐字对齐：
 *   - 开标签：`startsWith(open)` 且 **不等于** `open + delimiter`（即排除 `<%%` 字面量开）
 *   - 闭标签：`endsWith(close)` 且 **不等于** `delimiter + close`（即排除 `%%>` 字面量闭）
 */
export function balanceNesting(tokens: string[], delims: Delimiters): string[] {
  const open = delims.openDelimiter + delims.delimiter; // "<%"
  const close = delims.delimiter + delims.closeDelimiter; // "%>"
  const literalOpen = open + delims.delimiter; // "<%%"
  const literalClose = delims.delimiter + close; // "%%>"

  const isOpen = (t: string): boolean => t.startsWith(open) && t !== literalOpen;
  const isClose = (t: string): boolean => t.endsWith(close) && t !== literalClose;

  const processed: string[] = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (isOpen(token)) {
      let nestingLevel = 1;
      const contentBuffer: string[] = [];
      let j = i + 1;
      while (j < tokens.length) {
        const innerToken = tokens[j];
        if (isOpen(innerToken)) {
          nestingLevel++;
        } else if (isClose(innerToken)) {
          nestingLevel--;
          if (nestingLevel === 0) {
            processed.push(token);
            processed.push(contentBuffer.join(""));
            processed.push(innerToken);
            i = j;
            break;
          }
        }
        contentBuffer.push(innerToken);
        j++;
      }
      if (nestingLevel !== 0) {
        throw new Error(`Could not find matching close tag for "${token}".`);
      }
    } else {
      processed.push(token);
    }
    i++;
  }
  return processed;
}

function classify(raw: string, delims: Delimiters): EjsToken {
  const open = delims.openDelimiter + delims.delimiter;
  const close = delims.delimiter + delims.closeDelimiter;
  if (raw === open + delims.delimiter) return { raw, kind: "literal-open" };
  if (raw === delims.delimiter + close) return { raw, kind: "literal-close" };
  if (raw === close || raw === "-" + close || raw === "_" + close) return { raw, kind: "close" };
  if (raw === open) return { raw, kind: "open", mode: "eval" };
  if (raw === open + "_") return { raw, kind: "open", mode: "eval" };
  if (raw === open + "=") return { raw, kind: "open", mode: "escaped" };
  if (raw === open + "-") return { raw, kind: "open", mode: "raw" };
  if (raw === open + "#") return { raw, kind: "open", mode: "comment" };
  return { raw, kind: "text" };
}

/**
 * 模板 → token 串。顺序与上游 `generateSource()` 完全一致：
 *   ① `rmWhitespace`（仅当 `collapseWhitespace`）→ ② `[ \t]*<%_` / `_%>[ \t]*` 预处理
 *   → ③ `parseTemplateText` 切分 → ④ 嵌套标签平衡。
 *
 * ⚠️ 第 ② 步在上游是**硬编码**的（`ejs.js:739-740` 写死 `<%_` / `_%>`，**没有**使用配置的定界符）
 *    —— 为保持逐字节等价，此处**同样硬编码**，并保留该已知限制。
 */
export function tokenize(template: string, opts: TokenizeOptions = {}): EjsToken[] {
  const delims = resolveDelimiters(opts);
  let text = String(template ?? "");

  if (opts.collapseWhitespace) {
    text = text.replace(/[\r\n]+/g, "\n").replace(/^\s+|\s+$/gm, "");
  }
  // 上游硬编码的两处预处理（顺序不可交换）
  text = text.replace(/[ \t]*<%_/gm, "<%_").replace(/_%>[ \t]*/gm, "_%>");

  const regex = createTemplateRegex(delims);
  const rawTokens = parseTemplateText(text, regex);
  const balanced = balanceNesting(rawTokens, delims);
  return balanced.map((raw) => classify(raw, delims));
}
