import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRequestEnvelope, buildRequestMessages, buildPromptTextPrepareOptions } from './chatPipeline';
import type { AppState, Message, CharacterSettings, WorldInfoRule } from '../types';
import { mergeSystemMessages } from '../../plugins/single-leading-system/normalizeMessages';
import { preparePromptText, registerPromptTextRenderer, resetPromptTextForTests } from '../plugins/promptText';

export function promptFixture() {
  return {
    processedInput: 'hello', messageContent: 'hello',
    baseMessages: [{ id: 'old', role: 'assistant', content: 'previous', timestamp: 0 }] as Message[],
    settings: { userRoles: [], bypass: {} } as unknown as AppState,
    currentCharacter: undefined, userName: 'User', charName: 'Assistant',
  };
}
test('envelope preserves old messages and reports exact assembly boundaries', () => {
  const args = promptFixture();
  const envelope = buildRequestEnvelope(args);
  assert.deepEqual(envelope.messages, buildRequestMessages(args));
  assert.equal(envelope.layout.staticPrefixLength, 1);
  assert.equal(envelope.layout.latestUserIndex, 2);
  assert.equal(envelope.messages[2].content, 'hello');
  assert.equal(envelope.layout.dynamicTailIndex, null);
});
test('MCP and volatile search stay after history, inside correct boundary', () => {
  const envelope = buildRequestEnvelope({ ...promptFixture(), mcpAdvertisedToolNames: ['roll_coc'], searchContext: 'external', memoryContext: 'memory' });
  assert.equal(envelope.layout.dynamicTailIndex, envelope.messages.length - 1);
  assert.equal(envelope.messages.at(-1)?.role, 'system');
  assert.match(String(envelope.messages.at(-1)?.content), /roll_coc/);
  const user = envelope.messages[envelope.layout.latestUserIndex];
  assert.ok(Array.isArray(user.content));
  assert.equal(user.content[1].text, '\n\nmemory');
  assert.equal(user.content[2].text, '\n\nexternal');
});
test('RosettaStone four combinations remain in latest user, never promoted to system', () => {
  for (const word of [false, true]) for (const language of [false, true]) {
    const args = promptFixture();
    args.settings.bypass = { wordCount: { enabled: word, template: 'COUNT_CUSTOM' }, languageConstraint: { enabled: language, template: 'LANG_CUSTOM' } } as AppState['bypass'];
    const result = mergeSystemMessages(buildRequestEnvelope(args));
    assert.ok(!JSON.stringify(result[0]).includes('CUSTOM'));
    assert.equal(JSON.stringify(result.at(-1)).includes('COUNT_CUSTOM'), word);
    assert.equal(JSON.stringify(result.at(-1)).includes('LANG_CUSTOM'), language);
  }
});
test('prepared EJS stays dynamic; transforming and continuing cannot re-execute renderer', async () => {
  let renders = 0;
  const dispose = registerPromptTextRenderer({ pluginId: 'fixture-ejs', matches: text => text.includes('<%'), render: () => { renders++; return 'rendered-current-value'; } });
  const rule = { id: 'ejs', enabled: true, triggerType: 'permanent', position: 'system', content: '<%= value %>' } as WorldInfoRule;
  const args = { ...promptFixture(), currentCharacter: { id: 'c', name: 'C', description: '', worldInfo: [rule] } as CharacterSettings };
  try {
    await preparePromptText([rule], buildPromptTextPrepareOptions({ sessionId: 'fixture', turnId: 'one', identity: { user: 'User', char: 'C' }, character: { id: 'c', name: 'C' } }, args));
    const merged = mergeSystemMessages(buildRequestEnvelope(args));
    assert.equal(JSON.stringify(merged[0]).includes('rendered-current-value'), false);
    assert.ok(JSON.stringify(merged.at(-1)).includes('rendered-current-value'));
    assert.equal(JSON.stringify(merged).includes('<%='), false);
    assert.equal(renders, 1);
    const again = mergeSystemMessages({ messages: merged, layout: { staticPrefixLength: 1, latestUserIndex: merged.length - 1, dynamicTailIndex: null } });
    assert.deepEqual(again, merged); assert.equal(renders, 1);
  } finally { dispose(); resetPromptTextForTests(); }
});
