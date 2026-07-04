// Per-user embedding configuration endpoints.
// Mounted at /embedding-config by server.js; all routes require auth.
// api_key is NEVER returned to the frontend (D8 of audit report).

import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";
import { maskedConfig } from "../services/embedding-config.js";
import { detectDimension, healthCheck } from "../services/embedding.js";

export const embeddingRouter = Router();

// --- helpers ---------------------------------------------------------------

function badRequest(res, error) {
  return res.status(400).json({ ok: false, error });
}

const upsertConfig = db.prepare(`
  INSERT INTO embedding_configs (owner, base_url, api_key, model, dim, updated_at)
  VALUES (@owner, @base_url, @api_key, @model, @dim, @updated_at)
  ON CONFLICT(owner) DO UPDATE SET
    base_url = excluded.base_url,
    api_key = CASE WHEN excluded.api_key != '' THEN excluded.api_key ELSE embedding_configs.api_key END,
    model = excluded.model,
    dim = COALESCE(excluded.dim, embedding_configs.dim),
    updated_at = excluded.updated_at
`);

// --- GET /embedding-config (auth) ------------------------------------------
// Returns masked config — api_key is never sent to the frontend.

embeddingRouter.get("/", requireAuth, (req, res) => {
  const cfg = maskedConfig(req.user.account);
  if (!cfg) {
    return res.json({ ok: true, configured: false });
  }
  return res.json({ ok: true, configured: true, ...cfg });
});

// --- PUT /embedding-config (auth) ------------------------------------------
// Save base_url / model / api_key. If api_key is empty/missing, the existing
// stored key is preserved (so a masked round-trip from the UI doesn't wipe it).

embeddingRouter.put("/", requireAuth, (req, res) => {
  const { base_url, api_key, model } = req.body ?? {};
  if (!base_url || typeof base_url !== "string" || !base_url.trim()) {
    return badRequest(res, "missing_base_url");
  }
  if (!model || typeof model !== "string" || !model.trim()) {
    return badRequest(res, "missing_model");
  }

  const owner = req.user.account;
  const now = Date.now();

  try {
    upsertConfig.run({
      owner,
      base_url: base_url.trim(),
      api_key: (typeof api_key === "string" && api_key.trim()) ? api_key.trim() : "",
      model: model.trim(),
      dim: null, // dim is detected separately, don't wipe existing
      updated_at: now,
    });
  } catch {
    return res.status(500).json({ ok: false, error: "db_write_failed" });
  }

  const cfg = maskedConfig(owner);
  return res.json({ ok: true, ...cfg });
});

// --- POST /embedding-config/health-check (auth) ----------------------------
// Minimal probe of the embedding API using stored credentials.

embeddingRouter.post("/health-check", requireAuth, async (req, res) => {
  const owner = req.user.account;
  const cfg = maskedConfig(owner);
  if (!cfg) {
    return res.status(400).json({ ok: false, error: "not_configured" });
  }

  // Read stored api_key for the actual call (maskedConfig omits it).
  const row = db.prepare(
    "SELECT base_url, api_key, model FROM embedding_configs WHERE owner = ?"
  ).get(owner);
  if (!row) {
    return res.status(400).json({ ok: false, error: "not_configured" });
  }

  try {
    const result = await healthCheck(row);
    return res.json({ ok: true, dim: result.dim });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});

// --- POST /embedding-config/detect-dim (auth) ------------------------------
// Probe the API + persist the detected dimension. If the request body includes
// base_url / model / api_key, those are saved first (for not-yet-saved configs).

embeddingRouter.post("/detect-dim", requireAuth, async (req, res) => {
  const owner = req.user.account;
  const { base_url, api_key, model } = req.body ?? {};

  // Optionally save credentials before probing.
  if (base_url || model) {
    try {
      upsertConfig.run({
        owner,
        base_url: (base_url || "").trim(),
        api_key: (typeof api_key === "string" && api_key.trim()) ? api_key.trim() : "",
        model: (model || "").trim(),
        dim: null,
        updated_at: Date.now(),
      });
    } catch {
      return res.status(500).json({ ok: false, error: "db_write_failed" });
    }
  }

  const row = db.prepare(
    "SELECT base_url, api_key, model FROM embedding_configs WHERE owner = ?"
  ).get(owner);
  if (!row) {
    return res.status(400).json({ ok: false, error: "not_configured" });
  }

  try {
    const dim = await detectDimension(row);
    db.prepare(
      "UPDATE embedding_configs SET dim = ?, updated_at = ? WHERE owner = ?"
    ).run(dim, Date.now(), owner);
    return res.json({ ok: true, dim });
  } catch (err) {
    return res.status(502).json({ ok: false, error: err.message });
  }
});
