/**
 * 全站通用 markdown 渲染组件（2026-10-03 用户定稿的通用规范）。
 *
 * **任何**使用 markdown 渲染的 UI 一律沿用本组件，插件链与 prose 样式基底
 * 一处定义、处处生效，禁止各界面自带 `<Markdown>` 裸渲染或重复维护插件链。
 * （对话气泡 MessageItem 因引号高亮/插件文字装饰链等气泡专属渲染，已接入
 * `../lib/markdownPlugins.ts` 的同一插件链 SSOT，但保留自定义 components ——
 * 后续如有归一需要再合并。）
 *
 * 基底构成：
 *  · 插件链：`markdownRemarkPlugins` / `markdownRehypePlugins`（顺序契约见
 *    `../lib/markdownPlugins.ts` —— sanitize 必须在 rehypeKatex 之前）；
 *  · 样式：`prose prose-sm md:prose-base max-w-none dark:prose-invert` +
 *    `prose-a` 蓝色链接（typography 标准基底；pre 横向滚动、图片不破宽均为
 *    typography 自带行为，满足手机竖屏）；
 *  · 链接：默认一律新标签打开（不离开运行中的应用）。
 *
 * 扩展点（均为可选）：
 *  · `className` —— 追加 prose 修饰类（如 `prose-headings:tracking-tight`）；
 *  · `components` —— 附加/覆盖组件映射；与默认 `a` 合并，同名键以调用方为准。
 */
import * as React from "react";
import Markdown, { type Components } from "react-markdown";
import { markdownRemarkPlugins, markdownRehypePlugins } from "../lib/markdownPlugins";

export interface UnifiedMarkdownProps {
  children: string;
  className?: string;
  components?: Components;
}

export const UnifiedMarkdown: React.FC<UnifiedMarkdownProps> = ({
  children,
  className,
  components,
}) => (
  <div
    className={`prose prose-sm md:prose-base max-w-none dark:prose-invert prose-a:text-blue-600 dark:prose-a:text-blue-400 ${className ?? ""}`}
  >
    <Markdown
      remarkPlugins={markdownRemarkPlugins}
      rehypePlugins={markdownRehypePlugins}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
        ...components,
      }}
    >
      {children}
    </Markdown>
  </div>
);

export default UnifiedMarkdown;
