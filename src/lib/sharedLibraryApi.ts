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

/** Full card handed out at acquisition (use / buyout) and read-only fetch.
 *  Carries card_json (which the browse listing withholds) PLUS the public
 *  metadata an author needs to pre-fill the share 界面 when publishing an update
 *  (owner / tags / prices). `owner` is the uploader account — the client uses it
 *  to decide whether the logged-in user may edit (owner === account). */
export interface AcquiredCard {
  globalId: string;
  owner: string;
  name: string;
  author: string;
  source: "original" | "reposted";
  intro: string;
  tags: string[];
  usePrice: number;
  buyoutPrice: number;
  cardJson: string;
  updatedAt: number;
}
interface AcquirePayload {
  ok: true;
  card: AcquiredCard;
  /** Updated buyer economy after a priced settlement (absent for anonymous free use). */
  profile?: { catfood: number; spentTotal: number };
}
interface RatingPayload {
  ok: true;
  likes: number;
  dislikes: number;
  myValue: number; // 1 | -1 | 0
}
interface MyRatingsPayload {
  ok: true;
  ratings: Record<string, number>; // globalId -> 1 | -1
}
/** Server version info for one held card, from POST /characters/versions. */
export interface VersionInfo {
  updatedAt: number;
  owner: string;
}
interface VersionsPayload {
  ok: true;
  /** globalId -> { updatedAt, owner }. A held card ABSENT from this map has been
   *  deleted from the library. */
  versions: Record<string, VersionInfo>;
}
interface CardPayload {
  ok: true;
  card: AcquiredCard;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.token) headers["Authorization"] = `Bearer ${options.token}`;

    const res = await fetch(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

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

/** Fetch a shared character's cover as a Blob, to stash in local IndexedDB for
 *  an acquired card. Returns null on any failure (the card still works coverless). */
export async function fetchCoverBlob(globalId: string): Promise<Blob | null> {
  try {
    const res = await fetch(coverUrl(globalId));
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

/** Acquire a shared character (use / buyout). Returns the full card json plus,
 *  for a priced settlement, the buyer's updated economy. `token` may be omitted
 *  for free use (anonymous-friendly per the design). */
export function acquireCharacter(
  token: string | null,
  globalId: string,
  mode: "use" | "buyout",
): Promise<ApiResult<AcquirePayload>> {
  return request<AcquirePayload>(`/characters/${globalId}/acquire`, {
    method: "POST",
    token: token || undefined,
    body: { mode },
  });
}

/** Set / clear this account's rating on a character. value: 1=like, -1=dislike,
 *  0=clear. Returns the recomputed totals + the active value. */
export function rateCharacter(
  token: string,
  globalId: string,
  value: 1 | -1 | 0,
): Promise<ApiResult<RatingPayload>> {
  return request<RatingPayload>(`/characters/${globalId}/rating`, {
    method: "POST",
    token,
    body: { value },
  });
}

/** This account's { globalId: value } rating map, for rendering active states. */
export function fetchMyRatings(token: string): Promise<ApiResult<MyRatingsPayload>> {
  return request<MyRatingsPayload>("/characters/mine/ratings", { token });
}

/** Batch update-check for locally-held shared cards (phase 5). Returns the
 *  server updated_at for each id that still exists; an id absent from the result
 *  has been deleted from the library. One round-trip for the whole held list. */
export function fetchVersions(ids: string[]): Promise<ApiResult<VersionsPayload>> {
  return request<VersionsPayload>("/characters/versions", {
    method: "POST",
    body: { ids },
  });
}

/** Read-only fetch of a shared card's latest full json (phase 5 更新). Does NOT
 *  bump downloads or settle anything. A 404 (kind:"error", status:404) means the
 *  card was deleted from the library and can no longer be updated. */
export function fetchCharacterCard(globalId: string): Promise<ApiResult<CardPayload>> {
  return request<CardPayload>(`/characters/${globalId}`);
}
