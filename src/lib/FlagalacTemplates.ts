/**
 * AnswererFlagalac 模块的条目配置 —— **审核绕过目标（单选）与子选项的唯一事实来源**。
 *
 * 与 lib/WordCheckTemplates.ts / lib/WordCountTemplates.ts 同构：本文件集中
 * 定义模块对外暴露的全部条目、子选项、默认值与解析函数，其他代码一律不硬编码
 * 条目。BypassModal 只负责把这里的条目渲染成单选列表与子选项开关组，把用户
 * 选中的 `id` 写进 `settings.bypass.answererFlagalac.target`；chatPipeline /
 * api / 正则层按各自需要读取本文件导出的内容。
 *
 * ── 维护方式：只改这一个文件，其余代码无需同步 ──────────────────────────
 * 1. **新增目标**：在 `flagalacTargets` 里追加一条 `{ id, label, ... }`。
 *    数组顺序 = 界面顺序，把新模型插到对应位置即可。
 * 2. **下线目标**：直接从数组里删除该条。存档/备份中残留的旧 id 会在读取时
 *    由 `resolveFlagalacTarget()` 收敛为「无」，不会留下“选不中任何条目”的
 *    僵死状态（见 App.tsx 的读取归一化与 lib/settingsBackup.ts 的导入回填）。
 * 3. **新增/下线子选项**：改对应目标的 `options` 数组。**新增开关不需要数据
 *    迁移** —— `resolveFlagalacOptions()` 在读取时用 `defaultEnabled` 补齐缺键，
 *    未知 id 静默丢弃（见下）。
 * 4. **更新某个目标的载荷内容**：填进该选项的 `template`。当前为占位：按开发
 *    计划，载荷正文由用户在台账里统一改写后再落进这里，**本阶段不写正文**。
 *
 * ⚠️ `id` 一旦发布即等同持久化键，**不可再改**（目标 id 与选项 id 都是）：它们
 * 同时存在于用户的 localStorage 与导出的备份里，改名会让老存档静默回落到
 * 「无」或静默丢掉该开关的状态。
 * ⚠️ `FLAGALAC_NONE_ID`（「无」）必须始终存在且**排在首位**：它既是默认值，
 * 也是所有未知/失效 id 的回落目标。
 */

export const FLAGALAC_NONE_ID = "none";

/**
 * 子选项的分层标签。目前只用于把开关分组显示；不进请求体，也不影响解析。
 */
export type FlagalacOptionLayer =
  | "identity" // 身份/指令层
  | "output-channel" // 输出通道
  | "encoding" // 编码规避
  | "anti-truncation" // 防截断
  | "trace-cleanup"; // 痕迹清理

/** 子选项开关组的显示分组标题（保持 layer 的定义顺序）。 */
export const FLAGALAC_LAYER_LABELS: Record<FlagalacOptionLayer, string> = {
  identity: "身份/指令层",
  "output-channel": "输出通道",
  encoding: "编码规避",
  "anti-truncation": "防截断",
  "trace-cleanup": "痕迹清理",
};

export interface FlagalacOption {
  /** 持久化键（写进 `perTarget[targetId].options`）。发布后**不可改**。 */
  id: string;
  /** 开关显示名。 */
  label: string;
  /** 开关下方的一行说明（可选，保持简短）。 */
  description?: string;
  /** 默认值。读取时缺键/非布尔一律落回这里 —— 因此新增开关无需迁移。 */
  defaultEnabled: boolean;
  /** 所属分层，用于 UI 分组。 */
  layer: FlagalacOptionLayer;
  /**
   * 该选项的载荷文本。**当前统一留空**：按开发计划，载荷正文由用户在私有仓的
   * 载荷台账里统一改写后再落进这里，本阶段代码内只落地结构。
   * 有 `template` 的选项，UI 才提供「编辑/重置」。
   */
  template?: string;
  /** false = 依赖未就绪 ⇒ UI 置灰（单选不可用），不写回用户改动。 */
  available?: boolean;
  /** 置灰时显示的具体原因（必须说明缺什么，禁止沿用通用的「逻辑尚未接入」）。 */
  unavailableReason?: string;
}

export interface FlagalacTarget {
  /** 持久化 id（写入 settings.bypass.answererFlagalac.target）。发布后不可更改。 */
  id: string;
  /** 单选条目的显示名称。 */
  label: string;
  /** 条目下方的一行补充说明（可选，保持简短）。 */
  description?: string;
  /**
   * 该目标要求的「流式输出」状态（P3 读它自动同步 `settings.isStreaming`）。
   * 省略 = 不干预。注意这里只是**声明要求**，本文件不修改任何设置。
   */
  requiresStreaming?: boolean;
  /** 该目标下的子选项开关组。省略 = 该目标不提供子选项。 */
  options?: readonly FlagalacOption[];
}

/**
 * 单选条目清单。数组顺序即界面顺序；首项必须是「无」。
 * 新增 / 下线 / 调整目标只改这里。
 *
 * 子选项的**默认值 = 来源预设里该条目的启用状态**（已在开发计划 §5.2 逐项核定）。
 * 全部开关均已接入：`toolChannel` 的两个 Function Tool 定义、命名常量与
 * 「参数=正文」回收规则在本文件末尾；`api.ts` 按 E1 载荷块的 `options` 属性
 * 判断该开关是否启用（见 SSOT §4.2 / §4.5）。
 */
export const flagalacTargets: readonly FlagalacTarget[] = [
  {
    id: FLAGALAC_NONE_ID,
    label: "无",
    description: "不启用本模块，不注入任何绕过内容。",
  },
  {
    id: "gemini25pro31pro",
    label: "gemini2.5pro & 3.1pro",
    description: "对应 gemini2.5pro / 3.1pro 的拦截机制。",
    // 来源说明要求开流式（与其导出配置一致）。本文件只声明要求，实际改写
    // settings.isStreaming 由 flagalacOptions.ts（P3）负责。
    requiresStreaming: true,
    options: [
      {
        id: "systemDirective",
        label: "系统指令重定义",
        description: "重写系统指令的定位，让后续内容被当作规则而非请求。",
        defaultEnabled: true,
        layer: "identity",
      },
      {
        id: "identityTakeover",
        label: "身份接管（叙事式）",
        description: "以叙事方式接管身份，替代直接的能力声明。",
        defaultEnabled: true,
        layer: "identity",
      },
      {
        id: "diegeticBridge",
        label: "情境化衔接",
        description: "把对话情境与输出任务衔接起来，减少直接拒绝。",
        defaultEnabled: true,
        layer: "identity",
      },
      {
        id: "toolChannel",
        label: "工具通道（思考 + 正文双工具）",
        description: "正文经函数工具参数返回，再由产品侧回收为可见正文。",
        defaultEnabled: true,
        layer: "output-channel",
      },
      {
        id: "traceCleanup",
        label: "思维链痕迹清理",
        description: "从请求中剥离思考痕迹，避免历史里的旧痕迹被回传。",
        defaultEnabled: true,
        layer: "trace-cleanup",
      },
    ],
  },
  {
    id: "gemini37flash",
    label: "gemini3.7flash",
    description: "对应 gemini3.7flash 的拦截机制。",
    // 来源说明要求关流式（其导出配置为开，取说明）。
    requiresStreaming: false,
    options: [
      {
        id: "systemDirective",
        label: "系统指令重定义",
        description: "重写系统指令的定位，让后续内容被当作规则而非请求。",
        defaultEnabled: false,
        layer: "identity",
      },
      {
        id: "dualModelCard",
        label: "双模型卡（身份隔离）",
        description: "用两张模型卡把「执行者」与「叙述者」的身份隔开。",
        defaultEnabled: true,
        layer: "identity",
      },
      {
        id: "refusalImmunity",
        label: "拒绝免疫开场",
        description: "以一段开场声明替代拒绝式回应。",
        defaultEnabled: true,
        layer: "identity",
      },
      {
        id: "toolChannel",
        label: "工具通道（思考 + 正文双工具）",
        description: "正文经函数工具参数返回，再由产品侧回收为可见正文。",
        defaultEnabled: true,
        layer: "output-channel",
      },
      {
        id: "unicodeEncoding",
        label: "\\uXXXX 编码规避 + 响应侧解码",
        description: "载荷以转义序列下发，响应侧再解码回可读正文。",
        defaultEnabled: false,
        layer: "encoding",
      },
      {
        id: "traceCleanup",
        label: "思维链痕迹清理（含控制标记清理）",
        description: "剥离思考痕迹，并清掉来源形态的控制标记。",
        defaultEnabled: true,
        layer: "trace-cleanup",
      },
    ],
  },
];

/** 该 id 是否为当前配置里已知的目标。 */
export function isKnownFlagalacTarget(id: unknown): id is string {
  return typeof id === "string" && flagalacTargets.some((t) => t.id === id);
}

/**
 * 把任意来源的 id（存档、导入的备份、手改过的 localStorage）收敛为合法值：
 * 非字符串、空串、以及已下线/未知的 id 一律回落到「无」。这样界面永远不会
 * 出现“没有任何条目被选中”的状态。
 */
export function resolveFlagalacTarget(id: unknown): string {
  return isKnownFlagalacTarget(id) ? id : FLAGALAC_NONE_ID;
}

/** 按 id 取条目；未知 id 返回 undefined。 */
export function getFlagalacTarget(id: string): FlagalacTarget | undefined {
  return flagalacTargets.find((t) => t.id === id);
}

/**
 * 读取时收敛后的子选项状态。
 * - `options`：把该目标声明过的**全部** option id 都补全成布尔值（缺键用
 *   `defaultEnabled`），因此调用方可以放心地 `resolved.options[id]`。
 * - `templates`：只保留**被用户改过**的载荷（非空字符串且 ≠ 默认文本）；
 *   等于默认值或空串的条目会被丢弃，避免把未改动的占位文本落盘。
 */
export interface ResolvedFlagalacOptions {
  options: Record<string, boolean>;
  templates: Record<string, string>;
}

/**
 * 把任意来源的持久化子选项状态收敛为**完整、合法**的形状。
 *
 * 规则（读取时收敛，**不写回**存档）：
 *   ① `targetId === "none"` 或未知 ⇒ 返回空（本模块不生效，也不产出内容）；
 *   ② 只接受该目标**声明过**的 option id，未知 id **静默丢弃**
 *      ⇒ 已下线的开关不会借旧备份复活；
 *   ③ 非布尔值 / 缺键 ⇒ 用 `defaultEnabled` ⇒ **新增开关无需数据迁移**；
 *   ④ `templates` 仅在“该选项声明了 `template`、值是非空字符串、且 ≠ 默认文本”
 *      时保留。
 *
 * `raw` 同时接受新形状 `{ options, templates }` 与历史形状（一层
 * `Record<string, boolean>`），后者按 `options` 解析。
 */
export function resolveFlagalacOptions(
  targetId: string,
  raw: unknown,
): ResolvedFlagalacOptions {
  const result: ResolvedFlagalacOptions = { options: {}, templates: {} };
  const target = getFlagalacTarget(resolveFlagalacTarget(targetId));
  const declared = target?.options;
  if (!declared || declared.length === 0) return result;

  const source = (raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : {}) as Record<string, unknown>;
  const rawOptions = (
    source.options && typeof source.options === "object" && !Array.isArray(source.options)
      ? source.options
      : source
  ) as Record<string, unknown>;
  const rawTemplates = (
    source.templates && typeof source.templates === "object" && !Array.isArray(source.templates)
      ? source.templates
      : {}
  ) as Record<string, unknown>;

  for (const opt of declared) {
    const stored = rawOptions[opt.id];
    result.options[opt.id] = typeof stored === "boolean" ? stored : opt.defaultEnabled;

    if (opt.template === undefined) continue;
    const value = rawTemplates[opt.id];
    if (typeof value === "string" && value.trim() && value !== opt.template) {
      result.templates[opt.id] = value;
    }
  }
  return result;
}

/**
 * 读取时收敛后的 answererFlagalac 状态（= 存档里该字段的规范形状）。
 * `streamingOverridden`（P3 落的流式覆盖标志）**只在本阶段不声明于 types.ts**，
 * 但归一化这里认识它：显式为布尔时原样保留（不丢 P3 写入的值），非布尔一律丢弃，
 * 避免手改过的 localStorage 把标志卡成真值。
 */
export interface FlagalacResolvedState {
  target: string;
  perTarget: Record<string, ResolvedFlagalacOptions>;
  streamingOverridden?: boolean;
}

/**
 * 把任意来源的 `settings.bypass.answererFlagalac` 收敛为合法形状。
 * **App.tsx 的存档读取与 lib/settingsBackup.ts 的导入回填共用这一个函数**，
 * 保证“界面读到的形状”与“导入后的形状”永远一致。调用方拿到的是**新对象**，
 * 不会改写入参。
 *
 * - 未知/失效 target ⇒ 「无」；未知 option id ⇒ 丢弃；缺键 ⇒ 默认值；
 * - `perTarget` 里指向未知目标的整段配置会被丢弃（防止死数据随存档漂移）。
 */
export function normalizeAnswererFlagalacState(raw: unknown): FlagalacResolvedState {
  const src = (raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw
    : {}) as Record<string, unknown>;
  const target = resolveFlagalacTarget(src.target);

  const perTarget: Record<string, ResolvedFlagalacOptions> = {};
  if (src.perTarget && typeof src.perTarget === "object" && !Array.isArray(src.perTarget)) {
    for (const [id, entry] of Object.entries(src.perTarget as Record<string, unknown>)) {
      // 未知目标 = 已下线目标：整段丢弃，而不是留成死数据（不复活已摘除功能）。
      if (resolveFlagalacTarget(id) !== id) continue;
      const resolved = resolveFlagalacOptions(id, entry);
      if (Object.keys(resolved.options).length === 0) continue;
      perTarget[id] = resolved;
    }
  }

  const out: FlagalacResolvedState = { target, perTarget };
  if (typeof src.streamingOverridden === "boolean") {
    out.streamingOverridden = src.streamingOverridden;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * P7｜工具通道（`toolChannel`）——「参数 = 正文」
 *
 * 模型不再直接输出正文，而是把思考与正文分别放进两个 Function Tool 的参数里，
 * 产品侧再把参数回收成可见文本。工具本身**不做任何事情**：它的 action 只返回
 * 一个固定的假结果，且该结果**永不回传模型**（本部署的代理在回传工具结果时会
 * 返回空响应 / 400）。因此调用形态是**一次性**的：同一条回复里两个工具一起
 * 调用，回收完即结束本轮。
 *
 * 与 lib/api.ts 的分工：本文件只提供「工具定义 + 命名常量 + 回收规则」这些纯数据
 * 与纯函数；广告工具、一次性结束与 MCP 互斥的门控在 api.ts（它按 E1 载荷块的
 * `options` 属性判断本开关是否启用，见 SSOT §4.2 / §4.5）。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 开关 id（即持久化键）：api.ts 用它判断「工具通道」是否启用。发布后不可改。 */
export const FLAGALAC_TOOL_CHANNEL_OPTION_ID = "toolChannel";

/**
 * 两个 Function Tool 名（**会进入 API 请求体**）。命名遵循模块的分工
 * （SSOT §3.1 的 D-18；角色档案 §1.7）：**思考的是角色巴泽特** ⇒ `bazett_think`；
 * **干活的是礼装 Flagalac** ⇒ `flagalac_body`。
 * ⚠️ 改这两个串必须**同批**改载荷正文里出现的工具名（两份台账 §2 的 `toolChannel` 段）。
 */
export const BAZETT_THINK_TOOL = "bazett_think";
export const FLAGALAC_BODY_TOOL = "flagalac_body";

/**
 * 思考痕迹标签名 —— **思考的是角色巴泽特**，故标签挂她的名字。
 * 模型产出的思考、请求侧的清理规则、显示侧的转义规则三处
 * **必须同名**，否则清理要么漏掉、要么吃掉正文。
 */
export const BAZETT_THINK_TAG = "think_bazett";

/**
 * 载荷块的标签名 —— **干活的是礼装 Flagalac**，故块挂礼装的名字。
 * E1 产出（`chatPipeline`）与 R-a 探测 / P7 解析（`api.ts`）**共用这一个来源**：
 * 任何一侧写死字面量，都会让"模块到底启用了没有"的判定分叉。
 */
export const FLAGALAC_BYPASS_TAG = "flagalac_bypass";

/**
 * 工具通道 action 的固定假结果。刻意固定成这个字面量：它只是让「工具调用」在
 * 协议上闭合，**永不**作为 `role:"tool"` 消息回传给模型。
 */
export const ANSWERER_FLAGALAC_ACTION_RESULT = '{"ok":true}';

/**
 * Function Tool 描述。与 lib/api.ts 的 `LlmTool` 形状同构，但刻意不在本文件
 * 引入 API 层类型（避免 lib 之间互相依赖）。
 */
export interface FlagalacToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: "string"; description: string }>;
    required: string[];
    additionalProperties: false;
  };
}

/**
 * 两个工具的定义。描述是**自撰的中性文案**，不含参考台账的载荷正文；两个目标
 * 共用同一套（来源里目标一为双工具、目标二为单工具，本产品统一为双工具，
 * 模型只调其中一个也能工作）。参数均为必填字符串。
 */
export const answererFlagalacTools: readonly FlagalacToolDescriptor[] = [
  {
    name: BAZETT_THINK_TOOL,
    description: "Mandatory. Think here first; put the whole reasoning in `thinking`.",
    inputSchema: {
      type: "object",
      properties: {
        thinking: {
          type: "string",
          description: "The reasoning for this turn. Natural prose, no markup.",
        },
      },
      required: ["thinking"],
      additionalProperties: false,
    },
  },
  {
    name: FLAGALAC_BODY_TOOL,
    description: "Mandatory. Write the reply here; put the whole reply text in `content`.",
    inputSchema: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The complete user-visible reply text.",
        },
      },
      required: ["content"],
      additionalProperties: false,
    },
  },
];

/** 一次响应里从工具调用中回收到的内容。 */
export interface FlagalacToolHarvest {
  /** `bazett_think.thinking` 的拼接结果（多次调用以空行分隔）。 */
  thinking: string;
  /** `flagalac_body.content` 的拼接结果（多次调用以空行分隔）。 */
  body: string;
  /** 参数不是合法 JSON、或缺少必需字段/类型不对的调用次数。 */
  malformed: number;
  /** 既不是思考工具也不是正文工具的调用名（不由本通道消费，**不静默丢弃**）。 */
  ignored: string[];
}

/**
 * 把一条回复里的工具调用回收成可见文本。
 *
 * 规则（与 SSOT §4.5 一致）：
 *   - `bazett_think.thinking` → `thinking`（调用方再包上思维标签，交显示侧处理）；
 *   - `flagalac_body.content` → `body`（调用方经 `onChunk` 当作正文流出去）；
 *   - 其它工具名 → `ignored`（由调用方记录，不静默丢弃）；
 *   - 参数无法解析或缺必需字段 → 计入 `malformed`，跳过该次调用而不是塞进正文；
 *   - 空字符串参数没有内容可回收，静默跳过（不算异常）。
 *
 * **只调其中一个工具、两个都调、或顺序颠倒都能正常工作**：两类参数各回各的槽位，
 * 缺的一类就是空串。
 */
export function harvestFlagalacToolCalls(
  calls: readonly { name: string; arguments: string }[],
): FlagalacToolHarvest {
  const harvest: FlagalacToolHarvest = {
    thinking: "",
    body: "",
    malformed: 0,
    ignored: [],
  };

  for (const call of calls) {
    const name = call?.name ?? "";
    const isThink = name === BAZETT_THINK_TOOL;
    const isBody = name === FLAGALAC_BODY_TOOL;
    if (!isThink && !isBody) {
      if (name) harvest.ignored.push(name);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = call.arguments ? JSON.parse(call.arguments) : {};
    } catch {
      harvest.malformed += 1;
      continue;
    }
    const args = (
      parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
    ) as Record<string, unknown>;

    const value = args[isThink ? "thinking" : "content"];
    if (typeof value !== "string") {
      harvest.malformed += 1;
      continue;
    }
    if (value.length === 0) continue;

    if (isThink) {
      harvest.thinking = harvest.thinking ? `${harvest.thinking}\n\n${value}` : value;
    } else {
      harvest.body = harvest.body ? `${harvest.body}\n\n${value}` : value;
    }
  }

  return harvest;
}

/**
 * 把回收到的思考包成思维标签。包好后**必须**交给显示侧的痕迹清理层（P6）——
 * 请求侧清理规则同名，因此历史里的旧思考不会回传模型。
 */
export function wrapFlagalacThinking(thinking: string): string {
  return `<${BAZETT_THINK_TAG}>${thinking}</${BAZETT_THINK_TAG}>`;
}
