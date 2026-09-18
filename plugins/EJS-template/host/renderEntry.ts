/**
 * EJS 模板插件 · **单条目渲染编排**（SSOT §2.5 / §3.3；技术性说明 §4）
 *
 * 职责：把「一条含 EJS 的世界书条目」交给载体（`host/carrier.ts`）渲染，并把三件必须由宿主
 * 负责的事做掉 —— 这三件正是本模块存在的理由：
 *
 *   ① **幂等**（D9）：同一 `(轮次, 条目)` **恰好渲染一次**。重复调用直接返回上一次的结果，
 *      不重新执行模板（模板可能有副作用：`_.random`、`setvar`、死循环）。
 *   ② **写入收集**（D9）：载体回传的 `writes[]` 原样交给调用方，由宿主统一提交一次；
 *      本模块**不碰**变量持久层（门面根本没有写入口径，见 `env.ts` 头注）。
 *   ③ **写入回放**（D9 保真，第二道闸）：载体重试导致的重复投递不会让同一批写入落两次。
 *
 * ── 「轮次」是什么（与 `env.ts` / 载体的实际接口对齐）────────────────────────────
 *   `env.ts` 的 `buildEnvSnapshot()` 在**同一会话**内复用同一份活快照；载体把该对象**按引用**
 *   交给 iframe（`slot.env`）⇒ 模板里 `setvar` 改的就是宿主侧这份对象。
 *   因此"轮次"的天然标识就是**快照对象身份**（WeakMap 记一个内部序号）。
 *   `plugin.tsx` 的写法正是 `state.envSnapshot ??= buildEnvSnapshot(...)`（每轮一份，轮内复用），
 *   于是本模块无需会话参数即可实现"每轮每条目恰好一次"；未来若有了显式 `turnId[]`，传
 *   `session: {sessionId, turnId}` 会覆盖该身份（两者语义一致）。
 *
 * ── 载体接口（按 `carrier.ts` 冻结签名；此处用结构化局部声明，避免并行期的跨模块耦合）──
 *   `render(reqs, envSnapshot)`：`reqs[].id` 回传时原样带回（本模块按条目 id 取结果）；
 *   `envSnapshot` 就是模板的 `locals`（见 `env.ts` 头注）。
 *
 * ⚠️ 纪律：只改本文件与 `env.ts`；不 import 宿主 `registry` / `runtime` / `backend`；
 *    不使用 `eval` / `new Function`（执行全程在载体的内联 `<script>` 里）。
 */

import {
  EJS_TEMPLATE_PLUGIN_ID,
  emptyEnvSnapshot,
  applyWriteIntent,
  countEjsBlocks,
  type EjsEnvSnapshot,
  type PromptTextWriteIntent,
  type PromptTextWriteScope,
} from "./env";
import { compileTemplate, hashTemplate } from "../engine/compile";
// 宿主叶子模块：下面三条是**降级诊断**（面板里另有「最近一次错误 / 运行日志」两个可见通道），
// 发行版静音、dev 实例照打 —— 判据与宿主插件日志同源，见 `pluginLog.isDevBuild`。
import { devWarn } from "../../../src/plugins/pluginLog";

// ─────────────────────────── 载体接口（冻结形状，结构化声明）───────────────────────────

/** `carrier.ts` 的 `CarrierRenderRequest`（逐字段一致）。 */
export interface CarrierRenderCall {
  id: string;
  templateHash: string;
  functionBody: string;
}

/** 载体回传的写入意图（`scope` 缺省 = `message`，与 ST 的 `setMessageVar` 缺省一致）。 */
export interface CarrierWriteIntent {
  path: string;
  value: unknown;
  scope?: PromptTextWriteScope | (string & {});
  messageId?: number | "latest";
}

/** `carrier.ts` 的 `CarrierRenderResult`（只声明本模块用到的字段）。 */
export interface CarrierRenderOutcome {
  id: string;
  ok: boolean;
  text?: string;
  error?: string;
  writes?: CarrierWriteIntent[];
}

export interface CarrierLike {
  render(
    reqs: readonly CarrierRenderCall[],
    envSnapshot: Record<string, unknown>,
  ): Promise<readonly CarrierRenderOutcome[]>;
  destroy?(): void;
}

// ─────────────────────────── 结果与选项 ───────────────────────────

export type RenderEntryOutcome = "ok" | "error" | "degraded" | "timeout" | "skipped";

export interface RenderEntryResult {
  /** 渲染文本；失败/跳过时为空串（**绝不回吐 `<% %>` 原文**，SSOT §2.7）。 */
  text: string;
  /** 本条目产生的写入意图（宿主统一提交）。 */
  writes: PromptTextWriteIntent[];
  /** 失败原因（用户可读的短句；完整文案由 `errors.ts` 生成）。 */
  error?: string;
  outcome: RenderEntryOutcome;
  /** 本轮执行耗时（幂等命中/跳过时为 0）。 */
  elapsedMs: number;
  /** 该条目在这次调用里是否真的执行了模板（`false` = 幂等命中或失败降级）。 */
  executed: boolean;
}

export interface RenderEntryInput {
  id: string;
  /** 条目正文（**已跑完前缀链**：占位符 → 变量宏 → 正则，D16-R 选项 A）。 */
  content: string;
  /** 条目名（UI/错误文案用；缺省用 `id`）。 */
  name?: string;
  /**
   * 可选：`compileTemplate()` 的产物。**缺省时本模块自行编译整份 `content`**
   * ——（`plugin.tsx` / 设置面板的试渲染都走这条路径，与冻结签名一致）。
   */
  calls?: readonly CarrierRenderCall[];
  /** 内容指纹（诊断/日志；缺省由 `content` 现算）。 */
  contentHash?: string;
}

export interface RenderEntryOptions {
  /**
   * 显式轮次标识（`{ sessionId, turnId }`）；给了它就按它去重，而不是按快照对象身份。
   * 不传时用快照身份 —— `plugin.tsx` 每轮 `buildEnvSnapshot` 一次，语义等价。
   */
  session?: unknown;
  /**
   * `true` ⇒ **纯只读试渲染**：不参与本轮幂等（用临时身份），写入不落快照。
   * 插件 UI 的"试渲染"用它（SSOT §8：只读，不提交写入）。
   */
  standalone?: boolean;
  /** 结果观察钩子（UI 统计 / 插件日志）。**抛错不影响渲染**。 */
  onResult?: (info: RenderEntryObserverInfo) => void;
}

export interface RenderEntryObserverInfo {
  pluginId: string;
  entryId: string;
  entryName: string;
  /** 本条目的 EJS 块数（粗口径，与 P0 的 `ejsCodeOf` 一致）。 */
  blocks: number;
  sessionId: string | null;
  turnId: string | null;
  outcome: RenderEntryOutcome;
  executed: boolean;
  elapsedMs: number;
  textLength: number;
  writes: readonly PromptTextWriteIntent[];
  error?: string;
}

// ─────────────────────────── 编译（`engine/compile.ts`，不含任何动态求值）───────────────────────────

/** 进程内编译缓存：`templateHash` → 调用数组（与载体的函数缓存同一枚指纹）。 */
const compiledCalls = new Map<string, readonly CarrierRenderCall[]>();
const COMPILE_CACHE_LIMIT = 64;

type CompileOutcome =
  | { ok: true; calls: readonly CarrierRenderCall[] }
  | { ok: false; error: string };

/**
 * 编译一份条目正文（幂等、可抛错转文案）。
 *
 * ⚠️ **一个条目 = 一次调用**：整份正文交给 `compileTemplate()` 生成**单个**函数体
 *    （它内部逐 token 处理**全部** EJS 块）。这样"条目恰好渲染一次"与
 *    "carrier 按 templateHash 缓存注入"两条约束同时成立。
 */
function compileOnce(entryId: string, content: string): CompileOutcome {
  const key = `${entryId}\u0000${hashTemplate(content)}`;
  const cached = compiledCalls.get(key);
  if (cached) return { ok: true, calls: cached };
  try {
    const compiled = compileTemplate(content);
    const calls: readonly CarrierRenderCall[] = [
      // ⚠️ `id` 必须是**条目 id**：载体回传时原样带回，本模块据此取回该条目的结果。
      { id: entryId, templateHash: compiled.templateHash, functionBody: compiled.body },
    ];
    compiledCalls.set(key, calls);
    if (compiledCalls.size > COMPILE_CACHE_LIMIT) {
      const oldest = compiledCalls.keys().next();
      if (!oldest.done) compiledCalls.delete(oldest.value);
    }
    return { ok: true, calls };
  } catch (err) {
    return { ok: false, error: String((err as Error)?.message ?? err) || "EJS 模板编译失败" };
  }
}

/** 测试/探针用：清空编译缓存（生产代码不调用）。 */
export function resetCompileCacheForTests(): void {
  compiledCalls.clear();
}

// ─────────────────────────── 内部台账 ───────────────────────────
//
//   snapshotScopes  快照对象 → 内部轮次序号（"轮次 = 快照身份"的落地）
//   sessionScopes   显式 session 对象 → `{sessionId, turnId}`
//   standaloneScopes 试渲染用的临时对象 → 临时轮次序号（与幂等表分开）
//   delivered       `轮次序号:条目` → 已交付结果（幂等命中时**原样**返回）
//   appliedWrites   `轮次序号:条目` → 该条目的写入是否已回放（重复投递的第二道闸）

const snapshotScopes = new WeakMap<object, string>();
/** 试渲染的临时轮次序号（与幂等表**分开**，避免借用被渲染快照的轮次身份）。 */
const standaloneScopes = new WeakMap<object, string>();
const sessionScopes = new WeakMap<object, { sessionId: string; turnId: string }>();
const delivered = new Map<string, RenderEntryResult>();
const appliedWrites = new Set<string>();
let nextScopeSeq = 1;

const GLOBAL_TABLE_LIMIT = 512;

interface ScopeIdentity {
  scopeKey: string;
  sessionId: string | null;
  turnId: string | null;
}

function scopeOfSession(session: unknown): ScopeIdentity | null {
  if (!session || typeof session !== "object") return null;
  let record = sessionScopes.get(session as object);
  if (!record) {
    const candidate = session as { sessionId?: unknown; turnId?: unknown };
    const turnId = typeof candidate.turnId === "string" && candidate.turnId ? candidate.turnId : "";
    if (!turnId) return null;
    const sessionId =
      typeof candidate.sessionId === "string" && candidate.sessionId ? candidate.sessionId : "session";
    record = { sessionId, turnId };
    sessionScopes.set(session as object, record);
  }
  return { scopeKey: `t:${record.sessionId}:${record.turnId}`, sessionId: record.sessionId, turnId: record.turnId };
}

function scopeOfSnapshot(snapshot: unknown, standalone: boolean): ScopeIdentity | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const object = snapshot as object;
  const table = standalone ? standaloneScopes : snapshotScopes;
  let key = table.get(object);
  if (!key) {
    key = `${standalone ? "standalone" : "turn"}-${nextScopeSeq}`;
    nextScopeSeq += 1;
    table.set(object, key);
  }
  return { scopeKey: key, sessionId: null, turnId: null };
}

function dedupeKeyOf(scopeKey: string, entryId: string): string {
  return `${scopeKey}\u0000${entryId}`;
}

/** 夹逼全局台账（幂等表只增不减会泄漏；只在本模块层面裁剪）。 */
function trimGlobalTables(): void {
  const trim = (map: Map<string, unknown>): void => {
    let drop = map.size - GLOBAL_TABLE_LIMIT;
    if (drop <= 0) return;
    for (const key of map.keys()) {
      if (drop-- <= 0) break;
      map.delete(key);
    }
  };
  trim(delivered as Map<string, unknown>);
  if (appliedWrites.size > GLOBAL_TABLE_LIMIT) {
    let drop = appliedWrites.size - GLOBAL_TABLE_LIMIT;
    for (const key of appliedWrites.keys()) {
      if (drop-- <= 0) break;
      appliedWrites.delete(key);
    }
  }
}

/** 测试/探针用：清空幂等与写入回放台账（生产代码不调用）。 */
export function resetRenderEntryMemoryForTests(): void {
  delivered.clear();
  appliedWrites.clear();
}

/** 台账诊断（UI/测试读当前幂等表规模）。 */
export function renderEntryMemorySize(): { delivered: number; appliedWrites: number } {
  return { delivered: delivered.size, appliedWrites: appliedWrites.size };
}

// ─────────────────────────── 写入意图归一化 ───────────────────────────

function normalizeWrite(raw: unknown): PromptTextWriteIntent | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { path?: unknown; value?: unknown; scope?: unknown; messageId?: unknown };
  const path = typeof candidate.path === "string" ? candidate.path : "";
  if (!path) return null;
  return {
    path,
    value: candidate.value ?? null,
    scope:
      candidate.scope === "message" || candidate.scope === "chat" || candidate.scope === "global"
        ? candidate.scope
        : "message",
    ...(candidate.messageId === undefined ? {} : { messageId: candidate.messageId as number | "latest" }),
  };
}

/**
 * 写入回放 —— **同一 (轮次, 条目) 只回放一次**。
 *
 * 正常路径下模板的 `setvar` 已经直接改过快照（载体按引用传 env），因此绝大多数回放都是
 * "再把同一个值写一遍"（幂等）。守卫的意义在于 `_.set` 到数组下标这类**非幂等路径**：
 * 载体重试 / 上层重复调用时不能让同一批写入落两次。
 */
function replayWrites(
  snapshot: EjsEnvSnapshot | null | undefined,
  intents: readonly PromptTextWriteIntent[],
  appliedKey: string | null,
): void {
  if (!snapshot || !intents.length || !appliedKey) return;
  if (appliedWrites.has(appliedKey)) return;
  appliedWrites.add(appliedKey);
  try {
    for (const intent of intents) applyWriteIntent(snapshot, intent);
  } catch (err) {
    // 回放失败不该打断渲染（文本已产出；宿主侧快照少了这次写入）
    devWarn(`[${EJS_TEMPLATE_PLUGIN_ID}] 写入回放失败（本条目的文本不受影响）`, err);
  }
}

// ─────────────────────────── 结果工厂 ───────────────────────────

function outcomeOfCarrier(ok: boolean, error: string | undefined): RenderEntryOutcome {
  if (ok) return "ok";
  return /超时|timeout/i.test(String(error ?? "")) ? "timeout" : "degraded";
}

function failedResult(message: string, outcome: RenderEntryOutcome): RenderEntryResult {
  return { text: "", writes: [], error: message, outcome, elapsedMs: 0, executed: false };
}

function skippedResult(): RenderEntryResult {
  return { text: "", writes: [], outcome: "skipped", elapsedMs: 0, executed: false };
}

// ─────────────────────────── 主入口 ───────────────────────────

/**
 * 渲染**一个条目**（D9 幂等 + 写入收集 + 写入回放第二道闸）。
 *
 * @param carrier  载体（`createCarrier()` 的产物）
 * @param entry    条目（`calls` 缺省时用 `entry.content` 的派生键；正文**不会被改写**）
 * @param snapshot `buildEnvSnapshot()` 的活快照（轮内多条共用同一份 ⇒ 写入跨条目可见；缺省给空快照）
 * @param options  `session`（显式轮次）· `standalone`（只读试渲染）· `onResult`（观察钩子）
 */
export async function renderEntry(
  carrier: CarrierLike,
  entry: RenderEntryInput,
  snapshot?: EjsEnvSnapshot | null,
  options: RenderEntryOptions = {},
): Promise<RenderEntryResult> {
  const entryId = typeof entry?.id === "string" && entry.id ? entry.id : "entry";
  const entryName = typeof entry?.name === "string" && entry.name ? entry.name : entryId;
  const content = String(entry?.content ?? "");
  const blocks = countEjsBlocks(content);
  const standalone = options?.standalone === true;

  const identity =
    scopeOfSession(options?.session) ?? scopeOfSnapshot(standalone ? {} : snapshot, standalone);
  const dedupeKey = identity ? dedupeKeyOf(identity.scopeKey, entryId) : null;
  const appliedKey = identity && !standalone ? dedupeKey : null;
  const envSnapshot = (snapshot ?? emptyEnvSnapshot()) as EjsEnvSnapshot;

  const notify = (result: RenderEntryResult): void => {
    if (!options?.onResult) return;
    try {
      options.onResult({
        pluginId: EJS_TEMPLATE_PLUGIN_ID,
        entryId,
        entryName,
        blocks,
        sessionId: identity?.sessionId ?? null,
        turnId: identity?.turnId ?? null,
        outcome: result.outcome,
        executed: result.executed,
        elapsedMs: result.elapsedMs,
        textLength: result.text.length,
        writes: result.writes,
        error: result.error,
      });
    } catch (err) {
      devWarn(`[${EJS_TEMPLATE_PLUGIN_ID}] onResult 钩子抛错（已忽略）`, err);
    }
  };

  // ── ① 幂等（D9）：同一轮次 + 条目只执行一次 ────────────────────────────
  if (dedupeKey) {
    const previous = delivered.get(dedupeKey);
    if (previous) {
      notify(previous);
      return previous;
    }
  }

  const finish = (result: RenderEntryResult): RenderEntryResult => {
    if (dedupeKey && !standalone) {
      delivered.set(dedupeKey, result);
      trimGlobalTables();
    }
    notify(result);
    return result;
  };

  const startedAt = Date.now();
  const fail = (message: string, executed: boolean): RenderEntryResult =>
    finish({ ...failedResult(message, executed ? "degraded" : "error"), executed, elapsedMs: Date.now() - startedAt });
  /** 本次渲染开始前快照上的写入条数（试渲染结束后据此撤回本次新增的写入）。 */
  const writesLengthBefore = Array.isArray(snapshot?.writes) ? (snapshot.writes as unknown[]).length : 0;

  // ── ② 编译（或直接用调用方给的产物）──────────────────────────────────
  // 载体按 `templateHash` 缓存已注入的函数，因此同一模板多轮零成本；
  // 这里再叠一层进程内缓存，避免同一轮里多条目重复编译同一份正文。
  let calls: readonly CarrierRenderCall[];
  if (Array.isArray(entry?.calls) && entry.calls.length > 0) {
    calls = entry.calls;
  } else {
    const compiled = compileOnce(entryId, content);
    if (compiled.ok === false) {
      const compileError = compiled.error;
      return finish({
        ...failedResult(compileError, "degraded"),
        executed: false,
        elapsedMs: Date.now() - startedAt,
      });
    }
    calls = compiled.calls;
  }
  if (calls.length === 0) return finish(skippedResult());

  // ── ③ 载体调用（`envSnapshot` 即模板 locals，见 env.ts 头注）──────────
  let outcomes: readonly CarrierRenderOutcome[];
  try {
    outcomes = await carrier.render(calls, envSnapshot as unknown as Record<string, unknown>);
  } catch (err) {
    const message = String((err as Error)?.message ?? err) || "载体渲染抛错";
    devWarn(`[${EJS_TEMPLATE_PLUGIN_ID}] 载体渲染抛错（条目「${entryName}」已降级）`, err);
    return fail(message, true);
  }

  const outcome = Array.isArray(outcomes)
    ? outcomes.find((item) => item && String(item.id) === String(entryId)) ?? outcomes[0]
    : undefined;
  if (!outcome) return fail("载体未回传该条目的渲染结果（可能超时）", true);

  const intents: PromptTextWriteIntent[] = [];
  if (Array.isArray(outcome.writes)) {
    for (const raw of outcome.writes) {
      const normalized = normalizeWrite(raw);
      if (normalized) intents.push(normalized);
    }
  }

  if (outcome.ok !== true) {
    // ⚠️ 降级语义（SSOT §2.7）：**丢弃该条目内容**，绝不把 `<% %>` 原文发给 LLM。
    //    失败条目的写入也不提交（语义不可信，宁可不写）。
    return fail(String(outcome.error ?? "模板渲染失败") || "模板渲染失败", true);
  }

  // ── ④ 写入回放（第二道闸）+ 收集写入意图（D9）────────────────────────
  replayWrites(standalone ? null : envSnapshot, intents, appliedKey);

  // 试渲染 ⇒ 把本次在快照上记下的写入**撤回**（它不该被宿主提交，SSOT §8「只读」）。
  // ⚠️ 必须按"本次渲染新增的条数"截断，不能整表清空 —— 试渲染与真实渲染可能共用同一快照。
  if (standalone && Array.isArray(snapshot.writes)) {
    (snapshot.writes as PromptTextWriteIntent[]).length = writesLengthBefore;
  }

  return finish({
    text: typeof outcome.text === "string" ? outcome.text : String(outcome.text ?? ""),
    writes: intents,
    outcome: outcomeOfCarrier(true, undefined),
    elapsedMs: Date.now() - startedAt,
    executed: true,
  });
}

/**
 * 顺序渲染一组条目（宿主 pre-pass 的循环体）。
 *
 * ⚠️ **必须串行**：并行 `await` 会让"前面条目 `setvar` 的写入"与"后面条目 `getvar`"产生竞态
 *    （载体内部虽也串行化，但跨条目共享的是同一份快照 ⇒ 顺序由调用方决定）。
 */
export async function renderEntries(
  carrier: CarrierLike,
  entries: readonly RenderEntryInput[],
  snapshot?: EjsEnvSnapshot | null,
  options: RenderEntryOptions = {},
): Promise<RenderEntryResult[]> {
  const results: RenderEntryResult[] = [];
  for (const entry of entries) results.push(await renderEntry(carrier, entry, snapshot, options));
  return results;
}

/** 本轮渲染统计（UI 用；口径见 `EJS本地自测方法.md` §8）。 */
export interface RenderBatchStats {
  entries: number;
  ok: number;
  degraded: number;
  skipped: number;
  blocks: number;
  elapsedMs: number;
  writes: number;
}

/** 从一批结果汇总统计（纯函数，便于 UI/测试复用同一口径）。 */
export function summarizeResults(
  entries: readonly RenderEntryInput[],
  results: readonly RenderEntryResult[],
  elapsedMs: number,
): RenderBatchStats {
  let ok = 0;
  let degraded = 0;
  let skipped = 0;
  let writes = 0;
  let blocks = 0;
  for (const result of results) {
    if (result.outcome === "ok") ok += 1;
    else if (result.outcome === "skipped") skipped += 1;
    else degraded += 1;
    writes += Array.isArray(result.writes) ? result.writes.length : 0;
  }
  for (const entry of entries) blocks += countEjsBlocks(String(entry?.content ?? ""));
  return { entries: results.length, ok, degraded, skipped, blocks, elapsedMs, writes };
}
