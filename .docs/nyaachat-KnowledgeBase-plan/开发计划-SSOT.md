# NyaaChat 用户级知识库（KnowledgeBase）开发计划 · SSOT

> 本文件是 NyaaChat「用户级知识库 / RAG」独立版本（记为 **KB-V1**）的唯一事实来源（Single Source of Truth）。
> 所有实现以本文件为准；与其他文档冲突时，以本文件 + `审计报告.md` 为准。
>
> 必读前置：`审计报告.md`（决策登记、prompt 合规、安全边界、命名规约）、`用户使用交互要点设计.md`（UI 交互要点、方案决策）、`NyaaChat 用户级知识库方案 · 重新评估.md`（可行性论证）。
> 全局标准：`C:\Users\honyw\.docs\llm-chat-prompt-architecture-standard.md`
> 创建：2026-07-05
> 状态：实施中 · P0 ✅ · P1 ✅ · P2 ✅ · P3 ✅ · P4 ✅ · P5-P7 ⬜ 未开始

---

## 0. 目标与范围边界

在 NyaaChat 现有「纯前端角色 + 共享角色后端 + 统一账号」之上，叠加一套**基于用户账号的用户级知识库（RAG）子服务**：登录用户可配置嵌入模型、建立管理多个知识库、上传文档；并可在对话角色的**规则条目（世界书 `WorldInfoRule`）** 上关联知识库，通过条目自身的触发机制控制对话中何时检索、取用哪个库的内容。

**范围内（KB-V1）：**
- 独立子服务 `nyaachat-knowledge`（可独立维护 / 独立 rebuild）。
- 每用户多知识库、账号额度（知识库栈 `kb_max`）。
- 嵌入模型配置（用户自带 API）、文档上传切片入库、混合检索（稠密 + 稀疏 + RRF）。
- 规则条目多选关联知识库、方案A 前端编排检索、结果注入 `<search_context>`。
- 共享角色使用态跨账号只读引用作者知识库；买断清理关联。

**范围外（留后续版本）：**
- rerank 模型（V1 用 RRF + token 预算截断，不引入独立 reranker）。
- 知识库本身的共享 / 交易市场。
- docx 等富文档格式（V1 限 txt/md/pdf）。
- 精确 token 分词计量（V1 用 char_count 近似）。

---

## 1. 架构决策（已拍板，见 `审计报告.md §3`）

| 项 | 决策 |
|---|---|
| 命名 | `nyaachat-knowledge` / `/api/knowledge/` / `rebuild-knowledge.py` / `docker-compose.knowledge.yml`；字段保留 `kb` 缩写 |
| 后端栈 | Node + Express + better-sqlite3 + sqlite-vec + FTS5，独立容器，建议端口 **5108** |
| 网络拓扑 | 挂既有 external 网络 `nyaachat-net`；主 nginx 反代 `/api/knowledge/` → `nyaachat-knowledge:5108`，全程同源 |
| 鉴权 | 复用 NyaaAcount：session token（`auth.js` 范式）+ `nyaacount-client.js`，fail-closed |
| 大文件落盘 | DB + 向量库 bind mount 到 `E:\DockerRes\nyaachat-knowledge\`（遵守用户级 Docker 大文件约定） |
| 检索编排 | 方案A：前端激活条目→调后端 search→结果进 latest user `<search_context>` |
| 检索来源 | 借 NyaaLibrary-MCP 检索核心重写，不 fork；加 `owner` 账号维度 |
| 嵌入配置 | 用户自带 OpenAI 兼容 `/embeddings`；apiKey 仅服务端、不回显、不入导出；默认 `Qwen/Qwen3-Embedding-8B` |
| 额度 | 新增 `kb_max`，默认 5，5 猫粮 / +1，硬上限 50（暂定） |
| 删除语义 | 绝不级联硬删；软引用 + 懒失效；仅 404 阻断条目保存 |
| 共享跨账号 | 发布登记绑定表授权只读；读取不耗额度；买断清理作者 KB 关联 |

---

## 2. 数据模型

### 2.1 后端（`nyaachat-knowledge` 独立 SQLite，含 owner 维度）

参照 NyaaLibrary-MCP `db/index.ts:22-112`，全部加 `owner`。

**knowledge_bases**
| 列 | 类型 | 说明 |
|---|---|---|
| id | TEXT PK | kbId（uuid） |
| owner | TEXT | 拥有者 account（NyaaAcount 登录名 / 本地映射键） |
| name | TEXT | 库名 |
| description | TEXT | 描述 |
| chunk_size / chunk_overlap | INTEGER | 切片参数 |
| dense_top_k / sparse_top_k | INTEGER | 检索参数 |
| char_total | INTEGER | 该库 chunk char_count 求和（token 量近似展示，见审计 §8） |
| enabled | INTEGER | |
| created_at / updated_at | INTEGER | unix ms |

**documents** / **chunks**：同 NyaaLibrary-MCP，均带 `kb_id`（→ 经 kb 关联 owner），`chunks` 的 rowid 同时作 vec0 与 fts5 的 join key。

**vec_chunks**（vec0 虚拟表）/ **chunks_fts**（fts5 trigram）：同 NyaaLibrary-MCP；**维度由该 owner 的嵌入配置锁定**（见 §2.3 风险）。

**embedding_configs**（每用户一条）
| 列 | 类型 | 说明 |
|---|---|---|
| owner | TEXT PK | account |
| base_url | TEXT | OpenAI 兼容 /embeddings 端点 |
| api_key | TEXT | **仅服务端存储，不回显、不导出**（D8） |
| model | TEXT | 默认 `Qwen/Qwen3-Embedding-8B` |
| dim | INTEGER | 探测锁定的维度 |
| updated_at | INTEGER | |

**character_kb_bindings**（共享角色跨账号只读授权来源，审计 §5.2）
| 列 | 类型 | 说明 |
|---|---|---|
| global_id | TEXT | 共享角色全局 id（shared 后端的 shared_characters.global_id） |
| kb_id | TEXT | 被该卡引用的作者知识库 id |
| owner | TEXT | 作者 account（= kb.owner，冗余便于清理） |
| PK | (global_id, kb_id) | |

**账号额度**：`kb_max` 存放位置二选一（P2 定稿）：① 在 `nyaachat-knowledge` 本地 users 镜像表加列；② 复用 shared-server 的 users 表加 `kb_max` 列并跨服务读取。**倾向 ②**（额度经济统一在 shared-server，`审计报告.md §7`），`nyaachat-knowledge` 通过内部调用 / 共享 DB 读取。P2 明确。

### 2.2 前端（`WorldInfoRule` 扩展）

```ts
export interface WorldInfoRule {
  // ...现有字段...
  /** 关联的知识库 id 列表（跨前后端软引用；后端删库不回改此处，检索时懒失效）。 */
  linkedKbIds?: string[];
}
```

`CharacterSettings` 无需新增字段（`worldInfo[]` 已挂在角色上，随角色存 localStorage / IndexedDB）。

### 2.3 关键风险：嵌入维度锁定

sqlite-vec vec0 建表即锁死维度。**每个 owner 的所有知识库共用其 embedding 配置的维度**。换模型 / 换维度使该用户已建库的向量全部失效需重嵌。UI 在「更换嵌入模型」处必须显著警告（审计 §6）。SSOT 约束：维度变更 → 提示重建，不静默。

---

## 3. 分阶段任务（V + P）

> 状态符号：⬜ 未开始 · 🟡 进行中 · ✅ 已完成
> 每个 P 独立可验证、可独立提交；收尾必做：独立 rebuild + 真机验证 + 测试清理 + commit/push + 交接文档 + memory。

### P0 — 子服务脚手架　✅ _完成于 2026-07-05_
- `nyaachat-knowledge/`：Express + better-sqlite3 + sqlite-vec + Dockerfile + package.json
- schema 初始化（§2.1 全表）+ `/health`（无表现页）
- `docker-compose.knowledge.yml`（project 名 `nyaachat-knowledge`，5108，external `nyaachat-net`，DB/向量库 bind mount 到 `E:\DockerRes\nyaachat-knowledge\`）
- 主 `docker-compose.yml` + `nginx.conf` 加 `/api/knowledge/` 反代（仿 `nginx.conf:241-245`）
- `rebuild-knowledge.py`（Python，仿 `rebuild-shared.py`）+ `.claude/skills/rebuild-knowledge/`
- NyaaAcount 鉴权外壳（`auth.js` + `nyaacount-client.js` 移植）
- **验收**：✅ `:5108/health` 与同源 `/api/knowledge/health` 均 `{ok:true}`，✅ DB 落盘宿主 bind mount，✅ 鉴权中间件生效

### P1 — 检索核心移植　✅ _完成于 2026-07-05_
- 移植重写 `chunk` / `ingest` / `embedding` / `retrieval` 四 service（RRF 混合检索）
- embedding 配置端点：`GET/PUT /api/knowledge/embedding-config`（apiKey 不回显）+ 健康检查（最低成本探测 + 维度探测锁定）
- 文档解析：txt / md / pdf（P1 定稿最终清单）
- **验收**：单账号建库→配置嵌入→上传文档→切片入库→search 返回合理 chunks（后端 API 直测）

### P2 — 知识库管理后端　✅
- KB CRUD（owner 隔离）、文档 CRUD、char_total 计量
- `kb_max` 额度落位（§2.1 方案②定稿）+ `POST /api/knowledge/expand-kb`（仿 `expand-slot` 事务，5 猫粮 +1，硬上限）
- 检索归属校验双路径（审计 §5.1）：私有库属主 + 共享卡登记绑定
- **验收**：额度上限拦截建库；扩容扣费正确；跨 owner 访问被 403；API 直测全绿

### P3 — 知识库管理前端　✅
- 入口按钮：工具栏 `用户角色`↔`正则` 之间，book 图标（`ChatHeader.tsx:165-201`）
- 知识库管理界面：卡片式（风格统一角色选择 / 聊天记录），库卡编辑 / 删除（红色二次确认）、token 量显示、新建按钮、知识库用量计量条
- 嵌入模型配置界面：baseUrl / apiKey / model（默认预填 8B）、「获取嵌入模型」外链、健康检查（通过才允许保存）、换模型重嵌警告；未配置时进管理界面直接打开配置
- 库编辑界面：沿用 NyaaLibrary-MCP 结构（文档管理 + 库内 token 计数 + 改名位置）
- **验收**：登录用户完整走通 配置→建库→传文档→检索测试；未配置引导；额度上限提示窗

### P4 — 规则条目关联 UI　✅
- `types.ts` 加 `WorldInfoRule.linkedKbIds`
- `WorldInfoRuleModal.tsx`：`已关联知识库` 标签列表（KB 徽标 book 图标）+ `关联知识库` 按钮（列库卡多选，显 token 量）+ 无库时「创建知识库」引导
- 失效处理（D4）：仅 404 已删红色 tag 且阻断保存 + 弹窗提示清理；网络 / API 不可达不阻断
- **验收**：多选关联、失效 tag 三态、404 阻断保存、网络抖动不误阻断

### P5 — 检索注入链路（方案A）　⬜
- `chatPipeline.ts`：条目激活后收集 `linkedKbIds` → 调 `/api/knowledge/search` → 结果并入 latest user `<search_context>` volatile part（合规审计 §2.1）
- 每条目注入 token 预算（默认 800）+ 多库结果合并 rerank/截断
- 包裹文案为数据陈述（可忽略无关项）
- **验收**：触发轮检索注入生效且 cache 未击穿（`usage` 验证）；对抗注入样例不执行；非触发轮无回归

### P6 — 共享角色跨账号　⬜
- 发布 / 更新共享角色时后端登记 `character_kb_bindings`（审计 §5.2）
- 使用态：解析卡内 `linkedKbIds` → 经 global_id 绑定授权跨账号只读检索（不耗额度，D6）
- 买断：转私有卡时清空 `worldInfo[].linkedKbIds`（D7）
- **验收**：他人用共享卡对话能只读检索到作者库；作者删库→绑定失效；买断卡关联被清

### P7 — 端到端联调 + 账号界面收尾　⬜
- 「共享账号」界面「共享卡槽」下方加「知识库栈」（上限 + 扩容）+ 达上限扩容提示窗
- 全链路真机联调（登录→建库→关联→对话检索→共享→买断）
- **验收**：端到端全绿；tsc + eslint 干净；测试数据清理；保留 nyaa 真实账号

---

## 4. 核心约束（架构层落实）

1. **检索结果永不进 system**，只进 latest user `<search_context>`（合规审计 §2.1）。
2. **permanent 条目的检索结果也走动态通道**，不进静态前缀，不击穿 prompt cache。
3. **注入内容不持久化**到聊天记录。
4. **apiKey 仅服务端**，不回显、不入导出、不进 bundle / 日志。
5. **检索归属后端强校验**（双路径），不靠前端隔离。
6. **绝不级联硬删**；跨前后端关联为软引用，懒失效。
7. **嵌入维度变更 → 提示重建**，不静默失效。
8. 每个 P 收尾遵循项目规范（rebuild / 验证 / 清理 / commit-push / 交接 / memory）。

---

## 5. 待定小项（实施前回收，见 `审计报告.md §11`）

- `kb_max` 硬上限（暂定 50）
- 单库文档数 / 单文档字节上限（参照 NyaaLibrary-MCP）
- 注入 token 预算默认值（暂定 800）与是否用户可调
- V1 文档解析格式最终清单（暂定 txt/md/pdf）
- 子服务端口（暂定 5108）
- `kb_max` 存放位置（倾向 shared-server users 表加列，P2 定稿）

---

## 6. 进度跟踪

Memory 关键节点（`H:\GitHub\.claude\projects\H--GitHub\memory\`）：每个 P 开始 / 完成、关键决策、跨阶段注意事项写入，`MEMORY.md` 加一行索引。
</content>
