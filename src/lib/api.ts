import { ApiSettings } from '../types';

export interface ApiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export type ApiMessage = { role: string; content: string | any[] };

/**
 * Normalize a user-provided base URL:
 * - trim whitespace and trailing slashes
 * - strip a trailing well-known path so the user can paste either
 *   `https://host/v1` or the full endpoint URL
 */
function normalizeBaseUrl(raw: string): string {
  let url = (raw || '').trim().replace(/\/+$/, '');
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
  return url.replace(/\/+$/, '');
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
  const url = `${baseUrl}/chat/completions`;

  const requestBody: any = {
    model,
    messages,
    stream: !!isStreaming,
  };

  if (isStreaming) {
    requestBody.stream_options = { include_usage: true };
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API Error ${response.status}: ${errText}`);
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
        } catch (e) {
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
  const url = `${baseUrl}/messages`;

  const { system, messages: anthMessages } = prepareAnthropicPayload(messages);

  const requestBody: any = {
    model,
    max_tokens: 4096,
    messages: anthMessages,
    stream: !!isStreaming,
  };
  if (system) requestBody.system = system;

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

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API Error ${response.status}: ${errText}`);
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

  const flushUsage = (): ApiUsage => ({
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens:
      inputTokens != null && outputTokens != null
        ? inputTokens + outputTokens
        : undefined,
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
            break;
          }
          case 'message_stop':
            return flushUsage();
          default:
            break;
        }
      } catch (e) {
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

  const response = await fetch(url, { method: 'GET', headers, signal });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`API Error ${response.status}: ${errText}`);
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
