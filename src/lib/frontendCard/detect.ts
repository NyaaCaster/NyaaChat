// 前端卡（front-end card）识别。
//
// 判定刻意宽松：只要正文里出现 `html>`、`<head>`、`<body` 这三个子串之一，就认为
// 这段文本是一张可渲染的前端卡。宽松是有意的 —— 模型吐出的卡片经常没有完整的
// <html>/<head> 包壳，严格解析会漏掉大量本来能渲染的卡。
//
// 在 NyaaChat 里卡片标记以 ```html 围栏代码块的形式出现在助手消息中。我们取出
// 代码块正文判定；没有围栏时退回到对整段原文判定（覆盖不带围栏的卡片）。

const FRONTEND_TAGS = ["html>", "<head>", "<body"];

export type FrontendContentPart =
  | { type: "markdown"; content: string }
  | { type: "card"; html: string; index: number };

/** Loose substring test for "this text is a renderable front-end card". */
export function isFrontendHtml(content: string): boolean {
  if (!content) return false;
  return FRONTEND_TAGS.some((tag) => content.includes(tag));
}

/**
 * Extract the HTML to render from a message. Prefers the contents of a fenced
 * ```html (or generic ```) block; falls back to the whole text. Returns null
 * when nothing in the message looks like a front-end card.
 */
export function extractFrontendHtml(content: string): string | null {
  const parts = splitFrontendContent(content);
  const firstCard = parts?.find((part) => part.type === "card");
  return firstCard?.type === "card" ? firstCard.html : null;
}

/**
 * A fence delimiter line: optional indent, exactly three backticks, an optional
 * language tag, then nothing but whitespace (CRLF tolerated). Mirrors GFM's
 * "closing fence may not carry an info string", which is what keeps a
 * fence-looking line *inside* a card body from being mistaken for a close.
 */
const FENCE_LINE = /^[ \t]*```[ \t]*([a-zA-Z0-9_-]*)[ \t]*\r?$/;

/**
 * Split a message into normal Markdown runs and renderable front-end-card runs:
 * the fenced block becomes an iframe, while explanatory prose before/after it
 * stays visible in the chat bubble as ordinary Markdown.
 *
 * 为什么按**行**扫描而不是一个正则配对开关闭围栏（真机 v12-2135 实测的回归）：
 * 模型会在同一条消息里先给一个**裸 ``` 围栏**（装着 CSS 片段），再给卡片围栏：
 *
 *     正文… \n ``` \n .neko-complete… \n ``` \n \n ```html \n <!DOCTYPE html> …
 *
 * "```…``` " 这种惰性匹配会把这第一段裸围栏当成候选**卡片**，于是它与紧随其后的
 * ```html 配成一对 —— 真正的卡片开围栏被当成 CSS 代码块的收尾，整条消息一张卡都切不出来
 * （诊断里表现为 `types: null`，正文、CSS 与卡片 HTML 一起漏成气泡里的纯文本）。
 * 按行扫描后，围栏的开关与配对只由「这一行是不是纯围栏行」决定，CSS 代码块与卡片
 * 各归各位。
 *
 * 另外两条既有语义保持不变：
 *  · 语言标签是**显式意图**：```html / ```htm 一律当卡片，即便正文只是 `<div>`+`<style>`
 *    片段（ST 卡片的状态栏/变量美化就是这种片段，且不含 html>/<head>/<body 子串）；
 *  · 卡片围栏**未闭合**时按"一直到消息末尾"处理 —— 对应原来"整段无围栏就当卡片"的兜底，
 *    否则模型漏掉收尾围栏那一下，状态栏就会整块漏成正文（真机反复出现）。
 */
export function splitFrontendContent(content: string): FrontendContentPart[] | null {
  if (!content) return null;

  // No fence at all: only then may the whole raw text be one card. This keeps
  // "prose that merely mentions ```" from being swallowed into one iframe.
  if (!content.includes("```")) {
    return isFrontendHtml(content) ? [{ type: "card", html: content, index: 0 }] : null;
  }

  const lines = content.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  /** Index just past the closing fence itself (no trailing newline). */
  const fenceEnd = (lineIndex: number): number =>
    lineStarts[lineIndex] + lines[lineIndex].replace(/\r$/, "").length;

  const parts: FrontendContentPart[] = [];
  let cardIndex = 0;
  let markdownFrom = 0;
  let open: { start: number; isCard: boolean; body: string } | null = null;

  for (let i = 0; i < lines.length; i++) {
    if (open) {
      if (!FENCE_LINE.test(lines[i])) continue;
      if (open.isCard) {
        if (open.start > markdownFrom) {
          parts.push({ type: "markdown", content: content.slice(markdownFrom, open.start) });
        }
        parts.push({ type: "card", html: open.body, index: cardIndex++ });
        markdownFrom = Math.min(fenceEnd(i), content.length);
      }
      open = null;
      continue;
    }

    const opening = FENCE_LINE.exec(lines[i]);
    if (!opening) continue;

    // 先找收尾围栏，才知道 body 长什么样（决定裸围栏算不算卡片）。
    let close = i + 1;
    while (close < lines.length && !FENCE_LINE.test(lines[close])) close++;
    const terminated = close < lines.length;
    const bodyStart = lineStarts[i] + lines[i].length + 1;
    const bodyEnd = terminated ? lineStarts[close] : content.length;
    const body = content.slice(bodyStart, Math.max(bodyStart, bodyEnd));
    const lang = (opening[1] ?? "").toLowerCase();
    const isCard = lang === "html" || lang === "htm" || isFrontendHtml(body);

    if (!terminated) {
      // 未闭合：只有卡片围栏才按"到末尾"处理；未闭合的普通代码块保持原样（不切）。
      if (!isCard) continue;
      if (lineStarts[i] > markdownFrom) {
        parts.push({ type: "markdown", content: content.slice(markdownFrom, lineStarts[i]) });
      }
      parts.push({ type: "card", html: body, index: cardIndex++ });
      markdownFrom = content.length;
      continue;
    }

    open = { start: lineStarts[i], isCard, body };
  }

  if (parts.length === 0) return null;
  if (markdownFrom < content.length) {
    const rest = content.slice(markdownFrom);
    if (rest.trim()) parts.push({ type: "markdown", content: rest });
  }
  return parts;
}
