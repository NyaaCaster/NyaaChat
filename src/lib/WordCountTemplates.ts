/**
 * RosettaStone 模块的默认配置 —— 一组**第一方输出约束**条目。
 *
 * ⚠️ 该文件最初从 bypassTemplates.ts 中抽出（当时二者共存于同一套模板体系）；
 * ClavisSalomonis（旧 bypass 模块）已彻底退役、bypassTemplates.ts 与其注入链路
 * 一并删除，RosettaStone 只是保留了自己的条目结构，与任何已退役模块无关。
 *
 * 结构效仿 lib/WordCheckTemplates.ts：`Record<键, 模板>`。治理逻辑一致：允许用户
 * 在 BypassModal 的 RosettaStone 模块内自行编辑、用各条目自带的「重置」图标按钮
 * 还原为这里配置的对应 `content`。
 *
 * 注入位置见 src/lib/chatPipeline.ts：每个已启用且非空的条目合入动态尾部单条
 * system 消息里的 `<output_constraints>` 块（贴近生成点的近因位置，软档措辞，
 * 让位于用户当轮发言）。参见 .docs/llm-chat-prompt-architecture-standard.md
 * §3 / §6.3。
 *
 * 反引号模板字符串原生支持多行分段，直接换行书写即可，无需转义或拼接；若
 * content 内含裸反引号（如 ``` 代码围栏），需转义为 \`。
 */
export interface WordCountTemplate {
  /** 条目显示名称。 */
  label: string;
  /** 默认文本，支持 {{char}} / {{user}} 变量与多行分段。留空表示无默认内容。 */
  content: string;
}

export type WordCountKey = "wordCount" | "languageConstraint";

export const wordCountTemplates: Record<WordCountKey, WordCountTemplate> = {
  wordCount: {
    label: "字数控制",
    content:
      "[Word Count Requirement]\n请确保每次回复的内容长度在1000至2000字左右，保持内容的丰富性和完整性。",
  },
  languageConstraint: {
    label: "语言约束",
    content:
      "[Language Requirement]\n正文内容只使用简体中文，不要使用其他语言。",
  },
};
