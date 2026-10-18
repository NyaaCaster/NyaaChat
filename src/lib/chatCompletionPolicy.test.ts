import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatCompletionError, parseProtectedCompletion, runBoundedCompletion, type CompletionTurn } from './chatCompletionPolicy';
import type { ApiMessage, LlmTool, ToolUseOptions } from './api';

const messages: ApiMessage[] = [{ role: 'system', content: 'anchor' }, { role: 'user', content: 'question' }];
const tools: LlmTool[] = [{ name: 'roll_coc', description: 'fixture', inputSchema: { type: 'object' } }];
const tool = (id = 'a', args = '{}', name = 'roll_coc') => ({ id, type: 'function', function: { name, arguments: args } });
const turn = (finishReason: string | null, text = '', toolCalls: any[] = [], visible = !!text): CompletionTurn => ({ assistantText: text, toolCalls, finishReason, completed: finishReason !== null, hadVisibleText: visible });
const sse = (...data: unknown[]) => data.map(d => 'data: ' + (typeof d === 'string' ? d : JSON.stringify(d)) + '\r\n\r\n').join('');
const chunk = (delta: any, finish_reason: string | null = null) => ({ choices: [{ index: 0, delta, finish_reason }] });
function stream(text: string, width = 7): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += width) controller.enqueue(bytes.slice(i, i + width));
    controller.close();
  } }));
}
function harness(turns: CompletionTurn[], options: Partial<ToolUseOptions> = {}) {
  const requests: { messages: ApiMessage[]; tools?: LlmTool[] }[] = [];
  let executed = 0;
  const run = () => runBoundedCompletion({ messages, call: async (m, t) => {
    requests.push({ messages: structuredClone(m), tools: t });
    assert.ok(turns.length, 'unexpected extra request'); return turns.shift()!;
  }, toolUseOptions: { tools, executeTool: async () => { executed++; return { ok: true, text: '{"roll":37,"result":"success"}' }; }, ...options } });
  return { run, requests, executions: () => executed };
}
test('SSE byte splits, CRLF, UTF-8, comments, final unterminated line and usage', async () => {
  let text = '';
  const input = ': comment\r\nevent: message\r\n' + sse(chunk({ content: '你好' }), chunk({}, 'stop'), { choices: [], usage: { completion_tokens: 8 } }) + 'data:[DONE]';
  const parsed = await parseProtectedCompletion(stream(input, 1), true, t => { text += t; });
  assert.equal(text, '你好'); assert.equal(parsed.completed, true); assert.equal(parsed.usage?.completion_tokens, 8);
  assert.equal(parsed.hadVisibleText, true);
});
test('stream without DONE is accepted only with explicit finish', async () => {
  const complete = await parseProtectedCompletion(stream(sse(chunk({ content: 'yes' }, 'stop'))), true, () => {});
  assert.equal(complete.completed, true);
  const incomplete = await parseProtectedCompletion(stream(sse(chunk({ content: 'partial' }))), true, () => {});
  assert.equal(incomplete.completed, false);
  const h = harness([incomplete]); await assert.rejects(h.run(), { code: 'incomplete_response' }); assert.equal(h.requests.length, 1);
});
for (const [name, input] of [
  ['bad JSON', 'data: {broken\n\n'],
  ['upstream error', sse({ error: { message: 'private-frame' } })],
  ['content after finish', sse(chunk({ content: 'first' }, 'stop'), chunk({ content: 'late' }))],
  ['tool after DONE', sse(chunk({}, 'stop'), '[DONE]', chunk({ tool_calls: [{ index: 0, ...tool() }] }))],
] as const) test(`protocol failure: ${name}`, async () => {
  await assert.rejects(parseProtectedCompletion(stream(input), true, () => {}), (e: any) => e.code === 'incomplete_response' && !e.message.includes('private-frame'));
});
test('split tool arguments preserve exact binding and usage-only chunks', async () => {
  const parsed = await parseProtectedCompletion(stream(sse(chunk({ tool_calls: [{ index: 0, ...tool('a', '{"x":') }] }), chunk({ tool_calls: [{ index: 0, function: { arguments: '1}' } }] }, 'tool_calls'), { choices: [], usage: { prompt_tokens: 10 } })), true, () => assert.fail('tool args must not be displayed'));
  assert.deepEqual(parsed.toolCalls, [tool('a', '{"x":1}')]);
});
test('nonstream reasoning-only length is invisible; recovery sums known usage', async () => {
  const parsed = await parseProtectedCompletion(Response.json({ choices: [{ message: { role: 'assistant', content: '', reasoning: 'do not expose' }, finish_reason: 'length' }], usage: { completion_tokens: 20 } }), false, () => assert.fail());
  assert.equal(parsed.hadVisibleText, false); assert.equal('reasoning' in parsed, false);
  const h = harness([parsed, { ...turn('stop', 'answer'), usage: { completion_tokens: 3 } }]);
  assert.equal((await h.run())?.completion_tokens, 23); assert.equal(h.requests.length, 2);
  assert.deepEqual(h.requests[0], h.requests[1]);
});
test('dice result is executed once and reused byte-for-byte; recovery removes tools', async () => {
  const h = harness([turn('tool_calls', '先检定', [tool()]), turn('length'), turn('stop', 'summary')]);
  await h.run(); assert.equal(h.executions(), 1); assert.equal(h.requests.length, 3);
  assert.deepEqual(h.requests[1].messages, h.requests[2].messages);
  assert.equal(h.requests[2].messages.at(-1)?.content, '{"roll":37,"result":"success"}');
  assert.equal(h.requests[2].tools, undefined);
});
test('summary tool calls refused without reroll', async () => {
  const h = harness([turn('tool_calls', '', [tool()]), turn('length'), turn('tool_calls', '', [tool('b')])]);
  await assert.rejects(h.run(), { code: 'tool_call_not_allowed' }); assert.equal(h.executions(), 1);
});
for (const [name, first, code] of [
  ['partial text', turn('length', 'partial'), 'truncated'],
  ['whitespace displayed', turn('length', ' '), 'truncated'],
  ['empty stop', turn('stop'), 'empty_response'],
  ['stop plus calls', turn('stop', '', [tool()]), 'incomplete_response'],
  ['missing finish', turn(null), 'incomplete_response'],
  ['content filter', turn('content_filter'), 'incomplete_response'],
] as const) test(`no retry: ${name}`, async () => {
  const h = harness([first]); await assert.rejects(h.run(), { code }); assert.equal(h.requests.length, 1); assert.equal(h.executions(), 0);
});
test('single recovery budget spans tools and final summaries', async () => {
  const h = harness([turn('length'), turn('tool_calls', '', [tool()]), turn('length')]);
  await assert.rejects(h.run(), (e: ChatCompletionError) => e.code === 'truncated' && e.recoveryUsed);
  assert.equal(h.requests.length, 3); assert.equal(h.executions(), 1);
});
test('length wins over incomplete tool args; calls from failed attempt are discarded', async () => {
  const h = harness([turn('length', '', [tool('bad', '{')]), turn('stop', 'ok')]);
  await h.run(); assert.equal(h.executions(), 0); assert.deepEqual(h.requests[0], h.requests[1]);
});
for (const calls of [[tool('a'), tool('b'), tool('c', '{')], [tool('a', '')], [tool('a', '[]')], [tool('a', 'null')], [tool('a', '{}', 'unknown')], [tool('a'), tool('a')], [{ ...tool(), id: '' }], [{ ...tool(), type: undefined }]]) {
  test('invalid batch executes zero tools: ' + JSON.stringify(calls), async () => {
    const h = harness([turn('tool_calls', '', calls)]); await assert.rejects(h.run(), { code: 'invalid_tool_call' }); assert.equal(h.executions(), 0);
  });
}
test('new IDs with same args execute normally; reused IDs stop', async () => {
  const h = harness([turn('tool_calls', '', [tool('a')]), turn('tool_calls', '', [tool('b')]), turn('stop', 'ok')]);
  await h.run(); assert.equal(h.executions(), 2);
  const duplicate = harness([turn('tool_calls', '', [tool('a')]), turn('tool_calls', '', [tool('a')])]);
  await assert.rejects(duplicate.run(), { code: 'invalid_tool_call' }); assert.equal(duplicate.executions(), 1);
});
test('tool cap adds bound errors, final length recovers without re-opening tools', async () => {
  const h = harness([turn('tool_calls', '', [tool()]), turn('length'), turn('stop', 'summary')], { maxRounds: 0 });
  await h.run(); assert.equal(h.executions(), 0);
  assert.equal(h.requests[1].messages.at(-1)?.tool_call_id, 'a');
  assert.equal(h.requests[1].tools, undefined); assert.equal(h.requests[2].tools, undefined);
});
test('cancel during tool execution stops next tool and request', async () => {
  const ctrl = new AbortController(); let executions = 0; let requests = 0;
  await assert.rejects(runBoundedCompletion({ messages, signal: ctrl.signal, call: async () => { requests++; return turn('tool_calls', '', [tool('a'), tool('b')]); }, toolUseOptions: { tools, executeTool: async () => { executions++; ctrl.abort(); return { ok: true, text: 'side effect' }; } } }), { name: 'AbortError' });
  assert.equal(executions, 1); assert.equal(requests, 1);
});
test('tool executor throws: no replay and no next request', async () => {
  let executions = 0;
  const h = harness([turn('tool_calls', '', [tool('a'), tool('b')])], { executeTool: async () => { executions++; throw new Error('executor failure'); } });
  await assert.rejects(h.run(), /executor failure/); assert.equal(executions, 1); assert.equal(h.requests.length, 1);
});
test('stream reader fails after length: never recover from a broken transport', async () => {
  let count = 0;
  const response = new Response(new ReadableStream({ pull(c) { if (!count++) c.enqueue(new TextEncoder().encode(sse(chunk({}, 'length')))); else c.error(new Error('disconnect')); } }));
  await assert.rejects(parseProtectedCompletion(response, true, () => {}), { code: 'incomplete_response' });
});
