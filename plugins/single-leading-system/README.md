# 系统消息合并

原生插件 `single-leading-system`，用于适配已核验的 Qwen3.6 / Qwen3.5 聊天模板约束。通过 OpenAI 兼容接口接入时，不限 Ollama 供应商。

## 使用

1. 打开「扩展 → 系统消息合并」。
2. 启用插件，并勾选对应供应商下的模型。默认插件停用、没有选中模型；停用时可预配置。
3. 关闭 Bypass 的 AnswererFlagalac，不使用 RuleBreaker。RosettaStone 两项可继续使用。

插件合并静态 system 为首条，动态规则留在最新用户消息中；保留历史、附件和工具消息。有效 AnswererFlagalac 目标存在时插件完全不介入，日志说明原因。

无 thinking 开关和预算设置，沿用模型部署默认行为。输出明确截断且本次模型请求尚未展示正文时，整次发送最多恢复一次；已有工具结果后仅恢复汇总，不重新执行工具。部分正文截断不会自动重试；「重新生成」属于新请求，可能重新调用工具。

不可用模型的配置保留，可手动移除；相同供应商 ID 与模型 ID 恢复后沿用，名称相同不会自动继承。

## 开发与验证

唯一开发计划：[开发计划-SSOT](../../.docs/plugin-system/插件开发_single-leading-system/开发计划-SSOT.md)。
实现证据和测试命令：[验证报告](../../.docs/plugin-system/插件开发_single-leading-system/验证报告.md)。
