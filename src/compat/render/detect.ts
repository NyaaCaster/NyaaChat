// Front-end card detection.
//
// JS-Slash-Runner decides a message contains a renderable "front-end card" with
// a deliberately loose substring test (SSOT §2.4, .ref/.../util/is_frontend.ts):
// if the text contains `html>`, `<head>`, or `<body`, it's treated as a card.
// We mirror that exactly so the same cards that render in ST render here.
//
// In NyaaChat the card markup arrives as a fenced ```html code block in the
// assistant message. We extract the code block body and test it; if there's no
// fenced block we fall back to testing the raw text (covers cards emitted
// without fences).

const FRONTEND_TAGS = ["html>", "<head>", "<body"];

export type FrontendContentPart =
  | { type: "markdown"; content: string }
  | { type: "card"; html: string; index: number };

/** Loose substring test matching ST's isFrontend. */
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
 * Split a message into normal Markdown runs and renderable front-end-card runs.
 * This mirrors JSR's behavior more closely than replacing the whole bubble: the
 * code block becomes the iframe, while explanatory prose before/after it stays
 * visible in the chat bubble.
 */
export function splitFrontendContent(content: string): FrontendContentPart[] | null {
  if (!content) return null;

  const parts: FrontendContentPart[] = [];
  const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let lastIndex = 0;
  let cardIndex = 0;

  while ((match = fenceRe.exec(content)) !== null) {
    const lang = (match[1] || "").toLowerCase();
    const body = match[2] ?? "";
    if (!isFrontendHtml(body)) continue;

    if (match.index > lastIndex) {
      parts.push({ type: "markdown", content: content.slice(lastIndex, match.index) });
    }
    // JSR renders any <pre> whose text passes isFrontend; NyaaChat gives
    // html/htm fences priority but also accepts generic renderable fences.
    if (lang === "html" || lang === "htm" || lang === "") {
      parts.push({ type: "card", html: body, index: cardIndex++ });
    } else {
      parts.push({ type: "card", html: body, index: cardIndex++ });
    }
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
