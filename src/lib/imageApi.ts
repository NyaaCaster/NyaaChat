import { ImageApiSettings } from "../types";

/**
 * QinyAPI image generation. The provider exposes the chat-completions URL
 * for image gen too; the request body takes `prompt`, `model`, and
 * (optionally) `size` — different from the standard `messages` chat schema.
 *
 * `size` is only meaningful for models that explicitly support it (e.g.
 * gpt-image-2 supports 3840x2160). For other models the provider is expected
 * to ignore the parameter. We pass it through unconditionally when the user
 * picked "4k" so the supplier-side gating is the single source of truth.
 */
const QINY_IMAGE_URL_DEFAULT = "https://openai.chatnewai.com/v1/chat/completions";

// 120s is the supplier's rough upper bound for normal-length prompts. With
// the bounded prompt enforced in chatPipeline.buildImagePrompt, runs should
// land under 30s — this timer mainly catches stuck connections, not slow
// image rendering. Long prompts that previously hit Cloudflare's 524 are
// prevented at the prompt layer rather than with a longer client timeout.
const REQUEST_TIMEOUT_MS = 120_000;

export class ImageApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ImageApiError";
    this.status = status;
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController();
  let timedOut = false;
  const linkAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", linkAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (err: any) {
    if (err?.name === "AbortError" && timedOut) {
      throw new ImageApiError(`请求超时:${Math.round(REQUEST_TIMEOUT_MS / 1000)} 秒内未收到响应`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", linkAbort);
  }
}

/**
 * Pull the first image URL out of an image-gen response.
 *
 * Different supplier channels return wildly different shapes — gpt-image-2 vs
 * grok-imagine-image vs OpenAI Images API vs DALL·E proxies all use different
 * fields. We deep-walk the parsed JSON looking for any of:
 *   - `b64_json` strings (OpenAI Images base64 mode)
 *   - `url` / `image_url` / `image` / `src` / `output` / `output_url` / `result`
 *     fields holding an https/data URL or a markdown image link
 *   - chat-completion `content` strings carrying a markdown `![alt](url)`,
 *     a `[label](url)` link, a bare data URL, or an https URL with an image
 *     extension
 *   - chat-completion `content` parts arrays with `image_url` parts
 *
 * Fields with image-related names are tried first so we don't accidentally
 * pick up an unrelated URL embedded in metadata or error text.
 */
function extractImageUrl(payload: any): string | null {
  if (payload == null) return null;
  return deepFindImageUrl(payload, 0);
}

const IMAGE_FIELD_HINTS = new Set([
  "url",
  "image_url",
  "image",
  "images",
  "src",
  "output",
  "output_url",
  "result",
  "data",
  "content",
  "message",
  "choices",
  "delta",
]);

function deepFindImageUrl(node: any, depth: number): string | null {
  if (depth > 12 || node == null) return null;

  if (typeof node === "string") return extractFromString(node);

  if (Array.isArray(node)) {
    for (const item of node) {
      const r = deepFindImageUrl(item, depth + 1);
      if (r) return r;
    }
    return null;
  }

  if (typeof node !== "object") return null;

  // OpenAI Images base64 shortcut.
  if (typeof node.b64_json === "string" && node.b64_json) {
    return `data:image/png;base64,${node.b64_json}`;
  }

  // OpenAI parts-array `image_url` part.
  if (node.type === "image_url" && node.image_url) {
    const v =
      typeof node.image_url === "string"
        ? node.image_url
        : typeof node.image_url.url === "string"
          ? node.image_url.url
          : null;
    if (v) {
      const norm = normalizeImageString(v);
      if (norm) return norm;
    }
  }
  if (node.type === "image" && typeof node.url === "string") {
    const norm = normalizeImageString(node.url);
    if (norm) return norm;
  }

  // Direct string fields commonly used by image endpoints.
  for (const key of ["url", "image", "image_url", "src", "output", "output_url", "result"]) {
    const v = node[key];
    if (typeof v === "string") {
      const norm = normalizeImageString(v);
      if (norm) return norm;
    }
  }

  // Recurse into hint-named fields first to bias toward the actual image
  // payload over any URL accidentally present in unrelated metadata.
  const keys = Object.keys(node);
  for (const key of keys) {
    if (!IMAGE_FIELD_HINTS.has(key.toLowerCase())) continue;
    const r = deepFindImageUrl(node[key], depth + 1);
    if (r) return r;
  }
  for (const key of keys) {
    if (IMAGE_FIELD_HINTS.has(key.toLowerCase())) continue;
    const r = deepFindImageUrl(node[key], depth + 1);
    if (r) return r;
  }
  return null;
}

function normalizeImageString(s: string): string | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data:image/")) return trimmed;
  if (/^https?:\/\/\S+$/.test(trimmed)) return trimmed;
  return extractFromString(trimmed);
}

function extractFromString(s: string): string | null {
  // Markdown image: ![alt](url)
  const md = /!\[[^\]]*\]\(\s*([^)\s]+)\s*\)/.exec(s);
  if (md) {
    const u = md[1];
    if (u.startsWith("data:image/") || /^https?:\/\//.test(u)) return u;
  }
  // Plain markdown link: [label](url) — often used when the model wraps the
  // image as a download link instead of an inline image.
  const linkMd = /\[[^\]]*\]\(\s*(https?:\/\/[^)\s]+)\s*\)/.exec(s);
  if (linkMd) return linkMd[1];
  // Inline data URL.
  const dataUrl = /(data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+)/.exec(s);
  if (dataUrl) return dataUrl[1];
  // https URL ending in a known image extension (with optional query string).
  const urlWithExt = /(https?:\/\/[^\s)>"']+\.(?:png|jpe?g|webp|gif|bmp|svg|heic|avif)(?:\?[^\s)>"']*)?)/i.exec(s);
  if (urlWithExt) return urlWithExt[1];
  // Bare https URL — last resort. Image-gen endpoints often return signed
  // CDN URLs with no file extension, so accept any http(s) string when no
  // more specific pattern matched. False positives are unlikely because the
  // caller only invokes this on responses that just succeeded for an image
  // generation request.
  const bareUrl = /https?:\/\/[^\s)>"',]+/.exec(s);
  if (bareUrl) return bareUrl[0];
  return null;
}

/**
 * Generate an image for `prompt` using the configured QinyAPI endpoint.
 * Returns an absolute URL (https://) or a data: URL the UI can render
 * directly via <img src=...>.
 *
 * Size handling: 4K (3840x2160) is only supported on certain gpt-image-2
 * channels — other channels and other models reject it with 4xx/5xx. We
 * try the user's choice first, and on a server-side rejection fall back to
 * a per-model strategy:
 *   - gpt-image-2 → retry with size=2048x2048 (still a supported size)
 *   - any other model → retry with no size field (let the model pick)
 * Auth errors, rate-limits, network failures and aborts skip the fallback
 * since switching the size won't help.
 */
export async function generateImage(
  prompt: string,
  imageApi: ImageApiSettings,
  signal?: AbortSignal,
): Promise<string> {
  if (imageApi.provider !== "qiny") {
    throw new ImageApiError("当前 API 来源暂不支持");
  }
  if (!imageApi.apiKey) throw new ImageApiError("缺少图片 API Key");
  if (!imageApi.model) throw new ImageApiError("请先选择生图模型");
  if (!prompt.trim()) throw new ImageApiError("提示词为空");

  const isGptImage2 = /gpt-image-2/i.test(imageApi.model);

  // Sequence of `size` values to try. `undefined` means "omit the field".
  // Rule: 默认 always omits `size`. 4K sends "3840x2160" first; on rejection
  // gpt-image-2 falls back to its alternate "2048x2048", other models drop
  // the field entirely.
  const attempts: Array<string | undefined> =
    imageApi.size === "4k"
      ? ["3840x2160", isGptImage2 ? "2048x2048" : undefined]
      : [undefined];

  let lastError: any;
  for (let i = 0; i < attempts.length; i++) {
    if (signal?.aborted) throw new ImageApiError("请求已取消");
    try {
      return await performImageRequest(prompt, imageApi, attempts[i], signal);
    } catch (err: any) {
      lastError = err;
      if (err?.name === "AbortError") throw err;
      // Auth / rate-limit / network — fallback won't help.
      const status = err instanceof ImageApiError ? err.status : undefined;
      if (status == null) throw err;
      if (status === 401 || status === 403 || status === 429) throw err;
      const isLast = i === attempts.length - 1;
      if (isLast) throw err;
      // Else: fall through to next attempt with the prescribed fallback size.
      console.warn(
        `[imageApi] size=${attempts[i] ?? "(omitted)"} rejected (${status}); ` +
          `retrying with size=${attempts[i + 1] ?? "(omitted)"}`,
      );
    }
  }
  throw lastError ?? new ImageApiError("生图请求失败");
}

async function performImageRequest(
  prompt: string,
  imageApi: ImageApiSettings,
  sizeValue: string | undefined,
  signal?: AbortSignal,
): Promise<string> {
  const body: Record<string, any> = {
    model: imageApi.model,
    // The endpoint is chat-completions compatible and rejects bare `prompt`
    // with `field messages is required`. We send the prompt as a single user
    // message; the supplier still keys image generation off this content.
    messages: [{ role: "user", content: prompt }],
  };
  if (sizeValue) body.size = sizeValue;

  // The endpoint is taken from the caller's settings when present (v2 multi-
  // provider path) and falls back to the original hardcoded QinyAPI URL so
  // legacy v1 callers — which never set baseUrl — keep working unchanged.
  const endpoint = imageApi.baseUrl?.trim() || QINY_IMAGE_URL_DEFAULT;

  const response = await fetchWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${imageApi.apiKey}`,
      },
      body: JSON.stringify(body),
      referrerPolicy: "no-referrer",
    },
    signal,
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ImageApiError(
      `生图接口返回 ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      response.status,
    );
  }

  // Read as text first so we can fall back to string extraction when the
  // body isn't valid JSON. Some channels return SSE streams ("data: {...}"),
  // plain markdown ("![](https://...)"), or proxy HTML pages — all of which
  // would make response.json() throw and leave us with `null`.
  const rawText = await response.text().catch(() => "");

  let parsed: any = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      // SSE-style: pull the last `data: {...}` JSON line and try again.
      const sseLines = rawText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .filter((l) => l && l !== "[DONE]");
      for (const line of sseLines.reverse()) {
        try {
          const candidate = JSON.parse(line);
          // Prefer the first SSE chunk that yields a URL — fall back to the
          // newest otherwise so deepFindImageUrl can still walk it.
          if (extractImageUrl(candidate)) {
            parsed = candidate;
            break;
          }
          if (parsed == null) parsed = candidate;
        } catch {
          /* ignore malformed line */
        }
      }
    }
  }

  // Try parsed JSON first, then the raw text body — the latter handles plain
  // markdown / direct URL responses that don't wrap the URL in JSON at all.
  const url = extractImageUrl(parsed) ?? extractImageUrl(rawText);
  if (!url) {
    const snippet = (rawText || "").slice(0, 300);
    console.warn("[imageApi] Could not find image URL in response:", { parsed, rawText });
    throw new ImageApiError(
      `响应中未找到图片地址${snippet ? `: ${snippet}` : "（响应为空）"}`,
    );
  }
  return toProxiedImageUrl(url);
}

/**
 * Route the upstream image URL through our same-origin nginx cache proxy.
 *
 * - Browsers in regions where the upstream blob/CDN is blocked (e.g. mainland
 *   China users hitting an OpenAI Azure blob URL) get a working URL.
 * - Once nginx caches the bytes, the image survives the upstream signed
 *   URL expiring — historical chats don't go blank weeks later.
 * - data: URLs are already self-contained, leave them alone.
 * - Non-https (e.g. local dev / Ollama) are left alone — wrapping wouldn't
 *   help and the host whitelist would 403 anyway.
 */
/**
 * Route the upstream image URL through our same-origin nginx cache proxy.
 *
 * Path-encoded form: /api/image-proxy/<scheme>/<host>/<path>?<query>
 *
 * - Browsers in regions where the upstream blob/CDN is blocked (e.g. mainland
 *   China users hitting an OpenAI Azure blob URL) get a working URL.
 * - Once nginx caches the bytes, the image survives the upstream signed
 *   URL expiring — historical chats don't go blank weeks later.
 * - Same-origin requests sidestep CORS, which means downloadImage's fetch
 *   path always succeeds and we never fall back to opening a new tab.
 * - data: URLs are already self-contained, leave them alone.
 * - Non-https/http URLs (e.g. malformed) are left alone — the host whitelist
 *   would 403 anyway.
 *
 * We split the upstream URL into scheme/host/path/query parts because nginx's
 * `$arg_url` query variable is not URL-decoded automatically, which makes a
 * single ?url=... parameter unworkable for both the regex whitelist check
 * and the variable-driven proxy_pass. Splitting into path segments lets
 * nginx see each component as plain (un-encoded) text.
 */
export function toProxiedImageUrl(rawUrl: string): string {
  if (!rawUrl) return rawUrl;
  if (rawUrl.startsWith("data:")) return rawUrl;
  if (rawUrl.startsWith("/api/image-proxy/")) return rawUrl;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return rawUrl;
  const scheme = parsed.protocol.slice(0, -1);
  return `/api/image-proxy/${scheme}/${parsed.host}${parsed.pathname}${parsed.search}`;
}

/**
 * Trigger a real "save as" download for an image URL.
 *
 * Strategy:
 *   1. data: URLs use `<a download>` — always works.
 *   2. Any other URL is first routed through our same-origin image proxy
 *      (`toProxiedImageUrl`). After that, fetch is same-origin so it cannot
 *      hit CORS, and the blob+`<a download>` path produces a real "save as"
 *      dialog with the filename WE choose. This makes downloads consistent
 *      across providers (chatgpt-topup, qiny, codexai, OpenAI blob, …)
 *      regardless of whether the upstream sets ACAO.
 *   3. If even the proxy fetch fails (offline / cache miss + upstream down),
 *      we fall back to `window.open` so the user at least has a chance to
 *      see/save the image manually — but with the proxy in place this
 *      branch is essentially unreachable.
 */
export async function downloadImage(url: string, filename = "image"): Promise<void> {
  if (url.startsWith("data:")) {
    if (!/\.[a-z0-9]+$/i.test(filename)) {
      filename = `${filename}.${guessExtFromMime(url) || "png"}`;
    }
    triggerDownloadLink(url, filename);
    return;
  }

  // Force same-origin: legacy chat history may still contain raw upstream
  // URLs from images generated before the proxy was deployed. Re-wrapping
  // through the proxy makes fetch reliable for those too.
  const fetchUrl = toProxiedImageUrl(url);

  try {
    const res = await fetch(fetchUrl, { referrerPolicy: "no-referrer" });
    if (res.ok) {
      const blob = await res.blob();
      if (!/\.[a-z0-9]+$/i.test(filename)) {
        const ext = guessExtFromMime(blob.type) || guessExtFromUrl(url) || "png";
        filename = `${filename}.${ext}`;
      }
      const objectUrl = URL.createObjectURL(blob);
      try {
        triggerDownloadLink(objectUrl, filename);
      } finally {
        // Defer revoke a beat so the browser has time to start the download.
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      }
      return;
    }
  } catch {
    /* fall through to new-tab fallback */
  }

  // Cross-origin without CORS: forcing a download would require a same-origin
  // proxy. Best we can do is preserve the current page by opening in a new
  // tab. Pop-up blockers usually allow this since it's a direct user click.
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) {
    // Pop-up blocked — last-resort fallback that still avoids a same-tab
    // navigation. `target=_blank` + `rel=noopener` makes the link open in a
    // new tab even when `download` is ignored.
    triggerDownloadLink(url, filename, true);
  }
}

function triggerDownloadLink(href: string, filename: string, newTab = false) {
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  a.rel = "noopener noreferrer";
  if (newTab) a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function guessExtFromMime(mime: string): string | null {
  const m = /image\/([a-z0-9.+-]+)/i.exec(mime);
  if (!m) return null;
  const sub = m[1].toLowerCase();
  if (sub === "jpeg") return "jpg";
  if (sub === "svg+xml") return "svg";
  return sub;
}

function guessExtFromUrl(url: string): string | null {
  const m = /\.([a-zA-Z0-9]+)(?:\?|#|$)/.exec(url);
  return m ? m[1].toLowerCase() : null;
}
