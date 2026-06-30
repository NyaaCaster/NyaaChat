// Account endpoints for the shared-character backend (phase 1).
//
// Mounted at /account by server.js; reached from the browser same-origin via
// the main nginx as /api/shared/account/*. Passwords are PLAINTEXT by product
// decision (manual maintenance through Navicat) — see db.js. Shared-slot
// expansion (POST /expand-slot) is real this phase; catfood redemption
// (POST /redeem) stays a 501 because it is fulfilled by a third-party top-up
// service that hasn't shipped its API yet (see that handler + SSOT §6).

import { Router } from "express";
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { join, extname } from "node:path";
import { db, USER_STORAGE_DIR } from "../db.js";
import { createSession, destroySession, requireAuth } from "../auth.js";
import { COVER_MAX_BYTES, isWebp } from "../cover-utils.js";

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

// --- user cloud settings ---------------------------------------------------
const stmtGetSettings = db.prepare(
  "SELECT payload, updated_at FROM user_settings WHERE account = ?",
);
const stmtUpsertSettings = db.prepare(`
  INSERT INTO user_settings (account, payload, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(account) DO UPDATE SET
    payload = excluded.payload,
    updated_at = excluded.updated_at
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
  // Reject email addresses as accounts: an account must never contain '@'.
  // (ACCOUNT_RE already excludes it, but keep this explicit so loosening the
  // regex later can't silently re-admit emails.)
  if (account.includes("@")) {
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

// --- cloud settings upload --------------------------------------------------
// PUT /account/settings (auth) — upsert the user's cloud settings archive.
// Body: { payload: ExportPayload } where ExportPayload._kind === "nyaachat_settings_export".
// Only one archive per user; repeated uploads overwrite. Returns the new updated_at.
accountRouter.put("/settings", requireAuth, (req, res) => {
  const { payload } = req.body ?? {};
  if (!payload || typeof payload !== "object") {
    return badRequest(res, "bad_payload");
  }
  if (payload._kind !== "nyaachat_settings_export" || !payload.settings) {
    return badRequest(res, "bad_payload");
  }
  const now = Date.now();
  try {
    stmtUpsertSettings.run(req.user.account, JSON.stringify(payload), now);
  } catch {
    return res.status(500).json({ ok: false, error: "db_write_failed" });
  }
  return res.json({ ok: true, updated_at: now });
});

// --- cloud settings download ------------------------------------------------
// GET /account/settings (auth) — fetch the user's cloud settings archive.
// Returns { exists: false } when no archive has been uploaded yet.
accountRouter.get("/settings", requireAuth, (req, res) => {
  const row = stmtGetSettings.get(req.user.account);
  if (!row) {
    return res.json({ ok: true, exists: false });
  }
  let payload;
  try {
    payload = JSON.parse(row.payload);
  } catch {
    return res.json({ ok: true, exists: false });
  }
  return res.json({
    ok: true,
    exists: true,
    updated_at: row.updated_at,
    payload,
  });
});

// --- cloud cover sync -------------------------------------------------------
// PUT /account/settings/covers (auth) — upload per-user character covers.
// Body: { covers: { [characterId]: base64Webp } }
// Each cover is validated as a real WebP, written to
// USER_STORAGE_DIR/<account>/covers/<characterId>.webp, and counted.
// Invalid entries are silently skipped; the response count reflects what
// actually landed on disk.
const COVER_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

accountRouter.put("/settings/covers", requireAuth, (req, res) => {
  const { covers } = req.body ?? {};
  if (!covers || typeof covers !== "object" || Array.isArray(covers)) {
    return badRequest(res, "bad_covers");
  }

  const account = req.user.account;
  const dir = join(USER_STORAGE_DIR, account, "covers");
  mkdirSync(dir, { recursive: true });

  let count = 0;
  for (const [id, b64] of Object.entries(covers)) {
    if (!COVER_ID_RE.test(id) || typeof b64 !== "string" || !b64) continue;
    let buf;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      continue;
    }
    if (!buf.length || buf.length > COVER_MAX_BYTES || !isWebp(buf)) continue;
    try {
      writeFileSync(join(dir, `${id}.webp`), buf);
      count++;
    } catch {
      // Individual file write failed — skip and continue.
    }
  }

  return res.json({ ok: true, count });
});

// GET /account/settings/covers (auth) — download all covers for this account.
// Returns { covers: { [characterId]: base64Webp } }. Empty object when
// the directory doesn't exist or contains no .webp files.
accountRouter.get("/settings/covers", requireAuth, (req, res) => {
  const account = req.user.account;
  const dir = join(USER_STORAGE_DIR, account, "covers");
  const covers = {};

  try {
    if (!existsSync(dir)) return res.json({ ok: true, covers });
    const entries = readdirSync(dir);
    for (const name of entries) {
      if (extname(name) !== ".webp") continue;
      const id = name.slice(0, -5); // strip ".webp"
      if (!COVER_ID_RE.test(id)) continue;
      try {
        const buf = readFileSync(join(dir, name));
        covers[id] = buf.toString("base64");
      } catch {
        // Corrupted / unreadable file — skip.
      }
    }
  } catch {
    // Directory listing failed — return whatever we have (empty).
  }

  return res.json({ ok: true, covers });
});

// DELETE /account/settings/covers/:characterId (auth) — delete a single cover.
// Idempotent — returns ok whether the file existed or not.
accountRouter.delete("/settings/covers/:characterId", requireAuth, (req, res) => {
  const { characterId } = req.params;
  if (!COVER_ID_RE.test(characterId)) {
    return badRequest(res, "bad_character_id");
  }
  const account = req.user.account;
  const filePath = join(USER_STORAGE_DIR, account, "covers", `${characterId}.webp`);
  try {
    if (existsSync(filePath)) unlinkSync(filePath);
  } catch {
    // Best-effort — stale file is harmless.
  }
  return res.json({ ok: true });
});

// --- chat-sessions upload ---------------------------------------------------
// PUT /account/chat-sessions (auth) — upload the user's full chat-session list
// as an encrypted JSON payload.  Body: { alg:"AES-256-GCM", iv, data, tag } —
// the server stores the ciphertext verbatim and never sees plaintext.
// Also accepts legacy plaintext { sessions: [...] } for backward compatibility.
// Atomic write via temp-file + rename so concurrent readers never see a half-written file.
accountRouter.put("/chat-sessions", requireAuth, (req, res) => {
  const body = req.body ?? {};
  // Accept encrypted payload (Nyaa-HMAC-XOR-V1 or legacy AES-256-GCM) …
  const isEncrypted =
    (body.alg === "Nyaa-HMAC-XOR-V1" && typeof body.salt === "string" && typeof body.iv === "string" && typeof body.data === "string" && typeof body.tag === "string") ||
    (body.alg === "AES-256-GCM" && typeof body.iv === "string" && typeof body.data === "string" && typeof body.tag === "string");
  // … or legacy plaintext.
  const isLegacy = Array.isArray(body.sessions);
  if (!isEncrypted && !isLegacy) {
    return badRequest(res, "bad_payload");
  }
  const account = req.user.account;
  const dir = join(USER_STORAGE_DIR, account);
  try { mkdirSync(dir, { recursive: true }); } catch { /* dir exists */ }
  const filePath = join(dir, "chat-sessions.json");
  const tmpPath = filePath + ".tmp." + Date.now();
  const now = Date.now();
  const count = isEncrypted ? -1 : body.sessions.length; // -1 = encrypted, count unknown to server
  try {
    writeFileSync(tmpPath, JSON.stringify({ ...body, updated_at: now }), "utf-8");
    renameSync(tmpPath, filePath);
  } catch (err) {
    try { if (existsSync(tmpPath)) unlinkSync(tmpPath); } catch { /* best-effort */ }
    console.error("[chat-sessions] write failed for", account, err);
    return res.status(500).json({ ok: false, error: "write_failed" });
  }
  return res.json({ ok: true, updated_at: now, count });
});

// --- chat-sessions download -------------------------------------------------
// GET /account/chat-sessions (auth) — fetch the user's full chat-session list.
// Returns the stored payload verbatim (encrypted or legacy plaintext) — the
// client decrypts.  { exists: false } when no archive has been uploaded yet.
accountRouter.get("/chat-sessions", requireAuth, (req, res) => {
  const account = req.user.account;
  const filePath = join(USER_STORAGE_DIR, account, "chat-sessions.json");
  if (!existsSync(filePath)) {
    return res.json({ ok: true, exists: false });
  }
  let raw;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error("[chat-sessions] read failed for", account, err);
    return res.status(500).json({ ok: false, error: "read_failed" });
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return res.status(500).json({ ok: false, error: "parse_failed" });
  }
  return res.json({ ok: true, exists: true, ...data });
});
