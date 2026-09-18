# EJS-template —— NyaaChat 原生插件

> **一句话**：让「依赖 EJS 的角色卡」在 NyaaChat 里跑起来 —— 把世界书条目正文里的
> `<% %>` 渲染成提示词文本，随本轮请求发出；**只运行依赖 EJS 的卡，不提供 EJS 编写功能**。
>
> **本文定位**：本插件的移植/实现说明（含**保真度损失登记**与**已知风险登记**）。
> 计划与验收 = `开发计划-SSOT.md`（P0–P7 / V1–V10）；引擎语义规格 = `EJS技术性说明.md`；
> 不依赖 LLM 的自测 = `EJS本地自测方法.md`；目录与契约 = `插件框架规范.md`。
> 均位于 `.docs/plugin-system/插件开发_EJS-template/` 与 `.docs/plugin-system/`。
>
> **上游**：ST 扩展 [`zonde306/ST-Prompt-Template`](https://github.com/zonde306/ST-Prompt-Template)
> v1.17.9（AGPL-3.0，`manifest.json` 的 `homePage` 即该地址）与
> `.ref/ST-Prompt-Template/src/3rdparty/ejs.js`（EJS 3.1.9 的改造版，**只读参考**）。
> 取证基准：`master @ 77723ee`，2026-09-18。

## 1. 定位与范围

| 维度 | 内容 |
|---|---|
| **做什么** | 把**世界书条目正文**里的 EJS 渲染成文本，接在「占位符 → 变量宏 → 正则」之后（D16-R 选项 A，与上游顺序一致） |
| **不做什么** | ❌ EJS 编辑器 / 语法高亮 / monaco / 在线修改（SSOT NG1 / D1） ❌ 变量管理器（NG6） ❌ 装饰器 `@@*`、`[GENERATE:*]`、`[RENDER:*]`（NG2） ❌ `@INJECT`（NG3） ❌ Worker 隔离（NG5） ❌ ST 的 character/preset/script/extension 四作用域（NG7） ❌ 按 swipe 分支（NG8） |
| **EJS 的唯一承载位置** | `character_book.entries[*].content`（世界书条目**正文**）。★ 实测：两张目标卡的卡片顶层字段（`description` / `first_mes` / `system_prompt` / `post_history_instructions` / `alternate_greetings` …）**均无 EJS** |
| **触发路径** | 用户点「发送」后的**异步 pre-pass**（`ChatInterface.tsx` 的既有前置段，紧邻 `getActivatedKeywordRules()`），**不是**消息渲染期 |
| **为什么不能做"渲染期 EJS"** | 上游的 `CHARACTER_MESSAGE_RENDERED` 路径本阶段不做（损失 #5），且宿主 10 个插件事件**无优先级、无返回值**（`src/plugins/types.ts:78-98`） |
| **注册信息** | `meta.id = "ejs-template"`；`meta.name = "EJS模板"`；`icon = "Sparkles"`（12 项白名单内）；`order = 20`；`version = "1.0.0"` |

## 2. 文件职责（契约见 SSOT §2.4）

| 文件 | 职责 |
|---|---|
| `plugin.tsx` | `NyaaPlugin` 装配：`meta` / `defaults` / `setup` / `SettingsPanel` |
| `registry.ts` | 向宿主叶子模块 `src/plugins/promptText.ts` 注册渲染器（`registerPromptTextRenderer`） |
| `engine/syntax.ts` | 定界符扫描（`<%_` / `_%>` / `-%>` / `<%=` / `<%-` / `<%#` / `<%` / `<%%`），**最长匹配优先**（M1/M2） |
| `engine/compile.ts` | 源码生成：模板 → **函数体源码字符串**（纯字符串，不碰 `eval`/`new Function`，M3/M4/M5/M6/M7） |
| `engine/escape.ts` | `escapeXML`（五字符：`&amp; &lt; &gt; &#34; &#39;`，M10） |
| `lodashSubset.ts` | lodash 9 函数内联子集（含**可控随机源注入点** `__setRandomSource`，D15） |
| `host/env.ts` | env 快照组装（变量三作用域 + 世界书索引 + 身份 + `YAML`）、未实现符号抛错桩、写入意图收集 |
| `host/carrier.ts` | 轻量 srcdoc 载体：普通 `<script>` 注入 / `postMessage` 握手 / 超时 / 销毁 |
| `host/renderEntry.ts` | 单条目渲染编排（幂等：每轮每条目**恰好渲染一次**，D9） |
| `EjsTemplateSettings.tsx` | 最小 UI（见 §9） |
| `errors.ts` | **错误归类与用户可读文案**（见 §7）；**零依赖叶子** |
| `README.md` | 本文件 |

> 插件只允许两类静态边：`src/plugins/types`（type-only）与叶子模块
> `src/plugins/promptText` / `scriptHost` / `pluginLog`。**禁止**值导入
> `src/plugins/{index,runtime,registry,backend}` —— 会形成模块环，插件会静默消失（SSOT §5）。

## 3. 数据流

```
用户点发送
  └─[已有] web search → KB search
       └─[新增] await preparePromptText(activatedRules, ctx)   ← 宿主 pre-pass
            ├─ 宿主：复现前缀链（占位符 → 变量宏 → 正则，D16-R 选项 A）
            ├─ 若 needsPromptText：交给本插件的渲染器
            │     ├─ host/env.ts   组 env 快照（结构化克隆进载体）
            │     ├─ host/carrier.ts  生成源码 → 内联注入 → 执行 → 回传 { text, writes }
            │     └─ host/renderEntry.ts  单条目编排 + 写入意图收集
            └─ 结果按 rule.id 缓存到本轮快照（每轮每条目恰好渲染一次）
  └─ buildRequestMessages(...)   ← 保持同步纯函数
       └─ 尾部 <session_rules> 新增「═ 模板设定 ═」小节（仅在存在含 EJS 条目时产出）
```

**未启用插件时逐字节等价**：无渲染器注册 ⇒ `needsPromptText ≡ hasVariableMacro`，
尾部 `tailParts` 与改造前完全一致（SSOT §2.3 / P4 验收）。

## 4. 与上游的逐项对照

| # | 上游（`ST-Prompt-Template`） | 本插件 | 处理 |
|---|---|---|---|
| 1 | `[ejs.js]` 整包 `import`（模块加载期 `:110` 就 `new Function`） | **只用其语义**，自实现 `engine/` | **重写**：当前 CSP 无 `'unsafe-eval'`，整包引入立刻报错（且报错点与"编译"无关，极易误判） |
| 2 | `compile()` = `generateSource()` + `new Function`/`AsyncFunction`（`:664`） | 只取**源码字符串**，由载体拼成 `async function anonymous(locals, escapeFn, include, rethrow) { … }` 并**内联注入普通 script** | **换执行方式**：`with (locals \|\| {})` 需要非严格模式 ⇒ 必须是普通 `<script>`，不能是 module |
| 3 | opts：`async:true` / `outputFunctionName:'print'` / `_with:true` / `localsName:'locals'` / `client:true`（`[ejs.ts]:127-133`） | 逐项对齐（M7/M9） | **原样对齐** |
| 4 | 事件钩子 `CHAT_COMPLETION_SETTINGS_READY` 逐条改写消息（`[handler.ts]:201-210`） | 宿主「条目文本渲染缝」（`promptText.ts` + pre-pass） | **重写**：不移植事件模型（宿主事件无优先级/无返回值） |
| 5 | 每条消息顺序：宏 → 正则 → EJS（`[handler.ts]:264-265`） | pre-pass 先复现前缀链，再跑 EJS（D16-R A） | **顺序一致** |
| 6 | 渲染结果**追加**到消息内容（`:289`） | 条目文本被渲染结果**替换**后进尾部「模板设定」小节 | **差异（登记）**：宿主按"条目 → 文本"渲染，没有 `before/after` 语义 |
| 7 | env ≈ 60 个符号 + `_`/`$`/`z`/`toastr`/`console` | **7 个符号 + lodash 9 函数**（`getvar` / `getMessageVar` / `setvar` / `setMessageVar` / `getwi` / `YAML` / `_`） | 其余**显式抛错**（§6） |
| 8 | `YAML` 由**页面全局**（酒馆助手生态）提供 | 由本插件**自己放进 env**，用同一份自托管产物 `public/vendor/script-host/yaml/yaml.esm.js`（eemeli/yaml） | ⚠️ ★ P0 实测发现：5 次调用、两张卡都用；JSR 只把 `YAML` 挂在 **iframe** 的 window，主页面没有 |
| 9 | `_.random` / `_.sample` / `_.sampleSize` 真随机 | 同语义，但暴露 `__setRandomSource(fn)` 供基准/自测注入**确定性序列** | 输出非确定 ⇒ 验收必须打桩（D15） |
| 10 | 沙箱（`FunctionSandbox`，默认关） | 不做 | 载体与宿主同源、未加 `sandbox`（与 JSR 既有形态一致） |

## 5. 保真度损失登记（**必须如实登记，不得声称完全复刻**）

| # | 损失 | 具体表现 | 后果 | 处置 |
|---|---|---|---|---|
| **1** | **`getwi` 只能读当前角色世界书** | 数据源是 `getScriptHostApi().lorebook.getEntries()`（`src/plugins/scriptHost.ts:91-97`），**没有全局书**；上游 `loadWorldInfo(name)` 可读任意书（含全局书） | 模板若 `getwi('别的书名')` 永远拿不到内容（返回 `null`，与上游 `content \| null` 口径一致） | 登记（K5）；不伪造数据 |
| **2** | **`'initial'` 无对应物；`'cache'` 由合并视图近似** | NyaaChat 只有 `message` / `chat` / `global`。上游**读缺省就是 `'cache'`**（`[variables.ts]:437` 的 `switch (scope \|\| 'cache')`），其语义可由 `global → chat → message` 合并视图复现（`:52-59` 的 `cacheVars`）—— 故 env 侧**实现为等价视图、不抛错** | **残留缺口（这条高保真的代价）**：① 若某键的**唯一来源是 `[InitialVariables]` 装饰器条目**（**NG2 不做** ⇒ 在 NyaaChat **永不初始化**），则上游 cache 视图**本应含它**、而我们会**静默**回落 `defaults`（对其它缺失键的静默回落与上游一致、**不构成偏差**）；② 缺上游 `cacheVars` 的 `_trace_id` / `_modify_id` 簿记键（5 卡 0 命中） | `'initial'` ⇒ **显式抛错**（`UNSUPPORTED_ENV_FEATURES` 登记）；`'cache'` ⇒ 合并视图（message 胜）。⚠️ **不可混淆**：NyaaChat 的 `[initvar]`（被禁用条目，JSR/MVU 侧）**≠** 上游 `initialVariables` ⇒ **非 P6 可验项**（无对应运行路径）；5 卡 0 命中。 |
| **3** | **无 `flags`** | ST 的 `flags:'nx'/'xx'/'nxs'`（写变量的条件语义，如"仅当不存在时写"）在 NyaaChat 无对应物 | `setvar` / `setMessageVar` 带 `flags` 时若忽略 ⇒ **静默改变卡的行为** | **显式抛错**（不静默忽略）；`UNSUPPORTED_ENV_FEATURES` 登记 |
| **4** | **无 group 概念** | 群聊上下文（`groups` / `groupId` / 群成员身份）不存在 | 依赖群聊身份的模板拿不到该上下文 | 登记；不实现假 group |
| 5 | 渲染期 EJS **不做** | `[RENDER:*]` / 楼层渲染（`CHARACTER_MESSAGE_RENDERED` 路径）不实现 ⇒ 卡片顶层字段与消息正文里的 EJS **不渲染** | ★ 实测两张目标卡都未使用 | 登记（NG）；本阶段只做提示词侧 |

**环境限制（仅 Node / tsx 自测，非产品行为）**：`host/env.ts` 用 `import.meta.url` 推算 vendor YAML 真实路径 ⇒
在 **Node / tsx** 下解析到仓库外（**仅 Node 复现，浏览器正确**）、YAML 预热失败、用 `YAML.stringify` 的模板降级；
出处 `dev-server/tools/verify-ejs-host.ts` 头部注释（该行只打成提示、**不计入判定**）。

> 另有 6 项**未确认**（U1–U6，见 `EJS技术性说明.md` §7），其中与产品行为相关的是
> **U6：更广卡池可能出现在本清单外的语法/符号** —— 政策是**未实现即显式抛错**，不做假想补全。

## 6. 未实现符号：显式抛错纪律（D11）

**权威清单（单一来源）**：`errors.ts` 的 `UNIMPLEMENTED_EJS_SYMBOLS`（**27 项**，来源 = SSOT §6 +
`EJS技术性说明.md` §4.3）。该数组是**全插件的运行时权威**，其余位置一律不另抄一份：

- `host/env.ts` 的 `import { UNIMPLEMENTED_EJS_SYMBOLS } from "../errors"` + 原样再导出
  `UNIMPLEMENTED_ENV_SYMBOLS`（同一数组引用 ⇒ `===` 成立；下游 `carrier.ts` 等沿用旧名）；
- `host/carrier.ts` 用它重建"env 快照被结构化克隆、函数桩被静默丢掉"时的抛错桩表
  （`buildUnimplementedTable`）⇒ 漏一项会在该降级路径退化成原生 `ReferenceError`；
- 依赖方向是 `env → errors`，而 `errors.ts` **零 import**（静态 import 边数 = 0）⇒ 无环（叶子纪律见 §11）。

> ⚠️ 本 README 的跨文件引用**一律以符号名为准**（**不写行号**）：行号会随各自编辑漂移，
> 写死只会让文档反复变假；`file:line` 若出现在别处，一律视为"核对时点"的快照、**不作判据**。

⇒ **增删符号只改 `errors.ts` 一处**；两处清单"必须一致"这件事已由类型系统保证，不再靠人工对拍。

```
getchr getchar getprp getpreset getqr getQuickReply activewi
execute injectPrompt getPromptsInjected define evalTemplate findVariables activateRegex
getChatMessage getChatMessages matchChatMessages
applyVarYamlAnnotate setVariableSchema jsonPatch parseJSON
SillyTavern faker toastr z $ include
```

> **`$` 的口径（已定）**：上游的 `$` 是 ST 页面的 jQuery 全局。NyaaChat **有** jQuery，但只注入
> JSR 的 script-host iframe（`src/plugins/scriptHostImpl.ts:221` 的 `/vendor/script-host/jquery.min.js`），
> **EJS 载体不注入**；且 SSOT §6 已把 `$` 列入"未实现 ⇒ 显式抛错"（5 卡实测 0 命中）。
> ⇒ 保持抛错。若未来某张卡确实需要，正确路线是把**同一份 vendor 产物**注入载体
> （而不是自造一个只会静默失败的假 `$`），且先走一次范围评审。

**纪律（照抄 JSR D9，`plugins/js-slash-runner/executor/predefine.ts:662-737`）**：

- 调用即 **显式抛错**，**绝不静默返回 `undefined`** —— 静默 `undefined` 会让 `getchr()` 参与字符串
  拼接后产出"看着正常、实则错误"的提示词，比直接失败危险得多；
- 错误文案**必须含符号名**（判据 O7 / V8：调 `getchr` ⇒ 文案含 `getchr`）；
- 两条"逃生门"（上游 `[ejs.ts]:220-223` 的 `execute` 与 `SillyTavern`）在 NyaaChat **不提供**
  （无 STscript 引擎、无 `SillyTavern` 全局）；
- `include()` 在本插件与上游 `client: true` 模式下**同样不存在** ⇒ 一并按未实现符号抛错；
- **不得**为了让某张卡"跑起来"而临时放开清单项 —— 需要新增能力就走一次范围评审。

## 7. 错误文案与降级（`errors.ts`，K3）

### 7.1 契约

```ts
/** 冻结契约（t8，勿改）：错误 → 用户可读文案 */
export function describeEjsError(
  err: unknown,
  ctx: { entryName: string; entryId?: string; symbol?: string },
): { title: string; detail: string };
```

- `ctx.entryName`：**条目名**（契约必填）⇒ 文案必须能指出"哪一条"；
  省略 `ctx` 时退化为「某个条目」并在 detail 里提示调用方补名（只放不缩，不报错）；
- `ctx.entryId`：可读定位（如 `book[9]`）——实现里亦接受 `number`；
- `ctx.symbol`：**符号名**（env 桥 / 载体按它点名未实现符号，如 `getchr`）；
  另有等价别名 `symbolName`，以及可选的 `phase` / `blockIndex` / `line` / `templateChars`；
- `title`：**单行**，含条目名 + 首行原因（未实现符号则含符号名）⇒ 可直接交给 `pluginLogger`；
- `detail`：多行（条目 / 符号 / 阶段 / 定位 / 模板字符数 / 原因 / 位置 / 提示 / 处置）。

**三条硬纪律**（文件头也写着）：

1. **零依赖**：不 `import` 任何宿主模块，也不 import 插件内其它模块（纯叶子）；
2. **不回显模板原文**：原因只取错误信息的**首个非空行**（上游 `rethrow` 的 `>>` 标记行另作"位置"行），
   两者都先剥离 `<% … %>` 片段、再按上限截断 —— 138K 字符的条目正文永远不进日志/界面（SSOT §2.7）；
3. **自身不抛错**：任何输入（`null` / 循环引用 / 符号 / 函数 / 随便一个字符串）都返回文案，
   降级路径上不允许"格式化错误"再抛一次。

另外导出：`EjsTemplateError`（带 `code`/`phase`/`symbolName`）、六个抛错工厂
（`ejsUnimplementedSymbolError` 等，供 `env.ts` / `carrier.ts` / `engine` 统一文案）、
`toEjsErrorPayload` / `fromEjsErrorPayload`（跨 `postMessage` 传输，Error 实例的自定义字段过不了结构化克隆）、
`formatEjsErrorLine`（等价于 `title` 的单行摘要，给 UI 的 `lastError` 用）、
`isUnimplementedEjsSymbol`。

### 7.2 真实输出样例（用本文件交付时的代码实跑，非手写）

```
CASE 未实现符号（env.ts 抛错 → carrier 串成字符串 → UI）
TITLE  条目「实力至上主义教室 · 状态栏」调用了未实现的符号 getchr
DETAIL 条目：实力至上主义教室 · 状态栏（book[9]）
       符号：getchr（未实现 ⇒ 显式抛错，不静默返回 undefined）
       阶段：运行期（模板体执行）
       原因：EjsSymbolNotImplementedError：EJS 模板用了本插件尚未实现的符号「getchr」：…
       处置：该条目本轮已丢弃（原文不进请求），其余条目不受影响，生成不被阻断（K3 按条目降级）。

CASE 模板语法错（真·上游 rethrow 消息，含 3000 行模板上下文）
TITLE  模板错误：条目「变量列表」渲染失败 — SyntaxError：Unexpected token '{' while compiling ejs
DETAIL 条目：变量列表
       阶段：编译期（定界符扫描 / 源生成）
       定位：第 5 个 EJS 块
       模板：138204 字符（一律不回显原文）
       原因：SyntaxError：Unexpected token '{' while compiling ejs
       提示：源生成缺陷，核对 M3（逐模式源生成）与 M4（stripSemi + // 补换行）
       处置：该条目本轮已丢弃（原文不进请求），其余条目不受影响，生成不被阻断（K3 按条目降级）。

CASE 超时
TITLE  模板超时：条目「日历内容」渲染超时（已按条目降级）
```

### 7.3 降级语义（SSOT §2.7 / K3）

| 情形 | 处置 |
|---|---|
| 模板编译错 / 运行错 | **丢弃该条目内容**（绝不把 `<% %>` 原文发给 LLM）+ 记录错误 + 日志可见 + **不阻断生成** |
| 载体超时 | 同上（按条目降级，不影响其它条目） |
| 调用未实现符号 | **显式抛错**；文案含符号名与条目名（§6） |
| 无渲染器结果但 `needsPromptText` 为真 | 回退原文 + **一次性**告警（避免逐轮刷屏） |

## 8. 已知风险登记

### K1 —— 模板死循环冻结应用（**发送路径**，high）⚠️

- **机制**：载体是同源 iframe ⇒ **与主页面共享事件循环**；模板里的 `while(true)` 会把整个应用卡住。
- **为什么比 JSR 的 K4 更严重**：JSR 的 K4（`插件开发_JS-Slash-Runner/开发计划-SSOT.md:751`
  「同源 iframe 共享事件循环 ⇒ 死循环冻结应用」）触发面是**脚本执行路径**（用户在脚本库里主动跑脚本）；
  本插件的 K1（`审计报告-EJS模板渲染层.md:341`「模板死循环冻结应用（发送路径上，比 JSR K4 更严重）」）
  发生在**发送路径**的 pre-pass —— 用户点「发送」之后、请求组装之前，而且**随卡自动触发**，不需要用户主动操作。
- **诚实的补充**：`setTimeout` 计时器与死循环在**同一事件循环**上 ⇒ **超时对真死循环无效**；
  块数/字符数软上限（`EJS_SOFT_CAP_MAX_BLOCKS=600`、`EJS_SOFT_CAP_MAX_CHARS=200000`、
  载体超时 `EJS_SOFT_CAP_CARRIER_TIMEOUT_MS=15000`，见 `EjsTemplateSettings.tsx`）只能拦住
  **"超规格条目"**，不能中断已经跑起来的死循环。当前 CSP 下无 Worker（D6/D12）⇒ **只能登记**。
- **缓解**：UI 常驻明示（`EJS_K1_NOTICE_TEXT`）+ 软上限 + 每轮每条目恰好渲染一次（不放大损失）。
- **回滚**：停用插件 ⇒ 缝隙退化为 `hasVariableMacro`，行为回到改造前。

| # | 风险 | 等级 | 缓解 | 回滚 |
|---|---|---|---|---|
| **K1** | 模板死循环冻结应用（发送路径） | high | UI 明示 + 块数/耗时软上限；**不做** Worker | 停用插件（宿主缝隙无渲染器时逐字节等价，**无需回滚宿主代码**） |
| K2 | R-a 误触发（EJS 输出含合法 `<session_conventions …>`） | low | 登记 + 注释说明 | 同上 |
| K3 | 模板抛错 | medium | **按条目降级** + 日志可见（§7） | 同上 |
| K4 | 自实现引擎语义偏差 | medium | 黄金基准 57 条目逐字节比对（P1） | 引擎可独立回退（不改宿主） |
| K5 | `getwi` 保真度损失 | low | §5 登记 | — |

## 9. 最小 UI（SSOT §8）

面板 = `EjsTemplateSettings.tsx`（`ExtensionsModal` 详情页）。

| 区块 | 内容 |
|---|---|
| 安全提示（常驻） | 同源运行（隐藏 iframe，未加 `sandbox`）+ 只渲染可信来源的卡 + **K1 明示**（含软上限的具体数值） |
| 启用开关 | **复用框架**（插件详情页头部的开关 + `AppState.plugins['ejs-template'].enabled`）；面板内**只读**显示运行时是否已装配，不做第二套 |
| 本轮渲染统计 | 渲染条目数 / 命中 `matches` 数 / EJS 块数 / 耗时 / 降级条目数 / 变量写入数（`useSyncExternalStore`）+ 逐条目明细 + 「清空统计」 |
| 试渲染（只读） | 选一个含 EJS 的条目，用当前变量快照渲染一次并展示；**新建临时载体、`finally` 里销毁**，**不提交写入**（丢掉的写入意图如实计数） |
| 运行日志 | `pluginLogger` / `getPluginErrors` / `subscribePluginErrors` 的环形缓冲（保留最近 20 条），**非仅 console** —— 这是 `ST扩展移植规范.md` §10.2 坑 #6 的教训 |
| 明确不做 | EJS 编辑器 / 语法高亮 / 在线修改 / 变量管理器（NG1 / NG6） |

## 10. 验证方式

**不依赖 LLM 的自测载体** = `.docs/plugin-system/插件开发_EJS-template/EJS本地自测方法.md`（命令、观测点、失败对照表都在那里）：

```powershell
cd H:\GitHub\NyaaChat

npx tsx dev-server/tools/verify-ejs-golden.ts      # P0：产出黄金基准（57 条目 / 1002 块 / 161,256 字符）
npx tsx dev-server/tools/verify-ejs-engine.ts      # P1：自实现引擎 vs 黄金基准，逐块逐字节比对
python dev-server/tools/verify-ejs-host-smoke.py   # P2/P3/P4：载体 + env 端到端烟测（需 headless 浏览器）
```

| 观测点 | 判据 |
|---|---|
| O1 / O2 | 57 条目 ok、failed 0；代码字符总量 161,256（与审计报告 §4.2 逐项一致） |
| O3 / O4 | 逐块差异 **0**；无差异上下文 |
| O5 | 产物里 `eval(` / `new Function` 命中 **0**（源码 grep ∪ 产物 grep 双方法交叉） |
| O6 | 随机源打桩有效：同输入两次逐字节相同；换源后**确实变化**（反向验证） |
| O7 | 调 `getchr` ⇒ **抛错**且文案含 `getchr`（**不允许**是 `undefined`） |
| O8 | 无 `<%` 的文本 `matches === false`，且输出 === 输入（M11 短路） |
| O9 | 载体端到端：1 块渲染成功、无残留 iframe、无 CSP 违规、注入是**普通 script** |
| O10 | 尾部 system 计数 = 1，且次末条非 system（V4） |
| V3 / V7 / V8 | 请求体扫描 `<%` 命中 0；必抛模板 ⇒ 该条目降级、其余正常、生成完成、日志有记录；未实现符号显式抛错 |
| V9 | 文档 K1 存在 + UI 安全告知可见 |

**本轮 `errors.ts` 的验证记录**（t8）：

- `npx tsc --noEmit`：`errors.ts` **0 错**；`npx eslint plugins/EJS-template/errors.ts` 退出码 **0**；
- 探针（`.verify-tmp/`，跑完删除）：用 `env.ts` 真实抛错串、**真·上游 `rethrow` 消息**、
  57810 字符的单行消息（模拟 138K 条目）分别喂入 `describeEjsError` ⇒ 标题含条目名与符号名 / 首行原因；
  **模板片段一律未回显**（`LEAK var v2999 PRESENT = false`，`detail` 长度 ≤ 1200）；
  畸形输入（`null` / `undefined` / 循环引用 / `Symbol` / 函数 / 数字）**全部不抛错**；
- 契约形态另测：`describeEjsError(err, { entryName, entryId, symbol })` ⇒ 即使抛的是裸 `Error`，
  `ctx.symbol` 也能让文案点名该符号（`标题 = 条目「状态栏」调用了未实现的符号 getchr`）。
- **符号名点名的形态矩阵**（交付后按 plugin-ui 的集成问题补测，`ALL_PASS`）：8 个符号
  （`getchr` / `getqr` / `include` / `$` / `z` / `toastr` / `SillyTavern` / `faker`）在
  **env.ts 真实形态**（`name + message` 经 carrier 的 800 字符截断）、**本插件工厂消息形态**
  （`未实现的 EJS 符号：getchr`，★ 修复前会被宽松正则咬成 `EJS`）、
  **工厂错误字符串化形态**（字段丢失、只剩 `name + message`）、**原生 `ReferenceError` 形态**
  （`toastr is not defined`）下**全部点名正确**；负向对照（`SyntaxError: Unexpected token '}'`）
  不得被误判为"未实现" ⇒ 通过。
  修复内容：`SYMBOL_PATTERNS` 改为**精确形态优先**、并在多候选中**优先取命中未实现清单者**。
- **清单单一来源的结构验证**（与 env-bridge 对齐后补测）：`host/env.ts` 的
  `import { UNIMPLEMENTED_EJS_SYMBOLS } from "../errors"` 与原样再导出 `UNIMPLEMENTED_ENV_SYMBOLS`
  （下游 `carrier.ts` 沿用旧名）⇒ 两处"必须一致"由类型系统保证，不再靠人工对拍；依赖方向
  `env → errors` 单向、`errors.ts` 零 import ⇒ 无环（全量 `npx tsc --noEmit` exit 0 即证明该导出链成立）。

## 11. 落地约束（红线）

- **无 `eval` / `new Function`**：引擎只产出源码字符串，执行靠内联 `<script>`（D5/D6；`nginx.conf:51/95` 的 CSP 无 `'unsafe-eval'`）；
- **`with` 需非严格模式** ⇒ 注入必须是**普通 `<script>`**，用 module 会得到
  `SyntaxError: Strict mode code may not include a with statement`（自测方法 §2.2）；
- **CSP 保持现状**，不为本插件放宽（与 JSR K1 的收窄方向一致）；
- **叶子模块纪律**：插件只允许 type-only 依赖 `src/plugins/types` 与叶子 `promptText` / `scriptHost` / `pluginLog`；
- **条目级降级，不阻断生成**；任何失败路径都**不得**把 `<% %>` 原文送进请求（V3）；
- **每轮每条目恰好渲染一次**（D9）：`setvar` 提交次数 = 激活且含 EJS 的条目数（V6）。

## 12. 参考

| 文档 | 用途 |
|---|---|
| `开发计划-SSOT.md` | 决策 D1–D16R、架构、P0–P7、V1–V10、风险与回滚 |
| `EJS技术性说明.md` | 引擎语义规格（M1–M12）、env 全清单、未实现符号、保真度损失、未确认项 |
| `EJS本地自测方法.md` | 三条可复跑命令、观测点 O1–O10、失败对照表、真机快照字段 |
| `审计报告-EJS模板渲染层.md` | K1 的原始登记（§11 风险表）与方案取舍 |
| `插件框架规范.md` | 目录/构建模型、`NyaaPlugin` 契约、注册步骤、消息装饰、后端能力 |
| `.ref/ST-Prompt-Template/src/3rdparty/ejs.js` | 语义基准（**只读**，不改） |
| `.ref/EJS/*.json` | 5 张卡样本（2 张依赖 EJS）；黄金基准的夹具来源 |
