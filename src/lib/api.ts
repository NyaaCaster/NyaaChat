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

export type ApiMessage = { role: string; content: string | any[] };

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
function normalizeBaseUrl(raw: string): string {
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
  signal?: AbortSignal
): Promise<ApiUsage | void> {
  const format = settings.apiFormat || 'openai';
  if (format === 'anthropic') {
    return fetchAnthropic(messages, settings, onChunk, signal);
  }
  return fetchOpenAI(messages, settings, onChunk, signal);
}

async function fetchOpenAI(
  messages: ApiMessage[],
  settings: ApiSettings,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
): Promise<ApiUsage | void> {
  const { apiKey, model, isStreaming } = settings;
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  assertSafeBaseUrl(baseUrl);
  const url = `${baseUrl}/chat/completions`;

  const requestBody: any = {
    model,
    messages,
    stream: !!isStreaming,
  };

  if (isStreaming) {
    requestBody.stream_options = { include_usage: true };
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    referrerPolicy: 'no-referrer',
  }, signal);

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new ApiHttpError(response.status, errText);
  }

  if (!isStreaming) {
    const data = await response.json();
    if (data.choices && data.choices.length > 0 && data.choices[0].message) {
      onChunk(data.choices[0].message.content || '');
    }
    return data.usage as ApiUsage;
  }

  if (!response.body) {
    throw new Error('Response body is null');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let finalUsage: ApiUsage | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim() === '') continue;
      if (line.startsWith('data: ')) {
        const dataStr = line.replace('data: ', '').trim();
        if (dataStr === '[DONE]') return finalUsage;

        try {
          const data = JSON.parse(dataStr);
          if (data.choices && data.choices[0]?.delta && data.choices[0].delta.content) {
            onChunk(data.choices[0].delta.content);
          }
          if (data.usage) {
            finalUsage = data.usage;
          }
        } catch {
          console.warn('Failed to parse chunk:', dataStr);
        }
      }
    }
  }
  
  return finalUsage;
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
    if (part.type === 'text') return { type: 'text', text: part.text ?? '' };
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
 * Split OpenAI-style messages into an Anthropic system string + alternating messages.
 * - system messages are concatenated and returned separately
 * - consecutive same-role messages are merged into a single message with combined content parts
 */
function prepareAnthropicPayload(messages: ApiMessage[]): {
  system: string;
  messages: { role: 'user' | 'assistant'; content: any[] }[];
} {
  const systemTexts: string[] = [];
  const converted: { role: 'user' | 'assistant'; content: any[] }[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      const text = typeof msg.content === 'string'
        ? msg.content
        : contentToTextParts(msg.content)
            .filter((p: any) => p?.type === 'text')
            .map((p: any) => p.text)
            .join('\n');
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

  return {
    system: systemTexts.join('\n\n'),
    messages: converted,
  };
}

async function fetchAnthropic(
  messages: ApiMessage[],
  settings: ApiSettings,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
): Promise<ApiUsage | void> {
  const { apiKey, model, isStreaming } = settings;
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  assertSafeBaseUrl(baseUrl);
  const url = `${baseUrl}/messages`;

  const { system, messages: anthMessages } = prepareAnthropicPayload(messages);

  // Prompt cache: only enable on the official Anthropic host. Third-party
  // gateways are inconsistent — most pass `cache_control` through unchanged
  // (no harm), some strip it (no harm), but a few strict proxies reject the
  // request outright. Gating by host preserves the previous behavior on those
  // proxies while delivering the speedup on api.anthropic.com.
  const useCacheControl = isOfficialAnthropicHost(baseUrl);

  const requestBody: any = {
    model,
    max_tokens: 4096,
    messages: anthMessages,
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
  // Second breakpoint: the last content part of the second-to-last message,
  // so the entire history prefix is cached and only the latest user turn is
  // billed at full rate. Skip on the first turn (when there is no prior history).
  if (useCacheControl && anthMessages.length >= 2) {
    const target = anthMessages[anthMessages.length - 2];
    if (target.content.length > 0) {
      const lastIdx = target.content.length - 1;
      const lastPart = target.content[lastIdx];
      if (lastPart && typeof lastPart === 'object') {
        target.content[lastIdx] = {
          ...lastPart,
          cache_control: { type: 'ephemeral' },
        };
      }
    }
  }

  // Send both auth header styles so 3rd-party gateways that expect either
  // `x-api-key` (Anthropic native) or `Authorization: Bearer` (most proxies)
  // can authenticate. Only attach the dangerous-direct-browser-access header
  // for the official Anthropic host to avoid tripping strict proxies.
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (isOfficialAnthropicHost(baseUrl)) {
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    referrerPolicy: 'no-referrer',
  }, signal);

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new ApiHttpError(response.status, errText);
  }

  if (!isStreaming) {
    const data = await response.json();
    if (Array.isArray(data.content)) {
      const text = data.content
        .filter((p: any) => p?.type === 'text')
        .map((p: any) => p.text || '')
        .join('');
      if (text) onChunk(text);
    }
    const usage = data.usage || {};
    return {
      prompt_tokens: usage.input_tokens,
      completion_tokens: usage.output_tokens,
      total_tokens:
        usage.input_tokens != null && usage.output_tokens != null
          ? usage.input_tokens + usage.output_tokens
          : undefined,
      cache_read_input_tokens: usage.cache_read_input_tokens,
      cache_creation_input_tokens: usage.cache_creation_input_tokens,
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

  const flushUsage = (): ApiUsage => ({
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens:
      inputTokens != null && outputTokens != null
        ? inputTokens + outputTokens
        : undefined,
    cache_read_input_tokens: cacheReadTokens,
    cache_creation_input_tokens: cacheCreationTokens,
  });

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
          case 'content_block_delta': {
            const delta = event.delta;
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              onChunk(delta.text);
            }
            break;
          }
          case 'message_delta': {
            if (event.usage?.output_tokens != null) outputTokens = event.usage.output_tokens;
            if (event.usage?.cache_read_input_tokens != null) cacheReadTokens = event.usage.cache_read_input_tokens;
            if (event.usage?.cache_creation_input_tokens != null) cacheCreationTokens = event.usage.cache_creation_input_tokens;
            break;
          }
          case 'message_stop':
            return flushUsage();
          default:
            break;
        }
      } catch {
        console.warn('Failed to parse Anthropic chunk:', dataStr);
      }
    }
  }

  return flushUsage();
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
  if (!settings.apiKey) throw new Error('Missing API Key');
  assertSafeBaseUrl(baseUrl);

  const url = `${baseUrl}/models`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (format === 'anthropic') {
    headers['x-api-key'] = settings.apiKey;
    headers['Authorization'] = `Bearer ${settings.apiKey}`;
    headers['anthropic-version'] = '2023-06-01';
    if (isOfficialAnthropicHost(baseUrl)) {
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
  } else {
    headers['Authorization'] = `Bearer ${settings.apiKey}`;
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
