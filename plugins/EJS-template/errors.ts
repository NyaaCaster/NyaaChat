/**
 * ejs-template —— 错误归类与用户可读文案（SSOT `开发计划-SSOT.md` §2.7 / D11 / K3）
 *
 * 职责：把 EJS 渲染链上任意一环抛出的异常，收敛成 **用户可读、含定位信息** 的
 * `{ title, detail }`，供最小 UI（P5，`EjsTemplateSettings.tsx`）与
 * `pluginLogger`（`src/plugins/pluginLog.ts`）展示。
 *
 * 【三条硬纪律】
 * 1. **零依赖**：本文件不 `import` 任何宿主模块（`src/**`），也不 import 插件内其它模块。
 *    依赖方向只允许「别人 import 本文件」—— 它是叶子。
 * 2. **不回显模板原文**：原因只取错误信息的 **首个非空行**（`rethrow` 的 `>>` 标记行另作
 *    "位置"行、单独截断），两者都先剥离 `<% … %>` 片段再按字符数上限截断。138K 字符的
 *    条目正文永远不会被写进日志或界面（§2.7）。
 * 3. **自身不抛错**：`describeEjsError` 在任何输入下都必须返回（降级路径上不允许
 *    「格式化错误」再抛一次）。
 *
 * 【为什么把未实现符号清单放在这里】D11 要求「照抄 JSR D9：显式抛错 + UI 可见」，
 * 而 env 桥（`host/env.ts`）与载体（`host/carrier.ts`）都要用到同一份清单与同一套文案。
 * 清单是**唯一权威副本**（SSOT §6 / `EJS技术性说明.md` §4.3），改这里即改全链。
 *
 * 依据：`开发计划-SSOT.md` §2.7、§6、§8、§11；`EJS技术性说明.md` §4.3、§6.3、§7；
 *      `EJS本地自测方法.md` §3（O7）、§4、§8（`lastError`）。
 */

/** 插件 id（与 `plugin.tsx` 的 `meta.id`、`plugins/registry.ts` 的注册名一致） */
export const EJS_PLUGIN_ID = "ejs-template";

// ────────────────────────────────────────────────────────────────────────────
// 类型
// ────────────────────────────────────────────────────────────────────────────

/** 出错阶段（决定文案措辞与排查方向） */
export type EjsErrorPhase = "env" | "compile" | "runtime" | "timeout" | "carrier" | "unknown";

export const EJS_ERROR_CODES = {
  /** 调用了未实现的符号（D11：显式抛错，绝不静默返回 undefined） */
  UNIMPLEMENTED_SYMBOL: "EJS_UNIMPLEMENTED_SYMBOL",
  /** 编译期：定界符扫描 / 源生成产出的源码非法 */
  COMPILE: "EJS_COMPILE_ERROR",
  /** 运行期：模板体执行抛错（模板自身的 JS 逻辑） */
  RUNTIME: "EJS_RUNTIME_ERROR",
  /** 载体超时软上限（按条目降级） */
  TIMEOUT: "EJS_TIMEOUT_ERROR",
  /** env 快照组装失败（宿主 API 不可用等） */
  ENV: "EJS_ENV_ERROR",
  /** 载体本身异常（注入失败 / 握手失败 / iframe 被销毁） */
  CARRIER: "EJS_CARRIER_ERROR",
} as const;

export type EjsErrorCode = (typeof EJS_ERROR_CODES)[keyof typeof EJS_ERROR_CODES];

/**
 * 调用方提供的定位信息。
 *
 * **前三个字段是 t8 的冻结契约**（`开发计划-SSOT.md` 的 P5 任务描述逐字给出：
 * `ctx: { entryName: string; entryId?: string; symbol?: string }`）——
 * 只做"只放不缩"的放宽（`entryId` 收 `string | number`、`symbolName` 作为 `symbol` 的别名），
 * 不改变任何契约调用的写法。其余字段是可选的定位/规模扩展。
 */
export interface EjsErrorContext {
  /** 条目名（`comment` / `name`）—— 契约必填：文案必须能指出"哪一条" */
  entryName: string;
  /** 条目 id / 序号（可读定位，如 `book[9]`）—— 契约字段 */
  entryId?: string | number;
  /** 符号名（未实现符号，或宿主 API 名）—— 契约字段，env 桥/载体按它点名 */
  symbol?: string;
  /** `symbol` 的等价别名（二者取先出现者） */
  symbolName?: string;
  /** 出错阶段（不传则按 code / 错误信息推断） */
  phase?: EjsErrorPhase;
  /** 第几个 EJS 块（1 起） */
  blockIndex?: number;
  /** 模板内的行号（1 起，载体/引擎换算后给出） */
  line?: number;
  /** 模板字符数 —— 只报数字，不回显原文 */
  templateChars?: number;
}

/** 工厂与内部函数用的宽松定位（把契约字段全部可选化，便于"先抛错、后补条目名"） */
export type EjsErrorLocation = Partial<EjsErrorContext>;

/** 可跨 `postMessage` 传的扁平错误载荷（Error 实例过不了结构化克隆的自定义字段） */
export interface EjsErrorPayload {
  name: typeof EJS_PLUGIN_ID;
  code: EjsErrorCode;
  phase: EjsErrorPhase;
  message: string;
  symbolName?: string;
  entryName?: string;
}

/** `describeEjsError` 的返回值（UI / 日志的唯一消费形态） */
export interface EjsErrorDescription {
  /** 单行标题：含条目名 + 首行原因（或符号名） */
  title: string;
  /** 多行详情：条目 / 符号 / 阶段 / 定位 / 原因 / 提示 / 处置 */
  detail: string;
}

// ────────────────────────────────────────────────────────────────────────────
// 未实现符号清单（唯一权威副本）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 未实现的 ST / 酒馆助手符号 —— 调用即显式抛错。
 *
 * 来源：`EJS技术性说明.md` §4.3（上游 `[ejs.ts]:30-60` / `:215-309` 约 60 个键）与
 *       SSOT §6 的未实现清单（含两条"逃生门"：`execute` / `SillyTavern`）。
 *
 * ⚠️ 只增不减，且**不得**为了让某个模板"跑起来"而临时放开：静默返回 `undefined`
 *    会让模板产出静默错误的提示词（D11 的全部意义就在这里）。
 *
 * ⚠️ 本数组是**全插件的运行时权威**：`host/env.ts` 不再另抄一份，而是
 *    `import { UNIMPLEMENTED_EJS_SYMBOLS } from "../errors"` 后**原样再导出**为
 *    `UNIMPLEMENTED_ENV_SYMBOLS`（同一数组引用；核对时点为 `host/env.ts` 的 import/再导出处，
 *    行号随该文件编辑漂移，**以符号名为准**）；`host/carrier.ts` 又用它重建"快照被结构化克隆、
 *    桩被丢掉"时的抛错桩表（`buildUnimplementedTable`）⇒ 增删一项必须在本文件改，且只改这里。
 */
export const UNIMPLEMENTED_EJS_SYMBOLS: readonly string[] = [
  // 读其它对象/预设（NyaaChat 无对应物）
  "getchr",
  "getchar",
  "getprp",
  "getpreset",
  "getqr",
  "getQuickReply",
  "activewi",
  // 写提示词 / 触发执行
  "execute",
  "injectPrompt",
  "getPromptsInjected",
  // 扩展自身能力
  "define",
  "evalTemplate",
  "findVariables",
  "activateRegex",
  // 聊天消息访问
  "getChatMessage",
  "getChatMessages",
  "matchChatMessages",
  // 变量 schema / YAML 注解 / JSON 补丁
  "applyVarYamlAnnotate",
  "setVariableSchema",
  "jsonPatch",
  "parseJSON",
  // 其它生态全局
  "SillyTavern",
  "faker",
  "toastr",
  "z",
  // jQuery：上游 ST 的**页面全局**。NyaaChat 的 jQuery 只注入 JSR 的 script-host iframe
  // （`src/plugins/scriptHostImpl.ts:221` 的 `/vendor/script-host/jquery.min.js`），
  // EJS 载体**不注入**；SSOT §6 也已把 `$` 归入未实现 ⇒ 保持抛错（5 卡 0 命中）。
  // 若未来某张卡确实需要，正确路线是把**同一份 vendor 产物**注入载体（不自造假 `$`），且先走范围评审。
  "$",
  // 上游 client 模式下同样不存在（调用即 ReferenceError，这里统一为显式抛错）
  "include",
];

/** 是否属于"未实现符号"清单（env 桥与载体都能用它构造抛错代理） */
export function isUnimplementedEjsSymbol(name: string): boolean {
  return UNIMPLEMENTED_EJS_SYMBOLS.indexOf(name) !== -1;
}

// ────────────────────────────────────────────────────────────────────────────
// 标记错误类型
// ────────────────────────────────────────────────────────────────────────────

export interface EjsTemplateErrorOptions {
  code: EjsErrorCode;
  phase?: EjsErrorPhase;
  symbolName?: string;
  entryName?: string;
}

/** 带 `code` / `phase` / `symbolName` 的插件自有错误 —— `describeEjsError` 识别它 */
export class EjsTemplateError extends Error {
  readonly code: EjsErrorCode;
  readonly phase: EjsErrorPhase;
  readonly symbolName?: string;
  readonly entryName?: string;

  constructor(message: string, options: EjsTemplateErrorOptions) {
    super(message);
    this.name = "EjsTemplateError";
    this.code = options.code;
    this.phase = options.phase ?? codeToPhase(options.code);
    this.symbolName = options.symbolName;
    this.entryName = options.entryName;
  }

  /** 供载体 → 宿主跨 `postMessage` 传递 */
  toPayload(): EjsErrorPayload {
    const payload: EjsErrorPayload = {
      name: EJS_PLUGIN_ID,
      code: this.code,
      phase: this.phase,
      message: this.message,
    };
    if (this.symbolName) payload.symbolName = this.symbolName;
    if (this.entryName) payload.entryName = this.entryName;
    return payload;
  }
}

export function isEjsTemplateError(err: unknown): err is EjsTemplateError {
  return err instanceof EjsTemplateError;
}

// ────────────────────────────────────────────────────────────────────────────
// 工厂（env 桥 / 引擎 / 载体统一用它抛错，保证文案与归类收敛到一处）
// ────────────────────────────────────────────────────────────────────────────

/** 未实现符号：文案含**符号名**（O7 / V8 的判据） */
export function ejsUnimplementedSymbolError(
  symbolName: string,
  ctx?: EjsErrorLocation,
): EjsTemplateError {
  return new EjsTemplateError(`未实现的 EJS 符号：${symbolName}`, {
    code: EJS_ERROR_CODES.UNIMPLEMENTED_SYMBOL,
    symbolName,
    entryName: ctx?.entryName,
  });
}

export function ejsCompileError(message: string, ctx?: EjsErrorLocation): EjsTemplateError {
  return new EjsTemplateError(message, {
    code: EJS_ERROR_CODES.COMPILE,
    entryName: ctx?.entryName,
  });
}

export function ejsRuntimeError(message: string, ctx?: EjsErrorLocation): EjsTemplateError {
  return new EjsTemplateError(message, {
    code: EJS_ERROR_CODES.RUNTIME,
    symbolName: ctx?.symbolName,
    entryName: ctx?.entryName,
  });
}

export function ejsTimeoutError(message: string, ctx?: EjsErrorLocation): EjsTemplateError {
  return new EjsTemplateError(message, {
    code: EJS_ERROR_CODES.TIMEOUT,
    entryName: ctx?.entryName,
  });
}

export function ejsEnvError(message: string, ctx?: EjsErrorLocation): EjsTemplateError {
  return new EjsTemplateError(message, {
    code: EJS_ERROR_CODES.ENV,
    symbolName: ctx?.symbolName,
    entryName: ctx?.entryName,
  });
}

export function ejsCarrierError(message: string, ctx?: EjsErrorLocation): EjsTemplateError {
  return new EjsTemplateError(message, {
    code: EJS_ERROR_CODES.CARRIER,
    entryName: ctx?.entryName,
  });
}

/** 载体侧：把任意异常拍成可 `postMessage` 的载荷（不携带模板原文） */
export function toEjsErrorPayload(err: unknown, ctx?: EjsErrorLocation): EjsErrorPayload {
  const info = analyze(err, ctx);
  const payload: EjsErrorPayload = {
    name: EJS_PLUGIN_ID,
    code: info.code,
    phase: info.phase,
    message: info.reason || info.rawMessage || "未知错误",
  };
  if (info.symbolName) payload.symbolName = info.symbolName;
  if (info.entryName) payload.entryName = info.entryName;
  return payload;
}

/** 宿主侧：把载荷还原成错误对象（保持与直接抛错完全同构） */
export function fromEjsErrorPayload(payload: EjsErrorPayload): EjsTemplateError {
  return new EjsTemplateError(payload.message, {
    code: payload.code,
    phase: payload.phase,
    symbolName: payload.symbolName,
    entryName: payload.entryName,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// 文案生成（唯一出口）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 主入口：异常 → `{ title, detail }`。
 *
 * **冻结契约（t8，勿改）**：
 * ```ts
 * describeEjsError(err: unknown, ctx: { entryName: string; entryId?: string; symbol?: string })
 *   : { title: string; detail: string }
 * ```
 * 实现上只做"只放不缩"：`ctx` 可省（无条目名时退化为「某个条目」）、`entryId` 收 `string | number`、
 * 另接受 `symbolName` 等价别名与 `phase` / `blockIndex` / `line` / `templateChars` 等可选定位。
 *
 * - 未实现符号（`ctx.symbol` / 清单命中 / 错误串点名）⇒ title/detail **都**含符号名与条目名；
 * - 编译/运行错 ⇒ 含条目名 + **首行原因**；
 * - 一律不回显整段模板（见文件头纪律 2）。
 *
 * 本函数**不抛错**，也不会返回空串。
 */
export function describeEjsError(err: unknown, ctx?: EjsErrorContext): EjsErrorDescription {
  try {
    const info = analyze(err, ctx);
    const entryLabel = info.entryName
      ? `条目「${clipText(info.entryName, MAX_ENTRY_NAME_CHARS)}」`
      : "某个条目";

    let title: string;
    if (info.unimplemented) {
      title = info.symbolName
        ? `${entryLabel}调用了未实现的符号 ${info.symbolName}`
        : `${entryLabel}调用了未实现的符号`;
    } else if (info.phase === "timeout") {
      title = `模板超时：${entryLabel}渲染超时（已按条目降级）`;
    } else if (info.phase === "carrier") {
      title = `载体错误：${entryLabel}渲染失败`;
    } else {
      title = `模板错误：${entryLabel}渲染失败`;
    }
    if (isInformativeReason(info.reason) && info.phase !== "timeout") {
      // 未实现符号已在标题里点名，不再重复一遍「未实现的 EJS 符号：getchr」
      const duplicatesSymbol =
        info.unimplemented && !!info.symbolName && info.reason.indexOf(info.symbolName) !== -1;
      if (!duplicatesSymbol) title += ` — ${info.reason}`;
    }

    const lines: string[] = [];
    lines.push(
      info.entryName
        ? `条目：${clipText(info.entryName, MAX_ENTRY_NAME_CHARS)}${info.entryId ? `（${info.entryId}）` : ""}`
        : "条目：（名称未知 —— 调用方应传 ctx.entryName）",
    );
    if (info.symbolName) {
      lines.push(
        info.unimplemented
          ? `符号：${info.symbolName}（未实现 ⇒ 显式抛错，不静默返回 undefined）`
          : `标识符：${info.symbolName}`,
      );
    }
    lines.push(`阶段：${EJS_ERROR_PHASE_LABELS[info.phase]}`);
    const located = describeLocation(info);
    if (located) lines.push(`定位：${located}`);
    if (typeof info.templateChars === "number" && info.templateChars > 0) {
      lines.push(`模板：${info.templateChars} 字符（一律不回显原文）`);
    }
    lines.push(`原因：${info.reason || "未知错误"}`);
    if (info.contextLine) lines.push(`位置：${info.contextLine}`);
    if (info.hint) lines.push(`提示：${info.hint}`);
    lines.push(
      "处置：该条目本轮已丢弃（原文不进请求），其余条目不受影响，生成不被阻断（K3 按条目降级）。",
    );

    return { title: clipText(title, MAX_TITLE_CHARS), detail: clipText(lines.join("\n"), MAX_DETAIL_CHARS, false) };
  } catch {
    return {
      title: "模板错误：条目渲染失败（错误文案生成失败）",
      detail: "原因：错误文案自身抛出异常。\n处置：该条目本轮已丢弃，其余条目不受影响（K3）。",
    };
  }
}

/** 单行摘要（给 `pluginLogger` / UI 的「最近一次错误」用；等价于 `describeEjsError(...).title`） */
export function formatEjsErrorLine(err: unknown, ctx?: EjsErrorContext): string {
  const title = describeEjsError(err, ctx).title;
  const reason = ejsErrorReason(err);
  if (!isInformativeReason(reason) || title.indexOf(reason) !== -1) return title;
  // 未实现符号已按符号名点名，不再补一条同义的原因
  if (/未实现/.test(reason)) {
    const info = analyze(err, ctx);
    if (info.symbolName && title.indexOf(info.symbolName) !== -1) return title;
  }
  return `${title} ｜ 原因：${reason}`;
}

/**
 * 首行原因（已剥离模板片段并截断）—— 单独导出，便于自测脚本直接断言
 * 「文案含 getchr」/「文案含首行原因」而不必解析 detail。
 */
export function ejsErrorReason(err: unknown): string {
  return analyze(err, undefined).reason;
}

// ────────────────────────────────────────────────────────────────────────────
// 内部实现
// ────────────────────────────────────────────────────────────────────────────

const MAX_ENTRY_NAME_CHARS = 80;
const MAX_REASON_CHARS = 240;
const MAX_CONTEXT_CHARS = 160;
const MAX_TITLE_CHARS = 200;
const MAX_DETAIL_CHARS = 1200;

export const EJS_ERROR_PHASE_LABELS: Readonly<Record<EjsErrorPhase, string>> = {
  env: "环境准备",
  compile: "编译期（定界符扫描 / 源生成）",
  runtime: "运行期（模板体执行）",
  timeout: "超时（软上限）",
  carrier: "执行载体（srcdoc iframe）",
  unknown: "未知阶段",
};

function codeToPhase(code: EjsErrorCode): EjsErrorPhase {
  switch (code) {
    case EJS_ERROR_CODES.UNIMPLEMENTED_SYMBOL:
      return "runtime";
    case EJS_ERROR_CODES.COMPILE:
      return "compile";
    case EJS_ERROR_CODES.RUNTIME:
      return "runtime";
    case EJS_ERROR_CODES.TIMEOUT:
      return "timeout";
    case EJS_ERROR_CODES.ENV:
      return "env";
    case EJS_ERROR_CODES.CARRIER:
      return "carrier";
    default:
      return "unknown";
  }
}

/** 常见失败模式 → 排查方向（取自 `EJS本地自测方法.md` §4 的失败对照表） */
const REASON_HINTS: ReadonlyArray<{ test: RegExp; hint: string }> = [
  {
    test: /with statement/i,
    hint:
      "注入脚本必须用普通 <script>（非 module）：with 在严格模式下非法（自测方法 §2.2）",
  },
  {
    test: /unsafe-eval|EvalError|Content Security Policy/i,
    hint:
      "疑似整包引入了上游 ejs.js（模块加载期 new Function）：自实现路径只能取源码字符串、用普通 script 注入（§3.8 / D5）",
  },
  {
    test: /is not defined/i,
    hint: "该标识符不在 env 快照里（本插件只提供 7 个符号 + lodash 9 函数）",
  },
  {
    test: /Unexpected token|Unexpected end of input|Invalid or unexpected token|missing \)/i,
    hint: "源生成缺陷，核对 M3（逐模式源生成）与 M4（stripSemi + // 补换行）",
  },
  {
    test: /Cannot read propert|null is not an object|undefined is not an object/i,
    hint: "模板读了未定义对象的属性，先核对 env 快照是否齐备",
  },
  { test: /\binclude\b/i, hint: "include() 在上游 client 模式下同样不存在 ⇒ 按 NG 显式抛错" },
  {
    test: /宿主\s*(API|门面)|快照|环境/,
    hint:
      "宿主门面 getScriptHostApi() 每次渲染时取用（D8：禁止在 setup 期缓存；setup 早于门面注入）",
  },
  {
    test: /超时|timeout/i,
    hint:
      "载体软上限触发（按条目降级）；真正的死循环无法被同事件循环的计时器打断，见 README 的 K1",
  },
];

interface ErrorInfo {
  code: EjsErrorCode;
  phase: EjsErrorPhase;
  entryName?: string;
  entryId?: string | number;
  symbolName?: string;
  reason: string;
  /** `rethrow` 的 `>>` 标记行（与首行原因不同时才有值）—— 只作"第几行"的定位 */
  contextLine?: string;
  rawMessage: string;
  hint?: string;
  templateChars?: number;
  blockIndex?: number;
  line?: number;
  unimplemented: boolean;
}

function analyze(err: unknown, ctx?: EjsErrorLocation): ErrorInfo {
  const rawMessage = rawMessageOf(err);
  const declaredCode = readString(err, "code");
  const code = isKnownCode(declaredCode) ? declaredCode : inferCode(err, rawMessage);
  const phase =
    ctx?.phase ?? readPhase(err) ?? codeToPhase(code);

  const entryName =
    firstNonEmpty(readString(err, "entryName"), ctx?.entryName) ?? undefined;
  const entryId = ctx?.entryId ?? readEntryId(err);
  const symbolName =
    firstNonEmpty(
      ctx?.symbol,
      ctx?.symbolName,
      readString(err, "symbol"),
      readString(err, "symbolName"),
      extractSymbolName(rawMessage),
    ) ?? undefined;

  const unimplemented =
    code === EJS_ERROR_CODES.UNIMPLEMENTED_SYMBOL ||
    (!!symbolName && isUnimplementedEjsSymbol(symbolName)) ||
    /未实现|not implemented|unimplemented/i.test(rawMessage);

  const reason = reasonOf(err, rawMessage);
  const contextLine = contextLineOf(rawMessage, reason);
  const hintEntry = REASON_HINTS.find((h) => h.test.test(rawMessage) || h.test.test(reason));

  return {
    code: unimplemented && code === EJS_ERROR_CODES.RUNTIME ? EJS_ERROR_CODES.UNIMPLEMENTED_SYMBOL : code,
    phase: unimplemented && phase === "unknown" ? "runtime" : phase,
    entryName,
    entryId,
    symbolName,
    reason,
    contextLine,
    rawMessage,
    hint: hintEntry?.hint,
    templateChars: ctx?.templateChars,
    blockIndex: ctx?.blockIndex,
    line: ctx?.line ?? extractRethrowLine(rawMessage),
    unimplemented,
  };
}

function inferCode(err: unknown, message: string): EjsErrorCode {
  const name = readString(err, "name") ?? "";
  if (/SyntaxError/i.test(name) || /SyntaxError|Unexpected token|Unexpected end of input/i.test(message)) {
    return EJS_ERROR_CODES.COMPILE;
  }
  if (/超时|timeout/i.test(message)) return EJS_ERROR_CODES.TIMEOUT;
  if (/TypeError|ReferenceError|RangeError/i.test(name) || /is not defined/i.test(message)) {
    return EJS_ERROR_CODES.RUNTIME;
  }
  if (/载体|iframe|srcdoc|postMessage/i.test(message)) return EJS_ERROR_CODES.CARRIER;
  if (/env|快照|宿主\s*(API|门面)/i.test(message)) return EJS_ERROR_CODES.ENV;
  return EJS_ERROR_CODES.RUNTIME;
}

function describeLocation(info: ErrorInfo): string | undefined {
  const parts: string[] = [];
  if (typeof info.blockIndex === "number") parts.push(`第 ${info.blockIndex} 个 EJS 块`);
  if (typeof info.line === "number") parts.push(`模板第 ${info.line} 行`);
  return parts.length ? parts.join(" · ") : undefined;
}

// ── 取值助手（全部防御式：任何输入都不得抛错）────────────────────────────────

function readString(err: unknown, key: string): string | undefined {
  const value = readField(err, key);
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readField(err: unknown, key: string): unknown {
  if (err && (typeof err === "object" || typeof err === "function")) {
    try {
      return (err as Record<string, unknown>)[key];
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function readEntryId(err: unknown): string | number | undefined {
  const value = readField(err, "entryId") ?? readField(err, "ruleId");
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

function readPhase(err: unknown): EjsErrorPhase | undefined {
  const value = readString(err, "phase");
  return value === "env" ||
    value === "compile" ||
    value === "runtime" ||
    value === "timeout" ||
    value === "carrier" ||
    value === "unknown"
    ? value
    : undefined;
}

function isKnownCode(value: string | undefined): value is EjsErrorCode {
  return (
    value === EJS_ERROR_CODES.UNIMPLEMENTED_SYMBOL ||
    value === EJS_ERROR_CODES.COMPILE ||
    value === EJS_ERROR_CODES.RUNTIME ||
    value === EJS_ERROR_CODES.TIMEOUT ||
    value === EJS_ERROR_CODES.ENV ||
    value === EJS_ERROR_CODES.CARRIER
  );
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((v) => typeof v === "string" && v.length > 0);
}

function rawMessageOf(err: unknown): string {
  if (typeof err === "string") return err;
  const message = readField(err, "message");
  if (typeof message === "string" && message.length > 0) return message;
  if (err === undefined || err === null) return "";
  try {
    return String(err);
  } catch {
    return "";
  }
}

/**
 * 原因：模板错误信息的**第一个非空行**。
 *
 * ⚠️ 但上游 `rethrow`（`[ejs.js]:341-363`，M12 要求复刻）会把消息改写成
 * `文件名:行号\n±3 行上下文（其中一行带 ' >> ' 前缀）\n\n<原始 err.message>` ——
 * 此时首个非空行只是**定位**（`ejs:2`），真正的原因在末尾 ⇒ 先按该形态还原。
 *
 * ⚠️ **永不**取 `err.stack`（既有模板原文，又可能几十 KB）。
 */
function reasonOf(err: unknown, message: string): string {
  const text = normalizeNewlines(message);
  const rethrown = extractRethrownMessage(text);
  const picked = messageLines(rethrown ?? text)[0] ?? readString(err, "name") ?? "";
  return clipText(separateErrorName(redactTemplateSpans(picked)), MAX_REASON_CHARS);
}

/** 从 `rethrow` 形态的消息里取出末尾的原始 `err.message` */
function extractRethrownMessage(text: string): string | undefined {
  const m = /^[^\n]*:\d+\n[\s\S]*?\n\n([\s\S]+)$/.exec(text);
  return m ? m[1] : undefined;
}

/** 从 `rethrow` 形态的消息首行（`文件名:行号`）解析行号 */
function extractRethrowLine(text: string): number | undefined {
  const m = /^[^\n]*:(\d+)\n[\s\S]*?\n\n/.exec(normalizeNewlines(text));
  if (!m) return undefined;
  const line = Number(m[1]);
  return Number.isFinite(line) && line > 0 ? line : undefined;
}

/**
 * `rethrow` 风格消息里的 `>>` 标记行 —— 只用于给出"第几行"的定位，
 * 与首行原因相同时不重复；本身同样剥离模板片段并截断。
 */
function contextLineOf(message: string, reason: string): string | undefined {
  const marked = messageLines(message).find((l) => l.indexOf(">>") !== -1);
  if (!marked) return undefined;
  const clipped = clipText(redactTemplateSpans(marked), MAX_CONTEXT_CHARS);
  return clipped === reason ? undefined : clipped;
}

function messageLines(message: string): string[] {
  return normalizeNewlines(message)
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** 过滤掉"作为原因毫无信息量"的串（`[object Object]` / 单个数字等） */
function isInformativeReason(reason: string): boolean {
  if (!reason || reason.length < 3) return false;
  if (reason === "[object Object]") return false;
  return true;
}

/** 剥离模板片段：`<%= x %>` / 未闭合的 `<% …` 一律替换为占位符 */
function redactTemplateSpans(text: string): string {
  return text.replace(/<%[\s\S]*?%>/g, "‹模板片段已省略›").replace(/<%[\s\S]*$/, "‹模板片段已省略›");
}

/**
 * 载体回传的是 `name + message` 拼接串（`carrier.ts` 的 `messageOf`）⇒
 * `SyntaxErrorUnexpected token …` 这样的粘连会让日志难读，这里补一个分隔符。
 * 仅当首部是 `XxxError` / `XxxException` 且**紧跟非空白**时生效。
 */
function separateErrorName(text: string): string {
  return text.replace(/^([A-Z][A-Za-z]*(?:Error|Exception))(?=[^\s])/, "$1：");
}

/**
 * 符号名候选的抽取模式 —— **数组顺序 = 优先级**（严格形态在前，宽松兜底在最后）。
 *
 * ⚠️ 顺序是判据，不是风格（实跑发现过一类误报）：本插件工厂产出的消息是
 * `未实现的 EJS 符号：getchr`，若先跑宽松的 `(?:未实现|不支持)[^\w$]{0,4}([\w$]+)`，
 * 它会先咬住 `EJS`（中间那个空格算在 `[^\w$]{0,4}` 里）而不是 `getchr`。
 */
const SYMBOL_PATTERNS: readonly RegExp[] = [
  /符号\s*[：:]\s*「?\s*([A-Za-z_$][\w$]*)/, // 符号：getchr / 符号：「getchr
  /符号\s*「\s*([A-Za-z_$][\w$]*)/, // 符号「getchr
  /\b([A-Za-z_$][\w$]*)\s+is not defined\b/, // ReferenceError: X is not defined
  /not implemented[^\w$]{0,4}([A-Za-z_$][\w$]*)/i, // 英文形态
  /(?:未实现|不支持)[^\w$]{0,4}([A-Za-z_$][\w$]*)/, // 宽松兜底（可能咬到 ASCII 词，故排最后）
];

/**
 * 从错误串里点名符号。
 *
 * 两条保险：① 精确形态优先（见 `SYMBOL_PATTERNS` 的顺序）；
 * ② 收集全部候选后**优先取命中未实现清单的那个**（`$` / `z` / `toastr` / `include` 都在清单里）
 * —— 这条对"跨 `postMessage` 后只剩字符串、符号名只存在于 message 里"的形态尤为重要。
 */
function extractSymbolName(message: string): string | undefined {
  const candidates: string[] = [];
  for (const pattern of SYMBOL_PATTERNS) {
    const m = pattern.exec(message);
    if (m && m[1] && candidates.indexOf(m[1]) === -1) candidates.push(m[1]);
  }
  if (candidates.length === 0) return undefined;
  const known = candidates.find((name) => isUnimplementedEjsSymbol(name));
  return known ?? candidates[0];
}

function clipText(text: string, max: number, trim = true): string {
  const value = trim ? text.trim() : text;
  if (value.length <= max) return value;
  return value.slice(0, max) + "…";
}
