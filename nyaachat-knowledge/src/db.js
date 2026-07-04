// SQLite access + schema bootstrap for the NyaaChat knowledge base backend.
//
// One synchronous better-sqlite3 connection for the whole process. The DB file
// lives on a host bind mount (DB_PATH) so it survives container rebuilds and
// can be opened directly by Navicat for SQLite for manual maintenance.
//
// Schema covers all 6 tables from the SSOT (§2.1) up front so the on-disk DB
// is stable and inspectable from day one. The vec0 virtual table is loaded via
// sqlite-vec but actual creation is deferred to P1 (dimension locked by
// embedding_config).

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH || "./data/db/nyaachat-knowledge.db";

// Ensure the parent dir exists before better-sqlite3 tries to create the file.
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);

// WAL keeps reads non-blocking during writes and plays well with an external
// reader (Navicat) attached to the same file.
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Load sqlite-vec extension for dense vector search (vec0 virtual tables).
// Actual vec_chunks table is created lazily once embedding dimension is known.
sqliteVec.load(db);

// ---- Full schema (all phases) ---------------------------------------------
db.exec(`
  CREATE TABLE IF NOT EXISTS knowledge_bases (
    id             TEXT PRIMARY KEY,
    owner          TEXT NOT NULL,
    name           TEXT NOT NULL,
    description    TEXT NOT NULL DEFAULT '',
    chunk_size     INTEGER NOT NULL,
    chunk_overlap  INTEGER NOT NULL,
    dense_top_k    INTEGER NOT NULL,
    sparse_top_k   INTEGER NOT NULL,
    char_total     INTEGER NOT NULL DEFAULT 0,
    enabled        INTEGER NOT NULL DEFAULT 1,
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_kb_owner ON knowledge_bases(owner);

  CREATE TABLE IF NOT EXISTS documents (
    id          TEXT PRIMARY KEY,
    kb_id       TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    ext         TEXT NOT NULL,
    size_bytes  INTEGER NOT NULL,
    chunk_count INTEGER NOT NULL DEFAULT 0,
    uploaded_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_documents_kb ON documents(kb_id);

  CREATE TABLE IF NOT EXISTS chunks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id     TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    kb_id      TEXT NOT NULL REFERENCES knowledge_bases(id) ON DELETE CASCADE,
    seq        INTEGER NOT NULL,
    content    TEXT NOT NULL,
    char_count INTEGER NOT NULL,
    vector_id  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_chunks_doc ON chunks(doc_id);
  CREATE INDEX IF NOT EXISTS idx_chunks_kb ON chunks(kb_id);

  -- FTS5 sparse index (trigram tokenizer handles CJK substrings well).
  CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    content,
    tokenize = 'trigram'
  );

  CREATE TABLE IF NOT EXISTS embedding_configs (
    owner      TEXT PRIMARY KEY,
    base_url   TEXT NOT NULL,
    api_key    TEXT NOT NULL,
    model      TEXT NOT NULL,
    dim        INTEGER,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS character_kb_bindings (
    global_id TEXT NOT NULL,
    kb_id     TEXT NOT NULL,
    owner     TEXT NOT NULL,
    PRIMARY KEY (global_id, kb_id)
  );
  CREATE INDEX IF NOT EXISTS idx_bindings_kb ON character_kb_bindings(kb_id);
`);

// ---- Vec0 helpers (P1 will use these to create the table once dim is known) ----

export function getVecDim() {
  const row = db
    .prepare("SELECT dim FROM embedding_configs LIMIT 1")
    .get();
  return row ? row.dim : null;
}

export function ensureVecTable(dim) {
  const existing = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_chunks'"
    )
    .get();
  if (existing) {
    // Dimension changed: drop and rebuild (existing vectors are invalidated).
    const currentDim = getVecDim();
    if (currentDim !== dim) {
      db.exec("DROP TABLE IF EXISTS vec_chunks;");
    } else {
      return; // Already exists with correct dimension.
    }
  }
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks USING vec0(embedding float[${dim}]);`
  );
}

export function vecTableExists() {
  const row = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'vec_chunks'"
    )
    .get();
  return Boolean(row);
}
