# AnswererFlagalac 落地「小猫之神」破甲机制 —— 三路考察汇总与开发前置条件

> **文档性质**：汇总（Q0 / 团队 `nyaachat-flagalac-recon` 任务 `t4`）。本文**不是**三份报告的拼接，而是合并重复、统一术语、消解冲突后的**可执行结论文档**，供后续开发直接引用。
>
> **来源报告（三份，均为本次新增物）**
> | 代号 | 文件 | 考察员 | 回答问题 |
> |---|---|---|---|
> | **Q1** | `.docs/_agentteams/Q1-提示词架构冲突评估.md`（实测 371 行 / 非空 284） | prompt-critic | NyaaChat 提示词拼装排序是否与小猫预设机制致命冲突 |
> | **Q2** | `.docs/_agentteams/Q2-前端构造可行性评估.md`（实测 416 行 / 非空 328） | runtime-scout | SPreset/SToolBook/ST 技术内核能否只在 NyaaChat 前端构造 |
> | **Q3** | `.docs/_agentteams/Q3-绕过开关选项清单与映射.md`（实测 **723** 行 / 非空 604；CRLF）。**该报告已就地修订至 v3**（文件头含「修订 v2」「修订 v3」两段说明）—— 注意 captain 传达时为「v2」，实际文件已含 v3；本文按**实际读到的 v3 内容**为准 | bypass-options | AnswererFlagalac 各模型条目应否增设绕过开关 |
>
> **行数口径说明**：上表为本文作者用 `System.IO.File.ReadAllLines` 实测的**含空行**总行数；括号内非空行数为「去掉空行后」的行数。三份报告的行数存在「成员自报 / captain 量测 / 本文实测」三个不同数字（例：Q3 成员自报 659、captain 量得 553（后又说 582）、本文实测 **723/非空 604**；Q1 captain 量得 284 = 本文非空值，可互相印证 **`Get-Content | Measure-Object -Line` 会跳过空行**；其余差异来自行尾符（CRLF/LF）与空行的处理）。**内容完整性以文件实际内容为准，本文所有引用均按本文实测行号复核。** 本文自身：实测 **797** 行 / 非空 **589**（LF）。
>
> **酒馆侧引用（已归档分析报告，沿用其小节号）**：`猫神报告` = `.ref/SillyTavern/参考预设/小猫之神预设-Gemini破甲机制分析报告.md`；`SPreset 专项` = `.ref/SillyTavern/SPreset/SPreset-机制分析.md`；`SToolBook 专项` = `.ref/SillyTavern/SToolBook/SToolBook-机制分析.md`。
>
> **证据强度标注（三份报告口径统一后）**：`[事实]` = 源码/配置/实测可直接读到（给 `文件:行号`）｜`[推断]` = 由代码与注释语义推出，本地无可执行验证｜`[未证实]` = 需实机抓包 / 开 Debug 日志 / 写最小原型才能确认。
>
> **⚠️ 声明：本次考察（含三份来源报告与本文）未修改 NyaaChat 任何业务源码。** 唯一写入物是 `.docs/` 下的四份 markdown。工作树中 `src/App.tsx`、`src/components/BypassModal.tsx`、`src/lib/settingsBackup.ts`、`src/types.ts`、`src/lib/FlagalacTemplates.ts` 的未提交改动属**此前 AnswererFlagalac 界面轮次**的既有产出，非本次考察产物（本次对其中文件仅做只读阅读）。
>
> **本文对来源报告做过的核对**：Q1/Q2/Q3 的关键锚点（`chatPipeline.ts:496-530` 尾部组装与不变量注释、`chatPipeline.ts:310-314` 授权锚点、`api.ts:58-95` 折叠守卫、`api.ts:382-392` OpenAI 请求体、`api.ts:526-535` 折叠调用点与 Gemini 注释、`api.ts:700-758` Anthropic 归并、`FlagalacTemplates.ts` 全文、`types.ts:116-126`）已由本文作者**逐处回源复核，未发现行号或语义错误**。三份报告之间的矛盾另见 §8，本文不做无证据的调和。

---

## 目录

- [1. 结论速览](#1-结论速览)
- [2. 术语统一表](#2-术语统一表)
- [3. Q1：提示词拼装排序与小猫预设机制的冲突](#3-q1提示词拼装排序与小猫预设机制的冲突)
- [4. Q2：SPreset/SToolBook/ST 内核能否只在前端构造](#4-q2spresetstoolbookst-内核能否只在前端构造)
- [5. Q3：AnswererFlagalac 应否增设绕过开关](#5-q3answererflagalac-应否增设绕过开关)
- [6. 三问之间的推导链](#6-三问之间的推导链)
- [7. 开发前置条件清单](#7-开发前置条件清单)
- [8. 待验证 / 不确定项](#8-待验证--不确定项)
- [9. 来源报告间的矛盾、证据强度差异与悬空结论](#9-来源报告间的矛盾证据强度差异与悬空结论)
- [10. 本次考察范围与声明](#10-本次考察范围与声明)
- [**11. 既有缺陷与优先修复（R1 置于首位）**](#11-既有缺陷与优先修复r1-置于首位)
- [**12. 载荷落位：K1 冲突、E1-first 收敛与 L1 可选退路的代价门槛**](#12-载荷落位k1-冲突e1-first-收敛与-l1-可选退路的代价门槛)

---

## 1. 结论速览

### Q1｜拼装排序是否致命冲突 —— **可做，但不能照搬**

NyaaChat 的请求形态是「静态 system 前缀（含恒定授权锚点）+ 历史 + 最新 user + **唯一一条**尾部 system」（`chatPipeline.ts:439-464, 496-523`；`api.ts:535` 无条件把这条尾 system 折进最新 user）。对照猫神机制的 8 条结构前提（B1–B8），得到 **1 处致命冲突 + 3 处严重 + 3 处可控 + 1 处无冲突**：致命项是「单条 assistant 承载伪 JSON / 重写整段上下文」，严重项是「前导 system 进 systemInstruction 通道（4.0test 路线）」「多条后置 system 条目」「assistant 预填在最末 + absolute depth=0」。**每一条严重项都有最小可行替代落点**：把载荷作为**独立新块并入那唯一一条尾部 system**（推荐 E1），并把新块名**无条件**写进静态授权锚点。

**对开发的直接影响**：结构上可行；硬约束是「尾部只能有一条 system」「不要在尾 system 之后追加任何消息」「所有装配逻辑留在 `chatPipeline.ts`，不要进 `api.ts` 发送层」（该发送函数的调用点有 4 个，见 §3.5 约束 5）。

### Q2｜能否只在浏览器前端构造 —— **能，但不是「零改造的扩展方案」**

`[事实]` 主对话补全由浏览器直接 `fetch` 到用户配置的 provider（`api.ts:299-311, 404-410, 901-907`）；NyaaChat 自有服务（nginx 全部路由 + shared/knowledge/ext-host 路由表）**没有任何对话补全转发**，已在 macmini 上对运行中容器只读实测复核。因此「服务端除媒体转发外不参与」这一约定**成立**，四类内核（出站改写 / 工具循环 / 输出侧处理 / 位置注入）**都不需要服务端**。

但真正卡住复刻的是三点，且都不是服务端问题：① 事件总线缺 `GENERATE_AFTER_DATA` / `CHAT_COMPLETION_*` 钩子，`GENERATION_STARTED/ENDED` 只声明不发射，ST 的请求装配入口被兼容层**明确封死**（`public/scripts/openai.js:96-100`）；② 扩展是**构建期资产**（`registry.json` + `npm run build`），无运行时装卸；③ 撞上「单条尾部 system」不变量。结论按三分类：**可直接前端实现**（正则层、`onChunk` 解码、工具循环 + 本地伪工具源）、**需改造（全部为前端核心，约 10 项）**、**不建议/不可行**（用户可执行 JS 作为常态功能、远程注入 inject.js、第二条尾部 system）。**最高杠杆单点 = 一个「装配完成后、发出之前」的 PromptRewriter 钩子 + 请求体可注入 `stop`**。

### Q3｜应否增设绕过开关 —— **应设，但只设 7 个**

两份预设共清点 **66 个可开关项**（顶层设置 12 + SPreset 配置 18 + 条目/正则 32 + SToolBook 工具层 4）。结论：**只把「目标专属的输入侧载荷开关」暴露给用户，共 7 个**（每目标 3 个专属 + 1 个两目标同名的 `traceCleanup`）；另有若干项应**内置固定**随目标自动生效；其余约 50 项分别落到正则层 / RosettaStone / 世界书 / 角色卡，或**明确不暴露**。**落位主线（Q3 已修订至 v3，为 E1-first）：7 个载荷默认全部落在那条唯一尾 system 的独立新块 `<answerer_bypass target="…">`（= Q3 的 L2 = Q1 的 E1）**。落位细分：`identityCard` / `dualModelCard` / `refusalImmunity` / `disclaimerSpell` / `unicodeEncoding` 这 5 个注入类载荷 + `traceCleanup` 的规则文本 → **E1**（唯一尾 system 的独立新块，5 项共用 **M1** 一处改造）；`traceCleanup` 的脚本 → **L5**（正则层，零改造）；`toolChannel` → **L4** 工具通道、`unicodeEncoding` 另含 **L6** 解码（见 §5.5）；**L1 通道保真模式不在首版，须先过 V10/V11（§12.4）**；块名**无条件**写进 `SESSION_PROTOCOL_ANCHOR`；原「P37 目标 → 静态前缀 `systemInstruction`」方案因与 Q1 硬约束 3 冲突（Q3 记为 **K1**）已被**降级为可选增强**，默认不用，且须 V10/V11 通过才可启用（见 §12）。**本文保留的唯一分歧**（身份/人设类载荷是否改走静态前缀）写在 **§12.6**，属**需用户拍板**项，不改变上述基线。数据结构在现有 `{ target }` 上做加法（`perTarget` + `options`），UI 在选中条目下方就地展开，复用 RosettaStone 行样式。

### 三条硬性前提（跨问题共同约束，开发前必须先接受）

1. **不得新增第二条尾部 system**（`chatPipeline.ts:504-510` 明写的不变量 + `api.ts:58-95` 的 `prev.role === 'system'` 拒绝折叠守卫）。
2. **任何新增注入块必须把块名无条件写进 `SESSION_PROTOCOL_ANCHOR`，且锚点文本无条件恒定**（Q1 硬约束 3；`chatPipeline.ts:310-314, 436-441`）——**"无条件"指即使某轮没有该块（用户选「无」或所有开关都关）也要保留这句声明**（Q3 §6.2 第 2 条）：否则块拿不到 operator 级权威，或条件化声明会让静态前缀字节随轮次变化、击穿前缀缓存。
3. **reasoning / 原生 thinking 在 NyaaChat 完全不存在**（`api.ts:471-490` 只读 `delta.content`/`tool_calls`；`regex_placement.REASONING=6` 已定义但全库无调用点）——所有依赖 3.7f 原生思考的开关要么改成文本标签，要么不做。

### ⚠️ 开发启动前必读（独立成章的两件事，不要等到对应小节）

| 章节 | 一句话 | 为什么必须最先读 |
|---|---|---|
| **[§11 既有缺陷与优先修复](#11-既有缺陷与优先修复r1-置于首位)** | **R1**：已从 UI 下线的 ClavisSalomonis 可被「导入一份旧备份」静默复活，此后每轮都注入 7 条模板，而**界面上没有任何开关能关掉它** | 它不是本模块的改造范围，但本模块的 `disclaimerSpell` 与它的 `disclaimer` 模板**文本逐字相同**（§9 M3 / Q3 C1）⇒ 不先修 R1，就会出现「用户开了我们的开关，实际注入两份、其中一份他关不掉」。已在 §7 排为 P1 首项 |
| **[§12 载荷落位：K1 冲突与 E1-first 收敛](#12-载荷落位k1-冲突e1-first-收敛与-l1-可选退路的代价门槛)** | Q3 v1 曾建议「P4→动态尾部 / P37→静态前缀」；**Q3 v2/v3 自己发现这与 Q1 硬约束 3 冲突（记为 K1），已收敛为 E1-first**（7 个载荷全部落尾 system 新块），L1 降级为可选增强 | 这是后续开发的**第一个设计决策**：它决定改装配的哪一段、要不要依赖未实测的 Gemini 行为（§8 U1）、以及缓存代价。§12 记录冲突曾经存在、v2 如何收敛、并保留 **E1 vs L1 的代价对比与 V10/V11 验证门槛**（**不再是"两个互斥方案待选"**） |

---

## 2. 术语统一表

三份报告用词不一致，本文统一如下（后续开发与文档沿用本列右端）：

| 统一术语 | 别名（已废弃用法） | 定义与代码锚点 |
|---|---|---|
| **静态前缀（static prefix）** | 前导 system 区、前缀区 | `[SESSION_PROTOCOL_ANCHOR] + [User/Assistant Persona] + [永久世界书]`；跨轮逐字节稳定（`chatPipeline.ts:434-464`） |
| **授权锚点** | SESSION_PROTOCOL_ANCHOR、session-protocol anchor | 静态前缀首条，把 operator 级权威委托给 `<session_rules>` / `<search_context>` / `<memory_context>` 三类块（`chatPipeline.ts:310-314`） |
| **动态尾部（dynamic tail）** | 尾部 system、单条 trailing system | 本轮唯一一条尾部 system，内含 `<session_rules>` + `<output_constraints>` 两个并列块（`chatPipeline.ts:496-523`） |
| **尾部折叠** | foldTailSystemIntoLatestUser、折叠 | OpenAI/Gemini 路径把动态尾部作为 `user` 角色的 volatile text part 追加进最后一条 user 消息（`api.ts:58-95`，调用点 `api.ts:535`） |
| **前导 system 进 systemInstruction** | Gemini 提升、hoist | Gemini 的 OpenAI 兼容层把所有 system 消息并进 `systemInstruction` 的行为。**未实测**，见 §8 U1 / §9 M4（代码注释 `api.ts:526-534` + 标准 §5 表格 line 105） |
| **绝对注入 depth=0** | absolute d0、`injection_position=1` | SillyTavern 的「插到最新消息之后」独立注入位（猫神报告 §2.1、§4.10）。NyaaChat 装配层没有该语义；ST 兼容层 `setExtensionPrompt`（`compat/stContext.ts:67`）**有注册位**但 `getExtensionPrompts`（`:79`）无消费点 ⇒ 现成未接线、需小–中改造；即便接线也只能并入 E1 新块 |
| **装配后钩子 / PromptRewriter** | GENERATE_AFTER_DATA 等价物、rewriter | Q2 建议新增的前端钩子：`(messages, ctx) => messages`，位置「装配完成后、发出之前」 |
| **目标专属载荷开关** | Flagalac 选项、per-target option | Q3 建议暴露给用户的开关（共 7 个），只控制系统预置载荷文本的开/关，不是「机制开关」 |
| **载荷（payload）** | 绕过文本、破甲文本 | 目标对应的注入文本；来源是两份预设的条目原文（Q3 附录 A） |
| **分类口径** | 三级分类 / 四级分级 | Q1 用四级（致命 / 严重 / 可控 / 无冲突）；Q2 用三分类（可直接实现 / 需改造 / 不建议或不可行）。两者不互斥，见 §6 |
| **P4 / P37** | 4.0test / 3.7f | P4 = `【小猫之神】4.0test.json`（gemini2.5pro & 3.1pro，61 条 prompts，ChatSquash 开）；P37 = `小猫之神3.7f版本Reborn2.2-preview_1.json`（gemini3.7flash，68 条，ChatSquash 关、ToolBindings 有 game_content） |

---

## 3. Q1：提示词拼装排序与小猫预设机制的冲突

### 3.1 NyaaChat 拼装结果的真实形态

`buildRequestMessages()` 返回 `injectBypassPrompts([...systemMessages, ...history, ...tailMessages])`（`chatPipeline.ts:525-530`），展开顺序：

```
[静态前缀 system 区]  idx0 授权锚点（恒定、无条件）           chatPipeline.ts:311-314, 435-441
                      idx1.. bypass 注入点（静态前缀，非尾部） bypassTemplates.ts:71-78
                      persona / 永久世界书（role 由 position 定） chatPipeline.ts:445-464
[历史]                user/assistant 交替（已跑 prompt 侧正则）  chatPipeline.ts:363-383
[最新 user]           本轮文本 + volatile parts(memory → search) chatPipeline.ts:400-415
[动态尾部]            唯一一条 system：<session_rules> + <output_constraints> chatPipeline.ts:496-523
```

三条要点均为 `[事实]`：
- 前缀**恒有至少一条 system**（锚点无条件；注释明写「conditional 会翻转前缀字节、破坏缓存」`chatPipeline.ts:435-438`）→ NyaaChat **不可能产出无前导 system 的请求**。
- 尾部**最多一条 system**（`tailMessages` 为 `blocks.length ? [{system}] : []`，`chatPipeline.ts:520-523`）。
- bypass 注入点是**静态前缀 index 1**，不是尾部（`bypassTemplates.ts:73-78`），且受 `bypass.enabled` 门控（`bypassTemplates.ts:38`）；RosettaStone 则**独立于**该门控（`chatPipeline.ts:511-516`）——后者是「AnswererFlagalac 若要与 ClavisSalomonis 解耦就不能复用 `injectBypassPrompts`」的现成先例。

### 3.2 冲突点清单 + 四级分级

判据（Q1 §1.4 自定，本文沿用）：**致命** = 现有结构下无法成立且无法用现有落点近似；**严重** = 需改造装配/发送层且有明确副作用，但存在可行替代落点；**可控** = 可在现有落点内实现；**无冲突** = 结构天然支持。

| # | 猫神机制的结构前提 | 出处 | 在 NyaaChat 的判定 | 关键理由（证据） |
|---|---|---|---|---|
| B1 | 前导 system 进 `systemInstruction`（4.0test 需要**首条为 user** 才能旁路该通道） | 猫神报告 §2.4、§4.2 | **4.0test：严重 / 3.7f：无冲突** | 「有前导 system」必然成立；「**没有**前导 system」不可实现——锚点无条件为 system（`chatPipeline.ts:435-441`），persona/永久世界书默认也是 system。4.0test 需要把首条改 user，且删锚点会破坏缓存不变量（标准 §7.5） |
| B2 | 后置 system 条目（多条，`relative` 通道排在 chatHistory 之后） | 猫神报告 §2.1、§4.2、§5.2 | **严重** | 尾部只有一个 system 槽位（`chatPipeline.ts:496-523`）+ 明确不变量（`:504-510`）。再追加一条 ⇒ 末两条相邻 system ⇒ `api.ts:62` **拒绝折叠**。后果依 provider：Gemini/OpenAI 兼容层丢近因；Anthropic 非 Opus 路径把尾条 system 与其余 system 一起塞进**顶层 `system`**（`api.ts:728-733`），正是标准 §5 决策树 (line 129) / §7.4 明令禁止的降级 |
| B3 | 绝对注入 depth=0（最新消息之后的独立插入位） | 猫神报告 §2.1、§4.10 | **严重** | 世界书只有「永久→前缀 / 关键字→尾部单条 system」两个落点（`chatPipeline.ts:457-464, 470-486`）；`ApiMessage[]` 一次性拼成（`chatPipeline.ts:525-530`），**装配层没有 depth/absolute 语义**，且折叠会把末条 system 吃掉，「插到最新消息之后仍为独立条目」做不到。**v3 更正（Q2 实测向）**：NyaaChat 并非"完全没有位置注入入口" —— `compat/stContext.ts:67` 的 `setExtensionPrompt` **有注册位**，但 `:79` 的 `getExtensionPrompts` **全仓无消费点** ⇒ 属「现成但未接线、需小–中改造」；且即便接线，按 Q1 结论也只能并入 E1 新块 |
| B4 | assistant 预填尾（数组末条是 assistant，模型接着写） | 猫神报告 §4.2 第 53 位、§4.6、§5.4 | **严重**（两种放置法差别极大） | 全库 grep `prefill` 无生成侧命中（3 处命中皆为角色分享表单回填）。预填放尾 system **之后** ⇒ `last.role !== 'system'` ⇒ `api.ts:62` 拒绝折叠；放**之前** ⇒ 折叠保住了但目标改变、Anthropic Opus 4.8 的 mid-conv 尾条会被 push 到预填之后（`api.ts:747-752`）⇒ 预填语义在该路径丢失 |
| B5 | 单条 assistant 承载伪 JSON（重写整段上下文） | 猫神报告 §4.3、§5.4；SPreset 专项 §3、§4.1 | **致命冲突** | (a) 无出站消息数组重写层：`buildRequestMessages` 的返回直接进 `fetchChatCompletion`（`ChatInterface.tsx:791-836`），中间无 hook；(b) 违反标准 §7.1/§7.2 与 §2 核心不变量 (line 61)；(c) 历史正则 `depth` 语义失效（`chatPipeline.ts:376-382`）；(d) `Message.content` 是展示文本，不承载伪 JSON；(e) 每轮重写历史 ⇒ **前缀缓存全废**，长对话成本与首 token 延迟暴涨 |
| B6 | 相邻同角色合并（`\n\n` 拼接） | 猫神报告 §2.4、§2.5 | **无冲突** | OpenAI 路径逐条原样发（`api.ts:384`）；Anthropic 只合并 user/assistant（`:739-744`）。反向事实：NyaaChat **会产出**相邻同角色（bypass 的 `aiSelfPersuasion` + `roleplayInduction` 是两条相邻 assistant，`bypassTemplates.ts:62-69`） |
| B7 | 停止串 `<end>` | 猫神报告 §3.1、§4.3 | **可控（小改可补）** | 请求体只有 `model/messages/stream/stream_options/tools`（`api.ts:382-392`）与 `model/max_tokens/messages/stream/system/tools`（`:857-881`），**无 `stop`/`stop_sequences`**。补字段是小改动，但属「发送层新增能力」；且停止串对该会话所有模型生效，正文合法出现 `<end>` 会被提前截断。另注：`<end>` 在原版里**本来就没生效**（SPreset 专项 §0 第 3 条：`stop_string` 受 `ChatSquash.enabled` 守卫） |
| B8 | 工具通道输出（`game_content` + `consumeToolCalls` 回收为正文） | 猫神报告 §5.6；SPreset 专项 §4.3/§4.4；SToolBook 专项 §3.1/§3.3/§4.1 | **可控（需改造，纯前端）** | 循环已完整（`api.ts:102-133, 541-624, 1084-1159`），但缺 (i) **不进服务端的本地工具源**（现工具来自 `/api/mcp` 且被 `ADVERTISED_TOOLS` 白名单过滤，`mcpApi.ts:199-205, 278-289`）；(ii) `consumeToolCalls` 等价物——当前循环把结果以 `role:'tool'` 回灌（`api.ts:615-622`），而猫神方案要把**参数内容镜像进正文并抹掉工具痕迹** |

附加判定（不在 B 清单但直接影响落地）：

| 项 | 判定 | 证据 |
|---|---|---|
| 词表灌注 / 身份重定义 / 拒绝免疫句（纯文本载荷） | **无冲突** | 只是文本，可落前缀或尾部任意块 |
| 伪 disclaimer（输出 + 正则隐藏） | **可控** | 输出侧 `AI_OUTPUT` placement 即可；已有同构模板 `bypassTemplates.disclaimer`（`bypassTemplates.ts:26-29`）；「真输出、后续请求与显示里隐藏」需 `promptOnly` + `markdownOnly` 双开，引擎支持（`engine.ts` 双管线，`types.ts:232-235`） |
| `\uXXXX` 编码 + 流式 `hold` 解码（3.7f） | **可控（需改造）** | 现有 `onChunk` 直通、无缓冲层（`api.ts:471-474`、`ChatInterface.tsx:825-832`）；加前端 buffer/hold 是纯前端工作。真正的难点是「让模型去编码」依赖工具通道（B8） |
| reasoning 预填 / 原生 thinking | **严重** | 见 §3.4 硬约束 8 |
| 世界书搬运进伪 JSON（4.0test 链路） | **严重** | 依赖 ST 正则 `placement=5 WORLD_INFO` 产出标记（猫神报告 §4.7）+ 后处理重排；NyaaChat 的 WORLD_INFO 正则可产标记（`chatPipeline.ts:427-432`），但「重排进伪 JSON」需要 B5 的重写层；且 NyaaChat 世界书**没有**「最近 N 条 / 更早」分层结构 |

### 3.3 两个高风险点的核验结论

**(a) 「尾部仅一条 system」+「相邻两 system 拒绝折叠」是否使「后置 system 条目 + 末尾 assistant 预填」彻底不可行？**

结论：**「预填放在最末」的写法确实不可行（严重，接近致命）；把预填插在尾 system 之前则组合成立**，代价是折叠目标改变。

- **写法 A（`[…, user, system(尾), assistant(预填)]`）— 不可行** `[事实 + 推断]`：`fetchOpenAI`（含 Gemini）先跑折叠，末条是 assistant ⇒ `api.ts:62` 直接原样返回 ⇒ 尾部规则留在数组里被预填「隔开」；Gemini（按未实测的兼容层行为）会把尾部规则拽回开头；Anthropic 非 Opus 落入顶层 `system` 合并分支（`api.ts:728-733`）；Anthropic Opus 4.8 的 tailSystem 检测条件 `last.role==='system' && prev.role!=='system'`（`api.ts:708-715`）此时**检测失败**，同样走顶层合并。且「后置 system 条目」本身就已是 B2 的严重冲突（与预填无关）。
- **写法 B（`[…, user, assistant(预填), system(尾)]`）— 可行**：折叠守卫通过，末条 system 被折进 `lastIndexOf('user')` 找到的那条 user ⇒ `[…, user(+session_rules part), assistant(预填)]`，规则保住近因、预填保住。三个连带代价：① 尾部规则位置从「数组最末」变成「预填之前」，与生成点之间隔了一条消息；② Anthropic Opus 4.8 会把 tailSystem push 到预填**之后**（`api.ts:747-752`），预填不再是末条 ⇒ 该路径预填语义丢失；③ **本轮尾部 system 是否存在是可变的**（无关键字规则、无 MCP、RosettaStone 全关 ⇒ `tailMessages = []`），此时写法 B 退化为写法 A ⇒ 又回到折叠失效。**第 ③ 点最易漏**：预填是否安全取决于「本轮是否有尾 system」这一每轮可变状态。

**(b) NyaaChat 是否对 system→user 做改写/合并，从而改变破甲文本的通道与优先级？**

结论：**NyaaChat 前端不做 ST 那种 system→user 改写，但做了方向相反的通道操作**，猫神预设的「位置武器」在 NyaaChat 上退化为「权威 / 通道问题」。

| 环节 | ST（`convertGooglePrompt`，猫神报告 §2.4） | NyaaChat OpenAI 路径（含 Gemini 兼容端点） | NyaaChat Anthropic 路径 |
|---|---|---|---|
| 前导 system | 抽进 `systemInstruction` | 原样发送（**Google 侧行为 [未证实]**） | 抽进**顶层 `system`** 字符串，`"\n\n"` 连接（`api.ts:717, 728-733, 754-757`） |
| 中段/后置 system | **改写为 user**（`prompt-converters.js:459-460`）并相邻合并 | 原样保留；**仅末条**被折成最新 user 的文本 part（`api.ts:58-95, 535`） | 除 mid-conv 尾条外**全部**抽进顶层 `system`（`:728-733`） |
| assistant | 改写成 `model` | 原样 | 原样 |
| 相邻同角色 | 合并 | **不合并** | user/assistant 合并（`:739-744`） |
| stop | `data.stop`（且仅当 `ChatSquash.enabled`） | 无字段 | 无字段 |

`[推断]` 由此得到的最重要一条：猫神的「后置 system 条目」在酒馆里是**被降级为 user 并贴紧生成点**（保位置、丢 operator 权威）；在 NyaaChat 上同一落点则是**被折成 user 文本 part**（位置保住、权威靠授权锚点委托）——**机制不同但结果接近，这是好消息**。反过来，「多条后置」与「预填在最末」两种写法会把尾部 system **提升/拉回顶层 `system`**（Anthropic 必现，Gemini 大概率），等于**保住权威、彻底丢近因**，与猫神方案的收益方向相反。**这是下游设计最需要记住的一条。**

### 3.4 最小可行替代落点

> 优先级建议 **E1 → E3 → E4 → E7**；**E5 明确不建议**。所有方案都应在 `buildRequestMessages`（`chatPipeline.ts:345`）内部完成，**不要改 `api.ts` 发送层**（见 §3.5 约束 5）。

| 编号 | 落点 | 做法 | 优点 | 代价 / 风险 |
|---|---|---|---|---|
| **★E1（推荐）** | 载荷并入**尾部那唯一一条 system**的独立新块 | 在 `chatPipeline.ts:496-523` 组装 `tailMessages` 时，按目标取载荷，作为独立块（如 `<answerer_flagalac>…</answerer_flagalac>`）与 `<session_rules>`/`<output_constraints>` 并列拼接 | 零结构改动、不触碰不变量；折叠路径不变；Gemini/OpenAI 最终落在最新 user 的 volatile part（**近因最高**）；内容随用户配置恒定 ⇒ 不击穿缓存 | ① Gemini 侧权威级别是 **user 通道**，必须靠锚点委托 ⇒ **必须把新块名写进授权锚点且无条件恒定**；② **不要塞进 `<session_rules>` 内部**（会与调解条款「叙事走向以用户最新发言为准」`chatPipeline.ts:322-323` 同块而被主动削弱）；③ Anthropic 非 Opus / 第三方代理路径**本来就会**把尾 system 回灌顶层（`api.ts:706, 728-733`），Gemini 的收益在该路径不成立；④ **尾块为空时该消息整条不存在** ⇒ 必须让「本模块启用」成为「必须产出尾部 system」的条件（`blocks.length` 判定要把该块算进去） |
| E2（不推荐，特定用途） | 载荷并入最新 user 的真实文本 | 拼进用户当轮文本或非 volatile text part | — | 语义变成「用户说的」，模型可能按用户注入抵抗；改变 Anthropic 断点②锚点位置（`api.ts:839-855` 锚在最后一个非 volatile part）。仅适合复刻 RuleBreaker 式「由用户发出」交互（另一个模块的既有模式，`BypassModal.tsx:240-245`） |
| E3（进阶，可控） | 单独追加一条 **assistant 预填**，位置固定在尾 system **之前** | 在 `tailMessages` 之前插入 `{role:'assistant', content:'<think_nya~>\n…'}`，并**保证尾部 system 仍为末条** | 保住折叠（写法 B）；复刻「从已表态处续写」的决策点消除效果（猫神报告 §4.6、§7.4） | ① 折叠目标从最新 user 变成预填之前的最新 user；② Anthropic Opus 4.8 mid-conv 路径预填语义失效（`api.ts:747-752`）；③ **预填安全性依赖「本轮是否有尾 system」**，必须做成硬约定；④ 预填只存在于本次请求、**不入存储**（重生成/编辑/显示不受影响，可接受但需在实现里写明） |
| E4（可控，改造中等） | 走「伪工具通道」 | 新增**纯前端本地工具源**（`LlmTool[]` + 前端 `executeTool`），目标启用时把 `game_content` 类工具加入工具选项；输出侧增加「消费型工具」语义（参数当正文输出、不再回灌 `role:'tool'`） | 3.7f 的核心机制；工具循环已在 `api.ts` 实现完毕；工具参数的流式 delta **本来就不回调 `onChunk`**（`api.ts:475-489`），「参数不走文本流」天然满足 | ① 现有 `executeTool` 契约是「返回文本给模型看」（`api.ts:108-115`），「回收为正文」要新增分支（等价 SPreset 的 `consumeToolCalls`）；② 本地工具必须**不污染** `assembleMcpRules`（未知工具名会带来 `[MCP 工具使用准则]` 头 + 失败降级规则，`chatPipeline.ts:243-245, 269`）与 `ADVERTISED_TOOLS` 白名单；③ 需要 `ChatInterface.tsx:693-789` 之外一条独立装配路径（现有 MCP 分支受 `isMcpEnabled`/`anyToolEnabled`/模型 `capabilities` 三道门控，能力探测门会误伤）；④ **[未证实]** Gemini 兼容端点对 `tools` + 流式工具参数的支持度 |
| E5（**不建议**） | 复刻「伪 JSON / 单条 assistant 承载全上下文」 | — | — | **致命冲突**（见 B5）。若确要实验，应做成「显式可选的实验模式」，UI 明示「会关闭缓存、显著增加成本」 |
| E6（可控，小改） | 停止串 | `requestBody` 增 `stop`（`api.ts:382-392`）与 `stop_sequences`（`:857-881`），由目标决定是否挂 `<end>` | 补齐 3.7f 的一个形态 | 停止串对该会话**所有模型**生效；正文合法出现 `<end>` 会被提前截断；3.7f 原版里这条本来未生效 |
| E7（可控） | 痕迹清理（CoT / disclaimer / 控制标签） | 直接用已有 prompt 正则通道（`AI_OUTPUT` placement=2 + `minDepth`），脚本形态与酒馆同源（`engine.ts:20-26`、`types.ts:219-243`）。`<think_nya~>` 是**文本标签**而非原生 reasoning，故对 4.0test 的 CoT 隐藏可行 | 零新增基建 | **顺序陷阱**：正则是在 `chatPipeline.ts:378-383` 生成 history 时就跑掉的；若 E1/E3/E4 的新逻辑在 `:525` 之后才改写 messages，则**正则先于改写执行**，改写新引入的标记不会被本轮正则处理。实现时必须显式约定「正则 → 破甲改写」顺序，或让改写层自行处理 |

### 3.5 Q1 给下游的硬约束清单（8 条）

1. **尾部只能有一条 system**。新增后置内容必须并入这一条（E1），不得追加第二条（`chatPipeline.ts:504-510`、`api.ts:62`）。
2. **不要在尾 system 之后追加任何消息**（尤其 assistant 预填），否则整条尾部规则折叠失效：Gemini 丢近因、Anthropic 代理路径回灌顶层 system。
3. **新增注入块必须登记进 `SESSION_PROTOCOL_ANCHOR`，且锚点文本无条件恒定**（`chatPipeline.ts:310-314, 434-441`；标准 §7.5）。
4. **AnswererFlagalac 载荷不要复用 `injectBypassPrompts`**（受 `bypass.enabled` 门控且注入静态前缀，`bypassTemplates.ts:38, 71-78`）；应与 RosettaStone 同构——独立块、独立开关。
5. **所有破甲装配逻辑放在 `chatPipeline.ts`，不要放进 `api.ts` 发送层**——`fetchChatCompletion` 有 4 个调用点（`ChatInterface.tsx:822` 主回合、`:1680/:1736` 图像提示词侧、`lib/memoryExtraction.ts:407` 记忆抽取、`compat/generate.ts:95` 卡牌侧），改发送层会外溢到这些旁路请求。
6. **不要重写历史**（伪 JSON / 历史合并），否则违反标准 §2/§7.1/§7.2 并废掉前缀缓存（致命）。
7. **预填的安全性依赖「本轮是否存在尾部 system」**——若走 E3，必须做成硬约定，不能随手变。
8. **reasoning / 原生 thinking 在 NyaaChat 完全不存在**（`api.ts:471-490`；`regex_placement.REASONING=6` 无调用点；`ApiSettings` 无 `reasoning_effort`/`show_thoughts`，`types.ts:48-58`）——依赖原生思考通道的选项要么改成文本标签，要么不做。

---

## 4. Q2：SPreset/SToolBook/ST 内核能否只在前端构造

### 4.1 事实基线：服务端确实不参与对话补全

| 事实 | 证据 |
|---|---|
| 唯一对话补全出口 `fetchChatCompletion`，按 `apiFormat` 分派 OpenAI / Anthropic | `api.ts:299-311` |
| OpenAI 路径直接 `fetch(url, …)`；`routeApiProxyUrl` 只对 `opencode.ai` 改写为同源 `/api/opencode-go/`，其余 baseUrl 原样（跨域直连） | `api.ts:378-410`、`api.ts:248-262` |
| Anthropic 路径同样直接 `fetch` | `api.ts:820-822, 901-907` |
| nginx 全部路由：image-proxy（媒体转发）、`/api/mcp`（工具协议代理，服务端注入 Bearer）、ext-host、shared、knowledge、comfyui、仅 opencode.ai 的补全反代、SPA 静态 | `nginx.conf:118-149, 160-183, 187-225, 255-311, 325-372, 381-395, 397-399` |
| 三个自研后端路由表均不含对话补全（ext-host 的 `/t2i-agent/chat` 是画图提示词的**旁路**功能） | `shared-server/src/server.js:21-40`；`nyaachat-knowledge/src/server.js:23-48`；`ext-host/src/server.js:334-358`；`src/lib/t2iAgentApi.ts:14` |
| 实机只读实测（macmini，`nyaachat-app-1` @127.0.0.1:3095）：主文档与 `/index.html` 均 **HTTP 200 且无 CSP**；`/extensions/JS-Slash-Runner/src/iframe/third_party_script.html` **带 CSP** | Q2 §1.3(b) 实测记录 |

`[事实]` 结论：**用户与 LLM 之间的对话补全流量只在浏览器 ↔ provider 之间**，用户的设计约定与现状一致。

### 4.2 但「不需要服务端」≠「零改造可用扩展实现」

三点约束（均为 `[事实]`）：

1. **钩子缺位**：`event_types` 里**没有** `GENERATE_AFTER_DATA` / `CHAT_COMPLETION_PROMPT_READY` / `CHAT_COMPLETION_SETTINGS_READY`；`GENERATION_STARTED` / `GENERATION_ENDED` 只声明、**全仓无发射点**（`compat/events.ts:18-41`；对 `src/**` grep 零命中）；`makeLast` 的实现就是 `on`（`events.ts:65-67`），**不改变执行顺序** ⇒ ST 那种「谁最后注册谁说了算」在 NyaaChat 没有语义。ST 的请求装配入口被封：`sendOpenAIRequest()`/`getStreamingReply()` 直接 `warnOnce` 返回空串（`public/scripts/openai.js:96-100`，注释写明「request construction is not delegated to extensions」）；`PromptManager` 只是数据容器（`public/scripts/PromptManager.js:1-5`）。
2. **扩展是构建期资产**：走 `public/extensions/registry.json` + `npm run build`（`package.json` 的 `extensions:registry`），registry 注释明写「Governance is git … no backend and no runtime install/update/delete」（`compat/extensions/registry.ts:8-9`）⇒ 「用户填一段 JS / 导入一个预设即生效」的形态在当前架构下**不成立**。
3. **撞不变量**：动态尾部只有一条 system，`prev.role === 'system'` 时拒绝折叠（`chatPipeline.ts:501-510`；`api.ts:58-62`）⇒ absolute depth=0 作为**独立消息**、assistant 预填在最末、第二条尾部 system **全部撞上它**。

### 4.3 三分类结论

| 类别 | 机制 | 现状 / 改造位置 | 成本 |
|---|---|---|---|
| **可直接前端实现** | 正则脚本层（对 AI 隐藏 CoT / 控制标签清理 / 思维链折叠） | **已具备**：ST 双管线正则引擎忠实移植（`compat/regex/engine.ts:20-26, 188-225`；`chatPipeline.ts:363-367, 391-398, 429-431`；`MessageItem.tsx:241-243`） | 0（仅需撰写脚本） |
| **可直接前端实现** | 输出侧 `\uXXXX` 流式解码 / `hold` 缓冲 | `onChunk` 已是逐块回调（`api.ts:471-474, 1003-1005`），加一层 stateful 装饰器即可 | 小 |
| **可直接前端实现** | 工具注册与工具循环 | 循环完整（`api.ts:102-133, 515-627, 1057-1162`，`maxRounds=5`）；只需补**不进服务端的本地工具源** | 小（后端接线小，参数回收另计） |
| **需改造（前端核心）** | 出站 prompt 数组改写 | 数据全在前端，但缺「装配后」钩子 | 小（**最高杠杆**） |
| **需改造（前端核心）** | 停止串（`stop` / `stop_sequences`） | 请求体无该字段（`api.ts:382-392`、`:857-881`） | 小 |
| **需改造（前端核心）** | 位置类机制（absolute depth=0 / 置底最新回合） | `setExtensionPrompt` 注册位已存在但 `getExtensionPrompts()` **全仓无消费点**（`compat/stContext.ts:57-81`）；接线即可，但内容必须并入同一条尾部 system | 小–中 |
| **需改造（前端核心）** | 工具参数镜像进正文（3.7f `consumeToolCalls`） | `tool_calls` 参数**静默累加、不进 `onChunk`**（`api.ts:475-490`） | 中 |
| **需改造（前端核心）** | `assistant_prefill` 类续写锚点 | 无 prefill 概念；追加尾部 assistant 会让折叠守卫失配 | 中（且须一并改不变量）**— 此判定与 Q1 §5.1 冲突，见 §9 M2** |
| **需改造（前端核心）** | 原生 reasoning 采集（`reasoning_content` / `thinking`） | `Message` 无该字段（`types.ts:8-42`）；流解析不认 reasoning delta；`REASONING=6` 无对象可作用 | 小–中 |
| **需改造（前端核心）** | 无缝循环（多次 continue 合并成一条 assistant） | 无 `continue`；`GENERATION_ENDED` 不发射；只有 `handleRegenerate`（删旧回复重发，非续写，`ChatInterface.tsx:1379-1390`） | 中–大 |
| **不建议 / 不可行** | 用户可执行 JS 后处理脚本（`eval` / `new Function`）作为常态功能 | 当前实测主文档**无 CSP、eval 不被拦**；但这与 `nginx.conf:41` 的 `script-src 'self'` 意图直接冲突，一旦 CSP 生效即失效；且 NyaaChat 自身**零 eval** | — |
| **不建议 / 不可行** | 「远程注入一份闭源 inject.js」的装载方式 | 扩展装载是构建期资产；主文档意图策略 `script-src 'self'` 挡远程脚本 | — |
| **不建议 / 不可行** | 独立新增「第二条尾部 system」 | 破坏 `foldTailSystemIntoLatestUser` 唯一性不变量 | — |

### 4.4 逐机制可行性表（8 + 1 项）

| # | 机制 | 判定 | 改造点 | 成本 | 备注 |
|---|---|---|---|---|---|
| M1 | 出站 prompt 数组改写（ChatSquash 全量合并 / 前后缀 / 不压缩标记 / 再拆分） | 需改造 | 在装配后加 `PromptRewriter` 钩子 | 小 | 语义可 1:1 复刻（纯数组操作）；改写应发生在 `foldTailSystemIntoLatestUser` **之前**最安全 |
| M2a | 用户 JS 后处理脚本（`eval`） | 不建议作为常态功能 | — | — | 「设置备份是可分享文件」⇒ 模板字段可执行 = 导入他人备份即任意代码执行 |
| M2b | 替代物：正则 / 受限 JSON 规则 / 构建期扩展 | 推荐 | — | — | 图灵完备需求应写在构建期 bundle 的扩展里 |
| M3 | 工具注册与工具循环 | 可直接实现（接线小改） | 允许本地伪工具进入工具选项；绕开三道门控与白名单 | 小 | 3.7f `game_content` 的「注册 + 循环 + 回收」中前两件已具备 |
| M4a | 输出侧 `\uXXXX` 解码 / `hold` | 可直接实现 | `onChunk` 消费处加 stateful 解码器 | 小 | 无需包装 `window.fetch`（NyaaChat 自己就是调用方） |
| M4b | 工具参数镜像进正文 | 需改造 | 把 `turn.toolCalls` 的 `function.arguments` 依序喂 `onChunk`，并从下一轮 `messages` 剥掉原生结构 | 中 | 与 M3 **争抢同一批 `tool_calls`**：「当工具执行」还是「当正文」需显式开关 |
| M5 | 无缝循环（多次 continue 合并） | 需改造 | `GENERATION_ENDED` 发射点 + 续写入口 + 合并写回 | 中–大 | 唯一需动**主对话轮控制流**的机制；与「每轮一条 assistant 气泡」UI 模型纠缠。建议一期不做 |
| M6 | 位置类（absolute d0 / 置底最新回合） | 独立消息不可行；并入尾部块可行 | 把 `getExtensionPrompts()` 接进装配，按 position/depth 映射到「并入尾块」或「并入最新 user」 | 小–中 | 「置底」的等价物天然存在（历史按序、尾部固定最后） |
| M7 | 正则脚本层 | 可直接实现（已具备，零改造） | — | 0 | **缺口**：prompt 侧正则目前不作用于静态 system 区、`<session_rules>`/`<output_constraints>`、以及 bypass 注入文本（注入发生在正则之后，`chatPipeline.ts:525-530`） |
| M8a | 停止串 | 需改造 | 请求体加字段 | 小 | 字段名 provider 不同（`stop_sequences` vs `stop`） |
| M8b | `assistant_prefill` | 需改造 | 显式定义「有 prefill 时尾部 system 落点」 | 中 | 见 §9 M2 |
| M9 | 原生 reasoning 采集 | 需改造 | 流解析 + 存储 + `REASONING` 正则通道 | 小–中 | 3.7f「隐藏 CoT」的前提；NyaaChat 目前只能把 CoT 当正文里的自定义标签 |
| 附加 | `max_tokens` 天花板 | 需改造 | Anthropic 路径**硬编码 4096**（`api.ts:859`） | 小 | 对「思考 ≥2000 字 + 长正文」是实打实天花板；OpenAI 路径不传 `max_tokens` |

### 4.5 改造点与成本汇总（10 项）

| # | 改造点 | 涉及文件 | 成本 |
|---|---|---|---|
| C1 | **装配后 prompt 钩子（`PromptRewriter`）** —— 统一承接 M1/M6/M8 | `api.ts:299-311` **或** `ChatInterface.tsx:791-836`（落点之争见 §9 M1） | 小 |
| C2 | 请求体可注入 `stop` / `stop_sequences`、`max_tokens` 可配 | `api.ts:382-392`、`:857-865` | 小 |
| C3 | `getExtensionPrompts()` 接线进装配（position/depth → 并入尾部块 / 最新 user） | `compat/stContext.ts:57-81` + `chatPipeline.ts:466-523` | 小–中 |
| C4 | 工具参数镜像进正文（+ 与「真工具执行」互斥开关） | `api.ts:365-513, 586-623` | 中 |
| C5 | 本地「伪工具」executor 进入工具选项 | `ChatInterface.tsx:693-752`、`mcpApi.ts:278-289` | 小 |
| C6 | `onChunk` 层 `\uXXXX` 流式解码（hold 缓冲） | `api.ts:453-501` 调用侧 / `ChatInterface.tsx:825-833` | 小 |
| C7 | 正则通道扩展：允许作用于静态 system 区 / 尾部块 / bypass 注入文本 | `chatPipeline.ts:363-432, 525-530` | 小 |
| C8 | reasoning 采集 + 存储 + `REASONING` 正则通道 | `api.ts`（流解析）、`types.ts:8-42`、`compat/regex/engine.ts` 消费侧 | 小–中 |
| C9 | assistant 预填 + 尾部 system 落点重新定义 | `api.ts:58-62, 695-758`、`chatPipeline.ts:496-523` | 中 |
| C10 | `GENERATION_ENDED` 发射 + 续写入口 + 合并写回 | `ChatInterface.tsx:822-860, 1379-1390`、`compat/events.ts` | 中–大 |

`[事实]` 以上**全部是前端核心改造，均不引入服务端参与**。唯一「服务端」副作用：nginx 若顺带修 CSP 会打断 M2a 的 eval 路线——那是策略层决策，不是可行性问题。

### 4.6 与既有约束/不变量的冲突点（必须显式处理）

| 冲突 | 事实 | 影响 |
|---|---|---|
| X1 单条尾部 system | `chatPipeline.ts:501-510` 注释明说不变量；`api.ts:58-62` 是守卫 | 禁止再加第二条尾部 system；absolute d0 注入必须并入 |
| X2 尾部 system 折叠 | OpenAI 路径**总是**折叠（`api.ts:535`）；Anthropic 仅 `claude-opus-4-8` + 官方 host 保留原位（`api.ts:1064-1075`） | 「后置 system 破甲条目」在 NyaaChat 里默认不存在（会被折进最新 user）；要复刻 4.0test 的 post-history system 必须自定义落点 |
| X3 volatile 标记 | `VOLATILE_PART_FLAG`（`api.ts:34`）被缓存断点与折叠逻辑依赖，发送前统一剥离（`api.ts:37-46`） | 改写数组时必须保留/清理该键，否则 Anthropic 缓存断点位置错乱 |
| X4 缓存前缀稳定性 | 静态前缀要求逐字节稳定（`chatPipeline.ts:434-441`） | 任何「按开关改变静态前缀」的实现都会破坏 prompt cache |
| X5 扩展为构建期资产 | `registry.ts:8-9`、`package.json` 的 `extensions:registry` | 任何「扩展方案」都要 rebuild + 重新部署，不能热装 |
| X6 `makeLast` 无语义 | `events.ts:65-67` | 不能靠「抢末位」决定改写顺序；顺序必须在单一钩子内定死 |

### 4.7 安全边界上的一个明确取舍

Q2 实测「主文档无 CSP」并把它判定为 **nginx `add_header` 继承缺陷**（`location = /index.html` 自带 `add_header`，抑制 server 级继承；`nginx.conf:75-79` vs `:41`）。这意味着：**当前 `eval` 路线能跑，依赖的是一个「配置没按意图生效」的状态**。任何为安全而修 CSP 的顺手动都会打断该路线。由于 NyaaChat 全仓零 `eval`，Q2 的建议是**不要引入 eval**，改用正则 / 受限 JSON 规则 / 构建期扩展三条替代路径。

---

## 5. Q3：AnswererFlagalac 应否增设绕过开关

### 5.1 结论与计数口径

**该加，但只加「目标专属的输入侧载荷开关」，不加「机制开关」。** 66 个可开关项中，真正需要用户按模型目标选择的只有 **7 个**；另有若干项建议**内置固定**；其余约 50 项分别落到正则层 / RosettaStone / 世界书 / 角色卡，或**明确不暴露**（否则 UI 会骗人）。

计数口径：7 = `gemini25pro31pro` 目标 3 个（`identityCard` / `refusalImmunity` / `disclaimerSpell`）+ `gemini37flash` 目标 3 个（`dualModelCard` / `toolChannel` / `unicodeEncoding`）+ 两目标各一份的 `traceCleanup`。按「每目标可见开关数」计则每个目标 4 个。

### 5.2 建议暴露给用户的 7 个开关

| 建议 id | 名称 | 目标 | 默认 | 落位（Q3 v3：E1-first） | 载荷来源 | 理由 |
|---|---|---|---|---|---|---|
| `identityCard` | 身份卡（SoliUmbra 模型卡 + 格式立法 + 思考约定） | `gemini25pro31pro` | **开**（可编辑） | **E1 尾 system 独立新块**（默认；L1 仅为可选增强，须 V10/V11；本文保留的再挑战与拍板点见 **§12.6**） | P4 `enhanceDefinitions` | 这是「选择该目标」的全部意义所在；不同渠道/角色卡需微调措辞 |
| `refusalImmunity` | 拒绝免疫开场 | `gemini25pro31pro` | **开**（可编辑） | **E1**（与身份卡同块，顺序固定） | P4 `nsfw`（去掉伪 JSON 开场部分） | 与人格/角色卡强相关，用户可能想换成自己角色的口吻 |
| `disclaimerSpell` | 防截断·免责声明咒语 | `gemini25pro31pro` | **关** | **E1** | P4 `防截断`（`<disclaimer_format>`） | 输出侧引导符、与渠道相关；默认关避免污染正文；**必须与正则「防截断隐藏」成对** |
| `dualModelCard` | 双模型卡（Gemini 降级 + SoliUmbra NULL） | `gemini37flash` | **开**（可编辑） | **E1**（v1 曾建议 L1 静态前缀，v2 因 K1 收敛；若启用 L1 则本项是首选内容，见 **§12.6**） | P37 `enhanceDefinitions` | P37 破甲核心；措辞需随渠道微调 |
| `toolChannel` | 工具通道强制输出（`game_content`） | `gemini37flash` | **关** | L4 工具通道 + 响应侧参数回收（**不碰尾 system 结构，故无缓存代价**） | P37 `防截断2.0` + `ToolBindings` + `OutputPreprocessing` | 最强也最重：**依赖改造、非开箱即用**（需「参数=正文」回收 + 本地工具源 + 与 MCP 互斥）；未改造前 UI 置灰 |
| `unicodeEncoding` | 敏感内容 `\uXXXX` 编码规避 | `gemini37flash` | **关** | **E1**（规则文本）+ L6 响应侧解码 | P37 `防截断`（编码规则，文件里存在、未启用） | 与 `toolChannel` 独立可用；默认关因为降低正文可读性且必须配解码 |
| `traceCleanup` | 思维链痕迹清理（CoT 不回传 + 标签转义） | 两目标各一份 | **开** | L5 正则层（`promptOnly` + `AI_OUTPUT`，**无需新钩子**） | 两预设的「思维链对AI隐藏」+「思维链标签转义」 | 破甲链路的**稳定性**组件。**只作用于正文文本，不承诺任何原生思考通道效果**（`Message` 无 reasoning 字段、流解析不认 `reasoning_content`、`REASONING=6` 无消费点） |

**⚠️ v2 新增硬要求：载荷默认文本必须按 NyaaChat 现状裁剪**（Q3 v3 §5.1）。两预设原文里混有**原生思考通道专属**子句，直接照抄会产生「要求模型做它做不到的事」的死指令：

| 载荷 | 必须做的删改 |
|---|---|
| `unicodeEncoding` | **删掉**「`<think_nya~>` 的思考总结必须全部编码为 unicode」「思考过程中避免提及…」等以**原生 thinking** 为前提的段落（NyaaChat 不具备该能力：`regex_placement.REASONING=6` 零调用点、流解析不读 `reasoning_content`），**只保留**「正文/文本标签式 CoT 中的敏感词编码 + 响应侧解码」这一半 |
| `traceCleanup` | 走「文本标签式 CoT + `AI_OUTPUT` 正则隐藏/折叠」路线，**不要**照搬「原生 reasoning 预填」的配套写法 |
| `identityCard` / `dualModelCard` | 原文里「`reasoning_effort: high`」「先进行内部思考分析（不输出）」一类与原生思考绑定的要求，**改写为「在 `<think_nya~>…</think_nya~>` 文本标签内思考」**，并与 `traceCleanup`（`AI_OUTPUT` 正则路线）**成对出现** |

**另一条 v2 新增约束**：7 个开关**全部**是「模板文本 + 独立开关 + 可编辑 + 各自重置」（RosettaStone 式），**没有任何一项要求用户写 JS**，也不依赖 `eval` / `new Function`；CSP 现状（主文档无 CSP，根因 `nginx.conf:75-79` 的 add_header 覆盖 `:41`）**不作为可依赖能力**——修 CSP 即失效。

### 5.3 建议内置固定（不给开关，随目标自动生效）

| 项 | 依据 | 理由 |
|---|---|---|
| 词表灌注（P4：`cat dog red blue …`） | P4 `enhanceDefinitions` | 纯文本缓冲、无副作用；单独开关无可理解语义，且容易被误关削弱强度 |
| `<think_nya~>` 思考协议（含「思考≥2000字」、固定开场白） | P4/P37 `enhanceDefinitions` | 与身份卡文本强绑定，拆开会让格式与身份互相矛盾 |
| 防截断隐藏 / 控制标签隐藏 / 行动选项清理（正则） | 两预设正则 | 与 `disclaimerSpell`/`toolChannel`/`unicodeEncoding` 是**成对机制**；单独暴露只会造成「注入没清」或「清了没注入」 |
| 载荷落位通道（统一 **E1** = 唯一尾 system 的独立新块） | Q3 v3 §6.1/§6.4 + Q1 硬约束 3（v1 的「P4→尾部 / P37→前缀」分流已因 K1 收敛） | 用户无法理解也无法判断，误配会同时破坏破甲强度与缓存；**且该开关若条件化会击穿前缀缓存**（详见 §12 K1） |
| `</小猫之神世界书处理>` 绝对注入等「结构零件」 | 条目 `a5e2b2b4`（两份都未启用） | 没有 ChatSquash 就没有语义，属实现细节 |

### 5.4 建议不暴露（三类）

**(a) 当前无通道 / 未实现（做不出来，或做出来会骗人）**

伪 JSON 会话伪造（`<end>"},{` / `<|check|>` / `<|no-convert|>` / 角色标记→JSON）｜世界书搬运｜绝对注入 depth=0｜assistant 预填 / `reasoning` 预填 / `<prefill_thinking>`｜停止串 `<end>`｜原生思考开关（`show_thoughts` / `reasoning_effort: high`）｜工具层三件套（无缝循环 / 回合合并 / 置底）。

> **本轮以 Q3 v3 为准，对 v1 的三处表述做如下修正**（v3 已自行修改，§9 M3 相应结案）：
> 1. **停止串**：v3 不再写作「不可实现」，而是明确**即便实现也只能做成「全局设置」、不做成 per-target 开关** —— 因为 `stop` 作用于该会话**所有模型**，且**会截断正文中合法出现的该串**（`<end>` 这类短标记风险尤高）；替代方案是「文本约定 + 响应侧剥离」（需 V3 验证）。是否进首版仍是产品决策（§7 A3）。
> 2. **assistant 预填**：v3 改为「若将来真要预填，须先新增请求侧通道（改造项，不在首版）」，即从「不可实现」修正为**改造项**；`reasoning` 预填则确定不设计（无载体）。
> 3. **位置类（absolute depth=0 / 置底）**：v3 按 Q2 修正为 —— **`setExtensionPrompt`（`compat/stContext.ts:67`）有注册位，但 `getExtensionPrompts`（`:79`）全仓无消费点** ⇒ 属「现成未接线、需小–中改造」；且即便接线，按 Q1 也只能并入 E1 新块，**不能新增第二条尾部 system**。

**(b) 与现有模块重复或冲突**

| 项 | 冲突对象 | 证据 | 建议 |
|---|---|---|---|
| 防截断 disclaimer 文本 | ClavisSalomonis `customTemplates.disclaimer` | `bypassTemplates.ts:26-29` 首行与 P4 `防截断` 示例**逐字相同** | 若把 `disclaimerSpell` 做进 Flagalac，UI 必须说明与隐藏模块的关系；同时修 R1 |
| 字数要求（P4 1000 字 / P37 1500 字） | RosettaStone `wordCount`（1000–2000 字） | `WordCountTemplates.ts:27-31`；`chatPipeline.ts:501-519` | 不进 Flagalac；两者都开会出现两条互相打架的字数指令 |
| 转述/不转述、`<game>` 标签、猫猫留言、行动选项、内心话、多视角、人称 | RosettaStone / 角色卡 / 正则 | 均为体验向 | 不放进 Flagalac（否则「绕过模块」变成第二个文风面板） |
| 思维链折叠等显示型正则 | 现有 `RegexModal`（可导入 ST 正则，`compat/regex/io.ts:72-88`） | — | Flagalac 只给一个 `traceCleanup` 总开关；折叠/美化走正则面板 |

**(c) 有误用风险 / 与版本强耦合 / 作者自己都关了**

token 重定义（`a00fb1fe`，明文含 CSAM/GORE 字样，两份都在 order 之外）｜破限加强（`1ff52e20`，4192 字，P37 `en=0`）｜数删版 / 抢救死人感世界书 / 三选一短对话 / 三选一预填（均不在 order）｜ChatSquash 内部参数（B-01~B-18，无对应机制，将来若实现应以「能力开关」而非「照抄参数名」的形式出现）。

### 5.5 落位（注入点）方案（Q3 v3 口径）

> **术语映射（必须写明，避免两套编号误读）**：Q3 的 **L2 = Q1 的 E1**（唯一推荐落点，即「并入唯一尾 system 的独立新块」）；Q3 的 **L1 ≈ 静态前缀插入**（Q1 无对应推荐项，Q3 已降级为**可选增强**）。本文与后续开发统一以 **E1** 指代该落点。

| 层 | 位置 | 代码锚点 | 适用选项 | 代价 / 风险 |
|---|---|---|---|---|
| **L1 静态前缀** | `systemMessages[]`（锚点之后、persona 前后） | `chatPipeline.ts:434-464`；现有 bypass 用 `injectBypassPrompts()` 插 index 1（`bypassTemplates.ts:71-78`，调用点 `chatPipeline.ts:525`） | **默认不用**（v3 收敛为 E1-first）；仅作 `identityCard`/`dualModelCard` 的**可选增强**，**须 V10 + V11 通过后才可启用**（门槛与拍板见 §12） | 改动会翻转静态前缀 ⇒ **击穿 prompt cache**（标准 §7.4）；且 **Flagalac 不能复用 `injectBypassPrompts()`**（受 `bypass.enabled` 门控），须另起独立插入点。**本文对 v3 收敛保留一处再挑战，见 §12.6** |
| **L2 = Q1 的 E1：动态尾部独立新块** | 与 `<session_rules>` / `<output_constraints>` **同一条** trailing system，新增 `<answerer_bypass target="…">` 块 | `chatPipeline.ts:496-523`（`blocks.join("\n\n")`） | **5 个注入类载荷（`identityCard`/`dualModelCard`/`refusalImmunity`/`disclaimerSpell`/`unicodeEncoding`）+ `traceCleanup` 的规则文本落 E1**；`toolChannel` = **L4**、`traceCleanup` = **L5**、`unicodeEncoding` 另含 **L6** 解码 | 新块必须并入同一 `blocks`，**不得 push 第二条 system**（`chatPipeline.ts:504-510` + `api.ts:62` 拒绝折叠）；块名**无条件**写进锚点（§5.6）。优点：位于缓存断点②之后，**只改尾部字节、历史前缀缓存不受影响** |
| **L3 assistant 预填** | 历史末尾追加 assistant | 当前**不存在**（Q1 硬约束 5：全库无请求侧 prefill；Q2 同） | （不实现） | 见 §3.3(a) 写法 B，与 Q2 C9 |
| **L4 工具通道** | `tools` + 执行器 | 工具循环**现成**：`api.ts:515-627`（`maxRounds=5`）、`api.ts:390-392`；**缺**「参数=正文」回收（现为静默累加、不进 `onChunk`，`api.ts:475-490`）与本地工具源 | `toolChannel` | **依赖改造（中）**，非开箱即用；与 MCP 工具互斥（C5）；**不碰尾 system 结构** |
| **L5 正则层** | 请求侧 / 显示侧双管线 | `compat/regex/engine.ts:188-225`、`chatPipeline.ts:363-367, 425-432`、`RegexModal.tsx` | `traceCleanup` | 与用户自定义正则**链式叠加**（`store.ts:82-86`：全局→角色），顺序冲突需提示 |
| **L6 响应侧** | 流式 chunk / 落库前 | `api.ts:469-500` | `unicodeEncoding` 解码、`toolChannel` 参数回收 | 需保证流式下 `\uXXXX` 不被跨块切断（P37 的 `hold` 逻辑可照搬）；**不承诺原生思考通道** |

**关键映射结论（v3：已按 Q1 硬约束 3 收敛为 E1-first）**

- **原始观察（保留作保真度依据）**：P4 刻意让首条为 user、把规则挤进 user/model 轮次（猫神报告 §4.3/§4.9），而 Gemini 走 OpenAI 兼容端点、`foldTailSystemIntoLatestUser()`（`api.ts:58-95`）会把动态尾部折进最新 user ⇒ **P4 载荷天然属 E1**（「破甲文本搭用户消息的车」）。P37 则是把全部前导 system 合成唯一 system 消息使其成为 `systemInstruction`（SPreset 专项 §6.2）⇒ 若要「通道保真」，P37 载荷「应」落 L1。
- **收敛后的结论**：**P37 目标同样落 E1**。三条理由：① 遵循 Q1 的唯一推荐落点；② 落 L1 会让「切换目标/开关/编辑文本」翻转静态前缀字节、**击穿整段前缀缓存**，而落 E1 只动断点②之后；③ 双模型卡的破甲机理（身份隔离 + 角色语域锚定）主要靠**文本内容**而非通道特权，待 V10 实测后再考虑升级。
- 两种落位都**不需要**新增 trailing system；E1 只是并入现有唯一尾条。

**授权锚点同步（易漏）**：`SESSION_PROTOCOL_ANCHOR`（`chatPipeline.ts:310-314`）目前只声明 `<session_rules>` / `<search_context>` / `<memory_context>`。载荷以新标签进 E1 时必须：① 在锚点里补该块声明（说明来源与效力）；② **无条件写入** —— 即使某轮没有该块（用户选「无」或开关全关）也保留该声明，因为锚点属静态前缀，条件化会击穿缓存（Q1 硬约束 3；标准 §7.1/§7.4；`chatPipeline.ts:436-441` 已有同义的「锚点恒定」注释）。替代方案「并入 `<session_rules>` 内部」会挤进场景规则语义、被调解条款削弱 ⇒ **推荐新标签 + 锚点无条件声明**。

**⛔ 不可复用 ClavisSalomonis 链路（Q1 硬约束 7 / Q3 §6.2）**：`bypassTemplates.injectBypassPrompts()` 插在**静态前缀 index 1** 且受 **`bypass.enabled` 门控**（`bypassTemplates.ts:38, 71-78`）⇒ AnswererFlagalac **必须另起独立块、与 RosettaStone 同构**（`chatPipeline.ts:511-516` 的「独立于 `bypass.enabled`」先例），不得复用该链路、也不得受 `bypass.enabled` 影响。

### 5.6 数据结构草案

**`FlagalacTemplates.ts`（唯一事实来源）扩展**：

```ts
export type FlagalacOptionLayer =
  | "input-structure"   // 位置/结构（本版不暴露）
  | "identity"          // 身份重定义
  | "output-channel"    // 输出通道
  | "anti-truncation"   // 防截断
  | "trace-cleanup";    // 痕迹清理

export interface FlagalacOption {
  id: string;                 // 持久化键，发布后不可改
  label: string;              // 开关行显示名
  description?: string;       // 一行说明
  defaultEnabled: boolean;    // 新建/重置时的默认值
  layer: FlagalacOptionLayer; // 仅用于 UI 分组与文档
  template?: string;          // 默认载荷文本；有此字段的选项多一个「编辑/重置」
  available?: boolean;        // false = 依赖未就绪，UI 置灰
  unavailableReason?: string;
}

export interface FlagalacTarget {
  id: string;
  label: string;
  description?: string;
  options?: readonly FlagalacOption[];  // 该目标专属开关组
}

export function resolveFlagalacOptions(
  targetId: string,
  raw: unknown,
): { options: Record<string, boolean>; templates: Record<string, string> };
```

`resolveFlagalacOptions()` 规则（**读取时收敛，不写回**）：① `targetId === "none"` 或未知 → 返回空；② 只接受该目标声明过的 id，**未知 id 静默丢弃**（对应「下线某个开关」）；③ 非布尔值 / 缺键 → 用 `defaultEnabled`（**因此新增开关不需要任何迁移**）；④ `templates` 仅在「声明了 `template` 且值为非空字符串且 ≠ 默认文本」时保留。

**`BypassSettings`（`types.ts:124-126` 扩写）**：

```ts
answererFlagalac: {
  target: string;
  perTarget: Record<string, {
    options: Record<string, boolean>;   // 缺键 = use defaultEnabled
    templates?: Record<string, string>; // 仅存被用户改过的载荷
  }>;
};
```

默认值（`App.tsx:440-444`）：`answererFlagalac: { target: FLAGALAC_NONE_ID, perTarget: {} }` → 默认完全惰性，不产生任何注入；各开关默认值只在 UI 首次展开时由模板给出（**不落盘**），使默认值将来可改而无需迁移。

**持久化升级**：`settingsBackup` `EXPORT_VERSION 7 → 8`（`settingsBackup.ts:18-19`；`SUPPORTED_IMPORT_VERSIONS` 加 8、保留 2..8；`_version >= 8` 校验 `perTarget` 形状；回填改为补 `perTarget: {}` 并逐目标跑 `resolveFlagalacOptions()`，不复制字面量）；`App.tsx` `SCHEMA_VERSION 9 → 10` + `migrateV9ToV10` 规范 `answererFlagalac`（**不要**在 v10 里顺手强制 `bypass.enabled=false`，那是 v7→v8 的语义）。

**切换目标时旧选项处理 → 保留**（perTarget 按 id 分开存）：两目标差异极大，共用一套 `options` 会导致切换后语义错位；用户在两目标间来回切换是常态。清理方式：从 `flagalacTargets` 删除目标 ⇒ 下次读取时该键被丢弃（与 `resolveFlagalacTarget()` 既有语义一致，`FlagalacTemplates.ts:69-76`）。**文档必须写明「下线目标 = 丢弃其配置」。**

### 5.7 UI 形态建议

保持 `BypassModal` 既有骨架与红色系容器（`BypassModal.tsx:349-394`）；在**选中条目下方就地展开**开关组（同一 `radiogroup` 容器内，用现有 `AnimatePresence` + `motion.div` height auto 动画，与 RosettaStone 编辑区完全一致 `BypassModal.tsx:319-340`）。行样式复用 RosettaStone：20px 方框 checkbox + 右侧 `RotateCcw` 重置 / `Edit2` 编辑图标按钮；编辑区复用同一 textarea 样式类并保留 `{{char}}`/`{{user}}` 变量提示行（`BypassModal.tsx:288-301, 328-333`）。要点：

1. **可编辑项**（带 `template`）显示 `[重置][编辑]`；纯开关项只显示 checkbox + 说明。
2. **未就绪项置灰**：`toolChannel` 等在依赖未实现时 `disabled` 并显示**具体原因**（如「需先完成前端工具通道（见 Q2）」）——不要沿用现状那句通用的「逻辑尚未接入」（`BypassModal.tsx:389-393`）。
3. **冲突提示**：行内/组尾小字提示，至少覆盖 C1（防截断重复）、C2（字数重复）、C5（MCP 工具互斥）。
4. **与 RuleBreaker 的区分文案**：RuleBreaker 是「点击把文本当用户消息发出去」（`BypassModal.tsx:240-245`），不改变请求装配；Flagalac 是「每轮自动注入」。需一句话说明差异。
5. **与隐藏的 ClavisSalomonis 的关系**：该模块 UI 已下线（`BypassModal.tsx:467-610` 整块注释），Flagalac 成为用户唯一可见的绕过入口 ⇒ 建议在 Flagalac 组内加状态提示（`bypass.enabled === true` 时警告「检测到旧版 ClavisSalomonis 仍处于开启状态（当前无界面），将与本模块叠加注入」），并顺手修 R1。

### 5.8 Q3 的冲突与风险清单（摘要）

| 编号 | 冲突/风险 | 处置建议 |
|---|---|---|
| C1 | `disclaimerSpell` 与 ClavisSalomonis `disclaimer` 模板**文本几乎逐字相同**（`bypassTemplates.ts:26-29` vs P4 `防截断` 首行） | Flagalac 生效时提示，或 UI 层做成互斥 |
| C2 | 猫神字数要求（1000/1500 字）与 RosettaStone `wordCount`（1000–2000 字）重复/矛盾 | 字数不进 Flagalac |
| C3 | `traceCleanup` 与用户自定义正则**链式叠加**（`store.ts:82-86` 全局→角色） | traceCleanup 产出的脚本**只作用于请求侧**（promptOnly）并固定排最前，UI 说明「会与正则面板规则叠加」 |
| C4 | P4 的「思维链对AI隐藏」是 promptOnly、P37 是 promptOnly+markdownOnly ⇒ 照抄 P37 版会让**历史里 CoT 消失且显示折叠失效**，与「思维链折叠 2.5」打架 | `traceCleanup` 采用 **promptOnly** 版 |
| C5 | `toolChannel` 与现有 MCP 工具**同一 `tools` 数组** → 互相干扰（`api.ts:390-392, 541-570`；`chatPipeline.ts:491-494`） | 两者互斥；实现前需 Q2 给出工具通道结论 |
| C6 | NyaaChat 缺 **request-side 能力**：无 prefill、无 `stop`（Q2 修正：位置类不是「无通道」，而是**有注册位无消费点** —— `compat/stContext.ts:67` 注册 / `:79` 无消费点）、Anthropic `max_tokens` 硬编码 **4096**（`api.ts:859`） | 按 §5.4 不暴露；若将来实现，**先补 `api.ts` 发送层能力（`stop` 等）再补 UI**（顺序不能反）；位置类一律并入 E1 新块（M3） |
| C7 | 落静态前缀的载荷（**仅 L1 可选退路**）会**击穿 prompt cache**，须 UI 明示；**首版 E1 只改断点②之后的尾部字节，不受影响** | **禁止**把每轮变化内容（世界书、时间、检索结果）塞进 L1；L1 须先过 **V10/V11**（标准 §7.1/§7.4；见 §12.4） |
| **R1** | **导入备份可复活已下线的 ClavisSalomonis，且 UI 无法关闭**（`App.tsx:123-131` 的 v7→v8 强制 false vs `settingsBackup.ts:419-468` 导入不回填 `enabled`；落盘 `App.tsx:756` 写 `_version: 9` 后再不走该分支） | 在 `settingsBackup` 回填里对齐 v7→v8 语义（`bp.enabled = false`），或保留但恢复 UI |
| **R2** | **同一 identifier 跨预设内容不同**（`2f2729f4` / `3df19ba7` / `91918c0a` / `820a1944`） | 任何按 id 取预设原文的映射表**必须带 preset 维度**，否则静默张冠李戴 |
| R3 | `FlagalacTarget.template?: string`（`FlagalacTemplates.ts:37`，注释写「UI 不读取」）与「多个开关各带一段文本」不兼容 | 新增 `options[]` 时**不要复用该字段名**；发布前无兼容负担，可作废或改为 `undefined` 并在同 PR 注明 |
| R4 | `toolChannel`/`unicodeEncoding` 把「输出」搬到非文本通道 ⇒ 影响**历史落库形态** | 落库存**解码后的正文**；原始工具参数只进 console/调试 |

### 5.9 Q3 给出的落地顺序（v3 §10；本文采纳并归并入 §7）

**P0 修 R1**（导入复活隐藏模块；本文已单列为 §11）+ 更新 `FlagalacTarget.template` 注释 → **P1 数据结构先行**（`options` + `resolveFlagalacOptions()` + `perTarget` + SCHEMA/备份升级，UI 只渲染不接逻辑）→ **P2 UI 展开** + 冲突提示（C1/C2/C5）→ **P3 M1 + M4**：E1 独立新块 `<answerer_bypass>` + 锚点**无条件**声明（M1：**1 处改造供 5 个选项共用**）→ 5 个载荷开关（默认文本按 §5.2 的「载荷裁剪」改写）+ `traceCleanup`（M4，正则层，无需新钩子）→ **P4 M2（依赖批）**：`toolChannel`（先做 V7 验证，再实施响应侧回收 + 本地工具源 + MCP 互斥）；可选退路「通道保真模式（L1）」**仅在 V10/V11 通过后另立阶段** → **P5 M5 + 可选批**：停止串、长输出（`stop` + `max_tokens`；停止串若做只能是**全局设置**且会截断正文中出现的该串）、预填、破限加强、位置类（M3）；每项必须等 V1–V3/V12 验证通过再进 UI。

### 5.10 Q3 v2/v3 的修订要点与改造前置项归并（v1 没有的内容）

> captain 指令：Q3 已就地修订为 v2（实际文件为 v3），汇总必须吸收以下新增内容。以下均按**实际读到的 v3 文件**摘录。

**修订要点（5 条）**

| # | 修订内容 | 出处（Q3 v3） |
|---|---|---|
| 1 | **载荷文本裁剪**（因 NyaaChat 无原生 thinking 通道）：`unicodeEncoding` 默认文本中「`<think_nya~>` 思考总结全部编码」等**原生思考专属子句必须删除**；`identityCard`/`dualModelCard` 的「内部思考（不输出）」**改写为 `<think_nya~>` 文本标签**，并与 `traceCleanup`（`AI_OUTPUT` 正则路线）**成对出现** | §5.1「载荷默认文本必须按 NyaaChat 现状裁剪」 |
| 2 | **锚点写法 = 无条件写入**：即使某轮没有该块（选「无」/开关全关）也要保留该声明 —— 依据 Q1 硬约束 3 + `chatPipeline.ts:436-441` 的「锚点恒定」注释 | §6.2 第 2 条 |
| 3 | **停止串即使实现也只能是全局设置**（作用于该会话所有模型），**不做成 per-target 开关**；并标注会截断正文中出现的该串 | §5.3(a) 停止串行 |
| 4 | **明确不可复用 ClavisSalomonis 链路**：`injectBypassPrompts()` 插在静态前缀 index 1 且受 `bypass.enabled` 门控 ⇒ Flagalac 必须**另起独立块、与 RosettaStone 同构**、不受该开关影响 | §6.1 L1 行、§6.2 末段 |
| 5 | **术语映射**：Q3 的 **L2 = Q1 的 E1**（唯一推荐落点）；L1 ≈ 静态前缀（无对应推荐项，降级为可选增强） | §6.1「编号对照」 |

**改造前置项归并表 M1–M5**（Q3 v3 §6.5；§10 的阶段划分以此为依据）

| 前置项 | 内容 | 依赖它的选项 | 规模 | 与 Q2 的关系 |
|---|---|---|---|---|
| **M1** | `chatPipeline` 尾部构造处新增独立新块 `<answerer_bypass target="…">` + 锚点无条件声明（E1 落位，**不新增第二条 system**） | `identityCard`、`refusalImmunity`、`disclaimerSpell`、`dualModelCard`、`unicodeEncoding`（**5 项共用一处改造**，不逐项重复） | 小 | 若 Q2 的通用「装配后 PromptRewriter 钩子」落地，**改挂该钩子**（同一挂载点） |
| **M2** | 响应侧「工具参数 = 正文」回收（`api.ts:475-490`）+ 本地工具源 + 与 MCP 工具的互斥/共存策略 | `toolChannel` | 中 | 对应 Q2 C4/C5；需先做 V7 |
| **M3** | `getExtensionPrompts`（`compat/stContext.ts:79`）消费点接线；位置类一律并入 E1 新块 | 当前**不暴露** | 小–中 | 若通用钩子落地可并入 M1 挂载点 |
| **M4** | `traceCleanup` 的正则脚本产出（内置或一键导入） | `traceCleanup`（两目标各一份） | 小 | 用现有 ST 同源引擎，**无需新钩子**；顺序冲突见 C3 |
| **M5** | 发送层放开 `stop`（**全局副作用**）+ `max_tokens`（Anthropic 4096 硬编码） | 当前**不暴露** | 中 | 只能做成全局设置 |

**另有两处 v3 补充（与本文 §4/§8 联动）**：① §5.2 内置项「思考≥2000字」在 **Anthropic 路径受 `max_tokens: 4096` 硬编码**限制（`api.ts:859`），落地时应写成软目标或按 provider 降级（Gemini 走 OpenAI 兼容路径不发该字段）→ 已并入 §8 U22；② v3 明确「**本报告不设计依赖 `eval`/`new Function` 的选项，不把『无 CSP』当作可依赖能力**」，与 §4.7 / §11 R5 一致。

---

## 6. 三问之间的推导链

三份报告不是并列的三块，而是**互相约束**的。以下关联是本文新增（Q1 §8、Q2 §8、Q3 §10 各自只给出部分接口）：

### 6.1 Q1 → Q3：Q1 的落点判决直接决定 Q3 的选项分层与「不要暴露」清单

1. Q1 的 **B2 严重冲突**（尾部只能一条 system）⇒ Q3 只能把载荷**并入**现有尾块，不能新增条目。这直接否掉「按预设条目逐一映射」的直觉做法。
2. Q1 的 **H1（必须把新块名写进授权锚点且无条件恒定）** ⇒ Q3 §6.2 的锚点同步要求不是可选优化而是**前置条件**，同时意味着「按开关动态改变锚点句」在设计上被禁止。**这与 Q3 v3 的 E1-first 基线不冲突（锚点句恒定 vs 载荷随配置变）；若载荷改走 L1，则触发 §12.6/K1 的缓存代价，须先过 V10/V11。**
3. Q1 的 **E5 致命冲突**（伪 JSON / 历史重写）⇒ Q3 §5.4(a) 把「伪 JSON 会话伪造 / `<|check|>` 收尾 / 世界书搬运 / 绝对注入」整组列入不暴露，是**结构必然**，而非产品偏好。
4. Q1 的 **§2.5 / 硬约束 8**（无 reasoning 载体）⇒ Q3 里任何「对 AI 隐藏原生思维链」的开关只能落在**文本标签**上；`traceCleanup` 因此必须是纯正则方案（Q3 §5.2 的默认「开」也据此成立）。
5. Q1 的 **B1 分级「4.0test 严重 / 3.7f 无冲突」** ⇒ 它曾使 Q3 v1 认为落位应**不对称**（P37 走静态前缀是顺势、P4 走尾部是绕开 B1 的补偿）。**但 Q3 v2/v3 已自行推翻该推论**：Q1 硬约束 3 优先于「通道保真」，故全部载荷统一落 E1，L1 仅作可选增强（K1，见 §12）。**这条演化本身说明：Q1 的 B1 只回答「通道是否可用」，不回答「落哪一层更好」——后者由硬约束 3 决定。**

### 6.2 Q2 → Q3：Q2 的可行性判决决定 Q3 的哪些开关能真正生效

| Q2 结论 | 对 Q3 的影响 |
|---|---|
| 工具循环已具备、但「参数=正文」缺失（M3/M4b、C4/C5） | `toolChannel` **不能进第一批**；Q3 已把它列为「依赖批」，并给出 UI 置灰要求 —— 这一处置与 Q2 一致，可执行 |
| 正则层已具备、`REASONING` placement 无对象（M7/M9） | `traceCleanup` 是 7 个开关里**唯一零改造即可生效**的；其余 6 个都各自依赖 Q2 的某项改造 |
| 无 prefill / 无 stop 字段（M8a/M8b） | Q3 把这两类列入「不暴露」；但按 Q1 E6 / Q2 C2，停止串属**小改可补** ⇒ 属产品决策而非技术阻塞（见 §9 M3） |
| `setExtensionPrompts` 注册位未接线（M6/C3） | 若将来要支持「位置类」选项，落位候选就是这条通道；**v3 更正表述：`setExtensionPrompt`（`compat/stContext.ts:67`）有注册位，但 `getExtensionPrompts`（`:79`）全仓无消费点** ⇒ 现成未接线、需小–中改造；且即便接线也只能并入 E1 新块；首版不用 |
| 扩展是构建期资产（X5） | Q3 的 7 个开关**必须做进核心代码**，不能包装成「官方扩展」；这与「UI 落在 BypassModal」一致 |
| 主文档无 CSP、eval 不被拦但是缺陷状态（§4.7） | Q3 §5.4(a) 把「用户 JS 后处理」列入不暴露，与 Q2 的安全结论一致 |

### 6.3 Q1 × Q2：两处**需要人拍板**的接口冲突

- **PromptRewriter 钩子的落点**：Q2 的 C1 建议放在 `api.ts:299-311` 或 `ChatInterface.tsx:791-836`；Q1 的硬约束 5 明确「不要放进 `api.ts` 发送层」，理由是 `fetchChatCompletion` 有 4 个调用点（主回合 / 图像提示词 / 记忆抽取 / 卡牌侧）。**两者不能同时成立** ⇒ 见 §9 M1。
- **assistant 预填是否需要改不变量**：Q2 判「须一并改不变量」；Q1 §5.1 给出「放尾 system 之前即可保住折叠」的写法 B。**两者口径不同** ⇒ 见 §9 M2。

---

## 7. 开发前置条件清单

> 按优先级排序。「必须先确认」= 未确认就动手会做出返工品；「必须先做」= 独立可提交且为后续解锁项。
>
> **排序附注**：**A5（落位基线确认）为最高优先**；**A1（Gemini 兼容层行为）只影响 L1 可选退路是否有收益、不阻塞首版**（仍建议尽早实测）；A5 的冲突记录与验证门槛见 **§12**；B1（修 R1）的完整症状、复现步骤与两种最小修复方向见 **§11**。

### P0 — 必须先确认（阻塞后续所有设计决策）

| # | 前置条件 | 为什么必须在最前 | 验证/决策方式 |
|---|---|---|---|
| **A1** | **确认 Gemini OpenAI 兼容层对 system 的真实处理**（是否把所有 system 并进 `systemInstruction`） | **本项只决定 L1 可选退路（V10/V11）是否有收益，E1-first 首版不依赖它**；仍建议尽早实测以决定是否启用 L1。当前证据只有代码注释（`api.ts:526-534`）+ 项目规范（标准 §5 line 105），**无实测** | 抓包/最小请求：发 `[system(A), user(B), system(C)]` 到 `generativelanguage.googleapis.com/v1beta/openai`，观察 A/C 的权威差异；或用中间代理记录并改写做 A/B（见 §8 U1 / §9 M4） |
| **A2** | **确认 PromptRewriter 钩子的落点**（`ChatInterface.tsx` 主回合处 / `api.ts` 内带 opt-in 参数 / 两者结合） | 这是 Q2 认的「最高杠杆单点」，也是 Q1 硬约束 5 与 Q2 C1 的冲突点；定不下来就无法动第一批注入逻辑 | 决策 + 最小原型（见 §9 M1 的三种方案） |
| **A3** | **确认「不暴露」清单的口径**：「当前未实现」与「不可实现」必须区分 | Q3 把预填/停止串列在「无通道」组，但 Q1/Q2 认为属「小改可补」；若沿用 Q3 口径，未来会出现「UI 说不支持，实际只是没做」的误导 | 由产品层拍板：停止串、预填是「首版不做」还是「永不做」（= §9 M3） |
| **A4** | **确认 assistant 预填是否进首版**（若进，必须同时接受「预填安全性依赖本轮是否有尾 system」这条硬约定） | 它决定 Q1 硬约束 7 是否成为实现约束 | 决策 + §8 U2 验证 |
| **A5** | **确认采纳 E1-first 基线**（Q3 v2/v3 已自行收敛：7 个载荷全部落唯一尾 system 新块 `<answerer_bypass>`；L1 静态前缀降级为**可选增强**、默认关、不在首版）；若日后要启用 L1「通道保真模式」，须先过 **V10 + V11** | 落位直接决定改装配的哪一段与缓存代价；该基线已无争议，**但"是否启用 L1 退路"仍需实测数据支持** | 见 **§12**（K1 冲突记录 + E1/L1 代价对比 + V10/V11 门槛 + 拍板条件） |

### P1 — 必须先做（独立、低风险、解锁后续）

| # | 事项 | 依据 |
|---|---|---|
| **B1** | **修 R1**：在 `settingsBackup` 导入回填里对齐 v7→v8 语义（`bp.enabled = false`），或 `injectBypassPrompts` 直接忽略该字段 | **§11 R1**（本文已独立回源复核：`bypassTemplates.ts:38` + `BypassModal.tsx:467-610` 注释块 + `App.tsx:85-131, 753-757` + `settingsBackup.ts:419-468` + `SettingsModal.tsx:174-177`）；不修则会出现「用户不知情地每轮注入两份 disclaimer，且无法从 UI 关闭」 |
| **B2** | **数据层先行**：`FlagalacTemplates.options` + `resolveFlagalacOptions()` + `BypassSettings.perTarget` + `SCHEMA_VERSION 9→10` / `migrateV9ToV10` + `settingsBackup v7→v8` | Q3 §5.6/§7；纯数据层，UI 只渲染开关、不接注入逻辑，可独立提交验证 |
| **B3** | **锚点与块名约定落定**：确定承载载荷的标签名，并把该名**无条件**写进 `SESSION_PROTOCOL_ANCHOR` | Q1 硬约束 3；Q3 §6.2 |
| **B4** | **定义「正则 → 破甲改写」的执行顺序**并写进实现注释 | Q1 §E7 顺序陷阱；Q3 C3 |
| **B5** | **R2 防御**：所有按预设 identifier 取原文的映射表必须带 preset 维度 | Q3 R2（`2f2729f4`/`3df19ba7`/`91918c0a`/`820a1944` 同名不同物） |
| **B6** | **处理 `FlagalacTarget.template` 现状字段**（R3） | Q3 R3；避免与 `options[].template` 语义打架 |

### P2 — 可并行推进（UI 与注入逻辑第一批）

| # | 事项 | 依据 |
|---|---|---|
| **C1** | UI：选中条目就地展开开关组 + 复用 RosettaStone 行样式 + 冲突提示（C1/C2/C5）+ 未就绪项按具体原因置灰 | Q3 §6.3 |
| **C2** | 注入逻辑第一批（确定能做的）：**E1 尾 system 独立新块**（共用 **M1 一处改造**）承载 5 个注入类载荷 —— `identityCard` / `dualModelCard` / `refusalImmunity` / `disclaimerSpell` / `unicodeEncoding`；`traceCleanup`（**L5 正则层，零改造**）。**注意：L1「通道保真模式」不在首版，须先过 V10/V11（§12.4）** | Q1 E1/E7；Q2 M7；Q3 §10 P3 / §6.5 M1+M4 |
| **C3** | 让「本模块启用」本身成为「必须产出尾部 system」的条件（否则尾块为空时载荷无落点） | Q1 §E1 代价④ |
| **C4** | L6 响应侧：`unicodeEncoding` 的 `\uXXXX` 流式解码 + hold 缓冲（可并入 C1/C3 同一批次） | Q2 M4a/C6 |

### P3 — 依赖批（等前置确认完成）

| # | 事项 | 依赖 |
|---|---|---|
| **D1** | `toolChannel`（本地伪工具源 + 参数回收为正文 + 与 MCP 工具互斥策略） | A2（钩子）、Q2 C4/C5、§8 U3/U11 |
| **D2** | 停止串（若 A3 决定做） | Q1 E6、Q2 C2、§8 U8 |
| **D3** | assistant 预填（若 A4 决定做） | Q1 E3、Q2 C9、§8 U2/U4 |
| **D4** | 原生 reasoning 采集 + `REASONING` 正则通道 | Q2 M9/C8（属技术内核改造，不是 Flagalac 开关） |
| **D5** | 正则通道扩展到静态前缀 / 尾块 / bypass 文本 | Q2 C7（否则「痕迹清理」覆盖不到破甲载荷） |

### P4 — 明确不做（首版范围外）

伪 JSON 会话伪造 / 历史重写（Q1 E5，致命）｜世界书搬运进伪 JSON｜absolute depth=0 作为独立消息｜第二条尾部 system｜用户可执行 JS（eval）作为常态功能｜远程注入 inject.js｜无缝循环（Q2 M5，建议一期不做）｜破限加强 4192 字条目｜token 重定义明文句。

---

## 8. 待验证 / 不确定项

> 三份报告共 **27 条**待验证项（Q1 8 条、Q2 7 条、**Q3 v3 12 条**——v3 新增 V10/V11/V12），去重合并为 **22 条**，按「决定什么」分三组。每条给验证方法。`[未证实]` = 三份报告均无实测数据。

### 8.1 A 组：决定架构与落位可行性（最高优先）

| # | 事项 | 影响 | 验证方法 | 来源 |
|---|---|---|---|---|
| **U1** | Gemini 的 OpenAI 兼容层是否真的把所有 system 合并进 `systemInstruction` | **v3 口径下它不再是首版阻塞项**：首版走 E1-first（只依赖 Q1 硬约束 3），本项只决定 **L1「可选增强」是否有收益**（§12.4 门槛第 3 条）。Q1 D2 与其他依赖该断言的结论仍以它为共同前提 | 实机抓包：发 `[system(A), user(B), system(C)]`，观察 C 是否具备高权威；或用中间代理（Caddy/nginx）记录并改写请求做 A/B | Q1 V1 = Q2 V4 = Q3 V2 |
| **U2** | Gemini 兼容层是否接受「末条为 assistant」并按预填写下去 | 决定 E3/L3 是否可用 | 发送 `[…, user, assistant(部分句子)]`，看回复是否续写该句子 | Q1 V2 = Q3 V1 |
| **U3** | Gemini 兼容层是否支持 `tools` + 流式工具参数 | 决定 `toolChannel` 能否上线 | 用最小 `tools` 请求打兼容端点 | Q1 V3 = Q2（§3.3 待验证）= Q3 V7（部分） |
| **U4** | Anthropic 是否接受 `[user, assistant(预填), system]` 形状 | 决定 E3 在 Opus 4.8 路径上是否可用 | 官方 API 直接发该序列（最小 curl） | Q1 V4 |
| **U5** | 「预填在最末」时 Anthropic 非 Opus 路径确实回灌顶层 `system` | Q1 D1 的核心推断 | 单测：对 `foldTailSystemIntoLatestUser` + `prepareAnthropicPayload` 断言 `system` 字段包含尾部规则（纯函数，无需网络） | Q1 V5 |
| **U6** | 尾部 system 为空时 `tailMessages = []` 的边界是否让预填退化为「末条 assistant」 | 决定 E3 的实现约束 | 代码走查 + 单测（无关键字规则、RosettaStone 全关的场景） | Q1 V6（= Q2 V6 之一） |
| **U7** | `GENERATION_STARTED/ENDED` 是否真的完全未发射 | 决定无缝循环（M5/D3）的改造起点 | 浏览器控制台 `eventSource.on('generation_started', console.log)` 后发一条消息 | Q2 V3 |
| **U20**（Q3 v2 新增） | **E1（尾 system 新块，Gemini 侧折进最新 user）vs L1（静态前缀进 `systemInstruction`）的破甲效果差异** | 决定 K1 的退路「通道保真模式」是否值得启用；同时量化前缀缓存代价 | 同角色/输入/渠道，两版落位各跑 10 轮：统计拒绝率、OOC 率、`finish_reason`，以及 usage 里的 **cached tokens**（E1 版应保持历史前缀缓存命中，L1 版在切换后会掉到接近 0） | Q3 V10 |
| **U21**（Q3 v2 新增） | **UI 切换目标/开关时，E1 载荷变化是否只影响尾部字节**（缓存断点②之后） | **L1（静态前缀·可选增强）启用的前置条件之一**（§12.4 门槛第 2 条）；同时验证 E1-first 的成本结论 | 开 Debug 打印两轮请求体，**逐字节对比静态前缀段是否完全一致**（应当一致） | Q3 V11 |

### 8.2 B 组：决定选项取舍与默认值

| # | 事项 | 影响 | 验证方法 | 来源 |
|---|---|---|---|---|
| **U8** | `stop` 参数是否被目标渠道接受 | 决定「停止串」能否进入 Flagalac 与 A3。**Q3 v3 已补的实质约束：即便接受，也只能做成「全局设置」（作用于该会话所有模型）、不做 per-target 开关，且会截断正文中合法出现的该串** | 最小请求体加 `"stop": ["<end>"]`，看是否被拒或忽略；再验证正文里出现 `<end>` 时是否被提前截断 | Q3 V3 |
| **U9** | `reasoning_content` delta 在目标渠道是否真的出现 | 决定「原生思考 + 编码规避」是否可行 | 开流式抓包，观察 chunk 里是否有 `delta.reasoning_content`（当前 `api.ts:469-474` 会丢弃） | Q3 V4 |
| **U10** | `traceCleanup` 用 promptOnly 正则删除历史 CoT 后，破甲成功率是否下降 | 决定该开关的默认值 | A/B：同角色同输入，开/关各跑 10 轮，比对拒绝率与 OOC 率 | Q3 V5 |
| **U11** | `disclaimerSpell` 是否真的降低截断率（机理本身是社区经验） | 决定默认值与 UI 文案 | 同渠道同模型，开/关各跑 10 轮长文本，统计 `finish_reason=length` / 空回比例 | Q3 V6 |
| **U12** | 两份预设「说明.txt」的开/关流式、带工具要求是否是**破甲的硬前提** | 影响 Flagalac 文案与默认建议 | 同渠道跑「开流式/关流式 × 带工具/不带工具」四组对照 | Q3 V9 |
| **U13** | Anthropic `max_tokens` 硬编码 4096（`api.ts:859`）是否会在长推理下截断 | 决定 `max_tokens` 可配是否进首版 | 实机跑一次长思考 prompt，读 `usage.completion_tokens` 与 `finish_reason` | Q2 V6 |
| **U22**（Q3 v3 新增） | **Anthropic 路径 `max_tokens: 4096` 对「长正文 / 长思考」目标的实际影响**（Gemini 走 OpenAI 兼容路径**不发**该字段，故影响面只有 Anthropic 系）。**注：停止串的截断风险不属本项，属 U8 / Q3 V3** | 决定「思考≥2000字」「长输出」类内容是否会在一半模型上被截断；也决定 §5.3 内置项是否要写成**软目标或按 provider 降级** | 在 Anthropic 供应商上跑长输出提示词，量 `finish_reason=length` 比例与正文长度分布；**对照 Gemini 路径**（应与 U13 合并成一次实验） | Q3 V12 |

### 8.3 C 组：决定工程实现细节

| # | 事项 | 影响 | 验证方法 | 来源 |
|---|---|---|---|---|
| **U14** | 工具参数镜像成正文后与 UI 流式的衔接（避免正文重复渲染） | 决定 `toolChannel` 的实现方式 | 最小前端原型：构造 `callOpenAIOnce` 的单测式调用，断言 `onChunk` 收到的文本序列 | Q2 V5 |
| **U15** | CSP 在主文档缺失是否还有 meta / 代理层补头；JSR iframe 用 `blob:` 还是 `srcdoc`、CSP 生效后是否被拦 | 决定 eval 路线的可用期与扩展影响面 | DevTools → Network → 文档响应头；打开 JSR 脚本面板查 iframe 的 `src`；**在测试容器**给主文档加 CSP 后逐一开关扩展观察 Console（不要在生产做） | Q2 V1/V2/V7 |
| **U16** | 4.0test 的 `<\|check\|>` 是否真的命中「收尾分支」 | 影响伪 JSON 最终开放对象的角色 —— **但 Q3 已建议首版不做伪 JSON，故对首版影响有限** | 猫神报告 §8 第 4 项；需实机日志 | Q1 V7 |
| **U17** | 4.0test 说明要求的「带工具」后处理由谁补足 | 决定 4.0test 路线在 NyaaChat 需要多少工具层 | 猫神报告 §8 第 5 项；SToolBook 专项 §2 | Q1 V8 |
| **U18** | `toolCallFormatter` / `MessageInjections` 里是否还有该预设未启用的能力 | 后续扩展面 | 读 `SPreset/inject.js` 对应区段（默认值 `:1-39` 与格式化管线） | Q3 V8 |
| **U19** | SPreset 的 `stop` 注入受 `ChatSquash.enabled` 守卫这一结论对 P37 的实际后果（P37 `enabled=false` ⇒ `<end>` 本就没生效） | 影响「停止串是不是必需项」的判断 | 对照阅读 SPreset 专项 §0 第 3 条 + 在 ST 里对 P37 复现一次 | Q1 B7 转引、Q3 B-04 |

**三份报告均未覆盖的空缺（不编造补全）**：没有任何一份给出**注入内容与破甲成功率的量化 A/B 数据**（全部是机制推断）；也没有分析 `RosettaStone.languageConstraint`（语言约束）与 P4/P37 正文语言/`\uXXXX` 编码之间的交互（编码后的正文会不会违反「只使用简体中文」这类约束，三份报告都未提）。

---

## 9. 来源报告间的矛盾、证据强度差异与悬空结论

> 本节是本文存在的核心理由。**M1–M6 是报告之间的真实分歧或口径冲突**，**M7 是证据强度分层**，**M8 是悬空结论**，**M9 是 Q3 报告内部的自相矛盾**，**M10 与 §9.9 是对 Q3「条件依赖 Q1/Q2」承诺的逐条兑现复核**，**§9.10 是 Q3 的版本演进记录（v1→v2→v3）**。本文只做定性并给出裁定意见，不替来源报告编造调和证据；凡属本文自行提出的处置建议，均已显式标注「本文建议」。
>
> **⚠️ 状态更新（Q3 已修订至 v3）**：**M3 与 M9 已由 Q3 自行修正**（v3 的 §5.1 全部改 E1、§5.3(a) 行内容软化、§6.4 显式记录 K1 冲突与收敛），本文保留其记录但标注「已结案」；§9.9 中依赖同一问题的 3 行同步更新。**仍未被修正的是 M1、M2、M4、M5、M7、M8、M10 中关于 U1 的部分**——它们要么是 Q1↔Q2 之间的分歧（Q3 无权裁定），要么依赖三份报告都未实测的服务端行为。

### M1｜PromptRewriter 钩子的落点：Q2 建议的位置与 Q1 的禁令冲突【需人拍板】

- Q2 §5 C1：钩子可放 `src/lib/api.ts:299-311` **或** `src/components/ChatInterface.tsx:791-836`。
- Q1 §6 导语 + 硬约束 5：**「不要改 `api.ts` 的发送层」**，因为 `fetchChatCompletion` 有 4 个调用点（`ChatInterface.tsx:822` 主回合、`:1680/:1736` 图像提示词侧、`lib/memoryExtraction.ts:407`、`compat/generate.ts:95`），在 `api.ts` 里加对话特化逻辑会外溢到旁路请求。
- **判定**：Q1 的担忧成立且更具体（Q2 自己在 §3.1 也提到「若走扩展 wrap `window.fetch` 会绕开设计意图」，但没把 4 个调用点的外溢风险展开）。**建议折中**：钩子定义在 `api.ts` 的**类型/管道层面**（如 `fetchChatCompletion` 增加可选 `rewriter?: PromptRewriter` 参数，缺省 `undefined` ⇒ 旁路请求零行为变化），**注册点在 `ChatInterface` 主回合调用处**。这样两者都可满足。此结论属本文建议，**非三份报告中的任何一份的原文结论**。

### M2｜assistant 预填是否「必须改不变量」：Q2 判「需」、Q1 判「不必」【Q1 更细，建议采信 Q1】

- Q2 §0.2 三分类表：「8b. `assistant_prefill` 类续写锚点 … **中（且须一并改不变量）**」；§3.8：「要显式定义『有 prefill 时尾部 system 的落点』」。
- Q1 §5.1：给出**写法 B**（预填插在尾 system **之前**）——折叠守卫通过、`api.ts` 无需改动；代价是折叠目标改变 + Anthropic Opus 4.8 路径预填语义丢失 + 「本轮是否有尾 system」成为前置条件。
- **判定**：Q1 的分析粒度更细（逐 provider 逐分支），且与源码一致（`api.ts:62` 的守卫只看末两条）。**采信 Q1**：预填**不必然**要求改 `api.ts:58-62`；但 Q2 提出的「必须显式定义落点语义」这一点仍然成立。注意 Q1 的写法 B 也**不是零代价**，它把安全性绑定到「本轮是否存在尾 system」这一每轮可变状态上。

### M3｜停止串与预填的「不可实现」定级：Q3 归入「无通道 / 不可实现」、Q1/Q2 归入「小改可补」【口径冲突】

- Q3 §0 第 3 点 + §5.3a：把「停止串类（`<end>`）」「预填类」列在「三类『看起来该有、实际做不了』」里，括号内自注「❓取决于 Q2」。
- Q1 B7：**可控（小改可补）**；Q1 E6 给出具体实现（`api.ts:382-392` 加 `stop`、`:857-881` 加 `stop_sequences`）。Q2 §3.8 8a：**需改造（小）**。
- **判定**：**事实层一致**（请求体确实没有这两个字段），分歧在**分类口径**。按 Q1/Q2，二者属「当前未实现、可小改补上」，不属「不可实现」。Q3 §5.3a 的表述会误导后续实现者以为技术上做不到。**本文按 Q1/Q2 口径修正为「需改造（小）」，是否进首版属产品决策**（见 §7 前置条件 A3）。
- **✅ 后续状态（Q3 v2/v3 已自行修正）**：v3 的 §5.3(a) **标题未改**（仍写作「当前无通道/不可实现」），但**行内容已软化**——停止串行改为「即便实现也只能做成**全局设置**、不做成 per-target 开关，且会截断正文中出现的该串」；预填行改为「若将来真要预填，须先新增请求侧通道（**改造项**，不在首版）」。**故本口径冲突已实质消除**，仅余「标题与内容措辞不完全一致」这一表述问题（不阻塞开发）。

### M4｜「Gemini 把所有 system 进 `systemInstruction`」的证据强度：Q1 标 `[未证实]`、Q3 当作既定前提

- Q1 §1.3/§4（B1 行）/§7 V1：明确标注「该断言仅来自 NyaaChat 自有规范 §5 line 105，未实测」，并列为**最需要验证的第一项**。
- Q3 **v1** §5.1/§6.1 直接把它当既定前提使用（「P37 的策略正是『前导 system 全量进 `systemInstruction`』」；`identityCard` 落位写「L1 静态前缀（Gemini→`systemInstruction`）」），依据是 `.ref` 报告与 SPreset 专项 §6.2。**✅ v3 已降级使用**：该断言现只作为「**原始观察 / 保真度依据**」保留在 §6.1，落位本身已改 E1-first、**不再依赖它**（详见 §12）。
- **本文的补充事实**：该断言在 NyaaChat **源码注释里也有**——`api.ts:526-534` 写着「Gemini's compat layer additionally hoists ALL system messages into systemInstruction, losing recency」。这提高了它的可信度（它是代码作者主动写下的行为假设，并据此设计了折叠逻辑），但**仍不是实测**。
- **注意一个方法学隐患**：Q3 的 `.ref` 依据（猫神报告 §2.4、SPreset 专项 §6.2）讲的是 **SillyTavern 的 `convertGooglePrompt` 把前导 system 抽进 `systemInstruction`**，那是 ST 客户端侧的行为；把它直接等同于「Google 的 OpenAI 兼容端点也这么做」是**一步额外的推断**，而 NyaaChat 前端 `api.ts:384` 明确是「逐条原样发」。因此 v1 的 L1 落位实际依赖的是「Google 服务端会合并」这一命题，而非 ST 的行为。
- **判定**：本文维持 Q1 的 `[未证实]` 定级（见 §8 U1），并据此把 **A1 列为 P0 第一项前置条件**。**在 U1 验证前，不应把 L1（静态前缀）方案写进实现** —— 不过按 v3 的收敛，首版本来就走 E1，**U1 已不再是首版的阻塞项，只影响 L1 可选退路（V10/V11）**。

### M5｜工具通道的成本量级：Q2「小」、Q1「中等」、Q3「最重」

- Q2 §0.2 表：本地工具源 = 小；工具参数镜像 = 中。
- Q1 §E4：判定「可控，改造量中等」，并列了 4 项代价（含与 MCP 规则注入、白名单、三道门控的冲突）。
- Q3 §5.2：称 `toolChannel` 是「最强但也最『重』」的一项。
- **判定**：三者并不矛盾（Q2 的「小」只指工具源接线，与它自己标注为「中」的参数镜像分开），但**表述粒度不同会让排期误判**。**统一口径**：拆成两件事 —— ①「本地伪工具进工具选项」= 小（Q2 C5）；②「参数回收为正文 + 与 MCP 互斥」= 中（Q2 C4 + Q1 E4 代价 1-3 + Q3 C5）。整体按「中」排期。

### M6｜扩展形态：Q2 判「扩展是构建期资产、无热装」 vs Q3「用户选目标 + 开关」【不矛盾，但需显式说明】

Q3 的开关方案落在**核心代码**（`FlagalacTemplates.ts` / `BypassModal.tsx` / `chatPipeline.ts`），不是扩展；因此与 Q2 的 X5 不冲突。但**必须显式写下**：任何带开关的 Flagalac 能力都要走核心发版，不要设计成「用户装一个扩展就有了」——否则会撞上「无运行时装卸」。

### M7｜证据强度分层（三份报告不等价）

| 报告 | 方法 | 强度 |
|---|---|---|
| **Q2** | 只读源码 + **对 macmini 上运行中容器做只读 HTTP 实测**（`docker ps`、`curl -D -`） | **最高**：唯一带回实测数据的一份（CSP 缺失、CSP 存在的一对反例、路由面确认） |
| **Q1** | 只读源码（12 个 NyaaChat 文件）+ 只读项目规范 + 转引 `.ref` 报告 | 高（源码层面充分），但**无运行时验证**；对 Gemini 兼容层行为标 `[未证实]` 且诚实声明范围 |
| **Q3** | 脚本解析两份预设 JSON（prompts/order/regex/SPreset）+ 只读源码 | 高（预设清单是**机械解析**，可核对；附录 A/B 给全量），但**把若干未实测的行为断言当成既定前提**（见 M4），且对「停止串/预填」的定级偏保守（见 M3） |

**共同缺口（三份都没有的）**：① 任何关于 **Gemini 兼容层服务端行为**的实测（U1/U2/U3 全靠推断）；② 破甲效果的量化数据（§8 末尾的空缺）；③ 对 NyaaChat **输出质量回归**的评估（注入载荷与 RosettaStone 的 `wordCount`/`languageConstraint`、与世界书硬约束共存时的实际表现）。

### M8｜悬空结论（结论有、支撑更弱）

| 悬空项 | 悬在哪 | 处置建议 |
|---|---|---|
| Q1 E3「预填安全性依赖本轮是否有尾 system」 | 该前提由代码推出，但三份报告都没验证「实际使用中尾 system 为空轮次的比例」 | 实现前用 Debug 日志统计一轮（或直接在实现里做成硬约束，不做统计） |
| Q3 §5.2「`traceCleanup` 默认开」 | 默认值依据是「防模型被自己上一轮的合规推理校准」的机理推断，无 A/B 数据 | 按 §8 U10 做 A/B 后再定默认值；首版可先默认开 + UI 可关 |
| Q3 §5.2「`disclaimerSpell` 默认关」 | 机理来源是社区经验（Q3 自注） | 按 §8 U11 验证后再定 |
| Q1 B1 的「4.0test 严重」 | 依赖「Google 兼容层会提升所有 system」这一未实测命题（M4） | 与 U1 绑定：U1 若被证伪，B1 的 4.0test 分级需重评 |
| Q3 的 66 项计数 | 基于两份预设的机械解析，但「体验向条目若干未编号」表明边界有主观成分 | 计数口径已写进 Q3 §0 与本文 §5.1，实现时按「实际暴露的 7 项」为准，不必追求 66 的绝对精确 |

### M9｜Q3 报告内部的落位自相矛盾：§5.2 把 `identityCard` 放 L1，§6.1 却说「P4 目标载荷放 L2」

- Q3 **§5.2 表格**：`identityCard`（目标 = `gemini25pro31pro`）的落位列写「**L1 静态前缀**（Gemini→`systemInstruction`）」；同一张表的 `refusalImmunity` 写「L1 或 L2（见 5.3）」。
- Q3 **§6.1 关键映射结论**：「**P4（gemini2.5pro & 3.1pro）**：… ⇒ **P4 目标载荷放 L2**」。
- 同一目标在两处被指到不同层，**字面直接冲突**（此前 Q1/Q2 均未涉及，故 M1–M8 未覆盖）。
- **本文裁定**：这不是单纯的笔误，而是「载荷」一词在 Q3 里同时指了两类东西：**人设/身份类**（对应 P4 的 `enhanceDefinitions`，Q3 附录 A.1 `order#3` 标注 `sys`，即预设自身就当 `system_prompt` 用）与**破甲结构/规则类**（对应 P4 的 `main`（`order#0`，P4 刻意设为 `role=user`）、`jailbreak`、`防截断` 等）。Q1 的 B1 判定（「4.0test 需要把首条改成 user 才能旁路 `systemInstruction`」）说的是**后者**，所以两者可以同时为真 —— 但 Q3 没有做这个区分。
- **处置**：实现前必须把「载荷」显式拆成两类（§12.3 已据此给出推荐）。**在 Q3 未澄清前，不得直接引用 §6.1 那一行作为落位依据。**
- **✅ 后续状态（Q3 v2/v3 已自行修正，本项结案）**：v3 §5.1 的落位列已把 `identityCard`/`dualModelCard` 全部改为 **E1 动态尾部独立新块**（L1 仅标注为「可选增强，代价见 §6.4-K1」），§6.1 的「按目标分流」也改为「**P37 目标同样落 E1**」并在 §6.4 显式记录 K1 冲突与收敛过程。⇒ 该自相矛盾**已消除**；保留本节作为「曾存在该冲突、v2 如何收敛」的记录（captain 指令要求保留过程）。

### M10｜Q3 承诺「§5.3(a) 不暴露清单与 §6.1 落位条件依赖 Q1/Q2 结论」，但未实际兑现

- Q3 §5.3(a) 标题与之下的说明、以及 Q3 报告末尾声明，都写明这些结论「有待 Q1/Q2 结论校验」。
- 经本文逐条对着 t1/t2 复核（**§9.9 全表**）：**多数可复核成立**，但有 **2 条不成立**（停止串、assistant 预填被误定为「不可实现」，实为 Q1/Q2 的「小改可补」）、**1 条口径需修正**（reasoning 预填与 assistant 预填被并为一条，实际前者不可行、后者有替代落点）、**1 条无法完全复核**（L1/L2 落位依赖未实测的 U1 与 M9 的澄清）。
- **处置**：见 §9.9 表格的「复核结果」列；其中标记「不成立」的两条已按 Q1/Q2 口径修正（见 §9 M3），并转为 §7 P0 的 A3 产品决策项。

### 9.9 对 Q3 条件依赖的逐条复核（captain 指令：对着 t1/t2 复核后再写入结论）

> 复核方式：逐条把 Q3 的论断与 Q1/Q2 的对应判定并列；「可复核成立」= 与 Q1 或 Q2 的判定一致且证据可查；「部分/不成立/无法复核」= 已在「复核结果」列写明差异与处置。

| # | Q3 论断 | 位置 | 对 Q1/Q2 的依赖 | 复核结果 |
|---|---|---|---|---|
| 1 | 伪 JSON 会话伪造（`<end>"},{` / `<|check|>` / 角色标记→JSON）不可实现 | §5.3(a) | Q1 B5 | **可复核成立**（Q1 判致命冲突：无出站重写层 + 违反标准 §2/§7.1/§7.2 + 前缀缓存全废） |
| 2 | 世界书搬运不可实现 | §5.3(a) | Q1 附加判定 | **可复核成立**（Q1 判严重：依赖 placement=5 包裹 + 需要 B5 的重写层；且 NyaaChat 世界书无「最近 N 条/更早」分层） |
| 3 | 绝对注入 depth=0 不可实现 | §5.3(a) | Q1 B3 | **可复核成立**（Q1 判严重：装配层没有 depth/absolute 语义；尾部已有唯一 system）。**✅ v3 已更正表述**：改为「有注册位（`compat/stContext.ts:67`）但无消费点（`:79`）⇒ 现成未接线、需小–中改造」；且即便接线也只能并入 E1 新块（见 §5.4(a)/§5.5） |
| 4 | 「assistant 预填 / reasoning 预填」不可实现 | §5.3(a) | Q1 B4 + §2.5 | **部分不成立**：assistant 预填在 Q1 是**「严重但有可行替代落点」**（E3 写法 B），并非不可实现；**reasoning 预填确不可行**（无 reasoning 载体，Q1 §2.5 / Q2 §3.9）。Q3 把两者并为一条 ⇒ 需拆开，见 §9 M3。**✅ v3 已软化**：改为「若将来真要预填，须先新增请求侧通道（改造项，不在首版）」 |
| 5 | 停止串 `<end>` 不可实现 | §5.3(a) | Q1 B7 + Q2 §3.8(8a) | **不成立**：Q1 判**可控（小改可补）**、Q2 判**需改造（小）**（请求体加 `stop`/`stop_sequences`）。属产品决策而非技术阻塞 ⇒ §9 M3、§7 A3。**✅ v3 已软化**：明确「即便实现也只能是**全局设置**、不做成 per-target 开关，并会截断正文中出现的该串」（**这一条是 v3 新增的实质结论，本文已吸收进 §5.4(a) 与 §12 之外的成本说明**） |
| 6 | 原生思考开关（`show_thoughts`/`reasoning_effort:high`）不做 | §5.3(a) | Q1 §2.5 + Q2 §3.9 | **可复核成立**（Q2 判「需改造（小–中）」且明确属 `api.ts` 技术内核改造、不是 Flagalac 开关） |
| 7 | 工具层三件套（无缝循环/回合合并/置底）归 Q2 | §5.3(a)/D-01~D-04 | Q2 M5 | **可复核成立**（Q2 判无缝循环「中–大」，并**建议一期不做**） |
| 8 | `identityCard`/`dualModelCard` → L1；其余载荷 → L2，且 P4→L2 / P37→L1 | v1 §5.2 / §6.1（**v3 已改为 §5.1 全 E1 + §6.4-K1**） | Q1 B1 + **未实测的 U1** | **v1 时无法完全复核且内部冲突**：(a) 未区分「人设载荷 vs 破甲结构载荷」⇒ §9 M9；(b) P37 半边建立在未实测断言 U1 之上（§9 M4）。**✅ v3 已收敛**：全部载荷改落 **E1**，L1 降为可选增强并要求 **V10/V11** 通过才启用 ⇒ 该行结论已可复核（E1 侧只依赖 Q1 硬约束 3，不依赖 U1） |
| 9 | `toolChannel` 需 Q2 结论支持、未就绪时 UI 置灰 | §5.2 | Q2 M3/M4b + C4/C5 | **可复核成立**（Q2：工具循环已具备，但「参数=正文」需中改造，且与 MCP 工具争抢同一批 `tool_calls`） |
| 10 | `traceCleanup` 零改造即可生效 | §5.2 | Q2 M7 | **可复核成立**（正则引擎为 ST 忠实移植，`engine.ts:20-26, 188-225`） |
| 11 | `unicodeEncoding` 需响应侧解码 | §5.2 | Q2 M4a | **可复核成立**（`onChunk` 是逐块回调，加 stateful 解码器即可） |
| 12 | `disclaimerSpell` 必须与正则「防截断隐藏」成对 | §5.2/§5.4 | Q1 E7 + Q2 M7 | **可复核成立**（输出侧 `AI_OUTPUT` placement=2 正则已具备）。**本文补充一个实现注意**：按 Q1 E7 的顺序陷阱，prompt 侧正则只作用于历史/最新 user/世界书，且在装配前段执行（`chatPipeline.ts:363-398`）⇒ 若改写层新引入标记，本轮正则不会处理它，「成对」只覆盖输出侧 |

**无法复核的项（已按要求标注）**：**经 Q3 v3 修订后，本表的 12 行已全部可复核或已结案**。唯一仍然悬空的不是一个"论断"，而是一个**事实**：§8 U1（Gemini 兼容层是否把所有 system 提进 `systemInstruction`）——三份报告均无实测，本文无法通过阅读源码判定，**必须实测或多方印证**。它现在只影响 **L1 可选退路（V10/V11）**，**不再影响首版落点**（首版 E1-first 只依赖 Q1 硬约束 3）。

### 9.10 Q3 版本演进记录（v1 → v2 → v3）与 K1

> captain 指令：Q3 已就地修订；汇总需记录「冲突曾经存在、如何收敛」。**注意：captain 转达的是 v2，实际文件头含 v2 与 v3 两段修订说明（本文以实际读到的 v3 为准）。**

| 版本 | 触发依据 | 主要改动 | 对本文的影响 |
|---|---|---|---|
| **v1**（本文最初读到的版本） | 无（初版） | 落位主线为「**P4 → 动态尾部 L2；P37 → 静态前缀 L1**」；§5.2 把 `identityCard` 放 L1 而 §6.1 又说「P4 载荷放 L2」（内部不一致，即 §9 M9）；§5.3(a) 把停止串/预填写作「做不了」 | 本文初版据此写出「两方案并列对比 + 推荐」，并按「人设类可进前缀」提出折中 —— **已被后续版本取代** |
| **v2** | captain 转达的 **Q1 硬约束 §4/§6/§8** | ① TL;DR 第 4 条改为 **E1-first**；② §5.1 落位列全部改 E1；③ **新增「载荷文本裁剪」要求**（原生思考专属子句删除、`<think_nya~>` 文本标签替代、与 `traceCleanup` 成对）；④ §6.2 补「锚点**无条件**写入」；⑤ §5.3(a) 补「停止串即便实现也只能是**全局设置**」；⑥ **新增 §6.4「与 Q1 七条硬约束的对齐」，其中显式声明冲突 K1**；⑦ 新增 §9 V10/V11；⑧ C7 改为 E1-first | 本文 §5.2/§5.5/§12 全部改写；新增 §5.10 吸收 v2 要点 |
| **v3** | captain 转达的 **Q2 接口 §C1–C10 / §X1–X6 / §V1–V7** | ① `toolChannel`/`traceCleanup` 行 + §5.3(a) 工具通道/停止串/位置类/预填行按 Q2 改写（统一标注「**依赖改造，非开箱即用**」）；② **修正 v1/v2 的一处表述不准确**：位置类**不是「无通道」，而是「有注册位无消费点」**（`compat/stContext.ts:67` 注册 / `:79` 读取，全仓零消费）；③ 新增 §6.5「与 Q2 六条接口的对齐 + 改造前置项归并 **M1–M5**」；④ 新增 §9 **V12**（`max_tokens:4096`）；⑤ §10 前置项改写 | 本文 §4.4/§5.4(a)/§5.10/§8 相应更新；**v3 未发现与 Q2 的实质冲突**（仅 1 处表述修正） |

**K1（唯一实质冲突）记录**：v1 基于「通道保真度」建议 **P37 的 `dualModelCard` 落 L1 静态前缀**（依据：P37 脚本把全部前导 system 合成唯一 system 消息 → 进 `systemInstruction`，SPreset 专项 §6.2 有源码级证据）；但 **Q1 硬约束 3 要求"避免设计会改变静态前缀的开关"**（静态前缀必须跨轮逐字节稳定，标准 §7.1/§7.4；`chatPipeline.ts:436-441` 注释同义）——载荷落在前缀时，用户一旦切换目标/开关/编辑文本，**整段前缀缓存即失效**。**v2 的收敛决定**：全部 7 个载荷默认落 **E1**，理由 ① 遵循 Q1 唯一推荐落点；② E1 位于缓存断点②之后，改载荷只影响尾部字节；③ 破甲机理的主因是**文本内容与角色语域锚定**，而非 system 通道特权（猫神报告 §7.3/§7.4）。**保留的退路**（仅在 V10 验证支持时启用）：在同一目标粒度上增加「通道保真模式」选项，但必须 ① 默认关；② UI 明示「切换将使整段前缀缓存失效（仅手动切换时发生一次）」；③ **绝不允许每轮动态变化**；**不在首版范围**。

---

## 10. 本次考察范围与声明

> 本章为考察声明（原第 10 章）。**其后的 §11「既有缺陷与优先修复」与 §12「载荷落位对比与推荐」是收到 captain 指令后增补的两个独立章节** —— 两者是「开发启动前必读」，位置放在文末仅为避免对前文交叉引用重新编号，请按 §1 的必读指引跳转阅读。

1. **本次考察（含三份来源报告与本文）未修改 NyaaChat 任何业务源码**：没有新增 / 修改 / 删除任何 `src/`、`public/`、`nginx.conf`、`docker-compose*.yml`、`package.json` 或数据文件；`.docs/` 下的四份 markdown 是唯一写入物。
2. **对运行环境只做只读操作**：Q2 在 macmini 上仅执行 `docker ps` 与 `curl -D -` 两类只读命令。
3. **工作树既有未提交改动的归属**：`src/App.tsx`、`src/components/BypassModal.tsx`、`src/lib/settingsBackup.ts`、`src/types.ts`（已修改）与 `src/lib/FlagalacTemplates.ts`（未跟踪）属**此前 AnswererFlagalac 界面轮次**的产出，本次考察未触碰。
4. **事实与推断的边界**：本文所有 `[事实]` 均给 `文件:行号` 或实测记录；凡源码/配置/实测查不到的（尤其 Gemini 兼容层的服务端行为、JSR iframe 的实际形态）一律标 `[推断]` / `[未证实]` 并给出验证方法（§8），**未作无证据猜测**。
5. **scratch 报告的保留决定**：**保留** `.docs/_agentteams/` 三份报告（实测合计 371 + 416 + 723 = **1510 行**，非空 1216 行）。理由：Q1/Q2/Q3 各自带有**本文无法完整复现**的证据索引（Q2 的 macmini 实测命令与输出、Q3 附录 A/B 的两份预设 `prompts[]`/`regex_scripts[]` 全量核对表）与逐项 `文件:行号` 映射；后续实现时（尤其 §7 的 P1/P2 批次与 §12 的落位决策）需要按行号回源。若在实现完成、证据被吸收进代码注释与交接文档后再删除，成本更低。
6. **本文的结论效力**：§1 速览、§3–§5 的结论与分级、§11 的既有缺陷、§12 的落位对比可直接作为开发依据；§6 的推导链、§7 的前置条件、§9 的矛盾裁定与 §9.9 的复核表为**整合层判断**，其中明确标注为「本文建议」的（§9 M1 折中方案、M3 口径修正、M5 拆解口径、§12.3 的落位推荐）尚需负责人确认；§9.9 第 8 条（P37 落位）标为**无法复核**，须实测。
7. **本次追加修订（两轮）**：第一轮（captain 指令）增补 **§11**（既有缺陷，R1 首位）、**§12**、**§9 M9/M10 + §9.9**；第二轮（captain 告知 Q3 已修订、**实际文件为 v3**）按 v3 更新 **§1 / §5.2 / §5.4(a) / §5.5 / §5.9 / §5.10 / §6.1 / §7 A5 / §8（新增 U20–U22，更新 U8）/ §9 M3·M9 状态 + §9.10 / §12 全章改写 / 文档头行数与版本说明**。其中 R1 全链路、R2 四条 identifier、R3–R5 三项均由本文作者**独立回源复核**（见 §11 各表证据列）；Q3 v3 的修订内容按**实际读到的文件**吸收（captain 传达的「v2」与实际文件的「v2+v3」差异已在文档头与 §9.10 标注）。对源码仍然**只读**，未修改任何一行业务代码。

---

## 11. 既有缺陷与优先修复（R1 置于首位）

> **状态更新（captain，本轮）**：**R1 已修复**，修复方式为「模块整体退役」而非局部打补丁 —— 见 commit `ba55ca9`（`refactor(bypass): retire ClavisSalomonis, add AnswererFlagalac selector UI`）：删除 `lib/bypassTemplates.ts` 与其在 `chatPipeline` 的调用点、从 `BypassSettings`/`DEFAULT_SETTINGS` 删除相关字段、`SCHEMA_VERSION 9→10`（`migrateV9ToV10` 清除存档死键）、导入路径（`EXPORT_VERSION 7→8`）同步剥离退役键。功能验证：v7/v8 备份导入后退役键全部消失、合法字段（`opusChecks`/`wordCount`/`languageConstraint`/`answererFlagalac`）保留、导出 `_version=8` 且不含退役键（10/10 通过）。下述 R1 描述保留为**缺陷历史记录**；R2–R6 仍待处理。

> **本章依据 captain 指令单列**，且**不**沉进 §5（Q3）章节。R1 已由 captain 亲自复核并确认「爆炸半径比 Q3 报告写的更大」；本文作者**另行独立回源复核**了 R1 的全链路、R2 的四条 identifier，以及 Q2 记录的另三项断线/配置类问题（R3–R6）。
>
> **这些缺陷与 AnswererFlagalac 模块本身无关，但会被本模块的落地放大**，因此排序上先于 §7 的 P0/P1 —— 修 R1 是 §7 的 P1 首项，且是唯一一条「不修就会让新功能产生用户可见错误」的既有缺陷。

### R1（最高优先）｜已下线的 ClavisSalomonis 可被「导入一份旧备份」静默复活，且 UI 无法关闭

**症状**：用户导入一份在 v7→v8 迁移之前导出的设置备份后，会在**完全无感知、界面上也没有任何开关**的情况下，此后每一轮请求都被注入整套 ClavisSalomonis 模板（`identityReset` / `scenarioFramework` / `aiSelfPersuasion` / `roleplayInduction` / `safetyStatement` / `creativeGuidance` / `disclaimer` 共 7 条），插入位置是**静态前缀 index 1**。

**证据（本文已逐处回源复核，行号以本次读取为准）**

| 环节 | 事实 | 位置 |
|---|---|---|
| 注入仍然真实存在 | `if (!settings.bypass.enabled) return messages;` —— 只有这一个门；通过之后依序注入 7 条模板并 splice 到 index 1（首条为 system 时） | `src/lib/bypassTemplates.ts:38`、`:63-69`、`:72-78` |
| UI 已整块下线 | ClavisSalomonis 区块被 `{/* … */}` 整段注释；**唯一的启用/关闭控件就在注释体内** | `src/components/BypassModal.tsx:467-610`（开关本体 `:479` `checked={localSettings.bypass.enabled}`，门控内容 `:486`） |
| 迁移只在加载路径触发 | `migrate()` 按 `raw._version` 逐级执行；v7→v8 分支把 `bypass.enabled` 强制 `false`，但**只在 `_version < 8` 时**执行 | `src/App.tsx:85-115`（读版本 `:87`；v7→v8 分支调用 `:107-109`）、`migrateV7ToV8` `:123-131` |
| 导入路径**不经过** migrate | 导入确认后直接 `onSave(pendingImport)`（`SettingsModal.tsx:174-177`）→ `handleSaveSettings`（`App.tsx:753-757`）以 `{ _version: SCHEMA_VERSION(9), ...newSettings }` 落盘 | `src/components/SettingsModal.tsx:174-177`、`src/App.tsx:753-757`（`_version` 写入 `:756`；`SCHEMA_VERSION = 9` 见 `:83`） |
| 导入回填**从不触碰** `enabled` | bypass 回填段只补 `opusChecks` / `wordCount` / `languageConstraint` / `answererFlagalac`，`bp` 取出后**没有任何一处设置 `bp.enabled`** | `src/lib/settingsBackup.ts:419-468`（`bp` 取出于 `:424`，AnswererFlagalac 回填 `:455-468`） |
| 之后的加载不再救 | 落盘时 `_version` 已是 9 ⇒ 下次加载 `v = 9` ⇒ 所有 `v < 8` 分支都不执行 | `src/App.tsx:87, 107-109` |

**可复现步骤**

1. 准备一份 `_version < 8` 且 `bypass.enabled: true` 的导出备份（v7 及更早的存档；或手工把任意备份 JSON 的 `_version` 改为 `7`、把 `bypass.enabled` 改为 `true`）。
2. 打开设置 → 导入备份 → 确认导入（走 `SettingsModal` 的 `handleConfirmImport`）。
3. 重新加载页面（`nyaachat_settings` 里的 `_version` 此时已被写为 9）。
4. 打开绕过弹窗（BypassModal）：**ClavisSalomonis 区块不可见、无任何开关**；但每轮请求的静态前缀里都带着那 7 条模板（可在请求日志中核对）。
5. 再次刷新仍复现 —— v7→v8 迁移**永远不会再执行**。

**影响**

1. **静默提示词注入**：用户以为自己没开任何绕过设置，实际每轮都在注入。
2. **无法从 UI 关闭**：唯一控件被封在注释块内（`BypassModal.tsx:479, 486`）。
3. **与本模块叠加**：本模块将来的 `disclaimerSpell`（默认关）所用的猫神 P4「防截断」载荷，与 `bypassTemplates.disclaimer` 的**首行逐字相同**（Q3 C1；`bypassTemplates.ts:26-29`）⇒ 会出现**两份伪 disclaimer**，其中一份用户关不掉。
4. **可观测性差**：用户上报「行为诡异」时，排查成本极高（现象与开关状态不符）。

**最小修复方向（二选一，建议同时做 —— 「语义对齐 + 防御性冗余」）**

- **修复 A（推荐，语义对齐）**：在 `settingsBackup.ts` 的 bypass 回填段（`bp` 取出之后，即 `:424` 之后）补一行，使导入与加载两条路径行为一致：
  `if (typeof bp.enabled !== "boolean") bp.enabled = false;` 并**无条件** `bp.enabled = false;`（对齐 `migrateV7ToV8` 的语义），同时加注释说明「该模块 UI 已下线，导入时强制失效；若日后恢复 UI 需同步移除本行」。
- **修复 B（防御性冗余）**：让 `injectBypassPrompts`（`bypassTemplates.ts:38`）在 UI 下线期间直接 `return messages`（例如引入 `bypass.uiRetired` 或直接注释掉该注入），使「静态前缀注入 ClavisSalomonis」在模块恢复 UI 之前**不可能发生**。
- **不推荐**把「恢复 UI」作为首选：那等于把已被判定的旧机制重新暴露给用户，属产品决策，须用户拍板。

**为何排在 AnswererFlagalac 之前**：见影响第 3 点 —— 本模块与 R1 的载荷存在逐字重合并共享同一个「静态前缀 + 尾部」装配面。**不先修 R1，就会交付一个「用户一开我们的开关，实际注入两份、其中一份他自己关不掉」的功能。**

### R2｜同一 identifier 在两份预设里内容/**角色**不同

**事实（本文独立复核：直接用 PowerShell 解析两份 JSON 的 `prompts[]` 并逐条取出对比）**

| identifier | P4（`【小猫之神】4.0test.json`） | P37（`小猫之神3.7f版本Reborn2.2-preview_1.json`） |
|---|---|---|
| `2f2729f4-5d93-4268-a242-165a9c894e60` | name=防截断，内容为 `<disclaimer_format>` 免责声明咒语 | name=防截断，内容为 `<censorship_bypass>` 编码规则（**内容不同**） |
| `3df19ba7-b44d-4d46-b17a-de514d86e5d5` | name=瞬发防输入截断，**role=user**，内容 `{{\// 秒空回时候打开…}}<\|sep\|><ctrl100>` | name=世界书设定捏，**role=system**，内容 `[World Settings]`（**名称与角色都不同**） |
| `91918c0a-bfc6-4101-9796-5421aab6fae8` | name=别关，role=assistant，`<think_nya~>` 喵呜——好！系统指令 | name=别关，role=assistant，`<\|no-convert\|>`（**内容不同**） |
| `820a1944-b386-4beb-b8ac-5627a965bd5b` | name=别关，`<\|check\|>` | name=别关，继续上文创作（**内容不同**） |

**影响**：任何「按 identifier 取预设原文」的映射表（无论落到代码常量、文档表格还是 UI 文案）**必须带 preset 维度**，否则会**静默张冠李戴**。其中 `3df19ba7` 最危险 —— 它不仅内容不同，**连 role 都不同**（P4 是 `user` 的瞬发指令、P37 是 `system` 的世界书设定），一旦取错会同时污染角色与内容。

**最小修复方向**：载荷常量一律以 `<preset, identifier>` 复合键组织（**目标 id 本身就是天然的 preset 维度**，例如 `identityCard` 只属于 `gemini25pro31pro` 目标、`dualModelCard` 只属于 `gemini37flash` 目标，天然避开了这个坑）；代码层禁止出现「仅按 UUID 查表」的接口，并在 §7 B5 落实为编码约定。

### R3–R6｜另三项既有问题（严重度低于 R1/R2，但会影响本次落地）

| 编号 | 问题 | 证据（本文 grep/阅读复核） | 影响 | 建议 |
|---|---|---|---|---|
| **R3** | 扩展事件总线存在「只声明不发射」的死线 | `src/compat/events.ts:31-32` 声明了 `GENERATION_STARTED` / `GENERATION_ENDED`，但全 `src/**` **无任何发射点**（本次 grep 仅命中这两行声明） | 无缝循环 / 生成结束回调无处挂载（对应 Q2 M5 与 C10） | 需要时与续写入口一并补发射点；**不要**做成「先挂监听、指望它会被触发」 |
| **R4** | 位置注入通道有注册位但**从未被消费** | `getExtensionPrompts` 在 `src/**` 中**仅** `src/compat/stContext.ts:79` 一处定义（本次 grep 复核），零消费点 | 「absolute depth=0 / 置底」类机制**看起来有接口、实际完全无效** | 若将来要做位置类选项，**先接线再挂 UI**（顺序不能反，同 Q3 C6） |
| **R5** | 主文档 CSP 因 nginx `add_header` 继承缺陷而**实际缺失** | `nginx.conf:41` 声明了严格的 `script-src 'self'`；但 `nginx.conf:75-79` 的 `location = /index.html` 自带 `add_header`，抑制了 server 级继承；Q2 在 macmini 实机测得主文档**无 CSP**、而同源静态子文档**有 CSP** | 当前「`eval` 路线可用」是**配置未按意图生效**的结果；任何修 CSP 的顺手动都会打断它（Q2 §1.3(b)、§3.2） | 明确策略：**不把 `eval` 作为功能承载**（本次 grep 复核 `src/**` 的 `eval(` / `new Function(` 命中数为 **0**），改走正则 / 受限 JSON / 构建期扩展（同 §4.7） |
| **R6** | AnswererFlagalac 现有 UI 用一句通用占位掩盖全部未实现状态 | `src/components/BypassModal.tsx:389-393`：「当前版本仅提供界面，对应的绕过逻辑尚未接入。」 | 若开关组/置灰/冲突提示沿用该写法，用户无法判断哪些选项真正生效（Q3 §6.3 已要求按选项给出具体原因） | 实现时**逐选项**给出未就绪原因，不要复用通用文案 |

**说明**：Q2 另记录了一项 Anthropic 路径 `max_tokens` **硬编码 4096**（`api.ts:859`）。它是**能力上限**而非缺陷（可通过配置化解决），因此不列入本章，归入 §4.4 附加行与 §8 U13。

---

## 12. 载荷落位：K1 冲突、E1-first 收敛与 L1 可选退路的代价门槛

> **本节按 captain 指令改写（两阶段）。** Q3 已就地修订（captain 传达为 v2；**实际文件已含 v3**）并**自行收敛**了落位分歧 —— 因此**本节不是"两个互斥方案待选"**，而是记录 **① 冲突曾经存在（K1）**、**② v2/v3 如何收敛为 E1-first**、**③ 保留 E1 vs L1 的代价对比与验证门槛（V10/V11）**、**④ 本文对收敛结论的保留性再挑战（§12.6）**。
>
> **本文的立场（避免两处并存互相矛盾，此为准）**：
> - **实施基线 = E1-first**（7 个载荷全部落唯一尾 system 的独立新块），与 Q3 v3 **完全一致**，无分歧；
> - 本文**仍保留一处再挑战**（§12.6）：**「身份/人设类」载荷**（`identityCard`/`dualModelCard`）是否应改走静态前缀 —— 它**不改变基线**，而是：① 若 L1 门槛（V10/V11）通过，它是 L1 的**首选内容与优先级依据**；② 若未通过，它作为**已知的、需用户拍板的决策点**留档。
> - 因此：**§5.5 落位表、§5.2 落位列、§1 速览**给出的落位结论与本节一致（E1-first），**分歧只出现在 §12.6 并已显式标注**。

### 12.1 冲突记录（K1）：v1 的「P37 → 静态前缀」vs Q1 硬约束 3

- **v1 的主张**：`gemini37flash`（P37）的载荷落 **L1 静态前缀**，以复刻 P37「把全部前导 system 合并成唯一 system 消息 → 进 `systemInstruction`」的通道策略（SPreset 专项 §6.2 有源码级依据）。同一目标在 v1 的 §5.2 里 `identityCard` 又被写成 L1，而 §6.1 总结为「P4 载荷 → L2」—— 这是 v1 的内部不一致（§9 M9）。
- **冲突来源**：Q1 硬约束 3 要求「**避免设计会改变静态前缀的开关**」（静态前缀必须跨轮逐字节稳定，标准 §7.1/§7.4；`chatPipeline.ts:436-441` 注释同义）。只要载荷落在前缀，**用户切换目标/开关/编辑文本就会让整段前缀缓存失效**；再叠加标准 §7.6「同类条目按用户顺序、不做二次排序」，前缀类载荷还会与 persona / 世界书抢位置。
- **冲突性质**：**通道保真度（效果）** vs **缓存稳定性（成本）** 的取舍，且「效果」一侧依赖**三份报告都未实测**的 U1（§9 M4）。Q3 v3 §6.4 把它记为 **K1**，自述为「本报告与 Q1 的唯一实质冲突」。

### 12.2 v2/v3 的收敛：E1-first

**收敛决定**：全部 7 个载荷（**含 `dualModelCard`**）默认落 **E1 = 唯一尾 system 的独立新块 `<answerer_bypass target="…">`**（= Q3 的 **L2**；**落位细分见 §5.5**：`toolChannel` 实走 L4、`traceCleanup` 实走 L5）；**L1 静态前缀降级为「可选增强」** —— 默认不用、**不在首版范围**，且必须 **V10 + V11 通过**后才可启用。收敛理由三条（Q3 v3 §6.1）：

1. 遵循 Q1 的唯一推荐落点（硬约束 3）；
2. E1 位于**缓存断点②之后**，改载荷只影响尾部字节，历史前缀缓存继续命中（成本更低）；
3. 破甲机理的**主因是文本内容与角色语域锚定**，而非 system 通道特权（猫神报告 §7.3/§7.4：身份替换优于指令否定、决策点消除）。

### 12.3 保留的代价对比（E1 vs L1；供 V10/V11 判定后决策）

| 维度 | **E1**（首版基线；Q3 的 L2） | **L1**（可选退路「通道保真模式」；默认关） |
|---|---|---|
| **前缀缓存 / 成本** | **优**：不触碰静态前缀；开关切换/文本编辑只改尾部字节（`chatPipeline.ts:434-441` 前缀逐字节不变） | **差**：载荷进静态前缀 ⇒ 每次改开关/编辑载荷都翻转前缀字节、**一次性击穿整段前缀缓存**（标准 §7.4；Q3 C7）。须严格保证「只在用户改配置时变一次」，任何每轮可变内容（世界书、时间、检索结果）不得进 L1 |
| **权威层级** | Gemini 上是 **user 通道**，权威靠 `SESSION_PROTOCOL_ANCHOR` 委托（`chatPipeline.ts:310-314`） | 理论上是 **`systemInstruction` 高权威通道** —— 但**生效完全依赖未实测的 U1**（§9 M4；Q1 标 `[未证实]`） |
| **近因** | **最高**：载荷贴生成点（折叠后成为最新 user 的 volatile part，`api.ts:87-94`） | **丢近因**（被拽到请求最前） |
| **每轮可变性** | 载荷随配置恒定；但要处理「尾块为空时整条尾消息不存在」的边界（`chatPipeline.ts:520-523`）⇒ 让「本模块启用」本身成为产出尾 system 的条件 | 静态前缀天然恒有；同样要处理尾块边界 |
| **与锚点耦合** | 新块名**无条件**写进 `SESSION_PROTOCOL_ANCHOR` | **同样必须**（锚点本身也在静态前缀里；L1 块若不声明就成了「无授权来源」的 system 块） |
| **实现改造量** | **最小**：`chatPipeline.ts:496-523` 内一次 `blocks.push` + 锚点补一句；两条 provider 路径行为一致 | **中等**：需按目标决定改装配哪一段（前缀 vs 尾部）⇒ 两条落位分支 + 各自边界处理，且须先过 V10/V11，免得做了无效改造 |
| **对不变量风险** | 零（不触碰 `api.ts`、不触碰静态前缀） | 触碰 X4（缓存前缀稳定性，§4.6），测试面更大 |

### 12.4 验证门槛与拍板条件

**启用 L1（通道保真模式）的门槛 —— 三条全部满足**：

1. **U20 / Q3 V10**：A/B 实测证明 E1 与 L1 的破甲效果**有显著差异**（拒绝率 / OOC 率），且 L1 一侧的 **usage cached tokens** 代价可量化、可接受；
2. **U21 / Q3 V11**：实测确认「切换目标/开关时 E1 载荷**只改尾部字节**、静态前缀**逐字节不变**」—— 这既是 E1-first 成本结论的前提，也是将来 L1 模式 UI 文案的事实基础；
3. **U1** 至少取得可信证据（实测或多方印证），否则「L1 有更高权威」这一收益本身不成立。

**启用 L1 时的强制约束**（Q3 v3 §6.4-K1 原文要求）：① 默认关；② UI 明示「切换将使整段前缀缓存失效（仅在你手动切换时发生一次）」；③ **绝不允许每轮动态变化**；④ 不在首版范围。

**⚠️ 仍需用户拍板的情形**：若出现 **「U1 无法证实（渠道不透明、抓包不可行），但实测又显示载荷在 E1 / user 通道下效果明显不足」** 的组合 —— 即必须在**未验证的通道行为**上押注才能拿到效果 —— 是否启用 L1 退路**不能由实现者单方面定**，须由用户/负责人拍板。此即 §7 P0 的 **A5**。

**结论（一句话）**：**首版按 E1-first 实施；L1 只是记录在案的、带代价与门槛的可选退路，不是并行候选方案。**

### 12.5 与 Q1/Q3 其余结论的一致性检查

- E1-first 与 Q1 硬约束 1/2/3 全部一致（不新增尾 system、不在尾后追加消息、锚点无条件恒定）。
- E1-first 与 Q3 v3 §5.1（全部载荷 E1）、§5.2（落位通道内置固定）、§6.1（编号对照 **L2 = E1**）、§6.4（K1 收敛）**一致**。
- **首版不需要 U1 成立即可实施**（E1 只依赖 Q1 硬约束 3）—— 这是 E1-first 相对 v1 方案最重要的工程收益。
- 仍存在的**表述残留**：Q3 v3 §5.3(a) 的标题仍写作「当前无通道 / 不可实现」，而行内容已软化为「改造项 / 不做成 per-target 开关」（§9 M3 已标注为表述问题，不阻塞开发）。
- **全文一致性（落位口径）**：§1 速览 Q3 段、§5.2 七开关表落位列、§5.5 落位表与关键映射结论、§6.2 推导链、§8 U1/U20/U21、§9 M9/M10/§9.9 第 8 行、§10 声明 —— 均按 **E1-first** 表述，**不存在与本节冲突的落位结论**。

### 12.6 对 Q3 v3 收敛结论的再挑战（本文保留的分歧点，须用户拍板）

> 依 captain 指令，本节**显式保留**本文与 Q3 v3 的唯一分歧点，**不以"已被取代"结案**。它不推翻 §12.2 的实施基线，只要求把它作为**待拍板项**留档。

**挑战命题**：**「身份/人设类」载荷**（`identityCard`、`dualModelCard`）是否应与其余载荷分开，改走 **L1 静态前缀**（其余 5 项仍留 E1）。

**本文的三条理由**：

1. **预设自身的分层就是这样的**：这两项对应两份预设的 `enhanceDefinitions`，而该条目在预设里标注了 **`system_prompt: true`**（Q3 附录 A.1 `order#3`、A.2 `order#2`）—— 即预设作者本人把它当 system 层内容使用，与 P4 刻意设为 `role=user` 的 `main`（`order#0`，破甲结构类）**不是同一类东西**；
2. **身份类文本走系统通道更贴合预设原意**：它的作用是身份隔离与角色语域锚定，属"设定"而非"贴生成点的指令"；放进尾部 user 通道后，它与"用户当轮发言"同层，理论上更容易被模型按"用户注入"处理；
3. **不引入对未实测断言的依赖**：「更靠前、且被标为 system」与「Gemini 把所有 system 提进 `systemInstruction`」是两件事 —— 前者不依赖 U1 成立。

**必须同时写明的代价（这是它不能成为基线的原因）**：

- **缓存**：载荷落静态前缀 ⇒ **用户每次切换目标 / 开关 / 编辑文本都会一次性击穿整段前缀缓存**（标准 §7.1/§7.4；Q3 C7），而 E1 只改断点②之后的字节；
- **锚点同层**：`SESSION_PROTOCOL_ANCHOR` 本身就在静态前缀里，L1 载荷与它同层 ⇒ 锚点**必须声明该块**（否则该 system 块"无授权来源"），且锚点文本仍需无条件恒定（`chatPipeline.ts:436-441`）；
- **与 persona/世界书抢位置**：同类条目按用户顺序、不做二次排序（标准 §7.6），L1 载荷会与 persona / 永久世界书争夺前缀位置；
- **收益未证实**：其"更高权威"的收益完全落在**未实测的 U1** 上（§9 M4）。

**⚠️ 定位与拍板要求**：

- 它**不是**与 E1-first 并行的第二套基线 —— 首版一律按 E1-first 实施，本挑战**不阻塞任何开发**；
- 它与 §12.4 的 L1 门槛**同源**：若 V10/V11 通过并决定启用 L1，则**本挑战给出的"身份类优先"应作为 L1 的内容与优先级依据**；若门槛未通过，本挑战只作为留档；
- 若出现 **「U1 无法证实，但实测显示身份类载荷在 E1/user 通道下明显不足」** 的组合，则须**用户/负责人拍板**（= §7 P0 的 **A5**），实现者不得单方面在未验证的通道行为上押注。

### 12.7 §12 与 §5.5 的交叉自检（captain 要求的读者视角检查）

| 检查点 | §5.5 落位表 | §12（本节） | 结论 |
|---|---|---|---|
| 7 个载荷的默认落位 | **5 个注入类载荷（`identityCard`/`dualModelCard`/`refusalImmunity`/`disclaimerSpell`/`unicodeEncoding`）+ `traceCleanup` 的规则文本标注 E1**；`toolChannel` = L4、`traceCleanup` = L5、`unicodeEncoding` 另含 L6 解码（L1 明确「默认不用」） | §12.2：**全部 7 个载荷默认落 E1**，并注明「落位细分见 §5.5：`toolChannel` 实走 L4、`traceCleanup` 实走 L5」 | ✅ 一致（同口径：E1 为默认通道，L4/L5/L6 为个别项的实际落层，不矛盾） |
| L1 的状态 | "可选增强，**须 V10 + V11 通过**才可启用" | §12.2/§12.4 同 | ✅ 一致 |
| 是否两方案待选 | 不涉及 | §12 开头明示"不是两方案待选" | ✅ 一致 |
| 是否存在分歧 | 表末指向 **§12.6** | §12.6 是唯一分歧点，且标注"不改变基线、须拍板" | ✅ 一致（读者不会被导向互相冲突的结论） |

> **上表第 1 行的措辞与 Q3 v3 的关系（记录一条跨文档措辞收敛建议）**：该行（「5 个注入类载荷 + `traceCleanup` 的规则文本落 E1；`toolChannel` = L4、`traceCleanup` = L5、`unicodeEncoding` 另含 L6 解码）的精确写法源自本文对 Q3 v3 §6.1 的收敛，而 Q3 v3 §6.1 自身仍写作「全部 7 个载荷默认都落这里（L2）」——属**两文档共享的措辞不精确**。**建议 Q3 v3 §6.1 采用与此处完全相同的措辞**：`5 个注入类载荷 + traceCleanup 的规则文本落 E1；toolChannel = L4、traceCleanup = L5、unicodeEncoding 另含 L6 解码`。该收敛需要修改来源报告 `H:\GitHub\NyaaChat\.docs\_agentteams\Q3-绕过开关选项清单与映射.md`，**不在本次汇总修复的 inScope 内，可另行处理，不阻塞本修复**。

---

*本文由 `nyaachat-flagalac-recon` / `synthesizer` 汇总三份来源报告产出；§11 与 §12 依据 captain 指令增补，其中 R1 全链路、R2 四条 identifier、R3–R5 三项均已由本文作者独立回源复核。第二轮修订按 **Q3 v3 实际文件内容**（captain 传达为 v2，文件已含 v3）更新了落位章节与相关结论。*
