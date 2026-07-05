# NyaaChat KnowledgeBase V1 阶段交接 KB-P3

## 交接目的
- 本文件记录 KB-V1 第 3 阶段（P3）完成状态，供 P4 和新对话续接。
- 续接前必读：`CLAUDE.md` → `.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md` → 本文件。

## 当前进度（P3 ✅ 已完成）
- ✅ 工具栏入口：ChatHeader 在 用户角色↔正则 之间加入 Book 图标按钮
- ✅ 知识库管理主界面（KnowledgeBaseModal）：卡片式 KB 列表、StorageBar 用量计量条、创建/删除/扩容
- ✅ 嵌入模型配置界面（EmbeddingConfigModal）：baseUrl/apiKey/model、健康检查（通过才可保存）、模型变更警告、"获取嵌入模型"外链
- ✅ 知识库编辑界面（KnowledgeBaseEditModal）：在线改名、文档管理（上传/删除）、token 计数
- ✅ 登录检测：未登录用户点击入口→显示登录引导→打开 UserAccountModal
- ✅ 未配置嵌入模型自动引导：首次进入直接打开 EmbeddingConfigModal

## 本轮已修复 / 已实现

| 文件 | 改动 |
|---|---|
| `src/lib/knowledgeApi.ts`（新增） | KB API 客户端：listKb/createKb/getKb/updateKb/deleteKb/listDocuments/uploadDocuments/deleteDocument/getEmbeddingConfig/saveEmbeddingConfig/healthCheckEmbedding/expandKb |
| `src/lib/sharedAccountApi.ts`（修改） | AccountProfile 加 `kbMax: number` 字段 |
| `src/components/EmbeddingConfigModal.tsx`（新增） | 嵌入模型配置：baseUrl/apiKey/model 表单、健康检查门控保存、模型变更警告、自动保存 |
| `src/components/KnowledgeBaseEditModal.tsx`（新增） | 库编辑界面：inline 改名、文档卡片列表、base64 上传 txt/md/pdf、文档删除 |
| `src/components/KnowledgeBaseModal.tsx`（新增） | 主管理界面：登录检测+引导、KB 用量计量条、卡片网格、创建/删除/扩容、子 Modal 编排 |
| `src/components/ChatHeader.tsx`（修改） | 工具栏新增加 Book 图标按钮 + KnowledgeBaseModal portal |

## 仍需继续验证 / 已知问题
- **真机 E2E 验证**（需用户在浏览器中操作）：完整走通 登录→配置嵌入→建库→上传文档→删除流程。由于用户 apiKey 涉及第三方服务（SiliconFlow），健康检查的真实通过验证需用户提供有效 key。
- **KB 编辑界面中的文档上传**：base64 编码对大文件（>5MB）可能在浏览器中有性能问题。当前后端无文件大小显式上限，但前端 `File.arrayBuffer()` 对大文件可能造成主线程卡顿。后续可改为分片上传或使用 Web Worker。
- **嵌入模型配置中的 apiKey**：后端已通过 `maskedConfig` 确保不回显明文 key，前端仅展示 `api_key_set` 布尔值。验证通过。
- **扩容按钮**：默认账户 catfood=0，扩容返回 402 insufficient（余额校验正确生效），但成功扩容路径需有余额的账户验证。

## 下一阶段（P4）
- P4：规则条目关联 UI — `WorldInfoRule.linkedKbIds` 字段、`已关联知识库` 标签列表、`关联知识库` 多选勾选、失效处理（404 红色 tag 阻断保存）

## 续接提示词
```
继续开发 NyaaChat KnowledgeBase V1 的 P4 阶段：规则条目关联 UI。

必读文档：
- H:\GitHub\NyaaChat\CLAUDE.md（项目规范）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\开发计划-SSOT.md（KB-V1 蓝图）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\用户使用交互要点设计.md（UI 交互要点 §已关联知识库 / 关联知识库 / 失效处理）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\阶段交接-KB-P3.md（本文件）

当前进度：
- P0 脚手架 + P1 检索核心 + P2 后端管理 + P3 前端管理界面 全部完成。
- 前端完整提供：工具栏 Book 入口、KB 卡片管理（CRUD）、嵌入模型配置（健康检查门控）、
  KB 编辑（文档上传/删除/改名）、用量计量条、登录检测、未配置引导。
- API 客户端 `src/lib/knowledgeApi.ts` 封装了所有 /api/knowledge/* 调用。
- KB 数据为服务端存储，前端每次打开 Modal 时重新获取，不持久化到 AppState。

P4 要做的（前端）：
- types.ts：WorldInfoRule 加 linkedKbIds?: string[]
- WorldInfoRuleModal.tsx：
  - 已关联知识库标签列表（每个库以 tag 显示，KB 徽标用 Book 图标）
  - 关联知识库按钮→弹出 KnowledgeBaseSelectModal（卡片多选+token 量显示）
  - 无库时引导"创建知识库"→先保存规则条目再打开 KB 管理界面
  - 失效处理：API 404 的库 tag 红色显示 + 阻断保存 + 弹窗提示清理
  - 网络/API 不可达时不断阻断
- 登录检测：点击关联知识库时如果未登录，先保存当前规则条目，再打开登录界面
- 注意图片模式导出导入角色卡时的 linkedKbIds 结构处理
- 注意 SillyTavern 格式导出时清理 linkedKbIds

关键约束：
- 绝不级联硬删：用户只能在 KB 管理界面删除 KB，不可在规则条目编辑中删除 KB
- apiKey 仅服务端存储
- 前端 API 调用走同源 /api/knowledge/*
- 提交用 Conventional Commits、git add <file>、禁止 force push
- 完成后写 .docs/阶段交接-KB-P4.md
```
