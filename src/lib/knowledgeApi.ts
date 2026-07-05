// Knowledge base API client — talks to the nyaachat-knowledge backend
// through the main nginx reverse proxy at /api/knowledge/*.
//
// All mutation endpoints require a Bearer token (the shared-account session
// token). Read endpoints also require auth (owner-scoped queries).
//
// Error model: same discriminated ApiResult<T> as sharedAccountApi so callers
// can distinguish business rejections from network failures.

import type { AccountProfile } from "./sharedAccountApi";

const BASE = "/api/knowledge";
const REQUEST_TIMEOUT_MS = 12_000;

// Re-export the same discriminated-result shape used everywhere.
export type ApiResult<T> =
  | { kind: "ok"; ok: true; data: T }
  | { kind: "error"; ok: false; error: string; status: number }
  | { kind: "network"; ok: false };

// --- domain types (mirrors backend shapeKb / shapeDoc / maskedConfig) --------

export interface KnowledgeBase {
  id: string;
  owner: string;
  name: string;
  description: string;
  chunkSize: number;
  chunkOverlap: number;
  denseTopK: number;
  sparseTopK: number;
  charTotal: number;
  enabled: boolean;
  documentCount: number;
  chunkCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeDocument {
  id: string;
  kbId: string;
  name: string;
  ext: string;
  sizeBytes: number;
  chunkCount: number;
  uploadedAt: number;
}

export interface EmbeddingConfigState {
  configured: boolean;
  /** api_key is NEVER returned — only this boolean signals a stored key. */
  api_key_set?: boolean;
  base_url?: string;
  model?: string;
  dim?: number;
}

// --- internal request helper -------------------------------------------------

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; token: string },
): Promise<ApiResult<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${options.token}`,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(`${BASE}${path}`, {
      method: options.method ?? "GET",
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    let payload: any = null;
    // 204 No Content (DELETE) — success with no body.
    if (res.status === 204) {
      return { kind: "ok", ok: true, data: undefined as unknown as T };
    }
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }

    if ((res.status === 502 || res.status === 503 || res.status === 504) && !payload?.ok) {
      return { kind: "network", ok: false };
    }

    if (!res.ok || (payload && payload.ok === false)) {
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

// --- KB CRUD -----------------------------------------------------------------

export function listKb(token: string): Promise<ApiResult<{ items: KnowledgeBase[] }>> {
  return request("/kb", { token });
}

export function createKb(
  token: string,
  data: { name: string; description?: string },
): Promise<ApiResult<{ kb: KnowledgeBase }>> {
  return request("/kb", { method: "POST", body: data, token });
}

export function getKb(
  token: string,
  kbId: string,
): Promise<ApiResult<{ kb: KnowledgeBase }>> {
  return request(`/kb/${kbId}`, { token });
}

export function updateKb(
  token: string,
  kbId: string,
  patch: Partial<{
    name: string;
    description: string;
    chunk_size: number;
    chunk_overlap: number;
    dense_top_k: number;
    sparse_top_k: number;
  }>,
): Promise<ApiResult<{ kb: KnowledgeBase }>> {
  return request(`/kb/${kbId}`, { method: "PATCH", body: patch, token });
}

export function deleteKb(
  token: string,
  kbId: string,
): Promise<ApiResult<void>> {
  return request(`/kb/${kbId}`, { method: "DELETE", token });
}

// --- Documents ---------------------------------------------------------------

export function listDocuments(
  token: string,
  kbId: string,
): Promise<ApiResult<{ items: KnowledgeDocument[] }>> {
  return request(`/kb/${kbId}/documents`, { token });
}

export function uploadDocuments(
  token: string,
  kbId: string,
  files: { filename: string; data: string }[],
): Promise<ApiResult<{ results: Array<{ filename: string; ok: boolean; document?: KnowledgeDocument; chunk_count?: number; error?: string }> }>> {
  return request(`/kb/${kbId}/documents`, { method: "POST", body: { files }, token });
}

export function deleteDocument(
  token: string,
  docId: string,
): Promise<ApiResult<void>> {
  return request(`/documents/${docId}`, { method: "DELETE", token });
}

// --- Embedding config --------------------------------------------------------

export function getEmbeddingConfig(
  token: string,
): Promise<ApiResult<EmbeddingConfigState>> {
  return request("/embedding-config", { token });
}

export function saveEmbeddingConfig(
  token: string,
  config: { base_url: string; api_key: string; model: string },
): Promise<ApiResult<EmbeddingConfigState>> {
  return request("/embedding-config", { method: "PUT", body: config, token });
}

export function healthCheckEmbedding(
  token: string,
): Promise<ApiResult<{ dim: number }>> {
  return request("/embedding-config/health-check", { method: "POST", token });
}

// --- Expand KB (routed to shared-server by nginx) ----------------------------

export function expandKb(
  token: string,
): Promise<ApiResult<{ profile: AccountProfile }>> {
  return request("/expand-kb", { method: "POST", token });
}
