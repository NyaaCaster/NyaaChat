/**
 * 条目文本渲染缝 · 渲染器链（SSOT §2.2 / §2.3，D3/D4/D13）—— **宿主契约叶子模块**。
 *
 * ## 它解决什么
 *
 * 上游 ST-Prompt-Template 对一条消息的顺序是「变量宏 → 正则 → **EJS**」（EJS 在最后，
 * `.ref/ST-Prompt-Template/src/modules/handler.ts:264-265`）。NyaaChat 的
 * `renderRule` 顺序是「占位符 → 变量宏 → 正则」，且变量宏**只在动态尾部**渲染
 * （静态前缀必须逐轮字节一致才能命中 prompt 缓存）。
 *
 * 因此含 EJS 的条目不能留在静态前缀里。宿主的做法（D16-R **选项 A**）：
 *
 *  1. **异步 pre-pass**（`preparePromptText`，由 `ChatInterface` 在
 *     `buildRequestMessages` 之前调用）：对每个激活条目，若 `needsPromptText`
 *     为真，就先**完整复现**「占位符 → 变量宏 → 正则」前缀链（由宿主传入的
 *     `renderPrefix` 完成 —— **与 `renderRule` 是同一份代码**，见
 *     `chatPipeline.buildPrefixChain()`），再把结果交给注册方（EJS 插件）渲染；
 *  2. **组装期同步消费**（`getPreparedPromptText`）：`chatPipeline` 对含渲染器条目
 *     取本轮结果（渲染器已完成 EJS），其余条目走原有路径。
 *  3. **写入提交**（pre-pass 末尾的 `commitPromptTextWrites`，D9/V6）：把渲染器本轮缓冲的
 *     写入意图按「作用域 + messageId」合并后**每轮恰好提交一次**到变量层 —— 早于组装期，
 *     因此"本轮 `setvar` → 下一轮 `getvar` 读得回"成立。
 *
 * ## 为什么是叶子模块（改这里前务必读懂）
 *
 * 本文件**只**依赖宿主 core 的 `../lib/variables`（含 `paths`）与 `../lib/regex`，**绝不** import
 * `./registry` / `./runtime` / `./backend` / `../../plugins/registry` —— 任何一条都会
 * 重建 `plugins/registry → 插件 → runtime → registry` 的模块环，后果是插件**静默消失**
 * （详见 `./hostContext.ts` 头部的 t12 断环说明）。插件侧只允许 `import type` 本文件。
 *
 * ⚠️ `needsPromptText` 是**宿主唯一的分流判据**（静态前缀 vs 动态尾部）。它必须满足：
 * **无渲染器注册时 ≡ `hasVariableMacro`** ⇒ 未启用 EJS 插件时请求体与改造前**逐字节
 * 一致**（SSOT §9 P4 验收①）。本文件的实现里，没有任何渲染器时 `matches` 分支全部
 * 短路，恒等式由构造成立。
 *
 * ## 错误与降级（K3 / §2.7）
 *
 * - 渲染器抛错：**该条目单独降级**，不阻断其余条目、不阻断生成；宿主按「一次」记录错误
 *   （避免逐轮刷屏），并登记到本轮 `PromptTextPreparedEntry.error` 供 UI/日志读取；
 * - `matches()` 抛错：视为不匹配（判据不能因为一个坏渲染器把整个请求炸掉）；
 * - 判据为真但没有渲染器能匹配（例如渲染器被停用）：回退原文 **+ 一次性告警**。
 */
import type { WorldInfoRule } from "../types";
import {
  hasVariableMacro,
  updateVariablesWith,
  type VariableOption,
  type VariableScope,
} from "../lib/variables";
import { parsePath, setByPath } from "../lib/variables/paths";
import { errorMessageOf } from "./pluginLog";

/** 本轮渲染的身份/会话上下文（SSOT §2.2 契约，签名冻结；`turnId` 为宿主的幂等键）。 */
export interface PromptTextContext {
  sessionId: string;
  /** 本轮唯一键（宿主生成）—— 幂等去重的依据（D9：每轮每条目恰好渲染一次）。 */
  turnId: string;
  identity: { user: string; char: string };
  character: { id: string | null; name: string };
}

/** 渲染产生的变量写入意图（D9）。采集与提交由渲染器实现方负责。 */
export interface PromptTextWrite {
  /** 变量路径。 */
  path: string;
  value: unknown;
  scope: "message" | "chat" | "global";
  messageId?: number | "latest";
}

export interface PromptTextRenderer {
  /** 归属插件 id（错误归因/日志）。 */
  pluginId: string;
  /** 同步、必须廉价：声明是否处理该文本。 */
  matches(text: string): boolean;
  /** 渲染（可异步）。抛错由宿主按条目降级（K3），不得阻断生成。 */
  render(text: string, ctx: PromptTextContext): Promise<string> | string;
  /** 本轮渲染产生的副作用（D9）—— 由**渲染器实现方**持有缓冲，宿主/UI 按需取用。 */
  takeWrites?(): PromptTextWrite[];
}

/**
 * 前缀链配置 —— 由宿主在 pre-pass 选项里逐轮传入（`PromptTextPrepareOptions.prefixChain`）。
 *
 * `renderPrefix` **就是** `chatPipeline.buildPrefixChain()` 的产物：占位符 → 变量宏
 * （仅 `allowVariableMacros` 为真时）→ 世界书正则。pre-pass 与组装期共用同一份代码，
 * 不是两套（D16-R 选项 A 的全部要求）。
 */
export interface PromptTextPrefixChain {
  renderPrefix(text: string, opts: { allowVariableMacros: boolean }): string;
}

/**
 * 宿主接线（`ChatInterface` 在 pre-pass 调用）。
 *
 * ⚠️ 只传递**纯函数**：本模块不持有会话状态，因此不存在"两次调用口径不一致"的风险。
 */
export interface PromptTextPrepareOptions extends PromptTextContext {
  /** 见 {@link PromptTextPrefixChain}。 */
  prefixChain: PromptTextPrefixChain;
}

/** pre-pass 的单条目结果（UI/日志只读快照）。 */
export interface PromptTextPreparedEntry {
  ruleId: string;
  ruleName: string;
  /** 真正接管该条目的渲染器 pluginId。 */
  pluginId?: string;
  /** 渲染成功后的文本（组装期由 `getPreparedPromptText` 取用）。 */
  text?: string;
  /** 该条目已降级（抛错/无渲染器接管）；组装期回退原文。 */
  error?: string;
  elapsedMs?: number;
}

// ---------------------------------------------------------------------------
// 渲染器注册表
// ---------------------------------------------------------------------------

const renderers: PromptTextRenderer[] = [];

/** 注册一个渲染器；返回注销函数（插件 `setup` 里持有，`dispose` 时调用）。 */
export function registerPromptTextRenderer(r: PromptTextRenderer): () => void {
  renderers.push(r);
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    const idx = renderers.indexOf(r);
    if (idx >= 0) renderers.splice(idx, 1);
  };
}

/** 当前已注册的渲染器（只读视图；注册顺序 = 匹配优先级）。 */
export function getPromptTextRenderers(): readonly PromptTextRenderer[] {
  return renderers;
}

// ---------------------------------------------------------------------------
// 判据
// ---------------------------------------------------------------------------

/**
 * 声明式判据：含变量宏 **或** 任一渲染器 `matches` ⇒ 不得进静态前缀。
 *
 * 无渲染器注册时恒等于 `hasVariableMacro(text)`（逐字节回归的前提）。
 * `matches()` 抛错按"不匹配"处理（坏渲染器不得击穿请求组装）。
 */
export function needsPromptText(text: string): boolean {
  if (typeof text !== "string") return false;
  if (hasVariableMacro(text)) return true;
  if (renderers.length === 0) return false;
  for (const r of renderers) {
    try {
      if (r.matches(text)) return true;
    } catch (err) {
      warnOnce(
        `match:${r.pluginId}`,
        `[promptText] 渲染器 ${r.pluginId} 的 matches() 抛错，已按不匹配处理：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return false;
}

/** 同一个 key 只 warn 一次，避免逐轮刷屏（§2.7）。 */
const warnedKeys = new Set<string>();

function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}

/** 仅供测试：清空"已告警"集合。 */
export function resetPromptTextWarningsForTests(): void {
  warnedKeys.clear();
}

// ---------------------------------------------------------------------------
// 本轮结果缓存（pre-pass → 组装期）
// ---------------------------------------------------------------------------

let preparedTurnId: string | null = null;
const prepared = new Map<string, PromptTextPreparedEntry>();

/**
 * 取本轮某条目的渲染结果；缺失/降级时返回 `fallback` 原文 **+ 一次性告警**
 * （避免逐轮刷屏；SSOT §2.7 末行）。
 */
export function getPreparedPromptText(ruleId: string, fallback: string): string {
  const entry = prepared.get(ruleId);
  if (entry && entry.text !== undefined) return entry.text;
  if (!entry) {
    warnOnce(
      `missing:${ruleId}`,
      `[promptText] 条目 ${ruleId} 的判据为真，但本轮没有渲染结果 —— 已回退原文。` +
        `（通常意味着渲染器在 pre-pass 之后被注销/停用）`,
    );
  }
  return fallback;
}

/** 清空本轮结果（新的 pre-pass 开始时调用）。 */
export function clearPreparedPromptText(): void {
  preparedTurnId = null;
  prepared.clear();
}

/** 本轮结果的只读视图（UI 统计/日志用）。 */
export function getPreparedPromptTextEntries(): readonly PromptTextPreparedEntry[] {
  return [...prepared.values()];
}

/**
 * 本轮是否已有该条目的渲染结果（**组装期分流判据**）。
 *
 * ⚠️ 这是"条目是否真的被渲染了"的**唯一权威判据**，而不是 `needsPromptText`：
 * 只有它能区分下面两种情形 ——
 *   · pre-pass 真的渲染过（含 EJS 条目 ⇒ 进「═ 模板设定 ═」）；
 *   · 渲染器已注册但本轮 pre-pass 没跑 / 该条目没被接管（插件被停用、异常路径）
 *     ⇒ **按原文走原有路径**（静态前缀或「═ 变量状态 ═」）。
 *
 * 少了这一层区分，就会在"插件已注册但未启用"时把含 EJS 条目从静态前缀里挪走 ——
 * 请求体与改造前不再逐字节一致（P4 验收① 的反例）。
 */
export function hasPreparedPromptText(ruleId: string): boolean {
  const entry = prepared.get(ruleId);
  return entry !== undefined && entry.text !== undefined;
}

/** 当前结果所属的 turnId（无结果时为 null）。 */
export function getPreparedPromptTurnId(): string | null {
  return preparedTurnId;
}

// ---------------------------------------------------------------------------
// 写入提交（D9 / V6）
// ---------------------------------------------------------------------------

/**
 * 已把写入提交到变量层的轮次 —— "**每轮恰好提交一次**"（D9/V6）的幂等键。
 *
 * 为什么幂等键是轮次而不是"有没有写入"：宿主可能在同一轮里多次调用 pre-pass
 * （重试/StrictMode 双跑），而 `setvar` 是有副作用的（写入台账、楼层时间戳）。
 * 只有按 `turnId` 去重才能保证"本轮写一次、写且只写一次"。
 */
let committedTurnId: string | null = null;

/** 一个提交批次：**同作用域 + 同 messageId** 的写入合并为一次读-改-写。 */
interface PromptTextWriteBatch {
  scope: VariableScope;
  option: VariableOption | undefined;
  writes: PromptTextWrite[];
}

/** 只认三个作用域；其余（含 undefined）按 ST 的写缺省 `message` 处理。 */
function normalizeWriteScope(scope: unknown): VariableScope {
  return scope === "chat" || scope === "global" ? scope : "message";
}

/**
 * 防御性路径闸：路径段里出现 `__proto__` / `constructor` / `prototype` 就丢弃。
 *
 * 写入意图来自插件（与宿主同 realm），必须假设它可能被坏模板/坏卡污染；
 * `lodash.set` 语义会顺着路径创建中间对象 ⇒ 不挡就会原型污染。
 * （`host/env.ts` 的 `hasForbiddenSegment` 是同一口径的另一份实现 —— 那里在快照侧
 * 已经挡过一次，这里是提交侧的第二道闸。）
 */
function isForbiddenWritePath(path: string): boolean {
  if (!path || path === "__proto__" || path === "constructor" || path === "prototype") return true;
  return path
    .replace(/\[(['"]?)([^\]]*)\1\]/g, ".$2")
    .split(".")
    .some((segment) => {
      const key = segment.trim();
      return key === "__proto__" || key === "constructor" || key === "prototype";
    });
}

/** 取一个渲染器的写入缓冲（`takeWrites` 可选且由渲染器实现方实现，抛错不得阻断提交）。 */
function takeWritesSafely(renderer: PromptTextRenderer): PromptTextWrite[] {
  if (typeof renderer.takeWrites !== "function") return [];
  try {
    const writes = renderer.takeWrites();
    return Array.isArray(writes) ? writes.filter((w) => w && typeof w.path === "string" && w.path) : [];
  } catch (err) {
    warnOnce(
      `takeWrites:${renderer.pluginId}`,
      `[promptText] 渲染器 ${renderer.pluginId} 的 takeWrites() 抛错，本轮写入已丢弃：${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

/**
 * 把本轮渲染产生的写入意图**统一提交一次**到变量层（D9 / V6）。
 *
 * 调用时机：pre-pass 结束（`preparePromptText` 末尾）—— 此时本轮所有条目都已渲染完，
 * 且早于组装期 `buildRequestMessages`，因此"本轮 setvar → 下一轮 getvar 读得回"成立。
 *
 * 语义要点：
 *  · **幂等**：同一 `turnId` 再调用直接返回 0（不重复写）；
 *  · **按批次合并**：同作用域 + 同 messageId 的写入在一次读-改-写里按顺序 `setByPath`
 *    （后者覆盖前者，与 ST 的顺序语义一致），避免 N 条写入触发 N 次宿主 setState；
 *  · **失败不外抛**：写失败只记一次告警（生成流程绝不因为变量写不进去而中断）；
 *  · **不碰渲染结果**：提交失败不改动已产出的提示词文本。
 *
 * @returns 实际提交的写入条数（0 = 本轮无写入或已提交过）。
 */
export function commitPromptTextWrites(turnId: string): number {
  if (committedTurnId === turnId) return 0;
  committedTurnId = turnId;

  const batches = new Map<string, PromptTextWriteBatch>();
  for (const renderer of renderers) {
    for (const write of takeWritesSafely(renderer)) {
      if (isForbiddenWritePath(write.path)) continue;
      const scope = normalizeWriteScope(write.scope);
      const option: VariableOption | undefined =
        write.messageId === undefined ? undefined : { messageId: write.messageId };
      const key = `${scope}\u0000${String(write.messageId ?? "")}`;
      let batch = batches.get(key);
      if (!batch) {
        batch = { scope, option, writes: [] };
        batches.set(key, batch);
      }
      batch.writes.push(write);
    }
  }

  let committed = 0;
  for (const batch of batches.values()) {
    const pending = batch.writes;
    try {
      updateVariablesWith(
        (draft) => {
          for (const write of pending) {
            setByPath(draft, parsePath(write.path), write.value);
            committed += 1;
          }
        },
        batch.scope,
        batch.option,
      );
    } catch (err) {
      warnOnce(
        `commit:${batch.scope}`,
        `[promptText] 变量写入提交失败（scope=${batch.scope}，${pending.length} 条）：${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  return committed;
}

/** 仅供测试：复位"已提交轮次"（生产代码不调用）。 */
export function resetPromptTextCommitsForTests(): void {
  committedTurnId = null;
}

// ---------------------------------------------------------------------------
// pre-pass
// ---------------------------------------------------------------------------

/**
 * 异步 pre-pass：渲染本轮激活条目并按 `rule.id` 缓存。
 *
 * 调用者（`ChatInterface`）**必须**复用同一次 `getActivatedKeywordRules()` 的返回值
 * —— 否则口径可能与 `buildRequestMessages` 内部不一致，导致"渲染了未激活条目 ⇒
 * `setvar` 误写"（SSOT §2.3 的硬要求）。
 *
 * 幂等：同一 `turnId` 重复调用不会重复渲染（D9）。渲染器抛错按条目降级，绝不外抛。
 */
export async function preparePromptText(
  rules: readonly WorldInfoRule[],
  opts: PromptTextPrepareOptions,
): Promise<void> {
  const active = Array.isArray(rules) ? rules.filter((r) => r && r.enabled) : [];

  // 无渲染器 ⇒ 判据退化为 `hasVariableMacro` ⇒ 本轮没有任何条目可以被接管。
  //
  // ⚠️ 此时**必须清掉上一轮结果**（t10 集成发现并修复）：`clearPreparedPromptText()` 在
  //   生产代码里没有调用方，而"插件中途停用"（`dispose()` 注销渲染器）恰恰走这条早返回。
  //   不清缓存时 `prepared` 里还留着上一轮的记录 ⇒ 组装期 `hasPreparedPromptText()` 仍为真
  //   ⇒ 含 EJS 的条目**既不在静态前缀、也不在模板设定**（被当成"已接管但内容为空"丢掉），
  //   与"插件停用 ⇒ 请求体与改造前逐字节一致"（§9 P4 验收①）矛盾，且会静默丢掉条目。
  if (renderers.length === 0) {
    prepared.clear();
    preparedTurnId = null;
    return;
  }

  // 新一轮：清掉上一轮结果，避免"插件中途停用 ⇒ 旧渲染结果继续进请求体"。
  if (preparedTurnId !== opts.turnId) {
    prepared.clear();
    preparedTurnId = opts.turnId;
  }

  for (const rule of active) {
    if (prepared.has(rule.id)) continue; // 本轮已渲染过（幂等）
    if (!needsPromptText(rule.content)) continue;

    const started = Date.now();
    // ① 复现前缀链（占位符 → 变量宏 → 正则）—— 失败/异常时回退原文，
    //    这一步与组装期的 renderRule 是同一份代码。
    let prefix: string;
    try {
      prefix = opts.prefixChain.renderPrefix(rule.content, { allowVariableMacros: true });
    } catch {
      prefix = rule.content;
    }

    // ② 交给第一个匹配的渲染器（注册顺序 = 优先级）
    //
    // `claimedBy`：**被某个渲染器认领**（`matches()` 命中）的渲染器 id —— 与"渲染成功"
    // 是两件事。它是"渲染失败时该不该丢弃内容"的唯一判据（见下方两个分支）：
    //   · 被认领 ⇒ 这段文本**归渲染器负责**，失败就必须丢弃（绝不把 `<% %>` 原文发出去）；
    //   · 未被认领 ⇒ 判据只是"含变量宏"，属于既有行为，必须原样走原路径。
    let claimedBy: string | null = null;
    let rendered = false;
    try {
      for (const r of renderers) {
        if (!r.matches(prefix)) continue;
        claimedBy = r.pluginId;
        const out = await r.render(prefix, opts);
        if (typeof out !== "string") continue;
        prepared.set(rule.id, {
          ruleId: rule.id,
          ruleName: rule.name,
          pluginId: r.pluginId,
          text: out,
          elapsedMs: Date.now() - started,
        });
        rendered = true;
        break;
      }
    } catch (err) {
      const message = errorMessageOf(err) ?? String(err);
      warnOnce(
        `render:${rule.id}`,
        `[promptText] 条目「${rule.name}」渲染失败，已降级（该条目内容已丢弃，不进请求体）：${message}`,
      );
      // ⚠️ `text: ""` 是**必填**的（t10 集成发现并修复）：`hasPreparedPromptText()` 判的是
      //    `text !== undefined`。不写 text ⇒ 该条目被当作"渲染器未接管"而落回
      //    `nonRendererPermanentRules`，再按 `hasVariableMacro` 分到静态前缀 / `═ 变量状态 ═`
      //    ⇒ **含 `<% %>` 的原文照发**，违反 SSOT §2.7 K3 与 §10 V3。
      //    空串 = "已被接管、内容为空" ⇒ 组装期丢弃该条目（同时不产出空壳行）。
      //    （能走到 catch ⇒ 必然有渲染器 `matches` 过并抛错 ⇒ `claimedBy` 非空。）
      prepared.set(rule.id, {
        ruleId: rule.id,
        ruleName: rule.name,
        text: "",
        error: message,
        elapsedMs: Date.now() - started,
      });
      continue;
    }

    if (!rendered) {
      if (claimedBy !== null) {
        // 有渲染器认领但没给出字符串（返回了非字符串）⇒ 同"渲染失败"：丢弃内容，防泄漏。
        warnOnce(
          `unhandled:${rule.id}`,
          `[promptText] 条目「${rule.name}」被渲染器 ${claimedBy} 认领但未返回文本 —— 已丢弃该条目内容。`,
        );
        prepared.set(rule.id, {
          ruleId: rule.id,
          ruleName: rule.name,
          text: "",
          error: "renderer did not return a string",
          elapsedMs: Date.now() - started,
        });
      } else {
        // ⚠️ **没有任何渲染器认领** ⇒ 判据为真只是因为**含变量宏**（不是 EJS 条目）。
        //    此时**不写 `text`**：该条目必须继续走既有路径（`═ 变量状态 ═` / 静态前缀），
        //    否则插件一启用就会把既有的变量状态条目整条吞掉（SSOT §2.6 要求"原有行为、
        //    字节不变"）—— 这是 t10 集成用真实 fixture 抓到的回归（A6）。
        warnOnce(
          `unhandled:${rule.id}`,
          `[promptText] 条目「${rule.name}」的判据为真（含变量宏）但没有渲染器认领 —— 按原有路径渲染。`,
        );
        prepared.set(rule.id, {
          ruleId: rule.id,
          ruleName: rule.name,
          error: "no renderer claimed this entry",
          elapsedMs: Date.now() - started,
        });
      }
    }
  }

  // ③ 写入提交（D9 / V6）：本轮所有条目都渲染完之后**统一提交一次**。
  //    降级条目不产出写入（渲染器侧已按条目丢弃）；提交失败只告警，不影响提示词。
  commitPromptTextWrites(opts.turnId);
}

// ---------------------------------------------------------------------------
// 测试/探针
// ---------------------------------------------------------------------------

/** 便于单测/探针：清空渲染器、缓存与告警。生产代码不调用。 */
export function resetPromptTextForTests(): void {
  renderers.length = 0;
  prepared.clear();
  preparedTurnId = null;
  committedTurnId = null;
  warnedKeys.clear();
}
