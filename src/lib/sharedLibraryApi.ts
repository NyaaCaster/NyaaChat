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

import { p256 } from "@noble/curves/nist.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils.js";
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

interface LegacyXorCardJson {
  alg: "Nyaa-XOR-BASE64-V1";
  key: string;
  iv: string;
  data: string;
  tag: string;
}
interface LegacyAesCardJson {
  alg: "AES-256-GCM";
  key: string;
  iv: string;
  data: string;
  tag: string;
}
interface WrappedAesCardJson {
  alg: "ECDH-P256-AES-GCM-V1";
  curve: "P-256";
  kdf: "HKDF-SHA256";
  serverPublicKey: string;
  salt: string;
  iv: string;
  data: string;
  tag: string;
}
interface WrappedHmacXorCardJson {
  alg: "P256-HKDF-HMAC-XOR-V1";
  curve: "P-256";
  kdf: "HKDF-SHA256";
  serverPublicKey: string;
  salt: string;
  data: string;
  tag: string;
}
type EncryptedCardJson = LegacyXorCardJson | LegacyAesCardJson | WrappedAesCardJson | WrappedHmacXorCardJson;
interface CardWrapContext {
  request: { alg: "P256-HKDF-HMAC-XOR-V1"; publicKey: string };
  privateKey: Uint8Array;
}
type WireAcquiredCard = Omit<AcquiredCard, "cardJson"> &
  ({ cardJson: string } | { encryptedCardJson: EncryptedCardJson });
interface AcquirePayload {
  ok: true;
  card: AcquiredCard;
  /** Updated buyer economy after a priced settlement (absent for anonymous free use). */
  profile?: { catfood: number; spentTotal: number };
}
interface WireAcquirePayload {
  ok: true;
  card: WireAcquiredCard;
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
interface WireCardPayload {
  ok: true;
  card: WireAcquiredCard;
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

function base64ToBytes(value: string): Uint8Array {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let raw = "";
  for (let i = 0; i < view.length; i += 1) raw += String.fromCharCode(view[i]);
  return btoa(raw);
}

const CARD_WRAP_INFO = utf8ToBytes("nyaachat-shared-card-hmac-xor-v1");
const CARD_KEY_INFO = utf8ToBytes("nyaachat-shared-card-v1");

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hmacStreamXor(input: Uint8Array, key: Uint8Array): Uint8Array {
  const output = new Uint8Array(input.length);
  let offset = 0;
  let counter = 0;
  while (offset < input.length) {
    const blockCounter = new Uint8Array(4);
    new DataView(blockCounter.buffer).setUint32(0, counter, false);
    const block = hmac(sha256, key, blockCounter);
    const n = Math.min(block.length, input.length - offset);
    for (let i = 0; i < n; i += 1) output[offset + i] = input[offset + i] ^ block[i];
    offset += n;
    counter += 1;
  }
  return output;
}

async function createCardWrapContext(): Promise<CardWrapContext | null> {
  if (!globalThis.crypto?.getRandomValues) return null;
  try {
    const keys = p256.keygen();
    const publicKey = p256.getPublicKey(keys.secretKey, false);
    return {
      request: { alg: "P256-HKDF-HMAC-XOR-V1", publicKey: bytesToBase64(publicKey) },
      privateKey: keys.secretKey,
    };
  } catch {
    return null;
  }
}

async function decryptWrappedAesCardJson(
  encrypted: WrappedAesCardJson,
  context: CardWrapContext | null,
): Promise<string> {
  if (!context || encrypted.curve !== "P-256" || encrypted.kdf !== "HKDF-SHA256") {
    throw new Error("missing_card_key_context");
  }
  if (!globalThis.crypto?.subtle) throw new Error("unsupported_card_encryption");
  const serverPublicKey = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(encrypted.serverPublicKey),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const clientPrivateKey = await crypto.subtle.importKey(
    "raw",
    context.privateKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: "ECDH", public: serverPublicKey },
    clientPrivateKey,
    256,
  );
  const hkdfKey = await crypto.subtle.importKey("raw", shared, "HKDF", false, ["deriveKey"]);
  const aesKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: base64ToBytes(encrypted.salt),
      info: CARD_KEY_INFO,
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  const data = base64ToBytes(encrypted.data);
  const tag = base64ToBytes(encrypted.tag);
  const sealed = new Uint8Array(data.length + tag.length);
  sealed.set(data, 0);
  sealed.set(tag, data.length);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encrypted.iv), tagLength: 128 },
    aesKey,
    sealed,
  );
  return new TextDecoder().decode(plain);
}

function decryptWrappedHmacXorCardJson(
  encrypted: WrappedHmacXorCardJson,
  context: CardWrapContext | null,
): string {
  if (!context || encrypted.curve !== "P-256" || encrypted.kdf !== "HKDF-SHA256") {
    throw new Error("missing_card_key_context");
  }
  const serverPublicKey = base64ToBytes(encrypted.serverPublicKey);
  const sharedPoint = p256.getSharedSecret(context.privateKey, serverPublicKey, false);
  const shared = sharedPoint.length === 65 && sharedPoint[0] === 0x04 ? sharedPoint.slice(1, 33) : sharedPoint;
  const salt = base64ToBytes(encrypted.salt);
  const material = hkdf(sha256, shared, salt, CARD_WRAP_INFO, 64);
  const encKey = material.slice(0, 32);
  const macKey = material.slice(32, 64);
  const data = base64ToBytes(encrypted.data);
  const expectedTag = hmac(sha256, macKey, concatBytes(salt, serverPublicKey, base64ToBytes(context.request.publicKey), data));
  if (!equalBytes(expectedTag, base64ToBytes(encrypted.tag))) throw new Error("bad_card_tag");
  return new TextDecoder().decode(hmacStreamXor(data, encKey));
}

async function decryptCardJson(
  encrypted: EncryptedCardJson,
  context: CardWrapContext | null = null,
): Promise<string> {
  if (encrypted.alg === "P256-HKDF-HMAC-XOR-V1") {
    return decryptWrappedHmacXorCardJson(encrypted, context);
  }
  if (encrypted.alg === "ECDH-P256-AES-GCM-V1") {
    return decryptWrappedAesCardJson(encrypted, context);
  }
  if (encrypted.alg === "Nyaa-XOR-BASE64-V1") {
    const data = base64ToBytes(encrypted.data);
    const key = base64ToBytes(encrypted.key);
    const plain = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 1) plain[i] = data[i] ^ key[i % key.length];
    return new TextDecoder().decode(plain);
  }
  if (encrypted.alg !== "AES-256-GCM" || !globalThis.crypto?.subtle) {
    throw new Error("unsupported_card_encryption");
  }
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(encrypted.key),
    "AES-GCM",
    false,
    ["decrypt"],
  );
  const data = base64ToBytes(encrypted.data);
  const tag = base64ToBytes(encrypted.tag);
  const sealed = new Uint8Array(data.length + tag.length);
  sealed.set(data, 0);
  sealed.set(tag, data.length);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(encrypted.iv), tagLength: 128 },
    key,
    sealed,
  );
  return new TextDecoder().decode(plain);
}

async function normalizeCard(
  card: WireAcquiredCard,
  context: CardWrapContext | null = null,
): Promise<AcquiredCard> {
  if ("cardJson" in card) return card;
  return {
    ...card,
    cardJson: await decryptCardJson(card.encryptedCardJson, context),
  };
}

async function normalizeAcquirePayload(
  payload: WireAcquirePayload,
  context: CardWrapContext | null = null,
): Promise<AcquirePayload> {
  return { ...payload, card: await normalizeCard(payload.card, context) };
}

async function normalizeCardPayload(
  payload: WireCardPayload,
  context: CardWrapContext | null = null,
): Promise<CardPayload> {
  return { ...payload, card: await normalizeCard(payload.card, context) };
}

function cardWrapUnavailable(): ApiResult<never> {
  return { kind: "error", ok: false, error: "card_key_unavailable", status: 0 };
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
export async function acquireCharacter(
  token: string | null,
  globalId: string,
  mode: "use" | "buyout",
): Promise<ApiResult<AcquirePayload>> {
  const cardWrap = await createCardWrapContext();
  if (!cardWrap) return cardWrapUnavailable();
  const result = await request<WireAcquirePayload>(`/characters/${globalId}/acquire`, {
    method: "POST",
    token: token || undefined,
    body: { mode, cardWrap: cardWrap.request },
  });
  if (result.kind !== "ok") return result;
  try {
    return { kind: "ok", ok: true, data: await normalizeAcquirePayload(result.data, cardWrap) };
  } catch {
    return { kind: "error", ok: false, error: "decrypt_failed", status: 0 };
  }
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
export async function fetchCharacterCard(globalId: string): Promise<ApiResult<CardPayload>> {
  const cardWrap = await createCardWrapContext();
  if (!cardWrap) return cardWrapUnavailable();
  const params = new URLSearchParams();
  params.set("cardWrapAlg", cardWrap.request.alg);
  params.set("cardPublicKey", cardWrap.request.publicKey);
  const qs = params.toString();
  const result = await request<WireCardPayload>(`/characters/${globalId}${qs ? `?${qs}` : ""}`);
  if (result.kind !== "ok") return result;
  try {
    return { kind: "ok", ok: true, data: await normalizeCardPayload(result.data, cardWrap) };
  } catch {
    return { kind: "error", ok: false, error: "decrypt_failed", status: 0 };
  }
}
