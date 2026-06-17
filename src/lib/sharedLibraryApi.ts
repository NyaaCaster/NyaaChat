// Client for browsing the shared-character library (phase 3).
//
// Read-only sibling to sharedAccountApi.ts / sharedCharacterApi.ts: same
// separately-deployed nyaachat-shared service, reached same-origin through the
// main nginx at /api/shared/*. These endpoints are public (no auth) — anyone
// can browse the library; using / buying out a card (which needs a session) is
// a later phase. Kept in its own module so the already-verified account and
// publish clients stay untouched.
//
// Note: the listing intentionally does NOT carry card_json (the full character
// design). Browsing only needs the summary; the cover is fetched lazily by URL.

import { type ApiResult } from "./sharedAccountApi";

const BASE = "/api/shared";
const REQUEST_TIMEOUT_MS = 12_000;

/** Summary of one shared character, as returned by GET /characters. */
export interface SharedCharacterSummary {
  globalId: string;
  owner: string;
  author: string;
  name: string;
  source: "original" | "reposted";
  intro: string;
  tags: string[];
  usePrice: number;
  buyoutPrice: number;
  downloads: number;
  likes: number;
  dislikes: number;
  createdAt: number; // unix ms
  updatedAt: number; // unix ms
}

export type LibrarySort = "updated" | "downloads" | "likes" | "dislikes";
export type LibraryOrder = "desc" | "asc";

export interface LibraryQuery {
  q?: string;
  tag?: string;
  author?: string;
  sort?: LibrarySort;
  order?: LibraryOrder;
}

interface ListPayload {
  ok: true;
  characters: SharedCharacterSummary[];
}
interface TagsPayload {
  ok: true;
  tags: string[];
}

async function request<T>(path: string): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: controller.signal });

    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    // A 502/503/504 with no JSON ok means nginx couldn't reach the backend —
    // surface as a network error so the UI can say 服务器无法连接 rather than a
    // generic failure (matches the account/publish clients' error model).
    if ((res.status === 502 || res.status === 503 || res.status === 504) && !payload?.ok) {
      return { kind: "network", ok: false };
    }
    if (!res.ok || !payload?.ok) {
      return {
        kind: "error",
        ok: false,
        error: String(payload?.error ?? `http_${res.status}`),
        status: res.status,
      };
    }
    return { kind: "ok", ok: true, data: payload as T };
  } catch {
    return { kind: "network", ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch the (filtered, sorted) library listing. */
export function fetchLibrary(query: LibraryQuery = {}): Promise<ApiResult<ListPayload>> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.tag) params.set("tag", query.tag);
  if (query.author) params.set("author", query.author);
  if (query.sort) params.set("sort", query.sort);
  if (query.order) params.set("order", query.order);
  const qs = params.toString();
  return request<ListPayload>(`/characters${qs ? `?${qs}` : ""}`);
}

/** Fetch the distinct tag list across the whole library. */
export function fetchTags(): Promise<ApiResult<TagsPayload>> {
  return request<TagsPayload>("/characters/tags");
}

/** Same-origin URL of a shared character's cover (served json-free by the backend). */
export function coverUrl(globalId: string): string {
  return `${BASE}/covers/${globalId}`;
}
