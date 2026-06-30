// Session-token auth for the shared-character backend.
//
// Tokens are opaque random strings persisted in the `sessions` table (one row
// per active login). There is no expiry sweep yet — sessions live until logout
// or until the user (cascade) is deleted; the frontend simply keeps the token
// in localStorage. Passwords are plaintext by deliberate product decision (see
// db.js), so the token is the only thing that travels on each authed request.

import { randomBytes } from "node:crypto";
import { db } from "./db.js";

const insertSession = db.prepare(
  "INSERT INTO sessions (token, account, created_at) VALUES (?, ?, ?)",
);
const deleteSession = db.prepare("DELETE FROM sessions WHERE token = ?");
const findSession = db.prepare(
  "SELECT account FROM sessions WHERE token = ?",
);
const findUser = db.prepare("SELECT * FROM users WHERE account = ?");
const updateLastActive = db.prepare(
  "UPDATE users SET last_active = ? WHERE account = ?",
);

// Per-account debounce (ms).  Avoids writing on every single authed request
// while keeping the granularity useful for data-retention decisions.
const LAST_ACTIVE_DEBOUNCE_MS = 5 * 60 * 1000; // 5 minutes
const lastActiveDebounce = new Map();

/** Mint a new session token for an account and persist it. */
export function createSession(account) {
  const token = randomBytes(32).toString("hex");
  insertSession.run(token, account, Date.now());
  return token;
}

/** Drop a session (logout). Idempotent. */
export function destroySession(token) {
  if (!token) return;
  deleteSession.run(token);
}

/** Pull the bearer token from an Authorization header, or null. */
export function tokenFromHeader(req) {
  const raw = req.get("authorization") || "";
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : null;
}

/**
 * Soft auth: resolve the bearer token to a live user row and return
 * { token, user }, or null when there is no token / it doesn't resolve. Unlike
 * requireAuth this never responds — callers decide what an anonymous request
 * means (e.g. free use needs no login, paid acquisition does). Orphaned tokens
 * are swept, same as requireAuth.
 */
export function resolveUser(req) {
  const token = tokenFromHeader(req);
  if (!token) return null;
  const session = findSession.get(token);
  if (!session) return null;
  const user = findUser.get(session.account);
  if (!user) {
    destroySession(token);
    return null;
  }
  return { token, user };
}

/**
 * Express middleware: resolves the bearer token to a live user row and hangs
 * it on req.user, or 401s. Use on every account route that needs identity.
 */
export function requireAuth(req, res, next) {
  const token = tokenFromHeader(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const session = findSession.get(token);
  if (!session) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const user = findUser.get(session.account);
  if (!user) {
    // Orphaned token (user gone) — treat as logged out.
    destroySession(token);
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  req.user = user;
  req.token = token;

  // Update last_active with a per-account debounce so we don't hammer
  // the DB on every single authed request (polling, quick nav, etc.).
  const now = Date.now();
  const prev = lastActiveDebounce.get(session.account);
  if (prev == null || now - prev >= LAST_ACTIVE_DEBOUNCE_MS) {
    lastActiveDebounce.set(session.account, now);
    updateLastActive.run(now, session.account);
  }

  next();
}
