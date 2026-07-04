// Knowledge base CRUD endpoints.
// Mounted at /kb by server.js; all routes require auth.
// All queries are scoped to the authenticated owner.

import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";

export const kbRouter = Router();

// --- defaults --------------------------------------------------------------
const DEFAULT_CHUNK_SIZE = 512;
const DEFAULT_CHUNK_OVERLAP = 50;
const DEFAULT_DENSE_TOP_K = 50;
const DEFAULT_SPARSE_TOP_K = 50;

// --- helpers ---------------------------------------------------------------

function badRequest(res, error) {
  return res.status(400).json({ ok: false, error });
}

// --- prepared statements ---------------------------------------------------

const listKb = db.prepare(`
  SELECT kb.*,
    (SELECT COUNT(*) FROM documents d WHERE d.kb_id = kb.id) AS document_count,
    (SELECT COUNT(*) FROM chunks c WHERE c.kb_id = kb.id) AS chunk_count
    FROM knowledge_bases kb
   WHERE kb.owner = ?
   ORDER BY kb.created_at DESC
`);

const getKb = db.prepare(`
  SELECT kb.*,
    (SELECT COUNT(*) FROM documents d WHERE d.kb_id = kb.id) AS document_count,
    (SELECT COUNT(*) FROM chunks c WHERE c.kb_id = kb.id) AS chunk_count
    FROM knowledge_bases kb
   WHERE kb.id = ?
`);

const insertKb = db.prepare(`
  INSERT INTO knowledge_bases
    (id, owner, name, description, chunk_size, chunk_overlap,
     dense_top_k, sparse_top_k, char_total, enabled, created_at, updated_at)
  VALUES (@id, @owner, @name, @description, @chunk_size, @chunk_overlap,
          @dense_top_k, @sparse_top_k, 0, 1, @created_at, @updated_at)
`);

const updateKbStmt = db.prepare(`
  UPDATE knowledge_bases SET
    name = @name, description = @description,
    chunk_size = @chunk_size, chunk_overlap = @chunk_overlap,
    dense_top_k = @dense_top_k, sparse_top_k = @sparse_top_k,
    updated_at = @updated_at
  WHERE id = @id AND owner = @owner
`);

const deleteKbStmt = db.prepare("DELETE FROM knowledge_bases WHERE id = ? AND owner = ?");
const deleteBindings = db.prepare("DELETE FROM character_kb_bindings WHERE kb_id = ?");

function shapeKb(row) {
  if (!row) return null;
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    description: row.description,
    chunkSize: row.chunk_size,
    chunkOverlap: row.chunk_overlap,
    denseTopK: row.dense_top_k,
    sparseTopK: row.sparse_top_k,
    charTotal: row.char_total,
    enabled: !!row.enabled,
    documentCount: row.document_count,
    chunkCount: row.chunk_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// --- GET /kb (auth) — list user's knowledge bases --------------------------

kbRouter.get("/", requireAuth, (req, res) => {
  const rows = listKb.all(req.user.account);
  return res.json({ ok: true, items: rows.map(shapeKb) });
});

// --- POST /kb (auth) — create a knowledge base -----------------------------

kbRouter.post("/", requireAuth, (req, res) => {
  const name = String(req.body?.name ?? "").trim();
  const description = String(req.body?.description ?? "").trim();

  if (!name || name.length > 200) {
    return badRequest(res, "invalid_name");
  }

  const now = Date.now();
  const id = randomUUID();
  try {
    insertKb.run({
      id,
      owner: req.user.account,
      name,
      description,
      chunk_size: DEFAULT_CHUNK_SIZE,
      chunk_overlap: DEFAULT_CHUNK_OVERLAP,
      dense_top_k: DEFAULT_DENSE_TOP_K,
      sparse_top_k: DEFAULT_SPARSE_TOP_K,
      created_at: now,
      updated_at: now,
    });
  } catch {
    return res.status(500).json({ ok: false, error: "db_write_failed" });
  }

  const row = getKb.get(id);
  return res.status(201).json({ ok: true, kb: shapeKb(row) });
});

// --- GET /kb/:kbId (auth) — get a single knowledge base --------------------

kbRouter.get("/:kbId", requireAuth, (req, res) => {
  const row = getKb.get(req.params.kbId);
  if (!row) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  if (row.owner !== req.user.account) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  return res.json({ ok: true, kb: shapeKb(row) });
});

// --- PATCH /kb/:kbId (auth) — update a knowledge base ----------------------

kbRouter.patch("/:kbId", requireAuth, (req, res) => {
  const row = getKb.get(req.params.kbId);
  if (!row) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  if (row.owner !== req.user.account) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const patch = req.body ?? {};
  const params = {
    id: row.id,
    owner: req.user.account,
    name: typeof patch.name === "string" && patch.name.trim() ? patch.name.trim() : row.name,
    description: typeof patch.description === "string" ? patch.description.trim() : row.description,
    chunk_size: Number.isFinite(patch.chunk_size) && patch.chunk_size > 0
      ? Math.floor(patch.chunk_size) : row.chunk_size,
    chunk_overlap: Number.isFinite(patch.chunk_overlap) && patch.chunk_overlap >= 0
      ? Math.floor(patch.chunk_overlap) : row.chunk_overlap,
    dense_top_k: Number.isFinite(patch.dense_top_k) && patch.dense_top_k > 0
      ? Math.floor(patch.dense_top_k) : row.dense_top_k,
    sparse_top_k: Number.isFinite(patch.sparse_top_k) && patch.sparse_top_k > 0
      ? Math.floor(patch.sparse_top_k) : row.sparse_top_k,
    updated_at: Date.now(),
  };

  try {
    updateKbStmt.run(params);
  } catch {
    return res.status(500).json({ ok: false, error: "db_write_failed" });
  }

  const updated = getKb.get(row.id);
  return res.json({ ok: true, kb: shapeKb(updated) });
});

// --- DELETE /kb/:kbId (auth) — delete a knowledge base ---------------------

kbRouter.delete("/:kbId", requireAuth, (req, res) => {
  const row = getKb.get(req.params.kbId);
  if (!row) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  if (row.owner !== req.user.account) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  // Clean up vec/fts indexes before cascading deletes.
  const chunkIds = db.prepare(
    "SELECT id FROM chunks WHERE kb_id = ?"
  ).all(row.id).map((r) => r.id);

  const tx = db.transaction(() => {
    for (const cid of chunkIds) {
      db.prepare("DELETE FROM chunks_fts WHERE rowid = ?").run(cid);
      try {
        db.prepare("DELETE FROM vec_chunks WHERE rowid = ?").run(BigInt(cid));
      } catch { /* vec table may not exist */ }
    }
    deleteBindings.run(row.id);
    deleteKbStmt.run(row.id, req.user.account);
  });
  tx();

  return res.status(204).end();
});
