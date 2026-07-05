// Internal binding-management endpoints (P6).
//
// These are NOT proxied through the public nginx. They are called directly by the
// shared-server container inside the Docker network (nyaachat-net) to manage
// character_kb_bindings rows when characters are published, updated, or deleted.
//
// Auth is via a shared secret (INTERNAL_API_TOKEN env var), checked in the
// X-Internal-Token request header. Without a configured token, all endpoints
// return 403 — the shared-server treats binding sync as best-effort and logs
// warnings, so publish/update/delete still succeed without it.

import { Router } from "express";
import { db } from "../db.js";

export const internalRouter = Router();

const INTERNAL_TOKEN = process.env.INTERNAL_API_TOKEN || "";

if (!INTERNAL_TOKEN) {
  console.warn("[internal] INTERNAL_API_TOKEN is not set — internal endpoints will reject all requests");
}

function requireInternal(req, res, next) {
  const token = (req.get("x-internal-token") || "").trim();
  if (!INTERNAL_TOKEN || token !== INTERNAL_TOKEN) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  next();
}

const deleteBindings = db.prepare(
  "DELETE FROM character_kb_bindings WHERE global_id = ?",
);
const upsertBinding = db.prepare(
  "INSERT OR REPLACE INTO character_kb_bindings (global_id, kb_id, owner) VALUES (?, ?, ?)",
);

// POST /internal/bindings — upsert bindings for one shared character.
// Body: { global_id: string, kb_ids: string[], owner: string }
// Replaces ALL bindings for this global_id in a single transaction.
internalRouter.post("/bindings", requireInternal, (req, res) => {
  const { global_id, kb_ids = [], owner } = req.body ?? {};
  if (!global_id || !owner) {
    return res.status(400).json({ ok: false, error: "missing_fields" });
  }
  if (!Array.isArray(kb_ids)) {
    return res.status(400).json({ ok: false, error: "invalid_kb_ids" });
  }

  const tx = db.transaction(() => {
    deleteBindings.run(global_id);
    for (const kbId of kb_ids) {
      if (typeof kbId === "string" && kbId.trim()) {
        upsertBinding.run(global_id, kbId.trim(), owner);
      }
    }
  });
  tx();
  return res.json({ ok: true });
});

// DELETE /internal/bindings/:globalId — remove all bindings for a shared character.
// Idempotent: succeeds even if no bindings exist.
internalRouter.delete("/bindings/:globalId", requireInternal, (req, res) => {
  deleteBindings.run(req.params.globalId);
  return res.json({ ok: true });
});
