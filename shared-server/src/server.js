// NyaaChat shared-character backend — entry point.
//
// Deliberately headless: no presentation pages, only a /health probe (per the
// design's "数据库端不要任何表现页面，仅留健康测试页面"). The frontend reaches
// this service same-origin through the main nginx at /api/shared/* — see
// nginx.conf and docker-compose.shared.yml. Account / library routes are added
// in later phases; importing ./db here bootstraps the schema on boot.

import express from "express";
import { db } from "./db.js";

const PORT = Number(process.env.PORT) || 5107;

const app = express();
app.use(express.json({ limit: "6mb" })); // card json + base64 cover headroom

// Health probe. Public, unauthenticated. Verifies the sqlite handle responds.
app.get("/health", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    res.json({ ok: true, service: "nyaachat-shared", db: "ok", time: Date.now() });
  } catch (err) {
    res.status(500).json({ ok: false, service: "nyaachat-shared", db: "error", error: String(err) });
  }
});

// Routes for later phases mount here, e.g.:
//   app.use("/account", accountRouter);
//   app.use("/characters", charactersRouter);
//   app.use("/covers", express.static(process.env.COVERS_DIR));

app.listen(PORT, () => {
  console.log(`[nyaachat-shared] listening on :${PORT}`);
});
