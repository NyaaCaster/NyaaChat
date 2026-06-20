export interface Message {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp?: number;
  tokenCount?: number;
  model?: string;
  /** Floor number = index in the live chat array. Assigned by the compat
   *  runtime mirror (src/compat/runtimeStore) for SillyTavern extensions and
   *  the front-end-card render pipeline, which reference messages by position
   *  rather than `id`. Not persisted; derived on sync. */
  mesid?: number;
  /** ST-style flag for non-dialogue system messages. Mirrors ST's `is_system`;
   *  consumed by macros ({{lastUserMessage}} skips these) and the renderer. */
  isSystem?: boolean;
  /** When set, the message represents a generated image. `content` is reused
   *  to carry the prompt that produced it (used by 重新生成). */
  imageUrl?: string;
  /** Snapshot of the prompt at generation time so 重新生成 stays stable even
   *  if the source bubble was edited or deleted afterwards. */
  imagePrompt?: string;
  /** Message-scoped front-end-card variables (ST: `message.variables`). Mutated
   *  only through the compat variable API (src/compat/variables.ts). Lives on
   *  the message object so it serializes with the session and follows the
   *  message under insert/delete — per-floor card state (HP bars, counters,
   *  quest flags) survives reloads and conversation switches. */
  variables?: Record<string, unknown>;
}

export type ApiFormat = "openai" | "anthropic";

export type ApiProvider = "custom" | "openai" | "anthropic" | "gemini" | "deepseek";

export interface ApiSettings {
  baseUrl: string;
  apiKey: string;
  model: string;
  isStreaming?: boolean;
  apiFormat?: ApiFormat;
  apiProvider?: ApiProvider;
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

export interface BypassSettings {
  enabled: boolean;
  templateName?: string;
  identityReset: boolean;
  scenarioFramework: boolean;
  aiSelfPersuasion: boolean;
  roleplayInduction: boolean;
  safetyStatement: boolean;
  creativeGuidance: boolean;
  disclaimer: boolean;
  customTemplates: {
    identityReset: string;
    scenarioFramework: string;
    aiSelfPersuasion: string;
    roleplayInduction: string;
    safetyStatement: string;
    creativeGuidance: string;
    disclaimer: string;
  };
  /** RuleBreaker (WordCheck) editable texts. Persisted so user edits survive
   *  across sessions. Defaults live in lib/WordCheckTemplates.ts. */
  opusChecks: {
    gemini31Check: string;
    opusCheck1: string;
    opusCheck2: string;
  };
  /** RosettaStone — first-party OUTPUT constraints. Standalone module, NOT a
   *  bypass: independent of `enabled` (ClavisSalomonis), each entry toggled on
   *  its own. Enabled+non-empty entries are merged into the dynamic tail's
   *  <output_constraints> block (see lib/chatPipeline.ts). Editable-text
   *  defaults live in lib/WordCountTemplates.ts (keyed by WordCountKey).
   *  `wordCount` defaults off; `languageConstraint` defaults on. */
  wordCount: {
    enabled: boolean;
    template: string;
  };
  languageConstraint: {
    enabled: boolean;
    template: string;
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
}

export interface CharacterSettings {
  id: string;
  name: string;
  description: string;
  firstMes?: string;
  worldInfo?: WorldInfoRule[];
  /** ST-style character extension fields (`data.extensions`). Used by bundled
   *  extensions for character script bindings and character-scoped variables. */
  extensions?: Record<string, unknown>;
  /** Character-scoped regex scripts (ST: `data.extensions.regex_scripts`).
   *  Run after global scripts in the combined chain. */
  regexScripts?: RegexScript[];
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
 * source. See src/compat/regex/engine.ts and SSOT §2.3.
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
  /** Enable NyaaChat native JS-Slash-Runner-style front-end card rendering. */
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

export type ImageProviderKind = "qiny" | "comfyui";

export interface ImageProvider {
  id: string;
  kind: ImageProviderKind;
  name: string;
  enabled: boolean;
  apiKey: string;
  baseUrl: string;
  models: ModelEntry[];
  lastUsedModel?: string;
  size?: ImageSize;
}

export interface ChatSession {
  id: string;
  characterId: string;
  characterName: string;
  messages: Message[];
  /** ST-compatible chat_metadata. Persisted with the session in addition to the
   *  browser-local draft metadata scope used before a chat is first saved. */
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  direction: "request" | "response" | "error" | "info";
  content: string;
  meta?: any;
}
