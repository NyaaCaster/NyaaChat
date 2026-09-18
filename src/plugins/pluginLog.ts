/**
 * 插件观测层（P6）—— **叶子模块**，当前**零 import**（连 `../types` 都不需要）。
 *
 * ## 为什么必须是叶子（改这里前务必读懂）
 *
 * 与 `src/plugins/hostContext.ts` 完全同源的理由（那份注释记录了 t12 的断环事故）：
 *
 * ```
 * plugins/registry → quote-tts/plugin → quote-tts/QuoteTtsSettings → src/plugins/pluginLog
 *                  → src/plugins/registry → ../../plugins/registry （回到起点）  ← 环！
 * ```
 *
 * 插件实现要能直接 `import { pluginLogger } from "../../src/plugins/pluginLog"`（见下「API」），
 * 所以本文件**不得** import `./registry` / `./runtime` / `./backend` / `./normalize` /
 * `./index`、`src/lib/**`、`src/components/**` —— 任何一条都会立刻重建上述模块环，使
 * "直接 import 插件模块"时注册表出现 `undefined` 槽位、插件静默消失。该约束由
 * `dev-server/tools/check-plugin-log.ts` 的**源码扫描断言**机器化守护。
 *
 * ## 记录什么（对应 P6 补齐的三个"无声"缺口）
 *
 * 框架原先只在控制台打 `[plugins] …`，普通用户看不到任何东西，且部分报错连"是哪个插件"
 * 都打不出来。本模块把"控制台追踪"与"用户可见"合并成**一条**写入路径：
 *
 *  · F1 统一格式：`[plugins:<pluginId>] <scope> — <message>`（未归属时前缀退化为 `[plugins]`），
 *    且**原始 Error 作为额外的 console 参数**传下去（`console.error(line, err)`），不丢栈；
 *  · F2 事件处理器归属：`runtime.ts` 的事件总线按 `{ pluginId, handler }` 记录归属，处理器
 *    抛错时能打出是哪个插件；
 *  · F6 后端调用留痕：`backend.ts` 在抛出前记录 capability + HTTP 状态 + 响应片段；
 *  · F4 全局兜底：`installPluginErrorSafetyNet()` 捕获 `window` 的 `error` /
 *    `unhandledrejection`，按 stack / filename 里的 `plugins/<id>/` 尽力归属。
 *
 * （F5 —— iframe 内卡片脚本的错误捕获 —— 属脚本执行器 P3，不在本模块。）
 *
 * ## API
 *
 * | 出口 | 用途 |
 * |---|---|
 * | `pluginLogger(pluginId)` | 插件自用：`.error(scope, message, err?)` / `.warn(…)` / `.info(…)` |
 * | `recordPluginError` / `recordPluginWarn` | 与 `pluginLogger` 等价的函数式入口 |
 * | `recordFrameworkError` / `recordFrameworkWarn` | **框架自身**（无插件归属）→ 前缀 `[plugins]` |
 * | `recordPluginInfo` | 只在 `import.meta.env.DEV` 时打控制台，**不入环形缓冲** |
 * | `getPluginErrors(id)` / `getAllPluginErrors()` / `getPluginErrorCounts()` | 读快照（引用稳定，供 `useSyncExternalStore`） |
 * | `clearPluginErrors(id?)` / `subscribePluginErrors(fn)` | 清空 / 订阅 |
 * | `installPluginErrorSafetyNet(target?)` / `uninstallPluginErrorSafetyNet()` / `isPluginErrorSafetyNetInstalled()` | F4 全局兜底 |
 * | `resetPluginLogForTests()` | 探针 / 验证脚本用（生产代码不调用） |
 * | `setPluginLogDevForTests(dev)` | 覆盖 DEV 判定，让验证脚本能驱动 `info` 的两条分支 |
 * | `formatPluginLogLine` / `attributePluginFromText` / `errorMessageOf` | 纯函数，导出以便独立验证 |
 *
 * 相对任务卡上的最小 API 有 4 处**增量**（不改既有语义）：`recordPluginWarn` /
 * `recordPluginInfo` / `recordFrameworkError(Warn)` / `getPluginErrorCounts()`（列表行角标用），
 * 以及 `installPluginErrorSafetyNet(target?)` 的可选参数（**只为探针/验证脚本可注入假 target**，
 * 生产调用点 `installPluginErrorSafetyNet()` 一行不变）。⚠️ 调用点在 t6 的 `src/App.tsx`，
 * 本模块**自己不做任何安装**。
 *
 * ## 语义细则（容易踩的点）
 *
 *  · **每插件环形缓冲上限 20**：新记录进队首，超出丢**最旧**的；`getPluginErrors` 返回的
 *    数组恒为"最新在前"。
 *  · **连续去重**：新记录与队首记录的 `(level, scope, message)` 完全相同时不新增记录、不再
 *    打控制台，只把队首的 `count + 1` 并**保留最新一次的 stack**；`at` 保持首次出现的时间
 *    （"首见时间"不会被逐帧刷新淹没）。level 并入去重键是**刻意的**：同一 scope/message
 *    先 warn 后 error 时不该合并成一条、把 error 降级成 warn。
 *  · `info` 只打控制台、不入缓冲 —— 记录类型只有 `error | warn` 两级。
 *  · `record()` 是本文件**唯一**允许直接调用 `console.*` 的地方（它是日志器本身）；
 *    `pluginLog` 订阅者抛错时也直接 `console.error`（把该错误再写回本模块会递归）。
 *  · 未归属记录挂在伪 id `"(未归属)"` 下（控制台前缀 `[plugins]`）。扩展面板只列**已注册
 *    插件**，因此这些记录不会出现在 UI 里，只在控制台可见 —— 这是刻意的：它们的成因
 *    通常是框架自身的 bug 或第三方代码，不是某个插件的锅。
 */

/** 记录级别。`info` 不入缓冲（见文件头），所以类型只有两级。 */
export type PluginLogLevel = "error" | "warn";

export interface PluginLogRecord {
  /** 全局唯一（`<pluginId>#<递增序号>`），可直接当 React key。 */
  id: string;
  /** 首次出现时间（epoch ms）；连续重复去重时不刷新。 */
  at: number;
  level: PluginLogLevel;
  /** 发生位置，如 `setup` / `event "message:received"` / `backend.quote-tts.speech`。 */
  scope: string;
  /** 单条消息（UI 取首行展示，展开看 stack）。 */
  message: string;
  /** 原始 Error 的 stack（有则保留，去重时取最新一次）。 */
  stack?: string;
  /** 连续重复次数（首条为 1）。 */
  count: number;
}

/** 每插件环形缓冲上限（超出丢最旧）。 */
export const PLUGIN_LOG_LIMIT = 20;

/** 归属不到任何插件时的伪 id（控制台前缀退化为 `[plugins]`）。 */
export const UNATTRIBUTED_PLUGIN_ID = "(未归属)";

/** 全局兜底的 scope 名。 */
export const SAFETY_NET_ERROR_SCOPE = "window.error";
export const SAFETY_NET_REJECTION_SCOPE = "unhandledrejection";

/** 快照读取方（`useSyncExternalStore`）在无记录时拿到的共享空数组。 */
const EMPTY_RECORDS: PluginLogRecord[] = [];

/** pluginId → 记录（**最新在前**）。每次变更整体替换为不可变新数组。 */
const recordsByPlugin = new Map<string, PluginLogRecord[]>();
/** `getAllPluginErrors()` 的稳定快照（任一变更时重建）。 */
let allSnapshot: Record<string, PluginLogRecord[]> = {};
/** `getPluginErrorCounts()` 的稳定快照（只统计 `level === "error"` 的**记录条数**）。 */
let countsSnapshot: Record<string, number> = {};
const listeners = new Set<() => void>();
let nextRecordSeq = 0;

/** 统一控制台行：`[plugins:<id>] <scope> — <message>`（未归属 → `[plugins] <scope> — <message>`）。 */
export function formatPluginLogLine(pluginId: string, scope: string, message: string): string {
  const prefix =
    pluginId && pluginId !== UNATTRIBUTED_PLUGIN_ID
      ? `[plugins:${pluginId}]`
      : "[plugins]";
  return `${prefix} ${scope} — ${message}`;
}

/** 从任意错误值里取一条人可读消息（取不到返回 undefined）。 */
export function errorMessageOf(err: unknown): string | undefined {
  if (err instanceof Error) return err.message || err.name;
  if (typeof err === "string") return err || undefined;
  if (err === undefined || err === null) return undefined;
  if (typeof err === "object") {
    try {
      const json = JSON.stringify(err);
      if (json && json !== "{}") return json;
    } catch {
      /* 循环引用等：退化到 String() */
    }
  }
  if (typeof err === "function") return err.name || undefined;
  return String(err);
}

function stackOf(err: unknown): string | undefined {
  if (err instanceof Error && typeof err.stack === "string" && err.stack) return err.stack;
  return undefined;
}

/** `plugins/<id>/` 目录片段。边界允许**行首 / 空白 / 斜杠 / 反斜杠 / 左括号**：
 *  栈帧里既可能是绝对 URL（`http://host/plugins/a/b.ts`，前面是 `/`），
 *  也可能是相对路径（`at plugins/a/b.ts:1:1` 或 `at fn (plugins/a/b.ts:1:1)`，前面是空白/`(`）。 */
const PLUGIN_DIR_RE = /(?:^|[\s\\/(])plugins[\\/]([A-Za-z0-9._-]+)[\\/]/;

/**
 * 从若干候选文本（依次尝试 stack → filename → sourceURL）里尽力归属插件。
 *
 * ⚠️ **只是尽力而为**：生产构建会把 `plugins/**` 打进主 chunk，栈里不再有
 * `plugins/<id>/` 片段，此时归到 `(未归属)`。这是已知边界，不是 bug（F4 的价值主要
 * 在开发期与未打包资源；iframe 内脚本的错误由 P3 的 ScriptHost 负责，见 F5）。
 */
export function attributePluginFromText(...texts: Array<string | undefined>): string {
  for (const text of texts) {
    if (!text) continue;
    const match = PLUGIN_DIR_RE.exec(text);
    if (match?.[1]) return match[1];
  }
  return UNATTRIBUTED_PLUGIN_ID;
}

/** 重建两份对外快照（`useSyncExternalStore` 要求"没变就同一引用"）。 */
function rebuildSnapshots(): void {
  const all: Record<string, PluginLogRecord[]> = {};
  const counts: Record<string, number> = {};
  for (const [pluginId, list] of recordsByPlugin) {
    if (list.length === 0) continue;
    all[pluginId] = list;
    const errors = list.reduce((n, record) => (record.level === "error" ? n + 1 : n), 0);
    if (errors > 0) counts[pluginId] = errors;
  }
  allSnapshot = all;
  countsSnapshot = counts;
}

function notify(): void {
  // 逐个 try/catch：一个订阅者抛错不能拖垮其它订阅者，也不能中断记录流程。
  // ⚠️ 刻意**直接** console.error（不走 record）：否则订阅者抛错会再次进入本模块 → 递归。
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (err) {
      console.error("[plugins] pluginLog 订阅者抛错", err);
    }
  }
}

/**
 * 写入一条记录（本模块的唯一内部写入路径）。
 *
 * 返回落库后的记录（去重时返回被合并的那条）。
 */
function record(
  pluginId: string,
  level: PluginLogLevel,
  scope: string,
  message: string,
  err?: unknown,
): PluginLogRecord {
  const id = typeof pluginId === "string" && pluginId.trim() ? pluginId : UNATTRIBUTED_PLUGIN_ID;
  const list = recordsByPlugin.get(id) ?? [];
  const stack = stackOf(err);
  const latest = list[0];

  // ── 连续重复去重：只累计 count + 取最新 stack，不再打控制台 ──────────────
  if (latest && latest.level === level && latest.scope === scope && latest.message === message) {
    const merged: PluginLogRecord = {
      ...latest,
      count: latest.count + 1,
      stack: stack ?? latest.stack,
    };
    recordsByPlugin.set(id, [merged, ...list.slice(1)]);
    rebuildSnapshots();
    notify();
    return merged;
  }

  const entry: PluginLogRecord = {
    id: `${id}#${++nextRecordSeq}`,
    at: Date.now(),
    level,
    scope,
    message,
    stack,
    count: 1,
  };

  const next = [entry, ...list];
  recordsByPlugin.set(id, next.length > PLUGIN_LOG_LIMIT ? next.slice(0, PLUGIN_LOG_LIMIT) : next);
  rebuildSnapshots();

  // ⚠️ 原始 Error 必须作为**额外参数**传下去：只打 String(err) 会丢掉栈。
  // ⚠️ **控制台输出按"发行版隔离"分档**（2026-09-18）：
  //   · `error` —— **永远**写控制台（真失败；藏起来等于让用户无从自查）；
  //   · `warn`  —— **仅开发实例**写控制台。注意**只隔离控制台**：环形缓冲、快照、
  //                扩展面板里的运行日志**照常记录**（面板才是发行版的用户可见通道）。
  if (isDevBuild() || level === "error") {
    const line = formatPluginLogLine(id, scope, message);
    if (level === "error") {
      if (err === undefined) console.error(line);
      else console.error(line, err);
    } else if (err === undefined) {
      console.warn(line);
    } else {
      console.warn(line, err);
    }
  }

  notify();
  return entry;
}

// ── 对外写入 API ────────────────────────────────────────────────────────────

/** 记录一条插件级错误（框架内部直接调用的入口）。 */
export function recordPluginError(
  pluginId: string,
  scope: string,
  message: string,
  err?: unknown,
): PluginLogRecord {
  return record(pluginId, "error", scope, message, err);
}

/** 记录一条插件级警告。 */
export function recordPluginWarn(
  pluginId: string,
  scope: string,
  message: string,
  err?: unknown,
): PluginLogRecord {
  return record(pluginId, "warn", scope, message, err);
}

/** 记录一条**框架自身**的错误（无插件归属 ⇒ 前缀 `[plugins]`）。 */
export function recordFrameworkError(scope: string, message: string, err?: unknown): PluginLogRecord {
  return record(UNATTRIBUTED_PLUGIN_ID, "error", scope, message, err);
}

/** 记录一条**框架自身**的警告。 */
export function recordFrameworkWarn(scope: string, message: string, err?: unknown): PluginLogRecord {
  return record(UNATTRIBUTED_PLUGIN_ID, "warn", scope, message, err);
}

/** Vite 的 DEV 标志。⚠️ 用转型 + 可选链而非字面量 `import.meta.env.DEV`：本模块也要能被
 *  `tsx`/node 直接加载（验证脚本、探针），node 下 `import.meta.env` 为 `undefined`，
 *  字面量形式会在取值时抛 TypeError。dev 构建下 Vite 仍会注入该对象。 */
function isDevBuild(): boolean {
  if (devOverride !== null) return devOverride;
  try {
    const meta = import.meta as unknown as { env?: { DEV?: boolean } };
    if (meta.env?.DEV === true) return true;
  } catch {
    /* node/tsx 下 import.meta.env 可能不存在（见上方注释） */
  }
  // ⚠️ **不能只看 `import.meta.env.DEV`**（2026-09-18 修正）：dev 实例
  // （`nyaachat-dev-app`）本身就是**production 构建** —— `dev-server/Dockerfile` 先跑
  // `patches/apply.mjs` 再跑 `npm run build` ⇒ `import.meta.env.DEV` 在 dev 镜像里**同样是
  // false**。只看它会让"开发监控"在 dev 里也一起消失，或反过来在发行版里照旧输出。
  // 真正的判别是 dev-only 补丁注入的标记 `window.__nyaachatDevLog`
  // （`03-inject-console-collector.mjs` 把 `<script src="/dev-server...console-collector.js">`
  // 插在 `</head>` 之前，先于应用 bundle 执行；发行版镜像没有这个脚本）。
  try {
    return Boolean((globalThis as unknown as { __nyaachatDevLog?: unknown }).__nyaachatDevLog);
  } catch {
    return false;
  }
}

/** DEV 判定覆盖值（`null` = 跟随构建环境）。只为验证脚本能真实驱动 info 的两条分支。 */
let devOverride: boolean | null = null;

/** 验证脚本/探针用：覆盖 DEV 判定（`null` 复位）。生产代码不调用。 */
export function setPluginLogDevForTests(dev: boolean | null): void {
  devOverride = dev;
}

/** 仅开发期可见的信息日志（**不入环形缓冲** —— 记录类型只有 error/warn）。 */
export function recordPluginInfo(pluginId: string, scope: string, message: string, ...rest: unknown[]): void {
  if (!isDevBuild()) return;
  const line = formatPluginLogLine(pluginId, scope, message);
  if (rest.length === 0) console.info(line);
  else console.info(line, ...rest);
}

/**
 * 原始诊断输出的 **dev 闸门** —— 给**不走 `pluginLog`** 的调用点用。
 *
 * 用途：`[frontend-card] 切分结果` / `[regex-chain] …` / 各插件叶子模块里的 `console.warn`
 * 这类**移植期诊断**，它们不进插件日志环形缓冲、只往控制台喊 ⇒ 发行版里必须静音。
 * 判据与 `record()` **完全同源**（同一个 `isDevBuild()`），避免出现两套 dev 判别而漂移。
 */
export function isDevConsoleEnabled(): boolean {
  return isDevBuild();
}

/** 仅开发实例可见的 `console.info`（发行版是 no-op）。 */
export function devInfo(message: string, ...rest: unknown[]): void {
  if (!isDevBuild()) return;
  if (rest.length === 0) console.info(message);
  else console.info(message, ...rest);
}

/** 仅开发实例可见的 `console.warn`（发行版是 no-op）。 */
export function devWarn(message: string, ...rest: unknown[]): void {
  if (!isDevBuild()) return;
  if (rest.length === 0) console.warn(message);
  else console.warn(message, ...rest);
}

/** 插件自用的带归属日志器（`pluginId` 由插件模块自己传入，通常是常量 `PLUGIN_ID`）。 */
export function pluginLogger(pluginId: string) {
  return {
    error: (scope: string, message: string, err?: unknown): void => {
      record(pluginId, "error", scope, message, err);
    },
    warn: (scope: string, message: string, err?: unknown): void => {
      record(pluginId, "warn", scope, message, err);
    },
    info: (scope: string, message: string, ...rest: unknown[]): void => {
      recordPluginInfo(pluginId, scope, message, ...rest);
    },
  };
}

export type PluginLogger = ReturnType<typeof pluginLogger>;

// ── 对外读取 API ────────────────────────────────────────────────────────────

/** 某插件的全部记录（最新在前）。无记录时返回共享空数组（引用稳定）。 */
export function getPluginErrors(pluginId: string): PluginLogRecord[] {
  return recordsByPlugin.get(pluginId) ?? EMPTY_RECORDS;
}

/** 全部插件的记录快照（引用稳定，仅在变更时替换）。 */
export function getAllPluginErrors(): Record<string, PluginLogRecord[]> {
  return allSnapshot;
}

/** pluginId → error 级**记录条数**（> 0 才出现；扩展面板列表行角标用）。 */
export function getPluginErrorCounts(): Record<string, number> {
  return countsSnapshot;
}

/** 订阅任意变更（新增 / 去重累计 / 清空）。返回取消订阅函数。 */
export function subscribePluginErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 清空（省略 `pluginId` 则清空全部）。无变化时不发通知。 */
export function clearPluginErrors(pluginId?: string): void {
  const had =
    pluginId === undefined ? recordsByPlugin.size > 0 : (recordsByPlugin.get(pluginId)?.length ?? 0) > 0;
  if (pluginId === undefined) recordsByPlugin.clear();
  else recordsByPlugin.delete(pluginId);
  if (!had) return;
  rebuildSnapshots();
  notify();
}

// ── F4：全局兜底 ────────────────────────────────────────────────────────────

/** 兜底需要的最小事件目标（`window` 满足；探针可传假对象）。 */
export interface PluginErrorEventTarget {
  addEventListener: (type: string, listener: (event: unknown) => void) => void;
  removeEventListener: (type: string, listener: (event: unknown) => void) => void;
}

let safetyNetTarget: PluginErrorEventTarget | null = null;
let safetyNetHandlers: {
  error: (event: unknown) => void;
  rejection: (event: unknown) => void;
} | null = null;

/** 浏览器里默认目标：`window`（`globalThis === window`；node 下返回 null）。 */
function defaultSafetyNetTarget(): PluginErrorEventTarget | null {
  const candidate = globalThis as unknown as Partial<PluginErrorEventTarget> & {
    window?: PluginErrorEventTarget;
  };
  const target = candidate?.window ?? candidate;
  if (!target || typeof target.addEventListener !== "function") return null;
  if (typeof target.removeEventListener !== "function") return null;
  return target as PluginErrorEventTarget;
}

/** `window.onerror` → 记录（**不** preventDefault）。 */
function handleSafetyNetError(event: unknown): void {
  const detail = (event ?? {}) as {
    error?: unknown;
    message?: unknown;
    filename?: unknown;
    lineno?: unknown;
    colno?: unknown;
  };
  const raw = detail.error;
  const location = [detail.filename, detail.lineno, detail.colno]
    .filter((part) => part !== undefined && part !== null && part !== "")
    .join(":");
  const base =
    errorMessageOf(raw) ??
    (typeof detail.message === "string" && detail.message ? detail.message : "脚本错误");
  // 原始文件/行号必须留在消息里（这是归属的唯一线索，也是排障所需）。
  const message = location && !base.includes(location) ? `${base}（${location}）` : base;
  const pluginId = attributePluginFromText(
    stackOf(raw),
    typeof detail.filename === "string" ? detail.filename : undefined,
  );
  // ⚠️ 只记录、不 preventDefault、不吞异常：浏览器自身的错误输出与既有全局处理保持不变。
  record(pluginId, "error", SAFETY_NET_ERROR_SCOPE, message, raw ?? (location || undefined));
}

/** `unhandledrejection` → 记录（**不** preventDefault）。 */
function handleSafetyNetRejection(event: unknown): void {
  const detail = (event ?? {}) as { reason?: unknown };
  const raw = detail.reason;
  const message = errorMessageOf(raw) ?? "未处理的 Promise 拒绝（reason 不是 Error/string）";
  const pluginId = attributePluginFromText(stackOf(raw));
  // ⚠️ 同上：只记录。`preventDefault()` 会抑制浏览器自己的"Uncaught (in promise)"输出，
  // 那是排障信息，不能替用户吞掉。
  record(pluginId, "error", SAFETY_NET_REJECTION_SCOPE, message, raw);
}

/**
 * 安装全局错误兜底（F4）。**幂等**：已安装时直接返回。
 *
 * ⚠️ **调用点由 t6 在 `src/App.tsx` 接线**（本任务只实现 + 导出，不在任何地方调用）。
 * `target` 参数只为探针/验证脚本注入假事件目标（node 里没有 `window`）。
 */
export function installPluginErrorSafetyNet(target?: PluginErrorEventTarget): void {
  if (safetyNetHandlers) return;
  const resolved = target ?? defaultSafetyNetTarget();
  if (!resolved) {
    // 非浏览器且未显式传 target：如实告警，不静默假装装好了。
    console.warn("[plugins] 全局错误兜底未安装：当前环境没有可用的 addEventListener");
    return;
  }
  const handlers = { error: handleSafetyNetError, rejection: handleSafetyNetRejection };
  safetyNetTarget = resolved;
  safetyNetHandlers = handlers;
  resolved.addEventListener("error", handlers.error);
  resolved.addEventListener("unhandledrejection", handlers.rejection);
}

/** 卸载（幂等）。主要给验证脚本在用例之间复位用。 */
export function uninstallPluginErrorSafetyNet(): void {
  if (!safetyNetTarget || !safetyNetHandlers) return;
  const target = safetyNetTarget;
  const handlers = safetyNetHandlers;
  safetyNetTarget = null;
  safetyNetHandlers = null;
  target.removeEventListener("error", handlers.error);
  target.removeEventListener("unhandledrejection", handlers.rejection);
}

export function isPluginErrorSafetyNetInstalled(): boolean {
  return safetyNetHandlers !== null;
}

/** 清空全部记录 + 复位序号 + 卸载兜底 + 复位 DEV 覆盖（验证脚本/探针用；生产代码不调用）。 */
export function resetPluginLogForTests(): void {
  uninstallPluginErrorSafetyNet();
  recordsByPlugin.clear();
  allSnapshot = {};
  countsSnapshot = {};
  nextRecordSeq = 0;
  devOverride = null;
  notify();
}
