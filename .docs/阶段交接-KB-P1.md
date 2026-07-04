# NyaaChat KnowledgeBase V1 阶段交接 KB-P1

## 交接目的
- 本文件记录 KB-V1 第 1 阶段（P1）完成状态，供 P2 和新对话续接。
- 续接前必读：`CLAUDE.md` → `.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md` → `.docs/nyaachat-KnowledgeBase-plan/审计报告.md` → 本文件。

## 当前进度（P1 ✅ 已完成）
- ✅ `src/services/chunk.js` — `splitIntoChunks(text, size, overlap)` 纯函数切片器
- ✅ `src/services/embedding.js` — OpenAI 兼容 `/embeddings` 客户端（embedTexts/embedMany/detectDimension/healthCheck），每用户独立 config
- ✅ `src/services/embedding-config.js` — 从 `embedding_configs` 表按 owner 读取/掩码嵌入配置
- ✅ `src/services/ingest.js` — 文档摄取管道（parse→chunk→embed→persist），vec_chunks 惰性准备
- ✅ `src/services/retrieval.js` — 混合检索（vec0 KNN + FTS5 BM25 + RRF），密集失败回退稀疏
- ✅ `src/parsers/index.js` — txt/md/pdf 文档解析器（V1 范围）
- ✅ `src/routes/embedding.js` — GET/PUT embedding-config + POST health-check + POST detect-dim（apiKey 不回显）
- ✅ `src/routes/kb.js` — KB CRUD（owner 隔离，404/403 分离）
- ✅ `src/routes/documents.js` — 文档上传(base64)/列表/删除 + chunks 管理（owner 二次校验）
- ✅ `src/routes/search.js` — POST search（双路径校验骨架，P1 仅 owner 路径）
- ✅ `package.json` — 新增 p-limit、pdf-parse 依赖
- ✅ `server.js` — 挂载 4 个路由模块
- ✅ 验收全绿：embedding PUT/GET ✅ / KB CRUD ✅ / PATCH ✅ / auth 401 ✅ / owner 403 ✅ / delete 204 ✅

## 本轮已修复 / 已实现

| 文件 | 改动 |
|---|---|
| `nyaachat-knowledge/src/services/chunk.js`（新增） | 纯函数切片器 `splitIntoChunks` |
| `nyaachat-knowledge/src/services/embedding.js`（新增） | embedTexts/embedMany/detectDimension/healthCheck，每用户 config |
| `nyaachat-knowledge/src/services/embedding-config.js`（新增） | getEmbeddingConfig/maskedConfig 从 embedding_configs 表读取 |
| `nyaachat-knowledge/src/services/ingest.js`（新增） | 文档摄取管道，惰性 vec_chunks prepare，owner 维度 + char_total 更新 |
| `nyaachat-knowledge/src/services/retrieval.js`（新增） | RRF 混合检索（vec0 KNN + FTS5 BM25），owner 嵌入配置 |
| `nyaachat-knowledge/src/parsers/index.js`（新增） | txt/md/pdf 解析器（V1 范围） |
| `nyaachat-knowledge/src/routes/embedding.js`（新增） | embedding-config CRUD + health-check + detect-dim，apiKey 掩码 |
| `nyaachat-knowledge/src/routes/kb.js`（新增） | KB CRUD，owner 隔离，404/403 分离 |
| `nyaachat-knowledge/src/routes/documents.js`（新增） | 文档上传(base64)/列表/删除 + chunks，owner 链式校验 |
| `nyaachat-knowledge/src/routes/search.js`（新增） | POST /search，P1 仅 owner 路径（P6 加共享卡路径） |
| `nyaachat-knowledge/package.json`（修改） | 新增 p-limit、pdf-parse |
| `nyaachat-knowledge/src/server.js`（修改） | 挂载 4 个新路由模块 |
| `.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md`（修改） | P1 ⬜→✅ |

### 遇到的问题与修复
- **vec_chunks 惰性 prepare**：`ingest.js` 在模块顶层 prepare `INSERT INTO vec_chunks` 时表尚未创建（首次部署），导致启动失败。改为惰性 getter `getInsertVec()` 在首次 `ensureVecTable` 调用后才准备语句。
- **embedding_configs.api_key NOT NULL**：PUT embedding-config 时 api_key 传 null 触发约束失败。改为传空字符串 `""`，ON CONFLICT 用 CASE 判断非空才更新。

## 仍需继续验证 / 已知问题
- 嵌入 API（SiliconFlow）的真实验证未执行（测试环境无 API key），P2 或后续阶段验证。
- 文档上传/摄入的端到端验证未执行（依赖嵌入 API 先配置好维度）。
- 检索的端到端验证未执行（同上，依赖向量库有数据）。
- P1 的 search 路由仅实现 owner 路径（双路径校验的共享卡路径留 P6）。

## 下一阶段（P2）
- P2：知识库管理后端 — KB CRUD 已经在 P1 实现，P2 重点是 `kb_max` 额度落位（方案② shared-server users 表加列 + 跨服务读取）+ `POST /api/knowledge/expand-kb` 扩容事务 + 检索归属双路径完善。

## 续接提示词
```
继续开发 NyaaChat KnowledgeBase V1 的 P2 阶段：知识库管理后端。

必读文档：
- H:\GitHub\NyaaChat\CLAUDE.md（项目规范）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\开发计划-SSOT.md（KB-V1 蓝图）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\审计报告.md（决策登记、安全边界）
- H:\GitHub\NyaaChat\.docs\阶段交接-KB-P1.md（本文件）

当前进度：
- P1 已完成：检索核心全部移植（chunk/embedding/ingest/retrieval）+ parsers + 嵌入配置端点
  + KB CRUD + 文档管理 + search，全部带 owner 隔离和鉴权。
- 核心服务使用惰性 prepare 处理 vec_chunks（首次部署表不存在的问题已修复）。

P2 要做的：
- kb_max 额度落位：方案② — shared-server 的 users 表加 kb_max 列（默认 5），
  knowledge 服务通过只读挂载的 shared DB 读取额度。
- POST /api/knowledge/expand-kb：仿 shared-server expand-slot，事务扣猫粮 +1 上限（硬上限 50）。
- POST /api/knowledge/kb 创建时校验 kb_max（当前 KB 数 < kb_max 才允许）。
- 可选：完善 search 双路径校验（P1 已留骨架）。
- 验收：额度上限拦截建库；扩容扣费正确；跨 owner 访问被 403。
- 完成后写 .docs/阶段交接-KB-P2.md。

关键约束：
- kb_max 读取 shared-server DB（只读挂载已有），不修改 shared-server 代码（P2 确认方案后可能需要在 shared-server users 表加列）
- 扩容事务完全仿 shared-server expand-slot（先校验后扣费、并发安全）
- apiKey 仅服务端、不回显
- 提交用 Conventional Commits、git add <file>、禁止 force push
- 测试后必须清理测试数据
```
