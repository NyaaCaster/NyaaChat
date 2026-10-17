import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { decodeConfig, editModelRule } from './config';
import { mergeSystemMessages, validateSingleLeadingSystem } from './normalizeMessages';
import { registerMergePolicy, resolveMergePolicy } from './policy';
import { resolveOutboundPolicy, resetOutboundPoliciesForTests, type OutboundRequestContext } from '../../src/plugins/outbound';
import type { ApiMessage } from '../../src/lib/api';
const context: OutboundRequestContext = { purpose: 'chat', providerId: 'p', modelId: 'm', apiFormat: 'openai', modelAvailable: true, answererFlagalacActive: false };
const config = { schemaVersion: 1, models: [{ providerId: 'p', modelId: 'm', active: true }] };
afterEach(resetOutboundPoliciesForTests);
test('interleaved static roles, exact separators, dynamic parts and input immutability', () => {
  const messages: ApiMessage[] = [
    { role: 'system', content: ' A ' }, { role: 'assistant', content: 'B' }, { role: 'system', content: 'C' },
    { role: 'user', content: 'history' }, { role: 'assistant', content: 'reply' },
    { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } }, { type: 'text', text: 'document' }] },
    { role: 'system', content: 'dynamic\n<output_constraints>中文</output_constraints>' },
  ];
  const before = structuredClone(messages);
  function freeze(o: any) { if (o && typeof o === 'object') { Object.values(o).forEach(freeze); Object.freeze(o); } }
  freeze(messages);
  const result = mergeSystemMessages({ messages, layout: { staticPrefixLength: 3, latestUserIndex: 5, dynamicTailIndex: 6 } });
  assert.deepEqual(result.map(m => m.role), ['system', 'assistant', 'user', 'assistant', 'user']);
  assert.equal(result[0].content, ' A \n\nC');
  assert.deepEqual(result[4].content.slice(0, 2), before[5].content);
  assert.equal(result[4].content[2]._volatile, true);
  assert.equal(result[4].content[2].text, '\n\n' + before[6].content);
  assert.deepEqual(messages, before);
  assert.deepEqual(mergeSystemMessages({ messages: result, layout: { staticPrefixLength: 2, latestUserIndex: 4, dynamicTailIndex: null } }), result);
});
test('empty tail, absent system and invalid layout are explicit', () => {
  const m = [{ role: 'user', content: 'u' }, { role: 'system', content: '' }];
  assert.deepEqual(mergeSystemMessages({ messages: m, layout: { staticPrefixLength: 0, latestUserIndex: 0, dynamicTailIndex: 1 } }), [m[0]]);
  assert.throws(() => mergeSystemMessages({ messages: m, layout: { staticPrefixLength: 0, latestUserIndex: 0, dynamicTailIndex: null } }), /布局/);
  assert.throws(() => validateSingleLeadingSystem(m), /布局/);
});
test('config validates version, duplicate last wins, exact identity and explicit deletion', () => {
  assert.equal(decodeConfig({ schemaVersion: 2, models: config.models }).supported, false);
  const d = decodeConfig({ models: [...config.models, null, { providerId: 'other', modelId: 'm', active: true }, { providerId: 'p', modelId: 'm', active: 'true' }] });
  assert.equal(d.invalid, 1);
  assert.deepEqual(d.models.map(m => [m.providerId, m.active]), [['other', true], ['p', false]]);
  const next = editModelRule(d.models, 'p', 'm', false);
  assert.equal(next.length, 2);
  assert.equal(editModelRule(next, 'p', 'm', null).length, 1);
  assert.equal(resolveMergePolicy(config, { ...context, providerId: ' p' }), null);
});
test('resolver snapshots, config changes, AF fallback, unavailable and native protocols', () => {
  let current: Record<string, unknown> = config;
  const dispose = registerMergePolicy(() => current);
  const captured = resolveOutboundPolicy(context);
  assert.ok(captured);
  for (const patch of [{ modelAvailable: false }, { apiFormat: 'anthropic' as const }, { answererFlagalacActive: true }, { providerId: 'new' }]) assert.equal(resolveOutboundPolicy({ ...context, ...patch }), null);
  current = { models: [] };
  assert.equal(resolveOutboundPolicy(context), null);
  current = config;
  assert.ok(resolveOutboundPolicy(context));
  dispose(); assert.equal(resolveOutboundPolicy(context), null);
  assert.equal(captured?.strategyId, 'single-leading-system');
});
