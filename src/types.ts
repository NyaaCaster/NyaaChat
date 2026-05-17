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
}

export interface BypassSettings {
  enabled: boolean;
  templateName?: string;
  identityReset: boolean;
  scenarioFramework: boolean;
  aiSelfPersuasion: boolean;
  roleplayInduction: boolean;
  safetyStatement: boolean;
  disclaimer: boolean;
  wordCountControl: boolean;
  customTemplates: {
    identityReset: string;
    scenarioFramework: string;
    aiSelfPersuasion: string;
    roleplayInduction: string;
    safetyStatement: string;
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
  api: ApiSettings;
  imageApi: ImageApiSettings;
  bypass: BypassSettings;
  userRole: UserRoleSettings;
  theme: "light" | "dark" | "system";
  characters: CharacterSettings[];
  currentCharacterId: string;
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
