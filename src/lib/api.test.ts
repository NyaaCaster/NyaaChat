import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchChatCompletion, type ApiMessage } from './api';
import type { ApiSettings } from '../types';
import type { PreparedOutboundRequest } from '../plugins/outbound';
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
