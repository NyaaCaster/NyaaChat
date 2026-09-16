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
 * Split a message into normal Markdown runs and renderable front-end-card runs:
 * the fenced block becomes an iframe, while explanatory prose before/after it
 * stays visible in the chat bubble as ordinary Markdown.
 */
export function splitFrontendContent(content: string): FrontendContentPart[] | null {
  if (!content) return null;

  const parts: FrontendContentPart[] = [];
  const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let cardIndex = 0;

  while ((match = fenceRe.exec(content)) !== null) {
    // 围栏语言标签是**显式意图**：```html / ```htm 一律当卡片 —— 即便正文只是
    // `<div>` + `<style>` 片段。ST 卡片把状态栏/变量美化做成"正则 → ```html 片段"，
    // 这类片段不含 html>/<head>/<body 子串，早先的启发式会把它们**丢掉**，
    // 于是 <style> 里的 CSS 与裸 </div> 直接漏成气泡里的正文文本（真机复现）。
    const lang = (match[1] ?? "").toLowerCase();
    const body = match[2] ?? "";
    if (lang !== "html" && lang !== "htm" && !isFrontendHtml(body)) continue;

    if (match.index > lastIndex) {
      parts.push({ type: "markdown", content: content.slice(lastIndex, match.index) });
    }
    // Language tag is descriptive only: any fence whose body passes the card
    // test renders, so `html` / `htm` / `` / `vue` all behave the same here.
    parts.push({ type: "card", html: body, index: cardIndex++ });
    lastIndex = fenceRe.lastIndex;
  }

  if (cardIndex > 0) {
    if (lastIndex < content.length) {
      parts.push({ type: "markdown", content: content.slice(lastIndex) });
    }
    return parts;
  }

  // No fenced card; test the raw text (some cards come unfenced). In that case
  // the whole message is the card, so there is no non-rendered prose to preserve.
  if (isFrontendHtml(content)) return [{ type: "card", html: content, index: 0 }];
  return null;
}
