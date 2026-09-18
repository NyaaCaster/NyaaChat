/**
 * ejs-template 插件设置面板 —— **最小 UI**（SSOT §8 / `EJS本地自测方法.md` §8）。
 *
 * ## 本面板做什么（逐条对应 SSOT §8 的表）
 *
 * | 区块 | 实现 |
 * |---|---|
 * | 本轮渲染统计 | 条目数 / 块数 / 耗时 / 降级数 / 变量写入数（数据源 = 本文件的统计 store，由 `plugin.tsx` 的渲染器发布） |
 * | 最近一次错误 | 渲染失败时由 `describeEjsError` 产出的用户可读文案（title + detail），紧贴统计区显示 |
 * | 含 EJS 的条目 | 当前角色世界书扫描（触发类型 / 启用状态 / 块数 / 字符数）+「刷新条目」 |
 * | 试渲染 | 用当前变量快照渲染指定条目一次，**只读、不提交写入**（`runTrialEjsRender`） |
 * | 安全告知 | 模板可访问本机数据与凭据（只渲染可信来源的卡）+ **已知风险：死循环会卡住发送流程**（含软上限数值） |
 *
 * ## 明确不做（SSOT §12 NG1）
 *
 * 没有 EJS 编辑器、没有语法高亮、没有 monaco、没有变量管理器。本文件只**展示**与**只读试渲染**，
 * 不提供任何改写模板的能力。
 *
 * ## ⚠️ 为什么「统计 store / 软上限」住在这个 UI 文件里
 *
 * 本轮的 inScope 只有 3 个文件（`plugin.tsx` / `EjsTemplateSettings.tsx` / `plugins/registry.ts`），
 * SSOT §2.4 目录树里的 `plugins/EJS-template/registry.ts` 被**合并进 `plugin.tsx`**。
 * 而 store 若住在 `plugin.tsx`，本文件就得 `import` 它 —— 那是 `plugin → Settings → plugin`
 * 的**反向值边**：`plugins/registry.ts → plugin.tsx` 先执行 `plugin.tsx` 的模块体，
 * 而 `plugin.tsx` 的第一条语句就是 import 本文件 ⇒ 本文件在 `plugin.tsx` 的 `const` 尚未
 * 初始化时求值，模块级调用（如 `pluginLogger(ID)`）会直接 TDZ 崩掉。
 *
 * 因此**单向**排布为：本文件（统计 store + 软上限 + 面板）→ 被 `plugin.tsx` 引用，反向一律不引。
 * 这里只放纯数据/纯函数与面板本身，不放任何渲染编排逻辑（那在 `plugin.tsx`）；
 * 「含 EJS 判据」与「块数口径」也不在这里，而在 `host/env.ts`（两处各写一份必然漂移）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import type { PluginSettingsPanelProps } from "../../src/plugins/types";
import { pluginLogger } from "../../src/plugins/pluginLog";
import { getScriptHostApi } from "../../src/plugins/scriptHost";
import { compileTemplate } from "./engine/compile";
import { createCarrier } from "./host/carrier";
import { buildEnvSnapshot, countEjsBlocks, loadYaml } from "./host/env";
import { renderEntry } from "./host/renderEntry";
import { describeEjsError } from "./errors";

/**
 * 插件 id 的字面量副本。
 *
 * ⚠️ **不能**从 `plugin.tsx` 导入（`plugin → Settings → plugin` 的反向值边 ⇒ 模块环）。
 * 两端同值由 `plugins/registry.ts` 的 `meta.id` 与渲染统计 / `pluginLogger` 使用的 scope 共同守住。
 */
const EJS_PLUGIN_ID = "ejs-template";

const log = pluginLogger(EJS_PLUGIN_ID);

/** 构建标记（`EJS本地自测方法.md` §8 的 `build` 字段）—— 排障时先看它，确认"跑的是哪个构建"。 */
export const EJS_TEMPLATE_BUILD = "ejs-template-1.0.0-p5";

// ─────────────────────────────────────────────────────────────────────────────
// 软上限（K1 缓解 / SSOT D12）—— **唯一定义处**，`plugin.tsx` 从这里取用
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 单条目 EJS 块数软上限（超出即跳过该条目并降级）。
 *
 * ⚠️ 取值依据：P0 黄金基准的 57 个真实条目合计 **1002 块 / 260,766 字符代码量**
 * （`dev-server/ejs-golden/manifest.json`），单条目最大正文 **25,886 字符**
 * （`golden.json` 的 `contentLen`）。按平均约 160 字符/块估算，单条目实测量级在百余块，
 * 因此 600 是一个**不会误伤真实卡**、又能挡住"灾难性模板"的数量级。
 */
export const EJS_SOFT_CAP_MAX_BLOCKS = 600;

/** 单条目正文字符软上限（同上的保守数量级：实测最大 25,886 ⇒ 上限 200,000）。 */
export const EJS_SOFT_CAP_MAX_CHARS = 200000;

/**
 * 载体渲染超时（毫秒）。
 *
 * ⚠️ `createCarrier(opts)` 的 `timeoutMs` 是**创建期参数**，同一个载体无法按条目动态改超时；
 * 想按块数逐条目调整就得每个条目重建载体，那会丢掉"模板不变时按 `templateHash` 复用已编译函数"
 * 的收益（载体验收项）。所以这里是**统一软上限**，配合上面的块数上限使用。
 */
export const EJS_SOFT_CAP_CARRIER_TIMEOUT_MS = 15000;

/** 本轮渲染记录最多保留多少行（防止面板 DOM 无界增长；57 个真实条目远低于此）。 */
export const EJS_TURN_ITEM_LIMIT = 200;

/** 试渲染结果在面板里的最大展示字符数（超出截断并提示）。 */
export const EJS_TRIAL_PREVIEW_MAX_CHARS = 4000;

// ⚠️ 「EJS 块数」与「含 EJS 判据」**不在这里实现**：口径的唯一定义处是
// `host/env.ts` 的 `countEjsBlocks()` / `matchesEjsTemplate()`（与 P0 的 `<%(.*?)-?%>` 同款，
// 即 manifest.json 里 1002 块的那个口径），本面板与 `plugin.tsx` 都从那里取用 —— 两处各写一份
// 计数必然漂移（早期草案就出现过"数 `<%` 出现次数"与"数完整块"两个口径）。

// ─────────────────────────────────────────────────────────────────────────────
// 统计 store（`plugin.tsx` 的渲染器发布，本面板订阅）
// ─────────────────────────────────────────────────────────────────────────────

/** 逐条目视图的一行（一次 `render()` 调用 = 一行）。 */
export interface EjsRenderRow {
  /** 本轮内的调用序号（1 起），宿主按条目顺序调用时即"第几个条目"。 */
  index: number;
  /** 传给 `renderEntry` 的条目 id（`turnId::内容哈希`）。 */
  entryId: string;
  /** 尽力匹配到的条目名；`null` = 没匹配上。 */
  entryName: string | null;
  /** `entryName` 是否是"按正文包含关系推断"出来的（UI 会加 `≈`）。 */
  nameGuessed: boolean;
  blocks: number;
  inputChars: number;
  outputChars: number;
  ok: boolean;
  /** 因软上限被跳过（未送达载体）。 */
  skipped: boolean;
  /** 命中了 `renderEntry` 的幂等表（同一轮同样正文已渲染过）⇒ 不计入"渲染条目数"。 */
  deduped?: boolean;
  errorTitle?: string;
  errorDetail?: string;
  elapsedMs: number;
  at: number;
}

/** 本轮（一个 `turnId`）的累计统计。 */
export interface EjsTurnStats {
  turnId: string;
  startedAt: number;
  /** 最近一次刷新的时间（耗时按 `updatedAt - startedAt` 展示，含本轮全部条目）。 */
  updatedAt: number;
  /** 本轮 `matches()` 命中的条目数。 */
  matched: number;
  /** 渲染成功的条目数。 */
  rendered: number;
  /** 降级（失败/跳过）的条目数。 */
  failed: number;
  /** 本轮渲染的 EJS 块数合计。 */
  blocks: number;
  /** 本轮收集到的变量写入条数（已交给宿主统一提交）。 */
  writes: number;
  items: EjsRenderRow[];
}

/** 最近一次错误（用户可读文案，`describeEjsError` 的产物）。 */
export interface EjsLastError {
  at: number;
  scope: string;
  title: string;
  detail: string;
}

/** 面板的只读快照（`useSyncExternalStore` 要求"没变就同一引用"）。 */
export interface EjsRenderSnapshot {
  build: string;
  /** 插件运行时是否已装配（= 框架里的启用开关为开）。 */
  active: boolean;
  turn: EjsTurnStats | null;
  lastError: EjsLastError | null;
}

let snapshot: EjsRenderSnapshot = {
  build: EJS_TEMPLATE_BUILD,
  active: false,
  turn: null,
  lastError: null,
};
const storeListeners = new Set<() => void>();

function emit(next: EjsRenderSnapshot): void {
  snapshot = next;
  // 逐个 try/catch：一个订阅者抛错不能拖垮其它订阅者（与 pluginLog 同范式）。
  for (const listener of [...storeListeners]) {
    try {
      listener();
    } catch (err) {
      console.error(`[plugins:${EJS_PLUGIN_ID}] 统计订阅者抛错`, err);
    }
  }
}

/** 面板快照（引用稳定）。 */
export function getEjsRenderSnapshot(): EjsRenderSnapshot {
  return snapshot;
}

/** 订阅统计变更，返回取消订阅函数。 */
export function subscribeEjsRenderStats(listener: () => void): () => void {
  storeListeners.add(listener);
  return () => {
    storeListeners.delete(listener);
  };
}

/** `plugin.tsx` 的 `setup` / disposer 调用。 */
export function setEjsPluginActive(active: boolean): void {
  const value = active === true;
  if (snapshot.active === value) return;
  emit({ ...snapshot, active: value });
}

/** 发布本轮统计（`plugin.tsx` 每次渲染调用后调用；`items` 会复制一份）。 */
export function publishEjsTurn(turn: EjsTurnStats): void {
  emit({ ...snapshot, turn: { ...turn, items: turn.items.slice() } });
}

/** 发布/清除最近一次错误。 */
export function publishEjsLastError(lastError: EjsLastError | null): void {
  emit({ ...snapshot, lastError });
}

/** 「清空统计」按钮：清统计与最近一次错误。 */
export function clearEjsRenderState(): void {
  if (!snapshot.turn && !snapshot.lastError) return;
  emit({ ...snapshot, turn: null, lastError: null });
}

/** 探针/验证脚本用（生产代码不调用）。 */
export function resetEjsTemplateUiForTests(): void {
  storeListeners.clear();
  snapshot = { build: EJS_TEMPLATE_BUILD, active: false, turn: null, lastError: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// 试渲染（只读：结果里的写入意图一律丢弃，不提交宿主）
// ─────────────────────────────────────────────────────────────────────────────

export interface EjsTrialTarget {
  id: string;
  name: string;
  content: string;
}

export interface EjsTrialResult {
  ok: boolean;
  text: string;
  /** 输出是否被截断（面板只展示前 `EJS_TRIAL_PREVIEW_MAX_CHARS` 字符）。 */
  truncated: boolean;
  /** **被丢弃**的写入意图条数（试渲染不提交写入，这里只如实计数）。 */
  discardedWrites: number;
  elapsedMs: number;
  errorTitle?: string;
  errorDetail?: string;
}

/** vendor YAML 的按需预热（失败只告警一次，不阻断：不用 YAML 的模板照常渲染）。 */
let yamlReady: Promise<void> | null = null;
function ensureYamlQuietly(): Promise<void> {
  if (!yamlReady) {
    yamlReady = loadYaml().then(
      () => undefined,
      (err: unknown) => {
        log.warn("yaml", "vendor YAML（yaml.esm.js）加载失败：使用 YAML 的模板会降级", err);
      },
    );
  }
  return yamlReady;
}

/**
 * 试渲染：用**当前变量快照**渲染指定条目一次，只读返回结果。
 *
 * 三条纪律：
 *  1. **不提交写入** —— `renderEntry` 回传的 `writes` 只计数后丢弃（宿主侧的提交在 pre-pass 结束时做）；
 *  2. **临时载体** —— 每次试渲染新建载体并在 `finally` 里 `destroy()`，不留残留 iframe；
 *  3. **不经过前缀链** —— 这里直接用条目**原文**；发送时宿主会先跑"占位符 → 变量宏 → 正则"再进渲染器
 *     （SSOT D16-R 选项 A），所以本工具的输出可能与真机原文不同，这一点在 UI 上写明。
 */
export async function runTrialEjsRender(target: EjsTrialTarget): Promise<EjsTrialResult> {
  const startedAt = Date.now();
  const entryName = target.name.trim() || "(未命名条目)";
  const api = getScriptHostApi();
  if (!api) {
    const message = describeEjsError(new Error("宿主门面未注册（getScriptHostApi() === null）"), {
      entryName,
      entryId: target.id,
    });
    return {
      ok: false,
      text: "",
      truncated: false,
      discardedWrites: 0,
      elapsedMs: Date.now() - startedAt,
      errorTitle: message.title,
      errorDetail: message.detail,
    };
  }

  await ensureYamlQuietly();
  let carrier: ReturnType<typeof createCarrier> | null = null;
  try {
    carrier = createCarrier({
      timeoutMs: EJS_SOFT_CAP_CARRIER_TIMEOUT_MS,
      onError: (id, message) => log.warn("trial", `载体报错（${id}）：${message}`),
    });
    const compiled = compileTemplate(target.content);
    const entryId = `trial::${compiled.templateHash}-${target.content.length}`;
    const identity = { user: api.identity.user, char: api.identity.char };
    // ⚠️ `canonical: false` ⇒ 全新快照：试渲染的写入**不**污染会话级活快照（D9 的活快照按会话复用）。
    const envSnapshot = buildEnvSnapshot(
      {
        characterId: api.character.getId(),
        identity,
        characterName: api.character.getName(),
      },
      { canonical: false },
    );
    const result = await renderEntry(
      carrier,
      {
        id: entryId,
        content: target.content,
        name: entryName,
        calls: [{ id: entryId, templateHash: compiled.templateHash, functionBody: compiled.body }],
      },
      envSnapshot,
      // `standalone: true`（`renderEntry` 专门为 SSOT §8 的"试渲染"提供）：
      // 用临时轮次键 ⇒ 不参与本轮幂等、**不落快照、不提交**。
      { standalone: true },
    );
    const elapsedMs = Date.now() - startedAt;
    const writes = Array.isArray(result.writes) ? result.writes : [];
    if (result.outcome !== "ok") {
      const described = describeEjsError(
        new Error(result.error ?? `条目未被执行（outcome=${result.outcome}）`),
        { entryName, entryId },
      );
      return {
        ok: false,
        text: "",
        truncated: false,
        discardedWrites: writes.length,
        elapsedMs,
        errorTitle: described.title,
        errorDetail: described.detail,
      };
    }
    const text = typeof result.text === "string" ? result.text : "";
    const truncated = text.length > EJS_TRIAL_PREVIEW_MAX_CHARS;
    return {
      ok: true,
      text: truncated ? text.slice(0, EJS_TRIAL_PREVIEW_MAX_CHARS) : text,
      truncated,
      discardedWrites: writes.length,
      elapsedMs,
    };
  } catch (err) {
    const described = describeEjsError(err, { entryName, entryId: target.id });
    return {
      ok: false,
      text: "",
      truncated: false,
      discardedWrites: 0,
      elapsedMs: Date.now() - startedAt,
      errorTitle: described.title,
      errorDetail: described.detail,
    };
  } finally {
    try {
      carrier?.destroy();
    } catch (err) {
      log.warn("trial", "试渲染载体销毁抛错", err);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 世界书条目扫描（"哪些条目含 EJS"的权威视图）
// ─────────────────────────────────────────────────────────────────────────────

export interface EjsWorldInfoEntry {
  id: string;
  name: string;
  triggerType: "permanent" | "keywords";
  enabled: boolean;
  blocks: number;
  contentChars: number;
  content: string;
}

/**
 * 当前角色的世界书里**含 EJS 的条目**。
 *
 * ⚠️ 来源是 `getScriptHostApi().character.getWorldInfo()`（宿主只暴露"当前角色"这一本，
 * 与 `getwi` 的保真度损失同源，SSOT G5）。面板**不订阅**它 —— 角色切换不会自动刷新，
 * 点「刷新条目」按钮重取。
 */
export function collectEjsWorldInfoEntries(): EjsWorldInfoEntry[] {
  const api = getScriptHostApi();
  if (!api) return [];
  try {
    return api.character
      .getWorldInfo()
      .filter((rule) => typeof rule.content === "string" && rule.content.includes("<%"))
      .map((rule) => ({
        id: rule.id,
        name: typeof rule.name === "string" && rule.name.trim() ? rule.name.trim() : "(未命名条目)",
        triggerType: rule.triggerType === "keywords" ? "keywords" : "permanent",
        enabled: rule.enabled === true,
        blocks: countEjsBlocks(rule.content),
        contentChars: rule.content.length,
        content: rule.content,
      }));
  } catch (err) {
    log.warn("panel", "读取当前角色的世界书条目失败", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 面板
// ─────────────────────────────────────────────────────────────────────────────

/** 安全告知（SSOT §8：照 `ScriptRunnerSettings.tsx:79-81` 的文案风格）。 */
export const EJS_SECURITY_NOTICE_TEXT =
  "EJS 模板可访问本机数据与凭据；只渲染你信任来源的角色卡。";

/** K1 风险提示（D12：UI 必须明示"死循环发生在发送路径"）。 */
export const EJS_K1_NOTICE_TEXT =
  `已知风险：模板里的死循环会让「发送」流程卡住且无法中断。确保角色卡 单条目 EJS 块数 ≤ ${EJS_SOFT_CAP_MAX_BLOCKS}、单条目正文 ≤ ${EJS_SOFT_CAP_MAX_CHARS} 字符（超出即跳过该条目并降级）`;

function formatTime(at: number): string {
  try {
    return new Date(at).toLocaleTimeString();
  } catch {
    return "";
  }
}

/** `turnId` 的短示（宿主用消息 id，通常较长）。 */
function shortTurnId(turnId: string): string {
  const trimmed = turnId.trim();
  if (trimmed.length <= 12) return trimmed || "—";
  return `…${trimmed.slice(-12)}`;
}

/**
 * ejs-template 设置面板。
 *
 * ⚠️ 宿主只传 `PluginSettingsPanelProps` 的四个字段；`config` / `updateConfig` / `callBackend`
 * 本面板**用不上**（本插件没有可配置项，启用开关在详情页头部，也没有后端能力），
 * 因此刻意**不解构**它们 —— 面板只读运行时状态，不伪造一个点了没反应的交互。
 */
export function EjsTemplateSettings(props: PluginSettingsPanelProps) {
  const { pluginId } = props;
  const render = useSyncExternalStore(subscribeEjsRenderStats, getEjsRenderSnapshot);

  const [entries, setEntries] = useState<EjsWorldInfoEntry[]>(() => collectEjsWorldInfoEntries());
  const [selectedId, setSelectedId] = useState<string>("");
  const [trialRunning, setTrialRunning] = useState(false);
  const [trial, setTrial] = useState<EjsTrialResult | null>(null);
  const [trialTargetName, setTrialTargetName] = useState<string>("");

  // 卸载后不再 setState（试渲染是异步的，面板可能已被关闭）。
  const aliveRef = useRef(true);
  useEffect(
    () => () => {
      aliveRef.current = false;
    },
    [],
  );

  const hostReady = getScriptHostApi() !== null;
  const selected = entries.find((entry) => entry.id === selectedId) ?? entries[0] ?? null;
  const turn = render.turn;

  const refreshEntries = () => {
    const next = collectEjsWorldInfoEntries();
    setEntries(next);
    setTrial(null);
  };

  const runTrial = async () => {
    if (!selected || trialRunning) return;
    setTrialRunning(true);
    setTrialTargetName(selected.name);
    try {
      const result = await runTrialEjsRender({
        id: selected.id,
        name: selected.name,
        content: selected.content,
      });
      if (aliveRef.current) setTrial(result);
    } finally {
      if (aliveRef.current) setTrialRunning(false);
    }
  };

  return (
    <div className="space-y-5 min-w-0" data-plugin-id={pluginId}>
      {/* ── 安全告知 + K1（常驻、紧贴顶部，与 ScriptRunnerSettings 同版式）───── */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <div className="space-y-1 min-w-0">
          <p className="font-medium">安全提示</p>
          <p className="leading-relaxed break-words">{EJS_SECURITY_NOTICE_TEXT}</p>
          <p className="leading-relaxed break-words">{EJS_K1_NOTICE_TEXT}</p>
        </div>
      </div>

      {/* ── 本轮渲染统计 ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 min-h-[1.25rem]">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            本轮渲染统计
          </label>
          <button
            type="button"
            onClick={clearEjsRenderState}
            className="px-2 py-1 text-[11px] font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            清空统计
          </button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <StatCell
            label="渲染条目数"
            value={turn ? `${turn.rendered} / ${turn.matched}` : "—"}
            hint="成功 / 命中 matches"
          />
          <StatCell label="EJS 块数" value={turn ? String(turn.blocks) : "—"} />
          <StatCell
            label="耗时"
            value={turn ? `${Math.max(0, turn.updatedAt - turn.startedAt)} ms` : "—"}
          />
          <StatCell
            label="降级条目数"
            value={turn ? String(turn.failed) : "—"}
            tone={turn && turn.failed > 0 ? "danger" : undefined}
          />
          <StatCell
            label="变量写入"
            value={turn ? String(turn.writes) : "—"}
            hint="已交给宿主统一提交"
          />
          <StatCell label="本轮 turnId" value={turn ? shortTurnId(turn.turnId) : "—"} />
        </div>
        {render.lastError && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-400 space-y-1 min-w-0">
            <p className="font-medium break-words">
              最近一次错误 · {formatTime(render.lastError.at)} ·{" "}
              <span className="font-mono break-all">{render.lastError.scope}</span>
            </p>
            <p className="leading-relaxed break-words">{render.lastError.title}</p>
            <p className="leading-relaxed whitespace-pre-wrap break-all">{render.lastError.detail}</p>
          </div>
        )}
        <p className="text-[11px] text-gray-500 dark:text-gray-400 break-words">
          {turn
            ? `统计口径：本节由插件的渲染器在宿主 pre-pass 里逐条目发布（${turn.items.length} 行明细）；「命中 matches」是宿主问过「这条正文含不含 EJS」且答 yes 的条目数。`
            : "本轮暂无渲染记录：还没发过消息，或本轮没有激活的含 EJS 条目。"}
        </p>
      </div>

      {/* ── 逐条目视图 ②：当前角色含 EJS 的条目 ─────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 min-h-[1.25rem]">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            含 EJS 的条目（当前角色，{entries.length} 条）
          </label>
          <button
            type="button"
            onClick={refreshEntries}
            className="px-2 py-1 text-[11px] font-medium rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
          >
            刷新条目
          </button>
        </div>
        {!hostReady ? (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            宿主门面尚未注册（getScriptHostApi() === null）：应用还在启动，稍后点「刷新条目」。
          </p>
        ) : entries.length === 0 ? (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">
            当前角色的世界书里没有含 EJS（{"<%"}）的条目。本插件只处理世界书条目正文里的 EJS，
            不含 EJS 的条目行为完全不变。
          </p>
        ) : (
          <ul className="space-y-1.5 list-none min-w-0">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="rounded-lg border border-gray-200 dark:border-white/10 p-2 min-w-0"
              >
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-gray-500 dark:text-gray-400 min-w-0">
                  <span className="font-medium text-gray-700 dark:text-gray-300 break-all">
                    {entry.name}
                  </span>
                  <span>{entry.triggerType === "permanent" ? "常驻" : "关键词"}</span>
                  <span>{entry.enabled ? "已启用" : "已禁用"}</span>
                  <span>块 {entry.blocks}</span>
                  <span className="tabular-nums">{entry.contentChars} 字符</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* ── 试渲染（只读）───────────────────────────────────────────────── */}
      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          试渲染（只读，不提交写入）
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selected ? selected.id : ""}
            onChange={(event) => {
              setSelectedId(event.target.value);
              setTrial(null);
            }}
            disabled={entries.length === 0}
            className="flex-1 min-w-[12rem] px-3 py-2 text-xs rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-700 dark:text-gray-300 disabled:opacity-50"
          >
            {entries.length === 0 ? (
              <option value="">（当前角色没有含 EJS 的条目）</option>
            ) : (
              entries.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name} · {entry.blocks} 块{entry.enabled ? "" : "（条目已禁用）"}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => void runTrial()}
            disabled={!selected || trialRunning || !hostReady}
            className="px-4 py-2 text-xs font-medium rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {trialRunning && <Loader2 size={14} className="animate-spin" />}
            {trialRunning ? "渲染中…" : "试渲染"}
          </button>
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 break-words">
          用当前变量的快照渲染所选条目的原文；结果里的写入意图一律丢弃（不会改动任何变量）。
          注意：发送时宿主会先跑「占位符 → 变量宏 → 正则」再进渲染器（SSOT D16-R），本工具不跑那一段，
          所以输出可能与真机不同。
        </p>
        {trial && (
          <div
            className={`rounded-xl border p-3 text-xs space-y-1 min-w-0 ${
              trial.ok
                ? "border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400"
                : "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400"
            }`}
          >
            <p className="font-medium break-words">
              {trial.ok ? "渲染成功" : "渲染失败"} · {trialTargetName} · {trial.elapsedMs} ms
              {trial.discardedWrites > 0 ? ` · 已丢弃 ${trial.discardedWrites} 条写入` : ""}
            </p>
            {trial.ok ? (
              <>
                <pre className="max-h-60 overflow-auto rounded-lg bg-white/60 dark:bg-black/30 p-2 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all text-gray-700 dark:text-gray-300">
                  {trial.text || "(空输出)"}
                </pre>
                {trial.truncated && (
                  <p className="break-words">
                    输出超过 {EJS_TRIAL_PREVIEW_MAX_CHARS} 字符，已截断展示。
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="leading-relaxed break-words">{trial.errorTitle}</p>
                <p className="leading-relaxed whitespace-pre-wrap break-all">{trial.errorDetail}</p>
              </>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

/** 统计格子（窄屏 2 列 / 宽屏 3 列）。 */
function StatCell({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "danger";
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-white/10 p-2.5 min-w-0">
      <p className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</p>
      <p
        className={`mt-0.5 text-sm font-semibold tabular-nums break-all ${
          tone === "danger" ? "text-red-600 dark:text-red-400" : "text-gray-800 dark:text-gray-100"
        }`}
      >
        {value}
      </p>
      {hint && <p className="text-[10px] text-gray-400 dark:text-gray-500 break-words">{hint}</p>}
    </div>
  );
}

export default EjsTemplateSettings;
