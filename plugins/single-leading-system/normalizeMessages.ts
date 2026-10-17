import type { ApiMessage } from '../../src/lib/api';
import type { OutboundMessageInput } from '../../src/plugins/outbound';

function invalid(): never {
  throw Object.assign(new Error('提示词布局不符合系统消息合并要求，本次请求已停止。'), { code: 'invalid_prompt_layout' });
}
export function validateSingleLeadingSystem(messages: readonly ApiMessage[]): void {
  if (!messages.length || !messages.some(m => m.role === 'user') ||
      messages.some((m, i) => !['system', 'assistant', 'user', 'tool'].includes(m.role) ||
        (m.role === 'system' && i !== 0) || (typeof m.content !== 'string' && !Array.isArray(m.content)))) invalid();
}
export function mergeSystemMessages({ messages, layout }: OutboundMessageInput): ApiMessage[] {
  const { staticPrefixLength: n, latestUserIndex: u, dynamicTailIndex: d } = layout;
  if (!Number.isInteger(n) || !Number.isInteger(u) || n < 0 || u < n || u >= messages.length ||
      (d === null ? u !== messages.length - 1 : !Number.isInteger(d) || d !== u + 1 || d !== messages.length - 1)) invalid();
  const prefix = messages.slice(0, n);
  if (prefix.some(m => !['system', 'assistant'].includes(m.role) || typeof m.content !== 'string') ||
      messages.slice(n, u + 1).some(m => !['user', 'assistant'].includes(m.role)) || messages[u].role !== 'user') invalid();
  if (d !== null && (messages[d].role !== 'system' || typeof messages[d].content !== 'string')) invalid();
  const systems = prefix.filter(m => m.role === 'system');
  const result: ApiMessage[] = [
    ...(systems.length ? [{ role: 'system', content: systems.map(m => m.content).join('\n\n') }] : []),
    ...structuredClone(prefix.filter(m => m.role === 'assistant')),
    ...structuredClone(messages.slice(n, u + 1)),
  ];
  if (d !== null && messages[d].content !== '') {
    const user = result[result.length - 1];
    user.content = [
      ...(typeof user.content === 'string' ? [{ type: 'text', text: user.content }] : user.content),
      { type: 'text', text: `\n\n${messages[d].content}`, _volatile: true },
    ];
  }
  validateSingleLeadingSystem(result);
  return result;
}
