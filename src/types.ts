export interface Attachment {
  name: string;
  type: "image" | "text";
  data: string;
  mimeType: string;
}

export interface Message {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  attachments?: Attachment[];
  timestamp?: number;
  tokenCount?: number;
  /** Set on the LAST message of an extracted memory batch. Messages at or
   *  before this position have been distilled into the server-side memory KB
   *  and are excluded from the history sent to the model; the bubble itself is
   *  kept so the user still sees the conversation. The value is the batch
   *  sequence number used as `documents.name = <sessionId>#<batchSeq>`. */
  memoryBatchSeq?: number;
  model?: string;
  /** Floor number = index in the live chat array. Assigned on render for
   *  position-based consumers (e.g. the front-end-card render pipeline), which
   *  reference messages by position rather than `id`. Not persisted; derived
   *  on each render. */
  mesid?: number;
  /** Flag for non-dialogue system messages; consumed by macros
   *  ({{lastUserMessage}} skips these) and the renderer. */
  isSystem?: boolean;
  /** When set, the message represents a generated image. `content` is reused
   *  to carry the prompt that produced it (used by 重新生成). */
  imageUrl?: string;
  /** Snapshot of the prompt at generation time so 重新生成 stays stable even
   *  if the source bubble was edited or deleted afterwards. */
  imagePrompt?: string;
  /** 楼层变量（MVU 的 Model）。**按 swipe 索引**——对齐酒馆助手的
   *  `chat[i].variables[swipe_id]` 形状；NyaaChat 没有 swipe/楼层分支概念，
   *  因此恒为**单元素数组**（读写 `variables[0]`，等价 `swipe_id ≡ 0`）。
   *  见 SSOT §2.5（D4）与「MVU 最低要求清单」M1。
   *
   *  ⚠️ 本字段曾被"退休守门"（`src/lib/sessionStorage.ts` 的
   *  `RETIRED_MESSAGE_KEYS`）在**每次写会话时剥离**；2026-09-16 本阶段按 D3①
   *  只撤销 **message 级**守门，session 级 `metadata` 仍被剥离。改动该守门时
   *  务必同时确认本注释与 SSOT §3 的表述。 */
  variables?: Array<Record<string, unknown>>;
  /** 开场白备选分支列表（首条消息生效）。包含主开场白与额外问候语。 */
  swipes?: string[];
  /** 当前选中的开局索引（0-based，默认为 0）。 */
  swipeId?: number;
}

export type ApiFormat = "openai" | "anthropic";

export type ApiProvider = "custom" | "openai" | "anthropic" | "gemini" | "deepseek" | "opencode-go";

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  isStreaming?: boolean;
  apiFormat?: ApiFormat;
  apiProvider?: ApiProvider;
  /** Stable per-chat identifier required by the OpenCode Go gateway. */
  opencodeSessionId?: string;
  autoConnect?: boolean;
}

export type ImageApiProvider = "qiny" | "comfyui";

export type ImageSize = "default" | "4k";

export interface ImageApiSettings {
  enabled: boolean;
  provider: ImageApiProvider;
  apiKey: string;
  model: string;
  size: ImageSize;
  /** Optional override for the image-gen endpoint. When omitted the legacy
   *  hardcoded QinyAPI URL is used. Populated by the v2 multi-provider call
   *  path so generateImage can target arbitrary OpenAI-compatible image hosts. */
  baseUrl?: string;
}

/** Bypass 系统各模块的设置。
 *
 *  **ClavisSalomonis 已于本轮彻底退役**：原先的 `enabled` / `templateName` /
 *  七个模板开关 / `customTemplates` 全部删除，注入链路（lib/bypassTemplates.ts
 *  的 injectBypassPrompts）随模块一起移除。存量存档中的这些键由
 *  App.tsx 的 migrateV9ToV10 与 lib/settingsBackup.ts 的导入回填清除。
 *  历史原因：该模块 UI 早已从 BypassModal 下线（唯一开关在被注释的代码块内），
 *  导致开启过的存档既会静默注入模板、又无法从界面关闭。 */
export interface BypassSettings {
  /** RuleBreaker (WordCheck) editable texts. Persisted so user edits survive
   *  across sessions. Defaults live in lib/WordCheckTemplates.ts. */
  opusChecks: {
    gemini31Check: string;
    op1Check: string;
    op2Check: string;
  };
  /** RosettaStone — first-party OUTPUT constraints. Standalone module, NOT a
   *  bypass: each entry toggled on its own. Enabled+non-empty entries are
   *  merged into the dynamic tail's <output_constraints> block (see
   *  lib/chatPipeline.ts). Editable-text defaults live in
   *  lib/WordCountTemplates.ts (keyed by WordCountKey).
   *  `wordCount` defaults off; `languageConstraint` defaults on. */
  wordCount: {
    enabled: boolean;
    template: string;
  };
  languageConstraint: {
    enabled: boolean;
    template: string;
  };
  /** AnswererFlagalac —— 审核绕过目标（单选）+ 每个目标下的子选项开关。
   *  独立模块：`target` 为 "none"（默认）时本模块不生效，选中其他条目时启用
   *  对应目标的绕过逻辑。可选条目、子选项、显示名称与默认值统一定义在
   *  lib/FlagalacTemplates.ts —— 新增/下线目标或开关只改那一个文件。
   *
   *  这里刻意用宽类型 `string` 而非字面量联合：条目清单是数据而非类型，新增
   *  一个模型版本不应要求同步改类型定义。读取时统一走
   *  normalizeAnswererFlagalacState()（lib/FlagalacTemplates.ts）收敛为合法形状
   *  —— 未知/失效 target 回落 "none"，未知 option id 丢弃，缺键用默认值。
   *
   *  **全部状态只住在这一个字段里**（不散落到 BypassSettings 其它位置），
   *  这样整个模块可以被一次性摘除：见私有仓的《功能文件清单与移除说明》。 */
  answererFlagalac: {
    /** 收敛后的合法目标 id。 */
    target: string;
    /** 每个目标各自的开关状态与（用户改过的）载荷文本。
     *  - `options`：缺键 ⇒ 用模板里的 defaultEnabled（**新增开关无需迁移**）；
     *    已下线/未知的 option id 在读取时丢弃，不会借旧备份复活。
     *  - `templates`：⚠️ **已退休（D-30，2026-09-13）** —— 载荷文本已不可由用户改写，
     *    读写两侧一律忽略该键；**只出现在"读取老存档"路径上**（老备份里可能带着它，
     *    归一化时被丢弃；导出侧由 `stripRetiredFlagalacTemplates()` 剔除）。
     *    保留类型只为兼容老存档，**不代表功能存在**。 */
    perTarget: Record<
      string,
      {
        options: Record<string, boolean>;
        /** ⚠️ **已退休（D-30）**：见上，仅老存档兼容用，读写侧一律忽略。 */
        templates?: Record<string, string>;
      }
    >;
    /** **单个布尔**（不是 per-target 映射）：目标激活期间用户手动改过流式开关 ⇒
     *  true，此后当前目标的自动同步不再改写 `isStreaming`（开发计划 §4.4 规则 4 /
     *  D-10）。**每次目标切换都会被清除**（同步策略见 lib/flagalacOptions.ts），
     *  切回「无」时也只是一并清掉它、**不恢复**原流式值（D-09）。
     *  非布尔值在读取归一化时按“未设置”丢弃（lib/FlagalacTemplates.ts 的
     *  normalizeAnswererFlagalacState）。 */
    streamingOverridden?: boolean;
  };
}

export interface UserRoleSettings {
  id: string;
  name: string;
  profile: string;
}

export interface WorldInfoRule {
  id: string;
  name: string;
  triggerType: "permanent" | "keywords";
  keywords?: string;
  position: "system" | "assistant";
  /** Hard constraint: wins over the user's latest message when they directly
   *  conflict. Default (false/undefined) = soft lore that yields to the user. */
  hard?: boolean;
  /** Participates in the recursive activation chain. ON = this keyword entry can
   *  be activated by another entry's content AND its own content can in turn
   *  trigger downstream entries. OFF (default) = only the user's original input
   *  can trigger it, and it never feeds the recursion source. Meaningful only for
   *  keyword entries — permanent entries are always active and never recurse.
   *  Collapses SillyTavern's exclude_recursion + prevent_recursion into one flag
   *  (delay_until_recursion is dropped). */
  allowRecursion?: boolean;
  content: string;
  enabled: boolean;
  /** 关联的知识库 ID 列表。规则条目编辑时可关联/取消关联 KB；
   *  此处仅存储软引用，绝不级联硬删。 */
  linkedKbIds?: string[];
  /** 本地 KB 名称缓存，{ kbId: { name, charTotal } }。
   *  保存规则时从已加载的 KB 列表中抓取，下次编辑即可离线显示名称。
   *  仅前端读写，不传给后端。 */
  _linkedKbCache?: Record<string, { name: string; charTotal: number }>;
}

export interface CharacterSettings {
  id: string;
  name: string;
  description: string;
  firstMes?: string;
  /** SillyTavern 规范：额外开场问候语列表（data.alternate_greetings） */
  alternateGreetings?: string[];
  worldInfo?: WorldInfoRule[];
  /** Character-scoped regex scripts (ST: `data.extensions.regex_scripts`).
   *  Run after global scripts in the combined chain. */
  regexScripts?: RegexScript[];
  /** 角色卡附带的 JS 脚本（ST: `data.extensions.tavern_helper.scripts`）。
   *  与 `regexScripts` 对称：随角色卡导入/导出，切卡即切换。
   *  执行器见 `plugins/js-slash-runner/`（SSOT §2.4 / §2.5）。 */
  scripts?: ScriptRecord[];
  /** Reference-style cover-image marker (512×768). The actual pixels live as a
   *  WebP Blob in IndexedDB keyed by the character `id` (see lib/coverStorage),
   *  NOT inline here — base64 in the settings blob would blow the localStorage
   *  quota. This field only records *that* a cover exists (and, in a future
   *  shared-library phase, may carry a remote URL); a truthy value means "look
   *  it up in IndexedDB". Kept as a string for forward-compatibility with the
   *  shared system's "cover relative path / URL" model. */
  coverImage?: string;
  /** --- Shared-character-system groundwork (no UI yet) ---
   *  Reserved per .ref/我想在本项目中建立一个共享角色系统.md so a card can later
   *  round-trip through the shared library without a data migration. All
   *  optional and currently unpopulated by the editor. */
  /** Local revision number for the shared system's update-detection ("server
   *  version > local version → show update badge"). */
  version?: number;
  /** Slot for a server-assigned global id once the card is shared. Distinct
   *  from the locally-generated `id`, which is NOT assumed globally unique. */
  globalId?: string;
  /** Uploader-declared author (governs edit/delete rights in the shared lib). */
  author?: string;
  /** Provenance: 原创 (original) / 转载 (reposted). */
  source?: "original" | "reposted";
  /** Short blurb (≤100 chars) the author writes ABOUT the character — distinct
   *  from `description`, which is the actual card persona sent to the model. */
  intro?: string;
  /** Marks a card obtained from the shared library vs. a local-native one. */
  shared?: boolean;
  /** Owner account of the shared card (NOT the display name `author`). Stored on
   *  acquired shared cards so the original uploader, when logged in, can be
   *  recognised (account === owner) and offered 编辑/发布更新 — display-name
   *  comparison would be unreliable across renames/duplicates. */
  owner?: string;
  /** Classification tags for the character. Matches `data.tags` in ST v3 card
   *  format and the shared library tag system — same `string[]` shape so they
   *  round-trip without conversion. */
  tags?: string[];
}

/**
 * A regex script, compatible with SillyTavern's regex extension. Same dual-
 * pipeline semantics: one pass for display (`markdownOnly`) and one for the
 * prompt sent to the LLM (`promptOnly`); neither flag = rewrite the stored
 * source. See src/lib/regex/engine.ts and SSOT §2.3.
 */
export interface RegexScript {
  id: string;
  scriptName: string;
  /** Find pattern. Accepts a bare pattern or `/pattern/flags` form. */
  findRegex: string;
  /** Replacement. Supports {{match}}, $1, $<name>, and {{macro}}. */
  replaceString: string;
  /** Substrings stripped from each captured match before substitution. */
  trimStrings: string[];
  /** Where the script applies: 1=USER_INPUT 2=AI_OUTPUT 3=SLASH_COMMAND
   *  5=WORLD_INFO 6=REASONING. */
  placement: number[];
  disabled: boolean;
  /** Apply only on the display pipeline (rendered bubble). */
  markdownOnly: boolean;
  /** Apply only on the prompt pipeline (text sent to the model). */
  promptOnly: boolean;
  /** Whether the script runs when a message is edited. */
  runOnEdit: boolean;
  /** Macro substitution of the find pattern: 0=NONE 1=RAW 2=ESCAPED. */
  substituteRegex: 0 | 1 | 2;
  /** Depth-range gating (0 = last message, counting backwards). null = open. */
  minDepth: number | null;
  maxDepth: number | null;
}

export interface ScriptRecord {
  id: string;
  name: string;
  /** 脚本体（JS 源码；可能是 `import '…'` 形式的 loader）。 */
  content: string;
  enabled: boolean;
  /** —— 以下为 SillyTavern 互操作**保真字段**，NyaaChat 不解释其含义，
   *  仅在导入/导出时原样往返（见 `src/lib/sillyTavernScripts.ts`）。—— */
  /** ST: `type`（样例卡为 `"script"`）。 */
  type?: string;
  info?: string;
  button?: unknown;
  data?: unknown;
  /** ST: `export_with`（`{ data?: boolean; button?: boolean }`）。 */
  exportWith?: { data?: boolean; button?: boolean };
}

/** 单用户维度的插件持久化状态（`AppState.plugins` 的值类型）。
 *
 *  ⚠️ **声明位置刻意放在这里**（而不是 `src/plugins/types.ts`）：`AppState`
 *  需要它，而 `src/types.ts` 不 import 任何插件模块，因此不会产生循环依赖。
 *  插件作者仍然只需从 `src/plugins/types` 导入 —— 那里把它 re-export 出来。
 *
 *  `enabled` 缺失/非布尔 ⇒ false（默认全部停用）；`config` 非对象 ⇒ {}，
 *  随后由 `src/plugins/normalize.ts` 以插件 defaults 做深合并（用户值优先）。 */
export interface PluginState {
  enabled: boolean;
  config: Record<string, unknown>;
}

/** 插件 id → 单用户持久化状态。只保留 `plugins/registry.ts` 中注册的 id。 */
export type PluginStateMap = Record<string, PluginState>;

export interface AppState {
  bypass: BypassSettings;
  userRoles: UserRoleSettings[];
  currentUserRoleId: string;
  theme: "light" | "dark" | "system";
  characters: CharacterSettings[];
  currentCharacterId: string;
  llmProviders: LlmProvider[];
  imageProviders: ImageProvider[];
  currentLlmProviderId: string;
  currentImageProviderId: string;
  isWebSearchEnabled: boolean;
  isStreaming: boolean;
  /** Enable NyaaChat's native front-end card rendering. */
  isFrontendRenderingEnabled: boolean;
  /** Number of latest message floors to render as front-end cards. 0 = all. */
  frontendRenderingDepth: number;
  /** Composer send-key habit. "ctrlEnter" (default) = Ctrl/⌘+Enter sends and a
   *  bare Enter inserts a newline; "enter" = a bare Enter sends while
   *  Ctrl/⌘+Enter and Shift+Enter insert a newline. */
  sendMode: "enter" | "ctrlEnter";
  /** Whether the MCP toolbar entry is "armed" — this only governs whether
   *  enabled MCP tools get advertised to the LLM on the next request.
   *  Per-tool toggles in `mcpToolsEnabled` apply on top of this. */
  isMcpEnabled: boolean;
  /** User-chosen "where the role-play is set" city. Passed to MCP tools as
   *  the default `timezone` / `location` argument when the LLM does not
   *  specify one explicitly. Null = no override (tools fall back to Beijing). */
  mcpUserCity: string | null;
  /** Per-tool enabled flag, keyed by MCP tool `name`. Missing keys are
   *  treated as enabled (default-on). Persisted across reloads so a user's
   *  manual disable survives even when the resulting object is empty. */
  mcpToolsEnabled: Record<string, boolean>;
  /** Persistent memory master switch. Off by default — the feature stores
   *  distilled facts as plaintext on the server, so it must be opt-in. */
  isMemoryEnabled: boolean;
  /** Context-usage percentage that triggers the extraction prompt. Valid range
   *  is [MIN_THRESHOLD_PCT, MAX_THRESHOLD_PCT] from lib/contextBudget. */
  memoryThresholdPct?: number;
  /** Manual contextWindow overrides keyed by model id. inferLimits() only
   *  pattern-matches model names, which is not reliable enough to gate a
   *  feature on for self-hosted / proxied endpoints. */
  modelContextOverrides?: Record<string, number>;
  /** When the user accepted the plaintext-storage disclosure. Undefined = never
   *  shown; the dialog is gated on this rather than on isMemoryEnabled so that
   *  toggling off and on again does not silently skip the disclosure. */
  memoryDisclosureAcceptedAt?: number;
  /** 原生插件系统的每用户状态（启用开关 + 插件配置）。
   *  插件集合的唯一权威是代码（`plugins/registry.ts`）——这里的键只是"已知插件的
   *  用户数据"，未知 id 在加载/导入/云端下载三条入口都会被 `normalizePluginStates()`
   *  丢弃，导出侧同样再过一次归一化（出口防御）。 */
  plugins: PluginStateMap;
  /**
   * **用户自定义的插件显示顺序**（2026-09-15 追加）—— 纯 UI 偏好：只决定扩展
   * modal 列表的排列，**不影响任何插件逻辑**（启用/配置/装饰/后端调用都与它无关）。
   * 只应出现已注册的插件 id；未列到的插件由界面按注册表顺序追加到末尾。
   * 三条入口（加载 / 本地导入 / 云端下载）与出口（`buildExportPayload`）都过
   * `normalizePluginOrder()`。
   */
  pluginOrder?: string[];
}

export type ModelCapability =
  | "vision"
  | "web"
  | "reasoning"
  | "tools"
  | "structured"
  | "rerank"
  | "embed";

export interface ModelHealth {
  ok: boolean;
  latencyMs?: number;
  testedAt?: number;
  error?: string;
}

export interface ModelEntry {
  id: string;
  name?: string;
  capabilities?: ModelCapability[];
  contextWindow?: number;
  maxOutput?: number;
  health?: ModelHealth;
}

export type LlmProviderKind =
  | "qiny"
  | "gemini"
  | "anthropic"
  | "openai"
  | "deepseek"
  | "opencode-go"
  | "ollama"
  | "custom";

export interface LlmProvider {
  id: string;
  kind: LlmProviderKind;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  models: ModelEntry[];
  lastUsedModel?: string;
}

export type ImageProviderKind =
  | "qiny" // 内置 OpenAI 兼容（固定，QinyAPI）
  | "openai-custom" // 自定义 OpenAI 兼容 API
  | "comfyui-fixed" // 固定 ComfyUI 服务器（NyaaComfyUI）
  | "comfyui-custom"; // 自定义 ComfyUI 服务

/** ComfyUI 出图尺寸（写入工作流节点 28 的 %width%/%height%）。 */
export type ComfyImageSize = "1024x1024" | "1024x1536" | "1536x1024";

export interface ImageProvider {
  id: string;
  kind: ImageProviderKind;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  models: ModelEntry[];
  lastUsedModel?: string;
  /** OpenAI 族（qiny / openai-custom）的尺寸档；ComfyUI 族忽略。 */
  size?: ImageSize;
  // --- 以下仅 ComfyUI 族（comfyui-fixed / comfyui-custom）使用，其余 kind 忽略 ---
  /** 出图尺寸，默认 "1024x1024"。 */
  comfySize?: ComfyImageSize;
  /** 选用的工作流 id（当前仅 "anima2d"；"real" 占位禁用）。 */
  comfyWorkflowId?: string;
  /** 选用的画风条目名（artlist.json options[].name），默认 "风格4.5.2"。 */
  comfyArtStyle?: string;
}

export interface ChatSession {
  id: string;
  /** Stable opaque session identifier for OpenCode Go requests in this chat. */
  opencodeSessionId?: string;
  characterId: string;
  characterName: string;
  messages: Message[];
  createdAt: number;
  /** 会话级变量（MVU 的"更新到聊天变量"开关写入的 `stat_data` 等）。
   *  ⚠️ 刻意**不**沿用 ST 的 `chat_metadata` 命名（D3①：那是被摘除的扩展
   *  兼容面名称，`settingsBackup.ts` 仍在剥离它）。
   *  ⚠️ 新增会话级字段时**必须**同步 `ChatInterface.tsx` 的自动保存重建处
   *  （那里是逐字段重建 session 对象，不 spread `currentSession`，
   *  漏改会让该字段在第一次自动保存时静默丢失）。 */
  variables?: Record<string, unknown>;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  /**
   * "request" entries are shown in the Terminal Output Logs with their
   * non-content metadata only (url / model / tools): the rendered outgoing
   * prompt is stripped on ingestion (see App.handleAddLog).
   */
  direction: "request" | "response" | "error" | "info";
  content: string;
  meta?: any;
}
