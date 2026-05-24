import { LlmProvider, ModelCapability, ModelEntry, ModelHealth } from "../types";
import { providerToApiSettings } from "./providers";
import { normalizeBaseUrl } from "./api";

/**
 * Smallest possible chat-completion probe. We send a 1-character prompt and
 * cap the response at 1 token so the round-trip cost is essentially free —
 * the goal is only to confirm "credentials work + endpoint routes the model
 * id" and to capture the round-trip latency.
 *
 * Returns ok+latency on 2xx, ok=false+latency+error on anything else
 * (including network failures and aborts).
 */
export async function runHealthCheck(
  provider: LlmProvider,
  modelId: string,
  signal?: AbortSignal,
): Promise<ModelHealth> {
  const start = performance.now();
  const testedAt = Date.now();
  const apiSettings = providerToApiSettings(provider, modelId);
  const baseUrl = normalizeBaseUrl(apiSettings.baseUrl);

  if (!apiSettings.apiKey || !baseUrl || !modelId) {
    // apiKey is optional for Ollama-style local servers; only the bare
    // endpoint url and a chosen model are mandatory for a probe to be
    // meaningful.
    if (!baseUrl || !modelId) {
      return {
        ok: false,
        testedAt,
        error: "缺少 API 地址 / 模型 id",
      };
    }
  }

  // 30s ceiling. Real-world failures usually surface within 5s; this just
  // bounds the worst-case stall on a misconfigured proxy.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  const onAbort = () => ac.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  try {
    if (apiSettings.apiFormat === "anthropic") {
      await pingAnthropic(baseUrl, apiSettings.apiKey, modelId, ac.signal);
    } else {
      await pingOpenAI(baseUrl, apiSettings.apiKey, modelId, ac.signal);
    }
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - start),
      testedAt,
    };
  } catch (err: any) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      testedAt,
      error: err?.name === "AbortError" ? "请求超时或已取消" : err?.message || String(err),
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

async function pingOpenAI(
  baseUrl: string,
  apiKey: string,
  model: string,
  signal: AbortSignal,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
      stream: false,
    }),
    signal,
    referrerPolicy: "no-referrer",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 80)}` : ""}`);
  }
}

async function pingAnthropic(
  baseUrl: string,
  apiKey: string,
  model: string,
  signal: AbortSignal,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
    headers["x-api-key"] = apiKey;
  }
  const res = await fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    }),
    signal,
    referrerPolicy: "no-referrer",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}${text ? `: ${text.slice(0, 80)}` : ""}`);
  }
}

/**
 * Probe whether an OpenAI-compatible endpoint accepts the `response_format:
 * json_object` parameter for the given model. This is the cheapest portable
 * signal for "supports structured output" since it's the de-facto JSON mode
 * across OpenAI, DeepSeek, Together, OpenRouter, and most proxies.
 *
 * Notes:
 * - The prompt MUST contain the literal word "json" — OpenAI rejects JSON
 *   mode requests whose prompt doesn't mention json (400 with "messages
 *   must contain the word 'json'").
 * - We cap at 8 tokens so the model has just enough room to emit `{}`.
 * - 4xx ⇒ unsupported (the `response_format` param is server-rejected on
 *   models that don't implement JSON mode); 2xx ⇒ supported.
 * - Network/abort errors propagate as `unknown` so we don't falsely brand
 *   a model as lacking structured output when the probe never landed.
 */
async function probeOpenAIStructured(
  baseUrl: string,
  apiKey: string,
  model: string,
  signal: AbortSignal,
): Promise<"supported" | "unsupported"> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: "Reply with json: {\"ok\":true}",
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 8,
      stream: false,
    }),
    signal,
    referrerPolicy: "no-referrer",
  });
  return res.ok ? "supported" : "unsupported";
}

/**
 * Run the structured-output probe against an OpenAI-compatible endpoint.
 * Anthropic-format providers return "unknown" since the Messages API has
 * no `response_format` field; their structured output goes through tool
 * use, which we don't probe here (it overlaps with the existing 'tools'
 * inference and the cost/complexity isn't worth a separate signal).
 *
 * Returns "unknown" on network failure / abort / missing-config so we
 * don't falsely strip the `structured` capability from a model whose
 * probe simply didn't land.
 */
export async function runStructuredCheck(
  provider: LlmProvider,
  modelId: string,
  signal?: AbortSignal,
): Promise<"supported" | "unsupported" | "unknown"> {
  const apiSettings = providerToApiSettings(provider, modelId);
  const baseUrl = normalizeBaseUrl(apiSettings.baseUrl);

  if (!baseUrl || !modelId) return "unknown";
  if (apiSettings.apiFormat === "anthropic") return "unknown";

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 30_000);
  const onAbort = () => ac.abort();
  if (signal) signal.addEventListener("abort", onAbort, { once: true });

  try {
    return await probeOpenAIStructured(baseUrl, apiSettings.apiKey, modelId, ac.signal);
  } catch {
    return "unknown";
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

// ---------------------------------------------------------------------------
// Capability inference
// ---------------------------------------------------------------------------

/**
 * Best-effort capability detection from the model id. The chat-completions
 * endpoint doesn't expose a capability manifest, so this is a heuristic over
 * known naming patterns. False positives/negatives are acceptable — the user
 * can verify via real chat usage; this just powers the row-level icon hints.
 */
export function inferCapabilities(modelId: string): ModelCapability[] {
  const id = modelId.toLowerCase();

  // Embedding / rerank are single-purpose: skip the chat-capability checks.
  if (/embed/.test(id)) return ["embed"];
  if (/rerank/.test(id)) return ["rerank"];

  const caps: ModelCapability[] = [];

  // Vision / multimodal — most flagship models 2024+ are multimodal.
  if (
    /vision|4o|gpt-4-turbo|gpt-5|o1|o3|o4|claude-3|claude-4|claude-opus-4|claude-sonnet-4|claude-haiku-4|gemini|llava|moondream|qwen.*vl|cogvlm|grok-2-vision|grok-3-vision/.test(
      id,
    )
  ) {
    caps.push("vision");
  }

  // Built-in web search.
  if (/online|search|perplexity|sonar|grok-2-search|grok-3-search/.test(id)) {
    caps.push("web");
  }

  // Visible reasoning / chain-of-thought.
  if (
    /^o1|^o3|^o4|reasoner|deepseek-r1|thinking|qwq|grok-3-think|claude-.*-thinking/.test(
      id,
    )
  ) {
    caps.push("reasoning");
  }

  // Tool / function calling. Mainstream chat families all support it; we
  // explicitly exclude legacy 3.5 turbo only when paired with very old date
  // stamps, but pre-2024 SKUs aren't typically still in service.
  if (
    /gpt-3\.5|gpt-4|gpt-5|claude-|gemini-|deepseek-chat|deepseek-coder|deepseek-v3|llama-3|mistral-large|mixtral|qwen|grok|command-r|cohere/.test(
      id,
    )
  ) {
    caps.push("tools");
  }

  return caps;
}

// ---------------------------------------------------------------------------
// Context-window / max-output inference
// ---------------------------------------------------------------------------

interface ModelLimits {
  contextWindow?: number;
  maxOutput?: number;
}

/**
 * Heuristic mapping from model id to (context window, max output). Same
 * caveat as inferCapabilities — the API doesn't surface these, so we hand-
 * codify the well-known ones. Order matters: the first matching pattern
 * wins.
 */
const KNOWN_LIMITS: Array<{ pattern: RegExp; limits: ModelLimits }> = [
  // OpenAI
  { pattern: /^gpt-5/, limits: { contextWindow: 400_000, maxOutput: 128_000 } },
  { pattern: /^gpt-4o/, limits: { contextWindow: 128_000, maxOutput: 16_384 } },
  { pattern: /^gpt-4-turbo/, limits: { contextWindow: 128_000, maxOutput: 4_096 } },
  { pattern: /^gpt-4(?:$|[-:_])/, limits: { contextWindow: 8_192, maxOutput: 4_096 } },
  { pattern: /^gpt-3\.5-turbo/, limits: { contextWindow: 16_385, maxOutput: 4_096 } },
  { pattern: /^o1-mini/, limits: { contextWindow: 128_000, maxOutput: 65_536 } },
  { pattern: /^o1/, limits: { contextWindow: 200_000, maxOutput: 100_000 } },
  { pattern: /^o3-mini/, limits: { contextWindow: 200_000, maxOutput: 100_000 } },
  { pattern: /^o3/, limits: { contextWindow: 200_000, maxOutput: 100_000 } },
  { pattern: /^o4/, limits: { contextWindow: 200_000, maxOutput: 100_000 } },

  // Anthropic
  { pattern: /^claude-(?:opus|sonnet|haiku)-4/, limits: { contextWindow: 200_000, maxOutput: 64_000 } },
  { pattern: /^claude-4/, limits: { contextWindow: 200_000, maxOutput: 64_000 } },
  { pattern: /^claude-3-7|^claude-3\.7/, limits: { contextWindow: 200_000, maxOutput: 64_000 } },
  { pattern: /^claude-3-5-sonnet|^claude-3\.5-sonnet/, limits: { contextWindow: 200_000, maxOutput: 8_192 } },
  { pattern: /^claude-3-5-haiku|^claude-3\.5-haiku/, limits: { contextWindow: 200_000, maxOutput: 8_192 } },
  { pattern: /^claude-3-opus/, limits: { contextWindow: 200_000, maxOutput: 4_096 } },
  { pattern: /^claude-3-(?:sonnet|haiku)/, limits: { contextWindow: 200_000, maxOutput: 4_096 } },
  { pattern: /^claude-/, limits: { contextWindow: 200_000, maxOutput: 4_096 } },

  // Google Gemini
  { pattern: /gemini-2.*pro/, limits: { contextWindow: 2_000_000, maxOutput: 8_192 } },
  { pattern: /gemini-2.*flash/, limits: { contextWindow: 1_000_000, maxOutput: 8_192 } },
  { pattern: /gemini-1\.5-pro/, limits: { contextWindow: 2_000_000, maxOutput: 8_192 } },
  { pattern: /gemini-1\.5-flash/, limits: { contextWindow: 1_000_000, maxOutput: 8_192 } },
  { pattern: /^gemini-/, limits: { contextWindow: 32_000, maxOutput: 8_192 } },

  // DeepSeek
  { pattern: /^deepseek-(?:chat|coder|v3)/, limits: { contextWindow: 64_000, maxOutput: 8_192 } },
  { pattern: /^deepseek-reasoner|^deepseek-r1/, limits: { contextWindow: 64_000, maxOutput: 8_192 } },
  { pattern: /^deepseek-/, limits: { contextWindow: 32_000, maxOutput: 4_096 } },

  // Llama 3.x
  { pattern: /^llama-?3\.[123]/, limits: { contextWindow: 128_000, maxOutput: 4_096 } },
  { pattern: /^llama-?3/, limits: { contextWindow: 8_192, maxOutput: 4_096 } },

  // Mistral
  { pattern: /^mistral-large/, limits: { contextWindow: 128_000, maxOutput: 8_192 } },
  { pattern: /^mistral|^mixtral/, limits: { contextWindow: 32_000, maxOutput: 8_192 } },
];

export function inferLimits(modelId: string): ModelLimits {
  const id = modelId.toLowerCase();
  for (const { pattern, limits } of KNOWN_LIMITS) {
    if (pattern.test(id)) return limits;
  }
  return {};
}

// ---------------------------------------------------------------------------
// Combined: build an updated ModelEntry by running ping + heuristics
// ---------------------------------------------------------------------------

export async function probeModel(
  provider: LlmProvider,
  entry: ModelEntry,
  signal?: AbortSignal,
): Promise<ModelEntry> {
  // Health ping and structured-output probe run concurrently — both are
  // bounded by their own 30s timeouts so the slowest decides total wall
  // time rather than their sum.
  const [health, structured] = await Promise.all([
    runHealthCheck(provider, entry.id, signal),
    runStructuredCheck(provider, entry.id, signal),
  ]);

  const inferred = inferCapabilities(entry.id);
  const limits = inferLimits(entry.id);

  // Merge structured-output capability with the id-based heuristics:
  //   supported   ⇒ ensure 'structured' present
  //   unsupported ⇒ ensure 'structured' absent (probe is authoritative)
  //   unknown     ⇒ keep whatever inferCapabilities decided
  const baseCaps = inferred.length > 0 ? inferred : entry.capabilities ?? [];
  let capabilities = baseCaps;
  if (structured === "supported" && !capabilities.includes("structured")) {
    capabilities = [...capabilities, "structured"];
  } else if (structured === "unsupported" && capabilities.includes("structured")) {
    capabilities = capabilities.filter((c) => c !== "structured");
  }

  return {
    ...entry,
    capabilities: capabilities.length > 0 ? capabilities : entry.capabilities,
    contextWindow: limits.contextWindow ?? entry.contextWindow,
    maxOutput: limits.maxOutput ?? entry.maxOutput,
    health,
  };
}
