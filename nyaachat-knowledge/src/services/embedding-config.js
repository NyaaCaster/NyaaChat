// Per-user embedding configuration — reads from the `embedding_configs` table
// (one row per owner). Unlike NyaaLibrary-MCP's global settings table, each
// user has their own base_url / api_key / model / dim. api_key is NEVER
// returned to the frontend.

import { db } from "../db.js";

const stmtGet = db.prepare(
  "SELECT base_url, api_key, model, dim FROM embedding_configs WHERE owner = ?"
);

/** Read embedding config for a user. Returns null if not configured. */
export function getEmbeddingConfig(owner) {
  const row = stmtGet.get(owner);
  if (!row) return null;
  return {
    base_url: row.base_url,
    api_key: row.api_key,
    model: row.model,
    dim: row.dim || 0,
  };
}

/** Return a masked version safe for frontend transport (no api_key). */
export function maskedConfig(owner) {
  const cfg = getEmbeddingConfig(owner);
  if (!cfg) return null;
  return {
    base_url: cfg.base_url,
    model: cfg.model,
    dim: cfg.dim,
    api_key_set: cfg.api_key.length > 0,
  };
}
