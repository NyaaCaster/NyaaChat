// SQLite access + schema bootstrap for the NyaaChat shared-character backend.
//
// One synchronous better-sqlite3 connection for the whole process (the addon
// is fast and serializes internally; this backend is low-concurrency). The DB
// file lives on a host bind mount (DB_PATH) so it survives container rebuilds
// and can be opened directly by Navicat for SQLite for manual maintenance.
// Credentials moved to the NyaaAcount unified account platform in P7-3 — the
// local password column is retired (kept as '' for the NOT NULL constraint).

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/db/nyaachat-shared.db";

// Ensure the parent dir exists before better-sqlite3 tries to create the file.
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// WAL keeps reads non-blocking during writes and plays well with an external
// reader (Navicat) attached to the same file.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Full schema is created up front (all phases) so the on-disk DB is stable and
// Navicat-inspectable from day one, even though account endpoints land first.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    account      TEXT PRIMARY KEY,            -- GUID, ascii letters/digits/symbols
    username     TEXT NOT NULL,               -- display only
    password     TEXT NOT NULL DEFAULT '',    -- RETIRED (P7-3): auth lives in NyaaAcount; kept '' for NOT NULL
    created_at   INTEGER NOT NULL,            -- unix ms
    catfood      INTEGER NOT NULL DEFAULT 0,  -- balance, >= 0, no decimals
    spent_total  INTEGER NOT NULL DEFAULT 0,  -- lifetime spend (consumption only)
    earned_total INTEGER NOT NULL DEFAULT 0,  -- lifetime earnings (income only)
    slot_max           INTEGER NOT NULL DEFAULT 10, -- shared-slot ceiling
    char_storage_max   INTEGER NOT NULL DEFAULT 33554432, -- character card storage ceiling (bytes, 32 MB)
    chat_storage_max   INTEGER NOT NULL DEFAULT 33554432, -- chat history storage ceiling (bytes, 32 MB)
    last_active  INTEGER NOT NULL DEFAULT 0,  -- unix ms, last authed request
    nyaa_uid     INTEGER                      -- NyaaAcount uid (P7-3 unified accounts)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    account    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (account) REFERENCES users(account) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS shared_characters (
    global_id    TEXT PRIMARY KEY,            -- never reused/changed after delete
    owner        TEXT NOT NULL,               -- uploader account
    author       TEXT NOT NULL,               -- author display name (hidden index tag)
    name         TEXT NOT NULL,               -- from card Character Name
    source       TEXT NOT NULL,               -- 'original' | 'reposted'
    intro        TEXT NOT NULL DEFAULT '',    -- <=100 chars, NOT the card description
    tags         TEXT NOT NULL DEFAULT '[]',  -- JSON array of tag strings
    use_price    INTEGER NOT NULL DEFAULT 0,  -- 0 = free
    buyout_price INTEGER NOT NULL DEFAULT 0,  -- 0 = not for sale (hide buyout)
    card_json    TEXT NOT NULL,               -- ST-format card json (no cover pixels)
    cover_ext    TEXT,                        -- cover file ext, e.g. 'webp'; file named by global_id
    downloads    INTEGER NOT NULL DEFAULT 0,
    likes        INTEGER NOT NULL DEFAULT 0,
    dislikes     INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,            -- unix ms
    updated_at   INTEGER NOT NULL,            -- unix ms (sort key)
    FOREIGN KEY (owner) REFERENCES users(account) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_shared_updated ON shared_characters(updated_at);
  CREATE INDEX IF NOT EXISTS idx_shared_owner   ON shared_characters(owner);

  CREATE TABLE IF NOT EXISTS ratings (
    account   TEXT NOT NULL,
    global_id TEXT NOT NULL,
    value     INTEGER NOT NULL,               -- 1 = like, -1 = dislike (mutually exclusive)
    PRIMARY KEY (account, global_id),
    FOREIGN KEY (account)   REFERENCES users(account)            ON DELETE CASCADE,
    FOREIGN KEY (global_id) REFERENCES shared_characters(global_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    account    TEXT PRIMARY KEY,
    payload    TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (account) REFERENCES users(account) ON DELETE CASCADE
  );
`);

	// Migrations for existing databases (CREATE TABLE IF NOT EXISTS only covers
	// new installs).  Each migration is wrapped in a try so the schema survives
	// partial upgrades gracefully.
	try {
	  db.exec("ALTER TABLE users ADD COLUMN last_active INTEGER NOT NULL DEFAULT 0");
	} catch { /* column already exists — harmless */ }

	// P7-3: link local users to the NyaaAcount unified account platform. The
	// unique index doubles as the JIT-provisioning lookup key (login resolves
	// the local row by nyaa_uid, not by account).
	try {
	  db.exec("ALTER TABLE users ADD COLUMN nyaa_uid INTEGER");
	} catch { /* column already exists — harmless */ }
	db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nyaa_uid ON users(nyaa_uid)");

	// P2 (KnowledgeBase): knowledge-base stack ceiling. Default 5, hard cap 50.
	// Expand via POST /account/expand-kb (same transaction pattern as expand-slot).
		try {
		  db.exec("ALTER TABLE users ADD COLUMN kb_max INTEGER NOT NULL DEFAULT 3");
		} catch { /* column already exists - harmless */ }

		// KB-V1 post-launch: reduce default kb_max from 5 to 3.
		// Only affects users who never expanded (still at the old default of 5).
		try {
		  db.exec("UPDATE users SET kb_max = 3 WHERE kb_max = 5");
		} catch { /* harmless */ }

		// Paid-feature adjustment (2026-07): per-user storage ceilings for
		// character cards and chat history. Previously hardcoded 64 MB each;
		// now initial free 32 MB, expandable via catfood.
		try {
		  db.exec("ALTER TABLE users ADD COLUMN char_storage_max INTEGER NOT NULL DEFAULT 33554432");
		} catch { /* column already exists — harmless */ }
		try {
		  db.exec("ALTER TABLE users ADD COLUMN chat_storage_max INTEGER NOT NULL DEFAULT 33554432");
		} catch { /* column already exists — harmless */ }

		// Paid-feature adjustment (2026-07): reduce default slot_max from 20 to 10.
		// Only affects users who never expanded (still at the old default of 20).
		try {
		  db.exec("UPDATE users SET slot_max = 10 WHERE slot_max = 20");
		} catch { /* harmless */ }

// Ensure the user-storage directory exists for future per-user file storage
// (character card covers etc.). Currently the settings payload is stored in the
// user_settings table above; the directory is reserved for later phases.
export const USER_STORAGE_DIR = process.env.USER_STORAGE_DIR || "./data/user-storage";
mkdirSync(USER_STORAGE_DIR, { recursive: true });
