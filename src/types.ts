export interface Message {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
  timestamp?: number;
  tokenCount?: number;
  model?: string;
  /** When set, the message represents a generated image. `content` is reused
   *  to carry the prompt that produced it (used by 重新生成). */
  imageUrl?: string;
  /** Snapshot of the prompt at generation time so 重新生成 stays stable even
   *  if the source bubble was edited or deleted afterwards. */
  imagePrompt?: string;
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
}

export interface UserRoleSettings {
  name: string;
  profile: string;
}

export interface WorldInfoRule {
  id: string;
  name: string;
  triggerType: "permanent" | "keywords";
  keywords?: string;
  position: "system" | "assistant";
  content: string;
  enabled: boolean;
}

export interface CharacterSettings {
  id: string;
  name: string;
  description: string;
  firstMes?: string;
  worldInfo?: WorldInfoRule[];
}

export interface AppState {
  bypass: BypassSettings;
  userRole: UserRoleSettings;
  theme: "light" | "dark" | "system";
  characters: CharacterSettings[];
  currentCharacterId: string;
  llmProviders: LlmProvider[];
  imageProviders: ImageProvider[];
  currentLlmProviderId: string;
  currentImageProviderId: string;
  isWebSearchEnabled: boolean;
  isStreaming: boolean;
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
