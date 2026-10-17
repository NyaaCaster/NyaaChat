import type { NyaaPlugin } from '../../src/plugins/types';
import { defaults } from './config';
import { PLUGIN_ID, registerMergePolicy } from './policy';
import { SingleLeadingSystemSettings } from './SingleLeadingSystemSettings';
const plugin: NyaaPlugin = {
  meta: {
    id: PLUGIN_ID, name: '系统消息合并', version: '1.0.0', icon: 'MessageSquare', order: 30,
    description: '本插件适用于目前已核验的 Qwen3.6 / Qwen3.5 官方模型聊天模板中“仅允许首条系统消息”的约束，不限于 Ollama 或 HauhauCS 模型。通过其他供应商的 OpenAI 兼容接口接入时，也可使用本插件。',
  },
  defaults,
  setup: ctx => registerMergePolicy(ctx.getConfig),
  SettingsPanel: SingleLeadingSystemSettings,
};
export default plugin;
