// Client for the shared-character account backend (phase 1).
//
// Talks to the SEPARATELY-deployed nyaachat-shared service same-origin through
// the main nginx at /api/shared/* (see nginx.conf). The login token is kept in
// localStorage so the session survives reloads; it is sent as a Bearer header.
//
// Error model: callers must distinguish "the server said no" (a business error
// like bad credentials) from "couldn't reach the server at all" (network /
// proxy down). We encode that as a discriminated result rather than throwing,
// so the modal can show the right message — the design explicitly requires
// separating 账号密码错误 from 服务器无法连接.

const BASE = "/api/shared/account";
const STORAGE_KEY = "nyaachat_account";
const REQUEST_TIMEOUT_MS = 12_000;

export interface AccountStats {
  sharedCount: number;
  totalDownloads: number;
  totalLikes: number;
  totalDislikes: number;
}

export interface AccountProfile {
  account: string;
  username: string;
  createdAt: number; // unix ms
  catfood: number;
  spentTotal: number;
  earnedTotal: number;
  slotMax: number;
  stats: AccountStats;
}

/** Persisted login state. */
export interface StoredAccount {
  token: string;
  profile: AccountProfile;
}

// Discriminated result. The discriminant is the string `kind` (not the boolean
// `ok`) because this project compiles with strictNullChecks off, where TS does
// NOT narrow unions on a boolean-literal discriminant. `ok` is kept as a
// convenience alias on each variant.
export type ApiResult<T> =
  | { kind: "ok"; ok: true; data: T }
  | { kind: "error"; ok: false; error: string; status: number }
  | { kind: "network"; ok: false };

// --- localStorage persistence --------------------------------------------
export function loadStoredAccount(): StoredAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredAccount;
    if (!parsed?.token || !parsed?.profile?.account) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredAccount(value: StoredAccount): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Quota / private-mode failures are non-fatal: the in-memory session still
    // works for this tab, it just won't persist across reloads.
  }
}

export function clearStoredAccount(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// --- low-level request ----------------------------------------------------
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

    // Gateway-level failures (nginx can't reach the backend, or the backend
    // returned a non-JSON 5xx) mean "couldn't reach the server" rather than a
    // business rejection — surface them as a network error so the UI shows
    // 服务器无法连接, not a generic failure. A 502/503/504 with no JSON ok
    // payload is the shape nginx emits when nyaachat-shared is down.
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
    // AbortError, TypeError (failed to fetch), DNS/proxy 5xx that never
    // returned JSON — all mean "couldn't get a real answer from the server".
    return { kind: "network", ok: false };
  } finally {
    clearTimeout(timer);
  }
}

// --- endpoints ------------------------------------------------------------
interface AuthPayload {
  ok: true;
  token: string;
  profile: AccountProfile;
}
interface ProfilePayload {
  ok: true;
  profile: AccountProfile;
}

export function register(
  account: string,
  password: string,
  username?: string,
): Promise<ApiResult<AuthPayload>> {
  return request<AuthPayload>("/register", {
    method: "POST",
    body: { account, password, username },
  });
}

export function login(
  account: string,
  password: string,
): Promise<ApiResult<AuthPayload>> {
  return request<AuthPayload>("/login", {
    method: "POST",
    body: { account, password },
  });
}

export function logout(token: string): Promise<ApiResult<{ ok: true }>> {
  return request<{ ok: true }>("/logout", { method: "POST", token });
}

export function fetchProfile(token: string): Promise<ApiResult<ProfilePayload>> {
  return request<ProfilePayload>("/profile", { token });
}

export function rename(
  token: string,
  username: string,
): Promise<ApiResult<ProfilePayload>> {
  return request<ProfilePayload>("/rename", {
    method: "POST",
    token,
    body: { username },
  });
}

export function changePassword(
  token: string,
  oldPassword: string,
  newPassword: string,
): Promise<ApiResult<{ ok: true }>> {
  return request<{ ok: true }>("/password", {
    method: "POST",
    token,
    body: { oldPassword, newPassword },
  });
}

// Spend catfood to raise the shared-slot ceiling (+5 slots for 5 catfood,
// capped server-side at 200). Returns the fresh profile so the UI can reflect
// the new balance + ceiling. Business errors: "insufficient" (not enough
// catfood) / "slot_max_reached" (already at the 200 ceiling).
export function expandSlot(token: string): Promise<ApiResult<ProfilePayload>> {
  return request<ProfilePayload>("/expand-slot", { method: "POST", token });
}

// Redeem a code for catfood. The code is issued/validated by a third-party
// top-up service (not implemented yet), so this currently resolves to a
// business error "not_implemented" (HTTP 501). Wired now so the redeem UI is
// ready to flip on once that service ships its API.
export function redeem(
  token: string,
  code: string,
): Promise<ApiResult<ProfilePayload>> {
  return request<ProfilePayload>("/redeem", {
    method: "POST",
    token,
    body: { code },
  });
}

// --- cloud settings ---------------------------------------------------------

export interface CloudSettingsResponse {
  exists: boolean;
  updated_at?: number;
  payload?: Record<string, unknown>;
}

/** Fetch the user's cloud settings archive. Returns { exists: false } when none uploaded yet. */
export function downloadCloudSettings(
  token: string,
): Promise<ApiResult<CloudSettingsResponse>> {
  return request<CloudSettingsResponse>("/settings", { token });
}

/** Upload the full ExportPayload as the user's cloud settings archive (upsert). */
export function uploadCloudSettings(
  token: string,
  payload: Record<string, unknown>,
): Promise<ApiResult<{ updated_at: number }>> {
  return request<{ updated_at: number }>("/settings", {
    method: "PUT",
    token,
    body: { payload },
  });
}

// --- cloud cover sync -------------------------------------------------------

/** Upload per-character cover images (base64 WebP, no data: prefix).
 *  Returns the count of covers successfully written on the server. */
export function uploadCovers(
  token: string,
  covers: Record<string, string>,
): Promise<ApiResult<{ count: number }>> {
  return request<{ count: number }>("/settings/covers", {
    method: "PUT",
    token,
    body: { covers },
  });
}

/** Download all cover images for the current account.
 *  Returns { covers: { [characterId]: base64Webp } } — empty object when none exist. */
export function downloadCovers(
  token: string,
): Promise<ApiResult<{ covers: Record<string, string> }>> {
  return request<{ covers: Record<string, string> }>("/settings/covers", { token });
}
