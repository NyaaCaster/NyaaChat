# NyaaChat 额外问候语（Alternate Greetings）开发计划 (SSOT)

> 本文档为 NyaaChat 多开场问候语功能的单一事实来源（SSOT）。
> 遵循 Vibo Coding 规范及 SillyTavern 角色卡标准规范（Spec v2/v3）。

---

## 一、项目目标与边界

### 1.1 核心目标
1. **数据模型对齐**：为 NyaaChat 的角色（`Character`）与消息（`Message`）增加符合 ST 规范的多开局数据结构。
2. **ST 导入/导出无损互通**：支持导入包含 `alternate_greetings` 的 ST v2/v3 角色卡（包括样例 `多开局测试.json` 及带图片角色卡），并在导出角色卡时无损导出该字段。
3. **角色编辑 UI**：在角色卡编辑界面（`CharacterEditModal`）中提供「其他开场」功能，支持增删改查、排序并实时保存额外开场白。
4. **会话首条消息翻页切换**：新对话开始时（纯净状态），若角色包含多开场白，允许用户在首条消息气泡上通过左右翻页按钮自由切换不同开局，切换实时变更消息内容与后续上下文。
5. **纯净度防护（Pristine Protection）**：一旦用户发送第一条对话或产生多轮交互，开场白锁定，自动隐藏翻页切换控件，防止破坏已有对话历史。

### 1.2 边界与非目标
* **非目标**：暂不支持常规对话消息（AI/User）的重新生成多分支 Swipe（此阶段专注于开场白的多分支切换）。
* **非目标**：暂不实现群聊专属开场白（`group_only_greetings`），按普通额外开场白处理或后续阶段支持。

---

## 二、架构与数据结构设计

### 2.1 数据模型（`src/types.ts`）

#### 1. `Character` 结构扩展
```typescript
export interface Character {
  // ...既有字段
  firstMes?: string;
  /** SillyTavern 规范：额外开场问候语列表 */
  alternateGreetings?: string[];
}
```

#### 2. `Message` 结构扩展
```typescript
export interface Message {
  // ...既有字段
  content: string;
  /** 首条开场消息的多分支候选项（包含 first_mes 与 alternate_greetings） */
  swipes?: string[];
  /** 当前选中的开场索引（0-based，默认为 0） */
  swipeId?: number;
}
```

### 2.2 流程与生命周期

```
   ┌───────────────────────────────────────────────┐
   │ 角色卡导入 (sillyTavernImport.ts)             │
   │ 提取 data.alternate_greetings → Character     │
   └──────────────────────┬────────────────────────┘
                          │
                          ▼
   ┌───────────────────────────────────────────────┐
   │ 新会话开启 (ChatInterface.tsx: buildFirstMes)  │
   │ swipes = [firstMes, ...alternateGreetings]    │
   │ swipeId = 0, content = swipes[0]              │
   └──────────────────────┬────────────────────────┘
                          │
                          ▼
   ┌───────────────────────────────────────────────┐
   │ 对话展示 (MessageItem.tsx)                    │
   │ 判定：mesid === 0 && messages.length === 1     │
   │       && swipes.length > 1                    │
   │ 渲染：◀ 1 / 3 ▶ 翻页指示器与切换按钮          │
   └──────────────────────┬────────────────────────┘
                          │ 点击翻页
                          ▼
   ┌───────────────────────────────────────────────┐
   │ 切换开场 (handleSwipeGreeting(newSwipeId))    │
   │ 更新 swipeId = newSwipeId                     │
   │ 更新 content = swipes[newSwipeId]             │
   │ 触发 UI 重绘与上下文同步                      │
   └──────────────────────┬────────────────────────┘
                          │ 用户发送第一条消息
                          ▼
   ┌───────────────────────────────────────────────┐
   │ 状态固化 (messages.length > 1)                │
   │ 翻页器隐藏，开场白锁定为当前内容              │
   └───────────────────────────────────────────────┘
```

---

## 三、阶段划分（P 阶段）

### P1：数据模型与 ST 导入/导出适配
* **目标**：打通底层数据流，确保包含多开局的角色卡导入导出无损。
* **涉及文件**：
  * `src/types.ts`：增加 `alternateGreetings` 与 `Message.swipes`, `Message.swipeId`。
  * `src/lib/sillyTavernImport.ts`：解析 `data.alternate_greetings` 与顶层降级字段。
  * `src/lib/sillyTavernExport.ts`：导出写入 `data.alternate_greetings` 与顶层字段。
* **验收标准**：
  * 导入 `H:\GitHub\NyaaChat\.docs\alternate-greetings\多开局测试.json`，正确读出主开场与 2 条额外问候语。
  * 导出该角色为 ST JSON，对比生成的 `alternate_greetings` 数组内容一致。

### P2：角色编辑界面「其他开场」管理弹窗
* **目标**：在角色编辑弹窗中允许用户可视化查看、添加、编辑、删除和排序额外问候语。
* **涉及文件**：
  * `src/components/AlternateGreetingsModal.tsx`（新建）：独立弹窗组件。
  * `src/components/CharacterEditModal.tsx`：在「首条消息」输入框旁增加入口按钮与数量标记，维护 `alternateGreetings` 状态。
* **验收标准**：
  * 在角色编辑界面点击「其它开场」，能查看已有问候语列表。
  * 支持添加新开场白、修改已有内容、删除条目、上移/下移调整顺序。
  * 保存角色后变更持久化到 IndexedDB。

### P3：对话界面开场白构建与翻页切换
* **目标**：开场白支持多分支切换，操作直观友好，上下文实时更新。
* **涉及文件**：
  * `src/components/ChatInterface.tsx`：
    * `buildFirstMes` 构造 `swipes` 与 `swipeId`。
    * 提供 `handleSwipeGreeting(messageId, targetIndex)` 切换逻辑。
  * `src/components/MessageItem.tsx`：
    * 首条消息且未污染时，在头像下方/消息气泡底部渲染翻页按钮 `< 1 / 3 >`。
    * 点击左右翻页平滑切换正文，同时支持键盘或辅助提示。
* **验收标准**：
  * 新建对话时，包含额外问候语的角色第一条消息显示翻页组件 `1/3`。
  * 点击右翻页，消息内容切换为「开局二」，指示器变为 `2/3`。
  * 再右翻页，切换为「开局三」，支持循环或边界保护。
  * 发送第一条用户消息后，翻页按钮自动消失，当前选中的开局完整保留在会话中。

### P4：端到端验证与综合测试
* **目标**：完整体验测试与边缘情况覆盖。
* **验证场景**：
  1. 使用样例卡 `多开局测试.json` 建立新对话，切换到「开局二」后发消息，验证 LLM 接收到的历史记录确实包含「开局二」。
  2. 只有单条开场白的角色，不显示翻页器，行为与原版一致。
  3. 编辑角色卡增删问候语后，新开对话能正确呈现最新的问候语集合。
  4. 历史聊天记录载入旧存档，无崩溃、无警告，平滑兼容。

---

## 四、进度跟踪表

| 阶段 | 内容 | 状态 |
| :--- | :--- | :---: |
| **P1** | 数据模型扩展与 ST 导入/导出适配 | ⬜ 未开始 |
| **P2** | 角色编辑弹窗中的「其他开场」管理器 | ⬜ 未开始 |
| **P3** | 对话首条消息多分支组装与翻页切换机制 | ⬜ 未开始 |
| **P4** | 完整端到端测试与边缘情况验证 | ⬜ 未开始 |
