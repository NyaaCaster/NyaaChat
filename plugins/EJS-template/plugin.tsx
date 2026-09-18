/**
 * ejs-template —— NyaaChat 原生插件装配（SSOT §2.4 目录树 + §8 最小 UI）。
 *
 * ## 职责（一句话）
 *
 * 把**世界书条目正文**里的 EJS（`<% %>`）渲染成提示词文本：向宿主的**叶子**契约
 * `src/plugins/promptText.ts`（「条目文本渲染缝」）注册一个 `PromptTextRenderer`，
 * 宿主在**异步 pre-pass** 里按 `rule.id` 逐条目调用它（SSOT §2.2 / D16-R 选项 A），
 * 组装期再取缓存结果。
 *
 * ## 模块边界（**读这个之前先读 `src/plugins/pluginLog.ts` 的文件头**）
 *
 * 插件树只允许两类静态边：
 *
 *  1. `src/plugins/types`（**type-only**）；
 *  2. **叶子模块** `src/plugins/{promptText,scriptHost,pluginLog}` —— 它们不 import
 *     `registry` / `runtime` / `backend`，因此不会构成
 *     `plugins/registry → plugin → … → src/plugins/registry` 的模块环。
 *
 * **禁止**值导入 `src/plugins/{index,runtime,registry,backend}`：那是"插件静默消失"
 * 的已知成因（`ST扩展移植规范.md` §10.2 坑 #3 / 坑 #4）。
 *
 * ## ⚠️ SSOT §2.4 目录树的一处偏离（登记）
 *
 * SSOT §2.4 列了 `plugins/EJS-template/registry.ts`（"向叶子 registerPromptTextRenderer 注册"）。
 * 本轮任务卡的 inScope 只有 3 个文件（`plugin.tsx` / `EjsTemplateSettings.tsx` /
 * `plugins/registry.ts`），因此那个"插件内注册模块"**合并进本文件**：
 * 渲染器对象、载体与 env 快照的取用时机、写入收集、统计发布全部住在这里。
 * 副作用是"统计 store / 软上限 / 块数计数"被放在 `EjsTemplateSettings.tsx`
 * （本文件单向引用它；反过来会成环 —— 理由写在该文件头部）。
 *
 * ## 三条与保真度/时序有关的硬约束
 *
 *  · **`getScriptHostApi()` 必须在每次渲染时取用**，不得在 `setup` 期缓存：
 *    实测 `App.tsx` 的 `setup`（:940）**早于**门面注入（:988），setup 期取到 `null`
 *    （SSOT G3）。本条由"渲染期取用"这一结构保证 —— 本文件里没有任何模块级 `getScriptHostApi()` 调用。
 *  · **降级 = 丢弃该条目内容**：渲染失败/超时/超软上限时返回空串，**绝不**把 `<% %>`
 *    原文发给模型（SSOT §2.7）；错误进 `pluginLogger`（面板可见）与统计。
 *  · **写入不当场落盘**：`renderEntry` 把写入回放到本轮活快照（`env.applyWriteIntent`）并登记到
 *    快照的写入日志；插件侧另在 `takeWrites()` 缓冲一份供宿主/UI 取用。宿主在 pre-pass 结束后
 *    用 `takeSessionWriteLog(snapshot)` **统一提交一次**（SSOT D9 / V6 幂等）——**该调用点属宿主侧**
 *    （`src/plugins/promptText.ts` 目前不调用 `takeWrites()`），见交付说明的"待接线"一条。
 */
import { pluginLogger } from "../../src/plugins/pluginLog";
import { getScriptHostApi } from "../../src/plugins/scriptHost";
import {
  registerPromptTextRenderer,
  type PromptTextContext,
  type PromptTextRenderer,
  type PromptTextWrite,
} from "../../src/plugins/promptText";
import type { NyaaPlugin, PluginSettingsPanelProps } from "../../src/plugins/types";
import { compileTemplate } from "./engine/compile";
import { createCarrier, type Carrier } from "./host/carrier";
import {
  buildEnvSnapshot,
  countEjsBlocks,
  loadYaml,
  matchesEjsTemplate,
  type EjsEnvSnapshot,
} from "./host/env";
import { renderEntry } from "./host/renderEntry";
import { describeEjsError } from "./errors";
import EjsTemplateSettings, {
  EJS_SOFT_CAP_CARRIER_TIMEOUT_MS,
  EJS_SOFT_CAP_MAX_BLOCKS,
  EJS_SOFT_CAP_MAX_CHARS,
  EJS_TEMPLATE_BUILD,
  EJS_TURN_ITEM_LIMIT,
  publishEjsLastError,
  publishEjsTurn,
  setEjsPluginActive,
  type EjsRenderRow,
  type EjsTurnStats,
} from "./EjsTemplateSettings";

/** 插件 id（与 `plugins/registry.ts` 的注册键、`pluginLog` 的归属、配置持久化键同值）。 */
export const EJS_TEMPLATE_PLUGIN_ID = "ejs-template";

const log = pluginLogger(EJS_TEMPLATE_PLUGIN_ID);

/** 日志行里 detail 的上限（保持控制台/日志列表一行可读；面板另存更长的一版，见下）。 */
const ERROR_DETAIL_LOG_MAX_CHARS = 600;
/**
 * 面板「最近一次错误」里 detail 的上限。
 *
 * ⚠️ 与 `errors.ts` 的 `MAX_DETAIL_CHARS = 1200` 对齐：那里已经保证 detail **已剥离 `<% … %>`
 * 片段**并按 1200 截断，所以面板可以直接展示整段「原因 / 提示 / 处置」——**不要**在这里再砍到
 * 600（用户看不到处置建议正是 `ST扩展移植规范.md` §10.2 坑 #6 的原症状）。
 */
const ERROR_DETAIL_PANEL_MAX_CHARS = 1200;

// ─────────────────────────────────────────────────────────────────────────────
// 判据（宿主 `needsPromptText` 会同步调用 `matches`）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 是否可能含 EJS —— 口径的唯一定义处在 `host/env.ts` 的 `matchesEjsTemplate()`
 * （正文出现开定界符 `<%`，与 `EJS本地自测方法.md` 的 O8 一致：无标签文本 → `false`）。
 *
 *  · 必须是**廉价同步**判据（宿主在每个条目的分组判定里都会问一次）；
 *  · `<%%`（字面量转义）也含 `<%` ⇒ 判 true，这与上游一致（它是一个真正的 token）；
 *  · 判 true 但引擎发现没有真正的 token 时，`renderEntry` 会短路回原文（M11）；
 *  · `host/env.ts` 与 `host/renderEntry.ts` 的内部块判定用的是**同一份**口径 —— 不在这里
 *    另写一个 `includes("<%")`，避免"判据/计数"两处漂移。
 */
function containsEjsTag(text: unknown): boolean {
  return typeof text === "string" && matchesEjsTemplate(text);
}

// ─────────────────────────────────────────────────────────────────────────────
// 本轮状态（模块级单例：插件是单例，宿主按 `turnId` 组织一轮）
// ─────────────────────────────────────────────────────────────────────────────

interface TurnState {
  turnId: string;
  startedAt: number;
  updatedAt: number;
  matched: number;
  rendered: number;
  failed: number;
  blocks: number;
  writes: number;
  items: EjsRenderRow[];
  /** 待宿主提交的写入（`takeWrites()` 取走后清空）。 */
  pendingWrites: PromptTextWrite[];
  /** 本轮复用的 env 快照（每轮构建一次；`buildEnvSnapshot` 是按会话复用的活快照）。 */
  envSnapshot: EjsEnvSnapshot | null;
  /**
   * 本轮渲染会话对象（`renderEntry` 的 `options.session`）。
   *
   * ⚠️ **必须逐轮、逐对象稳定**：`renderEntry` 用 `WeakMap` 认领会话对象得到作用域键，
   * 每次渲染新建一个对象会让幂等表与写入回放台账各记一份（`delivered` 膨胀、回放守卫失效）。
   */
  session: { sessionId: string; turnId: string };
  /**
   * 本轮已渲染过的**正文键**（`hash-长度`）。
   *
   * `renderEntry` 自己有幂等表，但它**不告诉调用方"这次是不是命中缓存"**
   * （命中时 `executed` 仍可能是 true，因为缓存里存的就是"执行过"的结果）
   * ⇒ 统计要在自己这边记账：重复投递的行标「幂等命中」，且**不再累加**
   * `rendered` / `failed` / `blocks` / `writes`（否则同一轮的重投会把统计翻倍）。
   */
  seenEntryIds: Set<string>;
  callIndex: number;
  /** 本轮开始时抓取的"条目名 ↔ 正文"候选（用于尽力匹配条目名）。 */
  nameCandidates: Array<{ name: string; content: string }>;
}

let turn: TurnState | null = null;
/**
 * `matches()` 在**本轮还没有渲染调用**时命中的正文键集合。
 *
 * 为什么要这个：`matches(text)` 的契约里没有 `turnId`（SSOT §2.2 冻结签名），而宿主会先为
 * 若干条目问 `matches`、再进入渲染调用；而且同一轮里 `needsPromptText()` 可能被
 * `chatPipeline` 的分组判定与 `preparePromptText` 各问一次（**同一正文问两次**）。
 * 于是"第一条渲染调用"把这批命中数收进本轮，之后每次渲染调用继续并账 —— 这是**近似口径**，
 * 且**按正文去重**（键 = FNV-1a 哈希 + 长度），不用它就无法给出
 * `EJS本地自测方法.md` §8 要的 `matched` 字段。
 */
const pendingMatchKeys = new Set<string>();
/**
 * **本轮已计入 `matched` 的正文键** —— 跨批去重（P6 真机发现）。
 *
 * 为什么需要它：同一轮里 `needsPromptText()` 会被问**两批**（`chatPipeline` 的分组判定
 * 一批 + `preparePromptText` 一批），而 `pendingMatchKeys` 每批都被取走并清空 ⇒ 第二批
 * 不认识第一批 ⇒ 同一批正文被数两遍（真机实测：39 条被显示成 **77**）。
 * 这里保留一份"已计入"的集合，只在**换轮**时清，`matched` 因此逐批去重累加。
 */
const seenMatchKeys = new Set<string>();
/** 跨轮复用的执行载体（`templateHash` 缓存住在它内部 ⇒ 复用才有收益）。 */
let carrier: Carrier | null = null;
/** vendor YAML 的按需预热（本文件与面板各持一份 memo；失败只告警一次）。 */
let yamlReady: Promise<void> | null = null;

function ensureYaml(): Promise<void> {
  if (!yamlReady) {
    yamlReady = loadYaml().then(
      () => undefined,
      (err: unknown) => {
        log.warn("yaml", "vendor YAML（public/vendor/script-host/yaml/yaml.esm.js）加载失败：使用 YAML 的模板会降级", err);
      },
    );
  }
  return yamlReady;
}

function ensureCarrier(): Carrier {
  if (!carrier) {
    carrier = createCarrier({
      timeoutMs: EJS_SOFT_CAP_CARRIER_TIMEOUT_MS,
      onError: (id, message) => log.warn("carrier", `载体报错（${id}）：${message}`),
    });
  }
  return carrier;
}

/** 条目名候选（只取含 EJS 且正文足够长的条目，避免"短正文到处命中"的误报）。 */
function collectNameCandidates(): Array<{ name: string; content: string }> {
  try {
    return (getScriptHostApi()?.character.getWorldInfo() ?? [])
      .filter(
        (rule) =>
          typeof rule.content === "string" &&
          rule.content.includes("<%") &&
          rule.content.trim().length >= 16,
      )
      .map((rule) => ({
        name: typeof rule.name === "string" && rule.name.trim() ? rule.name.trim() : "(未命名条目)",
        content: rule.content.trim(),
      }));
  } catch (err) {
    log.warn("render", "读取世界书条目用于条目名匹配失败（继续渲染，只影响名字展示）", err);
    return [];
  }
}

/**
 * 尽力匹配条目名：取"正文出现在本次输入里"的**最长**候选。
 *
 * ⚠️ 这只是**展示用**的推断：宿主契约里 `render(text, ctx)` 不含 `rule.id`，
 * 而 pre-pass 的输入是"占位符 → 变量宏 → 正则"之后的正文本，条目原文常常正好在内。
 * 匹配不上时返回 `null`，面板显示「未匹配到条目名」——**不猜**。
 */
function matchEntryName(
  state: TurnState,
  text: string,
): { name: string | null; guessed: boolean } {
  let best: string | null = null;
  let bestLength = 0;
  for (const candidate of state.nameCandidates) {
    if (candidate.content.length <= bestLength) continue;
    if (!text.includes(candidate.content)) continue;
    best = candidate.name;
    bestLength = candidate.content.length;
  }
  return { name: best, guessed: best !== null };
}

/**
 * FNV-1a 32bit —— 条目 id（正文指纹）的来源。
 *
 * ⚠️ 与 `engine/compile.ts` 的 `hashTemplate()` **是同一套算法**（同初值/同质数）⇒ 这里算出的
 * 指纹与 `CompiledSource.templateHash`（载体的函数缓存键）同值，不会出现"两个指纹"。
 */
function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…（已截断）`;
}

function ensureTurn(ctx: PromptTextContext): TurnState {
  if (!turn || turn.turnId !== ctx.turnId) {
    const now = Date.now();
    // 换轮 ⇒ 清"已计入"集合。⚠️ 不能在这里清 `pendingMatchKeys`：`matches()` 在
    // `render()` 之前就被问过，本批的键已经躺在集合里，清了会丢掉本轮第一批的命中数。
    seenMatchKeys.clear();
    turn = {
      turnId: ctx.turnId,
      startedAt: now,
      updatedAt: now,
      matched: 0,
      rendered: 0,
      failed: 0,
      blocks: 0,
      writes: 0,
      items: [],
      pendingWrites: [],
      envSnapshot: null,
      session: { sessionId: ctx.sessionId, turnId: ctx.turnId },
      seenEntryIds: new Set<string>(),
      callIndex: 0,
      nameCandidates: collectNameCandidates(),
    };
  }
  // 跨批去重：同一轮内同一个"正文键"只计入一次（键 = FNV-1a 哈希 + 长度）。
  for (const key of pendingMatchKeys) {
    if (!seenMatchKeys.has(key)) {
      seenMatchKeys.add(key);
      turn.matched += 1;
    }
  }
  pendingMatchKeys.clear();
  return turn;
}

function toTurnStats(state: TurnState): EjsTurnStats {
  return {
    turnId: state.turnId,
    startedAt: state.startedAt,
    updatedAt: state.updatedAt,
    matched: state.matched,
    rendered: state.rendered,
    failed: state.failed,
    blocks: state.blocks,
    writes: state.writes,
    items: state.items,
  };
}

function pushItem(state: TurnState, row: EjsRenderRow): void {
  state.items.push(row);
  if (state.items.length > EJS_TURN_ITEM_LIMIT) {
    state.items.splice(0, state.items.length - EJS_TURN_ITEM_LIMIT);
  }
}

/** 记一条错误：控制台（带归属）+ 面板日志缓冲 + 面板的「最近一次错误」。 */
function reportError(
  scope: string,
  described: { title: string; detail: string },
): { title: string; detail: string } {
  // 日志行短（可读），面板存长（可处置）；两者都只是**再**截断一次，
  // `errors.ts` 已经剥离模板片段 ⇒ 不会把条目正文带进控制台或界面。
  const logDetail = clip(described.detail, ERROR_DETAIL_LOG_MAX_CHARS);
  const panelDetail = clip(described.detail, ERROR_DETAIL_PANEL_MAX_CHARS);
  log.error(scope, `${described.title} —— ${logDetail}`);
  publishEjsLastError({ at: Date.now(), scope, title: described.title, detail: panelDetail });
  return { title: described.title, detail: panelDetail };
}

// ─────────────────────────────────────────────────────────────────────────────
// 渲染器（注册进宿主的「条目文本渲染缝」）
// ─────────────────────────────────────────────────────────────────────────────

const renderer: PromptTextRenderer = {
  pluginId: EJS_TEMPLATE_PLUGIN_ID,

  matches(text: string): boolean {
    const hit = containsEjsTag(text);
    // 按正文去重：同一轮里同一正文被问多次（chatPipeline 分组 + pre-prepareText）只算一次。
    if (hit) pendingMatchKeys.add(`${hashText(text)}-${text.length}`);
    return hit;
  },

  async render(text: string, ctx: PromptTextContext): Promise<string> {
    const startedAt = Date.now();
    const blocks = countEjsBlocks(text);
    const state = ensureTurn(ctx);
    const index = (state.callIndex += 1);
    const { name, guessed } = matchEntryName(state, text);
    const entryLabel = name ?? `(本轮第 ${index} 个含 EJS 的条目)`;
    // 条目 id = 正文指纹（`compile.ts` 的 `hashTemplate` 是同一套 FNV-1a ⇒ 与 `templateHash` 同值）。
    const entryId = `${hashText(text)}-${text.length}`;
    // 本轮是否已经渲染过同一份正文（重复投递 ⇒ 只记账一次，见 `seenEntryIds` 的注释）。
    const replayed = state.seenEntryIds.has(entryId);
    if (!replayed) state.seenEntryIds.add(entryId);
    const base: EjsRenderRow = {
      index,
      entryId,
      entryName: name,
      nameGuessed: guessed,
      blocks,
      inputChars: text.length,
      outputChars: 0,
      ok: false,
      skipped: false,
      elapsedMs: 0,
      at: startedAt,
    };

    const finish = (row: EjsRenderRow): void => {
      state.updatedAt = Date.now();
      pushItem(state, { ...row, elapsedMs: Date.now() - startedAt });
      publishEjsTurn(toTurnStats(state));
    };

    // ── 软上限（K1 缓解 / D12）：跳过该条目并降级，绝不把模板原文交给模型 ──
    if (blocks > EJS_SOFT_CAP_MAX_BLOCKS || text.length > EJS_SOFT_CAP_MAX_CHARS) {
      const reason =
        blocks > EJS_SOFT_CAP_MAX_BLOCKS
          ? `条目「${entryLabel}」的 EJS 块数 ${blocks} 超过软上限 ${EJS_SOFT_CAP_MAX_BLOCKS}，已跳过渲染`
          : `条目「${entryLabel}」的正文长度 ${text.length} 超过软上限 ${EJS_SOFT_CAP_MAX_CHARS}，已跳过渲染`;
      const described = reportError(
        "render.skipped",
        describeEjsError(new Error(reason), { entryName: entryLabel, entryId }),
      );
      if (!replayed) state.failed += 1;
      finish({
        ...base,
        skipped: true,
        deduped: replayed,
        errorTitle: described.title,
        errorDetail: described.detail,
      });
      return "";
    }

    try {
      // ① 编译：定界符扫描 + 源生成（纯字符串，无 eval / new Function）
      const compiled = compileTemplate(text);

      // ② env 快照：**每轮一份**（同一份活快照 ⇒ 前面条目 `setvar` 后面条目 `getvar` 读得到，D9）
      await ensureYaml();
      if (!state.envSnapshot) {
        state.envSnapshot = buildEnvSnapshot({
          characterId: ctx.character?.id ?? null,
          identity: {
            user: ctx.identity?.user ?? "",
            char: ctx.identity?.char ?? "",
          },
          ...(ctx.character?.name === undefined ? {} : { characterName: ctx.character.name }),
          sessionId: ctx.sessionId,
        });
      }

      // ③ 渲染：**一块 = 一次调用**（整个条目的全部 EJS 块合并成一个函数体，否则违反幂等）
      const result = await renderEntry(
        ensureCarrier(),
        {
          id: entryId,
          content: text,
          name: entryLabel,
          calls: [{ id: entryId, templateHash: compiled.templateHash, functionBody: compiled.body }],
        },
        state.envSnapshot,
        { session: state.session },
      );
      const output = typeof result.text === "string" ? result.text : "";
      const writes = Array.isArray(result.writes) ? result.writes : [];

      if (result.outcome === "ok") {
        if (!replayed && result.executed === true) {
          state.rendered += 1;
          state.blocks += blocks;
          if (writes.length > 0) {
            state.pendingWrites.push(...writes);
            state.writes += writes.length;
          }
          log.info("render", `条目「${entryLabel}」渲染成功：${blocks} 块 / ${output.length} 字符`);
        }
        finish({ ...base, ok: true, deduped: replayed, outputChars: output.length });
        return output;
      }

      // ④ 降级：丢弃该条目内容（**绝不**把 `<% %>` 原文交给模型，SSOT §2.7）
      const message = result.error ?? `条目未被执行（outcome=${result.outcome}）`;
      const described = reportError(
        "render",
        describeEjsError(new Error(message), { entryName: entryLabel, entryId }),
      );
      if (!replayed) state.failed += 1;
      finish({
        ...base,
        deduped: replayed,
        errorTitle: described.title,
        errorDetail: described.detail,
      });
      return "";
    } catch (err) {
      const described = reportError(
        "render",
        describeEjsError(err, { entryName: entryLabel, entryId }),
      );
      if (!replayed) state.failed += 1;
      finish({
        ...base,
        deduped: replayed,
        errorTitle: described.title,
        errorDetail: described.detail,
      });
      return "";
    }
  },

  /**
   * 本轮收集到的写入意图（SSOT D9 / V6）。
   *
   * ⚠️ 真实提交路径在**宿主侧**：`renderEntry` 已把写入回放到活快照、并经
   * `env.recordWriteIntents()` 登记到快照的写入日志，宿主在 pre-pass 结束后用
   * `takeSessionWriteLog(snapshot)` 取一次提交（`src/plugins/promptText.ts` 目前**没有**
   * 调用本方法 —— 它只是契约里留给宿主/UI 的取用口）。
   */
  takeWrites(): PromptTextWrite[] {
    if (!turn || turn.pendingWrites.length === 0) return [];
    const writes = turn.pendingWrites;
    turn.pendingWrites = [];
    return writes;
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// 装配
// ─────────────────────────────────────────────────────────────────────────────

/** 设置面板：直接交给本插件的 UI 组件（它自己订阅统计与日志，见其文件头）。 */
function SettingsPanel(props: PluginSettingsPanelProps) {
  return <EjsTemplateSettings {...props} />;
}

const plugin: NyaaPlugin = {
  meta: {
    id: EJS_TEMPLATE_PLUGIN_ID,
    name: "EJS模板",
    description:
      "把世界书条目正文里的 EJS 模板（<% %>）渲染成提示词文本，随本轮请求发出：含 EJS 的常驻条目进入尾部「模板设定」小节。只提供运行能力，不提供编写功能；模板与宿主同源运行，只渲染可信来源的角色卡。",
    version: "1.0.0",
    author: "Nyaa",
    // ⚠️ 必须取自 `ExtensionsModal.tsx` 的 12 项图标允许集，否则静默回退 Puzzle。
    icon: "Sparkles",
    order: 20,
  },
  defaults: {},
  setup: () => {
    setEjsPluginActive(true);
    try {
      // 可查的构建标记（主页面控制台 `__nyaEjsTemplateBuild`），排障时先看它。
      (window as unknown as Record<string, unknown>).__nyaEjsTemplateBuild = EJS_TEMPLATE_BUILD;
    } catch {
      /* 标记失败不影响功能 */
    }
    log.info("setup", `已装配，构建 ${EJS_TEMPLATE_BUILD}`);

    // ⚠️ 此处**不要**取 `getScriptHostApi()` 做判空并 return：setup 早于门面注入（SSOT G3），
    // 拿不到并不代表插件不能用 —— 渲染期每次都会重新取（见文件头第 1 条硬约束）。
    const dispose = registerPromptTextRenderer(renderer);
    // YAML 预热：非阻塞；只要它先于首次渲染完成即可，失败只告警。
    void ensureYaml();

    return () => {
      setEjsPluginActive(false);
      try {
        dispose();
      } catch (err) {
        log.warn("dispose", "渲染器取消注册抛错", err);
      }
      try {
        carrier?.destroy();
      } catch (err) {
        log.warn("dispose", "载体销毁抛错", err);
      }
      carrier = null;
      turn = null;
      pendingMatchKeys.clear();
      seenMatchKeys.clear();
      yamlReady = null;
    };
  },
  SettingsPanel,
};

export default plugin;

/** 探针/验证脚本用：复位插件内部状态（生产代码不调用）。 */
export function resetEjsTemplateForTests(): void {
  turn = null;
  pendingMatchKeys.clear();
  seenMatchKeys.clear();
  yamlReady = null;
  try {
    carrier?.destroy();
  } catch {
    /* 复位阶段不关心销毁失败 */
  }
  carrier = null;
}

/**
 * 探针/验证脚本用：注入一个**载体替身**（`host/carrier.ts` 的 `Carrier` 结构化形状）。
 *
 * 存在理由（t10 集成冒烟）：真实载体是 srcdoc iframe，Node 里没有 DOM ⇒ 无法端到端驱动
 * "真渲染器 + 真 env + 真编排"这条链路。注入替身后 `ensureCarrier()` 直接返回它，
 * 于是**除 DOM 执行底座之外**的每一环（compile → env 快照 → renderEntry 幂等/写入回放
 * → 渲染器统计 → 宿主写入提交）都是真实产品代码。
 *
 * `null` = 恢复默认（下次渲染按需 `createCarrier()`）；生产代码不调用。
 */
export function setEjsCarrierForTests(next: Carrier | null): void {
  carrier = next;
}
