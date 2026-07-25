// Client for the shared-character publish backend (phase 2).
//
// Sibling to sharedAccountApi.ts: same separately-deployed nyaachat-shared
// service, reached same-origin through the main nginx at /api/shared/*, same
// Bearer-token auth and the same discriminated ApiResult error model (so the
// share UI can tell "server said no" from "couldn't reach the server"). Kept in
// its own module so the already-verified account client stays untouched.

import { type ApiResult } from "./sharedAccountApi";

const BASE = "/api/shared";
const REQUEST_TIMEOUT_MS = 30_000; // cover upload is larger than an account call

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

export interface SharePayload {
  source: "original" | "reposted";
  intro: string;
  tags: string[];
  /** ST-format character card serialized as a STRING. */
  cardJson: string;
  /** Re-encoded pure-WebP cover, base64 (no data: prefix). */
  coverBase64: string;
}

interface SharePublishResult {
  ok: true;
  globalId: string;
}

interface UpdatePublishResult {
  ok: true;
  globalId: string;
  updatedAt: number;
}

interface DeleteResult {
  ok: true;
  globalId: string;
}

/** Publish a private character to the shared library. */
export function shareCharacter(
  token: string,
  payload: SharePayload,
): Promise<ApiResult<SharePublishResult>> {
  return request<SharePublishResult>("/characters", {
    method: "POST",
    token,
    body: payload,
  });
}

/** Publish an update to an existing shared card (phase 5b). Owner-only on the
 *  server (403 forbidden otherwise). Same body as a fresh publish; bumps the
 *  card's updated_at so holders see the update badge next time. */
export function publishUpdate(
  token: string,
  globalId: string,
  payload: SharePayload,
): Promise<ApiResult<UpdatePublishResult>> {
  return request<UpdatePublishResult>(`/characters/${globalId}`, {
    method: "PUT",
    token,
    body: payload,
  });
}

/** Delete a shared card from the library (phase 5b). Owner-only on the server
 *  (403 forbidden otherwise; 404 if it was already gone). global_id is never
 *  reused afterwards, so holders who later 更新 get a clean "deleted" 404. */
export function deleteSharedCharacter(
  token: string,
  globalId: string,
): Promise<ApiResult<DeleteResult>> {
  return request<DeleteResult>(`/characters/${globalId}`, {
    method: "DELETE",
    token,
  });
}

/** Read a Blob back as base64 (no data: prefix), for upload bodies. */
export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取封面失败"));
    reader.readAsDataURL(blob);
  });
}
