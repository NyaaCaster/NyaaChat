/**
 * Web search backend client.
 *
 * Posts to the same-origin `/api/search` endpoint, which both the dev vite
 * proxy and prod nginx forward to the SearXNG instance with `format=json`
 * already enabled. Returning a small `SearchResult[]` keeps the public
 * surface independent of SearXNG's full response shape.
 */

export interface SearchResult {
  /** Result URL — used in citations. */
  url: string;
  /** Page title. */
  title: string;
  /** Snippet / excerpt the engine returned. */
  content: string;
  /** Engine that produced the hit (e.g. "google", "wikipedia"). */
  engine: string;
}

/** Tunables. Hardcoded by design — phase 11 spec calls for no UI controls. */
const SEARCH_ENDPOINT = "/api/search";
const SEARCH_TIMEOUT_MS = 8_000;
const TOP_K = 5;

export class WebSearchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "WebSearchError";
    this.status = status;
  }
}

/**
 * Run a web search and return at most TOP_K results. Throws WebSearchError
 * on any failure (HTTP error, timeout, JSON parse failure, empty results).
 *
 * The caller decides whether to surface the failure to the user or silently
 * fall back to a no-context chat — see ChatInterface.sendChat for the
 * silent-degrade default.
 */
export async function searchWeb(
  query: string,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new WebSearchError("查询为空");
  }

  // Bound the search call independently from the chat call so a slow
  // search doesn't stall the whole pipeline. The user's outer AbortSignal
  // (Stop button) is forwarded into the same controller.
  const ac = new AbortController();
  let timedOut = false;
  const linkAbort = () => ac.abort();
  if (signal) {
    if (signal.aborted) ac.abort();
    else signal.addEventListener("abort", linkAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    ac.abort();
  }, SEARCH_TIMEOUT_MS);

  try {
    const body = new URLSearchParams({
      q: trimmed,
      format: "json",
    });

    const res = await fetch(SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
      signal: ac.signal,
      referrerPolicy: "no-referrer",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new WebSearchError(
        `搜索 API 返回 ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`,
        res.status,
      );
    }

    let data: any;
    try {
      data = await res.json();
    } catch (e: any) {
      throw new WebSearchError(`搜索响应不是 JSON: ${e?.message || String(e)}`);
    }

    const raw: any[] = Array.isArray(data?.results) ? data.results : [];
    const top: SearchResult[] = raw
      .slice(0, TOP_K)
      .map((r) => ({
        url: typeof r?.url === "string" ? r.url : "",
        title: typeof r?.title === "string" ? r.title : "",
        content: typeof r?.content === "string" ? r.content : "",
        engine: typeof r?.engine === "string" ? r.engine : "?",
      }))
      .filter((r) => r.url && (r.title || r.content));

    if (top.length === 0) {
      throw new WebSearchError("搜索结果为空");
    }
    return top;
  } catch (err: any) {
    if (err instanceof WebSearchError) throw err;
    if (err?.name === "AbortError") {
      throw new WebSearchError(
        timedOut
          ? `搜索超时:${Math.round(SEARCH_TIMEOUT_MS / 1000)}s 内未返回`
          : "搜索已取消",
      );
    }
    throw new WebSearchError(err?.message || String(err));
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", linkAbort);
  }
}
