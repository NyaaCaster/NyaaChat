// Account endpoints for the shared-character backend (phase 1).
//
// Mounted at /account by server.js; reached from the browser same-origin via
// the main nginx as /api/shared/account/*. Passwords are PLAINTEXT by product
// decision (manual maintenance through Navicat) — see db.js. catfood redemption
// and shared-slot expansion are intentionally 501 placeholders this phase
// (real payment/redeem logic is phase 6; see SSOT §6).

import { Router } from "express";
import { db } from "../db.js";
import { createSession, destroySession, requireAuth } from "../auth.js";

export const accountRouter = Router();

// --- validation -----------------------------------------------------------
// account = login id: ascii letters/digits and a small symbol set, 3..32.
const ACCOUNT_RE = /^[A-Za-z0-9._-]{3,32}$/;
const PASSWORD_MIN = 6;
const PASSWORD_MAX = 64;
const USERNAME_MAX = 24;

function badRequest(res, error) {
  return res.status(400).json({ ok: false, error });
}

// --- statements -----------------------------------------------------------
const getUser = db.prepare("SELECT * FROM users WHERE account = ?");
const insertUser = db.prepare(`
  INSERT INTO users (account, username, password, created_at)
  VALUES (@account, @username, @password, @created_at)
`);
const updateUsername = db.prepare(
  "UPDATE users SET username = ? WHERE account = ?",
);
const updatePassword = db.prepare(
  "UPDATE users SET password = ? WHERE account = ?",
);
const aggStats = db.prepare(`
  SELECT
    COUNT(*)                    AS shared_count,
    COALESCE(SUM(downloads), 0) AS total_downloads,
    COALESCE(SUM(likes), 0)     AS total_likes,
    COALESCE(SUM(dislikes), 0)  AS total_dislikes
  FROM shared_characters
  WHERE owner = ?
`);

/**
 * Shape a user row + derived stats into the public profile payload. Never
 * leaks the password; slot_used is a client-side count (not stored here).
 */
function profileOf(user) {
  const stats = aggStats.get(user.account);
  return {
    account: user.account,
    username: user.username,
    createdAt: user.created_at,
    catfood: user.catfood,
    spentTotal: user.spent_total,
    earnedTotal: user.earned_total,
    slotMax: user.slot_max,
    stats: {
      sharedCount: stats.shared_count,
      totalDownloads: stats.total_downloads,
      totalLikes: stats.total_likes,
      totalDislikes: stats.total_dislikes,
    },
  };
}

// --- register -------------------------------------------------------------
// POST /account/register { account, password, username? }
accountRouter.post("/register", (req, res) => {
  const account = String(req.body?.account ?? "").trim();
  const password = String(req.body?.password ?? "");
  let username = String(req.body?.username ?? "").trim();

  if (!ACCOUNT_RE.test(account)) {
    return badRequest(res, "invalid_account");
  }
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    return badRequest(res, "invalid_password");
  }
  if (username.length > USERNAME_MAX) {
    return badRequest(res, "invalid_username");
  }
  if (!username) username = account; // default display name = login id

  if (getUser.get(account)) {
    return res.status(409).json({ ok: false, error: "account_taken" });
  }

  insertUser.run({ account, username, password, created_at: Date.now() });
  const token = createSession(account);
  return res.json({ ok: true, token, profile: profileOf(getUser.get(account)) });
});

// --- login ----------------------------------------------------------------
// POST /account/login { account, password }
accountRouter.post("/login", (req, res) => {
  const account = String(req.body?.account ?? "").trim();
  const password = String(req.body?.password ?? "");

  const user = getUser.get(account);
  // Same response for unknown account and wrong password — the frontend only
  // needs to distinguish "bad credentials" (this 401) from "can't reach
  // server" (a thrown fetch error), per the design.
  if (!user || user.password !== password) {
    return res.status(401).json({ ok: false, error: "bad_credentials" });
  }

  const token = createSession(account);
  return res.json({ ok: true, token, profile: profileOf(user) });
});

// --- logout ---------------------------------------------------------------
// POST /account/logout (auth)
accountRouter.post("/logout", requireAuth, (req, res) => {
  destroySession(req.token);
  return res.json({ ok: true });
});

// --- profile --------------------------------------------------------------
// GET /account/profile (auth) — also the "is my stored token still valid?" probe
accountRouter.get("/profile", requireAuth, (req, res) => {
  return res.json({ ok: true, profile: profileOf(req.user) });
});

// --- rename ---------------------------------------------------------------
// POST /account/rename { username } (auth)
accountRouter.post("/rename", requireAuth, (req, res) => {
  const username = String(req.body?.username ?? "").trim();
  if (!username || username.length > USERNAME_MAX) {
    return badRequest(res, "invalid_username");
  }
  updateUsername.run(username, req.user.account);
  return res.json({ ok: true, profile: profileOf(getUser.get(req.user.account)) });
});

// --- change password ------------------------------------------------------
// POST /account/password { oldPassword, newPassword } (auth)
accountRouter.post("/password", requireAuth, (req, res) => {
  const oldPassword = String(req.body?.oldPassword ?? "");
  const newPassword = String(req.body?.newPassword ?? "");
  if (req.user.password !== oldPassword) {
    return res.status(403).json({ ok: false, error: "wrong_password" });
  }
  if (newPassword.length < PASSWORD_MIN || newPassword.length > PASSWORD_MAX) {
    return badRequest(res, "invalid_password");
  }
  updatePassword.run(newPassword, req.user.account);
  return res.json({ ok: true });
});

// --- placeholders (phase 6) ----------------------------------------------
// Catfood redemption and shared-slot expansion are deferred to the payment
// phase. Surface a clear 501 so the frontend can show a "not implemented yet"
// notice while still exercising the auth path.
accountRouter.post("/redeem", requireAuth, (_req, res) => {
  return res.status(501).json({ ok: false, error: "not_implemented" });
});
accountRouter.post("/expand-slot", requireAuth, (_req, res) => {
  return res.status(501).json({ ok: false, error: "not_implemented" });
});
