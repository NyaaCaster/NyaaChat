export interface ModelRule { providerId: string; modelId: string; active: boolean }
export const defaults = { schemaVersion: 1, models: [] as ModelRule[] };
export function modelKey(providerId: string, modelId: string): string { return JSON.stringify([providerId, modelId]); }
function plain(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
export function decodeConfig(config: Record<string, unknown>): { supported: boolean; models: ModelRule[]; invalid: number } {
  if (config.schemaVersion !== undefined && config.schemaVersion !== 1) return { supported: false, models: [], invalid: 0 };
  const rules = new Map<string, ModelRule>();
  let invalid = 0;
  for (const raw of Array.isArray(config.models) ? config.models : []) {
    if (!plain(raw) || typeof raw.providerId !== 'string' || !raw.providerId.trim() || typeof raw.modelId !== 'string' || !raw.modelId.trim()) { invalid++; continue; }
    const rule = { providerId: raw.providerId, modelId: raw.modelId, active: raw.active === true };
    const key = modelKey(rule.providerId, rule.modelId);
    rules.delete(key); rules.set(key, rule);
  }
  return { supported: true, models: [...rules.values()], invalid };
}
export function editModelRule(rules: readonly ModelRule[], providerId: string, modelId: string, active: boolean | null): ModelRule[] {
  const key = modelKey(providerId, modelId);
  const next = rules.filter(r => modelKey(r.providerId, r.modelId) !== key);
  return active === null ? next : [...next, { providerId, modelId, active }];
}
