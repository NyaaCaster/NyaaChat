// Character publish + cover routes for the shared-character backend (phase 2).
//
// Mounted by server.js; reached from the browser same-origin via the main nginx
// as /api/shared/characters/* and /api/shared/covers/*. Publishing a card writes
// one row into shared_characters and drops the (re-encoded, pure) WebP cover onto
// the host bind mount under COVERS_DIR, named by global_id.
//
// Cover safety (SSOT §5.3): the cover that lands on disk must NOT embed the
// character json (a PNG tEXt-chunk card would let anyone steal the design just by
// downloading the image). The frontend already re-encodes the cover through a
// canvas to a clean WebP before upload; here we additionally verify the bytes are
// really a RIFF/WEBP container and never accept anything else.

import { Router } from "express";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { db } from "../db.js";
import { requireAuth } from "../auth.js";

const COVERS_DIR = process.env.COVERS_DIR || "./data/covers";
mkdirSync(COVERS_DIR, { recursive: true });

// --- validation limits ----------------------------------------------------
const INTRO_MAX = 100; // counted by Unicode code points, per the design
const TAG_MAX_LEN = 20; // per-tag code points
const TAGS_MAX = 20; // number of tags
const COVER_MAX_BYTES = 4 * 1024 * 1024; // generous ceiling for a 512x768 webp
const CARD_JSON_MAX = 2 * 1024 * 1024; // card json text ceiling

function badRequest(res, error) {
  return res.status(400).json({ ok: false, error });
}

/** Code-point length (so emoji / CJK count as one, matching the UI counter). */
function cpLen(str) {
  return [...str].length;
}

/** A non-negative integer price (free / not-for-sale is 0). */
function isPrice(n) {
  return Number.isInteger(n) && n >= 0;
}

/** Verify a buffer begins with a RIFF....WEBP container header. */
function isWebp(buf) {
  return (
    buf.length > 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && // "RIFF"
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50 // "WEBP"
  );
}

// --- statements -----------------------------------------------------------
const insertCharacter = db.prepare(`
  INSERT INTO shared_characters
    (global_id, owner, author, name, source, intro, tags,
     use_price, buyout_price, card_json, cover_ext,
     downloads, likes, dislikes, created_at, updated_at)
  VALUES
    (@global_id, @owner, @author, @name, @source, @intro, @tags,
     @use_price, @buyout_price, @card_json, @cover_ext,
     0, 0, 0, @created_at, @updated_at)
`);
const getCover = db.prepare(
  "SELECT cover_ext FROM shared_characters WHERE global_id = ?",
);

/** Mint a fresh global id. Never reused/changed after delete (SSOT #182), so a
 *  random 16-byte hex is fine — collisions are astronomically unlikely and the
 *  PK insert would reject one anyway. */
function newGlobalId() {
  return randomBytes(16).toString("hex");
}

// --- /characters ----------------------------------------------------------
export const charactersRouter = Router();

// POST /characters (auth)
// body: { source, intro?, tags?, usePrice, buyoutPrice, cardJson, coverBase64 }
//   cardJson    — ST-format card as a STRING (the character name is read from it)
//   coverBase64 — re-encoded pure WebP cover, base64 (no data: prefix)
charactersRouter.post("/", requireAuth, (req, res) => {
  const body = req.body ?? {};

  // source
  const source = String(body.source ?? "");
  if (source !== "original" && source !== "reposted") {
    return badRequest(res, "invalid_source");
  }

  // intro (<=100 code points; optional)
  const intro = String(body.intro ?? "").trim();
  if (cpLen(intro) > INTRO_MAX) {
    return badRequest(res, "invalid_intro");
  }

  // tags: array of non-empty trimmed strings, de-duped, bounded
  const tags = [];
  if (Array.isArray(body.tags)) {
    const seen = new Set();
    for (const raw of body.tags) {
      const t = String(raw ?? "").trim();
      if (!t) continue;
      if (cpLen(t) > TAG_MAX_LEN) return badRequest(res, "invalid_tag");
      if (seen.has(t)) continue;
      seen.add(t);
      tags.push(t);
      if (tags.length > TAGS_MAX) return badRequest(res, "too_many_tags");
    }
  }

  // prices
  const usePrice = Number(body.usePrice);
  const buyoutPrice = Number(body.buyoutPrice);
  if (!isPrice(usePrice) || !isPrice(buyoutPrice)) {
    return badRequest(res, "invalid_price");
  }

  // card json: must be a parseable object carrying a non-empty name
  const cardJson = String(body.cardJson ?? "");
  if (!cardJson || cardJson.length > CARD_JSON_MAX) {
    return badRequest(res, "invalid_card");
  }
  let parsed;
  try {
    parsed = JSON.parse(cardJson);
  } catch {
    return badRequest(res, "invalid_card");
  }
  // Character name lives at the top level or under data.* (chara_card_v3).
  const name = String(parsed?.name ?? parsed?.data?.name ?? "").trim();
  if (!name) {
    return badRequest(res, "invalid_card");
  }

  // cover: required, must decode to a real WebP container
  const coverBase64 = String(body.coverBase64 ?? "");
  if (!coverBase64) {
    return badRequest(res, "missing_cover");
  }
  let coverBuf;
  try {
    coverBuf = Buffer.from(coverBase64, "base64");
  } catch {
    return badRequest(res, "invalid_cover");
  }
  if (!coverBuf.length || coverBuf.length > COVER_MAX_BYTES || !isWebp(coverBuf)) {
    return badRequest(res, "invalid_cover");
  }

  // Allocate id + write the cover file first; only commit the DB row if the file
  // lands, so we never reference a missing cover.
  const globalId = newGlobalId();
  const coverPath = join(COVERS_DIR, `${globalId}.webp`);
  try {
    writeFileSync(coverPath, coverBuf);
  } catch {
    return res.status(500).json({ ok: false, error: "cover_write_failed" });
  }

  const now = Date.now();
  try {
    insertCharacter.run({
      global_id: globalId,
      owner: req.user.account,
      author: req.user.username, // share UI has no author field; use display name
      name,
      source,
      intro,
      tags: JSON.stringify(tags),
      use_price: usePrice,
      buyout_price: buyoutPrice,
      card_json: cardJson,
      cover_ext: "webp",
      created_at: now,
      updated_at: now,
    });
  } catch {
    return res.status(500).json({ ok: false, error: "db_write_failed" });
  }

  return res.json({ ok: true, globalId });
});

// --- /covers --------------------------------------------------------------
// GET /covers/:id — public, unauthenticated. Serves the stored pure WebP.
// Reached same-origin as /api/shared/covers/<id>. The cover is intentionally
// json-free (re-encoded), so exposing it carries no design-theft risk.
export const coversRouter = Router();
coversRouter.get("/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  // global_id is hex; reject anything else so a path can't escape COVERS_DIR.
  if (!/^[a-f0-9]{1,64}$/.test(id)) {
    return res.status(404).end();
  }
  const row = getCover.get(id);
  if (!row || !row.cover_ext) {
    return res.status(404).end();
  }
  const coverPath = join(COVERS_DIR, `${id}.${row.cover_ext}`);
  if (!existsSync(coverPath)) {
    return res.status(404).end();
  }
  try {
    const buf = readFileSync(coverPath);
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.end(buf);
  } catch {
    return res.status(404).end();
  }
});
