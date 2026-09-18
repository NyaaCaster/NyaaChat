# EJS 模板渲染层（NyaaChat 插件）—— 审计报告

> **状态**：✅ **已拍板**（2026-09-18，用户："全部使用推荐"）—— 见 §11 拍板结论。本报告不含任何代码改动。
> **上游依据**：`.ref/EJS/ST-Prompt-Template移植可行性评估.md`、`.ref/EJS/ST-Prompt-Template-卡依赖实测与范围收窄.md`（两者已按用户要求移出代码仓库管理范围）
> **项目内规范**：`.docs/plugin-system/插件框架规范.md`、`.docs/plugin-system/ST扩展移植规范.md`、`.docs/llm-chat-prompt-architecture-standard.md`、`.docs/plugin-system/插件开发_JS-Slash-Runner/*`（先例）
> **取证时点**：2026-09-18，基准 `master @ 77723ee`（工作树干净）
> **目标插件**：目录 `plugins/EJS-template/`，`meta.id = "ejs-template"`，UI 名 `EJS模板`

---

## 1. 取证基线与方法

| 项 | 值 |
|---|---|
| NyaaChat 侧 | 直接读 `src/**` 磁盘真值；关键结论给 `路径:行号` |
| 上游侧 | `.ref/ST-Prompt-Template`（v1.17.9，AGPL-3.0） |
| 卡样本 | 5 张真实角色卡（`.ref/EJS/*.json`，其中 2 张依赖 EJS） |
| 规模口径 | 行数用 `(Get-Content).Count`（非 `Measure-Object -Line`） |
| 未跟踪路径 | `plugins/**`、`src/plugins/**`、`.docs/plugin-system/**` 均为**未跟踪** ⇒ 残留/存在性判定一律 `git grep` ∪ 文件系统扫描**双方法交叉** |
| 许可证 | NyaaChat 与 ST-Prompt-Template **同为 AGPL-3.0**（`LICENSE` 首行一致） |

---

## 2. 需求来源（用户明确定义的范围）

用户原话（2026-09-18）：

> 「如果向 NyaaChat 移植 ST 的提示词模板扩展，并且在 NyaaChat 侧**只针对依赖 EJS 块和类扩展符号的角色卡运行**的需求，而**不在 NyaaChat 提供 EJS 的编写功能**的话，是否可以像移植酒馆助手时一样，只在 NyaaChat 内以扩展插件的方式重写必要的接口，全量迁移入 EJS 块、EJS 内扩展符号这样底层，不需要 ST 提示词扩展的[其它]功能，同时像脚本运行器在 NyaaChat 的扩展插件中自建一套最小必要 UI（包括启动开关、报错和日志查询，以脚本运行器的成功样例为借鉴）」

**据此固化的范围**：

| 纳入 | 排除 |
|---|---|
| 让**依赖 EJS 的角色卡能跑**（世界书条目正文里的 `<% %>` 渲染进提示词） | ❌ EJS 编写/编辑功能（无代码编辑器、无 monaco） |
| EJS 引擎的**源码生成 + 执行**两步 | ❌ 世界书条目装饰器（`@@*`）、`[GENERATE:*]`、`[RENDER:*]`、`[InitialVariables]`、`[Preprocessing]` |
| EJS 内**实测用到的**扩展符号（6 个 + lodash） | ❌ `@INJECT` 提示词注入（**NG4，已拍板不做**） |
| 最小 UI：启用开关 + 报错/日志查询（借鉴脚本运行器） | ❌ ext-host / nginx 后端（纯前端） |

---

## 3. 现状盘点：NyaaChat 侧

### 3.1 提示词组装管线（缝隙必须落在这里）

**唯一组装函数**：`buildRequestMessages(args): ApiMessage[]` —— `src/lib/chatPipeline.ts:714`，**同步纯函数**，**唯一调用点** `src/components/ChatInterface.tsx:1016`。四段结构：

| 段 | 内容 | 位置 |
|---|---|---|
| 静态前缀 | 会话协议锚点 + 用户 persona + **角色 description** + **PERMANENT 世界书（不含变量宏者）** | `chatPipeline.ts:851-875` |
| 历史 | 过滤 system/图像气泡，逐条跑 prompt 正则 | `:771-781` |
| 最新 user | 真实文本 + 易变块（memory、search） | `:789-813` |
| 动态尾部 | KEYWORD 世界书（硬/软）+ **含变量宏的 PERMANENT 条目** + MCP 规则 → 单条 system | `:877-944` |

**变量宏分流范式（EJS 的对口先例）**：

```ts
// chatPipeline.ts:843-844 —— 含变量宏的永久条目被移出静态前缀、改由动态尾部渲染
const staticPermanentRules  = permanentRules.filter((r) => !hasVariableMacro(r.content));
const dynamicPermanentRules = permanentRules.filter((r) =>  hasVariableMacro(r.content));
// :833 —— 尾部渲染点
const macroed = allowVariableMacros ? substituteVariableMacros(named) : named;
```

**⚠️ 硬约束（本次取证最重要的一条）**：尾部是**一条** system 消息，由若干 block 拼成（`chatPipeline.ts:911-944`）：

```
blocks = [ <session_rules>…</session_rules>?, <output_constraints>…</output_constraints>?, <FLAGALAC_BYPASS_TAG …>? ]
return [{ role: "system", content: blocks.join("\n\n") }]      ← 有且仅有一条
```

源码注释把它写成不变量：*"One trailing system message is an invariant api.ts depends on"*（`:920-922`）。判定在 `api.ts:364`：

```ts
if (last.role !== 'system' || prev.role === 'system') return messages;   // 相邻两条 system ⇒ 放弃折叠
```

⇒ **EJS 内容只能并入 `blocks`，绝不能另起第二条尾部 system**；否则在 Gemini / 非 Opus 的 Claude 上尾部被 provider 拽回开头 ⇒ 丢近因 + 每轮击穿前缀缓存（`llm-chat-prompt-architecture-standard.md:107,154`）。

### 3.2 变量层（env 的数据源之一）

| 能力 | 位置 | 备注 |
|---|---|---|
| 三作用域 `message` / `chat` / `global` | `src/lib/variables/types.ts:14` | ST 的 `local` ⇄ NyaaChat 的 `chat` |
| `getVariableAtPath(path, scope, option)` | `src/lib/variables/api.ts:102` | **路径读**（点/斜杠均可） |
| `setVariableAtPath(path, value, scope, option)` | `api.ts:114` | **路径写**（⚠️ 见 G4：脚本宿主门面**未暴露**它） |
| `updateVariablesWith(updater, scope, option)` | `api.ts:67` | 门面暴露的写入口 |
| `messageId: 'latest'` 语义**已对齐酒馆助手** | `types.ts:14-21` | 直接复用 |
| 门面：`ScriptHostVariableApi`（7 个成员） | `src/plugins/scriptHost.ts:24-45` | **无 `setVariableAtPath`** |

### 3.3 脚本宿主门面（env 的另一数据源：世界书）

```ts
// src/plugins/scriptHost.ts:91-97
export interface ScriptHostLorebookApi {
  getSettings(): { world_info: { global: null } };        // 兼容壳：NyaaChat 没有全局世界书
  getCharLorebooks(): { primary: string | null; additional: string[] };
  getEntries(bookName?: string): ScriptHostLorebookEntry[]; // 含 enabled:false 的
}
```

`ScriptHostLorebookEntry` = `{ id, comment, content, enabled, constant, keys, position }`（`scriptHost.ts:81-89`）⇒ **足以实现 `getwi(名)`**（按 `comment`/`name` 匹配）。

### 3.4 插件框架与生命周期（⚠️ 一个时序陷阱）

| 事实 | 位置 |
|---|---|
| `NyaaPlugin` = `meta`/`defaults`/`setup`/`SettingsPanel`/`decorators`/`backend` | `src/plugins/types.ts:116-125` |
| `PluginContext` = `meta`/`getConfig`/`updateConfig`/`callBackend`/`on` | `types.ts:90-98` |
| 事件 10 个，全部**只读广播** | `types.ts:78-88` |
| 插件 `setup()` 由 `syncPluginRuntime()` 触发 | `src/plugins/runtime.ts:267-277, 308-326` |
| `syncPluginRuntime` 调用点 | **`App.tsx:940`**（`useEffect`，deps `[settings.plugins]`，起始 L939） |
| `setScriptHostApi()` 调用点 | **`App.tsx:988`**（`useEffect`，deps `[]`，起始 L949） |

**⇒ React 按声明顺序执行 effects：L939 的 effect 先于 L949。** 也就是说：

> **插件的 `setup()` 执行时，`getScriptHostApi()` 仍是 `null`。**

这是一条**必须写进 SSOT 的硬约束**：env 桥**不得在 `setup` 期缓存** `getScriptHostApi()` 的返回值，必须**每次渲染时按需取用**。否则会复现 JSR 那轮踩过的"空快照"型缺陷（`阶段交接…JS-Slash-Runner.md` §1.14：`identity` 空快照 ⇒ 静默失效）。

**叶子模块纪律**：插件树只允许两类静态边 —— `src/plugins/types`（type-only）与**叶子模块**（`hostContext.ts` / `scriptHost.ts`）。反向：`registry`/`runtime`/`backend`/`index` 均含插件注册表 ⇒ **值导入会构成模块环，插件静默消失**（移植规范 §10.4）。

**已注册插件**：`plugins/registry.ts` = `[quoteTts, jsSlashRunner]`，本次追加第三项。

**图标白名单（12 项）**：`AlertTriangle / ArrowLeft / Book / Flame / Loader2 / MessageSquare / Puzzle / Search / Settings / Sparkles / Volume2 / VolumeX`（`src/components/ExtensionsModal.tsx:92-105`），表外名称**静默回退 `Puzzle`**（`:111-121`）。
> 既有缺口实证：`js-slash-runner` 声明 `icon: "FileCode2"`（`plugins/js-slash-runner/plugin.tsx:177`）**不在白名单内** ⇒ 该插件实际显示 Puzzle。本插件**必须从白名单取值**。

**命名约束**：`meta.id` 必须匹配 `/^[a-z0-9][a-z0-9-]*$/`（`src/plugins/registry.ts:20`）⇒ 目录名 `EJS-template` **不能**直接当 id，须用 `ejs-template`。

### 3.5 CSP 与执行原语

```
nginx.conf:51（server 级） / :95（location = /index.html，SPA 回退命中）
  default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https: …;
  img-src 'self' data: blob: https:; style-src …; font-src …;
  frame-ancestors 'none'; base-uri 'self'; form-action 'self'          ← 无 unsafe-eval
grep worker-src|script-src-elem|unsafe-eval nginx.conf  → 空
```

| 结论 | 依据 |
|---|---|
| **`eval()` / `new Function()` 被禁** | 无 `'unsafe-eval'` ⇒ 规范行为 |
| **内联 `<script>` 允许** | `'unsafe-inline'` |
| **同源外部脚本允许** | `'self'` |
| **Worker 回退 `default-src 'self'`** ⇒ 同源 worker 文件可用；但 worker 内**执行动态代码仍需 eval** ⇒ 被禁 | 无 `worker-src` |
| **JSR 全程不用 eval**：`document.createElement('script')` + `el.textContent` | `plugins/js-slash-runner/executor/srcdocHost.ts:49,58`；全仓 grep `eval(`/`new Function` **空** |
| srcdoc + 内联脚本在本 CSP 下**已被重度使用且可用**（K1 实验的另一面） | 同上；`阶段交接…:95-102` |

---

## 4. 目标侧盘点：ST-Prompt-Template 的 EJS 层

### 4.1 引擎的"编译 / 执行"可以拆开（决定 CSP 路线）

| 事实 | 位置（`.ref/ST-Prompt-Template/src/3rdparty/ejs.js`） |
|---|---|
| `exports.Template = Template` —— **编译器公开导出** | `:504` |
| `compile()` 内 `if (!this.source) { this.generateSource(); … }` —— **只生成源码，不碰 `new Function`** | `:587-588` ⚠️**实测修正**：构造函数（`:510-550`）**不**生成源码 ⇒ 取源码须**手动调** `t.generateSource()` |
| `generateSource: function() { … }` —— **纯字符串拼接** | `:729` |
| `new Function` 全文件**只有两处** | `:110`（**模块加载期即执行**，取 `Promise`）、`:664`（运行期取 `AsyncFunction` 构造器） |

上游调用 opts：`{ async: true, outputFunctionName: 'print', _with: true, localsName: 'locals', client: true }`（`.ref/ST-Prompt-Template/src/function/ejs.ts:127-133`）—— `client: true` 正是 `new Function` 分支。

⇒ **`ejs.js:110` 才是"不能整包引入"的真正原因**（一 `import` 就触发 CSP 违规，比 `compile()` 更早）。

### 4.2 5 卡实测：真正用到的语法面与环境面（穷尽）

**语法面**（5 卡世界书正文全量计数）：

| 标记 | 次数 | 是否需要实现 |
|---|---|---|
| `<%_`（trim 前） | 705 | ✅ 必需 |
| `_%>`（slurp 后） | 699 | ✅ 必需 |
| `<%=`（转义输出） | 209 | ✅ 必需 |
| `<%-`（raw 输出） | 75 | ✅ 必需 |
| `<%#`（注释） | 2 | ✅ 低成本 |
| 顶层 `return` | 23 | ✅ 必需（要求模板体是函数体） |
| `await` | 1 | ✅ 必需（⇒ 必须异步） |
| `-%>`（trim 后） | 0 | 🟡 建议一并实现（成本极低） |
| `include(` | 0 | ❌ 不实现（**显式抛错**） |
| `<%%` / `%%>`（字面量转义） | 0 | 🟡 建议实现 |

**环境面**（并集穷尽）：`getvar`、`getMessageVar`、`setvar`、`setMessageVar`、`getwi`、lodash `_`。
**明确未使用**：`[GENERATE:*]`、`[RENDER:*]`、`[InitialVariables]`、`[Preprocessing]`、`@INJECT`、`@@`、`<escape-ejs>`、`variables.` 树、`getchr`/`getprp`/`getqr`/`activewi`/`execute`/`injectPrompt`/`define`/`evalTemplate`/`activateRegex`/`findVariables`、`SillyTavern.getContext()`、`faker`、jQuery。

**lodash 精确清单（9 个函数）**：

| 函数 | 次数 | 函数 | 次数 |
|---|---|---|---|
| `_.get` | 212 | `_.isObject` | 1 |
| `_.random` | 38 | `_.set` | 1 |
| `_.has` | 3 | `_.sample` | 1 |
| `_.omit` | 1 | `_.sampleSize` | 1 |
| `_.cloneDeep` | 1 | | |

**黄金基准规模（P0 实测）**：依赖 EJS 的 2 张卡共 **57 个「含 EJS 的条目」/ 1002 个 EJS 块 / 161,256 字符代码**
（`实力至上主义教室(维多利亚版)` 408 块 / 24,194 字符；`魔法少女V3.2.6` 594 块 / 137,062 字符）。

**⚠️ 非确定性**：`_.random` ×38 + `_.sample` + `_.sampleSize` ⇒ **EJS 渲染结果本身是随机的**（如"BOSS 强度 = 45 + 已击败数×6 + `_.random(-5,10)`"）。这直接影响验收设计（见 T5 / D15）。

---

## 5. 差距矩阵（Gap）

| # | 差距 | 现状 | 影响 |
|---|---|---|---|
| **G1** | 无 EJS 引擎 | 仓库无 `ejs` 依赖；`new Function` 被 CSP 禁 | 必须自实现"源码生成"，或绕开 `ejs.js:110` |
| **G2** | 无"提示词侧文本渲染缝" | `buildRequestMessages` 是同步纯函数，无插件钩子；`injectPrompts` 在 `UNIMPLEMENTED`（`predefine.ts:665`） | 必须新增一处宿主缝隙 |
| **G3** | **插件 `setup()` 早于 `scriptHostApi` 注入** | `App.tsx:940`（deps `[settings.plugins]`）先于 `:988`（deps `[]`） | env 桥**不得在 setup 期缓存** |
| **G4** | 脚本门面**未暴露** `setVariableAtPath` | `scriptHost.ts:24-45` 只有路径**读** | 写走 `updateVariablesWith` / `replaceVariables` |
| **G5** | `getwi` 保真度**降级** | NyaaChat 只有**当前角色**的世界书，**无全局书**（`scriptHost.ts:92`） | ST 的 `getwi('任意世界书名')` 只能覆盖当前角色 ⇒ **登记保真度损失** |
| **G6** | 装饰器 / `[GENERATE:*]` / `@INJECT` 等一律没有 | 且 NG4 已拍板不做 | 登记为 Non-Goal；**未实现符号显式抛错** |
| **G7** | lodash 未进前端 | `lodash` 在 `dependencies`，但 `src/` **0 处导入** | 内联 9 函数子集，避免整库进包 |
| **G8** | CSP 无 `unsafe-eval` | `nginx.conf:51/95` | 引擎走"源码生成 + 内联注入"，**不放宽 CSP** |

---

## 6. 架构张力（必须正面解决的七条）

| # | 张力 | 处置方向 |
|---|---|---|
| **T1** | **单条尾部 system 硬约束** | EJS 内容只并入 `blocks`；绝不再起第二条（`api.ts:364`） |
| **T2** | 缓存 vs 动态 | EJS 输出逐轮可变 ⇒ **按条目粒度**移出静态前缀（含 EJS 者才移，其余仍命中缓存） |
| **T3** | 异步模板 vs 同步管线 | `await` 必需（实测 `await getwi`）⇒ **异步 pre-pass + 同步消费** |
| **T4** | 副作用 vs 幂等 | `setvar`/`setMessageVar` 有副作用 ⇒ 每轮每条目**恰好渲染一次** |
| **T5** | 非确定性 vs 可复现验收 | 随机来自卡自身；黄金基准必须**打桩随机源**并声明"不保证跨轮一致" |
| **T6** | 死循环不可中断 vs 发送路径 | 当前 CSP 下 Worker 不可用 ⇒ 登记为已知风险（与 JSR **K4** 同级，但路径更危险） |
| **T7** | env 时序 | `setup` 期拿不到 `scriptHostApi` ⇒ **按需取用**（G3） |

---

## 7. 三个方案与推荐

### 方案 A（**推荐**）：插件内自办渲染层 + 一处极小宿主缝隙 + 不放宽 CSP

- **引擎**：**自实现**最小 EJS 源码生成器（纯字符串，~200–300 行），执行靠**内联 `<script>` 注入**（照 JSR 形态）。
- **缝隙**：新增叶子模块 + 异步 pre-pass + 把 `renderRule` 泛化为**渲染器链**（变量宏 = 第 1 个实现，EJS = 第 2 个）。
- **安全**：不加 `unsafe-eval`、不加 `unsafe-eval` 类放宽、不引入后端。
- **代价**：需自实现引擎（有语义偏差风险 ⇒ 用黄金基准逐块比对覆盖）。

### 方案 B：复用上游/ npm `ejs` 的 `generateSource`

- 只取 `Template#generateSource()`，绕开 `:110`/`:664`。
- **代价**：引入外部依赖 + 版本漂移风险（未来版本若在模块加载期引入 `new Function` 则立即失效）+ 与项目"自实现兼容层"的既有风格不符（对照：`src/lib/regex/engine.ts` 745 行、`src/lib/variables/**` 1040 行，项目一贯自实现）。

### 方案 C：放宽 CSP 加 `'unsafe-eval'`（或把编译搬到 ext-host）

- **否决理由**：与 K1 的收窄方向、JSR 的"零 eval"纪律、移植规范的安全红线全部相反；C 还额外引入后端与 nginx 改动，失去"纯前端"优势。

> **判别依据（为什么 A 最符合 NyaaChat）**：① 不引入 eval（JSR 纪律）；② 不放宽 CSP（K1 方向）；③ 自实现兼容层是项目既定做法（regex engine / variables 层）；④ 不引整套库（移植规范 §10.8）；⑤ 未启用时逐字节一致（回归纪律）；⑥ 不推翻 NG4。

---

## 8. 拍板清单（请逐条拍板）

> 每条给出**我的推荐**与**代价**。若你统一回复"全部使用推荐"，即按推荐执行。

### D1 — 范围边界：本插件**只**做"运行依赖 EJS 的卡"，是否确认？

- **推荐**：确认。范围 = 世界书条目正文的 EJS 渲染 + 最小 UI（开关 / 日志 / 报错）。
- **明确不做**：EJS 编辑器、装饰器、`[GENERATE:*]`/`[RENDER:*]`/`[InitialVariables]`/`[Preprocessing]`、`@INJECT`、ext-host 后端、Worker。

### D2 — 命名：`meta.id` 用 `ejs-template`（目录仍为 `plugins/EJS-template/`），是否确认？

- **推荐**：确认。理由：`meta.id` 必须匹配 `/^[a-z0-9][a-z0-9-]*$/`（`registry.ts:20`），大小写敏感；UI 名 `EJS模板`；`icon: "Sparkles"`（白名单内）；`order: 20`；`author: "Nyaa"`；`version: "1.0.0"`。
- **⚠️ 必须一并确认**：`plugins/registry.ts` 的 import 路径大小写要与磁盘一致（`./EJS-template/plugin`）—— Windows 不敏感但 **Docker/Linux 构建敏感**，写错会在镜像里炸。

### D3 — 宿主缝隙：是否接受新增"条目文本渲染缝"？

- **推荐**：接受。**1 个叶子模块 `src/plugins/promptText.ts`（~50 行）+ `ChatInterface` 一处 `await`（~10 行）+ `chatPipeline` 两处小改（~8 行）**。
- **性质界定**：这是"把某段**已激活条目**文本交给插件渲染一次"，**不是** NG4 拒绝的"改写任意位置出站消息数组" ⇒ **不推翻 NG4**。
- **代价**：新增一个宿主契约面，需登记为 D 编号并写进 §6 契约清单。

### D4 — 抽象粒度：合并为"渲染器链"还是让 EJS 走独立分支？

- **推荐**：**合并为渲染器链**（`{ matches(text); render(text, ctx): string | Promise<string> }`；变量宏是第 1 个实现）。
- **理由**：单条路径才守得住"未启用时逐字节一致"；双轨必然漂移（项目已有"同一份映射写两遍"的教训，`src/lib/sillyTavernScripts.ts:12`）。
- **代价**：改动**已被验证过**的变量宏路径 ⇒ 必须带**逐字节回归保护**。

### D5 — 引擎选型：方案 A（自实现）还是方案 B（复用 `generateSource`）？

- **推荐**：**A —— 自实现最小 EJS 源码生成器**。
- **理由**：彻底避开 `new Function`（含 `ejs.js:110` 的模块加载期陷阱）；零依赖、无版本漂移；与项目"自实现兼容层"一贯风格一致。
- **代价**：~200–300 行 + **必须用黄金基准逐条比对**（57 条目 / 1002 块）才能宣称语义等价。

### D6 — CSP：是否保持现状（不加 `'unsafe-eval'`）？

- **推荐**：**保持现状**，走内联 `<script>` 注入（普通脚本、**非 module** —— `_with: true` 需要非严格模式）。
- **理由**：放宽 `unsafe-eval` 是**全应用级**倒退，且与 K1 方向相反。

### D7 — 执行载体：自建轻量 srcdoc 载体，还是复用 JSR 的 `ScriptHost`？

- **推荐**：**自建轻量 srcdoc 载体**（同一技术，用途单一：一次性渲染请求/响应），**不复用** JSR 的 `ScriptHost`（其生命周期/bridge/15s 超时语义是为卡片脚本设计的，复用会引入耦合）。
- **代价**：多一个 ~150–250 行的载体模块；收益是解耦与可独立演进。

### D8 — env 桥形态与**时序**

- **推荐**：**快照式 + 按需取用** —— 每轮把"变量树 + 激活条目 + 世界书索引"一次性桥入渲染环境；`getScriptHostApi()` **每次渲染时取用**（**不得在 `setup` 期缓存**，G3）。
- **代价**：每轮一次结构化克隆；收益是消除 45+ 次 RPC 往返、并让 env 成为内存纯读。

### D9 — 写入语义：`setvar` 如何保真又不重复落盘？

- **推荐**：**渲染期即时写入内存快照（保真 ST 的"后续条目能读到"）+ 持久层每轮只提交一次**；以 `(sessionId, turnId, entryId)` 去重，保证**每轮每条目恰好渲染一次**。
- **代价**：需要一层"意图写入"收集与提交逻辑（~50 行）。

### D10 — lodash：内联 9 函数子集，是否确认？

- **推荐**：确认。实测仅用 9 个：`get` / `random` / `has` / `omit` / `cloneDeep` / `isObject` / `set` / `sample` / `sampleSize`。
- **理由**：不引整套库（移植规范 §10.8；lucide 那次 +829 kB 的教训）。

### D11 — 未实现符号的处置

- **推荐**：照抄 JSR **D9** —— **显式抛错、绝不静默返回 `undefined`**；且错误必须**在插件 UI 可见**（不能只进 console，移植规范 §10.2 坑 #6）。
- **代价**：某些卡会"明确报错"而不是"静默少一段文本"——这是**期望行为**。

### D12 — 死循环：是否接受登记为已知风险？

- **推荐**：接受，登记为 **K 编号**（与 JSR **K4** 同级，但**路径更危险**：发生在发送路径上）+ UI 明示 + 软上限（块数/耗时告警）。
- **理由**：当前 CSP 下 Worker 内无法执行动态代码、且 Worker 无 DOM ⇒ **用不了注入法**；要做可中断就必须放宽 CSP（与 D6 冲突）。
- **代价**：一张恶意/写坏的卡可以让生成卡死（与 JSR 现状同源）。

### D13 — 缓存策略

- **推荐**：**按条目粒度**把"含 EJS"的条目移出静态前缀（进动态尾部）；其余条目（多数 keyword 条目）继续命中前缀缓存。
- **代价**：实测 samples 中受影响条目为 26/216 与 43/44 ⇒ 前缀缓存收益有损但可控；**相对 ST 仍是改进**（ST 把这类条目放在 `after_char`，同样击穿缓存）。

### D14 — P 阶段划分（详见 SSOT）

- **推荐**：`P0 黄金基准与取证` → `P1 自实现引擎` → `P2 执行载体` → `P3 env 桥 + lodash` → `P4 宿主缝隙 + 渲染器链` → `P5 最小 UI` → `P6 真机验收` → `P7 文档与交接`（8 个 P）。

### D15 — 随机性：`_.random` / `_.sample` 用真随机还是固定种子？

- **推荐**：**真随机**（保真 ST 行为），但**黄金基准与验收断言必须注入可控随机源**（打桩），并在文档中声明"同一轮重复渲染结果不保证一致"。
- **代价**：无法用"两次渲染逐字节相同"做断言 ⇒ 改用"注入固定随机源后逐字节相同"。

---

## 9. 风险登记（K，建议在 SSOT 定稿时编号）

| # | 风险 | 等级 | 处置 |
|---|---|---|---|
| **K1** | **模板死循环冻结应用**（发送路径上，比 JSR K4 更严重） | high | 登记 + UI 明示 + 块数/耗时软上限；不做 Worker（D12） |
| **K2** | **R-a 误触发**：EJS 输出含完整合法 `<session_conventions target="…">` 时可让尾部保持真 system 发给网关 | low | 登记；注明"该面已存在（卡的世界书文本本就能进尾 system），EJS 只是扩大了表达能力" |
| **K3** | 模板抛错时的降级策略 | medium | **丢弃该条目内容 + 记录错误 + 不阻断生成**（**不得**把 `<% %>` 原文发给 LLM） |
| **K4** | 自实现引擎与上游 EJS 语义偏差 | medium | 黄金基准 57 条目**逐条比对**；偏差即缺陷 |
| **K5** | `getwi` 保真度损失（只能读当前角色世界书） | low | 文档登记（G5） |

---

## 10. 未确认项（如实标注，未编造）

1. **更广卡池的语法面**：本报告只覆盖 5 张真实卡（其中 2 张依赖 EJS）。若插件要面向任意卡，`[GENERATE:*]` 等仍可能被用到 —— 但 5 卡 0 命中，**不为假想需求补契约**（D1）。
2. **npm `ejs` 新版本是否已去掉 `:110` 的 `new Function`**：**未做验证**（方案 A 不需要它，故不影响推荐；若你选方案 B，需先验证）。
3. **`_.sample` / `_.sampleSize` 的具体调用形态**：只统计了次数，未逐个核对语义（实现时以黄金基准为准）。
4. **真机性能**：408 / 594 块的渲染耗时未实测（P2 验收项）。
5. **宿主缝隙对既有回归的影响面**：`promptText` 叶子引入后，`chatPipeline` 的 import 闭包是否仍无环 —— 设计上安全（叶子只依赖 `../types`），但**须在 P4 用 import 闭包检查验证**。
6. **⚠️ 路径现状与需求不符（需先纠正）**：用户指定的插件代码目录 `plugins/EJS-template`，磁盘上当前是一个 **0 字节的普通文件**（非目录）。
   - 实测：`cmd /c dir /a "plugins\EJS-template"` → `1 File(s) 0 bytes`；`Get-Item` → `Mode = -a---`、`PSIsContainer = False`、`Attributes = Archive`；创建时间 `2026-09-18 08:18:54`。
   - 影响：P1 开工前必须先把它改为目录，否则任何写入都会失败。
   - 本报告**未擅自删除**该文件（删除属写操作，且用户本轮只要求落文档）。

---

## 11. 拍板结论（2026-09-18，用户："全部使用推荐"）

> 决策记录（按项目 Vibo 规范"In 关键决策拍板后写回文档"）。

**用户原话**：「全部使用推荐」

| # | 决策 | **拍板结果** |
|---|---|---|
| D1 | 范围边界 | ✅ 只做"运行依赖 EJS 的卡"；不做编写功能 |
| D2 | 命名 | ✅ 目录 `plugins/EJS-template/`；`meta.id="ejs-template"`、`meta.name="EJS模板"`、`icon="Sparkles"`、`order=20`、`author="Nyaa"`、`version="1.0.0"` |
| D3 | 宿主缝隙 | ✅ 接受（叶子模块 + 一处 `await` + `chatPipeline` 两处小改） |
| D4 | 抽象粒度 | ✅ 合并为**渲染器链**，带逐字节回归保护 |
| D5 | 引擎选型 | ✅ **自实现**最小 EJS 源码生成器 |
| D6 | CSP | ✅ **保持现状**（不加 `'unsafe-eval'`），走内联 `<script>` 注入 |
| D7 | 执行载体 | ✅ 自建轻量 srcdoc 载体（不复用 JSR `ScriptHost`） |
| D8 | env 桥 | ✅ 快照式 + `getScriptHostApi()` **按需取用** |
| D9 | 写入语义 | ✅ 内存即时可见 + 持久层每轮一次提交 + 每轮每条目一次 |
| D10 | lodash | ✅ 内联 9 函数子集 |
| D11 | 未实现符号 | ✅ 显式抛错 + UI 可见 |
| D12 | 死循环 | ✅ 登记 K1 + UI 明示 + 软上限；不做 Worker |
| D13 | 缓存策略 | ✅ 按条目粒度移出静态前缀 |
| D14 | P 阶段划分 | ✅ P0–P7 |
| D15 | 随机性 | ✅ 真随机 + 基准/验收注入可控随机源 |
| **D16-R** | EJS 在渲染链中的位置 | ✅ **选项 A**：pre-pass 复现完整前缀链（占位符→变量宏→正则）后跑 EJS，**EJS 最后，与上游一致** |

**D16-R 的补强证据（本次技术性说明取证时确认）**：`[handler.ts]:264-265` 逐字为
`evalTemplateHandler(applyRegex(env, message.content, { generate: true, role: message.role }), …)`
⇒ 上游顺序**正则先、EJS 后**，选项 A 与之对齐。

**拍板后新增的两条实施性结论（写文档时取证得到，供 P1/P2 使用）**：

1. **`.ref/ST-Prompt-Template/src/3rdparty/ejs.js` 是改造版**（非 npm 原版）：`generateSource` 开头有 `[ \t]*<%_` / `_%>[ \t]*` 预处理（`:739-740`）、有**嵌套标签平衡**（`:743-793`）、`__append` 过滤 `undefined`/`null`（`:591`）。
   ⇒ **npm `ejs` 不能作为语义基准** —— 这使 D5（自实现）从"推荐"变为**唯一可行**，并进一步否掉方案 B。
2. **P0 执行方式确定为 `.ts` + `npx tsx`**（与 `dev-server/tools/check-*.ts` 的既有惯例一致），产物落 `dev-server/ejs-golden/`（dev-server 为独立仓，避免污染主仓工作树）。

---

## 12. 下一步

1. ~~你逐条拍板 D1–D15~~ → ✅ 已完成（§11）。
2. 按拍板结论**定稿 SSOT**（已同步：`开发计划-SSOT.md` §1 标记为已确认）。
3. **进入 P0**：按 `EJS本地自测方法.md` §0 产出黄金基准（57 个含 EJS 条目 / 1002 块 / 161,256 字符），作为 P1"逐字节等价"的唯一判据。
4. 随后按 P1→P7 推进，每个 P 独立可验证、可提交。

> 本报告**不含任何代码改动**；`plugins/EJS-template/` 目前为**空目录**（原误建文件已按用户指示删除并改为目录）。
