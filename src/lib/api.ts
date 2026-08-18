import { ApiSettings } from '../types';

export interface ApiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  // OpenAI / OpenAI-compatible (DeepSeek, Gemini-OAI) — automatic prefix cache
  prompt_tokens_details?: {
    cached_tokens?: number;
    [k: string]: any;
  };
  // Anthropic — explicit cache_control breakpoints
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export type ApiMessage = {
  role: string;
  content: string | any[];
  /** OpenAI: required on `role: "tool"` messages to bind the result back to
   *  the assistant's tool_call by id. Unused on other roles / formats. */
  tool_call_id?: string;
  /** OpenAI: present on `role: "assistant"` messages that asked the LLM to
   *  invoke one or more tools. The same shape the API returned to us. */
  tool_calls?: any[];
};

/** Marker key on content parts that change every turn (search context,
 *  folded session rules, word-count trailer). The Anthropic path anchors
 *  cache breakpoint ② on the last part WITHOUT this flag, so volatile parts
 *  stay past the breakpoint; every send path strips the key before the
 *  request goes out. Defined here (not chatPipeline) to avoid a circular
 *  import — chatPipeline already imports from this module. */
export const VOLATILE_PART_FLAG = '_volatile';

/** Remove the internal volatile marker before a request leaves the app. */
function stripVolatileFlags(content: string | any[]): string | any[] {
  if (!Array.isArray(content)) return content;
  return content.map((p) => {
    if (p && typeof p === 'object' && VOLATILE_PART_FLAG in p) {
      const { [VOLATILE_PART_FLAG]: _v, ...rest } = p;
      return rest;
    }
    return p;
  });
}

/**
 * Fallback for providers without a usable trailing-system position (Gemini's
 * OpenAI-compat layer hoists trailing system into systemInstruction; non-4.8
 * Claude models reject mid-conversation system): detach the dynamic-tail
 * system message and append its text to the LATEST USER turn as a volatile
 * part. This keeps recency AND the cache (folding it into the top-level
 * system field — the v2 fallback — re-billed the whole history every time
 * the keyword set changed). Operator-level authority is delegated by the
 * session-protocol anchor in the static prefix (layout doc v3, principle 4).
 */
function foldTailSystemIntoLatestUser(messages: ApiMessage[]): ApiMessage[] {
  if (messages.length < 2) return messages;
  const last = messages[messages.length - 1];
  const prev = messages[messages.length - 2];
  if (last.role !== 'system' || prev.role === 'system') return messages;

  const text =
    typeof last.content === 'string'
      ? last.content
      : last.content
          .filter((p: any) => p?.type === 'text')
          .map((p: any) => p.text)
          .join('\n');
  const core = messages.slice(0, -1);
  if (!text) return core;

  const lastUserIdx = core.map((m) => m.role).lastIndexOf('user');
  if (lastUserIdx === -1) {
    // No user turn to fold into — not produced by buildRequestMessages today
    // (it always ends history on the latest user turn). Guard anyway so the
    // invariant "the returned array never ends on a system message" holds
    // regardless of caller: emit the tail as its own trailing user turn.
    core.push({
      role: 'user',
      content: [{ type: 'text', text, [VOLATILE_PART_FLAG]: true }],
    });
    return core;
  }

  const target = core[lastUserIdx];
  const parts =
    typeof target.content === 'string'
      ? [{ type: 'text', text: target.content }]
      : [...target.content];
  parts.push({ type: 'text', text: `\n\n${text}`, [VOLATILE_PART_FLAG]: true });
  core[lastUserIdx] = { ...target, content: parts };
  return core;
}

/**
 * Description of a tool the LLM may choose to call. Mirrors the shape we
 * receive from MCP `tools/list` — fetchChatCompletion translates it into
 * each provider's native schema (OpenAI `function` / Anthropic `tool`).
 */
export interface LlmTool {
  name: string;
  description: string;
  inputSchema?: any;
}

export type ToolExecutionResult =
  | { ok: true; text: string }
  | { ok: false; message: string };

export type ToolExecutor = (
  name: string,
  args: any,
) => Promise<ToolExecutionResult>;

export interface ToolEvent {
  round: number;
  name: string;
  args: any;
  result: ToolExecutionResult;
}

export interface ToolUseOptions {
  tools: LlmTool[];
  executeTool: ToolExecutor;
  /** Called once per completed tool round so the UI / console log can
   *  record what was invoked and what came back. */
  onToolEvent?: (event: ToolEvent) => void;
  /** Hard cap on tool-call rounds to prevent runaway loops. Default 5.
   *  Each round = one LLM completion + the resulting tool executions. */
  maxRounds?: number;
}

/**
 * HTTP-level error from an API response. The status code is preserved so the
 * UI layer can give a specific Chinese message (401 vs 429 vs 5xx).
 */
export class ApiHttpError extends Error {
  status: number;
  body: string;
  constructor(status: number, body: string) {
    super(`API ${status}: ${(body || '').slice(0, 300)}`);
    this.name = 'ApiHttpError';
    this.status = status;
    this.body = body;
  }
}

/**
 * fetch with a connection-establishment timeout. The watchdog is cleared as
 * soon as response headers arrive, so a slow streaming response is not killed
 * mid-stream — only a stuck handshake (DNS / TLS / unresponsive proxy) is.
 *
 * The user's external signal (Stop button) is forwarded into the same
 * controller, so cancelling propagates correctly to the in-flight body.
 */
const REQUEST_TIMEOUT_MS = 60_000;
async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit,
  userSignal: AbortSignal | undefined,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  let timedOut = false;
  const linkUserAbort = () => ctrl.abort();
  if (userSignal) {
    if (userSignal.aborted) ctrl.abort();
    else userSignal.addEventListener('abort', linkUserAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: ctrl.signal });
  } catch (err: any) {
    if (err?.name === 'AbortError' && timedOut) {
      throw new Error(`请求超时:${Math.round(timeoutMs / 1000)} 秒内未收到响应`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (userSignal) userSignal.removeEventListener('abort', linkUserAbort);
  }
}

/**
 * Normalize a user-provided base URL:
 * - trim whitespace and trailing slashes
 * - strip a trailing well-known endpoint path so the user can paste either
 *   `https://host/v1` or the full endpoint URL
 * - if only a host was provided (no path or just "/"), assume the conventional
 *   `/v1` prefix that nearly every OpenAI-compatible provider uses. This lets
 *   users paste a URL straight from their provider portal homepage:
 *     https://openai.chatnewai.com         → https://openai.chatnewai.com/v1
 *     https://openai.chatnewai.com/        → https://openai.chatnewai.com/v1
 *     https://openai.chatnewai.com/v1      → unchanged
 *     https://api.openai.com/v1/chat/completions → https://api.openai.com/v1
 *     https://generativelanguage.googleapis.com/v1beta/openai → unchanged
 */
export function normalizeBaseUrl(raw: string): string {
  let url = (raw || '').trim().replace(/\/+$/, '');
  if (!url) return '';
  const knownSuffixes = [
    '/chat/completions',
    '/v1/chat/completions',
    '/messages',
    '/v1/messages',
    '/models',
    '/v1/models',
  ];
  for (const suffix of knownSuffixes) {
    if (url.toLowerCase().endsWith(suffix)) {
      url = url.slice(0, -suffix.length);
      break;
    }
  }
  url = url.replace(/\/+$/, '');

  try {
    const u = new URL(url);
    if (u.pathname === '' || u.pathname === '/') {
      url = `${u.origin}/v1`;
    }
  } catch {
    // Invalid URL — let downstream assertSafeBaseUrl produce the user-facing error.
  }
  return url;
}

/**
 * Route an upstream API request through the same-origin nginx proxy when the
 * upstream host isn't reliably reachable from arbitrary client networks.
 *
 * opencode.ai sits behind Cloudflare's overseas edge, so browser-side direct
 * fetches fail ("Failed to fetch") on many client networks even though the
 * server reaches it fine. The app therefore routes every opencode.ai request
 * to the local `nginx.conf` location `/api/opencode-go/`, which reverse-
 * proxies to `https://opencode.ai/zen/go/v1`. Browser traffic then only ever
 * touches this deployment's own origin. Mirrors the comfyui-fixed pattern
 * (frontend never talks to the real upstream).
 *
 * Any baseUrl that isn't an opencode.ai URL is left untouched, so all other
 * providers keep their direct (CORS-enabled) calls.
 */
export function routeApiProxyUrl(baseUrl: string, path: string): string {
  const cleanPath = path.replace(/^\//, "");
  try {
    const u = new URL(baseUrl);
    if (
      u.hostname === "opencode.ai" &&
      (u.pathname === "/zen/go" || u.pathname.startsWith("/zen/go/"))
    ) {
      return `/api/opencode-go/${cleanPath}`;
    }
  } catch {
    // Not an absolute URL — leave as-is (already-relative proxy path).
  }
  return `${baseUrl}/${cleanPath}`;
}

/**
 * Reject anything that's not https:// (or http:// to a loopback host for
 * local dev). Without this, a malicious / mistyped config could send the
 * Authorization header to an attacker-controlled http endpoint, or trigger
 * non-http schemes via fetch.
 */
function assertSafeBaseUrl(baseUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`无效的 API Base URL: ${baseUrl}`);
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '[::1]' ||
    host === '::1';
  if (parsed.protocol === 'https:') return parsed;
  if (parsed.protocol === 'http:' && isLoopback) return parsed;
  throw new Error(
    `不允许的 API 协议: ${parsed.protocol}。仅支持 https://，本地调试可使用 http://localhost`,
  );
}

function isOfficialAnthropicHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return host === 'api.anthropic.com' || host.endsWith('.anthropic.com');
  } catch {
    return false;
  }
}

export async function fetchChatCompletion(
  messages: ApiMessage[],
  settings: ApiSettings,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  toolUseOptions?: ToolUseOptions,
): Promise<ApiUsage | void> {
  const format = settings.apiFormat || 'openai';
  if (format === 'anthropic') {
    return fetchAnthropic(messages, settings, onChunk, signal, toolUseOptions);
  }
  return fetchOpenAI(messages, settings, onChunk, signal, toolUseOptions);
}

/**
 * OpenAI-format tool descriptor. The MCP `inputSchema` is dropped under
 * `parameters` verbatim — it's already JSON Schema, which is exactly what
 * the OpenAI tools field expects.
 */
function toolsToOpenAI(tools: LlmTool[]): any[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema || { type: "object", properties: {} },
    },
  }));
}

/** Sum a token count field across rounds, treating `undefined` as 0 only
 *  when at least one round contributed. */
function addOptional(a: number | undefined, b: number | undefined): number | undefined {
  if (a == null && b == null) return undefined;
  return (a || 0) + (b || 0);
}

function mergeUsage(acc: ApiUsage | undefined, next: ApiUsage | undefined): ApiUsage | undefined {
  if (!next) return acc;
  if (!acc) return next;
  return {
    prompt_tokens: addOptional(acc.prompt_tokens, next.prompt_tokens),
    completion_tokens: addOptional(acc.completion_tokens, next.completion_tokens),
    total_tokens: addOptional(acc.total_tokens, next.total_tokens),
    prompt_tokens_details: next.prompt_tokens_details ?? acc.prompt_tokens_details,
    cache_read_input_tokens: addOptional(
      acc.cache_read_input_tokens,
      next.cache_read_input_tokens,
    ),
    cache_creation_input_tokens: addOptional(
      acc.cache_creation_input_tokens,
      next.cache_creation_input_tokens,
    ),
  };
}

/**
 * Single OpenAI completion turn. Returns the usage, any text the assistant
 * produced (before deciding to invoke tools), the tool calls it asked for,
 * and the finish_reason — the caller decides whether to loop or stop based
 * on those.
 *
 * `onChunk` is only invoked for *visible* assistant text, never for the
 * tool-call argument deltas — those are captured silently and accumulated
 * into the returned `toolCalls` array.
 */
async function callOpenAIOnce(
  messages: ApiMessage[],
  settings: ApiSettings,
  onChunk: (chunk: string) => void,
  signal: AbortSignal | undefined,
  tools: LlmTool[] | undefined,
): Promise<{
  usage?: ApiUsage;
  assistantText: string;
  toolCalls: any[];
  finishReason: string | null;
}> {
  const { apiKey, model, isStreaming } = settings;
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  assertSafeBaseUrl(baseUrl);
  const url = routeApiProxyUrl(baseUrl, "chat/completions");

  const requestBody: any = {
    model,
    messages: messages.map((m) => ({ ...m, content: stripVolatileFlags(m.content) })),
    stream: !!isStreaming,
  };
  if (isStreaming) {
    requestBody.stream_options = { include_usage: true };
  }
  if (tools && tools.length > 0) {
    requestBody.tools = toolsToOpenAI(tools);
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    referrerPolicy: 'no-referrer',
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new ApiHttpError(response.status, errText);
  }

  // Non-streaming path — assistant message arrives whole.
  if (!isStreaming) {
    const data = await response.json();
    const choice = data.choices?.[0];
    const msg = choice?.message;
    const text = (msg?.content as string) || '';
    if (text) onChunk(text);
    return {
      usage: data.usage as ApiUsage,
      assistantText: text,
      toolCalls: Array.isArray(msg?.tool_calls) ? msg.tool_calls : [],
      finishReason: choice?.finish_reason || null,
    };
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalUsage: ApiUsage | undefined;
  let assistantText = '';
  let finishReason: string | null = null;

  // Accumulator keyed by `index` (OpenAI streams tool_calls as deltas across
  // many chunks; each delta carries an index so we know which call it
  // belongs to). The same call's `arguments` field is delivered as a string
  // that has to be concatenated, then JSON-parsed once it's whole.
  const toolCallAcc: Record<number, {
    id?: string;
    type?: string;
    function: { name?: string; arguments: string };
  }> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim() === '') continue;
      if (!line.startsWith('data: ')) continue;
      const dataStr = line.slice(6).trim();
      if (!dataStr || dataStr === '[DONE]') continue;

      try {
        const data = JSON.parse(dataStr);
        const choice = data.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) {
          assistantText += delta.content;
          onChunk(delta.content);
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const tcDelta of delta.tool_calls) {
            const idx = tcDelta.index ?? 0;
            const slot = toolCallAcc[idx] || (toolCallAcc[idx] = {
              function: { name: '', arguments: '' },
            });
            if (tcDelta.id) slot.id = tcDelta.id;
            if (tcDelta.type) slot.type = tcDelta.type;
            if (tcDelta.function?.name) {
              slot.function.name = (slot.function.name || '') + tcDelta.function.name;
            }
            if (tcDelta.function?.arguments) {
              slot.function.arguments += tcDelta.function.arguments;
            }
          }
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
        if (data.usage) {
          finalUsage = data.usage;
        }
      } catch {
        console.warn('Failed to parse chunk:', dataStr);
      }
    }
  }

  // Materialize tool calls in index order. Anything missing an `id` is
  // dropped — without it we can't tie the eventual tool result back, so the
  // round can't proceed.
  const toolCalls = Object.keys(toolCallAcc)
    .map((k) => Number(k))
    .sort((a, b) => a - b)
    .map((idx) => toolCallAcc[idx])
    .filter((tc) => !!tc.id);

  return { usage: finalUsage, assistantText, toolCalls, finishReason };
}

async function fetchOpenAI(
  messages: ApiMessage[],
  settings: ApiSettings,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  toolUseOptions?: ToolUseOptions,
): Promise<ApiUsage | void> {
  const tools = toolUseOptions?.tools;
  const executeTool = toolUseOptions?.executeTool;
  const maxRounds = toolUseOptions?.maxRounds ?? 5;

  // OpenAI's Chat Completions format has no reliable trailing-system slot:
  // a conversation ending in a `system` message is out-of-spec, and gateways
  // react unpredictably (some wrap the reply in a JSON envelope like
  // {"response": "..."} that then renders as raw text). Gemini's compat layer
  // additionally hoists ALL system messages into systemInstruction, losing
  // recency. For BOTH, fold the dynamic tail (<session_rules>) into the
  // latest user turn instead — recency preserved, authority delegated by the
  // static session-protocol anchor (layout doc v3). The Anthropic native
  // path keeps the mid-conversation system message on its own.
  let currentMessages = foldTailSystemIntoLatestUser(messages);
  let usage: ApiUsage | undefined;

  // Hard-cap iterations at maxRounds + 1: each "round" is one LLM call that
  // may end in tool_calls; the +1 lets the model produce a final tool-free
  // answer after the last round of tool results comes in.
  for (let round = 0; round <= maxRounds; round++) {
    const turn = await callOpenAIOnce(
      currentMessages,
      settings,
      onChunk,
      signal,
      tools,
    );
    usage = mergeUsage(usage, turn.usage);

    if (turn.toolCalls.length === 0 || !executeTool) {
      return usage;
    }
    if (round === maxRounds) {
      // Reached the cap with the model still asking for tools — let it
      // finalize on the next iteration with an empty tools list so it has
      // to produce a textual answer instead.
      currentMessages = [
        ...currentMessages,
        { role: 'assistant', content: turn.assistantText, tool_calls: turn.toolCalls },
      ];
      // Append synthetic "tool budget exhausted" results so the model knows
      // why its requests aren't being honored anymore.
      for (const tc of turn.toolCalls) {
        currentMessages = [
          ...currentMessages,
          {
            role: 'tool',
            tool_call_id: tc.id,
            content: '[tool_error] tool-call rounds exhausted; respond with what you know',
          },
        ];
      }
      // Strip tools so the model is forced to respond textually.
      const finalTurn = await callOpenAIOnce(
        currentMessages,
        settings,
        onChunk,
        signal,
        undefined,
      );
      return mergeUsage(usage, finalTurn.usage);
    }

    // Append the assistant's tool-call message + every tool result in order.
    currentMessages = [
      ...currentMessages,
      {
        role: 'assistant',
        // OpenAI accepts an empty string when content is purely tool_calls.
        content: turn.assistantText,
        tool_calls: turn.toolCalls,
      },
    ];

    for (const tc of turn.toolCalls) {
      let parsedArgs: any = {};
      try {
        parsedArgs = tc.function.arguments
          ? JSON.parse(tc.function.arguments)
          : {};
      } catch {
        parsedArgs = {};
      }
      const result = await executeTool(tc.function.name || '', parsedArgs);
      toolUseOptions?.onToolEvent?.({
        round,
        name: tc.function.name || '',
        args: parsedArgs,
        result,
      });
      const resultText: string = result.ok
        ? result.text
        : `[tool_error] ${(result as { ok: false; message: string }).message}`;
      currentMessages = [
        ...currentMessages,
        {
          role: 'tool',
          tool_call_id: tc.id,
          content: resultText,
        },
      ];
    }
  }

  return usage;
}

/**
 * Convert an OpenAI-style content (string or parts array) to an Anthropic-style content.
 * - string passthrough
 * - { type: 'text', text } passthrough
 * - { type: 'image_url', image_url: { url } } -> { type: 'image', source: ... }
 */
function convertContentToAnthropic(content: string | any[]): string | any[] {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');

  return content.map((part) => {
    if (!part || typeof part !== 'object') return { type: 'text', text: String(part ?? '') };
    if (part.type === 'text') {
      const out: any = { type: 'text', text: part.text ?? '' };
      // Preserve the volatile marker so callAnthropicOnce can anchor cache
      // breakpoint ② before per-turn content (it strips the key on send).
      if (VOLATILE_PART_FLAG in part) out[VOLATILE_PART_FLAG] = true;
      return out;
    }
    if (part.type === 'image_url') {
      const url: string = part.image_url?.url ?? '';
      const dataUrlMatch = /^data:([^;]+);base64,(.+)$/.exec(url);
      if (dataUrlMatch) {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: dataUrlMatch[1],
            data: dataUrlMatch[2],
          },
        };
      }
      return {
        type: 'image',
        source: { type: 'url', url },
      };
    }
    // Already in Anthropic shape or unknown - pass through
    return part;
  });
}

function contentToTextParts(content: string | any[]): any[] {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  return Array.isArray(content) ? content : [{ type: 'text', text: String(content ?? '') }];
}

/**
 * Split OpenAI-style messages into an Anthropic top-level `system` string +
 * an alternating messages array.
 *
 * - Leading / interleaved system messages are concatenated into the top-level
 *   `system` field (the stable cache-prefix anchor).
 * - A SINGLE trailing system message (our dynamic tail — session rules,
 *   placed after the latest user turn) is handled per
 *   `supportsMidConvSystem`:
 *     - true  (Claude Opus 4.8 on the official host): kept in the `messages`
 *       array as a mid-conversation system message, so it sits at the
 *       generation point without invalidating the cached prefix.
 *     - false (other models / third-party proxies): folded into the LATEST
 *       USER turn as a volatile part (recency + cache preserved; authority
 *       delegated by the static session-protocol anchor). NEVER into the
 *       top-level system field — that re-bills the whole history every time
 *       the keyword-triggered rule set changes.
 * - Consecutive same-role messages are merged into a single message.
 */
function prepareAnthropicPayload(
  messages: ApiMessage[],
  supportsMidConvSystem: boolean,
): {
  system: string;
  messages: { role: 'user' | 'assistant' | 'system'; content: any[] }[];
} {
  // Identify a lone trailing system message that follows a user/assistant
  // turn — that's the dynamic tail emitted by buildRequestMessages. When the
  // model can't take a mid-conversation system message, fold it into the
  // latest user turn up-front so the conversion below sees no trailing system.
  let source = supportsMidConvSystem ? messages : foldTailSystemIntoLatestUser(messages);
  let tailSystem: ApiMessage | null = null;
  if (supportsMidConvSystem && source.length >= 2) {
    const last = source[source.length - 1];
    const prev = source[source.length - 2];
    if (last.role === 'system' && prev.role !== 'system') {
      tailSystem = last;
      source = source.slice(0, -1);
    }
  }

  const systemTexts: string[] = [];
  const converted: { role: 'user' | 'assistant' | 'system'; content: any[] }[] = [];

  const systemMsgToText = (content: string | any[]): string =>
    typeof content === 'string'
      ? content
      : contentToTextParts(content)
          .filter((p: any) => p?.type === 'text')
          .map((p: any) => p.text)
          .join('\n');

  for (const msg of source) {
    if (msg.role === 'system') {
      const text = systemMsgToText(msg.content);
      if (text) systemTexts.push(text);
      continue;
    }

    const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
    const parts = convertContentToAnthropic(msg.content);
    const partsArr = Array.isArray(parts) ? parts : [{ type: 'text', text: parts as string }];

    const last = converted[converted.length - 1];
    if (last && last.role === role) {
      last.content.push(...partsArr);
    } else {
      converted.push({ role, content: partsArr });
    }
  }

  if (tailSystem) {
    const text = systemMsgToText(tailSystem.content);
    if (text) {
      converted.push({ role: 'system', content: [{ type: 'text', text }] });
    }
  }

  return {
    system: systemTexts.join('\n\n'),
    messages: converted,
  };
}

/**
 * Anthropic-format tool descriptor. Field name is `input_schema` (vs
 * OpenAI's `parameters`) but the JSON Schema content is identical.
 */
function toolsToAnthropic(tools: LlmTool[]): any[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema || { type: "object", properties: {} },
  }));
}

/**
 * Pull a normalized usage record out of Anthropic's per-event token fields.
 * Anthropic exposes input_tokens / output_tokens / cache_read_input_tokens /
 * cache_creation_input_tokens — we map those to our ApiUsage shape so the
 * rest of the codebase doesn't have to special-case the format.
 */
function anthropicUsageToApi(
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  cacheReadTokens: number | undefined,
  cacheCreationTokens: number | undefined,
): ApiUsage {
  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens:
      inputTokens != null && outputTokens != null
        ? inputTokens + outputTokens
        : undefined,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheCreationTokens,
  };
}

interface AnthropicTurnResult {
  usage?: ApiUsage;
  /** Full content blocks (text + tool_use) in the order the model produced
   *  them. Pass back to Anthropic verbatim as the assistant message when
   *  appending tool results — the API requires the exact same blocks. */
  assistantBlocks: any[];
  stopReason: string | null;
}

/**
 * One Anthropic completion turn. Streams text deltas to onChunk while
 * silently accumulating tool_use blocks. Returns the assembled blocks +
 * usage + stop_reason so the caller can decide whether to invoke tools
 * and loop, or stop.
 */
async function callAnthropicOnce(
  anthMessages: { role: 'user' | 'assistant' | 'system'; content: any[] }[],
  system: string,
  settings: ApiSettings,
  onChunk: (chunk: string) => void,
  signal: AbortSignal | undefined,
  tools: LlmTool[] | undefined,
): Promise<AnthropicTurnResult> {
  const { apiKey, model, isStreaming } = settings;
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  assertSafeBaseUrl(baseUrl);
  const url = routeApiProxyUrl(baseUrl, "messages");

  // Prompt cache: only enable on the official Anthropic host. Third-party
  // gateways are inconsistent — most pass `cache_control` through unchanged
  // (no harm), some strip it (no harm), but a few strict proxies reject the
  // request outright. Gating by host preserves the previous behavior on those
  // proxies while delivering the speedup on api.anthropic.com.
  const useCacheControl = isOfficialAnthropicHost(baseUrl);

  // Second cache breakpoint: the last NON-volatile content part of the
  // latest user message — caches the stable prefix up to the user's real
  // text, while volatile parts (search context / folded session rules) stay
  // past the breakpoint and never pollute the cache entry (layout doc v3).
  // Skip on the first turn (no prior history). Within tool-use loops the
  // breakpoint shifts each round (because new tool_result messages get
  // appended), so cache hits will be partial; we accept that since the
  // system text + early history still hit.
  if (useCacheControl && anthMessages.length >= 2) {
    const lastUserIdx = anthMessages.map((m) => m.role).lastIndexOf('user');
    if (lastUserIdx !== -1) {
      const target = anthMessages[lastUserIdx];
      for (let i = target.content.length - 1; i >= 0; i--) {
        const part = target.content[i];
        if (
          part &&
          typeof part === 'object' &&
          !(VOLATILE_PART_FLAG in part)
        ) {
          target.content[i] = { ...part, cache_control: { type: 'ephemeral' } };
          break;
        }
      }
    }
  }

  const requestBody: any = {
    model,
    max_tokens: 4096,
    messages: anthMessages.map((m) => ({
      ...m,
      content: stripVolatileFlags(m.content),
    })),
    stream: !!isStreaming,
  };
  if (system) {
    if (useCacheControl) {
      requestBody.system = [
        {
          type: 'text',
          text: system,
          cache_control: { type: 'ephemeral' },
        },
      ];
    } else {
      requestBody.system = system;
    }
  }
  if (tools && tools.length > 0) {
    requestBody.tools = toolsToAnthropic(tools);
  }

  // Send both auth header styles so 3rd-party gateways that expect either
  // `x-api-key` (Anthropic native) or `Authorization: Bearer` (most proxies)
  // can authenticate. Only attach the dangerous-direct-browser-access header
  // for the official Anthropic host to avoid tripping strict proxies. Auth
  // headers are only attached when an apiKey is provided — empty-string key
  // would otherwise produce `Bearer ` and trip strict servers.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }
  if (isOfficialAnthropicHost(baseUrl)) {
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    referrerPolicy: 'no-referrer',
    signal,
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new ApiHttpError(response.status, errText);
  }

  // Non-streaming path: full message arrives as a single object. The
  // content array can mix text + tool_use blocks, both surface here.
  if (!isStreaming) {
    const data = await response.json();
    const blocks: any[] = Array.isArray(data.content) ? data.content : [];
    for (const b of blocks) {
      if (b?.type === 'text' && typeof b.text === 'string' && b.text) {
        onChunk(b.text);
      }
    }
    const usage = data.usage || {};
    return {
      usage: anthropicUsageToApi(
        usage.input_tokens,
        usage.output_tokens,
        usage.cache_read_input_tokens,
        usage.cache_creation_input_tokens,
      ),
      assistantBlocks: blocks,
      stopReason: data.stop_reason || null,
    };
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let cacheReadTokens: number | undefined;
  let cacheCreationTokens: number | undefined;
  let stopReason: string | null = null;

  // Per-block-index accumulator. Each content_block_start announces its
  // type ("text" | "tool_use") and metadata (id, name for tool_use); the
  // following content_block_delta events stream the body. tool_use input
  // arrives as JSON string fragments under `input_json_delta.partial_json`
  // that have to be concatenated and parsed at content_block_stop.
  type Slot =
    | { kind: 'text'; text: string }
    | { kind: 'tool_use'; id: string; name: string; jsonAcc: string };
  const slots: Record<number, Slot> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const dataStr = trimmed.slice(5).trim();
      if (!dataStr || dataStr === '[DONE]') continue;

      try {
        const event = JSON.parse(dataStr);
        switch (event.type) {
          case 'message_start': {
            const u = event.message?.usage;
            if (u?.input_tokens != null) inputTokens = u.input_tokens;
            if (u?.output_tokens != null) outputTokens = u.output_tokens;
            if (u?.cache_read_input_tokens != null) cacheReadTokens = u.cache_read_input_tokens;
            if (u?.cache_creation_input_tokens != null) cacheCreationTokens = u.cache_creation_input_tokens;
            break;
          }
          case 'content_block_start': {
            const block = event.content_block;
            if (block?.type === 'text') {
              slots[event.index] = { kind: 'text', text: '' };
            } else if (block?.type === 'tool_use') {
              slots[event.index] = {
                kind: 'tool_use',
                id: block.id,
                name: block.name,
                jsonAcc: '',
              };
            }
            break;
          }
          case 'content_block_delta': {
            const slot = slots[event.index];
            const delta = event.delta;
            if (!slot || !delta) break;
            if (slot.kind === 'text' && delta.type === 'text_delta' && typeof delta.text === 'string') {
              slot.text += delta.text;
              onChunk(delta.text);
            } else if (slot.kind === 'tool_use' && delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              slot.jsonAcc += delta.partial_json;
            }
            break;
          }
          case 'message_delta': {
            if (event.delta?.stop_reason) stopReason = event.delta.stop_reason;
            if (event.usage?.output_tokens != null) outputTokens = event.usage.output_tokens;
            if (event.usage?.cache_read_input_tokens != null) cacheReadTokens = event.usage.cache_read_input_tokens;
            if (event.usage?.cache_creation_input_tokens != null) cacheCreationTokens = event.usage.cache_creation_input_tokens;
            break;
          }
          case 'message_stop':
            // Stream complete — fall through to final assembly below.
            break;
          default:
            break;
        }
      } catch {
        console.warn('Failed to parse Anthropic chunk:', dataStr);
      }
    }
  }

  // Materialize assistant blocks in the order the API produced them. Empty
  // text slots are kept (some models emit a stub text block with no body
  // before invoking a tool) — Anthropic accepts them on replay.
  const assistantBlocks: any[] = Object.keys(slots)
    .map((k) => Number(k))
    .sort((a, b) => a - b)
    .map((idx) => {
      const s = slots[idx];
      if (s.kind === 'text') {
        return { type: 'text', text: s.text };
      }
      let input: any = {};
      try {
        input = s.jsonAcc ? JSON.parse(s.jsonAcc) : {};
      } catch {
        input = {};
      }
      return { type: 'tool_use', id: s.id, name: s.name, input };
    });

  return {
    usage: anthropicUsageToApi(inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens),
    assistantBlocks,
    stopReason,
  };
}

async function fetchAnthropic(
  messages: ApiMessage[],
  settings: ApiSettings,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal,
  toolUseOptions?: ToolUseOptions,
): Promise<ApiUsage | void> {
  // Mid-conversation system messages are a Claude Opus 4.8 feature, and only
  // on the official Anthropic host (third-party proxies may not honor the
  // placement). When unsupported, prepareAnthropicPayload folds the dynamic
  // tail back into the top-level system field.
  const supportsMidConvSystem =
    isOfficialAnthropicHost(normalizeBaseUrl(settings.baseUrl)) &&
    /claude-opus-4-8/.test(settings.model || '');

  const { system, messages: initialAnth } = prepareAnthropicPayload(
    messages,
    supportsMidConvSystem,
  );
  let anthMessages = initialAnth;

  const tools = toolUseOptions?.tools;
  const executeTool = toolUseOptions?.executeTool;
  const maxRounds = toolUseOptions?.maxRounds ?? 5;

  let usage: ApiUsage | undefined;

  for (let round = 0; round <= maxRounds; round++) {
    const turn = await callAnthropicOnce(
      anthMessages,
      system,
      settings,
      onChunk,
      signal,
      tools,
    );
    usage = mergeUsage(usage, turn.usage);

    const toolUses = turn.assistantBlocks.filter((b) => b?.type === 'tool_use');
    if (toolUses.length === 0 || !executeTool) {
      return usage;
    }

    if (round === maxRounds) {
      // Tool budget exhausted — feed synthetic error results back so the
      // model knows to stop requesting tools, then run one final round
      // with no tools advertised so it has to produce text.
      anthMessages = [
        ...anthMessages,
        { role: 'assistant', content: turn.assistantBlocks },
        {
          role: 'user',
          content: toolUses.map((tu: any) => ({
            type: 'tool_result',
            tool_use_id: tu.id,
            content: '[tool_error] tool-call rounds exhausted; respond with what you know',
          })),
        },
      ];
      const finalTurn = await callAnthropicOnce(
        anthMessages,
        system,
        settings,
        onChunk,
        signal,
        undefined,
      );
      return mergeUsage(usage, finalTurn.usage);
    }

    // Append the assistant turn (text + tool_use blocks) verbatim.
    anthMessages = [
      ...anthMessages,
      { role: 'assistant', content: turn.assistantBlocks },
    ];

    // Execute every tool_use block in order, collect tool_result blocks
    // to ship back as a single user message (per Anthropic spec — multiple
    // tool_results in one message, not separate messages).
    const toolResults: any[] = [];
    for (const tu of toolUses) {
      const args = tu.input || {};
      const result = await executeTool(tu.name, args);
      toolUseOptions?.onToolEvent?.({
        round,
        name: tu.name,
        args,
        result,
      });
      const resultText: string = result.ok
        ? result.text
        : `[tool_error] ${(result as { ok: false; message: string }).message}`;
      toolResults.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: resultText,
      });
    }
    anthMessages = [
      ...anthMessages,
      { role: 'user', content: toolResults },
    ];
  }

  return usage;
}

/**
 * Fetch the model list from the configured endpoint.
 * - OpenAI compatible: GET `${baseUrl}/models` with `Authorization: Bearer`
 * - Anthropic: GET `${baseUrl}/models` with `x-api-key` + `anthropic-version`
 *
 * Returns a sorted, deduplicated list of model IDs.
 */
export async function fetchModels(
  settings: ApiSettings,
  signal?: AbortSignal,
): Promise<string[]> {
  const format = settings.apiFormat || 'openai';
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (!baseUrl) throw new Error('Missing API Base URL');
  // apiKey is intentionally optional here — local servers like Ollama
  // don't require auth and would otherwise be unreachable. The downstream
  // request still 401s on real-Auth providers (OpenAI/Anthropic), giving
  // the user a precise error from the server.
  assertSafeBaseUrl(baseUrl);

  const url = routeApiProxyUrl(baseUrl, "models");
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (format === 'anthropic') {
    if (settings.apiKey) {
      headers['x-api-key'] = settings.apiKey;
      headers['Authorization'] = `Bearer ${settings.apiKey}`;
    }
    headers['anthropic-version'] = '2023-06-01';
    if (isOfficialAnthropicHost(baseUrl)) {
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
  } else {
    if (settings.apiKey) {
      headers['Authorization'] = `Bearer ${settings.apiKey}`;
    }
  }

  const response = await fetchWithTimeout(url, { method: 'GET', headers, referrerPolicy: 'no-referrer' }, signal);
  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new ApiHttpError(response.status, errText);
  }

  const data = await response.json();
  const rawList: any[] = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data)
        ? data
        : [];

  const ids = rawList
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.name || m?.model))
    .filter((id): id is string => typeof id === 'string' && id.length > 0);

  return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
}
