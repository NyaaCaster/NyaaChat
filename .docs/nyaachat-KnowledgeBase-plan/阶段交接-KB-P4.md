# NyaaChat KnowledgeBase V1 阶段交接 KB-P4

## 交接目的
- 本文件记录 KB-V1 第 4 阶段（P4）完成状态，供 P5 和新对话续接。
- 续接前必读：`CLAUDE.md` → `.docs/nyaachat-KnowledgeBase-plan/开发计划-SSOT.md` → 本文件。

## 当前进度（P4 ✅ 已完成）
- ✅ `types.ts`：`WorldInfoRule` 加 `linkedKbIds?: string[]`
- ✅ `KnowledgeBaseSelectModal.tsx`（新建）：KB 多选器（卡片 + checkbox + token 计数 + 空库引导）
- ✅ `WorldInfoRuleModal.tsx`：已关联 KB 标签列表（Book 图标）、关联按钮、登录 gate、失效检测阻断、无库引导
- ✅ `CharacterEditModal.tsx`：`persistCharacter` 回调 + `KnowledgeBaseModal` 子模态集成
- ✅ SillyTavern 导出：`toStEntry` 白名单字段自动剥离 `linkedKbIds`（无需代码改动）
- ✅ NyaaChat 原生导入导出：`worldInfo` 整体序列化，`linkedKbIds` 自然跟随
- ✅ TypeScript 编译通过，零错误

## 本轮已修复 / 已实现

| 文件 | 改动 |
|---|---|
| `src/types.ts`（修改） | `WorldInfoRule` 加 `linkedKbIds?: string[]` 字段（软引用，不级联硬删） |
| `src/components/KnowledgeBaseSelectModal.tsx`（新增） | KB 多选器：卡片列表 + checkbox + token/文档/分块计数 + 空库引导创建 |
| `src/components/WorldInfoRuleModal.tsx`（重写） | 新增：session 自管理（`loadStoredAccount` + `listKb`/`getKb` 两级验证）、已关联 KB 标签列表（正常蓝/404 红/网络错误琥珀三态）、关联知识库按钮（未登录先保存角色+规则→登录界面）、失效阻断保存（ConfirmDialog 提示移除失效关联）、无库引导创建 |
| `src/components/CharacterEditModal.tsx`（修改） | 新增 `persistCharacter` 回调（`buildCurrentCharacter()` 持久化不关闭 Modal）、`isKbManagerOpen` state、`KnowledgeBaseModal` 子模态渲染 |
| `src/lib/sillyTavernExport.ts` | 无需改动（验证确认 `toStEntry` 白名单字段自动剥离 `linkedKbIds`） |

## 设计要点

### 两级 KB 验证策略
1. `listKb` 批量获取→构建 `Map<id, KnowledgeBase>`
2. 未命中的 ID 再逐个 `getKb` 做第二条确认
3. `getKb` 返回 404 → 状态 `"not_found"`（红色 tag + 阻断保存）
4. `getKb` 返回 network_error → 状态 `"network_error"`（琥珀色 tag + 不阻断）

### 登录检测流程
用户点击「关联知识库」按钮时：
- 已登录 → 刷新 KB 列表 → 打开 KnowledgeBaseSelectModal
- 未登录 → ① `onSave(rule)` 保存规则 → ② `onPersistCharacter()` 持久化角色 → ③ 打开 UserAccountModal

### 组件树通信
- WorldInfoRuleModal → CharacterEditModal：通过 props 回调（`onSave`, `onPersistCharacter`, `onOpenKnowledgeBase`）
- 不依赖自定义事件（CharacterEditModal 直接渲染 KnowledgeBaseModal）

## 仍需继续验证 / 已知问题
- **真机 E2E 验证**（需用户在浏览器中操作）：
  - 登录→编辑角色→关联 KB→保存→重新打开→确认关联保留
  - 删除已关联的 KB→编辑规则条目→红色 tag 提醒→尝试保存被阻断→移除失效关联→保存成功
  - 网络断开→编辑含 KB 关联的规则→保存不阻断
  - 未登录→编辑规则→关联 KB→弹出登录→登录后角色和规则均不丢失
  - 无库账户→编辑规则→关联 KB→创建知识库→确认引导流程
  - SillyTavern PNG 导出→card JSON 中无 linkedKbIds
  - NyaaChat PNG 导出→重新导入→linkedKbIds 保留

## 下一阶段（P5）
- P5：检索注入链路（方案A）— `chatPipeline.ts` 中条目激活后收集 `linkedKbIds` → `/api/knowledge/search` → 结果进 latest user `<search_context>`

## 续接提示词
```
继续开发 NyaaChat KnowledgeBase V1 的 P5 阶段：检索注入链路（方案A）。

必读文档：
- H:\GitHub\NyaaChat\CLAUDE.md（项目规范）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\开发计划-SSOT.md（KB-V1 蓝图）
- H:\GitHub\NyaaChat\.docs\nyaachat-KnowledgeBase-plan\阶段交接-KB-P4.md（本文件）

当前进度：
- P0 脚手架 + P1 检索核心 + P2 后端管理 + P3 前端管理界面 + P4 规则条目关联 UI 全部完成。
- 规则条目编辑界面完整提供：KB 多选关联（卡片+checkbox+token计数）、标签列表（三态显示）、
  失效检测阻断（404 红色 tag→ConfirmDialog→自动清除/手动处理）、登录 gate（先保存角色+规则再登录）、
  无库引导创建（先保存再打开 KB 管理）。
- `src/lib/knowledgeApi.ts` 封装了所有 /api/knowledge/* 调用。
- `WorldInfoRule` 已有 `linkedKbIds?: string[]` 字段。

P5 要做的：
- `src/lib/chatPipeline.ts`：在现有的 worldInfo 规则激活逻辑中，对已激活的规则条目，
  收集其 `linkedKbIds` → 调 `/api/knowledge/search` → 结果格式化注入 latest user `<search_context>` 的 volatile part
- 每条目注入 token 预算（默认 800）+ 多库结果合并截断
- 包裹文案为数据陈述（可忽略无关项）
- 检索结果永不进 system prompt、不进 static prefix、不击穿 prompt cache、不持久化到聊天记录

关键约束：
- 绝不级联硬删
- apiKey 仅服务端存储
- 前端 API 调用走同源 /api/knowledge/*
- 提交用 Conventional Commits、git add <file>、禁止 force push
- 完成后写 .docs/阶段交接-KB-P5.md
```
