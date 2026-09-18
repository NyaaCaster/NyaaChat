/**
 * EJS 源生成 —— 上游 `ejs.js` 的 `scanLine` + `compile` 包裹部分。
 *
 * 语义基准：`.ref/ST-Prompt-Template/src/3rdparty/ejs.js`（ejs 3.1.9 改造版）。
 * 规格出处：`.docs/plugin-system/插件开发_EJS-template/EJS技术性说明.md` §2.3 / §2.4 / §3.3。
 *
 * ⚠️ 本文件是 **captain 自办**（t1）——引擎核心（风险 K4）。
 * ⚠️ **不使用 `eval` / `new Function`**：产出的是**函数体源码字符串**，由调用方（carrier）
 *    拼成 `async function anonymous(locals, escapeFn, include, rethrow) { <body> }` 后以
 *    内联 `<script>` 注入执行（普通 script，非 module —— `with` 需要非严格模式）。
 * ⚠️ 本函数**不做** client 模式的 `escapeFn = escapeFn || <src>` 内嵌：调用方**必须**提供
 *    `locals` 与 `escapeFn` 两个实参（`include` / `rethrow` 仅在对应语法出现时才需要）。
 */

import { decodeLiteral, escapeLiteral, stripSemi } from "./escape";
import { type EjsMode, type TokenizeOptions, resolveDelimiters, tokenize } from "./syntax";

export interface CompileOptions extends TokenizeOptions {
  /** 输出函数名（上游固定为 `'print'`，对应 `const print = __append;`）。 */
  outputFunctionName?: string;
  /** locals 形参名（对应 `with (<localsName> || {})`）。 */
  localsName?: string;
  /** 是否用 `with` 展开 locals（对应上游 `_with`，默认 **true**）。 */
  withContext?: boolean;
  /**
   * 是否生成调试包裹（`var __line` + `try/catch` + `rethrow(...)`）。
   * 上游默认 **true**；本实现默认 **false**（运行时省体积；`__line` 赋值不影响输出，
   * 故对 P1 的「逐字节等于黄金基准」无影响）。
   */
  compileDebug?: boolean;
  /** 仅语义提示：`await` 是否可用由**调用方**决定（本函数不生成 function 声明，故不改变 body）。 */
  async?: boolean;
  /** 调试用：文件名（仅在 `compileDebug` 且非空时进入 `__filename`）。 */
  filename?: string;
}

export interface CompiledSource {
  /** 函数体源码（不含 `function` 关键字与参数表）。 */
  body: string;
  /** 模板指纹（FNV-1a 32bit，确定性、纯 JS）—— 供载体按模板缓存已编译函数。 */
  templateHash: string;
}

/** 与 `ejs.js:69` 一致的 JS 标识符校验（含 Unicode ID_Start/ID_Continue）。 */
const JS_IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$_]*$/u;

const DEFAULT_OUTPUT_FUNCTION_NAME = "print";
const DEFAULT_LOCALS_NAME = "locals";

/**
 * **本插件刻意不支持**的 EJS 内建调用 —— 照抄 js-slash-runner 的 D9 纪律：
 * **显式抛错，绝不静默返回 undefined**（否则模板会产出静默错误的文本）。
 *
 * `include` 需要文件系统；上游 client 模式本就不提供它（模板调用会 `ReferenceError`）。
 */
export const UNSUPPORTED_CALLS: readonly string[] = ["include"];

/** FNV-1a 32bit —— 确定性、无依赖（不用 crypto，浏览器可用）。 */
export function hashTemplate(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * 把模板编译成**函数体源码**。
 *
 * 生成顺序与上游 `compile()` 逐字对齐（`ejs.js:587-624`）：
 *   prepended（`__output` / `__append` / `const <outputFn>` / `with (...) {`）
 *   + `scanLine` 逐 token 产物
 *   + appended（`}` / `return __output;`）
 */
export function compileTemplate(template: string, opts: CompileOptions = {}): CompiledSource {
  const delims = resolveDelimiters(opts);
  const outputFunctionName = opts.outputFunctionName ?? DEFAULT_OUTPUT_FUNCTION_NAME;
  const localsName = opts.localsName ?? DEFAULT_LOCALS_NAME;
  const withContext = opts.withContext !== false;
  const compileDebug = opts.compileDebug === true;
  const text = String(template ?? "");

  if (!JS_IDENTIFIER.test(outputFunctionName)) {
    throw new Error("outputFunctionName is not a valid JS identifier.");
  }
  if (!JS_IDENTIFIER.test(localsName)) {
    throw new Error("localsName is not a valid JS identifier.");
  }

  const open = delims.openDelimiter + delims.delimiter; // "<%"
  const close = delims.delimiter + delims.closeDelimiter; // "%>"
  const literalOpen = open + delims.delimiter; // "<%%"
  const literalClose = delims.delimiter + close; // "%%>"

  const tokens = tokenize(text, opts);

  // ── scanLine 等价：逐 token 生成 ────────────────────────────────────────────
  let source = "";
  let mode: EjsMode | null = null;
  let truncate = false;
  let currentLine = 1;

  /** 对应 `ejs.js:823-848` 的 `_addOutput()`。 */
  const addOutput = (line: string): void => {
    let out = line;
    if (truncate) {
      // 只吃掉**紧跟的一个**换行（`-%>` / `_%>` 的语义）
      out = out.replace(/^(?:\r\n|\r|\n)/, "");
      truncate = false;
    }
    if (!out) return;
    out = escapeLiteral(out);
    source += `    ; __append("${out}")\n`;
  };

  for (const token of tokens) {
    const line = token.raw;
    const newLineCount = line.split("\n").length - 1;

    switch (line) {
      case open:
      case `${open}_`:
        mode = "eval";
        break;
      case `${open}=`:
        mode = "escaped";
        break;
      case `${open}-`:
        mode = "raw";
        break;
      case `${open}#`:
        mode = "comment";
        break;
      case literalOpen:
        mode = "literal";
        source += `    ; __append("${decodeLiteral(line)}")\n`;
        break;
      case literalClose:
        mode = "literal";
        source += `    ; __append("${decodeLiteral(line)}")\n`;
        break;
      case close:
      case `-${close}`:
      case `_${close}`:
        if (mode === "literal") addOutput(line);
        mode = null;
        truncate = line.indexOf("-") === 0 || line.indexOf("_") === 0;
        break;
      default:
        if (mode) {
          // `//` 出现在最后一个换行之后 ⇒ 补一个换行，防止行注释吞掉后续生成代码（`ejs.js:899-901`）
          let code = line;
          if (mode === "eval" || mode === "escaped" || mode === "raw") {
            if (code.lastIndexOf("//") > code.lastIndexOf("\n")) code += "\n";
            assertSupportedCall(code);
          }
          switch (mode) {
            case "eval":
              source += `    ; ${code}\n`;
              break;
            case "escaped":
              source += `    ; __append(escapeFn(${stripSemi(code)}))\n`;
              break;
            case "raw":
              source += `    ; __append(${stripSemi(code)})\n`;
              break;
            case "comment":
              break;
            case "literal":
              addOutput(code);
              break;
          }
        } else {
          addOutput(line);
        }
    }

    if (compileDebug && newLineCount) {
      currentLine += newLineCount;
      source += `    ; __line = ${currentLine}\n`;
    }
  }

  // ── 编译包裹（`ejs.js:589-624`）─────────────────────────────────────────────
  let body = "";
  body += '  var __output = "";\n';
  body +=
    "  function __append(...args) { args.filter(x => x !== undefined && x !== null).forEach(s => __output += s) }\n";
  body += `  const ${outputFunctionName} = __append;\n`;
  if (withContext) body += `  with (${localsName} || {}) `;
  body += " {\n";
  body += source;
  body += "  }\n";
  body += "  return __output;\n";

  if (compileDebug) {
    const filename = opts.filename ? JSON.stringify(opts.filename) : "undefined";
    body =
      "var __line = 1\n" +
      `  , __lines = ${JSON.stringify(text)}\n` +
      `  , __filename = ${filename};\n` +
      "try {\n" +
      body +
      "} catch (e) {\n" +
      "  rethrow(e, __lines, __filename, __line, escapeFn);\n" +
      "}\n";
  }

  return { body, templateHash: hashTemplate(text) };
}

/** 未支持调用的静态检测（保守：只在 EJS 代码块内扫描，仍可能误报字符串字面量）。 */
function assertSupportedCall(code: string): void {
  for (const name of UNSUPPORTED_CALLS) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(code)) {
      throw new Error(
        `EJS \`${name}()\` is not supported in NyaaChat (NG: no file-system include). ` +
          `Remove \`${name}(...)\` from the template block.`,
      );
    }
  }
}
