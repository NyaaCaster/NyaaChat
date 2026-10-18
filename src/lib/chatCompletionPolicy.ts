import type { ApiMessage, ApiUsage, LlmTool, ToolUseOptions } from './api';

export type CompletionErrorCode = 'truncated' | 'empty_response' | 'incomplete_response' | 'invalid_tool_call' | 'tool_call_not_allowed' | 'invalid_prompt_layout' | 'policy_conflict';
const descriptions: Record<CompletionErrorCode, string> = {
  truncated: '输出达到服务端限制，回复未完整生成。已保留现有正文和工具结果。',
  empty_response: '模型返回了空回复，本次请求已结束。',
  incomplete_response: '模型响应未完整结束或协议异常，本次请求已结束。',
  invalid_tool_call: '模型返回的工具调用或参数不完整，本批工具未执行。',
  tool_call_not_allowed: '当前阶段不允许调用工具，已停止且未执行新的工具。',
  invalid_prompt_layout: '提示词布局不符合兼容策略要求，本次请求已停止。',
  policy_conflict: '多个消息兼容策略冲突，请只启用一个。',
};
export class ChatCompletionError extends Error {
  finishReason: string | null = null;
  round = 0;
  recoveryUsed = false;
  usage?: ApiUsage;
  hadVisibleText = false;
  constructor(public code: CompletionErrorCode) { super(descriptions[code]); this.name = 'ChatCompletionError'; }
}
export interface CompletionTurn {
  usage?: ApiUsage;
  assistantText: string;
  toolCalls: any[];
  finishReason: string | null;
  completed?: boolean;
  protocolError?: string;
  hadVisibleText?: boolean;
}
export function checkCompletionAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('请求已停止', 'AbortError');
}
/** 旧调用者缺省维持旧行为；保护链的工具日志明确标记为非最终回复。 */
export function shouldPublishAssistantCompletion(direction: string, meta?: Record<string, unknown>): boolean {
  return direction === 'response' && meta?.assistantCompletion !== false;
}
export function sumUsage(acc?: ApiUsage, next?: ApiUsage): ApiUsage | undefined {
  if (!next) return acc;
  const result: ApiUsage = { ...acc };
  for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'] as const) {
    const n = next[key];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) result[key] = (result[key] ?? 0) + n;
  }
  const cached = next.prompt_tokens_details?.cached_tokens;
  if (typeof cached === 'number' && Number.isFinite(cached) && cached >= 0) {
    result.prompt_tokens_details = { cached_tokens: (acc?.prompt_tokens_details?.cached_tokens ?? 0) + cached };
  }
  return Object.keys(result).length ? result : undefined;
}

/** 保护路径解析器。忽略原生 thinking 字段，不保存/续传其内容。 */
export async function parseProtectedCompletion(response: Response, streaming: boolean, onChunk: (text: string) => void, signal?: AbortSignal): Promise<CompletionTurn> {
  const result: CompletionTurn = { assistantText: '', toolCalls: [], finishReason: null, completed: false, hadVisibleText: false };
  const fail = (): never => { const e = new ChatCompletionError('incomplete_response'); e.usage = result.usage; e.hadVisibleText = !!result.hadVisibleText; e.finishReason = result.finishReason; throw e; };
  const emit = (value: unknown) => {
    if (value === undefined || value === null) return;
    if (typeof value !== 'string') fail();
    if (value) { checkCompletionAbort(signal); onChunk(value as string); result.assistantText += value; result.hadVisibleText = true; }
  };
  checkCompletionAbort(signal);
  if (!streaming) {
    let data: any;
    try { data = await response.json(); } catch { checkCompletionAbort(signal); fail(); }
    checkCompletionAbort(signal);
    result.usage = sumUsage(undefined, data?.usage);
    const choice = data?.choices?.[0];
    if (data?.error || !choice?.message || choice.message.role && choice.message.role !== 'assistant') fail();
    emit(choice.message.content);
    if (choice.message.tool_calls != null && !Array.isArray(choice.message.tool_calls)) fail();
    result.toolCalls = choice.message.tool_calls ?? [];
    result.finishReason = typeof choice.finish_reason === 'string' && choice.finish_reason ? choice.finish_reason : null;
    result.completed = result.finishReason !== null;
    return result;
  }
  if (!response.body) fail();
  const reader = response.body!.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '';
  let dataLines: string[] = [];
  let doneMarker = false;
  let ended = false;
  const calls = new Map<number, { id?: string; type?: string; function: { name: string; arguments: string } }>();
  const dispatch = () => {
    if (!dataLines.length) return;
    const raw = dataLines.join('\n'); dataLines = [];
    if (raw.trim() === '[DONE]') { doneMarker = true; return; }
    let data: any;
    try { data = JSON.parse(raw); } catch { fail(); }
    if (!data || data.error || !Array.isArray(data.choices)) fail();
    // 同一请求的 usage 是汇总快照，不能把重复快照按增量相加。
    if (data.usage != null) result.usage = sumUsage(undefined, data.usage);
    if (!data.choices.length) { if (data.usage == null) fail(); return; }
    const choice = data.choices[0];
    const delta = choice?.delta;
    if (!delta || typeof delta !== 'object' || Array.isArray(delta)) fail();
    if (delta.role != null && delta.role !== 'assistant') fail();
    const hasContent = delta.content != null && delta.content !== '';
    if (delta.tool_calls != null && !Array.isArray(delta.tool_calls)) fail();
    if ((result.finishReason || doneMarker) && (hasContent || delta.tool_calls?.length || choice.finish_reason)) fail();
    emit(delta.content);
    for (const item of delta.tool_calls ?? []) {
      if (!item || !Number.isInteger(item.index) || item.index < 0) fail();
      const slot = calls.get(item.index) ?? { function: { name: '', arguments: '' } };
      for (const field of ['id', 'type'] as const) {
        if (item[field] != null) {
          if (typeof item[field] !== 'string' || (slot[field] && slot[field] !== item[field])) fail();
          slot[field] = item[field];
        }
      }
      if (item.function != null && (typeof item.function !== 'object' || Array.isArray(item.function))) fail();
      for (const field of ['name', 'arguments'] as const) if (item.function?.[field] != null) {
        if (typeof item.function[field] !== 'string') fail();
        slot.function[field] += item.function[field];
      }
      calls.set(item.index, slot);
    }
    if (choice.finish_reason != null) {
      if (typeof choice.finish_reason !== 'string' || !choice.finish_reason) fail();
      result.finishReason = choice.finish_reason;
    }
  };
  const line = (value: string) => {
    if (!value) { dispatch(); return; }
    if (value.startsWith('data:')) dataLines.push(value.slice(5).replace(/^ /, ''));
    // SSE 注释、event/id/retry 控制字段不属于 JSON 正文。
  };
  const consume = (final = false) => {
    let index: number;
    while ((index = buffer.search(/[\r\n]/)) >= 0) {
      if (!final && buffer[index] === '\r' && index === buffer.length - 1) break;
      const width = buffer[index] === '\r' && buffer[index + 1] === '\n' ? 2 : 1;
      line(buffer.slice(0, index)); buffer = buffer.slice(index + width);
    }
    if (final) { if (buffer) line(buffer); buffer = ''; dispatch(); }
  };
  const abortReader = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener('abort', abortReader, { once: true });
  try {
    while (true) {
      checkCompletionAbort(signal);
      const { done, value } = await reader.read();
      checkCompletionAbort(signal);
      if (done) { ended = true; break; }
      buffer += decoder.decode(value, { stream: true }); consume();
    }
    buffer += decoder.decode(); consume(true);
    result.toolCalls = [...calls].sort(([a], [b]) => a - b).map(([, call]) => call);
    result.completed = result.finishReason !== null;
    return result;
  } catch (error) {
    checkCompletionAbort(signal);
    if (error instanceof ChatCompletionError) throw error;
    fail();
  } finally {
    signal?.removeEventListener('abort', abortReader);
    if (!ended) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function validateToolBatch(raw: readonly any[], tools: readonly LlmTool[], seen: ReadonlySet<string>) {
  const ids = new Set<string>();
  const names = new Set(tools.map(t => t.name));
  return raw.map(call => {
    const invalid = () => { throw new ChatCompletionError('invalid_tool_call'); };
    if (!call || typeof call.id !== 'string' || !call.id.trim() || ids.has(call.id) || seen.has(call.id) || call.type !== 'function' ||
        !call.function || !names.has(call.function.name) || typeof call.function.arguments !== 'string' || !call.function.arguments.trim()) invalid();
    let args: any;
    try { args = JSON.parse(call.function.arguments); } catch { invalid(); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) invalid();
    ids.add(call.id);
    return { call: { id: call.id as string, type: 'function', function: { name: call.function.name as string, arguments: call.function.arguments as string } }, args };
  });
}

export async function runBoundedCompletion(options: {
  messages: ApiMessage[];
  call: (messages: ApiMessage[], tools?: LlmTool[]) => Promise<CompletionTurn>;
  toolUseOptions?: ToolUseOptions;
  signal?: AbortSignal;
}): Promise<ApiUsage | undefined> {
  const { call, toolUseOptions: toolOptions, signal } = options;
  let messages = options.messages;
  let recoveryUsed = false;
  let hasToolResults = messages.some(m => m.role === 'tool');
  let summaryOnly = false;
  let round = 0;
  let usage: ApiUsage | undefined;
  const seen = new Set<string>();
  const maxRounds = Number.isInteger(toolOptions?.maxRounds) && toolOptions!.maxRounds! >= 0 ? toolOptions!.maxRounds! : 5;
  let turn: CompletionTurn | undefined;
  try {
    while (true) {
      checkCompletionAbort(signal);
      turn = undefined;
      turn = await call(messages, summaryOnly ? undefined : toolOptions?.tools);
      checkCompletionAbort(signal);
      usage = sumUsage(usage, turn.usage);
      if (!turn.completed || turn.protocolError) throw new ChatCompletionError('incomplete_response');
      if (turn.finishReason === 'length') {
        if (turn.hadVisibleText || recoveryUsed) throw new ChatCompletionError('truncated');
        recoveryUsed = true;
        if (hasToolResults) summaryOnly = true;
        toolOptions?.onNotice?.('输出达到服务端限制，正在尝试恢复（1/1）' + (hasToolResults ? '；将保留工具结果，仅恢复回复文字。' : '。'));
        continue;
      }
      if (summaryOnly && turn.toolCalls.length) throw new ChatCompletionError('tool_call_not_allowed');
      if (turn.finishReason === 'stop' && !turn.toolCalls.length) {
        if (!turn.assistantText.trim()) throw new ChatCompletionError('empty_response');
        return usage;
      }
      if (turn.finishReason !== 'tool_calls' || !turn.toolCalls.length) throw new ChatCompletionError('incomplete_response');
      if (!toolOptions?.executeTool || !toolOptions.tools.length) throw new ChatCompletionError('tool_call_not_allowed');
      const batch = validateToolBatch(turn.toolCalls, toolOptions.tools, seen);
      messages = [...messages, { role: 'assistant', content: turn.assistantText, tool_calls: batch.map(b => b.call) }];
      for (const { call: tool, args } of batch) {
        checkCompletionAbort(signal);
        seen.add(tool.id);
        let content: string;
        if (round === maxRounds) content = '[tool_error] tool-call rounds exhausted; respond with what you know';
        else {
          const result = await toolOptions.executeTool(tool.function.name, args);
          checkCompletionAbort(signal);
          content = result.ok ? result.text : `[tool_error] ${(result as { ok: false; message: string }).message}`;
          toolOptions.onToolEvent?.({ round, name: tool.function.name, args, result });
        }
        messages = [...messages, { role: 'tool', tool_call_id: tool.id, content }];
        hasToolResults = true;
      }
      if (round === maxRounds) summaryOnly = true;
      round++;
    }
  } catch (error) {
    checkCompletionAbort(signal);
    if (error instanceof ChatCompletionError) {
      error.round = round; error.recoveryUsed = recoveryUsed;
      error.usage = sumUsage(usage, error.usage);
      error.finishReason = turn?.finishReason ?? error.finishReason;
      error.hadVisibleText = !!turn?.hadVisibleText || error.hadVisibleText;
    }
    throw error;
  }
}
