# 详细设计：服务端 API 与数据模型

> 覆盖空洞 M / N / O / P。归属仓库：`nyaachat-knowledge`（私有子仓）+ `shared-server`（私有子仓）
> 本文详到可直接照搬实现，无需执行期决策。

---

## 1. Schema 迁移

### 1.1 knowledge 库（`nyaachat-knowledge/src/db.js`）

追加在现有 `db.exec()` 大块之后、`// ---- Vec0 helpers ----` 之前。
沿用 shared-server 的 try/catch 迁移风格（`shared-server/src/db.js:99-154`）。

```js
// ---- Memory-system migrations (persistent memory V1) ----------------------
// knowledge_bases.kind distinguishes user-created KBs from the hidden
// per-account memory KB. Existing rows are all user KBs.
try {
  db.exec("ALTER TABLE knowledge_bases ADD COLUMN kind TEXT NOT NULL DEFAULT 'user'");
} catch { /* column already exists — harmless */ }

// documents.session_id ties a memory batch to one chat session; NULL for
// ordinary uploaded documents. last_seen_at drives TTL reclamation.
try {
  db.exec("ALTER TABLE documents ADD COLUMN session_id TEXT");
} catch { /* harmless */ }
try {
  db.exec("ALTER TABLE documents ADD COLUMN last_seen_at INTEGER");
} catch { /* harmless */ }
db.exec("CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id)");

// One memory KB per account. A UNIQUE partial index makes lazy creation
// idempotent under concurrency (two tabs triggering extraction at once) —
// the loser gets SQLITE_CONSTRAINT and re-reads instead of creating a second.
db.exec(
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_memory_owner " +
  "ON knowledge_bases(owner) WHERE kind = 'memory'"
);
```

> `documents.kb_id` 已有 `ON DELETE CASCADE`（`db.js:53`），`chunks.doc_id` 同理，
> 但 `chunks_fts` 与 `vec_chunks_*` 是虚拟表**不受 FK 约束**，必须手工删（现有代码已如此，见 §4.3）。

### 1.2 shared 库（`shared-server/src/db.js`）

追加在 `comfyui_pack_remaining` 迁移之后：

```js
// Persistent memory (V1): per-account plaintext memory storage ceiling, in
// characters (not bytes) — the memory KB stores text, and char count is what
// chunks.char_count already tracks. 2 MB worth ≈ 2,000,000 chars.
try {
  db.exec("ALTER TABLE users ADD COLUMN memory_char_max INTEGER NOT NULL DEFAULT 2000000");
} catch { /* column already exists — harmless */ }
```

`memory_char_max` 须随 `kb_max` 一同出现在 `/internal/validate-token` 返回的 user 对象里
（knowledge 服务通过 `req.user.memory_char_max` 读取，与 `req.user.kb_max` 同机制，
见 `nyaachat-knowledge/src/routes/kb.js:101`）。

**执行时须核对**：`shared-server` 的 validate-token 是否 `SELECT *`。若是显式列清单，必须补列。

### 1.3 迁移前置

改动库文件前**必须备份**（工作空间 MUST 规则）：

```bash
cp /e/DockerRes/nyaachat-knowledge/db/nyaachat-knowledge.db \
   /e/DockerRes/nyaachat-knowledge/db/nyaachat-knowledge-backup-memory-p1-<YYYYMMDD>.db
```

shared 库同理。macmini 侧各自单独备份。

---

## 2. kind 守卫矩阵（安全核心，空洞 O）

`kind='memory'` 库必须对**所有既有 KB 端点不可见、不可操作**。仅"整库删除"是允许的例外。

现状：所有既有端点只校验 `owner`，记忆库一旦存在就会被它们全部命中。

### 2.1 统一守卫

在 `nyaachat-knowledge/src/routes/` 新增共享工具（放 `src/kb-guard.js`）：

```js
// Guards that keep the hidden memory KB out of every user-facing KB endpoint.
//
// The memory KB is owned by the user, so an owner-only check (which is what
// every pre-existing endpoint does) is NOT sufficient: the user learns its id
// from memory ingest responses and could then read it, re-configure its chunk
// size, upload arbitrary documents into it, or — worst — run an unfiltered
// /search against it, which would defeat the per-session isolation the whole
// memory design rests on.

/** True when this KB row is the hidden memory KB. */
export function isMemoryKb(kb) {
  return kb?.kind === "memory";
}

/**
 * Reject the request when `kb` is the memory KB. Returns true when it已 handled
 * the response (caller must return immediately).
 *
 * 404, not 403: a user-facing endpoint must not confirm the memory KB exists
 * at that id. Treating it as nonexistent is both safer and consistent with
 * "the user never sees this KB".
 */
export function rejectMemoryKb(res, kb) {
  if (isMemoryKb(kb)) {
    res.status(404).json({ ok: false, error: "not_found" });
    return true;
  }
  return false;
}
```

### 2.2 逐端点改动

| 端点 | 文件:行 | 改动 | 理由 |
|---|---|---|---|
| `GET /kb` | `kb.js:26` `listKb` | SQL 加 `AND kb.kind = 'user'` | 不列出 |
| `POST /kb` 额度计数 | `kb.js:102` | 计数 SQL 加 `AND kind = 'user'` | 不占 `kb_max` |
| `GET /kb/:kbId` | `kb.js:134` | owner 校验后 `if (rejectMemoryKb(res, row)) return;` | 不可读元数据 |
| `PATCH /kb/:kbId` | `kb.js:147` | 同上 | **不可改 chunk_size**（改了会让后续批次切片不一致） |
| `DELETE /kb/:kbId` | `kb.js:185` | 同上 —— **也拒绝** | 见 §2.3 |
| `POST /kb/:kbId/documents` | `documents.js` 上传路由 | 加拒绝 | 不可塞任意文档 |
| `GET /kb/:kbId/documents` | 同文件 | 加拒绝 | 不可枚举记忆批次 |
| `DELETE /documents/:docId` | `documents.js:185` | `requireDocOwnership` 返回的 `kb` 上加拒绝 | 不可单删记忆批次（走 `/memory/*`） |
| `GET /documents/:docId`、`/documents/:docId/chunks`、`GET/DELETE /chunks/:chunkId` | `documents.js:177/216/225/240` | 均加拒绝 | 不可读/删记忆 chunk 明文 |
| `POST /search` | `search.js:22` `checkKbAccess` | **函数内首行**加 `if (isMemoryKb(kb)) return "not_found";` | **最关键**：否则可全库跨 session 检索 |
| `character_kb_bindings` | `internal.js` 绑定写入处 | 写入前校验目标 kb `kind='user'` | 防记忆库获得跨账号只读 |

> `POST /search` 那一条放在 `checkKbAccess` 内部而非路由里，是因为该函数是唯一的准入判定点，
> 放在里面就无法被将来新增的调用方绕过。

### 2.3 关于"允许用户删除自己的记忆库"

**定案：不提供整库删除端点，`DELETE /kb/:kbId` 对记忆库返回 404。**

理由：用户要清空记忆的语义出口应当唯一且明确 —— 关闭开关时的处置（见
`设计-账号界面与设置存档.md` 空洞 Q）与按 session 删除（`DELETE /memory/session/:id`）。
再开一个"整库删除"入口会造成三条路径语义重叠，且库被删后懒创建会重建一个空库，
用户看到的行为与"清空"没有区别却多一条代码路径。

---

## 3. 记忆库懒创建（空洞 M）

放在 `nyaachat-knowledge/src/services/memory.js`。

```js
// Lazy creation of the per-account memory KB.
//
// Concurrency: two browser tabs can hit /memory/ingest simultaneously on a
// fresh account. The partial UNIQUE index on (owner) WHERE kind='memory'
// makes the second INSERT fail with SQLITE_CONSTRAINT instead of creating a
// duplicate; we swallow that specific failure and re-read. Do NOT replace
// this with a check-then-insert — that is exactly the race the index closes.

const MEMORY_KB_NAME = "__memory__";
// Memory entries are short discrete facts. The KB default of 512/50 would pack
// several unrelated facts into one chunk, so a hit on one fact drags in noise.
const MEMORY_CHUNK_SIZE = 256;
const MEMORY_CHUNK_OVERLAP = 25;

const selectMemoryKb = db.prepare(
  "SELECT * FROM knowledge_bases WHERE owner = ? AND kind = 'memory'",
);

export function ensureMemoryKb(owner) {
  const existing = selectMemoryKb.get(owner);
  if (existing) return existing;

  const now = Date.now();
  try {
    db.prepare(
      `INSERT INTO knowledge_bases
         (id, owner, name, description, kind, chunk_size, chunk_overlap,
          dense_top_k, sparse_top_k, char_total, enabled, created_at, updated_at)
       VALUES (?, ?, ?, '', 'memory', ?, ?, 50, 50, 0, 1, ?, ?)`,
    ).run(randomUUID(), owner, MEMORY_KB_NAME, MEMORY_CHUNK_SIZE, MEMORY_CHUNK_OVERLAP, now, now);
  } catch (err) {
    // Lost the race — the other writer created it. Any other error is real.
    if (!String(err.message).includes("UNIQUE")) throw err;
  }
  return selectMemoryKb.get(owner);
}
```

**不变量**：记忆库的 `chunk_size` / `chunk_overlap` 由服务端固定，客户端不得传入，
`PATCH` 已被 §2.2 拒绝。

---

## 4. 端点完整契约（空洞 N）

共 8 个端点。本节给出前 5 个的完整契约；另 3 个的契约在别处定义，本节只登记路由与
挂载位置，避免同一契约写两遍产生分歧：

| 端点 | 契约所在 |
|---|---|
| `GET /memory/batches` | `设计-记忆生命周期与配额.md` §3.2 |
| `POST /memory/recompress` | `设计-记忆生命周期与配额.md` §3.2 |
| `DELETE /memory/all` | `设计-账号界面与设置存档.md` §5 |

这 3 个同样挂在 `memoryRouter` 上，同样走 `requireAuth` 与 §2.1 的统一守卫，
owner 同样只取 `req.user.account`。

新增 `nyaachat-knowledge/src/routes/memory.js`，`server.js` 挂载：

```js
import { memoryRouter } from "./routes/memory.js";
app.use("/memory", memoryRouter);
```

放在 `app.use("/", documentsRouter)` **之前** —— documentsRouter 挂在根路径，
虽然它只注册具体路径不会吞掉 `/memory/*`，但顺序在前更明确。

nginx 无需改动：`/api/knowledge/` 是前缀 location（`nginx.conf:297`），
`rewrite ^/api/knowledge/(.*)$ /$1` 自动把 `/api/knowledge/memory/...` 映射到 `/memory/...`。

全部端点 `requireAuth`；**owner 一律取 `req.user.account`，绝不接受 body 传入**。

### 4.1 `POST /memory/ingest`

```
请求 { sessionId: string, batchSeq: number, content: string }
```

校验顺序（任一失败即返回，不产生副作用）：

| 校验 | 失败响应 |
|---|---|
| `sessionId` 非空字符串，长度 ≤ 128 | 400 `invalid_session_id` |
| `batchSeq` 整数 ≥ 0 | 400 `invalid_batch_seq` |
| `content` 非空字符串，trim 后长度 ≥ 1 | 400 `empty_content` |
| `content.length` ≤ 200_000 | 400 `content_too_large` |
| 当前 owner 记忆字符占用 + `content.length` ≤ `memory_char_max` | 409 `memory_char_max_reached`，body 附 `{ usage, quota }` |
| `(sessionId, batchSeq)` 未存在 | 409 `batch_exists`（幂等保护，见下） |

处理：

1. `ensureMemoryKb(owner)`
2. `splitIntoChunks(content, 256, 25)`（复用 `services/chunk.js`）；结果为空 → 400 `no_indexable_content`
3. 单事务内：
   - `INSERT INTO documents (id, kb_id, name, ext, size_bytes, chunk_count, uploaded_at, session_id, last_seen_at)`
     `name = \`${sessionId}#${batchSeq}\``，`ext = 'memory'`，`size_bytes = Buffer.byteLength(content)`，
     `last_seen_at = uploaded_at`
   - 每 chunk `INSERT INTO chunks(...)`，`vector_id = randomUUID()`（列 NOT NULL，V1 不用但要填）
   - 每 chunk `INSERT INTO chunks_fts (rowid, content)`
   - **不调用 `ensureVecTable`，不写任何 `vec_chunks_*`**（不变量）
   - `touchKb` 刷 `char_total`
4. 响应 `201 { ok: true, document: { id, name, chunkCount, uploadedAt }, chunk_count }`

**幂等保护**：客户端在提炼成功后写入，若响应丢失会重试。`(session_id, name)` 唯一性由
`batchSeq` 保证，重复提交同一 `batchSeq` 返回 409 而非追加重复内容。
实现：插入前 `SELECT 1 FROM documents WHERE session_id = ? AND name = ?`。

### 4.2 `POST /memory/search`

```
请求 { sessionId: string, query: string, topK?: number }   // topK 默认 5，上限 20
响应 200 { ok: true, count: number, results: [{ chunk_id, seq, content, char_count, score }] }
```

- `sessionId` / `query` 空 → 400 `invalid_session_id` / `empty_query`
- 该 owner 无记忆库 → **200 空结果**（不是 404）：新用户首轮检索是正常路径，不应报错
- 检索实现见 `设计-记忆检索实现.md`
- **不返回 `document_name`** —— 它是 `<sessionId>#<batchSeq>`，把 sessionId 回传给前端没有用途，
  且会出现在注入块里浪费 token

### 4.3 `DELETE /memory/session/:sessionId`

```
响应 204（无论是否有内容被删 —— 删除幂等）
```

三重守卫（缺一不可）：

```js
const kb = selectMemoryKb.get(req.user.account);   // ① owner 由 token 决定
if (!kb) return res.status(204).end();             //    无记忆库 → 幂等成功
// ② kind 由查询条件保证是 'memory'
// ③ session_id 精确匹配，且 documents.kb_id 必须等于该记忆库 id
const docs = db.prepare(
  "SELECT id FROM documents WHERE kb_id = ? AND session_id = ?",
).all(kb.id, req.params.sessionId);
```

删除事务（**复用现有虚拟表清理逻辑，不重写** —— `documents.js:196-209` 的模式）：

```js
const tx = db.transaction(() => {
  for (const doc of docs) {
    const chunkIds = db.prepare("SELECT id FROM chunks WHERE doc_id = ?")
                       .all(doc.id).map((r) => r.id);
    for (const cid of chunkIds) {
      db.prepare("DELETE FROM chunks_fts WHERE rowid = ?").run(cid);
      deleteVectorsByRowid(cid);   // V1 不写向量，但清理保持对称（V2 免改）
    }
    db.prepare("DELETE FROM documents WHERE id = ?").run(doc.id);  // cascades chunks
  }
  touchKb.run(Date.now(), kb.id, kb.id);
});
```

> `deleteVectorsByRowid` 在 V1 是空操作（无分区表存在时 `listVecTables()` 返回已有分区，
> 但记忆 chunk 的 rowid 不在其中，DELETE 命中 0 行）。保留调用是为了 V2 加 dense 时无需回头改删除路径。

### 4.4 `POST /memory/heartbeat`

```
请求 { sessionIds: string[] }
响应 200 { ok: true, touched: number }
```

- `sessionIds` 非数组 → 400 `invalid_session_ids`
- 数组长度 > 500 → 400 `too_many_sessions`
- **空数组 → 200 `{ touched: 0 }`，不做任何事**（不变量：空列表绝不触发清理）
- 处理：`UPDATE documents SET last_seen_at = ? WHERE kb_id = ? AND session_id IN (...)`
- **只刷不删**。清扫是独立路径，见 `设计-记忆生命周期与配额.md`

### 4.5 `GET /memory/usage`

```
响应 200 { ok: true, usage: number, quota: number, sessionCount: number, batchCount: number }
```

- `usage` = `SELECT COALESCE(SUM(char_count),0) FROM chunks WHERE kb_id = <memoryKbId>`
- `quota` = `req.user.memory_char_max ?? 2000000`
- 无记忆库 → `{ usage: 0, quota, sessionCount: 0, batchCount: 0 }`

计量口径的重要说明见 `设计-记忆生命周期与配额.md` §1。

---

## 5. 前端 API client（空洞 P）

追加到 `src/lib/knowledgeApi.ts` 末尾，沿用既有 `request<T>()` helper 与 `ApiResult<T>` 形状。
命名沿用文件内既有风格（动词 + 名词，camelCase，token 为第一参数）。

```ts
// --- Persistent memory --------------------------------------------------------

export interface MemorySearchResult {
  chunk_id: number;
  seq: number;
  content: string;
  char_count: number;
  score: number;
}

export interface MemoryUsage {
  usage: number;
  quota: number;
  sessionCount: number;
  batchCount: number;
}

/** Store one extraction batch into the hidden memory KB. */
export function ingestMemory(
  token: string,
  data: { sessionId: string; batchSeq: number; content: string },
): Promise<ApiResult<{ document: { id: string; name: string; chunkCount: number; uploadedAt: number }; chunk_count: number }>> {
  return request("/memory/ingest", { method: "POST", body: data, token });
}

/** Sparse-only retrieval scoped to one chat session. */
export function searchMemory(
  token: string,
  sessionId: string,
  query: string,
  topK = 5,
): Promise<ApiResult<{ count: number; results: MemorySearchResult[] }>> {
  return request("/memory/search", {
    method: "POST",
    body: { sessionId, query, topK },
    token,
  });
}

/** Drop every memory batch belonging to one chat session. Idempotent. */
export function deleteSessionMemory(
  token: string,
  sessionId: string,
): Promise<ApiResult<void>> {
  return request(`/memory/session/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    token,
  });
}

/**
 * Refresh last_seen_at for the sessions that still exist locally, and let the
 * server piggyback its TTL sweep on the same call (`swept` = docs reclaimed).
 * Callers MUST NOT send an empty array — see 设计-记忆生命周期与配额.md §2.2.
 */
export function heartbeatMemory(
  token: string,
  sessionIds: string[],
): Promise<ApiResult<{ touched: number; swept: number }>> {
  return request("/memory/heartbeat", { method: "POST", body: { sessionIds }, token });
}

export function getMemoryUsage(token: string): Promise<ApiResult<MemoryUsage>> {
  return request("/memory/usage", { token });
}

// --- Recompression / bulk delete ---------------------------------------------
// Contracts: 设计-记忆生命周期与配额.md §3.2, 设计-账号界面与设置存档.md §5

export interface MemoryBatch {
  batchSeq: number;
  charCount: number;
  uploadedAt: number;
  content: string;
}

/** Read back stored batches for one session so they can be merged. */
export function listMemoryBatches(
  token: string,
  sessionId: string,
): Promise<ApiResult<{ batches: MemoryBatch[] }>> {
  return request(
    `/memory/batches?sessionId=${encodeURIComponent(sessionId)}`,
    { token },
  );
}

/** Atomically replace several batches with one merged batch. */
export function recompressMemory(
  token: string,
  data: { sessionId: string; replaceBatchSeqs: number[]; content: string },
): Promise<ApiResult<{ document: { id: string; name: string }; freedChars: number }>> {
  return request("/memory/recompress", { method: "POST", body: data, token });
}

/** Wipe every memory batch of the caller. Idempotent; keeps the KB row. */
export function deleteAllMemory(token: string): Promise<ApiResult<void>> {
  return request("/memory/all", { method: "DELETE", token });
}
```

> `MemoryBatch` 在此定义，`设计-记忆生命周期与配额.md` §3.2 与
> `设计-提炼触发与状态机.md` §3 均引用此处，不各自重复声明。

> `deleteSessionMemory` 用 `encodeURIComponent` —— sessionId 由 `newId()` 生成，
> 但导入的会话可能带任意 id，不编码会造成路径注入。

---

## 6. 验收清单（P1 / P2）

1. 迁移在**已有数据的库**上重复执行两次，均不报错、数据无损
2. `GET /kb` 不含记忆库；`POST /kb` 在已有记忆库时额度计数不变
3. 记忆库 id 直接打到 `GET/PATCH/DELETE /kb/:id` 全部 404
4. 记忆库 id 直接打到 `POST /search` 返回 404（**关键项**：验证 session 隔离无法绕过）
5. 记忆库 id 直接打到 `POST /kb/:id/documents` 404
6. 并发两次 `POST /memory/ingest`（新账号）只产生一个记忆库
7. 同一 `(sessionId, batchSeq)` 重复 ingest 返回 409，不产生重复 chunk
8. `DELETE /memory/session/:id` 后 `documents` / `chunks` / `chunks_fts` 三处均归零
9. 空 `sessionIds` 的 heartbeat 不删除任何数据
10. 无记忆库账号调 `/memory/search` 返回 200 空结果、`/memory/usage` 返回 `usage: 0`
11. 另 3 个端点的路由确实挂在 `memoryRouter` 上且受 `requireAuth`：
    未带 token 调 `GET /memory/batches`、`POST /memory/recompress`、`DELETE /memory/all`
    均返回 401（各自的行为验收在其契约所属文档的验收清单中）
12. 用 A 账号 token 调 `GET /memory/batches?sessionId=<B 的 sessionId>` 返回空 batches
    —— 与第 4 项同性质，验证跨账号读取不可能
