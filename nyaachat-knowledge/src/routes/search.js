// Search / hybrid retrieval endpoints.
// Mounted at /search by server.js; requires auth.

import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";
import { searchKnowledgeBase } from "../services/retrieval.js";

export const searchRouter = Router();

const getKb = db.prepare("SELECT * FROM knowledge_bases WHERE id = ?");

/**
 * Verify the authenticated user has access to this KB.
 *
 * Path 1 (P1): owner — the user created this KB.
 * Path 2 (P2): shared-card binding — via character_kb_bindings table.
 *   Binding rows are populated during card publish (P6). Until then, this
 *   path correctly returns "forbidden" for non-owners because no bindings
 *   exist yet.
 */
function checkKbAccess(kb, account) {
  if (!kb) return "not_found";
  if (kb.owner === account) return null; // path 1: owner

  // path 2: character_kb_bindings — shared-card read-only access
  const binding = db.prepare(
    "SELECT 1 FROM character_kb_bindings WHERE kb_id = ? LIMIT 1",
  ).get(kb.id);
  if (binding) return null; // authorized via shared-card binding

  return "forbidden";
}

// --- POST /search (auth) — hybrid RRF retrieval ----------------------------

searchRouter.post("/", requireAuth, async (req, res) => {
  const kbId = String(req.body?.kb_id ?? "").trim();
  const query = String(req.body?.query ?? "").trim();
  const topK = Number.isFinite(req.body?.top_k) && req.body?.top_k > 0
    ? Math.min(Math.floor(req.body.top_k), 50)
    : 5;

  if (!kbId) {
    return res.status(400).json({ ok: false, error: "missing_kb_id" });
  }
  if (!query) {
    return res.status(400).json({ ok: false, error: "empty_query" });
  }

  const kb = getKb.get(kbId);
  const accessError = checkKbAccess(kb, req.user.account);
  if (accessError === "not_found") {
    return res.status(404).json({ ok: false, error: "not_found" });
  }
  if (accessError === "forbidden") {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  try {
    const results = await searchKnowledgeBase(kbId, req.user.account, query, topK);
    return res.json({ ok: true, count: results.length, results });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});
