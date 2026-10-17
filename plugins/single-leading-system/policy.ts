import { registerOutboundPolicy, type OutboundPolicyPlan, type OutboundRequestContext } from '../../src/plugins/outbound';
import { pluginLogger } from '../../src/plugins/pluginLog';
import { decodeConfig } from './config';
import { mergeSystemMessages, validateSingleLeadingSystem } from './normalizeMessages';
export const PLUGIN_ID = 'single-leading-system';
export function resolveMergePolicy(config: Record<string, unknown>, context: Readonly<OutboundRequestContext>): OutboundPolicyPlan | null {
  const decoded = decodeConfig(config);
  if (decoded.invalid) pluginLogger(PLUGIN_ID).warn('config', '已忽略非法模型配置记录。');
  if (!decoded.supported || context.purpose !== 'chat' || !context.modelAvailable || context.apiFormat !== 'openai' ||
      !decoded.models.some(m => m.active && m.providerId === context.providerId && m.modelId === context.modelId)) return null;
  if (context.answererFlagalacActive) {
    pluginLogger(PLUGIN_ID).warn('outbound', 'AnswererFlagalac 已开启，本轮不应用系统消息合并及其恢复策略。');
    return null;
  }
  return { pluginId: PLUGIN_ID, strategyId: PLUGIN_ID, handlesDynamicTail: true,
    transform: mergeSystemMessages, validate: validateSingleLeadingSystem };
}
export function registerMergePolicy(getConfig: () => Record<string, unknown>): () => void {
  return registerOutboundPolicy({ pluginId: PLUGIN_ID, resolve: context => resolveMergePolicy(getConfig(), context) });
}
