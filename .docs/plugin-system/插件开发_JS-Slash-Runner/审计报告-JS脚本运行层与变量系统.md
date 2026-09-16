# JS-Slash-Runner 移植 × 变量系统优化 —— 审计报告

> 对应 `初始设计.md` §实施方案 第 **1** 步（审计本文档需求，分析方案）与第 **2** 步（与我逐一拍板，建立审计文档）。
>
> **本文件交付**：现状取证 → 目标侧（ST / 酒馆助手 / MVU）盘点 → 差距矩阵 → 架构张力 → A/B/C 方案与推荐 → **编号拍板清单（§7）** → 未确认项。
>
> **本文件不含任何代码改动**，也不含最终实现计划。拍板全部完成后另出 SSOT（§10）。

---

## 1. 取证基线与方法

| 对象 | 版本 / 位置 | 备注 |
|---|---|---|
| NyaaChat（主仓） | `3f76a0b`（2026-09-16） | HEAD == `origin/master`，工作树干净（仅本目录未跟踪） |
| NyaaChat-Docs | `8f6ece1` | `doc-files/roleplay/variables.md`（75 行） |
| SillyTavern | `06bde939f`（1.19.0）@ `NyaaChat/.ref/SillyTavern` | ST 原生变量系统 + `st-context.js` |
| 酒馆助手 JS-Slash-Runner | `04a62b76` @ `NyaaChat/.ref/JS-Slash-Runner` | `src/function/*` + `src/iframe/*` |
| MVU（MagVarUpdate） | `MagicalAstrogy/MagVarUpdate@0.185.0` | **默认分支实际是 `beta`**；`main` 路径全 404 |

取证纪律（沿用上一阶段教训）：

- 行数一律 `(Get-Content <file>).Count`（**不用** `Measure-Object -Line`）。
- 计数一律 `(Get-Content -Raw).Split($n).Count - 1`（**不用** `Select-String -AllMatches` —— 压缩成单行的 bundle 上会返回 0）。
- 未跟踪路径**不能**用 `git grep` 判定（返回 0 ≠ 不存在），改用 ripgrep / `Get-ChildItem` / `git ls-files` 交叉。
- 宿主 API 名（未声明的自由变量）不被 terser 改名 ⇒ 可 grep；MVU 内部名（`$t`/`ct`/`kt`）被混淆 ⇒ 不可 grep。

---

## 2. 现状盘点（NyaaChat 侧）

### 2.1 变量层：三份互相矛盾的"事实"

**F1 —— `variables.md` 描述的变量层在代码里不存在。**
`setVariable` 全仓 **0 命中**，`git log --all -S/-G 'setVariable'` **全历史 0 命中**（即从未存在）。
`src/types.ts`：`Message`(L8-36) 无 `variables`、`CharacterSettings`(L174-219) 无 `variables`、`ChatSession`(L407-415) 无 `metadata`。
`src/` 内**无** `eval(` / `new Function` ⇒ 正则替换通道根本不具备执行 JS 的能力。

> ⇒ `初始设计.md` §21-22 "NyaaChat自有一套简单的变量层" 这一前提**不成立**；那份 75 行文档是未落地/陈旧文档。

**F2 —— NyaaChat 曾有一整套 TavernHelper 兼容变量层，2026-09-15 被有意摘除。**
`commit 6310735`（上一阶段"摘除 ST 扩展兼容"）删除 `src/compat/variables.ts`（367 行）：

- 6 个作用域 + 完整 API（`getVariables` / `replaceVariables` / `insertOrAssignVariables` / `insertVariables` / `deleteVariable` / `updateVariablesWith`）
- 深拷贝读契约
- localStorage/IDB 键 `nyaachat_vars_global`、`nyaachat_vars_chat::<sid>`
- message 变量挂 `Message.variables`，随会话持久化
- 历史链：`b2c2822` → `3423ebf` → `5921bfd` → `1e567e0` → `6310735`

> ⇒ 本阶段的变量工作是**复建 + 定向扩展**（不是从零设计），且是上一阶段的**受控局部回退**。蓝图可原样取回：
> `git show 6310735^:src/compat/variables.ts`

**F3 —— 三处"刻意退休"守门与复建正面冲突（最大地雷）。**

| # | 位置 | 现行为 | 与复建的冲突 |
|---|---|---|---|
| G-a | `src/lib/sessionStorage.ts:24-25` `RETIRED_MESSAGE_KEYS=["variables"]` | **每次写会话都剥离** message 上的 `variables` | 写入后刷新即静默消失（表现为"变量存不住"） |
| G-b | `src/lib/idbStorage.ts:129-146` `MIGRATED_KEYS` | `nyaachat_vars_*` 既不迁移也不再读写 | 老的 `nyaachat_vars_*` 数据永久搁浅 |
| G-c | `src/lib/settingsBackup.ts:160-168` `RETIRED_TOP_LEVEL_KEYS=["extension_settings","extensionSettings","chat_metadata"]` | 导入导出两侧都剥离这三类键 | 若沿用 `chat_metadata` 命名则直接冲突 |

三处注释都在强调"不再读写/不可复活"（`sessionStorage.ts:7-25`、`idbStorage.ts:125-133`、`settingsBackup.ts:157-171`）。
**这是与上一阶段既有决策的正面冲突，必须由用户拍板解除到什么程度**（见 §7 D3）。

### 2.2 卡片 JS 的落点：目前 **100% 丢失**

- **导入（ST 卡）** `src/lib/sillyTavernImport.ts:161-209` 是**白名单重建**：只挑 description/first_mes/worldInfo/regexScripts/tags 等已知字段，**`data.extensions` 除 `regex_scripts` 外整块丢弃** ⇒ 样例卡 `data.extensions.tavern_helper.scripts`（2 个脚本）**必然丢失**。
- **导入（原生卡）** `src/lib/sillyTavernImport.ts:74-93` `convertNativeCard` 同样是白名单。
- **导出** `src/lib/sillyTavernExport.ts:117-124` **只回写** `data.extensions.regex_scripts`。
- **世界书**：`sillyTavernImport.ts:170,188` 保留 `enabled`（`enabled: e.enabled ?? true`）⇒ 样例卡里那条 `enabled:false`、`comment=[initvar]变量初始化勿开` 的条目**可以存活**（MVU 的初始值正靠它）。

### 2.3 提示词侧的宏替换

- `src/lib/chatPipeline.ts:788-795` `renderRule`：只替换 `{{user}}` / `{{char}}`，再套 WORLD_INFO placement 正则。
- 全仓（`src/` + `plugins/`）**无** `{{get_message_variable::}}` / `{{get_chat_variable::}}` / `{{get_global_variable::}}`（本次复验 0 命中）。
- `chatPipeline.ts:797-801`、`:361`、`:667` 明确：**静态前缀必须逐轮字节一致**才能命中 prompt 缓存；关键词激活的世界书走 `:829+` 的**动态尾部**。
- `src/lib/regex/macros.ts`（333 行）只有 `{{...}}` 宏引擎，唯一调用方是 `src/lib/regex/engine.ts:115/137/139/166` ⇒ **宏只在正则脚本内跑**，prompt 侧完全没有变量宏。

### 2.4 执行环境（⚠️ 含一个**推翻前提**的发现）

- `src/lib/frontendCard/srcdoc.ts:10-13`：前端卡 iframe **同源、不加 `sandbox`、明确注释"本模块不是安全边界"**；`:7-8` 明确**不预置任何宿主 API**。
- `srcdoc.ts:17-52,74` 的 `HEIGHT_SCRIPT` 是 srcdoc 内的**内联 `<script>`**。

**⚠️ 发现 CSP-1：配置里写了 CSP，但 dev 与生产都从未下发。**

实测（本次复验，只读）：

```
GET http://127.0.0.1:4095/      → Server/ETag/Vary/Cache-Control(no-store…)/Pragma/Expires/X-Dev-Server/Content-Type/Last-Modified
GET http://127.0.0.1:4095/chat/abc → 同上（SPA 回退）
```

**没有 `Content-Security-Policy`**，也**没有** `X-Frame-Options` / `X-Content-Type-Options` / `Referrer-Policy` / `Permissions-Policy`。生产 macmini `127.0.0.1:3095` 同样无任何安全头（S5 只读对照）。

根因（nginx `add_header` 的**层级全覆盖**继承规则）：

| 位置 | 内容 |
|---|---|
| 服务器块 | `nginx.conf:41-45` / dev 模板 `:68-72` 写有 CSP + X-Frame-Options + nosniff + Referrer-Policy |
| `location = /index.html` | `nginx.conf:75-78` / dev 模板 `:103-107` **自带** `add_header Cache-Control/Pragma/Expires` ⇒ 该 location 内**服务器级安全头不再继承** |
| `location /` | `nginx.conf:382-383` / dev 模板 `:321-324` `try_files $uri $uri/ /index.html` ⇒ 文档请求**内部重定向**进上面那个 location |

dev 模板 `:322-323` 的注释（"No add_header here on purpose: a nested add_header would suppress the inherited server-level CSP"）**意图正确，但被内部重定向绕过** —— 这就是实际响应里同时出现 `Cache-Control/Pragma/Expires`（来自 `= /index.html`）却**没有 CSP** 的原因。

**架构含义（直接决定 D5 / D7 / D13）：**

1. **现状下**：`eval`、`new Function`、srcdoc 内联脚本、`blob:` 脚本、远程 ESM（jsDelivr）**全部可用** —— 前端卡"能跑"完全依赖"CSP 没生效"这一副作用。
2. **一旦修好 CSP**（`script-src 'self'`，无 `unsafe-inline`/`unsafe-eval`）：`eval`/`new Function` 抛 `EvalError`；**srcdoc iframe 彻底不可行**（srcdoc 继承父策略，`sandbox="allow-scripts allow-same-origin"` 也救不了）；`blob:` 被拦；**前端卡高度自适应脚本（`HEIGHT_SCRIPT`）会当场死掉** ⇒ 前端卡功能集体失效。
3. **零放宽的可行路线**：把脚本落成**同源真实资源**（`script-src 'self'` 实测可执行），或给脚本载体一个**独立文档 + 独立（按路径放宽的）策略**。
4. **结论**：不能以"现在能跑"作为移植依据。CSP 是否修、修到什么程度，必须先拍板（D13）。

### 2.5 插件框架的构建期模型

- `plugins/registry.ts:1-31` 头注释即权威："Vite 从 `index.html → src/main.tsx` 全量打包，`plugins/**` 只能通过本文件进入依赖图 ⇒ **没有运行时加载器、没有动态 `import()`、没有白名单机制**"。
- 契约 `src/plugins/types.ts`（`hostContext.ts:9-10` 标注**已冻结**：签名变更须先改 SSOT 并经用户确认）。
- 模块环地雷：插件只能静态 import `src/plugins/types`（type-only）与**叶子** `src/plugins/hostContext.ts`。

---

## 3. 目标侧盘点（ST / 酒馆助手 / MVU）

### 3.1 脚本模型（酒馆助手）

- 脚本库有 4 个"库"（global / character / preset / chat）；**脚本对象本身没有 `scope` 字段**，"属于哪个库"由它被存在哪决定。
- 脚本在**隐藏的同源 `<iframe>`** 中运行（`srcdoc` 或 `blob:`），**不使用 `eval` / `new Function` / `sandbox=`**。
- `src/iframe/predefine.js:11-34` 注入并绑定：`_`(lodash)、`z`(zod)、`YAML`、`toastr`、`showdown`、`TavernHelper`（`_` 去前缀绑定到全局）、`SillyTavern`、`Mvu`；并重绑 `this`。
- 脚本持久化：global → `extension_settings.tavern_helper`；character → `character.data.extensions.tavern_helper`；preset / chat 各一处。

### 3.2 JSR 的 API 面（关键：**函数面远大于变量面**）

| 模块 | 规模 | 本阶段是否必需 |
|---|---|---|
| `src/function/variables.ts` | 变量 7 作用域 + schema | **必需（子集）** |
| `src/function/chat_message.ts` | 610 行，楼层/消息读写（含 swipes） | **必需（子集）** |
| `src/function/event.ts` | 523 行，事件总线 + `tavern_events` 常量表 | **必需（子集）** |
| `src/function/macro_like.ts` | 10 个变量宏 | **必需（子集，2–4 个）** |
| `src/function/index.ts` | 479 行，`_bind` 去前缀绑定总入口 | 必需（门面） |
| `lorebook*` / `update/pi/*` / 生成类 / 工具调用 / 变量管理器 UI | 数十文件 | 非必需（§7 D9） |

### 3.3 MVU 依赖清单（判据：缺了它 MVU 在哪一步失败）

详见 `MVU技术性说明.md`（535 行）。摘要：

**必须（M1–M13）**

| ID | 依赖 | 缺失后果 |
|---|---|---|
| M1 | **message 变量**，形状 `message.variables: Array<object>` 按 **swipe 索引** | 宿主判据 `_.has(chat_message?.variables?.[swipe_id ?? 0],'stat_data')`（`JS-Slash-Runner/src/function/global.ts:6-8`）恒 false ⇒ `waitMvu()` 超时 |
| M2 | `getVariables`/`replaceVariables`/`updateVariablesWith` 的 **message 分支**（`number`\|`'latest'`、负数深度、越界抛错） | `initCheck` 取"上一有效楼层变量"失败 ⇒ 变量永不初始化 |
| M3 | swipe 分槽 + `getChatMessages(id,{include_swipes:true})` + `setChatMessages([{message_id:0,swipes_data:[…]}])` | **第 0 层（开场白）变量永远建不起来**（开场白 `<initvar>` 唯一写回路径） |
| M4 | `getChatMessages(range)` 返回对象含 `.data`，且 `data === variables[swipe_id]` | 状态栏读法 `message_data[0].data.stat_data` 取不到 |
| M5 | `getLastMessageId()` | `initCheck` 第一步 ReferenceError |
| M6 | `eventOn`/`eventEmit`/`eventRemoveListener` + `tavern_events` 常量表（≥9 个） | 事件名 `undefined`，静默永不触发 |
| M7 | **`global_Mvu_initialized` 事件 + 可写 `window.parent.Mvu`** | 所有角色卡的 `waitGlobalInitialized('Mvu')` **永不 resolve**，mvu_zod 整链卡死 |
| M8 | **chat 作用域** + `updateVariablesWith(…,{type:'chat'})`（键 `stat_data/display_data/delta_data/schema/initialized_lorebooks`） | "更新到聊天变量"兼容开关失效 |
| M9 | 宿主全局 `_` / `z` / `toastr` / `$` / `YAML` | `$` 在 `initCheck` 第一行即用，缺任一 ⇒ ReferenceError |
| M10 | **`substitudeMacros`**（宿主真实导出名就是这个错拼） | 命令文本、开场白 `<initvar>`、世界书 `[initvar]` 三处**裸调用**全断 |
| M11 | `getLorebookSettings()` + `getCharLorebooks()` + `getLorebookEntries(name)` | `[initvar]` 与 `initialized_lorebooks` 建不起来，`stat_data` 起步为空 |
| M12 | `getScriptId()` | 模块初始化期 `'mvu_VariableUpdate_'+getScriptId()` 抛错 |
| M13 | **世界书条目里的 `{{get_message_variable::路径}}` 必须被宿主替换** | 状态块原样发给 LLM。⚠️ MVU 脚本本体**不**消费该宏（bundle 0 命中），由**角色卡附带的世界书**消费 ⇒ 属"端到端可用"必须项 |

**锦上添花（N1–N9）**：character/preset/script/extension 四作用域（MVU 全未出现）、`insertVariables`(0 命中)、`get_variables_without_clone`（不暴露 iframe）、`registerVariableSchema`（**纯 UI**）、`format_*`(YAML) 与 `$` 前缀键忽略、`getAllVariables`、变量管理器 UI（**明确不迁移**）、swipe 特性本身（NyaaChat 无 swipe；MVU 自承"swipe 丢状态"是已知问题）、生成类 API（可绕开）。

**明确未出现（可砍）**：`createChatMessages` / `deleteChatMessages` / `rotateChatMessages` / `refreshMessage` / `triggerSlash` / `eventOnce` / `eventEmitAndWait` / `iframe_events.*` / `getCurrentPersonaName` / `waitGlobalInitialized`·`initializeGlobal`（MVU 核心不调，是 mvu_zod 在调）/ `registerMacroLike` / `injectPrompts`。

**一处更正**：`VARIABLE_INITIALIZED` / `VARIABLE_UPDATE_STARTED` / `VARIABLE_UPDATE_ENDED` / `COMMAND_PARSED` **不是** JSR 导出的事件名，而是 MVU 自己的事件（真名 `mag_variable_initialized` / `mag_variable_update_started` / `mag_variable_update_ended` / `mag_command_parsed`）。

### 3.4 mvu_zod 的三个未文档化内部事件

`mvu_zod.json`（7113 字符，**全内联**）依赖：`mag_command_parsed_for_zod`、`mag_command_parsed_ended_for_zod`、`mag_variable_update_ended_for_zod`。
⇒ **这是"优先加载上游 bundle 而不是自己复刻 MVU"的最强论据**：复刻等于同时复刻三个未文档化的私有契约。

另：`.d.ts` 里的 `mag_variable_initiailized` 是上游笔误，真名 `mag_variable_initialized`。

---

## 4. 差距矩阵（Gap）

| # | 能力 | NyaaChat 现状 | MVU/JSR 需要 | 缺口性质 |
|---|---|---|---|---|
| G1 | message 变量存储 | **无** | `Message.variables: Array<object>` @ swipe | **新增字段 + 解除 G-a 守门** |
| G2 | chat 变量存储 | **无**（`ChatSession` 无 `metadata`） | `chat_metadata.variables` | 新增（命名需拍板，避开 G-c） |
| G3 | 变量读写 API | **无** getter/setter | `getVariables` 等一族 | 复建（蓝本 F2）+ 暴露给脚本 |
| G4 | 事件总线 | 插件侧仅有 `message:received`/`session:changed`/`character:changed` 三个**插件事件** | JSR `tavern_events` 常量表 + `eventOn/Emit/RemoveListener` | 新增一层（或与插件事件统一，见 T1） |
| G5 | 消息/楼层 API | 无对外 API | `getChatMessages`/`setChatMessages`/`getLastMessageId`（含 `.data`/swipes） | 新增门面 |
| G6 | 变量宏 | 无 | 10 个 `{{get_/format_*_variable::}}` | 新增（子集）；**且要进 prompt** |
| G7 | 世界书 API | 有内部 world info 引擎，无脚本 API | `getLorebookSettings`/`getCharLorebooks`/`getLorebookEntries` | 新增门面（薄封装） |
| G8 | 脚本执行环境 | **无**（无任何 iframe 脚本运行器；前端卡 iframe 明确不预置 API） | 隐藏同源 iframe + predefine 注入 | **新增**（T1/T2 的交汇点） |
| G9 | 卡片脚本 IO | **100% 丢失**（白名单） | 随角色卡导入/导出/切卡 | 改 `sillyTavernImport.ts` / `sillyTavernExport.ts` |
| G10 | 脚本库 UI | 无 | 列表/启用/删除/切卡自动切换 | 新增（照 `正则` 的既有模式） |
| G11 | 脚本加载与 CSP | **CSP 实际未下发**（§2.4 CSP-1）；`eval`/`new Function`/srcdoc 内联/blob/远程 ESM 现状**全通** | MVU 用**远程 ESM**（jsDelivr） | 现状可用但**脆弱**：一旦修 CSP 即全面失效（见 T5 / D13） |
| G12 | swipe / 楼层分支概念 | **无**（全仓 `swipe` 仅指触屏手势 `src/hooks/useFullscreen.ts:10-12`） | message 变量按 `swipe_id` 索引 | 语义缺口：单元素数组能否跑通已验证 |

---

## 5. 架构张力（必须正面解决的五个）

**T1 —— 构建期打包 vs 运行时执行。**
`plugins/registry.ts:1-31` 明确无运行时加载器；而"角色卡自带的 JS 脚本"**必须运行时执行**。这两者不是同一个东西：插件是**宿主代码**（构建期），脚本是**用户数据**（运行时）。⇒ 架构上必须把"执行器"放进插件（构建期注册），把"被执行的脚本"当数据存。**这一点不需要放宽打包模型**，但需要拍板执行器的隔离姿态（T2）。

**T2 —— 变量层复活 vs 三处退休守门。**
见 F3。不复建守门就存不住；复建范围决定要不要新迁移代码、要不要上调 `EXPORT_VERSION`（`settingsBackup.ts:30-40` 刻意冻结 v9，理由是"上调只会单方面让老版本拒绝新存档"）。⇒ §7 D3。

**T3 —— MVU 的 swipe 模型 vs NyaaChat 无 swipe。**
MVU 把变量按 `chat[i].variables[swipe_id]` 存。NyaaChat 没有 swipe/楼层分支概念。MVU 自承"swipe 丢状态"是已知问题 ⇒ **`variables:[{…}]` 单元素数组即可跑通**，但形状必须是 `Array<object>` 且 `data === variables[swipe_id]`（M1/M4 硬约束）。⇒ §7 D4。

**T4 —— 动态变量宏 vs prompt 缓存字节一致性。**
`chatPipeline.ts:797-801` 要求静态前缀逐轮字节一致；MVU 状态块要求逐轮动态。⇒ 变量宏只应允许出现在**动态/关键词激活**条目（`:829+` 尾部），或需要接受缓存失效。⇒ §7 D6。

**T5 —— CSP 的"意图"与"实现"错位（本次新发现，安全回归 + 载体选择的前提）。**
配置**意图**是 `script-src 'self'`（严格），**实现**是"一个安全头都没下发"（§2.4 CSP-1）。后果有两面：

- **安全面**：CSP / X-Frame-Options / nosniff / Referrer-Policy 全部失效 ⇒ 任何 HTML 注入都等价于完整的脚本执行，且站点可被任意站点 iframe 嵌套。这是与配置意图相反的**现状回归**。
- **功能面**：现有前端卡（内联脚本 + `HEIGHT_SCRIPT`）之所以能跑，正是因为 CSP 没生效。修好 CSP 会**顺手打挂前端卡**。

⇒ 这条必须在"脚本执行器选型"之前拍板（§7 D13）：先定 CSP 策略，再定脚本载体；否则会出现"选了个载体、修 CSP 时全部推翻"的返工。

---

## 6. 三个方案与推荐

### A（最小补齐：只做必须项）—— **推荐**

新建 `src/lib/variables/`，先落 **message + chat** 两作用域（+ MVU 用到的 `global.extra_analysis`）；补 M13 世界书变量宏；message/chat 读写 + 事件 + `substitudeMacros` 经宿主门面暴露给脚本；`Mvu` 全局可写 + `global_Mvu_initialized` 事件。

改动面：新增 `src/lib/variables/{index,store,scopes}.ts`（蓝本 `git show 6310735^:src/compat/variables.ts`）；`src/types.ts`（`Message` 增 `variables?`）；**`src/lib/sessionStorage.ts:24-25` 必须撤销**；`src/lib/idbStorage.ts:129-146`；`src/lib/regex/macros.ts`（或并列新模块，避免污染既有 25 个宏）；`src/lib/chatPipeline.ts:788-795`；`src/lib/settingsBackup.ts:160-168`；宿主门面照 `hostContext.ts:16-37` 的**叶子模块**模式新增（避开已记录的模块环地雷）；新插件 `plugins/js-slash-runner/*` + `plugins/registry.ts`。

代价/风险：**中**。最大风险 = F3 三处守门必须同步改，否则表现为"写入后刷新即消失"。
既有数据：`Message.variables` 新增**可选**字段**无需迁移**；`EXPORT_VERSION=9` **可保持不变**（纯增可选字段）。老存档里被剥离的 `variables` 从此被保留（无害）。
满足：**M1–M13 全覆盖**。

### B（对齐酒馆助手 API）

A + 7 作用域全套 API + `registerVariableSchema`(zod) + 5×2 宏 + JSR 事件名/payload 全对齐 + iframe 脚本运行器注入 `TavernHelper/_/z/$/YAML/SillyTavern`。

代价/风险：**高**。JSR 的 TavernHelper 面远大于变量（`chat_message.ts` 610 行 + 数十文件），边界极易膨胀；且 ST 角色卡导入/导出语义会变。
满足：M1–M13 + N1–N6。

### C（重建变量层）

以 ST + JSR 语义从零设计（统一 Store + 作用域 + schema + 事件 + 宏 + 迁移），重写 `macros.ts` 的 env 机制为"变量感知"，正式复活或明确废弃 `nyaachat_vars_*` / `chat_metadata` 概念。

代价/风险：**最高**，等于把 `6310735` 摘除的整套兼容面再建一次，而那次摘除是**有意为之** ⇒ 与既有决策直接冲突；且很可能需要上调 `EXPORT_VERSION`。

**推荐：A 先落地，并把 A 设计成 B 的第一阶段；C 不推荐。**
理由：MVU 本体只依赖 **message + chat + global** 三个作用域（character/preset/script/extension 全未出现）；B/C 的主要成本落在 **MVU 用不到的 API 面**与**刚被有意摘除的兼容层**上。

**方案 A 与本次 CSP 发现的关系**：A 的变量层部分与 CSP 无关（纯内核 + 数据）；受 CSP 影响的只有**脚本执行载体**（G8）与**远程 bundle 加载**（G11/D7）。因此若 D13 选 ②，A 的 P1/P2（变量层、变量宏）**完全不受影响**，P3（执行器）只需在 `ScriptHost` 抽象层里落一个"当前环境"实现即可。

---

## 7. 拍板清单（请逐条拍板）

> 每条给出**推荐**与"选它的后果"。拍板结果将直接写进 SSOT 的"已确认决策"章节。

### D1 — 范围边界：本阶段**只**做下面两件事，是否确认？
- **做**：① JS 脚本运行层（执行器 + 宿主 API 子集）；② 角色卡自带 JS 脚本的**导入 / 导出 / 切换 / 列表 / 启用禁用 / 删除**。
- **不做**（明确列入 non-goals）：酒馆助手的前端渲染、预设导入、语音/音频、提示词注入、变量管理器 UI、脚本在线编辑、ST 扩展机制本身。
- 推荐：**确认**。（与 `初始设计.md:5-6` 一致）
- 后果：所有"顺手一起做"的需求都被推回，范围可控。

### D2 — 变量系统路线
- 选项：**A 最小补齐（推荐）** / B 对齐 JSR / C 重建。
- 推荐：**A**，并按"B 的第一阶段"组织代码（作用域注册表化，便于后续加 character/preset）。
- 后果：A 不需要迁移代码、不动 `EXPORT_VERSION`；代价是 `registerVariableSchema`(纯 UI)、character/preset 作用域、`format_*` YAML 宏等**暂不支持**。

### D3 — "退休守门"解除到什么程度（**最关键**）
三个选项：
- **D3-①（推荐）只解除 message 变量**：撤销 `sessionStorage.ts:24-25` 的 `RETIRED_MESSAGE_KEYS=["variables"]`；**保留** `RETIRED_SESSION_KEYS=["metadata"]` 与 `settingsBackup.ts` 的 `RETIRED_TOP_LEVEL_KEYS` ⇒ chat 作用域**不用** `chat_metadata` 命名，改挂到现有的会话对象新字段上。
- **D3-② 解除 message + chat_metadata**：`RETIRED_TOP_LEVEL_KEYS` 去掉 `chat_metadata`，chat 变量沿用 ST 命名。
- **D3-③ 全部解除**（含 `extension_settings`）：等同正式回退上一阶段决策。
- 推荐：**D3-①**。理由：`chat_metadata` / `extension_settings` 是"ST 扩展兼容面"的名称，NyaaChat 自己没有这个产品概念，沿用它们等于把刚摘掉的东西换个门牌装回来。
- 后果：D3-① 下 `settingsBackup.ts` **完全不用改**；老归档里的 `variables` 会被保留（无害）。

### D4 — 变量存储形状与 swipe 语义
- 事实：MVU **硬要求** `message.variables` 是 `Array<object>`，且 `getChatMessages()` 返回对象的 `.data === variables[swipe_id]`（M1/M4）。
- 选项：**D4-①（推荐）保留数组形状，但 NyaaChat 永远只有 1 个槽位（等价 `swipe_id` 恒为 0），并把 `swipe_id` 作为宿主 API 的常量暴露**；D4-② 真正引入 swipe/楼层分支概念（大工程，超出本阶段）。
- 推荐：**D4-①**。
- 后果：MVU 能跑（其"swipe 丢状态"本就是上游已知问题）；NyaaChat 不引入新的用户可见概念。

### D5 — 脚本执行与隔离模型（**依赖 D13 先定**）
- 事实：插件是构建期打包；前端卡 iframe 同源、**无 sandbox**、注释明确"不是安全边界"；而该 iframe 与之同源的宿主里，IndexedDB 存着 LLM / ComfyUI / MCP 凭据。**当前无 CSP 下发**（§2.4 CSP-1）。
- 选项：
  - **D5-①（推荐）沿用"同源隐藏 iframe + 明确告知只跑可信来源卡片"的现状姿态**，UI 上做风险提示；脚本执行器复用前端卡 iframe 机制（不加 sandbox，保持同源以便注入宿主 API）。
  - D5-② 加沙箱 + `postMessage` 桥（需重写宿主 API 通道，代价进入 B/C 量级；`sandbox` 会让同源 API 直接注入不可行）。
- 推荐：**D5-①**。理由：**现状即已等价任意代码执行**（无 sandbox 的前端卡已能碰到宿主 IndexedDB），本阶段不引入新局面；但必须在 UI 明示。
- 后果：与 NyaaChat 现有安全姿态一致；若将来要求真隔离，需单独立项。
- ⚠️ 载体（srcdoc / blob / 同源真实文档）的选择**取决于 D13**：srcdoc 在 CSP 生效时彻底不可用。

### D6 — 变量宏允许出现在哪些世界书条目（prompt 缓存取舍）
- **D6-①（推荐）只允许出现在"动态尾部"（关键词激活条目）**，永久条目命中变量宏时给一条**控制台警告 + UI 提示**；
- D6-② 允许出现在永久条目（牺牲静态前缀缓存命中）；
- D6-③ 干脆不允许——但那样 MVU 状态块送不出去，**不可行**。
- 推荐：**D6-①**。

### D7 — MVU 上游 bundle 的获取方式
`MVU.json` 是 42 行 loader，import 的是**远程 ESM**：`https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js`（538,090 字符，build 2026-09-15，commit `42753fd`）。
**现状**（CSP 未下发）下它**能加载**；但在"配置意图的 CSP"（`script-src 'self'`）下它**必然被拦**。⇒ 这是一个"现在能跑、修 CSP 就死"的典型项，与 D13 绑定。
- 选项：
  - **D7-①（推荐）自托管**：把 bundle 落到 NyaaChat 自己的静态资源（同源 ⇒ 满足 `'self'`），脚本环境把该 URL 映射到自托管地址。**无论 D13 怎么选都成立**。
  - D7-② 放宽 CSP 允许该 CDN 域名（引入外部依赖 + 供应链风险；上游引用的是**不带版本号的** `artifact/bundle.js`，**无法钉版本**）。
  - D7-③ 内联进插件主 bundle（体积进入主包，且无法独立更新）。
  - D7-④ 只支持 `mvu_zod.json`（全内联）放弃远程 loader 形态 —— 不推荐（样例卡正是 loader 形态）。
- 推荐：**D7-①**。自托管时必须在文件里记录取回的 commit/日期 + sha256，并把「bundle 版本记录 + 更新流程」写进 SSOT。
- 后果：其它依赖远程 ESM 的 ST 脚本同样受益（`klona` 等外部依赖也走 `module-import`，离线必须自备）。

### D8 — 角色卡脚本的落盘字段与 ST 互操作
- 选项：**D8-①（推荐）新增 `CharacterSettings.scripts?: ScriptRecord[]`（NyaaChat 自有命名，与 `regexScripts` 对称），并在 ST 互操作层双向映射到 `data.extensions.tavern_helper.scripts`**：导入时读取该路径，导出时按 ST 结构回写。
- 后果：NyaaChat 原生卡 JSON 会变大；ST 导出语义变化（本次正是要的）；v9 兼容不受影响（选项字段）。
- 需拍板子项：**导出时是否包含 `enabled` 与脚本 `name`/`id`**（推荐：都带，保证往返保真）。

### D9 — 首版支持的宿主 API 面
- 选项：**D9-①（推荐）只实现 M1–M13 必须项 + 少量 N 项**，`character/preset/script/extension` 四作用域、`registerVariableSchema`、生成类 API 一律返回"未实现"并**在控制台给出明确说明**（避免静默 `undefined`）。
- 后果：只保证 **MVU + mvu_zod** 跑通；其它 ST 脚本可能因缺 API 而失败（属预期）。

### D10 — 脚本库 UI 形态
- 元素（照 `正则` 的既有模式）：列表（名称 + 右侧绿色启用点，沿用插件列表的视觉约定）、启用/禁用、删除、**切卡自动切换**、"导入脚本"（从卡片/文件）。
- **不做**：在线编辑（`初始设计.md:14` 明确）、变量管理器 UI（`:12`）。
- 推荐：**确认**，并沿用 `RegexModal.tsx` / `RegexScriptEditModal.tsx` 的控件风格。
- 需拍板子项：是否提供**拖拽排序**（插件列表已有此交互；脚本执行顺序对 MVU 有意义）。

### D11 — 变量层是否对普通用户可见/可用
- 事实：`初始设计.md:22` 说 NyaaChat 产品页无变量说明，仅帮助文档有；而帮助文档那份**描述的是不存在的实现**。
- 选项：**D11-①（推荐）本阶段只做"内部变量层 + 给脚本的 API"，不新增面向用户的变量 UI/宏文档**；同时**修正 `NyaaChat-Docs/doc-files/roleplay/variables.md`**（标注为"实现取决于 JS-Slash-Runner 插件/或重写为贴合新实现"）。
- 需拍板子项：是否**同步修 NyaaChat-Docs**（另一个仓库，需单独提交）。

### D12 — P 阶段划分与团队编制
- 建议 5 个 P（每 P 可独立验证/提交）：
  - **P1 变量层复建**（message + chat + global；解除 D3 选定的守门；单测）
  - **P2 变量宏进 prompt**（含 D6 的警告机制）
  - **P3 脚本执行器**（隐藏 iframe + predefine 注入 + 宿主 API 门面：M1–M13）
  - **P4 卡片脚本 IO**（导入/导出/切卡 + D8 字段）
  - **P5 脚本库 UI + 插件装配 + dev 服端到端验证**（样例卡实跑 MVU）
- 团队：≤8 子代理并行，**无前置需求的任务并行、有依赖的串行**；每个 P 收尾按 Vibo 规范提交 + 交接文档。

---

### D13 — CSP 策略（**建议最先回答：D5 的载体选择与 D7 的必要性都依赖它**）
- 事实：配置里写了严格 CSP（`script-src 'self'`），实际**一个安全头都没下发**（dev + 生产，§2.4 CSP-1）。
- 选项：
  - **D13-① 现在就修 CSP + 同步迁移脚本载体**：用 `include` 复用安全头（或去掉 `location = /index.html` 的自有 `add_header`），让 CSP 真正生效；用户脚本载体改为**独立同源文档 + 按路径放宽的独立策略**（该文档自己的响应头允许 `'unsafe-inline' 'unsafe-eval' blob:`，主应用仍保持严格），并把**前端卡 iframe 一并迁到该文档**（否则前端卡会随 CSP 一起失效）。
  - **D13-②（推荐）本阶段不改 CSP，但把脚本载体抽象成可替换的一层**（例如 `ScriptHost` 接口 + 单一实现），使将来修 CSP 时只需替换实现；同时把"CSP 未下发"登记为**独立已知问题并单独立项**申报。（前端卡的同类问题同样登记。）
  - D13-③ 本阶段不改 CSP、也不做抽象：最省事，但将来修 CSP 会**推翻**本次的载体实现，产生返工。
- 推荐：**D13-②** —— 保持本阶段聚焦"跑通 MVU"，同时不给未来埋返工；"修 CSP"是**既有 bug 的独立修复**，不应悄悄绑进本阶段。
- 后果：D13-② 下本阶段可以正常使用 `eval`/`new Function`/srcdoc/blob/远程 ESM（现状即如此），但 SSOT 必须显式写明"**依赖 CSP 未生效这一现状**"，以及在 CSP 修复后需要替换的**唯一**落点。

---

## 8. CSP 与脚本执行环境实测（S5，headless Chrome 152 真机驱动）

**方法**：真实 dev 页面（`127.0.0.1:4095`）+ CDP 导航与读取；被测脚本一律由页面内 `<script src="/probe.js">` 执行（避开 CDP 的 `allowUnsafeEvalBlockedByCSP` 污染）；CSP 生效列用本地 Node http 服务**原样回放 `nginx.conf:41` 整条头**；另设无 CSP 页对照。仓库零改动、temp 已删、未改 nginx、未重启容器。

| # | 探针 | **dev 真实（无 CSP）** | **CSP 生效（回放 L41）** | 无 CSP 对照 |
|---|---|---|---|---|
| ① | `eval("1+1")` | 可用 = 2 | **被拦**：`EvalError: … 'unsafe-eval' is not an allowed source of script: script-src 'self'` | 可用 = 2 |
| ② | `new Function("return 1+1")()` | 可用 = 2 | **被拦**（逐字相同的 `EvalError`） | 可用 = 2 |
| ③ | srcdoc iframe 内联 `<script>` | **执行**（读到 `script-ran`） | **被拦**：iframe 文档内违规 `{violatedDirective:"script-src-elem", blockedURI:"inline", sourceFile:"about"}` | 执行 |
| ④ | `blob:` 脚本 | 可用（`__blobRan===1`） | **被拦**（`blockedURI:"blob"`） | 可用 |
| ⑤ | 前端卡真实 `HEIGHT_SCRIPT`（从 `srcdoc.ts` 运行时抽取，逐字复刻 `buildCardSrcdoc` 模板） | `heightScriptRan=true`（height=21px） | **false**，height 为空 ⇒ **高度自适应死掉** | — |

补充实测：三页均无 `meta[http-equiv=CSP]`；CSP 页共 5 条违规（parser 内联、eval×2、动态内联、blob），无 CSP 页 0 条。srcdoc iframe 本身不被拦（`about:srcdoc` 可读），被拦的是**它内部的脚本**；加 `sandbox="allow-scripts allow-same-origin"` **仍被拦**（srcdoc 继承父策略）。把 `blob:` 加进 `script-src` 后 blob 脚本立即可跑（违规 5→4），但 ①②③ 仍全被拦。**同源外部脚本在 CSP 下可正常执行。**

**三条硬结论**：

1. 直接 `eval` / `new Function` 在该 CSP 下不可行，除非加 `'unsafe-eval'`。
2. **srcdoc iframe 路线在 CSP 生效时彻底不可行**（`sandbox` 无效）⇒ 必须换载体（iframe 指向真实同源 URL 文档，或独立策略的独立文档）。
3. 唯一**零放宽**路线：用户脚本落成同源真实资源（`script-src 'self'` 实测可执行），但脚本内不得再用 `eval` / `new Function` / 动态内联注入。

**局限（如实标注）**：

- **未验证真实卡片渲染路径**：dev 页加载后 `existingIframesAtProbeStart=[]`（需要登录 + 后端 + LLM 才会生成 ```html 卡片）；③⑤ 用的是"真实抽取的 `HEIGHT_SCRIPT` + 逐字复刻 `buildCardSrcdoc` 模板"构造的等价 srcdoc，**属等价构造，非真实卡片路径**。
- "CSP 生效"是本地 Node http 服务**原样回放 L41 整条头**，不是 nginx 实测（未改配置、未重启容器）；结论只对这条 CSP 字符串成立。
- 生产只验证了 macmini `127.0.0.1:3095` 那一层；**外网 HTTPS 网关是否额外加 CSP 未验证**；生产镜像内配置与仓库 HEAD 的一致性未验证。
- 只测 Chrome 152.0.7977.82，未测 Firefox / Safari。

---

## 9. 未确认项（如实标注，未编造）

1. MVU 内部函数名被 terser 混淆（`$t`/`ct`/`kt`）；**宿主 API 名是未声明的自由变量、不被重命名** ⇒ 宿主 API 名 grep 可信，内部名不可信。
2. `mag_invoke_mvu` / `mag_update_variable` 在 MVU 内部的消费点未定位。
3. MVU 的 jsDelivr 产物（538,090 字符）与 GitHub HEAD 的 `artifact/bundle.js`（573,165 字节）**未逐字节比对**，仅符号集合一致。
4. 本地 `NyaaChat/.ref/JS-Slash-Runner` 副本的版本号未与上游 ref 逐一核对（其 `variables.ts` / `chat_message.ts` / `macro_like.ts` 行为已与 MVU 观测交叉一致）。
5. `registerVariableSchema` 注册后是否代填 zod 默认值、具体报错行为：官方文档未写，未确认。
6. 酒馆助手变量管理器是否有导入/导出：文档页未提、源码未见，未确认。
7. **外网 HTTPS 网关层是否额外下发 CSP 未验证**（只测到 macmini 容器 nginx `127.0.0.1:3095` 这一层）；生产镜像内配置与仓库 HEAD 的一致性亦未验证。
8. **真实卡片渲染路径未实测**（需要登录 + 后端 + LLM 才能产出 ```html 卡片）；§8 的 ③⑤ 是等价构造。
9. `X-Frame-Options: DENY` 同样未下发 ⇒ 站点当前**可被任意站点 iframe 嵌套**（未实测点击劫持影响，仅记录头缺失事实）。

---

## 11. 拍板结论（2026-09-16，用户："拍板全部使用你的推荐决策"）

| # | 议题 | 结论 |
|---|---|---|
| D1 | 范围边界 | ✅ 按推荐：只做「脚本运行层 + 卡片脚本 IO」 |
| D2 | 变量路线 | ✅ **A**（最小补齐，按 B 的第一阶段组织），**不做 C** |
| D3 | 退休守门 | ✅ **①**：只解除 message 的 `variables`；chat 变量用会话自有新字段；`settingsBackup.ts` 不动 |
| D4 | 变量形状 | ✅ **①**：`Array<object>` 恒 1 槽，`swipe_id ≡ 0` |
| D5 | 执行/隔离 | ✅ **①**：同源隐藏 iframe + UI 风险提示（沙箱+postMessage 桥不做） |
| D6 | 变量宏位置 | ⚠️ **① 经实测修正为 ①'**，见下方「修正项 D6-R」 |
| D7 | MVU bundle | ✅ **①** 自托管（记录 commit/日期/sha256） |
| D8 | 落盘字段 | ✅ **①** `CharacterSettings.scripts?` + 双向映射 `data.extensions.tavern_helper.scripts` |
| D9 | 宿主 API 面 | ✅ **①** 只实现 M1–M13（+ `getAllVariables` 等少量 N），未实现者**显式报错** |
| D10 | 脚本库 UI | ✅ 确认（含**拖拽排序**）；不做在线编辑与变量管理器 |
| D11 | 变量层可见性 | ✅ **①** 不新增用户可见 UI；**同步修正 `NyaaChat-Docs` 的 `variables.md`** |
| D12 | P 划分 | ✅ 确认（SSOT 中细化为 P1–P5） |
| D13 | CSP 策略 | ✅ **②** 本阶段不改 CSP；脚本载体抽成可替换的一层；CSP 未下发登记为独立问题 |
| — | 派生决策 | **D14** 前端卡 iframe 注入宿主 API（MVU 的 View 在其内调用 `getAllVariables()`）；**D15** 自托管 vendor（`public/vendor/script-host/`）+ import map 重映射远程 ESM |

### 修正项 D6-R（必须在 SSOT 审核时一并确认）

**D6-①（原推荐）"变量宏只允许出现在动态/关键词激活条目，永久条目命中时只警告"经实测不可行。**

实测（样例卡 `变量列表` 条目）：`constant=True`、`enabled=True`、ST 原始 `position=at_depth` + `extensions.depth=0`、`role=0`，内容为

```
<status_current_variables>
{{format_message_variable::stat_data}}
</status_current_variables>
```

⇒ 该宏正是**永久（constant）条目**，且是 MVU 每轮必须送给模型的变量状态块。按 D6-① 实施的结果是：**样例卡的变量状态块会以字面量发给 LLM，MVU 直接不可用。**

**修正为 D6-①'：永久条目命中变量宏时，自动改由「动态尾部」渲染。**

- 静态前缀（`chatPipeline.ts:797-827` 的 `systemMessages`）保持**逐轮字节一致**，prompt 缓存不受影响；
- 命中的永久条目渲染进 `chatPipeline.ts:829-849` 的动态尾部（与关键词条目同一套 `renderRule` 与 `[tag]` 前缀）；
- 这不只是缓存权衡，而是**比现状更贴合 ST 语义**：ST 里该条目是 `at_depth`/`depth=0`（贴在最新消息前的动态注入），并非真正的"前缀常驻"。
- 不含变量宏的永久条目（如样例卡的 `[mvu_update]变量更新规则` / `变量输出格式`）**仍留在静态前缀**（它们逐轮不变，留在前缀对缓存最优）。
- 附带说明：另一条 `[phone_link]` 条目使用 `{{phone_chat:…}}` 等**其它 ST 扩展的宏**，不在本阶段范围，按原样透传（登记为已知项）。

---

## 12. 下一步

1. ✅ 用户已逐条拍板（见 §11）。
2. ✅ 拍板结果已写入 §11。
3. 🟡 撰写 `开发计划-SSOT.md`（落本目录），含：范围边界、已确认决策、文件级改动清单、P 划分与验收标准、dev 服验证方法、风险与回滚。
4. ⬜ **等待用户审核 SSOT 后**，才发起实际开发指令（`初始设计.md:50`）。

> 附：S5 建议把"CSP 安全头未下发"（`location = /index.html` 的 `add_header` 顶掉服务器级头）作为**独立修复计划**申报。本报告已把它登记为 **D13 + §9 未确认项 7/9**：按 D13-② 本阶段**不修**，仅登记。
