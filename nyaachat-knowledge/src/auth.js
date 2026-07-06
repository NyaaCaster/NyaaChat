// Session-token auth for the knowledge base backend.
//
// Tokens are issued by the shared-character backend (nyaachat-shared) and validated
// by calling its internal HTTP API (POST /internal/validate-token) inside the Docker
// network. Previously this service opened the shared DB directly, but that fails on
// Docker for Windows when the shared-server holds a file lock on its WAL-mode DB.
//
// Public API (same signatures as shared-server/src/auth.js):
//   tokenFromHeader(req)          — extract Bearer token or null
//   resolveUser(req)              — soft auth, returns { token, user } or null
//   requireAuth(req, res, next)   — Express middleware, 401s on failure

const SHARED_SERVER_URL =
  (process.env.SHARED_SERVER_URL || "http://nyaachat-shared:5107").replace(/\/$/, "");
const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN || "";

/** Pull the bearer token from an Authorization header, or null. */
export function tokenFromHeader(req) {
  const raw = req.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

/**
 * Call the shared-server's internal token-validation endpoint.
 * Returns the user object on success, or null when validation fails.
 */
async function validateTokenViaApi(token) {
  if (!INTERNAL_TOKEN || !token) return null;
  try {
    const resp = await fetch(`${SHARED_SERVER_URL}/internal/validate-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": INTERNAL_TOKEN,
      },
      body: JSON.stringify({ token }),
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.ok || !data.user) return null;
    return data.user;
  } catch (err) {
    console.error("[auth] Token validation API call failed:", err.message);
    return null;
  }
}

// Cache validated users briefly to avoid hitting the shared-server on every
// authed request. TTL is low enough that a logout or account change propagates
// quickly, but high enough to absorb bursts (e.g. KB list + doc list in one page load).
const userCache = new Map(); // token → { user, ts }
const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * Soft auth: resolve the bearer token to a user row via the shared-server API.
 * Returns { token, user } on success, null when there is no token / the shared
 * server isn't available / the token doesn't resolve.
 */
export async function resolveUser(req) {
  const token = tokenFromHeader(req);
  if (!token) return null;

  // Check cache first.
  const cached = userCache.get(token);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { token, user: cached.user };
  }

  const user = await validateTokenViaApi(token);
  if (!user) {
    userCache.delete(token);
    return null;
  }

  userCache.set(token, { user, ts: Date.now() });
  return { token, user };
}

/**
 * Express middleware: resolves the bearer token to a live user row and hangs
 * it on req.user, or 401s. Use on every route that needs identity.
 */
export async function requireAuth(req, res, next) {
  const token = tokenFromHeader(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  // Check cache first.
  const cached = userCache.get(token);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    req.user = cached.user;
    req.token = token;
    return next();
  }

  const user = await validateTokenViaApi(token);
  if (!user) {
    userCache.delete(token);
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  userCache.set(token, { user, ts: Date.now() });
  req.user = user;
  req.token = token;
  next();
}
