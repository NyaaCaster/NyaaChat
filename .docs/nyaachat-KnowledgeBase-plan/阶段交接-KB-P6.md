# NyaaChat KnowledgeBase V1 阶段交接 KB-P6

## 交接目的
- 本文件记录 KB-V1 第 6 阶段（P6）完成状态，供 P7 和新对话续接。
- 续接前必读：`CLAUDE.md` → `.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md` → 本文件。

## 当前进度（P6 ✅ 已完成）
- ✅ ST 导出保留 linkedKbIds（`sillyTavernExport.ts` buildEntryExtensions 写入 extensions.linkedKbIds）
- ✅ ST 导入还原 linkedKbIds（`sillyTavernImport.ts` 从 extensions.linkedKbIds 读取）
- ✅ 知识库后端内部绑定 API（`routes/internal.js`：POST/DELETE /internal/bindings，INTERNAL_API_TOKEN 鉴权）
- ✅ 共享后端绑定同步（发布/更新时 upsert bindings，删除时清理 bindings，fire-and-forget）
- ✅ 前端买断清除 linkedKbIds（D7：买断时遍历 worldInfo 删除 linkedKbIds）
- ✅ Docker 环境变量配置（INTERNAL_API_TOKEN + KNOWLEDGE_SERVER_URL）
- ✅ TypeScript 编译零错误
- ✅ 三个容器 rebuild 成功 + health 全绿

## 本轮已修复 / 已实现

| 文件 | 改动 |
|---|---|
| `src/lib/sillyTavernExport.ts`（修改） | buildEntryExtensions 返回对象增加 `linkedKbIds: rule.linkedKbIds ?? []` |
| `src/lib/sillyTavernImport.ts`（修改） | ST entry mapper 从 `e.extensions?.linkedKbIds` 读取还原，空数组 → undefined |
| `nyaachat-knowledge/src/routes/internal.js`（新建） | POST /internal/bindings（upsert 绑定事务）+ DELETE /internal/bindings/:globalId（清空绑定），X-Internal-Token 头校验 |
| `nyaachat-knowledge/src/server.js`（修改） | import + mount internalRouter 到 /internal |
| `shared-server/src/routes/characters.js`（修改） | 新增 extractLinkedKbIdsFromCard / syncKbBindings / deleteKbBindings；POST/PUT/DELETE 三处调用 |
| `src/components/SharedLibraryModal.tsx`（修改） | buildLocalCharacter 中 shared=false（买断）时清除 worldInfo[].linkedKbIds |
| `docker-compose.knowledge.yml`（修改） | 加 INTERNAL_API_TOKEN 环境变量 |
| `docker-compose.shared.yml`（修改） | 加 INTERNAL_API_TOKEN + KNOWLEDGE_SERVER_URL |
| `.env.example`（修改） | 加 INTERNAL_API_TOKEN 和 KNOWLEDGE_SERVER_URL 文档 |

## 设计要点

### linkedKbIds 在 ST 格式中的位置
发布时 `convertToSillyTavernCharacter` 将 WorldInfoRule 序列化到 `data.character_book.entries[].extensions.linkedKbIds`。共享后端提取路径：`parsed.data.character_book.entries[].extensions.linkedKbIds`

### 跨服务绑定同步
```
Publish/Update:
  shared-server POST/PUT /characters
    → extractLinkedKbIdsFromCard(cardJson)
    → syncKbBindings(globalId, kbIds, owner)     [fire-and-forget]
    → POST http://nyaachat-knowledge:5108/internal/bindings
    → knowledge-server upserts character_kb_bindings rows

Delete:
  shared-server DELETE /characters/:id
    → deleteKbBindings(globalId)                   [fire-and-forget]
    → DELETE http://nyaachat-knowledge:5108/internal/bindings/:globalId
```

### 跨账号检索（path 2）
checkKbAccess 路径 2（`search.js:27-30`）通过 `SELECT 1 FROM character_kb_bindings WHERE kb_id = ?` 授权。P6 填充绑定后，非所有者用户使用共享角色时，前端仅对角色已关联的 linkedKbIds 发起搜索。kb_ids 为 UUID 不可猜测，V1 不验证"用户是否持有该共享角色"（防御纵深留后续版本）。

### 买断清除（D7）
`buildLocalCharacter(card, shared=false)` → 遍历 `local.worldInfo[]` 删除每个 rule 的 `linkedKbIds`。买断后角色为纯私有，不再引用原作者 KB。

### KB 删除时绑定清理
已有机制：`nyaachat-knowledge/src/routes/kb.js:206` 在删除 KB 时调用 `deleteBindings.run(kbId)`，确保作者删库后绑定失效。

## 仍需继续验证 / 已知问题

### 必需：设置 INTERNAL_API_TOKEN
`.env` 中尚未设置 `INTERNAL_API_TOKEN`。**不设置则绑定同步静默失败**（共享后端日志有 warning，发布/更新/删除仍成功但无绑定写入）。

生成方式：
```
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```
将输出写入 `.env` 的 `INTERNAL_API_TOKEN=` 行，然后重建知识库和共享后端：
```
python rebuild-knowledge.py && python rebuild-shared.py
```

### 真机 E2E 验证（需用户在浏览器中操作）
- 发布带 linkedKbIds 的角色 → 检查 knowledge DB 中 `character_kb_bindings` 表有对应行
- 他人获取并打开共享角色 → 触发 KB 关联规则 → KB 搜索结果注入（检查控制台日志）
- 更新角色修改 linkedKbIds → bindings 同步更新
- 删除共享角色 → bindings 清空
- 买断角色 → worldInfo 中 linkedKbIds 被清除
- ST PNG 导出再导入 → linkedKbIds 保留

### checkKbAccess path 2 已知局限
当前 `WHERE kb_id = ? LIMIT 1` 不验证"请求者是否持有该共享角色"。kb_ids 为 UUID，前端仅对角色关联的 KB 发起搜索，实际攻击面极小。V2 可考虑在绑定表中加 user 维度或跨引用 shared-server 角色获取记录。

## 下一阶段（P7）
- P7：端到端联调 + 账号界面收尾 — 「共享账号」界面加「知识库栈」条目、全链路联调

## 续接提示词
```
继续开发 NyaaChat KnowledgeBase V1 的 P7 阶段：端到端联调 + 账号界面收尾。

必读文档：
- H:\GitHub\NyaaChat\CLAUDE.md（项目规范）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\开发计划-SSOT.md（KB-V1 蓝图）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\阶段交接-KB-P6.md（本文件）

当前进度：
- P0-P6 全部完成。P6 实现了共享角色跨账号只读检索：
  - ST 导出/导入保留 linkedKbIds
  - 发布/更新时 knowledge DB 自动登记 character_kb_bindings
  - 买断清除 linkedKbIds
  - 跨服务内部 API（INTERNAL_API_TOKEN 鉴权）
- 注意：INTERNAL_API_TOKEN 可能尚未在 .env 设置，若 E2E 验证前需先确认。

P7 要做的：
- 「共享账号」界面「共享卡槽」下方加「知识库栈」条目（上限 + 扩容按钮）
- 达上限时从共享角色库获取/新建知识库弹出扩容提示窗
- 全链路真机联调（登录→建库→关联→对话检索→共享→买断）
- tsc + eslint 干净
- 测试数据清理
- 保留 nyaa 真实账号

关键约束：
- 绝不级联硬删
- apiKey 仅服务端存储
- 前端 API 调用走同源 /api/knowledge/*
- 提交用 Conventional Commits、git add <file>、禁止 force push
- 完成后写 .docs/阶段交接-KB-P7.md
```
