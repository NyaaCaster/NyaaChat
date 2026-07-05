// Document CRUD endpoints.
// Mounted at / by server.js (kb & document routes share the router).
// All mutation routes require auth + kb ownership validation.

import { Router } from "express";
import { db, vecTableExists } from "../db.js";
import { requireAuth } from "../auth.js";
import { ingestDocument } from "../services/ingest.js";
import { isSupported, SUPPORTED_EXTENSIONS } from "../parsers/index.js";

export const documentsRouter = Router();

// --- helpers ---------------------------------------------------------------

function badRequest(res, error) {
  return res.status(400).json({ ok: false, error });
}

const getKb = db.prepare("SELECT * FROM knowledge_bases WHERE id = ?");
const listDocs = db.prepare(
  "SELECT * FROM documents WHERE kb_id = ? ORDER BY uploaded_at DESC"
);
const getDoc = db.prepare("SELECT * FROM documents WHERE id = ?");
const listChunks = db.prepare(
  "SELECT * FROM chunks WHERE doc_id = ? ORDER BY seq ASC"
);
const getChunkById = db.prepare("SELECT * FROM chunks WHERE id = ?");
const deleteDocById = db.prepare("DELETE FROM documents WHERE id = ?");
const updateKbCharTotal = db.prepare(
  `UPDATE knowledge_bases
      SET char_total = (SELECT COALESCE(SUM(char_count), 0) FROM chunks WHERE kb_id = ?),
          updated_at = ?
    WHERE id = ?`
);

function shapeDoc(row) {
  if (!row) return null;
  return {
    id: row.id,
    kbId: row.kb_id,
    name: row.name,
    ext: row.ext,
    sizeBytes: row.size_bytes,
    chunkCount: row.chunk_count,
    uploadedAt: row.uploaded_at,
  };
}

function shapeChunk(row) {
  if (!row) return null;
  return {
    id: row.id,
    docId: row.doc_id,
    kbId: row.kb_id,
    seq: row.seq,
    content: row.content,
    charCount: row.char_count,
    vectorId: row.vector_id,
  };
}

/** Verify the caller owns the KB (or 404/403). Returns the KB row. */
function requireKbOwnership(req, res) {
  const row = getKb.get(req.params.kbId);
  if (!row) {
    res.status(404).json({ ok: false, error: "not_found" });
    return null;
  }
  if (row.owner !== req.user.account) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return null;
  }
  return row;
}

/** Verify the caller owns the KB that the document belongs to (or 404/403). */
function requireDocOwnership(req, res) {
  const doc = getDoc.get(req.params.docId);
  if (!doc) {
    res.status(404).json({ ok: false, error: "not_found" });
    return null;
  }
  const kb = getKb.get(doc.kb_id);
  if (!kb || kb.owner !== req.user.account) {
    res.status(403).json({ ok: false, error: "forbidden" });
    return null;
  }
  return { doc, kb };
}

// --- GET /kb/:kbId/documents (auth) — list documents in a KB ---------------

documentsRouter.get("/kb/:kbId/documents", requireAuth, (req, res) => {
  const kb = requireKbOwnership(req, res);
  if (!kb) return;
  const rows = listDocs.all(req.params.kbId);
  return res.json({ ok: true, items: rows.map(shapeDoc) });
});

// --- POST /kb/:kbId/documents (auth) — upload + ingest documents -----------

documentsRouter.post("/kb/:kbId/documents", requireAuth, async (req, res) => {
  const kb = requireKbOwnership(req, res);
  if (!kb) return;

  // Accept base64-encoded files: { files: [{ filename, data }] }
  const files = req.body?.files;
  if (!Array.isArray(files) || files.length === 0) {
    return badRequest(res, "missing_files");
  }
  if (files.length > 10) {
    return badRequest(res, "一次最多只接受 10 个文档");
  }

  const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB per file

  const results = [];
  for (const file of files) {
    const filename = String(file?.filename ?? "").trim();
    const data = String(file?.data ?? "");

    if (!filename) {
      results.push({ filename: "(unknown)", ok: false, error: "缺少文件名" });
      continue;
    }
    if (!isSupported(filename)) {
      results.push({
        filename,
        ok: false,
        error: `不支持的文件格式（支持：${SUPPORTED_EXTENSIONS.join(", ")}）`,
      });
      continue;
    }

    let buffer;
    try {
      buffer = Buffer.from(data, "base64");
    } catch {
      results.push({ filename, ok: false, error: "base64 解码失败" });
      continue;
    }

    if (buffer.length > MAX_FILE_BYTES) {
      results.push({
        filename,
        ok: false,
        error: `文件过大（${(buffer.length / 1024 / 1024).toFixed(1)} MB），单个文档上限为 10 MB`,
      });
      continue;
    }

    try {
      const { document, chunk_count } = await ingestDocument({
        kbId: kb.id,
        owner: req.user.account,
        filename,
        buffer,
        chunkSize: kb.chunk_size,
        chunkOverlap: kb.chunk_overlap,
      });
      results.push({ filename, ok: true, document: shapeDoc(document), chunk_count });
    } catch (err) {
      results.push({ filename, ok: false, error: err.message });
    }
  }

  const anyOk = results.some((r) => r.ok);
  if (!anyOk) {
    const firstError = results.find((r) => !r.ok)?.error ?? "unknown";
    return res.status(400).json({ ok: false, error: firstError, results });
  }
  return res.status(201).json({ ok: true, results });
});

// --- GET /documents/:docId (auth) — get a single document ------------------

documentsRouter.get("/documents/:docId", requireAuth, (req, res) => {
  const result = requireDocOwnership(req, res);
  if (!result) return;
  return res.json({ ok: true, document: shapeDoc(result.doc) });
});

// --- DELETE /documents/:docId (auth) — delete a document + its chunks ------

documentsRouter.delete("/documents/:docId", requireAuth, (req, res) => {
  const result = requireDocOwnership(req, res);
  if (!result) return;

  const { doc, kb } = result;

  // Clean up vec/fts indexes before cascading deletes.
  const chunkIds = db.prepare(
    "SELECT id FROM chunks WHERE doc_id = ?"
  ).all(doc.id).map((r) => r.id);

  const tx = db.transaction(() => {
    for (const cid of chunkIds) {
      db.prepare("DELETE FROM chunks_fts WHERE rowid = ?").run(cid);
      if (vecTableExists()) {
        try {
          db.prepare("DELETE FROM vec_chunks WHERE rowid = ?").run(BigInt(cid));
        } catch { /* vec table may not exist */ }
      }
    }
    deleteDocById.run(doc.id); // cascades chunks
    updateKbCharTotal.run(kb.id, Date.now(), kb.id);
  });
  tx();

  return res.status(204).end();
});

// --- GET /documents/:docId/chunks (auth) — list chunks of a document -------

documentsRouter.get("/documents/:docId/chunks", requireAuth, (req, res) => {
  const result = requireDocOwnership(req, res);
  if (!result) return;
  const rows = listChunks.all(req.params.docId);
  return res.json({ ok: true, items: rows.map(shapeChunk) });
});

// --- GET /chunks/:chunkId (auth) — get a single chunk ----------------------

documentsRouter.get("/chunks/:chunkId", requireAuth, (req, res) => {
  const chunk = getChunkById.get(Number(req.params.chunkId));
  if (!chunk) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  // Verify ownership through the KB chain.
  const kb = getKb.get(chunk.kb_id);
  if (!kb || kb.owner !== req.user.account) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  return res.json({ ok: true, chunk: shapeChunk(chunk) });
});

// --- DELETE /chunks/:chunkId (auth) — delete a single chunk -----------------

documentsRouter.delete("/chunks/:chunkId", requireAuth, (req, res) => {
  const chunkId = Number(req.params.chunkId);
  const chunk = getChunkById.get(chunkId);
  if (!chunk) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  const kb = getKb.get(chunk.kb_id);
  if (!kb || kb.owner !== req.user.account) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM chunks_fts WHERE rowid = ?").run(chunkId);
    if (vecTableExists()) {
      try {
        db.prepare("DELETE FROM vec_chunks WHERE rowid = ?").run(BigInt(chunkId));
      } catch { /* vec table may not exist */ }
    }
    db.prepare("DELETE FROM chunks WHERE id = ?").run(chunkId);
    db.prepare(
      "UPDATE documents SET chunk_count = chunk_count - 1 WHERE id = ?"
    ).run(chunk.doc_id);
    updateKbCharTotal.run(kb.id, Date.now(), kb.id);
  });
  tx();

  return res.status(204).end();
});
