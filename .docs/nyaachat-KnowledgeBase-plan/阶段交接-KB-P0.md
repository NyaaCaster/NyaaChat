# NyaaChat KnowledgeBase V1 阶段交接 KB-P0

## 交接目的
- 本文件记录「用户级知识库 / RAG 独立版本」（KB-V1）第 0 阶段（P0）完成状态，供下一阶段和新对话续接。
- 续接前必读：`CLAUDE.md`（项目根） → `.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md` → `.docs/nyaachat-KnowledgeBase-plan/审计报告.md` → 本文件。

## 当前进度（P0 ✅ 已完成）
- ✅ `nyaachat-knowledge/` 子服务目录 + `package.json`（Express + better-sqlite3 + sqlite-vec）
- ✅ `Dockerfile`（`node:20-slim` 单阶段，因 sqlite-vec 依赖 glibc 不可用 alpine）
- ✅ `.dockerignore` / `.env.example` / `.env` / `README.md`
- ✅ `src/db.js` — 6 表 schema 一次性建齐（knowledge_bases / documents / chunks / chunks_fts / embedding_configs / character_kb_bindings）+ sqlite-vec 加载 + vec0 懒创建辅助
- ✅ `src/auth.js` — 只读挂载 shared-server SQLite DB 读 sessions 表验证 token
- ✅ `src/server.js` — Express/health/auth-check，headless（无表现页）
- ✅ `src/nyaacount-client.js` — NyaaAcount 项目间 API 客户端（完整移植自 shared-server）
- ✅ `docker-compose.knowledge.yml` — 独立 compose project，5108，nyaachat-net，DB bind mount + shared DB 只读挂载
- ✅ `rebuild-knowledge.py` + `.claude/skills/rebuild-knowledge/SKILL.md`
- ✅ `nginx.conf` — 新增 `/api/knowledge/` 反代块（延迟 DNS 解析模式，与 /api/shared/ 同模式）
- ✅ `.env.example` / `.env` — 新增 `KNOWLEDGE_RES_DIR`
- ✅ 验收全绿：直连 `:5108/health` ✅ / 同源 `/api/knowledge/health` ✅ / DB 落盘 ✅ / 鉴权 401 ✅

## 本轮已修复 / 已实现

| 文件 | 改动 |
|---|---|
| `nyaachat-knowledge/package.json`（新增） | Node 20 + Express + better-sqlite3 + sqlite-vec |
| `nyaachat-knowledge/Dockerfile`（新增） | `node:20-slim` 单阶段（sqlite-vec 需 glibc） |
| `nyaachat-knowledge/.dockerignore`（新增） | 排除 node_modules / db 文件 / data |
| `nyaachat-knowledge/.env.example`（新增） | `KNOWLEDGE_RES_DIR=.` |
| `nyaachat-knowledge/.env`（新增） | `KNOWLEDGE_RES_DIR=E:/DockerRes/nyaachat-knowledge` |
| `nyaachat-knowledge/README.md`（新增） | 子服务说明文档 |
| `nyaachat-knowledge/src/db.js`（新增） | 6 表 schema（SSOT §2.1 全表）+ WAL + sqlite-vec 加载 + vec0/ensureVecTable/getVecDim |
| `nyaachat-knowledge/src/auth.js`（新增） | 从 shared-server DB 只读验证 session token，导出 requireAuth/resolveUser/tokenFromHeader |
| `nyaachat-knowledge/src/server.js`（新增） | `/health`（公开）+ `/auth-check`（需 token）+ headless |
| `nyaachat-knowledge/src/nyaacount-client.js`（新增） | 完整移植 shared-server 同名文件，NyaaAcount 项目间 API 客户端 |
| `docker-compose.knowledge.yml`（新增） | project: nyaachat-knowledge，5108，只读挂载 shared DB 鉴权，bind mount E:\DockerRes |
| `rebuild-knowledge.py`（新增） | 仿 rebuild-shared.py，COMPOSE_FILE=docker-compose.knowledge.yml |
| `.claude/skills/rebuild-knowledge/SKILL.md`（新增） | rebuild-knowledge skill 定义 |
| `nginx.conf`（修改） | 新增 `/api/knowledge/` location（延迟 DNS 反代到 nyaachat-knowledge:5108） |
| `.env.example`（修改） | 新增 `KNOWLEDGE_RES_DIR` 段 |
| `.env`（修改） | 新增 `KNOWLEDGE_RES_DIR=E:/DockerRes/nyaachat-knowledge` |
| `.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md`（修改） | P0 ⬜→✅ |

### 遇到的问题与修复
- **sqlite-vec 在 Alpine 不兼容**：sqlite-vec 预编译二进制依赖 glibc，Alpine 的 musl 无法加载。改为 `node:20-slim`（与 NyaaLibrary-MCP 同理由），单阶段构建即可（预编译二进制直接安装）。

## 仍需继续验证 / 已知问题
- 鉴权依赖 shared-server 的 DB 文件存在。若 shared-server 从未部署（DB 文件不存在），所有受保护路由返回 503。
- P0 暂无业务端点，`/auth-check` 是唯一需要鉴权的路由，用于验证鉴权链路。
- `vec_chunks` 虚拟表尚未创建（等待 P1 的 embedding_config.dim 确定后才建）。

## 下一阶段（P1）
- P1：检索核心移植 — 移植重写 chunk/ingest/embedding/retrieval 四 service（RRF 混合检索）+ embedding 配置端点 + 文档解析（txt/md/pdf）。

## 续接提示词
```
继续开发 NyaaChat KnowledgeBase V1 的 P1 阶段：检索核心移植。

必读文档：
- H:\GitHub\NyaaChat\CLAUDE.md（项目规范）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\开发计划-SSOT.md（KB-V1 蓝图）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\审计报告.md（决策登记、安全边界）
- H:\GitHub\NyaaChat\.docs\阶段交接-KB-P0.md（本文件）
- H:\GitHub\NyaaLibrary-MCP\server\src\services\（检索核心参考实现）

当前进度：
- P0 已完成：子服务 scaffolding 全部就绪。nyaachat-knowledge 容器运行在 5108 端口，
  nginx 反代 /api/knowledge/ 同源可达，6 表 schema 已建，鉴权通过只读挂载 shared-server
  SQLite DB 的 sessions 表验证 token。
- Dockerfile 使用 node:20-slim（不可用 alpine，sqlite-vec 需 glibc）。

P1 要做的：
- 从 NyaaLibrary-MCP 移植重写 chunk / ingest / embedding / retrieval 四 service，
  加 owner 账号维度（不 fork，借核心重写）。
- 新增 embedding 配置端点 GET/PUT /api/knowledge/embedding-config（apiKey 不回显）。
- 健康检查嵌入 API（最低成本探测 + 维度探测锁定）+ vec_chunks 虚拟表创建。
- 文档解析：txt / md / pdf（P1 定稿最终清单）。
- 验收：单账号建库→配置嵌入→上传文档→切片入库→search 返回合理 chunks（后端 API 直测）。
- 完成后写 .docs/阶段交接-KB-P1.md。

关键约束：
- 检索结果永不进 system role，只进 latest user <search_context>
- apiKey 仅服务端存储、不回显、不入日志/导出
- 嵌入维度变更必须 UI 警告提示重建
- 绝不级联硬删：软引用 + 懒失效
- NyaaAcount 不可达时 fail-closed
- 提交用 Conventional Commits、git add <file>、禁止 force push
- 测试后必须清理测试数据
```
