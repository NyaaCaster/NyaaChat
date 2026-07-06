// Internal service-to-service endpoints.
//
// These endpoints are NOT exposed through the public nginx at /api/shared/*.
// They are called directly by sibling containers inside the Docker network
// (nyaachat-net) — currently the knowledge base backend uses /internal/validate-token
// to verify bearer tokens without reading the shared DB file directly.
//
// Auth is via a shared secret (INTERNAL_API_TOKEN env var) carried in the
// X-Internal-Token request header. Without a configured token, all endpoints
// return 403.

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

const findSession = db.prepare(
  "SELECT account FROM sessions WHERE token = ?",
);
const findUser = db.prepare("SELECT * FROM users WHERE account = ?");

// POST /internal/validate-token — validate a bearer token and return the user row.
// Body: { token: string }
// Returns { ok: true, user: { account, kb_max, ... } } on success,
// or { ok: false, error: "unauthorized" | "user_not_found" }.
internalRouter.post("/validate-token", requireInternal, (req, res) => {
  const token = (req.body?.token ?? "").trim();
  if (!token) {
    return res.status(400).json({ ok: false, error: "missing_token" });
  }

  const session = findSession.get(token);
  if (!session) {
    return res.json({ ok: false, error: "unauthorized" });
  }

  const user = findUser.get(session.account);
  if (!user) {
    return res.json({ ok: false, error: "user_not_found" });
  }

  return res.json({ ok: true, user });
});
