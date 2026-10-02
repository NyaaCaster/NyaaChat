/**
 * NyaaChat 全站统一的 markdown 渲染插件链（SSOT）。
 *
 * 三个渲染点共用同一份常量：对话气泡（`MessageItem.tsx`）、版本公告
 * （`VersionModal.tsx`）、ComfyUI 工作流配置文档（`ComfyWorkflowInfoModal.tsx`）。
 * 此前两个文档弹窗是**裸 `<Markdown>`**（无任何 remark/rehype 插件）：表格、
 * 任务列表、删除线、自动链接这些 GFM 语法一旦出现就会静默渲染错。2026-10-03
 * 用户拍板：文档界面同样要支持（"用户有可能会使用到"；表格样式此前已补全在
 * `index.css` 的 `.markdown-body` 段）。文档内容是仓库内受信文本，与本插件链
 * 一起走 sanitize 白名单兜底即可。
 *
 * ## 顺序契约（不可调换，均有出处）
 *
 *  · **remark**：`gfm`（GFM 扩展：表格/任务列表/删除线/自动链接/脚注）→
 *    `math`（`$..$` / `$$..$$` 识别成数学节点）；
 *  · **rehype**：`raw`（markdown 内嵌的原始 HTML 解析成节点，供 sanitize 统一
 *    清洗）→ `sanitize`（**清洗不可信输入**：GitHub defaultSchema + 全元素放行
 *    className，保持气泡既有口径）→ `katex`（数学公式展开）。
 *
 *  ⚠️ **rehypeSanitize 必须在 rehypeKatex 之前**（rehype-katex 官方 README 的
 *  指引）：KaTeX 输出强依赖内联 style（`.vlist` 的 top 垂直偏移、`.frac-line`
 *  宽度等），sanitize 排在其后会把这些 style 全部剥掉 ⇒ 分式横线消失、上下标
 *  叠回基线（2026-10-03 线上实测、探针复现 style 11→0，属真实缺陷）。
 *  KaTeX 是受控渲染库（trust 默认关闭、公式文本已过 sanitize），其输出不再清洗。
 */
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";

/** rehype-sanitize schema：GitHub-flavored default + className passthrough，让
 *  prose/markdown-body 既有样式类仍然生效。白名单外的一切（script、iframe、
 *  on* 事件属性、javascript: URL）都被丢弃。 */
export const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] || []), "className"],
  },
};

/** remark 层插件（三处渲染点统一）。 */
export const markdownRemarkPlugins: PluggableList = [remarkGfm, remarkMath];

/** rehype 层插件（三处渲染点统一；顺序契约见文件头）。 */
export const markdownRehypePlugins: PluggableList = [
  rehypeRaw,
  [rehypeSanitize, sanitizeSchema],
  rehypeKatex,
];
