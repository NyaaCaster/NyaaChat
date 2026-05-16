import { ApiFormat, ApiProvider } from "../types";

export interface ProviderPreset {
  value: ApiProvider;
  label: string;
  baseUrl: string;
  apiFormat: ApiFormat;
  defaultModel: string;
}

export const PROVIDER_PRESETS: Record<Exclude<ApiProvider, "custom">, ProviderPreset> = {
  gemini: {
    value: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiFormat: "openai",
    defaultModel: "",
  },
  anthropic: {
    value: "anthropic",
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    apiFormat: "anthropic",
    defaultModel: "",
  },
  openai: {
    value: "openai",
    label: "OpenAI GPT",
    baseUrl: "https://api.openai.com/v1",
    apiFormat: "openai",
    defaultModel: "",
  },
  deepseek: {
    value: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiFormat: "openai",
    defaultModel: "",
  },
};

export const PROVIDER_ORDER: ApiProvider[] = [
  "custom",
  "gemini",
  "anthropic",
  "openai",
  "deepseek",
];

export const PROVIDER_LABELS: Record<ApiProvider, string> = {
  custom: "自定义 API",
  gemini: PROVIDER_PRESETS.gemini.label,
  anthropic: PROVIDER_PRESETS.anthropic.label,
  openai: PROVIDER_PRESETS.openai.label,
  deepseek: PROVIDER_PRESETS.deepseek.label,
};

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
