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
import { requireAuth, resolveUser } from "../auth.js";

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

/** Escape LIKE wildcards so a user's literal % or _ doesn't act as a pattern.
 *  Used together with `ESCAPE '\'` on the LIKE clause, so a search for "50%"
 *  matches the literal text rather than everything. */
function escapeLike(str) {
  return str.replace(/[\\%_]/g, "\\$&");
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
// Publish an update to an existing card (phase 5b). The author may revise the
// public-facing metadata and the card itself; owner/global_id/created_at/counts
// are immutable. updated_at is bumped so holders see the update badge next time.
const updateCharacter = db.prepare(`
  UPDATE shared_characters SET
    author = @author, name = @name, source = @source, intro = @intro,
    tags = @tags, use_price = @use_price, buyout_price = @buyout_price,
    card_json = @card_json, cover_ext = @cover_ext, updated_at = @updated_at
  WHERE global_id = @global_id
`);
const getCover = db.prepare(
  "SELECT cover_ext FROM shared_characters WHERE global_id = ?",
);

// Acquire (use / buyout). The full card row including card_json — only handed
// out at acquisition time, never in the browse listing (phase 3 withholds the
// design until a real use/buyout).
const getFullCharacter = db.prepare(
  "SELECT * FROM shared_characters WHERE global_id = ?",
);
const bumpDownloads = db.prepare(
  "UPDATE shared_characters SET downloads = downloads + 1 WHERE global_id = ?",
);
const getUserByAccount = db.prepare("SELECT * FROM users WHERE account = ?");
// Settlement halves: the buyer pays (catfood down, spent up), the author earns
// (catfood up, earned up). Run together in one transaction.
const debitBuyer = db.prepare(
  "UPDATE users SET catfood = catfood - @amount, spent_total = spent_total + @amount WHERE account = @account",
);
const creditAuthor = db.prepare(
  "UPDATE users SET catfood = catfood + @amount, earned_total = earned_total + @amount WHERE account = @account",
);

// Ratings (phase 4). One row per (account, global_id); like/dislike are mutually
// exclusive via the PK, and value 0 means "cleared" (the row is deleted).
const upsertRating = db.prepare(
  "INSERT OR REPLACE INTO ratings (account, global_id, value) VALUES (@account, @global_id, @value)",
);
const deleteRating = db.prepare(
  "DELETE FROM ratings WHERE account = @account AND global_id = @global_id",
);
// Recompute the cached like/dislike counters on the character row from the
// authoritative ratings table (cheap: tiny table, indexed by PK).
const recountRatings = db.prepare(`
  UPDATE shared_characters SET
    likes    = (SELECT COUNT(*) FROM ratings WHERE global_id = @global_id AND value = 1),
    dislikes = (SELECT COUNT(*) FROM ratings WHERE global_id = @global_id AND value = -1)
  WHERE global_id = @global_id
`);
const getCounts = db.prepare(
  "SELECT likes, dislikes FROM shared_characters WHERE global_id = ?",
);
const characterExists = db.prepare(
  "SELECT 1 FROM shared_characters WHERE global_id = ?",
);
const listMyRatings = db.prepare(
  "SELECT global_id, value FROM ratings WHERE account = ?",
);

// Browse listing (phase 3). card_json is deliberately omitted: the library view
// only needs summary fields, and withholding the full card keeps payloads small
// and avoids handing out the design before a use/buyout (covers stay json-free).
const LIST_COLUMNS = `
  global_id, owner, author, name, source, intro, tags,
  use_price, buyout_price, downloads, likes, dislikes,
  created_at, updated_at
`;
const LIST_LIMIT = 200; // small library for now; a hard ceiling, not pagination

// Whitelisted sort keys → real columns (never interpolate user input as SQL).
const SORT_COLUMNS = {
  updated: "updated_at",
  downloads: "downloads",
  likes: "likes",
  dislikes: "dislikes",
};

// Distinct tag list across the whole library (json_each explodes each row's
// JSON tags array; DISTINCT de-dupes). Drives the library's tag filter.
const listTags = db.prepare(`
  SELECT DISTINCT je.value AS tag
  FROM shared_characters, json_each(shared_characters.tags) AS je
  WHERE je.value IS NOT NULL AND je.value <> ''
  ORDER BY je.value COLLATE NOCASE ASC
`);

/** Shape a DB row into the browse summary (parse tags JSON, drop nothing else). */
function summaryOf(row) {
  return {
    globalId: row.global_id,
    owner: row.owner,
    author: row.author,
    name: row.name,
    source: row.source,
    intro: row.intro,
    tags: parseTags(row.tags),
    usePrice: row.use_price,
    buyoutPrice: row.buyout_price,
    downloads: row.downloads,
    likes: row.likes,
    dislikes: row.dislikes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Parse a row's tags JSON column into a string array (empty on any failure). */
function parseTags(raw) {
  try {
    const parsed = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Shape a full DB row into the acquire / read-only card response. Carries the
 *  full card_json PLUS the public metadata an author needs to pre-fill the share
 *  界面 when publishing an update (owner / tags / prices). owner lets the client
 *  decide whether the logged-in user may edit (owner === account). */
function cardResponseOf(row) {
  return {
    globalId: row.global_id,
    owner: row.owner,
    name: row.name,
    author: row.author,
    source: row.source,
    intro: row.intro,
    tags: parseTags(row.tags),
    usePrice: row.use_price,
    buyoutPrice: row.buyout_price,
    cardJson: row.card_json,
    updatedAt: row.updated_at,
  };
}

/** Mint a fresh global id. Never reused/changed after delete (SSOT #182), so a
 *  random 16-byte hex is fine — collisions are astronomically unlikely and the
 *  PK insert would reject one anyway. */
function newGlobalId() {
  return randomBytes(16).toString("hex");
}
/** Validate + normalize a publish/update body. Returns either { error } (a
 *  client-error code to send as 400) or { value } with the cleaned fields
 *  (source, intro, tags, usePrice, buyoutPrice, cardJson, name, coverBuf).
 *  Shared by POST / (publish) and PUT /:id (publish update) so both apply the
 *  exact same rules. */
function validateCharacterInput(body) {
  const b = body ?? {};

  const source = String(b.source ?? "");
  if (source !== "original" && source !== "reposted") return { error: "invalid_source" };

  const intro = String(b.intro ?? "").trim();
  if (cpLen(intro) > INTRO_MAX) return { error: "invalid_intro" };

  const tags = [];
  if (Array.isArray(b.tags)) {
    const seen = new Set();
    for (const raw of b.tags) {
      const t = String(raw ?? "").trim();
      if (!t) continue;
      if (cpLen(t) > TAG_MAX_LEN) return { error: "invalid_tag" };
      if (seen.has(t)) continue;
      seen.add(t);
      tags.push(t);
      if (tags.length > TAGS_MAX) return { error: "too_many_tags" };
    }
  }

  const usePrice = Number(b.usePrice);
  const buyoutPrice = Number(b.buyoutPrice);
  if (!isPrice(usePrice) || !isPrice(buyoutPrice)) return { error: "invalid_price" };

  const cardJson = String(b.cardJson ?? "");
  if (!cardJson || cardJson.length > CARD_JSON_MAX) return { error: "invalid_card" };
  let parsed;
  try {
    parsed = JSON.parse(cardJson);
  } catch {
    return { error: "invalid_card" };
  }
  // Character name lives at the top level or under data.* (chara_card_v3).
  const name = String(parsed?.name ?? parsed?.data?.name ?? "").trim();
  if (!name) return { error: "invalid_card" };

  // cover: required, must decode to a real WebP container
  const coverBase64 = String(b.coverBase64 ?? "");
  if (!coverBase64) return { error: "missing_cover" };
  let coverBuf;
  try {
    coverBuf = Buffer.from(coverBase64, "base64");
  } catch {
    return { error: "invalid_cover" };
  }
  if (!coverBuf.length || coverBuf.length > COVER_MAX_BYTES || !isWebp(coverBuf)) {
    return { error: "invalid_cover" };
  }

  return { value: { source, intro, tags, usePrice, buyoutPrice, cardJson, name, coverBuf } };
}

// --- /characters ----------------------------------------------------------
export const charactersRouter = Router();

// POST /characters (auth)
// body: { source, intro?, tags?, usePrice, buyoutPrice, cardJson, coverBase64 }
//   cardJson    — ST-format card as a STRING (the character name is read from it)
//   coverBase64 — re-encoded pure WebP cover, base64 (no data: prefix)
charactersRouter.post("/", requireAuth, (req, res) => {
  const v = validateCharacterInput(req.body);
  if (v.error) return badRequest(res, v.error);
  const { source, intro, tags, usePrice, buyoutPrice, cardJson, name, coverBuf } = v.value;

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

// GET /characters/tags — public. Distinct tag list across the whole library,
// driving the browse filter. Kept beside the list route so both browse
// endpoints live together.
charactersRouter.get("/tags", (_req, res) => {
  try {
    const rows = listTags.all();
    return res.json({ ok: true, tags: rows.map((r) => r.tag) });
  } catch {
    return res.status(500).json({ ok: false, error: "db_read_failed" });
  }
});

// GET /characters — public browse listing (phase 3).
// query: q?, tag?, author?, sort? (updated|downloads|likes|dislikes), order? (desc|asc)
//   q      — free text matched against name / author / intro / tags (LIKE)
//   tag    — exact tag filter (a row must carry this tag)
//   author — exact author filter (the clickable author-name filter)
charactersRouter.get("/", (req, res) => {
  const q = String(req.query.q ?? "").trim();
  const tag = String(req.query.tag ?? "").trim();
  const author = String(req.query.author ?? "").trim();

  const sortKey = String(req.query.sort ?? "updated");
  const sortCol = SORT_COLUMNS[sortKey] || SORT_COLUMNS.updated;
  const order = String(req.query.order ?? "desc").toLowerCase() === "asc" ? "ASC" : "DESC";

  const where = [];
  const params = {};

  if (author) {
    where.push("author = @author");
    params.author = author;
  }

  if (tag) {
    // Row must contain the exact tag. EXISTS over json_each keeps it indexable-ish
    // and avoids LIKE false positives (e.g. "cat" matching "category").
    where.push(
      "EXISTS (SELECT 1 FROM json_each(shared_characters.tags) je WHERE je.value = @tag)",
    );
    params.tag = tag;
  }

  if (q) {
    // Free-text search over name/author/intro and the raw tags JSON text. The
    // tags column is a JSON string, so a LIKE on it matches any contained tag.
    where.push(
      "(name LIKE @like ESCAPE '\\' OR author LIKE @like ESCAPE '\\' OR intro LIKE @like ESCAPE '\\' OR tags LIKE @like ESCAPE '\\')",
    );
    params.like = `%${escapeLike(q)}%`;
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  // Stable secondary sort by global_id so equal sort keys don't reorder between calls.
  const sql = `
    SELECT ${LIST_COLUMNS}
    FROM shared_characters
    ${whereSql}
    ORDER BY ${sortCol} ${order}, global_id ASC
    LIMIT ${LIST_LIMIT}
  `;

  try {
    const rows = db.prepare(sql).all(params);
    return res.json({ ok: true, characters: rows.map(summaryOf) });
  } catch {
    return res.status(500).json({ ok: false, error: "db_read_failed" });
  }
});

// --- acquire / rating (phase 4) -------------------------------------------
// global_id is hex; reject anything else (also stops a param from matching the
// literal /tags or /mine routes by accident).
const HEX_ID = /^[a-f0-9]{1,64}$/;

// --- update detection / read-only fetch (phase 5) -------------------------
// Locally-held shared cards check the server for updates: the private list,
// on open, asks for the current server updated_at of each held shared card so
// it can show an "update available" badge, and "更新" then pulls the latest
// card json. Both are public reads and deliberately do NOT bump downloads
// (only a real use/buyout does, per the design's author-economy model).
const VERSIONS_MAX_IDS = 200; // matches the browse LIST_LIMIT ceiling

// POST /characters/versions — body { ids: [globalId,...] }
// Returns { versions: { <globalId>: { updatedAt, owner } } } for the ids that
// still exist. A held card whose id is ABSENT from the map has been deleted from
// the library (the client surfaces that only when 更新 is clicked, never as a
// badge). owner lets the client backfill a held used card's owner so the author
// can see the edit button without a full 更新 first. One round-trip for the
// whole list instead of N per-card requests.
charactersRouter.post("/versions", (req, res) => {
  const rawIds = Array.isArray(req.body?.ids) ? req.body.ids : [];
  // Keep only well-formed, de-duped hex ids, bounded.
  const seen = new Set();
  for (const raw of rawIds) {
    const id = String(raw ?? "");
    if (HEX_ID.test(id)) seen.add(id);
    if (seen.size >= VERSIONS_MAX_IDS) break;
  }
  const ids = [...seen];
  if (!ids.length) return res.json({ ok: true, versions: {} });

  const placeholders = ids.map(() => "?").join(",");
  try {
    const rows = db
      .prepare(
        `SELECT global_id, updated_at, owner FROM shared_characters WHERE global_id IN (${placeholders})`,
      )
      .all(...ids);
    const versions = {};
    for (const r of rows) versions[r.global_id] = { updatedAt: r.updated_at, owner: r.owner };
    return res.json({ ok: true, versions });
  } catch {
    return res.status(500).json({ ok: false, error: "db_read_failed" });
  }
});

// POST /characters/:id/acquire — use or buyout. body: { mode: "use" | "buyout" }
// Hands out the full card json (only here, never in the browse listing) and
// bumps downloads. Free use (use_price 0) needs no login, per the design; any
// priced acquisition requires auth and settles catfood — the buyer pays and the
// author earns, in one transaction. Buying your own card never charges.
charactersRouter.post("/:id/acquire", (req, res) => {
  const id = String(req.params.id ?? "");
  if (!HEX_ID.test(id)) return res.status(404).json({ ok: false, error: "not_found" });

  const mode = String(req.body?.mode ?? "");
  if (mode !== "use" && mode !== "buyout") return badRequest(res, "invalid_mode");

  const row = getFullCharacter.get(id);
  if (!row) return res.status(404).json({ ok: false, error: "not_found" });

  if (mode === "buyout" && row.buyout_price <= 0) {
    return badRequest(res, "not_for_sale");
  }
  const price = mode === "buyout" ? row.buyout_price : row.use_price;

  const auth = resolveUser(req);
  let profile = null;

  if (price > 0) {
    // Priced acquisition: must be logged in, and (unless it's your own card)
    // must afford it. Settle buyer↓ / author↑ atomically, then count the download.
    if (!auth) return res.status(401).json({ ok: false, error: "unauthorized" });
    const buyer = auth.user;
    if (buyer.account !== row.owner) {
      if (buyer.catfood < price) {
        return res.status(402).json({ ok: false, error: "insufficient", catfood: buyer.catfood });
      }
      const settle = db.transaction(() => {
        debitBuyer.run({ account: buyer.account, amount: price });
        creditAuthor.run({ account: row.owner, amount: price });
        bumpDownloads.run(id);
      });
      settle();
    } else {
      bumpDownloads.run(id);
    }
    const fresh = getUserByAccount.get(buyer.account);
    profile = { catfood: fresh.catfood, spentTotal: fresh.spent_total };
  } else {
    // Free use: anonymous-friendly; just count the download.
    bumpDownloads.run(id);
    if (auth) profile = { catfood: auth.user.catfood, spentTotal: auth.user.spent_total };
  }

  return res.json({
    ok: true,
    card: cardResponseOf(row),
    ...(profile ? { profile } : {}),
  });
});

// POST /characters/:id/rating (auth) — body { value: 1 | -1 | 0 }
// 1=like, -1=dislike (mutually exclusive via the ratings PK), 0=clear. Recounts
// the cached like/dislike totals from the authoritative ratings table.
charactersRouter.post("/:id/rating", requireAuth, (req, res) => {
  const id = String(req.params.id ?? "");
  if (!HEX_ID.test(id)) return res.status(404).json({ ok: false, error: "not_found" });

  const value = Number(req.body?.value);
  if (value !== 1 && value !== -1 && value !== 0) return badRequest(res, "invalid_value");

  if (!characterExists.get(id)) {
    return res.status(404).json({ ok: false, error: "not_found" });
  }

  const account = req.user.account;
  const apply = db.transaction(() => {
    if (value === 0) {
      deleteRating.run({ account, global_id: id });
    } else {
      upsertRating.run({ account, global_id: id, value });
    }
    recountRatings.run({ global_id: id });
  });
  apply();

  const counts = getCounts.get(id);
  return res.json({ ok: true, likes: counts.likes, dislikes: counts.dislikes, myValue: value });
});

// GET /characters/mine/ratings (auth) — this account's { globalId: value } map.
// The public browse listing can't carry it (it's per-user); the library loads
// this once on open while logged in to render active like/dislike states.
charactersRouter.get("/mine/ratings", requireAuth, (req, res) => {
  try {
    const rows = listMyRatings.all(req.user.account);
    const ratings = {};
    for (const r of rows) ratings[r.global_id] = r.value;
    return res.json({ ok: true, ratings });
  } catch {
    return res.status(500).json({ ok: false, error: "db_read_failed" });
  }
});

// PUT /characters/:id (auth) — publish an update to an existing card (phase 5b).
// Only the owner may update. body is the same shape as POST / (publish):
// { source, intro?, tags?, usePrice, buyoutPrice, cardJson, coverBase64 }. All
// public metadata + the card + cover are revised; owner/global_id/created_at and
// the download/like counters are immutable. updated_at is bumped to now so every
// holder of this card sees the update badge on their next list open. The cover
// file is overwritten in place (same global_id.webp); author is re-stamped to
// the current display name, matching publish. Registered BEFORE GET /:id — a
// different method, so no route conflict, but kept together for clarity.
charactersRouter.put("/:id", requireAuth, (req, res) => {
  const id = String(req.params.id ?? "");
  if (!HEX_ID.test(id)) return res.status(404).json({ ok: false, error: "not_found" });

  const row = getFullCharacter.get(id);
  if (!row) return res.status(404).json({ ok: false, error: "not_found" });
  // Owner-only: a card can only be updated by the account that uploaded it.
  if (row.owner !== req.user.account) {
    return res.status(403).json({ ok: false, error: "forbidden" });
  }

  const v = validateCharacterInput(req.body);
  if (v.error) return badRequest(res, v.error);
  const { source, intro, tags, usePrice, buyoutPrice, cardJson, name, coverBuf } = v.value;

  // Overwrite the cover file first; only commit the DB row if it lands, so we
  // never leave the row pointing at a half-written cover.
  const coverPath = join(COVERS_DIR, `${id}.webp`);
  try {
    writeFileSync(coverPath, coverBuf);
  } catch {
    return res.status(500).json({ ok: false, error: "cover_write_failed" });
  }

  const now = Date.now();
  try {
    updateCharacter.run({
      global_id: id,
      author: req.user.username, // re-stamp to current display name, like publish
      name,
      source,
      intro,
      tags: JSON.stringify(tags),
      use_price: usePrice,
      buyout_price: buyoutPrice,
      card_json: cardJson,
      cover_ext: "webp",
      updated_at: now,
    });
  } catch {
    return res.status(500).json({ ok: false, error: "db_write_failed" });
  }

  return res.json({ ok: true, globalId: id, updatedAt: now });
});

// GET /characters/:id — public read-only full card (phase 5 update pull).
// Returns the same card shape as acquire BUT does NOT bump downloads or settle
// anything: it's only for refreshing a locally-held shared card to the latest
// server json. 404 means the card was deleted from the library (the client then
// tells the user it can no longer be updated). Registered AFTER the literal
// /tags and /mine/ratings routes so it never captures them; the hex guard is a
// second line of defence.
charactersRouter.get("/:id", (req, res) => {
  const id = String(req.params.id ?? "");
  if (!HEX_ID.test(id)) return res.status(404).json({ ok: false, error: "not_found" });

  const row = getFullCharacter.get(id);
  if (!row) return res.status(404).json({ ok: false, error: "not_found" });

  return res.json({ ok: true, card: cardResponseOf(row) });
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
