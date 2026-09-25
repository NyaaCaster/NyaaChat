# SillyTavern「额外问候语（Alternate Greetings）」机制技术调研报告

## 1. 概述与背景

在角色扮演和互动小说类前端中，角色卡（Character Card）通常包含开场白（Greeting / First Message），作为新会话启动时注入上下文的第一条消息。
为了支持更丰富的剧本分支、不同的场景开局（如：白天相遇、雨夜相遇、重逢、陌生人等），SillyTavern（简称 ST）设计了**「额外问候语（Alternate Greetings / 其它开场）」**机制。

本报告对 ST 官方文档（`.ref/SillyTavern-Docs`）、ST 源代码（`.ref/SillyTavern`）及样例角色卡（`.ref/多开局卡/多开局测试.json`）进行深入考察，系统梳理其**角色卡规范数据结构**、**UI 交互设计**、**会话初始化与运行时 Swipe 机制**、以及**上下文注入与副作用处理**，为 NyaaChat 后续接入该机制提供详实依据。

---

## 2. 角色卡规范与数据结构

### 2.1 规范定义（Card Spec V2 / V3）

在 ST 的角色卡规范中（参考 `.ref/SillyTavern/src/types/spec-v2.d.ts` 与 `.ref/SillyTavern/src/character-card-parser.js`）：

* **Spec V1 / V2**:
  * 基础字段位于 `data` 对象下：
    * `first_mes`: `string` —— 默认开场白（主开场白）。
    * `alternate_greetings`: `string[]` —— 额外问候语列表。每一项为一个独立的开场白文本字符串。
* **Spec V3**:
  * 保持兼容，`data.alternate_greetings` 同样为 `string[]` 数组。
* **群聊专用开场白（Group-only Greetings）**:
  * 扩展字段 `data.extensions.group_only_greetings`: `string[]`（在某些群聊扩展中使用，非普通角色卡核心字段）。

### 2.2 样例角色卡分析（`多开局测试.json`）

样例角色卡是典型的 Card Spec V2 格式：
```json
{
  "name": "开局测试",
  "description": "开局测试的角色设定",
  "personality": "",
  "scenario": "",
  "first_mes": "开局一",
  "mes_example": "",
  "creator_comment": "",
  "avatar": "none",
  "chat": "开局测试 - 2026-04-18 @17h 56m 03s 646ms",
  "talkativeness": "0.5",
  "fav": false,
  "spec": "chara_card_v2",
  "spec_version": "2.0",
  "data": {
    "name": "开局测试",
    "description": "开局测试的角色设定",
    "personality": "",
    "scenario": "",
    "first_mes": "开局一",
    "mes_example": "",
    "creator_comment": "",
    "avatar": "none",
    "chat": "开局测试 - 2026-04-18 @17h 56m 03s 646ms",
    "talkativeness": "0.5",
    "fav": false,
    "alternate_greetings": [
      "开局二",
      "开局三"
    ],
    "tags": [],
    "system_prompt": "",
    "post_history_instructions": ""
  }
}
```

* 主开场白为 `"first_mes": "开局一"`。
* 额外开场白存储在 `data.alternate_greetings` 中，包含 `["开局二", "开局三"]`。
* 在扁平层与 `data` 嵌套层中均可解析，解析器遵循 `data.alternate_greetings ?? card.alternate_greetings ?? []` 的降级策略。

---

## 3. UI 交互与编辑机制

ST 中「额外问候语」的 UI 组织及编辑流程位于：
* HTML 模板：`.ref/SillyTavern/public/index.html`（ID: `alternate_greetings_template`、`alternate_greetings_popout`）
* 前端逻辑：`.ref/SillyTavern/public/script.js`（`openAlternateGreetingsPopup` 相关逻辑）

### 3.1 弹出层（Popout）与列表渲染

1. **入口**：在角色编辑面板的「第一条消息（First Message）」文本框上方或控制条中，点击「其它开场（Alternate Greetings）」按钮触发弹窗。
2. **列表展示**：
   * 弹出全屏/模态框，列出所有额外问候语卡片。
   * 每个问候语卡片包含：
     * 序号标签（如 `#1`, `#2`）。
     * 多行编辑文本域（Textarea）。
     * 删除按钮（Delete）。
     * 移动/排序按钮（Up/Down 或拖拽排序）。
     * 插入新问候语按钮（Add greeting）。
   * 支持搜索和筛选。
3. **数据暂存与保存**：
   * 在弹窗中编辑时直接读写当前角色的 `characters[this_chid].data.alternate_greetings` 数组。
   * 保存角色时，将该数组写回角色卡 JSON/PNG chunk 元数据中持久化。

---

## 4. 会话初始化与运行时 Swipe 映射

ST 中将**切换开场白**巧妙地复用了其消息系统的 **Swipe（滑动切换生成/备选分支）** 机制。

### 4.1 核心数据结构：`ChatMessage`

在 ST 中，每条消息对应一个对象，核心结构如下：
```javascript
{
  "name": "角色名",
  "is_user": false,
  "is_name": true,
  "send_date": 1713434163000,
  "mes": "当前展示的消息正文",
  "swipe_id": 0,                     // 当前选中的 swipe 索引（从 0 开始）
  "swipes": [                        // 所有的备选内容列表
    "开局一（宏展开后）",
    "开局二（宏展开后）",
    "开局三（宏展开后）"
  ],
  "swipe_info": [                    // 每个 swipe 的元数据（时间戳、扩展信息等）
    { "send_date": ..., "extra": {} },
    { "send_date": ..., "extra": {} },
    { "send_date": ..., "extra": {} }
  ],
  "extra": {}
}
```

### 4.2 初始开场白装配逻辑（`getFirstMessage()`）

代码位置：`.ref/SillyTavern/public/script.js`（第 7710 行）
```javascript
function getFirstMessage() {
    const character = characters[this_chid];
    const firstMes = character?.data?.first_mes || default_settings.first_message;
    const alternateGreetings = character?.data?.alternate_greetings || [];

    const message = {
        name: character.name,
        is_user: false,
        is_name: true,
        send_date: humanizedDateTime(),
        mes: getRegexedString(firstMes, regex_placement.AI_OUTPUT),
        extra: {
            image: character.avatar,
        },
    };

    const swipes = [message.mes, ...(alternateGreetings.map(greeting => getRegexedString(greeting, regex_placement.AI_OUTPUT)))];
    message.swipes = swipes;
    message.swipe_id = 0;
    message.swipe_info = swipes.map(() => ({
        send_date: humanizedDateTime(),
        extra: structuredClone(message.extra),
    }));

    return message;
}
```

**关键机制点**：
1. **聚合构建**：开局消息初始化时，ST 把 `first_mes` 作为 `swipes[0]`，把 `alternate_greetings` 中的每一条依次映射为 `swipes[1]`, `swipes[2]`, ...。
2. **文本预处理**：所有问候语均会经过正则扩展管道（`getRegexedString(..., regex_placement.AI_OUTPUT)`）处理。
3. **元数据对齐**：`swipe_info` 数组与 `swipes` 数组保持等长，记录各自的生成时间与元信息。

### 4.3 翻页与切换行为（Swipe 交互）

当用户在 UI 上点击第一条消息的左右翻页按钮时：
1. 触发 `swipeMessage(direction)` 函数。
2. ST 会检查是否为越界或第一条消息的滑动逻辑：
   * 判断条件：`overswipe == OVERSWIPE_BEHAVIOR.PRISTINE_GREETING`（由 `isGreeting && isPristine` 触发）。
   * 如果当前开场白处于**纯净状态（Pristine）**，向后翻页（右滑）在到达末尾时，既可以选择循环回到第 1 个开局，也可以保持在所有已有的 `alternate_greetings` 中循环轮换。
   * 调用 `syncSwipeToMes(0, newSwipeId)`，直接将 `message.swipes[newSwipeId]` 复制到 `message.mes`。
   * 触发重新渲染第一条消息的 DOM 元素，更新当前页码指示器（如 `1/3`, `2/3`, `3/3`）。

---

## 5. 对话上下文纯净性与防篡改状态（`chat_metadata.tainted`）

ST 在处理开场白时，一个非常重要且优雅的设计是 **`chat_metadata.tainted`（会话被污染/脏标记）**。

### 5.1 什么是 Pristine（纯净状态）？

* **定义**：当一个新对话刚刚创建，且**用户尚未发送任何消息**（`chat.length === 1` 且仅有这唯一一条系统/角色开场消息），且没有发生过消息编辑、分支追加等动作时，该对话处于 **Pristine 状态**（`isPristine = !chat_metadata?.tainted`）。

### 5.2 为什么需要区分 Pristine 状态？

1. **宏动态展开（Macros resolution）**：
   * 开场白中常包含宏，例如 `{{user}}`, `{{char}}`, `{{time}}`, `{{random::a,b,c}}` 等。
   * 代码注释（`.ref/SillyTavern/public/script.js` 第 6931 行）：
     ```javascript
     // Only sync swipes if the chat is not pristine, so that macros in the greeting can resolve again on swipe
     if (chat_metadata.tainted || chat.length > 1) {
         targetMessage.swipes[targetMessage.swipe_id] = targetMessage.mes;
     }
     ```
   * 在纯净状态下，用户翻页开场白，如果切换了不同的 Persona（用户身份/昵称），ST 允许每次切换重新解析宏，而不是被旧的静态内容锁死。
2. **禁止通过 AI 生成污染开场白**：
   * 在普通对话消息中，向右翻到最后一页再翻页，会调用后端 LLM 发起请求生成新的 Swipe。
   * 但对于 **Pristine Greeting**，ST 将其 Overswipe 行为拦截为 `PRISTINE_GREETING`，**严禁向 LLM 请求生成新的开局**，只在预设的 `[first_mes, ...alternate_greetings]` 中循环（Loop）切换。
3. **标记为 Tainted 的时机**：
   * 用户发送了第一条输入（`chat.push(userMessage)`，`chat_metadata.tainted = true`）。
   * 用户手工编辑了开场白文本。
   * 用户执行了 Impersonate 或注入了其它消息。
   * 一旦 `tainted = true` 或 `chat.length > 1`，开场白即被固定为当前选中的 `message.mes`，此后它就作为一条不可随意换剧本的已发生历史消息。

---

## 6. 上下文组装与 Prompt 注入行为

当用户终于选定某个开局并发出第一条消息时，后续 LLM Prompt 的构造规则如下：

1. **线性上下文提取**：
   * ST 在构建送往 LLM 的消息历史时，直接遍历 `chat` 数组提取每个对象的 `mes`。
   * 因为第 4 节中 `syncSwipeToMes` 已经将当前选中的开局内容赋值给了 `chat[0].mes`，因此构造 prompt 时**完全无需特殊分支逻辑**，自然而然地使用的是用户当前翻页选中的那个开局。
2. **宏与变量替换**：
   * 在宏系统（`.ref/SillyTavern-Docs/Usage/macros.md`）中，ST 还提供了 `{{charFirstMessage}}` 与 `{{charFirstMessage::index}}` 宏：
     * `{{charFirstMessage}}`: 返回当前生效的开局（即当前 `swipe` 选中的内容）。
     * `{{charFirstMessage::1}}`: 允许在其它提示词模板或世界书中显式引用第 1 个额外开场白。

---

## 7. 调研结论与对 NyaaChat 的设计启示

通过本次考察，可以总结出 ST 实现「额外问候语」的四大精髓：

1. **协议层优雅兼容**：
   * 在角色卡 JSON 中保持 `first_mes`（主开场）与 `alternate_greetings`（额外开场数组，`string[]`）分离，符合规范规范（SillyTavern Card Spec V2/V3），互通性最好。
2. **消息模型统一复用**：
   * 不额外为“开局选择”设计一套孤立状态机，而是直接将 `[first_mes, ...alternate_greetings]` 映射为开场白消息对象的 `swipes` 列表，天然复用已有的“翻页器”、“Swipe 计数器”和 UI 交互。
3. **Pristine 状态守卫**：
   * 必须设立类似 `tainted` 或 `is_pristine` 的判定：新对话未输入时，右滑不向 AI 触发生成，仅在候选项中循环；一旦用户产生对话输入，开场白确定并固化到当前会话存储中。
4. **即时上下文生效**：
   * 对话的真正上下文以当前展示的 `mes` 为准，开局切换时同步更新第一条消息的展示内容与状态，下游 Prompt 构造链路保持零成本、无感摄取。
