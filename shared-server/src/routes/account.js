// Account endpoints for the shared-character backend (phase 1).
//
// Mounted at /account by server.js; reached from the browser same-origin via
// the main nginx as /api/shared/account/*. Passwords are PLAINTEXT by product
// decision (manual maintenance through Navicat) — see db.js. Shared-slot
// expansion (POST /expand-slot) is real this phase; catfood redemption
// (POST /redeem) stays a 501 because it is fulfilled by a third-party top-up
// service that hasn't shipped its API yet (see that handler + SSOT §6).

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

// --- shared-slot expansion limits ----------------------------------------
// Expanding the shared-slot ceiling costs catfood, in fixed steps. These are
// product constants (no per-call configuration): one expansion adds SLOT_STEP
// to slot_max for SLOT_COST catfood, capped at SLOT_MAX_CEILING.
const SLOT_STEP = 5; // slots added per expansion
const SLOT_COST = 5; // catfood charged per expansion
const SLOT_MAX_CEILING = 200; // hard ceiling on slot_max

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
// Expand the shared-slot ceiling: charge catfood (counted as spend, matching
// the phase-4 acquisition model where every catfood debit lands in spent_total)
// and raise slot_max, in one transaction. Caller verifies balance + ceiling.
const expandSlot = db.prepare(
  "UPDATE users SET catfood = catfood - @cost, spent_total = spent_total + @cost, slot_max = slot_max + @step WHERE account = @account",
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

// --- catfood redemption (NOT implemented this phase) ----------------------
// Redeeming a code for catfood is fulfilled by a THIRD-PARTY service (the code
// is issued and validated by qyapi.qinyan.xyz, not by us). This backend will
// only own two pieces once that service ships its API: forwarding the redeem
// request and accepting the top-up callback. Until then this stays a 501 so the
// frontend can keep its redeem UI wired (behind a feature flag) without faking
// a balance change. When implemented, redemption MUST only add catfood — it is
// a top-up, not earnings, so it never touches earned_total / spent_total and
// keeps no ledger row (per product decision; SSOT §6).
accountRouter.post("/redeem", requireAuth, (_req, res) => {
  return res.status(501).json({ ok: false, error: "not_implemented" });
});

// --- expand shared-slot ceiling -------------------------------------------
// POST /account/expand-slot (auth) — spend SLOT_COST catfood to raise slot_max
// by SLOT_STEP, capped at SLOT_MAX_CEILING. Balance + ceiling are checked
// inside the transaction so concurrent calls can't overshoot. Returns the fresh
// profile so the client can reflect the new balance and ceiling immediately.
accountRouter.post("/expand-slot", requireAuth, (req, res) => {
  const account = req.user.account;
  try {
    const apply = db.transaction(() => {
      const user = getUser.get(account);
      if (user.slot_max + SLOT_STEP > SLOT_MAX_CEILING) {
        return { error: "slot_max_reached", status: 409 };
      }
      if (user.catfood < SLOT_COST) {
        return { error: "insufficient", status: 402 };
      }
      expandSlot.run({ account, cost: SLOT_COST, step: SLOT_STEP });
      return { ok: true };
    });
    const result = apply();
    if (result.error) {
      return res.status(result.status).json({ ok: false, error: result.error });
    }
  } catch {
    return res.status(500).json({ ok: false, error: "db_write_failed" });
  }
  return res.json({ ok: true, profile: profileOf(getUser.get(account)) });
});
