/**
 * EJS 模板插件 · **env 快照组装**（SSOT §2.5 / §6；技术性说明 §4）
 *
 * 职责边界（**很窄，别扩**）：
 *   ① 从宿主门面读出「本轮 env 数据」（三作用域变量 / 世界书索引 / 身份）；
 *   ② 把 7 项 env 符号 + 未实现符号的抛错桩**装配**到同一份快照上；
 *   ③ 快照交给载体（`host/carrier.ts`）即可直接渲染。
 *
 * ⚠️ **渲染期取门面，绝不缓存**（SSOT **G3**）：`App.tsx:940`（触发插件 `setup`）**早于**
 *    `:988`（`setScriptHostApi()` 注入）⇒ setup 期 `getScriptHostApi()` 必为 `null`。
 *
 * ── 与载体的接口（**按 carrier.ts 的实现核实过，不是纸面约定**）────────────────────
 *   · `Carrier.render(reqs, envSnapshot)` **按引用**把它存到
 *     `window.__nyaEjsCarriers[nonce].env`；同源 iframe 直读该对象并把它当作
 *     `async function anonymous(locals, escapeFn, include, rethrow)` 的 **`locals`** 调用。
 *   · ⇒ **快照的顶层就是模板的作用域**：模板里的 `getvar(...)` / `YAML.stringify(...)` /
 *     `_` 直接命中快照的同名属性（模板写 `with (locals || {})`，裸标识符即查 locals）。
 *   · ⇒ 因此本文件**必须**把 7 项装配到快照顶层 —— 只给"数据字段"会让模板全面
 *     `ReferenceError: getvar is not defined`。
 *   · 写入回传：载体按 `__writes` → `writes` → `__nyaWrites` → `__takeWrites()`/`takeWrites()`
 *     的顺序找落点，并按「本条目开始前的数组长度」切片 ⇒ 本文件在快照上放 **非枚举** 的
 *     `writes` 数组（非枚举 ⇒ 不会出现在 `structuredClone` / `JSON.stringify` 结果里，
 *     而 `Array.isArray(env.writes)` 照常为真）。
 *
 * 7 项（实测并集，技术性说明 §4.1）与语义（**读缺省 = `cache` 合并视图，写缺省 = `message`**，
 * 与上游 `[variables.ts]:437` / `:307` 一致）：
 *   · `getvar(key, {defaults, scope})`  点路径读；缺省（或 `scope:'cache'`）⇒ **合并视图**
 *                                       `global → chat → message`（**message 胜**）；
 *                                       `scope:'message'` ⇒ 当前楼层；`'chat'`/`'local'` ⇒ 本会话；
 *                                       `'global'` ⇒ 全局；空/缺 key ⇒ 返回**整个对象**；
 *                                       `'initial'` 无对应物 ⇒ 显式抛错
 *   · `getMessageVar(key, opts)`        同缺省口径（上游不带 `withMsg` 时读的也是 cacheVars）
 *   · `setvar(key, value)`              **路径原样**写 `variables.message`（上游写缺省 = `message`）
 *                                       + 记写入意图 ⇒ 同一合并视图下后续条目读得回
 *   · `setMessageVar(key, value)`       同 `setvar` 的落点（上游二者缺省 scope 同为 `message`）
 *   · `getwi(name)`                     **异步**；按 `comment` 匹配 `lorebook` ⇒ `content | null`
 *   · `YAML`                            eemeli/yaml（宿主自托管产物；**同一个 getter 也允许延迟加载**）
 *   · `_`                               `lodashSubset`（9 函数；`random`/`sample*` 走可控随机源）
 *   另有 `snapshot.unimplemented[name]` 的每个桩：调用即抛错、文案含符号名（**D11**）。
 *
 * 为什么读侧是合并视图而不是单取 chat（真实卡实测，改动前会让两张目标卡静默走错分支）：
 *   卡里 `getvar('stat_data')` ×26、`getvar('stat_data.事件.信号', {defaults:[]})` ×8 全是**不带 scope**，
 *   而 MVU 的 `stat_data` 落在**楼层（message）作用域** ⇒ 只读 chat 会全部命中 `defaults`。
 *   旁证：P0 桩 env 只有一个扁平 store ⇒ 对 57 条比对无影响（读侧不改变 golden 口径）。
 *
 * ⚠️ 写入为什么能跨条目可见（D9）：载体把 env **按引用**存着，iframe 直读它 ⇒ 模板里
 *    `setvar` 改的就是**宿主侧这份活快照**（不是克隆副本）。宿主因此在 pre-pass 结束后
 *    调 `takeSessionWriteLog(snapshot)` 拿到本轮全部写入意图，**统一提交一次**。
 *    `renderEntry` 另有一层回放（`appliedWrites`）作为重复投递时的第二道闸。
 *
 * ⚠️ 叶子纪律（SSOT §5）：只允许 `import type` 自 `src/plugins/*`（`scriptHost` 是叶子模块）
 *    与插件内零依赖模块；**禁止** import 宿主 `registry` / `runtime` / `backend` / `index`
 *    （模块环 ⇒ 插件静默消失）。另：门面**没有写门面** —— `scriptHost.ts:24-45` 只暴露
 *    `getVariableAtPath` 这类**路径读**，持久化写统一走 `updateVariablesWith` / `replaceVariables`。
 *
 * ── 保真度损失（如实登记，SSOT §6.3 / EJS技术性说明 §7）────────────────────────
 *   1. `getwi` 只能读**当前角色**的世界书（无全局书）—— `lorebook.getEntries()` 的口径；
 *   2. `scope: 'initial'` 无对应物（见 `UNSUPPORTED_ENV_FEATURES`）；`'cache'` 用合并视图近似；
 *   3. `flags: 'nx' | 'xx' | 'nxs'` 无对应物（同上）；
 *   4. 无 group 概念（`groups` / `groupId` 不存在）。
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { ScriptHostApi, ScriptHostVariableScope } from "../../../src/plugins/scriptHost";
import { getScriptHostApi, setScriptHostApi } from "../../../src/plugins/scriptHost";
import { UNIMPLEMENTED_EJS_SYMBOLS } from "../errors";
import { DEFAULT_DELIMITER, DEFAULT_OPEN_DELIMITER } from "../engine/syntax";
import { lodashSubset } from "../lodashSubset";
// 宿主叶子模块（插件可直接引，见 `插件框架规范.md` §2.5 的叶子模块纪律）：
// 这里的 `devWarn` 与宿主插件日志的"控制台分档"**同一判据**（发行版静音、dev 实例照打）。
import { devWarn } from "../../../src/plugins/pluginLog";

// ─────────────────────────── 常量与登记表 ───────────────────────────

/** 插件 id —— 与 `plugin.tsx` 的 `meta.id` 一致，只用于错误文案/日志归属。 */
export const EJS_TEMPLATE_PLUGIN_ID = "ejs-template";

/** 宿主**自托管**的 eemeli/yaml 产物（与 JSR 给 iframe 挂 `window.YAML` 的是同一份，`scriptHostImpl.ts:230`）。 */
export const VENDOR_YAML_PATH = "/vendor/script-host/yaml/yaml.esm.js";

/**
 * 未实现符号（**单一来源 = `errors.ts` 的 `UNIMPLEMENTED_EJS_SYMBOLS`**，27 项）——
 * **调用即显式抛错，绝不静默返回 `undefined`**（D11）。
 *
 * 为什么单一来源（而不是在本文件再抄一份）：项目纪律「同一份映射不要写两遍」
 * （既有教训见 `src/lib/sillyTavernScripts.ts:12`）。此前本文件自己维护一份，结果漏了
 * `toastr` / `z`（上游 `[ejs.ts]:30-60` 的 `SHARE_CONTEXT` 确实注入 `_`/`$`/`z`/`toastr`/`console`；
 * 5 卡实测这两项命中 **0** ⇒ 属"上游提供、本插件不实现"，应进桩表而不是让原生 `ReferenceError` 兜底）。
 * 现在 `errors.ts` 是唯一权威：它**零依赖**（0 import）⇒ `host/env.ts → ../errors` 不构成模块环 ✓。
 *
 * 为什么必须抛错：静默 `undefined` 会让模板产出**看着正常的错误文本**（`getchr()` 参与字符串
 * 拼接会得到 `"undefined"`），比直接失败危险得多 —— 这是 JSR 的 D9 纪律，本插件照抄。
 *
 * ⚠️ **本常量也是运行时权威**：`host/carrier.ts:69` import 它来重建「快照被结构化克隆过 ⇒ 桩被丢掉」
 *    时的抛错桩表（`buildUnimplementedTable`）；`checkEnvSnapshot()` 同样按它逐项自检。
 *
 * 边界说明（避免"顺手放开"）：
 *   · `_`（lodash 子集）与 `YAML`（宿主全局）**已实现**，不在清单里；
 *   · `$` —— **载体 env 里没有提供方**：NyaaChat 的 jQuery 只注入 **JSR 的 script-host iframe**
 *     （`src/plugins/scriptHostImpl.ts:221` 的 `{ path: "/vendor/script-host/jquery.min.js" }`），
 *     EJS 载体是 srcdoc + 自建注入脚本、**不加载**它 ⇒ 保持抛错（SSOT §6 `开发计划-SSOT.md:355`
 *     已把 `$` 列为未实现，D11；5 卡实测 0 命中）。
 *     将来若某张卡确实需要 `$`：**复用已在用的同一份 vendor 产物注入载体**（零新依赖）+ 一次范围评审
 *     —— 而**不是**自造一个只会静默失败的假 `$`，也不是"新引一份 jQuery"。
 *     ⚠️ 前提务必按上面的精确版引用：写成"NyaaChat 没有 jQuery"会误导范围评审得出错误方案。
 *   · `console` 是 JS 原生全局（真实存在），无需桩。
 *
 * @see ../errors.ts 的 `UNIMPLEMENTED_EJS_SYMBOLS`（权威清单）/ `isUnimplementedEjsSymbol()`
 *      / `describeEjsError()`（把本模块抛出的 `EjsSymbolNotImplementedError` 转成用户可读文案）
 */
export const UNIMPLEMENTED_ENV_SYMBOLS: readonly string[] = UNIMPLEMENTED_EJS_SYMBOLS;

/**
 * 本插件**没有对应物**的写法 —— 调用即抛错（**登记**，不静默降级）。
 *
 * · `scope:'initial'`：ST 的 initialVariables 在 NyaaChat 无对应物（损失 #2）；
 *   `'cache'` 用**合并视图**近似（global → chat → message），因此**不在**本清单里；
 * · `flags`：`nx` / `xx` / `nxs` 无对应物（损失 #3）。`getvar` 的 `scope` 由本文件显式校验；
 *   `flags` 出现在第二参上（属 `setvar` 的可选面，**本阶段不支持**）。
 */
export const UNSUPPORTED_ENV_FEATURES: readonly string[] = Object.freeze([
  "getvar scope:'initial'",
  "setvar flags:'nx'",
  "setvar flags:'xx'",
  "setvar flags:'nxs'",
]);

/** 变量作用域的中文名（错误文案/UI 用）。 */
const SCOPE_LABEL: Record<ScriptHostVariableScope, string> = {
  message: "message（当前楼层）",
  chat: "chat（本会话）",
  global: "global（全局）",
};

/** 作用域中文名（`errors.ts` / 日志复用同一口径）。 */
export function describeScope(scope: ScriptHostVariableScope): string {
  return SCOPE_LABEL[scope] ?? String(scope);
}

// ─────────────────────────── 错误类型 ───────────────────────────

/** 用了本阶段未实现的扩展符号（D11）。文案**必含符号名**，供 `errors.ts` 转用户可读文案。 */
export class EjsSymbolNotImplementedError extends Error {
  readonly symbol: string;

  constructor(symbol: string) {
    super(`EJS 模板用了本插件尚未实现的符号「${symbol}」：不再静默返回 undefined，改为显式抛错。`);
    this.name = "EjsSymbolNotImplementedError";
    this.symbol = symbol;
  }
}

/** 门面缺失 / 未支持的作用域 / 快照取用时机不对 —— 属于**编程错误**，同样显式抛错。 */
export class EjsEnvUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EjsEnvUnavailableError";
  }
}

/** 未实现符号的调用桩 —— 函数名即符号名（栈里一眼可辨）。 */
export function makeUnimplementedEnvSymbol(name: string): () => never {
  const fn = function unimplementedSymbol(): never {
    throw new EjsSymbolNotImplementedError(name);
  };
  try {
    Object.defineProperty(fn, "name", { value: name, configurable: true });
  } catch {
    /* 某些环境不允许改 name：不影响语义 */
  }
  return fn as () => never;
}

function makeUnimplementedTable(): Record<string, () => never> {
  const table: Record<string, () => never> = {};
  for (const name of UNIMPLEMENTED_ENV_SYMBOLS) table[name] = makeUnimplementedEnvSymbol(name);
  return table;
}

// ─────────────────────────── 写入意图 ───────────────────────────

export type PromptTextWriteScope = "message" | "chat" | "global";

/**
 * 写入意图 —— **与 `src/plugins/promptText.ts` 的 `PromptTextWrite` 结构一致**
 * （那边并行开发中，故此处只按冻结字段本地声明，不做跨模块值导入）。
 */
export interface PromptTextWriteIntent {
  path: string;
  value: unknown;
  scope: PromptTextWriteScope;
  messageId?: number | "latest";
}

// ─────────────────────────── 快照形状 ───────────────────────────

export interface EjsIdentity {
  user: string;
  char: string;
}

export interface EjsCharacterRef {
  id: string | null;
  name: string;
}

export interface EjsVariableStore {
  /** 当前楼层（message 作用域）—— 对应 ST 的 `chat[i].variables[0]`。 */
  message: Record<string, unknown>;
  /** 本会话（chat 作用域）—— 对应 ST 的 `chat_metadata.variables`（**`getvar` 的缺省作用域**）。 */
  chat: Record<string, unknown>;
  /** 全局（global 作用域）。 */
  global: Record<string, unknown>;
  /** message 作用域的楼层指针；`"latest"` = 末尾第一个有变量的楼层（已对齐酒馆助手）。 */
  messageId: number | "latest";
}

/** 数据侧快照的**版本号**。 */
export const EJS_ENV_SNAPSHOT_VERSION = 1;

/**
 * env 快照 —— 顶层**就是模板作用域**（见文件头「与载体的接口」）。
 *
 * ⚠️ 这是**活对象**：`variables.{message,chat,global}` 会被模板里的 `setvar`/`setMessageVar`
 *    直接改写（D9），后续条目因此能读到前面条目的写入。**不要克隆它再传给载体**。
 */
export interface EjsEnvSnapshot {
  readonly version: typeof EJS_ENV_SNAPSHOT_VERSION;

  // ── 数据字段（纯数据，`structuredClone` 安全）──
  readonly variables: EjsVariableStore;
  /** 世界书索引：`comment` → `content`（`getwi` 的数据源；重复 `comment` 后者覆盖）。 */
  readonly lorebook: Record<string, string>;
  readonly identity: EjsIdentity;
  readonly character: EjsCharacterRef;
  /** 未实现符号 → 抛错桩（D11）。 */
  readonly unimplemented: Record<string, () => never>;
  readonly vendor: { readonly yamlPath: string };
  readonly loadedAt: number;

  // ── 模板作用域（= 上面数据 + 下面符号，模板裸标识符直接命中）──
  /** `getvar(key, {defaults, scope})` —— 缺省/`'cache'` 读**合并视图**（global→chat→message，message 胜）。 */
  readonly getvar: (key: string | null | undefined, opts?: { defaults?: unknown; scope?: string }) => unknown;
  /**
   * `getMessageVar(key, opts)` —— 上游 `[ejs.ts]:285` 是 `getVariable({scope:'message'})`，而不带
   * `withMsg` 时 `[variables.ts]:481` 读的仍是 `cacheVars` ⇒ 与 `getvar` 缺省**同源**。
   */
  readonly getMessageVar: (key: string | null | undefined, opts?: { defaults?: unknown }) => unknown;
  /** `setvar(key, value)` —— **路径原样**写 `message` 作用域（上游写缺省 = `message`）。 */
  readonly setvar: (key: string | null | undefined, value: unknown) => void;
  /** `setMessageVar(key, value)` —— 与 `setvar` 同落点（上游二者缺省 scope 同为 `message`）。 */
  readonly setMessageVar: (key: string | null | undefined, value: unknown) => void;
  /** `getwi(name)` —— **异步**；命中返回 `content`，未命中/未启用返回 `null`。 */
  readonly getwi: (name: string | null | undefined) => Promise<string | null>;
  /** 宿主全局 `YAML`（eemeli/yaml 命名空间）。 */
  readonly YAML: unknown;
  /** lodash 子集（9 函数）。 */
  readonly _: unknown;

  /** `user` / `char` 的**别名**：模板里常直接写 `{{user}}` 之外的裸名（上游 env 里有同名键）。 */
  readonly user: string;
  readonly char: string;

  /**
   * 写入意图落点（载体按 `__writes` → `writes` → … 的顺序找它，见 `carrier.ts` 的 `writesSink`）。
   * **非枚举** —— 数组本体是宿主侧引用，不参与任何序列化。
   */
  readonly writes: PromptTextWriteIntent[];
}

/** 快照契约自描述（载体/测试都可读它做断言，避免两份注释漂移）。 */
export const ENV_SNAPSHOT_CONTRACT = Object.freeze({
  version: EJS_ENV_SNAPSHOT_VERSION,
  /** 模板作用域里的 7 项（+ 两个身份别名）。 */
  templateScope: Object.freeze([
    "getvar",
    "getMessageVar",
    "setvar",
    "setMessageVar",
    "getwi",
    "YAML",
    "_",
    "user",
    "char",
  ] as const),
  /** 数据字段（纯数据）。 */
  dataFields: Object.freeze([
    "version",
    "variables.message",
    "variables.chat",
    "variables.global",
    "variables.messageId",
    "lorebook",
    "identity.user",
    "identity.char",
    "character.id",
    "character.name",
    "vendor.yamlPath",
    "loadedAt",
  ] as const),
  /** 写入意图落点（`carrier.ts` 的识别顺序，逐字一致）。 */
  writesSink: Object.freeze(["__writes", "writes", "__nyaWrites", "__takeWrites()"] as const),
  /**
   * `setvar` / `setMessageVar` 的落点 —— **都是 `message`**（上游 `[variables.ts]:307`
   * 写缺省 `switch (scope || 'message')`）；读侧是合并视图（message 胜）⇒ 能自洽读回。
   * 路径**原样**写入，不剥离 `stat_data.`。
   */
  writeTargets: Object.freeze({ setvar: "message", setMessageVar: "message" } as const),
  /**
   * `getvar` 的缺省作用域 —— `cache` = **global → chat → message 合并（message 胜）**，
   * 与上游 `[variables.ts]:437` 的 `switch (scope || 'cache')` 及 `:52-62` 的 `cacheVars` 一致。
   * （卡片实测：`getvar('stat_data.…')` 全不带 scope，而 MVU 的 stat_data 在楼层作用域。）
   */
  defaultGetvarScope: "cache",
  /** 显式 scope 的别名表（本插件支持的读视图）。 */
  scopeAliases: Object.freeze({
    "": "cache",
    cache: "cache(merged: global→chat→message)",
    message: "message(当前楼层)",
    chat: "chat(本会话)",
    local: "chat(本会话)",
    global: "global(全局)",
  } as const),
} as const);

// ─────────────────────────── 启动期告警 ───────────────────────────

export interface EjsStartupWarning {
  code: "host-api-unavailable" | "yaml-load-failed" | "yaml-deferred";
  message: string;
  detail?: string;
}

const startupWarnings: EjsStartupWarning[] = [];

function warnOnce(code: EjsStartupWarning["code"], message: string, detail?: string): void {
  if (startupWarnings.some((w) => w.code === code)) return;
  startupWarnings.push({ code, message, detail });
  // 只在**开发实例**的控制台留一条；发行版静音（面板可见性由 `plugin.tsx` 注册的生命周期记）。
  // 判据走宿主叶子 `pluginLog` 的 `devWarn`（与插件日志的控制台分档**同源**），
  // 不在这里自己再判一次 dev —— 两套判别必然漂移。
  try {
    devWarn(`[${EJS_TEMPLATE_PLUGIN_ID}] ${message}${detail ? ` —— ${detail}` : ''}`);
  } catch {
    /* 控制台不可用不影响渲染 */
  }
}

/** 取启动期一次性告警（UI 首屏用；只读）。 */
export function getEnvStartupWarnings(): readonly EjsStartupWarning[] {
  return startupWarnings;
}

/** 测试/探针用：清空 canonical 快照缓存与启动告警（生产代码不调用）。 */
export function resetEnvSnapshotsForTests(): void {
  canonicalSnapshots.clear();
  startupWarnings.length = 0;
}

// ─────────────────────────── 组装 ───────────────────────────

export interface BuildEnvSnapshotContext {
  /** 当前角色 id（无角色时 `null`）。 */
  characterId: string | null;
  identity: EjsIdentity;
  /** message 作用域的楼层指针；缺省 `"latest"`（已对齐酒馆助手语义）。 */
  messageId?: number | "latest";
  /** 当前角色名（展示口径）；缺省取 `identity.char`。 */
  characterName?: string;
  /** 会话 id —— 提供时，同一会话复用同一份**活快照**（跨条目共享写入，D9）。 */
  sessionId?: string;
}

export interface BuildEnvSnapshotOptions {
  /**
   * `true`（默认）⇒ 按会话复用**同一个活快照** ⇒ 本轮多个条目共享变量内存
   * （前面条目 `setvar` 的写入，后面条目 `getvar` 能读到）。
   * `false` ⇒ 每次返回全新快照（**只读试渲染**用：写入不跨条目、也不提交）。
   */
  canonical?: boolean;
}

/** 会话 → 活快照。 */
const canonicalSnapshots = new Map<string, EjsEnvSnapshot>();
/** canonical 缓存的容量上限（键通常是会话；无会话时退化为按角色键，避免慢增长）。 */
const CANONICAL_SNAPSHOT_LIMIT = 16;

/** 宿主门面 —— **每次调用都重新取**（SSOT G3：setup 期取到的是 `null`）。 */
function requireHostApi(): ScriptHostApi {
  const api = getScriptHostApi();
  if (!api) {
    throw new EjsEnvUnavailableError(
      "取不到宿主门面（getScriptHostApi() === null）：插件 setup 早于 App 注入门面，" +
        "必须**每次渲染时**按需取用，绝不能在模块级/setup 期缓存（SSOT G3）。",
    );
  }
  return api;
}

/** 作用域读 —— 门面缺失返回 `{}`（降级为"空变量"，好过整轮抛错）。 */
function readScopeOrEmpty(api: ScriptHostApi | null, scope: ScriptHostVariableScope): Record<string, unknown> {
  if (!api) return {};
  try {
    const value = api.variables.getVariables(scope) as unknown;
    return isPlainObjectLike(value) ? (value as Record<string, unknown>) : {};
  } catch (err) {
    devWarn(`[${EJS_TEMPLATE_PLUGIN_ID}] 读变量作用域 ${scope} 失败，本条降级为空`, err);
    return {};
  }
}

/** 世界书条目 → `comment` → `content` 索引（`getwi` 的数据源；**仅当前角色**，G5 降级）。 */
function buildLorebookIndex(api: ScriptHostApi | null): Record<string, string> {
  const index: Record<string, string> = {};
  if (!api) return index;
  try {
    const entries = api.lorebook.getEntries() as unknown;
    if (!Array.isArray(entries)) return index;
    for (const raw of entries) {
      const entry = raw as { comment?: unknown; content?: unknown } | null;
      if (!entry || typeof entry !== "object") continue;
      const comment = typeof entry.comment === "string" ? entry.comment.trim() : "";
      if (!comment) continue;
      // 重复 comment 后者覆盖；非字符串内容不进索引（`getwi` 返回 null，而不是 "[object Object]"）。
      if (typeof entry.content === "string") index[comment] = entry.content;
    }
  } catch (err) {
    devWarn(`[${EJS_TEMPLATE_PLUGIN_ID}] 读世界书条目失败，getwi 将一律返回 null`, err);
  }
  return index;
}

function canonicalKeyOf(ctx: BuildEnvSnapshotContext): string {
  const sessionId = typeof ctx.sessionId === "string" ? ctx.sessionId.trim() : "";
  if (sessionId) return `session:${sessionId}`;
  return `character:${ctx.characterId ?? ""}`;
}

/** `stat_data.` 前缀剥离（MVU 变量树在模板里的习惯前缀；本地根就是变量对象）。 */
function stripStatData(path: string): string {
  return path.startsWith("stat_data.") ? path.slice("stat_data.".length) : path;
}

/**
 * 按路径读一个值 —— **原样路径与剥掉 `stat_data.` 的路径都试**（保真：两种写法都存在）。
 *
 * 为什么必须两试（覆盖两种 store 形状 × 两种模板写法）：
 *   · **P0 桩形状**：`makeFixtureVars()` 把变量树直接放在根上（`{ stat_data: { … } }`，**没有** `stat_data` 这一层）
 *     ⇒ `getvar('stat_data.进程.阶段')` 是**原样**命中根上的 `stat_data` 键；而模板若要 `getvar('进程.阶段')`，
 *     就必须靠第二试（剥离）才命中。
 *   · **NyaaChat 形状**：MVU 变量树以 `stat_data` 为根键 ⇒ `getvar('stat_data.X')` 原样命中；
 *     而模板若要 `getvar('X')`，同样只有第二试能命中。
 *   ⇒ 两种形状下模板写法都可能两种；**只试一种必然让另一类条目静默取到 `undefined`**（黄金基准会红）。
 *   ⚠️ 反过来说：第二试**只在字面路径 miss 时**触发，**不做跨层兜底** —— 若 store 的 `stat_data`
 *     内部还有子键，`getvar('预置.值')` **不会**穿过 `stat_data` 取到 `stat_data.预置.值`（返回 `undefined`）。
 *     该边界已由 `assertEjsEnvStubOnly()` 的 B 组断言钉死。
 *
 * ⚠️ **写入侧刻意不做这个剥离**（见 `applyWriteIntent`）：真实卡读、写用的是**同一条完整路径**
 *    （`setvar('stat_data.事件.信号', …)` ↔ `getvar('stat_data.事件.信号')`）。
 *    ⚠️ 理由**不是**"剥离后读不回来"（`readPath` 有第二次尝试，剥离后写入的键仍能被
 *    `getvar('stat_data.…')` 读到）——**真正的理由只有两条**：
 *      ① **与 P0 判据基准（oracle）一致**：`verify-ejs-golden.ts:109/114` 是 `lodash.set(vars, key, value)`
 *         **原样全路径**、无任何前缀处理；写入侧剥离会让**存储形状**偏离黄金基准口径；
 *      ② **保护 MVU 变量树结构**：NyaaChat 的 MVU 树以 `stat_data` 为根键，剥离会把
 *         `stat_data.事件.信号` 落成根上的 `事件.信号`，与卡片/上游约定不符。
 */
function readPath(store: Record<string, unknown>, path: string): unknown {
  const direct = lodashSubset.get(store, path, undefined);
  if (direct !== undefined) return direct;
  return lodashSubset.get(store, stripStatData(path), undefined);
}

/**
 * `'cache'` 读取视图的等价物 —— **global → chat → message 合并，message 胜**。
 *
 * 上游依据：`[variables.ts]:52-62` 的 `STATE.cacheVars = cloneDeep(Object.assign({}, global,
 * initialVariables, chat_metadata.variables, msgVars))`；`[variables.ts]:437` 的读缺省 scope 就是
 * **`'cache'`**（`:307` 的写缺省是 **`'message'`**）。卡片的 `stat_data` 通常落在**楼层（message）
 * 作用域** ⇒ 读侧只取 chat 会让 `getvar('stat_data.…')` 全部命中 `defaults`（静默走错分支）。
 *
 * ⚠️ 本函数只给**宿主侧**（试渲染/诊断/自检）用；iframe 内的 env 由载体按同一口径自行装配
 *    （契约见 `ENV_SNAPSHOT_CONTRACT.defaultGetvarScope`）。浅合并即可 —— 上游也是逐层 `Object.assign`。
 */
export function mergedCacheView(store: {
  global?: Record<string, unknown>;
  chat?: Record<string, unknown>;
  message?: Record<string, unknown>;
}): Record<string, unknown> {
  return Object.assign({}, store.global ?? {}, store.chat ?? {}, store.message ?? {});
}

function isForbiddenPath(path: string): boolean {
  return !path || path === "__proto__" || path === "constructor" || path === "prototype";
}

/** 逐段检查（点路径与 `[k]` 写法都要挡），防原型污染与原型读穿透。 */
function hasForbiddenSegment(path: string): boolean {
  if (isForbiddenPath(path)) return true;
  const segments = path.replace(/\[(['"]?)([^\]]*)\1\]/g, ".$2").split(".");
  return segments.some((segment) => {
    const key = segment.trim();
    return key === "__proto__" || key === "constructor" || key === "prototype";
  });
}

function makeSnapshot(ctx: BuildEnvSnapshotContext, api: ScriptHostApi | null): EjsEnvSnapshot {
  const variables: EjsVariableStore = {
    message: readScopeOrEmpty(api, "message"),
    chat: readScopeOrEmpty(api, "chat"),
    global: readScopeOrEmpty(api, "global"),
    messageId: ctx.messageId ?? "latest",
  };

  /** 本快照的写入意图（**非枚举**挂在快照上，见文件头）。 */
  const writes: PromptTextWriteIntent[] = [];

  /** 世界书索引（此快照**冻结**一份：渲染期读宿主世界书会与"本轮快照"的口径不一致）。 */
  const lorebook = buildLorebookIndex(api);

  const recordWrite = (path: string, value: unknown, scope: PromptTextWriteScope): void => {
    writes.push({ path, value, scope, messageId: variables.messageId });
  };

  /**
   * 读取视图（**与上游逐支对齐**，`[variables.ts]:437-491`）：
   *   · 缺省 / `'cache'` ⇒ `mergedCacheView`（global → chat → message，**message 胜**）
   *   · `'message'` ⇒ **也是合并视图** —— 上游 `:475-483` 的 `case 'message'` 在**没有 `withMsg`**
   *     时执行的正是 `get(STATE.cacheVars, key, defaults)`（`withMsg` 本阶段不支持）。
   *     ⚠️ 需要**只取当前楼层那棵树**时，请直接用 `snapshot.variables.message`（内部/测试用），
   *     不要指望 `scope:'message'` 是"纯楼层"——那不是上游语义。
   *   · `'chat'` / `'local'` ⇒ 本会话（`chat_metadata` 等价物）；`'global'` ⇒ 全局
   *   · `'initial'` 无对应物 ⇒ 显式抛错（登记见 `UNSUPPORTED_ENV_FEATURES`）
   */
  const getScope = (scope: unknown): Record<string, unknown> => {
    if (scope === undefined || scope === null || scope === "" || scope === "cache" || scope === "message") {
      return mergedCacheView(variables);
    }
    if (scope === "chat" || scope === "local") return variables.chat;
    if (scope === "global") return variables.global;
    throw new EjsEnvUnavailableError(
      `getvar 的 scope「${String(scope)}」在 NyaaChat 没有对应物（只有 message / chat / global）。`,
    );
  };

  const getvar = (key: string | null | undefined, opts?: { defaults?: unknown; scope?: string }): unknown => {
    const store = getScope(opts?.scope);
    // 空 key / 缺 key ⇒ 返回**整个作用域对象**（上游 `if (key == null || key === '') return vars;`）
    if (key === undefined || key === null || key === "") return store;
    const path = String(key);
    if (hasForbiddenSegment(path)) return opts?.defaults;
    if (path === "stat_data") return store.stat_data ?? opts?.defaults;
    const value = readPath(store, path);
    return value === undefined ? opts?.defaults : value;
  };

  /**
   * `setvar(key, value)` —— **写入目标 = `message` 作用域，路径原样**（上游 `[variables.ts]:307` 的
   * `switch (scope || 'message')`；写缺省是 message，而卡片读缺省是 `cache` 合并视图 ⇒ message
   * 胜出，因此"写 message + 合并读"能自洽读回）。
   *
   * ⚠️ 路径**不剥离** `stat_data.`：真实卡读、写用同一条完整路径。
   *    ⚠️ 理由**不是**"剥离后读不回来"（`readPath` 的第二试仍能命中）——真正的理由两条：
   *      ① **与 P0 判据基准（oracle）一致**：`verify-ejs-golden.ts:109/114` 的 `lodash.set(vars, key, value)`
   *         是**原样全路径**、无前缀处理；
   *      ② **保护 MVU 变量树结构**：把 `stat_data.事件.信号` 剥成根上的 `事件.信号` 与卡片/上游约定不符。
   */
  const setvar = (key: string | null | undefined, value: unknown): void => {
    const path = typeof key === "string" ? key : "";
    if (hasForbiddenSegment(path)) return;
    lodashSubset.set(variables.message, path, value);
    recordWrite(path, value, "message");
  };

  /** `setMessageVar(key, value)` —— 与 `setvar` 同落点（上游二者缺省 scope 同为 `message`）。 */
  const setMessageVar = (key: string | null | undefined, value: unknown): void => {
    const path = typeof key === "string" ? key : "";
    if (hasForbiddenSegment(path)) return;
    lodashSubset.set(variables.message, path, value);
    recordWrite(path, value, "message");
  };

  /**
   * `getMessageVar(key, opts)` —— **与 `getvar` 缺省同源（`cache` 合并视图）**。
   *
   * 上游依据（**我此前读错、已按 captain 的断言 C 纠正**）：`[ejs.ts]:285` 是
   * `getVariable.call(context, k, {…, scope:'message'})`，而 `[variables.ts]:475-483` 的
   * `case 'message'` 在**没有 `withMsg`** 时执行的正是 `get(STATE.cacheVars, key, defaults)`
   * —— 即**合并视图**，不是纯 message 作用域。`withMsg`（`chat[i].variables` 逐楼层过滤）
   * 在本阶段**不支持** ⇒ 单一实参形态永远走合并视图。
   *
   * ⇒ 需要**只取当前楼层那棵树**时，直接用 `snapshot.variables.message`（内部/测试用）；
   *   `scope:'message'` **不是**"纯楼层"（见 `getScope`）。
   */
  const getMessageVar = (key: string | null | undefined, opts?: { defaults?: unknown }): unknown =>
    getvar(key, { ...opts, scope: "message" });

  const getwi = async (name: string | null | undefined): Promise<string | null> => {
    const wanted = typeof name === "string" ? name.trim() : "";
    if (!wanted) return null;
    const direct = lorebook[wanted];
    if (typeof direct === "string") return direct;
    for (const [comment, content] of Object.entries(lorebook)) {
      if (comment === wanted) return content;
    }
    return null;
  };

  const snapshot = {
    version: EJS_ENV_SNAPSHOT_VERSION,
    variables,
    lorebook,
    identity: {
      user: String(ctx.identity?.user ?? ""),
      char: String(ctx.identity?.char ?? ""),
    },
    character: {
      id: ctx.characterId ?? null,
      name: String(ctx.characterName ?? ctx.identity?.char ?? ""),
    },
    unimplemented: makeUnimplementedTable(),
    vendor: { yamlPath: VENDOR_YAML_PATH },
    loadedAt: Date.now(),

    getvar,
    getMessageVar,
    setvar,
    setMessageVar,
    getwi,
    // `YAML` 是 getter：`ensureYaml()` 可能后于本快照完成加载（首次渲染前预热，见 plugin.tsx）
    get YAML(): unknown {
      const yaml = getLoadedYaml();
      if (yaml === null) {
        warnOnce(
          "yaml-deferred",
          "渲染时 YAML 仍未加载完成（用到 `YAML.stringify` 的条目会失败；预热见 plugin.tsx 的 ensureYaml）",
        );
      }
      return yaml;
    },
    _: lodashSubset,
    user: String(ctx.identity?.user ?? ""),
    char: String(ctx.identity?.char ?? ""),
  } as unknown as EjsEnvSnapshot;

  // 写入落点：**非枚举**（不进任何序列化结果），但 `Array.isArray(env.writes)` 为真 ⇒ 载体识别得到。
  Object.defineProperty(snapshot, "writes", { value: writes, enumerable: false, writable: false });
  return snapshot;
}

/** 把新一轮宿主数据合并进**活快照**：只覆盖宿主字段，绝不触碰渲染期写入（D9 保真）。 */
function refreshSnapshot(target: EjsEnvSnapshot, fresh: EjsEnvSnapshot): void {
  replaceContents(target.variables.message, fresh.variables.message);
  replaceContents(target.variables.chat, fresh.variables.chat);
  replaceContents(target.variables.global, fresh.variables.global);
  (target.variables as { messageId: number | "latest" }).messageId = fresh.variables.messageId;
  const lorebook = target.lorebook as Record<string, string>;
  for (const key of Object.keys(lorebook)) delete lorebook[key];
  Object.assign(lorebook, fresh.lorebook);
  (target as { identity: EjsIdentity }).identity = fresh.identity;
  (target as { character: EjsCharacterRef }).character = fresh.character;
  (target as { user: string }).user = fresh.user;
  (target as { char: string }).char = fresh.char;
}

function replaceContents(target: Record<string, unknown>, next: Record<string, unknown>): void {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, next);
}

/**
 * 组装本轮 env 快照（SSOT §2.5；技术性说明 §4）。
 *
 * @param ctx 身份 / 角色 / message 楼层指针；给了 `sessionId` 即复用同一份活快照（跨条目共享写入）
 */
export function buildEnvSnapshot(
  ctx: BuildEnvSnapshotContext,
  options: BuildEnvSnapshotOptions = {},
): EjsEnvSnapshot {
  const api = getScriptHostApi(); // ⚠️ 就地取用，绝不缓存（G3）
  if (!api) {
    warnOnce(
      "host-api-unavailable",
      "宿主门面尚未注入，本轮 env 只有空变量树（依赖变量的条目会走 defaults 或渲染为空）",
      "App.tsx:988 的 setScriptHostApi 尚未执行",
    );
  }
  const safeCtx: BuildEnvSnapshotContext = {
    characterId: ctx?.characterId ?? null,
    identity: { user: String(ctx?.identity?.user ?? ""), char: String(ctx?.identity?.char ?? "") },
    ...(ctx?.messageId === undefined ? {} : { messageId: ctx.messageId }),
    ...(ctx?.characterName === undefined ? {} : { characterName: ctx.characterName }),
    ...(typeof ctx?.sessionId === "string" && ctx.sessionId ? { sessionId: ctx.sessionId } : {}),
  };

  if (options.canonical === false) return makeSnapshot(safeCtx, api);

  const key = canonicalKeyOf(safeCtx);
  const existing = canonicalSnapshots.get(key);
  if (existing) {
    refreshSnapshot(existing, makeSnapshot(safeCtx, api));
    return existing;
  }
  const created = makeSnapshot(safeCtx, api);
  canonicalSnapshots.set(key, created);
  // 上限裁剪（FIFO）：会话多开时不让快照表无限增长（被淘汰的会话下轮重建，语义等价）
  while (canonicalSnapshots.size > CANONICAL_SNAPSHOT_LIMIT) {
    const oldest = canonicalSnapshots.keys().next();
    if (oldest.done) break;
    canonicalSnapshots.delete(oldest.value);
  }
  return created;
}

/** 无 ctx 的兜底快照（只在调用方没传快照时用；**正常路径必须有真快照**）。 */
export function emptyEnvSnapshot(): EjsEnvSnapshot {
  return makeSnapshot({ characterId: null, identity: { user: "", char: "" } }, null);
}

/**
 * 字符串参数 → 权威快照。
 *
 * ⚠️ **两种键都要认**（t10 集成实测的坑）：表里存的键是 `canonicalKeyOf()` 产出的
 * `session:<id>` / `character:<id>`，而调用方（宿主/探针）手上只有会话 id。
 * 早期只做**原样查找** ⇒ 传 `"sess-1"` 恒查不到、静默返回空数组
 * （"每轮恰好提交一次"会静默退化成"一次都不提交"，且不报错）。
 */
function findCanonicalSnapshot(key: string): EjsEnvSnapshot | null {
  const raw = key.trim();
  if (!raw) return null;
  return canonicalSnapshots.get(raw) ?? canonicalSnapshots.get(`session:${raw}`) ?? canonicalSnapshots.get(`character:${raw}`) ?? null;
}

/** 取本快照（或会话）已记录的全部写入意图 —— 宿主在 pre-pass 结束后据此**统一提交一次**（D9）。 */
export function takeSessionWriteLog(snapshotOrSessionId: EjsEnvSnapshot | string): PromptTextWriteIntent[] {
  if (typeof snapshotOrSessionId === "string") {
    const snapshot = findCanonicalSnapshot(snapshotOrSessionId);
    return snapshot ? snapshot.writes.slice() : [];
  }
  const writes = (snapshotOrSessionId as { writes?: unknown })?.writes;
  return Array.isArray(writes) ? (writes as PromptTextWriteIntent[]).slice() : [];
}

/** 清空某快照（或某会话）的写入日志 —— 提交完成后调用，保证"每轮恰好提交一次"。 */
export function clearSessionWriteLog(snapshotOrSessionId: EjsEnvSnapshot | string): void {
  if (typeof snapshotOrSessionId === "string") {
    const snapshot = findCanonicalSnapshot(snapshotOrSessionId);
    if (snapshot) snapshot.writes.length = 0;
    return;
  }
  const writes = (snapshotOrSessionId as { writes?: unknown })?.writes;
  if (Array.isArray(writes)) (writes as PromptTextWriteIntent[]).length = 0;
}

// ─────────────────────────── YAML（宿主自托管产物）───────────────────────────

export interface VendorYamlSource {
  /** HTTP 路径（浏览器里 `import()` 用）。 */
  path: string;
  /** 相对仓库根的文件路径（dev-server / Node 探针用；`null` = 浏览器环境不适用）。 */
  fileUrl: string | null;
}

let vendorYamlSource: VendorYamlSource = { path: VENDOR_YAML_PATH, fileUrl: null };
let yamlModulePromise: Promise<unknown> | null = null;
let yamlModuleValue: unknown = null;

/** 注入 YAML 的真实路径（dev-server 探针用；如 `public/vendor/script-host/yaml/yaml.esm.js`）。 */
export function setVendorYamlPath(path: string | null, filePath?: string | null): void {
  const nextPath = path && path.trim() ? path.trim() : VENDOR_YAML_PATH;
  const nextFile = filePath && filePath.trim() ? filePath.trim() : null;
  if (nextPath === vendorYamlSource.path && nextFile === vendorYamlSource.fileUrl) return;
  vendorYamlSource = { path: nextPath, fileUrl: nextFile };
  yamlModulePromise = null; // 换源即作废缓存
  yamlModuleValue = null;
}

/** 当前生效的 YAML 源。 */
export function getVendorYamlSource(): VendorYamlSource {
  return { ...vendorYamlSource };
}

/**
 * 取出 `window.YAML` 的等价实现（eemeli/yaml 命名空间）——**与 JSR 给 iframe 的同一份**。
 *
 * 用途：① 快照的 `YAML` getter 直接给它；② 插件侧预检；③ dev-server 烟测对拍。
 */
export async function loadYaml(overrides?: { fileUrl?: string }): Promise<unknown> {
  if (yamlModuleValue !== null) return yamlModuleValue;

  const target = overrides?.fileUrl ?? vendorYamlSource.fileUrl ?? vendorYamlSource.path;
  yamlModulePromise ??= (async () => {
    const mod = (await import(/* @vite-ignore */ target)) as
      | { default?: unknown; stringify?: unknown }
      | undefined;
    // eemeli/yaml 的 ESM 产物是**命名导出**（无 default）；但某些打包器会补一个 default ⇒ 两者都认。
    const candidate =
      mod && typeof (mod as { stringify?: unknown }).stringify === "function" ? mod : (mod?.default ?? mod);
    if (!candidate || typeof (candidate as { stringify?: unknown }).stringify !== "function") {
      throw new EjsEnvUnavailableError(`YAML 产物不含 stringify：${target}`);
    }
    return candidate;
  })();

  try {
    yamlModuleValue = await yamlModulePromise;
  } catch (err) {
    yamlModulePromise = null; // 允许下一轮重试（首次可能在资源尚未就绪时被调用）
    warnOnce(
      "yaml-load-failed",
      "YAML 加载失败 ⇒ 用到 `YAML.stringify` 的条目会失败（P0 实测 5 次，两张卡都用到）",
      String((err as Error)?.message ?? err),
    );
    throw err;
  }
  return yamlModuleValue;
}

/** 已加载好的 YAML（未加载 ⇒ `null`）；供同步判定与快照 getter 用。 */
export function getLoadedYaml(): unknown {
  return yamlModuleValue;
}

/** 测试/探针用：直接塞一个 YAML 实现（不走 import）。 */
export function setLoadedYamlForTests(value: unknown): void {
  yamlModuleValue = value ?? null;
  yamlModulePromise = value ? Promise.resolve(value) : null;
}

// ─────────────────────────── 写入回放（重复投递时的第二道闸）───────────────────────────

/**
 * 把一个写入意图落到活快照上（`lodash.set` 语义，**路径原样**）。
 *
 * 正常路径下模板的 `setvar` **已经**改过快照（载体按引用传 env）⇒ 这里只在"同一批写入被
 * 重复交回"时起保险作用（`renderEntry` 的 `appliedWrites` 保证只回放一次）。
 *
 * ⚠️ 两条刻意的语义（与上游 + P0 桩 env 对齐，勿"顺手归一化"）：
 *   1. **路径原样**，不剥离 `stat_data.` —— ① 与 P0 判据基准一致（`verify-ejs-golden.ts:109/114`
 *      的 `_.set(vars, key, value)` 是原样全路径）；② 保护以 `stat_data` 为根的 MVU 变量树结构。
 *      （**不是**因为"剥离后读不回来"：`readPath` 的第二试仍会命中。）
 *   2. **作用域缺省 = `message`**（上游 `[variables.ts]:307` 的 `switch (scope || 'message')`）。
 *      写 message + 读 `cache` 合并视图（message 胜）⇒ 同轮后续条目能读回。
 */
export function applyWriteIntent(snapshot: EjsEnvSnapshot, rawIntent: PromptTextWriteIntent): void {
  const scope: PromptTextWriteScope =
    rawIntent?.scope === "message" || rawIntent?.scope === "chat" || rawIntent?.scope === "global"
      ? rawIntent.scope
      : "message";
  const target =
    scope === "chat" ? snapshot.variables.chat : scope === "global" ? snapshot.variables.global : snapshot.variables.message;
  const path = typeof rawIntent?.path === "string" ? rawIntent.path : "";
  if (!path || hasForbiddenSegment(path)) return;
  lodashSubset.set(target, path, rawIntent.value);
}

// ─────────────────────────── 克隆安全（诊断用）───────────────────────────

/**
 * 断言/修正：确保一个值**能**过 `structuredClone`（诊断与"可移植投影"用）。
 *
 * ⚠️ 注意：**本插件不把快照交给 postMessage**（载体按引用共享，见文件头）。本函数只用于
 *    dev-server 烟测里判断"某个值是否可克隆"，以及需要在宿主与 iframe 之间传数据时的兜底。
 */
export function assertSnapshotTransportSafe<T>(value: T): T {
  return toCloneSafe(value) as T;
}

function toCloneSafe(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return null;

  const kind = typeof value;
  if (kind === "string" || kind === "boolean") return value;
  if (kind === "number") return Number.isFinite(value as number) ? value : null;
  if (kind === "bigint") return String(value);
  if (kind === "symbol" || kind === "function") return undefined;

  const object = value as object;
  if (seen.has(object)) return undefined; // 断环
  seen.add(object);

  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return value.source;
  if (value instanceof Map) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of value as Map<unknown, unknown>) {
      const converted = toCloneSafe(v, seen);
      if (converted !== undefined) out[String(k)] = converted;
    }
    return out;
  }
  if (value instanceof Set) {
    return Array.from(value as Set<unknown>, (v) => toCloneSafe(v, seen)).filter((v) => v !== undefined);
  }
  if (Array.isArray(value)) return value.map((v) => toCloneSafe(v, seen)).map((v) => (v === undefined ? null : v));

  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const converted = toCloneSafe((value as Record<string, unknown>)[key], seen);
    if (converted !== undefined) out[key] = converted;
  }
  return out;
}

function isPlainObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ─────────────────────────── 定界符 / 块数（宿主 pre-pass 与 UI 共用口径）───────────────────────────

/**
 * 这段文本是否含 EJS 标签（**宿主 pre-pass 的判据**，与引擎的 `<%_` 硬编码预处理同口径）。
 *
 * ⚠️ 与 `[ejs.ts]:115-119` 的短路判据一致：不含 `<%` 的文本**原样返回、不求值**（M11）。
 */
export function matchesEjsTemplate(text: string): boolean {
  if (typeof text !== "string" || text.length === 0) return false;
  return text.includes(DEFAULT_OPEN_DELIMITER + DEFAULT_DELIMITER);
}

/** 块数（UI 统计用；**不做**语法级解析，等价 P0 脚本 `ejsCodeOf` 的粗略口径：408 + 594 = 1002）。 */
export function countEjsBlocks(text: string): number {
  if (!matchesEjsTemplate(text)) return 0;
  const pattern = new RegExp("<%(.*?)-?%>", "gs");
  let count = 0;
  while (pattern.exec(text) !== null) count += 1;
  return count;
}

// ─────────────────────────── 自检（dev-server 烟测用，产品路径不调用）───────────────────────────

/**
 * 快照自检：模板作用域的 7 项齐全 + 数据字段形状正确 + 非枚举写入落点可用。
 *
 * ⚠️ 自检**不**对整份快照做 `structuredClone`：快照顶层刻意带函数（模板作用域），
 *    真正交给 postMessage 的只有**数据字段**（用 `cloneSafeDataOf()` 取）。
 */
export function checkEnvSnapshot(
  snapshot: EjsEnvSnapshot,
  options: { requireHostApi?: boolean } = {},
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const record = snapshot as unknown as Record<string, unknown> | null | undefined;

  if (snapshot?.version !== EJS_ENV_SNAPSHOT_VERSION) {
    problems.push(`快照版本不符：期望 ${EJS_ENV_SNAPSHOT_VERSION}，实际 ${String(snapshot?.version)}`);
  }

  // 模板作用域 7 项
  for (const name of ["getvar", "getMessageVar", "setvar", "setMessageVar", "getwi"] as const) {
    if (typeof record?.[name] !== "function") problems.push(`快照缺符号：${name}`);
  }
  if (!record || !("YAML" in record)) problems.push("快照缺符号：YAML");
  if (!record || !("_" in record)) problems.push("快照缺符号：_");

  const store = snapshot?.variables;
  if (!store || typeof store !== "object") {
    problems.push("缺少 variables");
  } else {
    for (const scope of ["message", "chat", "global"] as const) {
      if (!isPlainObjectLike(store[scope])) problems.push(`variables.${scope} 不是对象`);
    }
    if (store.messageId !== "latest" && typeof store.messageId !== "number") {
      problems.push("variables.messageId 既不是 'latest' 也不是数字");
    }
  }
  if (!isPlainObjectLike(snapshot?.lorebook)) problems.push("lorebook 不是对象");
  if (!snapshot?.identity || typeof snapshot.identity.user !== "string" || typeof snapshot.identity.char !== "string") {
    problems.push("identity.{user,char} 必须是字符串");
  }
  if (!snapshot?.character || typeof snapshot.character.name !== "string") {
    problems.push("character.{id,name} 形状不对");
  }
  if (!snapshot?.unimplemented || typeof snapshot.unimplemented !== "object") {
    problems.push("缺少 unimplemented 抛错桩表（D11）");
  } else {
    for (const name of UNIMPLEMENTED_ENV_SYMBOLS) {
      if (typeof snapshot.unimplemented[name] !== "function") problems.push(`unimplemented 缺符号桩：${name}`);
    }
  }
  if (!snapshot?.vendor || typeof snapshot.vendor.yamlPath !== "string" || !snapshot.vendor.yamlPath) {
    problems.push("缺少 vendor.yamlPath");
  }
  // 写入落点：载体靠 `Array.isArray(env.writes)` 识别 ⇒ 必须是数组（且非枚举）
  if (!Array.isArray(record?.writes)) {
    problems.push("缺少 writes 数组落点（载体的 writesSink 认不出，写入会全部丢失）");
  } else if (record && Object.keys(record).includes("writes")) {
    problems.push("writes 落点应是**非枚举**属性（避免被当成可克隆数据）");
  }

  if (options.requireHostApi) {
    try {
      requireHostApi();
    } catch (err) {
      problems.push(String((err as Error)?.message ?? err));
    }
  }

  return { ok: problems.length === 0, problems };
}

/**
 * 取快照的**纯数据投影**（不含函数，可安全 `postMessage`）—— 烟测与"日志快照"用。
 */
export function cloneSafeDataOf(snapshot: EjsEnvSnapshot): Record<string, unknown> {
  return {
    version: snapshot.version,
    variables: toCloneSafe(snapshot.variables) as Record<string, unknown>,
    lorebook: toCloneSafe(snapshot.lorebook) as Record<string, unknown>,
    identity: toCloneSafe(snapshot.identity) as Record<string, unknown>,
    character: toCloneSafe(snapshot.character) as Record<string, unknown>,
    vendor: toCloneSafe(snapshot.vendor) as Record<string, unknown>,
    loadedAt: snapshot.loadedAt,
  };
}

/** 未实现符号的抛错演示（`EJS本地自测方法.md` O7 的判据就是它）。 */
export function callUnimplementedSymbol(snapshot: EjsEnvSnapshot, name: string): never {
  const stub = snapshot?.unimplemented?.[name];
  if (typeof stub === "function") return stub();
  throw new EjsSymbolNotImplementedError(name);
}

// ─────────────────────────── 语义自检（仓库内可复跑；对齐 lodashSubset 的自检惯例）───────────────────────────

export interface EjsEnvSelfCheckAssertion {
  /** `A` / `B` / `C`（与变更记录里的编号一致）。 */
  id: string;
  what: string;
  ok: boolean;
  expected: string;
  actual: string;
}

export interface EjsEnvSelfCheckResult {
  ok: boolean;
  checked: number;
  assertions: EjsEnvSelfCheckAssertion[];
}

/**
 * env 语义自检 —— **三条口径的常驻回归**（可复跑，不依赖浏览器；见 `EJS技术性说明.md` 的 env 章节）。
 *
 * 断言（编号与变更记录一致）：
 *   · **A** 路径原样：`setvar('stat_data.X', v)` 之后 `getvar('stat_data.X')` ⇒ `v`
 *     （**首次尝试即命中**，不依赖 `readPath` 的第二试）；
 *   · **B** 读取宽容：store 里已有 `stat_data.X` 时，`getvar('stat_data.X')` 与 `getvar('X')` **都** ⇒ `v`；
 *   · **C** 读缺省 = `cache` 合并视图：`getvar(k)`（**不带 scope**）能读到 **`message` 作用域**的值
 *     （卡里 26 次不带 scope 的 `getvar('stat_data')` 的真机命门；若只读 chat 会全部命中 `defaults`）。
 *
 * 用法：`node -e …` 不便 ⇒ 在 `npx tsx` 脚本里 `import { assertEjsEnvSelfCheck } from "…/host/env"`
 * 后调用，或直接调 `assertEjsEnvStubOnly()` 做**纯函数式**断言（不需要宿主门面）。
 *
 * ⚠️ 本函数用**临时门面桩**驱动真实实现（不落任何全局状态：结束后 `setScriptHostApi(previous)` 复原；
 *    快照用 `canonical:false` ⇒ 不进 canonical 缓存，若原本无门面则保持无门面）。
 *
 * @throws 任一条断言不满足时抛出（附实测值），便于当作断言使用
 */
export function assertEjsEnvSelfCheck(): EjsEnvSelfCheckResult {
  const previous = getScriptHostApi();

  /** NyaaChat 真机形状：变量树以 `stat_data` 为根键。 */
  const chatStore: Record<string, unknown> = { 楼层外键: "chat" };
  const messageStore: Record<string, unknown> = { 仅楼层键: "来自 message", stat_data: { 预置: { 值: "B" } } };
  const globalStore: Record<string, unknown> = { 全局开关: true };
  /** P0 桩形状：根上直接是变量树（没有 `stat_data` 这一层）⇒ 覆盖 `readPath` 的第二试。 */
  const flatMessageStore: Record<string, unknown> = { 阶段: "根上" };
  const flatChatStore: Record<string, unknown> = {};
  const flatGlobalStore: Record<string, unknown> = {};

  /** `getVariables` 的形状开关：先建真机形状快照，再切到 P0 形状建第二份。 */
  let flatMode = false;

  try {
    setScriptHostApi({
      identity: { user: "自检", char: "自检" },
      variables: {
        getVariables: (scope: ScriptHostVariableScope) =>
          flatMode
            ? scope === "message"
              ? flatMessageStore
              : scope === "chat"
                ? flatChatStore
                : flatGlobalStore
            : scope === "message"
              ? messageStore
              : scope === "chat"
                ? chatStore
                : globalStore,
        getVariableAtPath: () => undefined,
        replaceVariables: () => ({}),
        updateVariablesWith: () => ({}),
        insertVariables: () => ({}),
        deleteVariable: () => true,
        hasVariable: () => false,
      },
      messages: {},
      lorebook: { getSettings: () => ({}), getCharLorebooks: () => ({}), getEntries: () => [] },
      character: {
        getId: () => "self-check",
        getName: () => "自检",
        getScripts: () => [],
        setScripts: () => undefined,
        getWorldInfo: () => [],
      },
    } as unknown as ScriptHostApi);

    const identity = { user: "自检", char: "自检" };
    // canonical:false ⇒ 不进 canonical 缓存；结束后只复原门面
    const snapshot = buildEnvSnapshot({ characterId: "self-check", identity }, { canonical: false });
    flatMode = true;
    const flatSnapshot = buildEnvSnapshot({ characterId: "self-check-flat", identity }, { canonical: false });
    return assertEjsEnvStubOnly(snapshot, flatSnapshot);
  } finally {
    setScriptHostApi(previous);
  }
}

/** 纯断言（传入两份快照；不碰门面）—— 供 `assertEjsEnvSelfCheck()` 与外部探针复用。
 *
 *  · `snapshot`：**NyaaChat 真机形状**（变量树以 `stat_data` 为根键）；
 *  · `flatSnapshot`：**P0 桩形状**（根上直接是变量树，没有 `stat_data` 这一层）—— 用于覆盖 `readPath` 的第二试。 */
export function assertEjsEnvStubOnly(
  snapshot: EjsEnvSnapshot,
  flatSnapshot: EjsEnvSnapshot,
): EjsEnvSelfCheckResult {
  const assertions: EjsEnvSelfCheckAssertion[] = [];
  const push = (id: string, what: string, ok: boolean, expected: string, actual: unknown): void => {
    assertions.push({ id, what, ok, expected, actual: JSON.stringify(actual ?? null) });
  };

  // ── A：路径原样（首次尝试即命中） ───────────────────────────────────────
  const keyA = "stat_data.自检.信号";
  snapshot.setvar(keyA, ["A"]);
  const readA = snapshot.getvar(keyA);
  push("A", "setvar('stat_data.X') 后 getvar('stat_data.X') === v（路径原样）", JSON.stringify(readA) === JSON.stringify(["A"]), '["A"]', readA);
  const shapeA = (snapshot.variables.message as Record<string, unknown>).stat_data;
  push(
    "A",
    "写入落在 store 的 stat_data 子树（未被剥到根上）",
    typeof shapeA === "object" && shapeA !== null && "自检" in (shapeA as Record<string, unknown>),
    "message.stat_data 含 自检 子树",
    shapeA,
  );

  // ── B：读取宽容（**字面路径**命中 + **P0 形状下剥前缀**命中） ─────────────
  const full = snapshot.getvar("stat_data.预置.值");
  push("B", "字面路径命中：getvar('stat_data.预置.值') ⇒ 'B'", full === "B", '"B"', full);
  const bare = snapshot.getvar("预置.值");
  push(
    "B",
    "边界（如实标注）：字面路径不存在时**不跨层**命中 —— '预置.值' 不会穿过 stat_data 取到 B",
    bare === undefined,
    "undefined（正确行为，非缺陷）",
    bare,
  );
  const flatHit = flatSnapshot.getvar("stat_data.阶段");
  push("B", "剥前缀宽容（P0 桩形状）：根上无 stat_data 层时 getvar('stat_data.阶段') ⇒ '根上'", flatHit === "根上", '"根上"', flatHit);

  // ── C：读缺省 = cache 合并视图（含 message 作用域） ─────────────────────
  const fromMessage = snapshot.getvar("仅楼层键");
  push("C", "getvar(k) 缺省能读到 message 作用域的值", fromMessage === "来自 message", '"来自 message"', fromMessage);
  const fromChat = snapshot.getvar("楼层外键");
  push("C", "getvar(k) 缺省也能读到 chat 作用域的值（合并而非单取）", fromChat === "chat", '"chat"', fromChat);
  const fromGlobal = snapshot.getvar("全局开关");
  push("C", "getvar(k) 缺省也能读到 global 作用域的值（合并而非单取）", fromGlobal === true, "true", fromGlobal);
  // getMessageVar 与 getvar 缺省同源（上游 [variables.ts]:475-483：无 withMsg 时读 cacheVars）
  const messageVar = snapshot.getMessageVar("楼层外键");
  push("C", "getMessageVar 与 getvar 缺省同源（无 withMsg ⇒ 读 cacheVars）", messageVar === "chat", '"chat"', messageVar);
  // 显式 scope:'message' 与缺省**同源**（上游 [variables.ts]:475-483：无 withMsg ⇒ 读 cacheVars）
  const messageScoped = snapshot.getvar("楼层外键", { scope: "message" });
  push("C", "显式 scope:'message' 与缺省同源（上游无 withMsg ⇒ 读 cacheVars，非纯楼层）", messageScoped === "chat", '"chat"', messageScoped);
  // 只取当前楼层那棵树（内部路径；不是 scope:'message' 的语义）
  const floorOnly = (snapshot.variables.message as Record<string, unknown>)["楼层外键"];
  push("C", "纯楼层树可由 snapshot.variables.message 直接取（该键不在楼层里）", floorOnly === undefined, "undefined", floorOnly);

  const failed = assertions.filter((item) => !item.ok);
  if (failed.length > 0) {
    const detail = failed.map((item) => `${item.id} ${item.what}：期望 ${item.expected}，实测 ${item.actual}`).join("\n  · ");
    throw new Error(`EJS env 语义自检失败（${failed.length}/${assertions.length}）：\n  · ${detail}`);
  }
  return { ok: true, checked: assertions.length, assertions };
}
