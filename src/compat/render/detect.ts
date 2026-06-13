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
  if (!content) return null;

  // Find fenced code blocks. Prefer an html-tagged block, else any block whose
  // body passes the frontend test.
  const fenceRe = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let firstRenderable: string | null = null;
  while ((match = fenceRe.exec(content)) !== null) {
    const lang = (match[1] || "").toLowerCase();
    const body = match[2] ?? "";
    if (!isFrontendHtml(body)) continue;
    if (lang === "html" || lang === "htm") return body;
    if (firstRenderable === null) firstRenderable = body;
  }
  if (firstRenderable !== null) return firstRenderable;

  // No fenced card; test the raw text (some cards come unfenced).
  if (isFrontendHtml(content)) return content;
  return null;
}
