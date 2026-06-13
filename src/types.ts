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
  wordCountControl: boolean;
  customTemplates: {
    identityReset: string;
    scenarioFramework: string;
    aiSelfPersuasion: string;
    roleplayInduction: string;
    safetyStatement: string;
    creativeGuidance: string;
    disclaimer: string;
    wordCountControl: string;
  };
  /** RuleBreaker (OpusCheck) editable texts. Persisted so user edits survive
   *  across sessions. Defaults live in lib/OpusCheckTemplates.ts. */
  opusChecks: {
    opusCheck1: string;
    opusCheck2: string;
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
  content: string;
  enabled: boolean;
}

export interface CharacterSettings {
  id: string;
  name: string;
  description: string;
  firstMes?: string;
  worldInfo?: WorldInfoRule[];
  /** Character-scoped regex scripts (ST: `data.extensions.regex_scripts`).
   *  Run after global scripts in the combined chain. */
  regexScripts?: RegexScript[];
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
  createdAt: number;
}

export interface LogEntry {
  id: string;
  timestamp: number;
  direction: "request" | "response" | "error" | "info";
  content: string;
  meta?: any;
}
