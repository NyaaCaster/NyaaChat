// NyaaChat knowledge base backend — entry point.
//
// Deliberately headless: no presentation pages, only a /health probe. The
// frontend reaches this service same-origin through the main nginx at
// /api/knowledge/* — see nginx.conf and docker-compose.knowledge.yml.

import express from "express";
import { db } from "./db.js";
import { requireAuth } from "./auth.js";
import { embeddingRouter } from "./routes/embedding.js";
import { kbRouter } from "./routes/kb.js";
import { documentsRouter } from "./routes/documents.js";
import { searchRouter } from "./routes/search.js";

const PORT = Number(process.env.PORT) || 5108;

const app = express();
app.use(express.json({ limit: "120mb" })); // document uploads + bulk ingest headroom

// Health probe. Public, unauthenticated. Verifies the sqlite handle responds.
app.get("/health", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ ok: true, service: "nyaachat-knowledge", db: "ok", time: Date.now() });
  } catch (err) {
    res.status(500).json({ ok: false, service: "nyaachat-knowledge", db: "error", error: String(err) });
  }
});

// Auth check probe — returns 200 with user info when given a valid token,
// 401 otherwise. Useful for the frontend to verify the auth chain works.
app.get("/auth-check", requireAuth, (req, res) => {
  res.json({ ok: true, account: req.user.account, username: req.user.username });
});

// ---- P1 routes (all require auth) -----------------------------------------

app.use("/embedding-config", embeddingRouter);
app.use("/kb", kbRouter);
// Documents router handles /kb/:kbId/documents, /documents/:docId, /chunks/:chunkId
app.use("/", documentsRouter);
app.use("/search", searchRouter);

app.listen(PORT, () => {
  console.log(`[nyaachat-knowledge] listening on :${PORT}`);
});
