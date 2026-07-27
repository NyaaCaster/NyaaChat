# 修复计划 · getVecDim 跨用户向量表冲突

> 独立修复项，**不属于**任何 V/P 阶段规划。优先级高于持久化记忆系统开发。
> 严重级别：**HIGH**（跨租户静默数据摧毁，现网已存在）
> 影响仓库：`NyaaChat/nyaachat-knowledge`（私有子仓，需单独提交）

---

## 1. 缺陷描述

`nyaachat-knowledge/src/db.js:100` 的 `getVecDim()` 名义上返回"向量表的维度"，实际返回的是 `embedding_configs` 表中**任意一行**的 `dim`：

```js
export function getVecDim() {
  const row = db.prepare("SELECT dim FROM embedding_configs LIMIT 1").get();
  return row ? row.dim : null;
}
```

`LIMIT 1` 无 `ORDER BY`，取到的是 rowid 最小的行 —— 即**最早配置嵌入的那个用户**的维度，与 `vec_chunks` 表的真实维度无关。

而 `ensureVecTable(dim)`（`db.js:107`）用这个返回值决定是否 `DROP TABLE`：

```js
const currentDim = getVecDim();
if (currentDim !== dim) {
  db.exec("DROP TABLE IF EXISTS vec_chunks;");
}
```

根因叠加：整库只有**一个全局 `vec_chunks`**（`db.js:118`），无 `owner` / `kb_id` 列，租户隔离依赖与 `chunks` 表 join 实现。维度是建表时锁死的，因此"多用户 × 异构维度"在当前结构下无解。

---

## 2. 复现路径

前置：用户 A、B 为不同账号，A 先配置嵌入。

1. **A 配 4096 维**（默认 `Qwen/Qwen3-Embedding-8B`），上传文档 →
   `ensureVecTable(4096)`：表不存在 → 建 `vec_chunks(embedding float[4096])`。
   `ingest.js:70` 校验 `getVecDim() !== 4096`？此时 `embedding_configs` 仅 A 一行，返回 4096，通过。入库成功。

2. **B 配 2560 维**（切到 `Qwen3-Embedding-4B`），上传文档 →
   `ensureVecTable(2560)`：表存在，`currentDim = getVecDim()` = **4096（A 的行）** ≠ 2560
   → **`DROP TABLE vec_chunks`** → 重建为 `float[2560]`。

3. 回到 `ingest.js:70`：`getVecDim()` 仍返回 4096（仍是 A 的行）≠ 2560 → **throw**，B 的事务未执行。

## 3. 后果

| 受害方 | 结果 |
|---|---|
| A | **全部向量被销毁**。`chunks` 行仍在（携失效 `vector_id`），dense 检索此后静默退化为纯稀疏，**不报错** |
| B | 入库失败，报"向量表维度与当前嵌入维度不匹配"，但错误信息与真实原因无关，无法自行排查 |

关键危害是 A 侧的**静默性**：`retrieval.js:35` 的 `vecTableExists()` 在 B 重建表后仍为 true，KNN 查到的 rowid 与 A 的 chunks 不匹配，`getChunk.get()` 返回 undefined 被 `.filter(Boolean)` 丢弃。用户只会感觉"知识库变笨了"，无任何日志或提示。

既有文档（`审计报告.md:149`、`重新评估.md:81`）已记载"换模型需重嵌"的**单用户**风险，但未覆盖**跨用户互相摧毁**这一层。这是多租户结构缺陷，UI 警告无法缓解。

## 4. 修复方案

### 4.1 向量表按维度分区

```js
// db.js
export function vecTableName(dim) {
  return `vec_chunks_${dim}`;
}

/** 只建不删。维度变更绝不在此处销毁数据。 */
export function ensureVecTable(dim) {
  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${vecTableName(dim)} USING vec0(embedding float[${dim}]);`
  );
}

export function vecTableExists(dim) {
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
  ).get(vecTableName(dim));
  return !!row;
}
```

**删除 `getVecDim()`**。所有调用点改为显式传入该 owner 配置的 dim。

### 4.2 硬约束

**`ensureVecTable` 任何情况下不得执行 DROP。** 维度变更必须走用户显式触发的"重建索引"流程（删旧 chunks + 重嵌），不能作为入库的副作用。

### 4.3 调用点改造

| 文件 | 位置 | 改动 |
|---|---|---|
| `services/ingest.js` | :69-72 | `ensureVecTable(embCfg.dim)` → 插入走 `vecTableName(embCfg.dim)`；**删除** `getVecDim() !== embCfg.dim` 校验（其错误信息本身就是误导） |
| `services/retrieval.js` | :35 | `vecTableExists()` → `vecTableExists(embCfg.dim)`；KNN SQL 表名按 dim 拼接；表不存在则跳过 dense，走纯稀疏 |
| `routes/documents.js` | :204, :253 | 删除时清理向量 |
| `routes/kb.js` | :204 | **第 5 处调用点**，本表初版遗漏。删除整个知识库时同样要清向量 |

`ingest.js:21` 的 `getInsertVec()` 缓存了单条 prepared statement，需改为按 dim 缓存（`Map<dim, stmt>`）。

三处删除路径的最终实现**不按 dim 定位**，而是统一调 `deleteVectorsByRowid(chunkId)`
遍历所有分区删除。理由写在 `db.js` 该函数的注释里：owner 可能在入库后换过嵌入模型，
其向量留在旧分区；chunk id 是全局 AUTOINCREMENT 唯一，逐分区删同一 rowid 安全且幂等。
按"当前 dim"定位反而会漏删旧分区的残留向量。

## 5. 现网数据迁移

修复上线时 `vec_chunks` 可能已处于被摧毁状态，需一次性迁移脚本：

**改动数据库前必须备份**（工作空间 MUST 规则）：

```bash
cp /root/DockerContainer/DockerRes/nyaachat-knowledge/db/nyaachat-knowledge.db \
   /root/DockerContainer/DockerRes/nyaachat-knowledge/db/nyaachat-knowledge-backup-getvecdim-fix-20260727.db
```

迁移步骤：

1. 读 `vec_chunks` 实际维度：`SELECT sql FROM sqlite_master WHERE name='vec_chunks'`，正则取 `float[(\d+)]`。
2. ~~`ALTER TABLE vec_chunks RENAME TO vec_chunks_<实际dim>`~~ —— **实测不可行**。vec0 虚拟表
   在 `sqlite_master` 里带 4 张影子表（`_info` / `_chunks` / `_rowids` /
   `_vector_chunks00`），`ALTER TABLE RENAME` 只改主表名，影子表留在原名下，
   模块随后无法自洽。改为**逐行复制 + 校验条数 + 才 DROP 旧表**，
   已实现为 `nyaachat-knowledge/migrate-vec-partition.js`（默认 dry-run，
   `--commit` 才写；目标表非空时拒绝盲合并）。
3. 孤儿盘点 —— 找出所属 kb 的 owner 配置维度与向量表维度不符的 chunks，这些已失去向量：

```sql
SELECT c.kb_id, k.owner, ec.dim AS owner_dim, COUNT(*) AS orphan_chunks
  FROM chunks c
  JOIN knowledge_bases k ON k.id = c.kb_id
  LEFT JOIN embedding_configs ec ON ec.owner = k.owner
 GROUP BY c.kb_id;
```

4. ~~对受影响 kb 提供"重建索引"入口（重嵌全部 chunks），或在 UI 标记"该库向量已失效，
   需重新处理文档"。不静默放置。~~ —— **本次不需要执行**。第 3 步盘点在两端均返回
   零受影响 kb（两个 owner 同为 4096 维），无向量丢失，无需重嵌。详见 §5.1。

   > 该入口本身仍是缺失能力：`ensureVecTable` 已被禁止 DROP（§4.2 硬约束），
   > 所以用户**主动**更换嵌入模型后，旧维度分区的向量会滞留、dense 检索静默降级为
   > 纯稀疏。这不是本 bug 造成的数据损坏，而是一个独立的功能缺口，
   > 留待需要时单独立项。

### 5.1 实际执行结果（2026-07-27）

两端均已迁移完成，**第 4 步不需要执行** —— 盘点显示没有受影响的 kb。

| | 本地 `E:\DockerRes\nyaachat-knowledge\db\` | macmini `/root/DockerContainer/DockerRes/nyaachat-knowledge/db/` |
|---|---|---|
| 备份 | `*-backup-vecpartition-migrate-20260727.db`（含 `-wal` / `-shm`） | 同名，同样含 WAL/SHM |
| 容器状态 | 本无运行 | 迁移前 `compose down`，迁移后重新 `up -d` |
| 旧表维度 | 4096 | 4096 |
| 复制向量数 | 431 / 431 | 431 / 431 |
| 迁移后校验 | `vec_chunks_4096` 431 行、旧表已删、无缺向量 chunk | 同 |
| owner 维度盘点 | `nyaa` 4096 ✅、`nyaa4128` 4096 ✅ | 同 |

**关键结论：两个 owner 恰好都是 4096 维，所以本 bug 虽然存在，从未真正触发过
`ensureVecTable` 的 DROP —— 没有向量丢失，无需重嵌。** 修复是在损害发生前上线的。

macmini 备份因迁移前 WAL 有 4.2 MB 未合并，先停容器再复制三个文件，避免拿到不一致快照。
迁移脚本执行方式：挂载 db 目录进 knowledge 镜像跑 `--entrypoint node`
（宿主机 Ubuntu 无 better-sqlite3 / sqlite-vec）。

## 6. 验证清单

1. 单用户 4096 维入库 → dense 检索命中。
2. 用户 B 配 2560 维入库 → **A 的向量仍在**，A 的 dense 检索仍命中。
3. B 的 dense 检索命中自己的 chunks，不串到 A。
4. `sqlite_master` 中同时存在 `vec_chunks_4096` 与 `vec_chunks_2560`。
5. B 删除文档 → 只清 `vec_chunks_2560` 对应 rowid，A 侧不受影响。
6. 某 owner 未配置嵌入 → `retrieval.js` 跳过 dense，稀疏结果正常返回，无异常抛出。
7. 迁移脚本对已损坏库执行后，孤儿盘点 SQL 输出与实际一致。

### 6.1 执行结果（2026-07-27，全部通过）

| 验证 | 方式 | 结果 |
|---|---|---|
| #1~#5、#7 + 影子表过滤 | 一次性脚本 `verify-vec-partition.js` | **16/16 通过**。核心项已实测：owner A(4096) 的向量在 owner B(2560) 入库后**完好无损** —— 这正是修复前会被摧毁的场景 |
| #6 | 一次性脚本 `verify-retrieval-degrade.js` | 通过。无嵌入配置的 owner 走纯稀疏，不抛异常 |
| 现网数据盘点 | 真库副本 | **零孤儿**：`owner=nyaa dim=4096 chunks=210`、`owner=nyaa4128 dim=4096 chunks=221` |
| 迁移脚本 | `/tmp/migtest.db`（真库备份副本） | dry-run 与 `--commit` 均成功，431 向量全部搬迁；随后对两端真库执行，见 §5.1 |

两个 verify 脚本与 probe 脚本属测试产物，验证后已按工作空间 MUST 规则清理，
仅保留 `migrate-vec-partition.js`（macmini 侧仍需从仓库取用）。

## 7. 与持久化记忆系统的关系

两项工作可并行，**但记忆系统 V2 若补 dense 检索，必须等本修复完成**：记忆库拟用 1024 维小模型，与用户知识库默认 4096 维不同，在未修复状态下每次记忆入库都会翻转 `vec_chunks`，摧毁全部用户知识库向量。

V1 记忆系统为纯稀疏，不写 `vec_chunks`，因此**不被本修复阻塞**。
