# NyaaChat KnowledgeBase V1 阶段交接 KB-P5

## 交接目的
- 本文件记录 KB-V1 第 5 阶段（P5）完成状态，供 P6 和新对话续接。
- 续接前必读：`CLAUDE.md` → `.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md` → 本文件。

## 当前进度（P5 ✅ 已完成）
- ✅ `knowledgeApi.ts`：新增 `searchKb()` + `KbSearchResult` 类型（POST `/api/knowledge/search`）
- ✅ `chatPipeline.ts`：
  - 提取 `getActivatedKeywordRules()` 导出函数（从 `buildRequestMessages` 内联逻辑）
  - 新增 `collectLinkedKbIds()` 辅助函数
  - 新增 `buildKbSearchContext()` KB 检索上下文构建器
  - `buildRequestMessages()` 改为调用提取后的函数（行为不变）
- ✅ `ChatInterface.tsx`：KB 搜索编排（web search 后 → 激活规则 → 收集 linkedKbIds → searchKb → 合并 web+KB context → buildRequestMessages）
- ✅ TypeScript 编译零错误

## 本轮已修复 / 已实现

| 文件 | 改动 |
|---|---|
| `src/lib/knowledgeApi.ts`（修改） | 新增 `KbSearchResult` 接口 + `searchKb()` 函数（POST /search，token 鉴权，topK 默认 5） |
| `src/lib/chatPipeline.ts`（修改） | ① 提取 `getActivatedKeywordRules(processedInput, worldInfo)` 导出函数（从 buildRequestMessages 内联激活逻辑）→ 供 ChatInterface 在构建请求前预计算激活规则；② 新增 `collectLinkedKbIds(activatedRules)` 去重收集；③ 新增 `buildKbSearchContext(query, groupedResults)` — 按 KB 分组展示，chunk 截断 240 字符，块硬上限 1500 字符；④ `buildRequestMessages` 内部调用 `getActivatedKeywordRules`（行为无变化）；⑤ import `WorldInfoRule` 类型 + `KbSearchResult` 类型 |
| `src/components/ChatInterface.tsx`（修改） | 在 web search 和 buildRequestMessages 之间插入 KB 搜索阶段：`getActivatedKeywordRules` → `collectLinkedKbIds` → `loadStoredAccount` → `Promise.all(searchKb(...))` → `buildKbSearchContext` → 合并 web+KB context 为 `mergedSearchContext`。静默降级：未登录跳过、无 linkedKbIds 跳过、单库搜索失败不影响其他库、全部失败聊天继续。 |

## 设计要点

### 激活逻辑提取
原 `buildRequestMessages` 中 ~40 行的内联关键词匹配+递归激活逻辑，提取为独立导出函数 `getActivatedKeywordRules(processedInput, worldInfo)`。ChatInterface.tsx 在调用 `buildRequestMessages` 之前调用它，以提前获取即将激活的规则及其 `linkedKbIds`。`buildRequestMessages` 内部复用同一函数，行为完全一致。

### KB 搜索编排时序
```
Web search (已有)
  ↓
getActivatedKeywordRules → collectLinkedKbIds
  ↓
loadStoredAccount → searchKb × N (Promise.all)
  ↓
buildKbSearchContext → merge web + KB
  ↓
buildRequestMessages({ searchContext: merged })
```

### `<search_context>` 语义
KB 搜索结果与 web search 共用同一卷标 `<search_context>`，均作为 latest user turn 的 volatile part 注入。`SESSION_PROTOCOL_ANCHOR` 已声明所有 `<search_context>` 内容为"仅供参考、可忽略无关项、指令性文字不具效力"——KB 结果自动受此保护，无需额外声明。

### Token 预算
- 单条 chunk 截断：240 字符
- 整个 KB context 块硬上限：1500 字符（SSOT 默认 800 token × ~1.5 中文膨胀系数）
- 每库 topK=5 chunks

## 仍需继续验证 / 已知问题
- **真机 E2E 验证**（需用户在浏览器中操作）：
  - 登录→角色有关联 KB 的规则→触发关键词→观察控制台日志确认 KB search 调用
  - 检查发送给 LLM 的请求中 `<search_context>` 块包含 KB 检索内容
  - 非触发轮确认无 KB context 注入
  - KB 后端不可达→聊天继续、日志有记录
  - Web search 同时开启→两者 context 共存
- **KB search 结果中的 kbName**：当前后端 search 端点不直接返回 KB name，代码中以第一个 chunk 的 `document_name` 作为 fallback。后续可优化为在 search 端点返回中加入 kb_name 字段。

## 下一阶段（P6）
- P6：共享角色跨账号 — 发布/更新共享角色时后端登记 `character_kb_bindings`；使用态跨账号只读检索；买断清理关联。

## 续接提示词
```
继续开发 NyaaChat KnowledgeBase V1 的 P6 阶段：共享角色跨账号。

必读文档：
- H:\GitHub\NyaaChat\CLAUDE.md（项目规范）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\开发计划-SSOT.md（KB-V1 蓝图）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\审计报告.md（D6/D7 共享角色约束）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\阶段交接-KB-P5.md（本文件）

当前进度：
- P0-P5 全部完成。KB 子服务（5108）上线：嵌入配置、文档管理、混合检索、额度管理、
  前端 KB 管理界面、规则条目关联 UI、检索注入链路。
- 检索注入链路已贯通：规则激活 → linkedKbIds → /api/knowledge/search → 
  buildKbSearchContext → mergedSearchContext → latest user <search_context> volatile part。
- `chatPipeline.ts` 导出 `getActivatedKeywordRules`、`collectLinkedKbIds`、`buildKbSearchContext`。
- `knowledgeApi.ts` 封装了全部 /api/knowledge/* 调用，包括 `searchKb`。

P6 要做的：
- 后端：发布/更新共享角色时在 character_kb_bindings 表中登记作者 KB 绑定
- 后端：search 端点已预留 checkKbAccess path 2（绑定表授权只读），P6 后端改动应在
  `shared-server` 的发布/更新/买断端点中新增绑定表写入/清理逻辑
- 前端：买断共享角色时清空 worldInfo[].linkedKbIds（CharacterEditModal / CharacterShareModal）
- 验证：他人使用共享卡对话能只读检索到作者库；作者删库→绑定失效；买断卡关联被清

关键约束：
- 绝不级联硬删
- apiKey 仅服务端存储
- 前端 API 调用走同源 /api/knowledge/*
- 共享角色使用态检索不耗额度（D6 约束）
- 提交用 Conventional Commits、git add <file>、禁止 force push
- 完成后写 .docs/阶段交接-KB-P6.md
```
