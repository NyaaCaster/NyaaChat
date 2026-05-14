import { Message, ApiSettings } from '../types';

export interface ApiUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}

export async function fetchChatCompletion(
  messages: Omit<Message, 'id'>[],
  settings: ApiSettings,
  onChunk: (chunk: string) => void,
  signal?: AbortSignal
): Promise<ApiUsage | void> {
  const { baseUrl, apiKey, model, isStreaming } = settings;
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

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
