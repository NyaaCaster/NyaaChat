import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchChatCompletion, type ApiMessage } from './api';
import type { ApiSettings } from '../types';
import type { PreparedOutboundRequest } from '../plugins/outbound';
import { resolveMergePolicy } from '../../plugins/single-leading-system/policy';
import { shouldPublishAssistantCompletion } from './chatCompletionPolicy';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
export const apiFixture: ApiSettings = { baseUrl: 'http://localhost:9999/v1', apiKey: '', model: 'test', isStreaming: false, apiFormat: 'openai' };
test('old request shape unchanged; prepared input skips old folding and strips metadata', async () => {
  const bodies: any[] = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Response.json({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] });
  };
  const messages: ApiMessage[] = [{ role: 'system', content: 'anchor' }, { role: 'user', content: [{ type: 'text', text: 'hello', _volatile: true }] }];
  await fetchChatCompletion(messages, apiFixture, () => {});
  let validations = 0;
  const prepared: PreparedOutboundRequest = { messages, plan: { pluginId: 'fixture', strategyId: 'fixture', handlesDynamicTail: true, transform: () => messages, validate: () => { validations++; } } };
  await fetchChatCompletion(messages, apiFixture, () => {}, undefined, undefined, prepared);
  assert.deepEqual(bodies[0], bodies[1]);
  assert.deepEqual(Object.keys(bodies[1]).sort(), ['messages', 'model', 'stream']);
  assert.equal('_volatile' in bodies[1].messages[1].content[0], false);
  assert.equal(validations, 1);
  await assert.rejects(fetchChatCompletion([...messages], apiFixture, () => {}, undefined, undefined, prepared), /不一致/);
  await assert.rejects(fetchChatCompletion(messages, { ...apiFixture, apiFormat: 'anthropic' }, () => {}, undefined, undefined, prepared), /不一致/);
});
test('actual protected API loop: dice result survives recovery, fields and completion events', async () => {
  const bodies: any[] = [];
  const call = { id: 'dice-1', type: 'function', function: { name: 'roll_coc', arguments: '{"skill":50}' } };
  const replies = [
    { choices: [{ message: { content: '', tool_calls: [call] }, finish_reason: 'tool_calls' }] },
    { choices: [{ message: { content: '', reasoning: 'not persisted' }, finish_reason: 'length' }], usage: { completion_tokens: 20 } },
    { choices: [{ message: { content: '37，成功' }, finish_reason: 'stop' }], usage: { completion_tokens: 3 } },
  ];
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return Response.json(replies.shift()); };
  const messages: ApiMessage[] = [{ role: 'system', content: 'anchor' }, { role: 'user', content: 'roll' }];
  const plan = resolveMergePolicy({ models: [{ providerId: 'p', modelId: 'm', active: true }] }, { purpose: 'chat', providerId: 'p', modelId: 'm', modelAvailable: true, apiFormat: 'openai', answererFlagalacActive: false })!;
  let executions = 0; let completions = 0; let text = ''; let notices = 0;
  const usage = await fetchChatCompletion(messages, apiFixture, t => { text += t; }, undefined, {
    tools: [{ name: 'roll_coc', description: 'fixture' }],
    executeTool: async () => { executions++; return { ok: true, text: 'exact dice result: 37' }; },
    onToolEvent: () => { if (shouldPublishAssistantCompletion('response', { assistantCompletion: false })) completions++; },
    onNotice: () => { notices++; },
  }, { plan, messages });
  if (shouldPublishAssistantCompletion('response', { assistantCompletion: true })) completions++;
  assert.equal(executions, 1); assert.equal(completions, 1); assert.equal(notices, 1); assert.equal(text, '37，成功');
  assert.equal(usage && usage.completion_tokens, 23);
  assert.deepEqual(bodies[1].messages, bodies[2].messages);
  assert.equal(bodies[2].messages.at(-1).tool_call_id, 'dice-1');
  assert.equal(bodies[2].messages.at(-1).content, 'exact dice result: 37');
  assert.equal('tools' in bodies[2], false);
  for (const body of bodies) {
    assert.equal(body.messages.filter((m: ApiMessage) => m.role === 'system').length, 1);
    for (const key of ['tool_choice', 'think', 'enable_thinking', 'reasoning_effort', 'max_tokens', 'max_completion_tokens', 'plan', 'layout']) assert.equal(key in body, false);
  }
});
test('protected API failures never reach completion event; old path remains permissive', async () => {
  globalThis.fetch = async () => Response.json({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] });
  const messages = [{ role: 'user', content: 'u' }];
  const plan = resolveMergePolicy({ models: [{ providerId: 'p', modelId: 'm', active: true }] }, { purpose: 'chat', providerId: 'p', modelId: 'm', modelAvailable: true, apiFormat: 'openai', answererFlagalacActive: false })!;
  let completions = 0; let text = '';
  await assert.rejects(async () => {
    await fetchChatCompletion(messages, apiFixture, t => { text += t; }, undefined, undefined, { plan, messages });
    if (shouldPublishAssistantCompletion('response', { assistantCompletion: true })) completions++;
  }, { code: 'truncated' });
  assert.equal(completions, 0); assert.equal(text, 'partial');
  await fetchChatCompletion(messages, apiFixture, () => {});
  assert.equal(shouldPublishAssistantCompletion('response'), true);
});
