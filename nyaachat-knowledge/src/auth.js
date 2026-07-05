// Session-token auth for the knowledge base backend.
//
// Tokens are issued by the shared-character backend (nyaachat-shared) and stored
// in its `sessions` table. This service opens a READ-ONLY connection to the
// shared DB to validate tokens — it never writes sessions or manages users.
//
// The shared DB file is bind-mounted read-only at /shared-db/nyaachat-shared.db
// (see docker-compose.knowledge.yml). If the file is absent (e.g. shared-server
// not yet deployed), auth fails closed — every protected route 401s.
//
// Public API (same signatures as shared-server/src/auth.js):
//   tokenFromHeader(req)          — extract Bearer token or null
//   resolveUser(req)              — soft auth, returns { token, user } or null
//   requireAuth(req, res, next)   — Express middleware, 401s on failure

import Database from "better-sqlite3";
import { existsSync } from "node:fs";

const SHARED_DB_PATH = "/shared-db/nyaachat-shared-v4.db";

// Lazy-init the shared-DB connection (container may start before shared-server).
let _sharedDb = null;
function getSharedDb() {
  if (_sharedDb) return _sharedDb;
  if (!existsSync(SHARED_DB_PATH)) return null;
  try {
    _sharedDb = new Database(SHARED_DB_PATH, { readonly: true });
    _sharedDb.pragma("journal_mode = WAL");
  } catch (err) {
    console.error("[auth] Failed to open shared DB:", err.message);
    return null;
  }
  return _sharedDb;
}

/** Pull the bearer token from an Authorization header, or null. */
export function tokenFromHeader(req) {
  const raw = req.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

/**
 * Soft auth: resolve the bearer token to a live user row from the shared DB.
 * Returns { token, user } on success, null when there is no token / the shared
 * DB isn't available / the token doesn't resolve.
 */
export function resolveUser(req) {
  const token = tokenFromHeader(req);
  if (!token) return null;

  const sdb = getSharedDb();
  if (!sdb) return null;

  let session;
  try {
    session = sdb.prepare("SELECT account FROM sessions WHERE token = ?").get(token);
  } catch {
    return null;
  }
  if (!session) return null;

  let user;
  try {
    user = sdb.prepare("SELECT * FROM users WHERE account = ?").get(session.account);
  } catch {
    return null;
  }
  if (!user) return null;

  return { token, user };
}

/**
 * Express middleware: resolves the bearer token to a live user row and hangs
 * it on req.user, or 401s. Use on every route that needs identity.
 */
export function requireAuth(req, res, next) {
  const token = tokenFromHeader(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const sdb = getSharedDb();
  if (!sdb) {
    return res.status(503).json({ ok: false, error: "auth_service_unavailable" });
  }

  let session;
  try {
    session = sdb.prepare("SELECT account FROM sessions WHERE token = ?").get(token);
  } catch {
    return res.status(503).json({ ok: false, error: "auth_service_unavailable" });
  }
  if (!session) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  let user;
  try {
    user = sdb.prepare("SELECT * FROM users WHERE account = ?").get(session.account);
  } catch {
    return res.status(503).json({ ok: false, error: "auth_service_unavailable" });
  }
  if (!user) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  req.user = user;
  req.token = token;
  next();
}
