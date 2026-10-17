import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildExportPayload, parseImportText } from './settingsBackup';
import type { AppState } from '../types';
test('plugin config survives real export/import, including unavailable and inactive models', () => {
  const plugins = { 'single-leading-system': { enabled: true, config: { schemaVersion: 1, models: [
    { providerId: 'removed', modelId: 'm', active: true }, { providerId: 'p', modelId: 'm', active: false },
  ] } } };
  const settings = { llmProviders: [], imageProviders: [], characters: [], userRoles: [], currentLlmProviderId: '', currentImageProviderId: '', theme: 'light', plugins, pluginOrder: [], bypass: {} } as unknown as AppState;
  const exported = buildExportPayload(settings);
  const imported = parseImportText(JSON.stringify(exported));
  assert.equal(imported.kind, 'ok', JSON.stringify(imported));
  if (imported.kind === 'ok') assert.deepEqual(imported.settings.plugins, plugins);
});
