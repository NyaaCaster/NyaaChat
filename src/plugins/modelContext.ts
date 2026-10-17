/** 只读模型目录：只接收白名单字段，无地址或凭据；不得导入注册表/runtime。 */
export interface PluginModelCatalog {
  readonly providers: readonly {
    readonly id: string;
    readonly name: string;
    readonly enabled: boolean;
    readonly apiFormat: 'openai' | 'anthropic';
    readonly models: readonly { readonly id: string; readonly name: string }[];
  }[];
}
const empty: PluginModelCatalog = Object.freeze({ providers: Object.freeze([]) });
let snapshot = empty;
const listeners = new Set<() => void>();
export function getPluginModelCatalog(): PluginModelCatalog { return snapshot; }
export function subscribePluginModelCatalog(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function setPluginModelCatalog(next: PluginModelCatalog): void {
  const safe: PluginModelCatalog = Object.freeze({
    providers: Object.freeze((next?.providers ?? []).map(p => Object.freeze({
      id: p.id, name: p.name, enabled: p.enabled, apiFormat: p.apiFormat,
      models: Object.freeze((p.models ?? []).map(m => Object.freeze({ id: m.id, name: m.name }))),
    }))),
  });
  if (JSON.stringify(safe) === JSON.stringify(snapshot)) return;
  snapshot = safe;
  for (const listener of listeners) {
    try { listener(); } catch { console.error('[plugins] 模型目录订阅者执行失败。'); }
  }
}
export function resetPluginModelCatalogForTests(): void { snapshot = empty; listeners.clear(); }
