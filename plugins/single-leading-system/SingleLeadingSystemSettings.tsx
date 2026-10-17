import { useState, useSyncExternalStore } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { PluginSettingsPanelProps } from '../../src/plugins/types';
import { getPluginModelCatalog, subscribePluginModelCatalog } from '../../src/plugins/modelContext';
import { decodeConfig, defaults, editModelRule, modelKey } from './config';

const hint = 'text-[11px] leading-relaxed text-gray-500 dark:text-gray-400';
const label = 'text-xs font-semibold text-gray-500 dark:text-gray-400';
export function SingleLeadingSystemSettings({ config, updateConfig, enabled }: PluginSettingsPanelProps) {
  const catalog = useSyncExternalStore(subscribePluginModelCatalog, getPluginModelCatalog);
  const [confirmReset, setConfirmReset] = useState(false);
  const decoded = decodeConfig(config);
  const selected = new Map(decoded.models.map(m => [modelKey(m.providerId, m.modelId), m]));
  const unavailable = decoded.models.filter(r => !catalog.providers.some(p => p.id === r.providerId && p.models.some(m => m.id === r.modelId)));
  const edit = (provider: string, model: string, active: boolean | null) => updateConfig({ schemaVersion: 1, models: editModelRule(decoded.models, provider, model, active) });
  return <div className="space-y-5 min-w-0">
    <div className={hint}><p>已核验型号：Qwen3.6-35B-A3B、Qwen3.5-35B-A3B</p><p className="mt-1">合并静态系统设定，保留当前对话中的动态规则。</p></div>
    <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
      <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
      <p className="leading-relaxed break-words">使用本插件前，请在 Bypass（绕过机制）中<strong>关闭 AnswererFlagalac</strong>，并<strong>不要使用 RuleBreaker</strong>。RosettaStone 的字数控制和语言约束可继续使用。AnswererFlagalac 开启时，本轮插件不会生效。</p>
    </div>
    {!decoded.supported ? <div className="space-y-2 text-xs">
      <p className="text-amber-700 dark:text-amber-400">配置版本不支持，本插件暂不应用任何模型规则。</p>
      {confirmReset ? <div className="space-x-3"><span>重置将清除本插件的模型配置。</span><button onClick={() => { updateConfig({ ...defaults, models: [] }); setConfirmReset(false); }} className="text-red-500">确认重置</button><button onClick={() => setConfirmReset(false)}>取消</button></div> : <button onClick={() => setConfirmReset(true)} className="text-blue-600 dark:text-blue-400">重置本插件配置</button>}
    </div> : <section className="space-y-4">
      <div><h4 className={label}>应用到模型</h4><p className={`${hint} mt-2`}>按供应商分别选择模型。同名模型在不同供应商下独立配置。</p></div>
      <p className={`rounded-lg bg-gray-100 dark:bg-white/5 px-3 py-2 ${hint}`}>{enabled ? '仅对选中的可用模型生效，配置变更在下一次发送时生效。' : '插件已停用，可先选择模型，启用插件后生效。'}</p>
      {catalog.providers.map(provider => <section key={provider.id} className="space-y-2">
        <h5 className="flex flex-wrap items-center gap-2 text-xs font-semibold"><span className="break-all">{provider.name}</span><span className={`rounded bg-gray-100 dark:bg-white/5 px-1.5 py-0.5 ${hint}`}>{provider.apiFormat !== 'openai' ? '此接口不适用' : !provider.enabled ? '供应商已停用' : 'OpenAI 兼容'}</span></h5>
        {provider.models.length > 0 ? <div className="rounded-xl border border-gray-200 dark:border-white/10 divide-y divide-gray-200 dark:divide-white/10">
          {provider.models.map(model => {
            const active = selected.get(modelKey(provider.id, model.id))?.active === true;
            const available = provider.enabled && provider.apiFormat === 'openai';
            return <div key={model.id} className="flex items-center gap-3 p-3">
              <div className="flex-1 min-w-0"><p className="text-xs break-all">{model.name}</p>{model.name !== model.id && <p className={`${hint} break-all`}>{model.id}</p>}{!available && <p className={hint}>{provider.apiFormat !== 'openai' ? '仅支持 OpenAI 兼容接口' : '启用供应商后生效'}{active ? '；已保留配置，当前不生效' : ''}</p>}</div>
              <button type="button" role="switch" aria-checked={active} aria-label={`${provider.name} / ${model.name} 应用系统消息合并`} disabled={!available && !active} onClick={() => edit(provider.id, model.id, !active)} className={`relative h-5 w-9 flex-shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:opacity-50 disabled:cursor-not-allowed ${active ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-700'}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm ${active ? 'left-[18px]' : 'left-0.5'}`} /></button>
              {!available && selected.has(modelKey(provider.id, model.id)) && <button className={`${hint} hover:text-red-500`} onClick={() => edit(provider.id, model.id, null)}>移除配置</button>}
            </div>;
          })}
        </div> : <p className={hint}>该供应商尚未添加模型。</p>}
      </section>)}
      {!catalog.providers.some(p => p.models.length) && <p className={`rounded-xl border border-dashed border-gray-300 dark:border-white/15 p-6 text-center ${hint}`}>尚未添加对话模型。请先在“对话模型供应商”中添加，再到这里选择。</p>}
      {unavailable.length > 0 && <section className="space-y-2"><h5 className={label}>已保留的不可用配置</h5><div className="rounded-xl border border-gray-200 dark:border-white/10 divide-y divide-gray-200 dark:divide-white/10">{unavailable.map(r => <div key={modelKey(r.providerId, r.modelId)} className="flex items-center gap-3 p-3"><div className="flex-1 min-w-0"><p className="text-xs break-all">{r.modelId}</p><p className={`${hint} break-all`}>{catalog.providers.find(p => p.id === r.providerId)?.name ?? r.providerId} · 当前不可用，此配置不生效</p></div><button className={`${hint} flex-shrink-0 hover:text-red-500`} onClick={() => edit(r.providerId, r.modelId, null)}>移除配置</button></div>)}</div><p className={hint}>恢复原供应商及模型后沿用配置；仅名称相同的新供应商不会继承。</p></section>}
      <p className={hint}>配置变更在下一次发送时生效。</p>
    </section>}
    <p className={`border-t border-gray-200 dark:border-white/10 pt-4 ${hint}`}>思考模式由模型服务端保持默认设置，本插件不提供关闭开关。若输出被截断，本次发送最多自动恢复一次；已有工具结果时只恢复文字回复。重新生成属于新的请求，可能重新调用工具。</p>
  </div>;
}
