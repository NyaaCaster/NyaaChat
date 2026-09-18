/**
 * EJS 引擎工具层 —— 转义 / 去尾分号 / 字面量编解码（**纯函数、零依赖**）。
 *
 * 语义基准是**上游改造版 ejs.js**（`.ref/ST-Prompt-Template/src/3rdparty/ejs.js`，
 * ejs 3.1.9 + ST 叠加），即 SSOT §3「自实现一律以本份为准」所指的那一份。逐项对应：
 *
 * | 本文件导出 | ejs.js 出处 | 用途 |
 * |---|---|---|
 * | `escapeXML` | `:1038-1045`、`:1085-1090` | `<%= expr %>` 的 `escapeFn`（源生成 `:910`） |
 * | `stripSemi` | `:365-367` | `__append(expr;)` 会语法错 ⇒ 生成前去掉末尾分号（`:910` / `:914`） |
 * | `escapeLiteral` | `_addOutput` 的字面量转义段 `:837-846` | 字面量文本 → `__append("…")` 里的字符串内容 |
 * | `decodeLiteral` | `scanLine` 的 LITERAL 分支 `:873-880` | `<%%` → `<%`、`%%>` → `%>` |
 *
 * 纪律（SSOT §3.2）：不 import 任何宿主模块 / lodash；不使用 `eval` / `new Function`；
 * 不做超出上游语义的"顺手改进"（任何行为差异都会让 P0 黄金基准逐字节比对失败）。
 *
 * ⚠️ **`escapeXML` 必须保持"源码自包含"**：载体（`host/carrier.ts`）会把本函数的
 * `toString()` 源码内联进 srcdoc 的普通 `<script>` 里当 `escapeFn`，因此该函数体内
 * **不得引用任何模块级常量/其它模块符号**（上游 `escapeFuncStr`（`:1060-1071`）同理）。
 */

/**
 * Escape characters reserved in XML.
 *
 * 匹配集为上游 `_MATCH_HTML = /[&<>'"]/g`（`:1045`）的 5 个字符；该正则**刻意内联**在
 * 函数体内（不外提模块级常量），见文件头的"源码自包含"约束。
 *
 * 上游 `_ENCODE_HTML_RULES`（`:1038-1044`）逐字：
 * `&`→`&amp;`、`<`→`&lt;`、`>`→`&gt;`、`"`→`&#34;`、`'`→`&#39;`
 * —— 注意 `"` / `'` 是**数字实体** `&#34;` / `&#39;`，不是 `&quot;` / `&apos;`。
 *
 * 入参 `undefined` / `null` ⇒ 返回空串（上游 `markup == undefined ? '' : …`，
 * 松散相等同时覆盖 `null`）。**其余 falsy 值照常字符串化**：`escapeXML(0) === "0"`、
 * `escapeXML(false) === "false"`、`escapeXML("") === ""` —— 不得写成省略真值判断。
 *
 * @param value 任意值（非字符串按 `String()` 处理）
 * @returns 转义后的字符串；`undefined` / `null` 返回 `""`
 */
export function escapeXML(value: unknown): string {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).replace(/[&<>'"]/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&#34;";
      default:
        // 正则只可能匹配到 `'`
        return "&#39;";
    }
  });
}

/**
 * 去掉**末尾**分号（上游 `:365-367` 逐字）：
 *
 * ```js
 * function stripSemi(str){ return str.replace(/;(\s*$)/, '$1'); }
 * ```
 *
 * 只处理"分号 + 其后的全部空白 + 串尾"这一种形态：`;` 后面的空白被保留（`$1`），
 * 中间或行首的分号不动。目的是让 `<%= foo(); %>` / `<%- bar(); %>` 生成
 * `__append(escapeFn(foo()))` 而不是 `__append(escapeFn(foo();))`（`:910` / `:914`）。
 *
 * @param input 待处理的表达式源码
 * @returns 末尾分号（含其后空白之前的分号）被移除的源码
 */
export function stripSemi(input: string): string {
  return input.replace(/;(\s*)$/, "$1");
}

/**
 * 字面量转义 —— 把字面量文本变成可以安全放进 `__append("…")` 双引号里的内容
 * （上游 `_addOutput`，`:837-846`）。
 *
 * **顺序不可交换**（`\` 必须最先，否则会把后面几步新引入的反斜杠再翻倍）：
 *
 * ```
 * 1. \\ → \\\\   （保留字面量里的单个反斜杠）
 * 2. \n → \\n     （真实换行 → 两字符转义序列）
 * 3. \r → \\r
 * 4. "  → \"      （双引号是执行期的字符串定界符）
 * ```
 *
 * 例：`a\b"c` + LF ⇒ `a\\b\"c\n`（进入生成源码后仍能还原为原文本）。
 *
 * @param input 字面量文本（含真实换行）
 * @returns 可嵌入双引号字符串的转义结果
 */
export function escapeLiteral(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/"/g, '\\"');
}

/**
 * 字面量还原 —— LITERAL 模式下把转义写法还原为其字面含义
 * （上游 `scanLine` 的 `:875` / `:879`，`line.replace('<%%', '<%')` /
 * `line.replace('%%>', '%>')`）。
 *
 * 上游是对**单个定界符 token** 做首次替换；本函数对整个输入做全局替换 ——
 * 对 token 场景两者结果完全一致（token 内该模式至多出现一次），同时对多段文本也正确。
 *
 * @param input 可能含 `<%%` / `%%>` 的文本
 * @returns `<%%` → `<%`、`%%>` → `%>` 之后的文本
 */
export function decodeLiteral(input: string): string {
  return input.replace(/<%%/g, "<%").replace(/%%>/g, "%>");
}
