# NyaaChat KnowledgeBase V1 阶段交接 KB-P2

## 交接目的
- 本文件记录 KB-V1 第 2 阶段（P2）完成状态，供 P3 和新对话续接。
- 续接前必读：`CLAUDE.md` → `.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md` → 本文件。

## 当前进度（P2 ✅ 已完成）
- ✅ `shared-server/src/db.js` — users 表新增 `kb_max` 列（INTEGER NOT NULL DEFAULT 5），遵循现有 try/catch 迁移模式
- ✅ `shared-server/src/routes/account.js` — 新增 expand-kb 路由、KB 扩容常量（步长 +1、成本 5 猫粮、硬上限 50）、expandKb prepared statement、profileOf 加 kbMax 字段
- ✅ `nginx.conf` — 新增 `location = /api/knowledge/expand-kb` 精确匹配规则，路由到 shared-server 的 `/account/expand-kb`
- ✅ `nyaachat-knowledge/src/routes/kb.js` — POST /kb 创建时校验 kb_max（读 req.user.kb_max，COUNT 当前 KB 数，超限返回 409）
- ✅ `nyaachat-knowledge/src/routes/search.js` — checkKbAccess 完善双路径：路径 1 (owner) + 路径 2 (character_kb_bindings 查询)

## 本轮已修复 / 已实现

| 文件 | 改动 |
|---|---|
| `shared-server/src/db.js`（修改） | 新增 kb_max 列迁移（NOT NULL DEFAULT 5） |
| `shared-server/src/routes/account.js`（修改） | KB 扩容常量 + expandKb statement + expand-kb 路由 + profileOf 加 kbMax |
| `nginx.conf`（修改） | 新增 `location = /api/knowledge/expand-kb` 精确路由到 shared-server |
| `nyaachat-knowledge/src/routes/kb.js`（修改） | POST /kb 加 kb_max 额度校验（读 shared DB + COUNT 本地 KB） |
| `nyaachat-knowledge/src/routes/search.js`（修改） | checkKbAccess 实现路径 2（character_kb_bindings 查询，P6 填充数据） |
| `.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md`（修改） | P2 ⬜→✅ |
| `.docs/nyaachat-KnowledgeBase-plan/用户使用交互要点设计.md`（修改） | 新增「账号登录要求」段（用户编辑） |

### 设计决策记录
- **expand-kb 端点位置**：放在 shared-server 的 `account.js`（而非 knowledge 服务），因为 knowledge 对 shared DB 只有只读挂载（`:ro`），猫粮扣费写入必须在 shared-server 的写连接完成。
- **nginx 路由**：用精确匹配 `location = /api/knowledge/expand-kb` 路由到 shared-server，不影响 `/api/knowledge/*` 通用规则。
- **扩容参数**：步长 +1、成本 5 猫粮、硬上限 50。

## 仍需继续验证 / 已知问题
- expand-kb 成功路径的真实验证未执行（测试账号 catfood=0，扩容返回 402 insufficient——余额校验正确生效，但成功扩容路径需有余额的账号验证）。
- character_kb_bindings 表已在 P0 schema 中创建，P2 已实现查询逻辑（路径 2），但 P6 才会在发布共享角色时填充该表。当前路径 2 对非 owner 访问正确返回 403。
- 嵌入 API 端到端验证依赖用户配置 API key（P1 遗留）。

## 下一阶段（P3）
- P3：知识库管理前端 — 工具栏入口按钮、知识库管理界面（卡片式）、嵌入模型配置界面、库编辑界面、知识库用量计量条。

## 续接提示词
```
继续开发 NyaaChat KnowledgeBase V1 的 P3 阶段：知识库管理前端。

必读文档：
- H:\GitHub\NyaaChat\CLAUDE.md（项目规范）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\开发计划-SSOT.md（KB-V1 蓝图）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\用户使用交互要点设计.md（UI 交互要点）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\阶段交接-KB-P2.md（本文件）

当前进度：
- P0 脚手架 + P1 检索核心 + P2 知识库管理后端 全部完成。
- 后端完整提供：KB CRUD（含 kb_max 额度校验）、文档管理、混合检索（RRF）、
  嵌入配置端点、expand-kb 扩容（5 猫粮/+1/硬上限 50）、profile.kbMax 字段。
- expand-kb 端点在 shared-server，通过 nginx location = /api/knowledge/expand-kb 精确路由。

P3 要做的（前端）：
- 工具栏入口按钮：`用户角色`↔`正则` 之间，book 图标（ChatHeader.tsx）。
- 知识库管理界面：卡片式（风格统一角色选择/聊天记录），库卡编辑/删除（红色二次确认）、
  token 量显示、新建按钮、知识库用量计量条（currentCount/kbMax）。
- 嵌入模型配置界面：baseUrl/apiKey/model、健康检查（通过才允许保存）、换模型重嵌警告；
  未配置时进管理界面直接打开配置。
- 库编辑界面：文档管理 + 库内 token 计数 + 改名。
- 注意「账号登录要求」段：未登录用户点击知识库管理入口应打开登录界面。

关键约束：
- apiKey 仅服务端存储，前端仅展示 api_key_set 布尔值
- 前端 API 调用走同源 /api/knowledge/*（通过 nginx 反代）
- 提交用 Conventional Commits、git add <file>、禁止 force push
- 完成后写 .docs/阶段交接-KB-P3.md
```
