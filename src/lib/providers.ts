import { ApiFormat, ApiProvider, ApiSettings, AppState, ImageApiSettings, ImageProvider, LlmProvider, LlmProviderKind } from "../types";

/**
 * Best-effort detection of provider from existing baseUrl/apiFormat.
 * Used to migrate legacy settings that pre-date the provider field.
 */
export function inferProvider(baseUrl: string, apiFormat?: ApiFormat): ApiProvider {
  const url = (baseUrl || "").toLowerCase();
  if (!url) return "custom";
  if (apiFormat === "anthropic" && url.includes("anthropic.com")) return "anthropic";
  if (url.includes("api.openai.com")) return "openai";
  if (url.includes("api.deepseek.com")) return "deepseek";
  if (url.includes("generativelanguage.googleapis.com")) return "gemini";
  return "custom";
}

// ---------------------------------------------------------------------------
// Multi-provider model (v2 schema). The data layer below powers the new
// settings UI; the legacy single-endpoint `ApiSettings` shape above remains
// in use by older code paths during the migration.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// QinyAPI access points. The provider is reachable through two interchangeable
// hosts; the user picks one in the LLM / image provider editors. The LLM path
// runs baseUrl through normalizeBaseUrl (so `/v1` is enough), while the image
// path POSTs the stored baseUrl verbatim and therefore needs the full
// chat/completions URL. Each host also has its own "获取 API Key" signup link.
// ---------------------------------------------------------------------------

export interface QinyEndpoint {
  id: "com" | "icu";
  /** Short button label shown in the access-point selector. */
  label: string;
  /** OpenAI-compatible base for chat; normalizeBaseUrl-friendly. */
  llmBaseUrl: string;
  /** Full chat/completions URL the image path POSTs to verbatim. */
  imageBaseUrl: string;
  /** Target of the "获取 API Key" link for this host. */
  apiKeyUrl: string;
}

export const QINY_ENDPOINTS: QinyEndpoint[] = [
  {
    id: "com",
    label: ".com",
    llmBaseUrl: "https://openai.chatnewai.com/v1",
    imageBaseUrl: "https://openai.chatnewai.com/v1/chat/completions",
    apiKeyUrl: "https://openai.chatnewai.com/register?aff=btB0",
  },
  {
    id: "icu",
    label: ".icu",
    llmBaseUrl: "https://love.qinyan.icu/v1",
    imageBaseUrl: "https://love.qinyan.icu/v1/chat/completions",
    apiKeyUrl: "https://love.qinyan.icu/register?aff=btB0",
  },
];

/** The default access point (`.com`), used when none is otherwise resolvable. */
export const DEFAULT_QINY_ENDPOINT = QINY_ENDPOINTS[0];

/**
 * Resolve which access point a stored baseUrl belongs to by hostname. Tolerant
 * of either the `/v1` or full `/v1/chat/completions` form. Falls back to the
 * default (`.com`) for unrecognized / empty values so legacy settings keep
 * pointing at the original host.
 */
export function resolveQinyEndpoint(baseUrl: string | undefined): QinyEndpoint {
  const url = (baseUrl || "").toLowerCase();
  for (const ep of QINY_ENDPOINTS) {
    let host = "";
    try {
      host = new URL(ep.llmBaseUrl).hostname.toLowerCase();
    } catch {
      /* constant URLs are valid; guard only to satisfy the type */
    }
    if (host && url.includes(host)) return ep;
  }
  return DEFAULT_QINY_ENDPOINT;
}

export interface LlmProviderPresetMeta {
  kind: LlmProviderKind;
  name: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  /** True when the user must edit baseUrl in the UI (custom + ollama). */
  baseUrlEditable: boolean;
}

/**
 * Built-in LLM provider presets in the default display order. Custom-created
 * providers are always inserted at the head of the user's provider list;
 * order here only governs the initial seeded defaults.
 */
export const LLM_PROVIDER_PRESETS: LlmProviderPresetMeta[] = [
  {
    kind: "qiny",
    name: "QinyAPI",
    baseUrl: DEFAULT_QINY_ENDPOINT.llmBaseUrl,
    apiFormat: "openai",
    baseUrlEditable: false,
  },
  {
    kind: "gemini",
    name: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiFormat: "openai",
    baseUrlEditable: false,
  },
  {
    kind: "anthropic",
    name: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    apiFormat: "anthropic",
    baseUrlEditable: false,
  },
  {
    kind: "openai",
    name: "OpenAI GPT",
    baseUrl: "https://api.openai.com/v1",
    apiFormat: "openai",
    baseUrlEditable: false,
  },
  {
    kind: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiFormat: "openai",
    baseUrlEditable: false,
  },
  {
    kind: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434",
    apiFormat: "openai",
    baseUrlEditable: true,
  },
];

export function createDefaultLlmProviders(): LlmProvider[] {
  return LLM_PROVIDER_PRESETS.map((preset) => ({
    id: preset.kind,
    kind: preset.kind,
    name: preset.name,
    enabled: false,
    apiKey: "",
    baseUrl: preset.baseUrl,
    apiFormat: preset.apiFormat,
    models: [],
  }));
}

export interface ImageProviderPresetMeta {
  kind: "qiny" | "comfyui";
  name: string;
  baseUrl: string;
  /** ComfyUI is a placeholder ("尽请期待") and must not be enabled. */
  selectable: boolean;
}

export const IMAGE_PROVIDER_PRESETS: ImageProviderPresetMeta[] = [
  {
    kind: "qiny",
    name: "QinyAPI",
    baseUrl: DEFAULT_QINY_ENDPOINT.imageBaseUrl,
    selectable: true,
  },
  {
    kind: "comfyui",
    name: "ComfyUI",
    baseUrl: "",
    selectable: false,
  },
];

export function createDefaultImageProviders(): ImageProvider[] {
  return IMAGE_PROVIDER_PRESETS.map((preset) => ({
    id: preset.kind,
    kind: preset.kind,
    name: preset.name,
    enabled: false,
    apiKey: "",
    baseUrl: preset.baseUrl,
    models: [],
    size: "default",
  }));
}

// ---------------------------------------------------------------------------
// v2 → legacy shape converters. Phase 3 introduces these so consumers that
// still expect the single-endpoint `ApiSettings` / `ImageApiSettings` shapes
// (chat pipeline, fetchModels, generateImage) can keep working while the
// underlying source-of-truth shifts to the multi-provider model. Phases 5+
// migrate the consumers themselves and these helpers become the canonical
// way to derive a per-call request shape from the active provider.
// ---------------------------------------------------------------------------

/**
 * Map an LlmProvider (v2) to the legacy ApiSettings (v1) shape used by
 * fetchChatCompletion / fetchModels. `modelId` overrides the provider's
 * lastUsedModel when given — useful when the caller has just picked a model
 * but the provider state hasn't yet been updated.
 */
export function providerToApiSettings(
  provider: LlmProvider,
  modelId?: string,
): ApiSettings {
  return {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: modelId ?? provider.lastUsedModel ?? provider.models[0]?.id ?? "",
    apiFormat: provider.apiFormat,
    // isStreaming is sourced globally from AppState now — caller must patch
    // it after calling this helper. autoConnect is no longer wired in v2.
    apiProvider: provider.kind === "qiny" || provider.kind === "ollama" ? "custom" : provider.kind,
  };
}

/**
 * Map an ImageProvider (v2) to the legacy ImageApiSettings (v1) shape used
 * by generateImage. Only the QinyAPI-compatible OpenAI-format kind has a
 * working call path today; ComfyUI is a placeholder.
 */
export function imageProviderToApiSettings(
  provider: ImageProvider,
  modelId?: string,
): ImageApiSettings {
  return {
    enabled: provider.enabled,
    provider: provider.kind,
    apiKey: provider.apiKey,
    model: modelId ?? provider.lastUsedModel ?? provider.models[0]?.id ?? "",
    size: provider.size ?? "default",
    baseUrl: provider.baseUrl || undefined,
  };
}

/**
 * Resolve the "currently active" LLM provider from AppState, or undefined if
 * the settings haven't been migrated yet / the active id points nowhere.
 */
export function getActiveLlmProvider(settings: AppState): LlmProvider | undefined {
  if (!Array.isArray(settings.llmProviders)) return undefined;
  return settings.llmProviders.find((p) => p.id === settings.currentLlmProviderId);
}

/**
 * Resolve the "currently active" image provider from AppState.
 */
export function getActiveImageProvider(settings: AppState): ImageProvider | undefined {
  if (!Array.isArray(settings.imageProviders)) return undefined;
  return settings.imageProviders.find((p) => p.id === settings.currentImageProviderId);
}


