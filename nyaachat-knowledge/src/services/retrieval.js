// Hybrid retrieval: dense (sqlite-vec KNN) + sparse (FTS5 BM25), fused with
// Reciprocal Rank Fusion, returning the top `topK` chunks for a knowledge base.
// Based on NyaaLibrary-MCP server/src/services/retrieval.ts, with owner isolation.

import { db, vecTableExists } from "../db.js";
import { embedTexts } from "./embedding.js";
import { getEmbeddingConfig } from "./embedding-config.js";

const RRF_K = 60;

const getChunk = db.prepare(
  `SELECT c.id AS chunk_id, c.doc_id, c.seq, c.content, c.char_count,
          d.name AS document_name
     FROM chunks c JOIN documents d ON d.id = c.doc_id
    WHERE c.id = ?`,
);

/**
 * Hybrid retrieval for a knowledge base.
 * @param {string} kbId
 * @param {string} owner  — authenticated account (for embedding config + isolation)
 * @param {string} query
 * @param {number} topK
 * @returns {Promise<Array<{chunk_id:number, doc_id:string, document_name:string, seq:number, content:string, char_count:number, score:number}>>}
 */
export async function searchKnowledgeBase(kbId, owner, query, topK) {
  const q = query.trim();
  if (!q) return [];

  // Look up embedding config for query embedding.
  const embCfg = getEmbeddingConfig(owner);

  // ---- Dense ranking (sqlite-vec KNN) ----
  const denseRanks = new Map();
  if (vecTableExists() && embCfg) {
    try {
      const [embedding] = await embedTexts([q], embCfg);
      if (embedding) {
        const rows = db
          .prepare(
            `WITH knn AS (
               SELECT rowid AS chunk_id, distance
               FROM vec_chunks
               WHERE embedding MATCH ? AND k = ?
             )
             SELECT knn.chunk_id
               FROM knn
               JOIN chunks c ON c.id = knn.chunk_id
              WHERE c.kb_id = ?
              ORDER BY knn.distance`,
          )
          .all(JSON.stringify(embedding), 50, kbId);
        rows.forEach((r, i) => denseRanks.set(r.chunk_id, i + 1));
      }
    } catch (err) {
      // Embedding not configured / unreachable → fall back to sparse-only.
      console.warn("[retrieval] dense stage skipped:", err.message);
    }
  }

  // ---- Sparse ranking (FTS5 BM25) ----
  const sparseRanks = new Map();
  try {
    const rows = db
      .prepare(
        `SELECT f.rowid AS chunk_id
           FROM chunks_fts f
           JOIN chunks c ON c.id = f.rowid
          WHERE c.kb_id = ? AND f.content MATCH ?
          ORDER BY bm25(chunks_fts)
          LIMIT ?`,
      )
      .all(kbId, q, 50);
    rows.forEach((r, i) => sparseRanks.set(r.chunk_id, i + 1));
  } catch {
    // FTS MATCH can throw on certain query syntax; ignore and rely on dense.
  }

  // ---- Reciprocal Rank Fusion ----
  const fused = new Map();
  for (const [id, rank] of denseRanks)
    fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank));
  for (const [id, rank] of sparseRanks)
    fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank));

  const ranked = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK);
  if (ranked.length === 0) return [];

  return ranked.map(([chunkId, score]) => {
    const row = getChunk.get(chunkId);
    if (!row) return null;
    return { ...row, score };
  }).filter(Boolean);
}
