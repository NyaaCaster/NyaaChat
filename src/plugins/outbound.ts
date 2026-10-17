/** 出站策略叶子契约。插件不能经此模块访问宿主状态或凭据。 */
import type { ApiMessage } from '../lib/api';
import { recordPluginError } from './pluginLog';

export interface ChatPromptLayout {
  staticPrefixLength: number;
  latestUserIndex: number;
  dynamicTailIndex: number | null;
}
export interface OutboundRequestContext {
  purpose: 'chat';
  providerId: string;
  modelId: string;
  apiFormat: 'openai' | 'anthropic';
  modelAvailable: boolean;
  answererFlagalacActive: boolean;
}
export interface OutboundMessageInput {
  messages: readonly ApiMessage[];
  layout: Readonly<ChatPromptLayout>;
}
export interface OutboundPolicyPlan {
  pluginId: string;
  strategyId: string;
  transform(input: OutboundMessageInput): ApiMessage[];
  validate(messages: readonly ApiMessage[]): void;
  handlesDynamicTail: true;
  completionPolicy?: 'bounded-recovery';
}
export interface OutboundPolicyRegistration {
  pluginId: string;
  resolve(context: Readonly<OutboundRequestContext>): OutboundPolicyPlan | null;
}
export interface PreparedOutboundRequest {
  plan: OutboundPolicyPlan;
  messages: ApiMessage[];
}
const registrations = new Map<string, OutboundPolicyRegistration>();
export function registerOutboundPolicy(registration: OutboundPolicyRegistration): () => void {
  if (registrations.has(registration.pluginId)) {
    throw Object.assign(new Error('出站消息策略重复注册。'), { code: 'policy_conflict' });
  }
  registrations.set(registration.pluginId, registration);
  return () => {
    if (registrations.get(registration.pluginId) === registration) registrations.delete(registration.pluginId);
  };
}
export function resolveOutboundPolicy(context: Readonly<OutboundRequestContext>): OutboundPolicyPlan | null {
  const snapshot = Object.freeze({ ...context });
  let selected: OutboundPolicyPlan | null = null;
  for (const registration of registrations.values()) {
    let plan: OutboundPolicyPlan | null;
    try { plan = registration.resolve(snapshot); }
    catch (error) {
      recordPluginError(registration.pluginId, 'outbound.resolve', '出站策略解析失败。');
      throw error;
    }
    if (!plan) continue;
    if (selected) throw Object.assign(new Error('多个出站消息策略同时匹配，请只启用一个。'), { code: 'policy_conflict' });
    if (plan.pluginId !== registration.pluginId || plan.handlesDynamicTail !== true) {
      throw new Error('出站消息策略契约不完整。');
    }
    selected = Object.freeze({ ...plan });
  }
  return selected;
}
export function validateOutboundMessages(plan: OutboundPolicyPlan, messages: readonly ApiMessage[]): void {
  if (!Array.isArray(messages) || !messages.length || messages.some(m =>
    !m || !['system', 'user', 'assistant', 'tool'].includes(m.role) ||
    (typeof m.content !== 'string' && !Array.isArray(m.content)))) {
    throw Object.assign(new Error('提示词消息结构无效，无法应用兼容策略。'), { code: 'invalid_prompt_layout' });
  }
  plan.validate(messages);
}
export function resetOutboundPoliciesForTests(): void { registrations.clear(); }
