// Document ingestion pipeline: parse → chunk → embed → persist.
// Embedding (network) happens before the DB transaction so the write is
// all-or-nothing and never leaves a half-indexed document.
// Based on NyaaLibrary-MCP server/src/services/ingest.ts, with owner dimension.

import { randomUUID } from "node:crypto";
import { db, ensureVecTable, getVecDim } from "../db.js";
import { extractText, extOf } from "../parsers/index.js";
import { splitIntoChunks } from "./chunk.js";
import { embedMany } from "./embedding.js";
import { getEmbeddingConfig } from "./embedding-config.js";

const insertDoc = db.prepare(
  `INSERT INTO documents (id, kb_id, name, ext, size_bytes, chunk_count, uploaded_at)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
);
const insertChunk = db.prepare(
  `INSERT INTO chunks (doc_id, kb_id, seq, content, char_count, vector_id)
   VALUES (?, ?, ?, ?, ?, ?)`,
);
// vec_chunks is created lazily (ensureVecTable), so prepare on first use.
let _insertVec = null;
function getInsertVec() {
  if (!_insertVec) _insertVec = db.prepare("INSERT INTO vec_chunks (rowid, embedding) VALUES (?, ?)");
  return _insertVec;
}
const insertFts = db.prepare(
  "INSERT INTO chunks_fts (rowid, content) VALUES (?, ?)",
);
const touchKb = db.prepare(
  "UPDATE knowledge_bases SET updated_at = ?, char_total = (SELECT COALESCE(SUM(char_count), 0) FROM chunks WHERE kb_id = ?) WHERE id = ?",
);
const getDoc = db.prepare("SELECT * FROM documents WHERE id = ?");

/**
 * Ingest one document end-to-end.
 * @param {object} opts
 * @param {string} opts.kbId
 * @param {string} opts.owner       — account (for auth + embedding config lookup)
 * @param {string} opts.filename
 * @param {Buffer} opts.buffer
 * @param {number} opts.chunkSize
 * @param {number} opts.chunkOverlap
 * @returns {Promise<{document: object, chunk_count: number}>}
 */
export async function ingestDocument(opts) {
  const { kbId, owner, filename, buffer, chunkSize, chunkOverlap } = opts;

  // 1. Read per-user embedding config.
  const embCfg = getEmbeddingConfig(owner);
  if (!embCfg || !embCfg.dim || embCfg.dim <= 0) {
    throw new Error("尚未配置嵌入维度，请先在「嵌入模型设置」中保存并获取维度");
  }

  // 2. Parse text from document.
  const text = await extractText(filename, buffer);
  const chunks = splitIntoChunks(text, chunkSize, chunkOverlap);
  if (chunks.length === 0) {
    throw new Error("文档解析后无可索引内容（可能为空或无法提取文本）");
  }

  // 3. Embed all chunks (network — outside transaction).
  const embeddings = await embedMany(chunks, embCfg);
  if (embeddings.some((v) => !v || v.length !== embCfg.dim)) {
    throw new Error(`嵌入维度与配置不一致（期望 ${embCfg.dim}）`);
  }

  // 4. Ensure vec0 table exists with correct dimension.
  ensureVecTable(embCfg.dim);
  if (getVecDim() !== embCfg.dim) {
    throw new Error("向量表维度与当前嵌入维度不匹配");
  }

  // 5. Persist everything in a single transaction.
  const docId = randomUUID();
  const uploadedAt = Date.now();
  const ext = extOf(filename);
  const sizeBytes = buffer.length;

  const tx = db.transaction(() => {
    insertDoc.run(docId, kbId, filename, ext, sizeBytes, chunks.length, uploadedAt);
    chunks.forEach((content, seq) => {
      const info = insertChunk.run(
        docId, kbId, seq, content, content.length, randomUUID(),
      );
      const chunkId = Number(info.lastInsertRowid);
      // sqlite-vec requires rowid bound as a true integer; BigInt forces
      // better-sqlite3 to bind it as INTEGER rather than float.
      getInsertVec().run(BigInt(chunkId), JSON.stringify(embeddings[seq]));
      insertFts.run(chunkId, content);
    });
    touchKb.run(uploadedAt, kbId, kbId);
  });
  tx();

  const document = getDoc.get(docId);
  return { document, chunk_count: chunks.length };
}
