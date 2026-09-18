# NyaaChat 插件开发 · EJS 模板渲染层（`ejs-template`）—— 开发计划（SSOT）

> **状态**：✅ **已定稿（2026-09-18，用户：「全部使用推荐」）** —— 可进入编码（P0 起）。
> **上游文档**：`.docs/plugin-system/插件开发_EJS-template/审计报告-EJS模板渲染层.md`（本文件的所有 D/K/G/T 编号均源自该报告）
> **实现依据**：`.docs/plugin-system/插件开发_EJS-template/EJS技术性说明.md`（引擎语法语义规格 §3、env 全清单 §4、必须复刻项 **M1–M12**）—— P1 的唯一规格来源
> **自测载体**：`.docs/plugin-system/插件开发_EJS-template/EJS本地自测方法.md`（P0–P4 的**不依赖 LLM** 可复跑自测与判定对照）—— P1/P3/P4 验收的执行方式
> **项目内规范**：`.docs/plugin-system/插件框架规范.md`、`.docs/plugin-system/ST扩展移植规范.md`、`.docs/llm-chat-prompt-architecture-standard.md`
> **先例**：`.docs/plugin-system/插件开发_JS-Slash-Runner/*`（形态、纪律、验证方法学）
> **上游实现参考**：`.ref/ST-Prompt-Template`（v1.17.9）、`.ref/EJS/*.json`（5 张卡样本，含 2 张依赖 EJS）
> **取证时点**：2026-09-18，基准 `master @ 77723ee`

---

## 0. 范围与术语

### 0.1 一句话目标

**让"依赖 EJS 的角色卡"在 NyaaChat 里跑起来** —— 把世界书条目正文里的 `<% %>` 渲染成提示词文本，随本轮请求发出；**不提供 EJS 编写功能**。

### 0.2 术语

| 术语 | 含义 |
|---|---|
| **EJS** | Embedded JavaScript（嵌入式 JavaScript 模板），上游扩展所用的模板引擎 |
| **EJS 块** | 条目正文里的一对定界符及其内容，如 `<% … %>` / `<%= … %>` |
| **渲染器链** | 宿主侧对"条目文本"依次施加变换的机制；变量宏为第 1 个实现，EJS 为第 2 个 |
| **缝隙** | 宿主新增的"条目文本渲染缝"（`promptText` 叶子模块 + 异步 pre-pass + 组装期消费） |
| **pre-pass** | `buildRequestMessages` **之前**的异步前置段（现有 web/KB search 槽位） |
| **载体** | 执行 EJS 产物的隔离环境（本插件自建的轻量 srcdoc iframe） |
| **黄金基准** | 用上游 EJS 引擎对 **57 个含 EJS 的真实条目**（共 1002 个 EJS 块）渲染出的输出，用作自实现引擎的比对标准 |

### 0.3 范围内 / 范围外

**In Scope**
- 世界书条目正文的 EJS 渲染 → 进动态尾部
- EJS 引擎的**源码生成 + 执行**两步（自实现）
- EJS 内实测用到的扩展符号（6 个）+ lodash 9 函数子集
- 最小 UI：启用开关（复用框架）/ 报错 / 日志 / 渲染统计 / 试渲染
- 宿主侧缝隙（叶子模块 + pre-pass + 渲染器链）

**Out of Scope（NG，见 §12）**
- EJS 编辑器 / 语法高亮 / monaco
- 装饰器（`@@*`）、`[GENERATE:*]`、`[RENDER:*]`、`[InitialVariables]`、`[Preprocessing]`
- `@INJECT`（**NG4，已拍板不做**）
- ext-host 后端 / nginx 改动
- Worker 隔离

---

## 1. 已确认决策（D1–D15）—— ✅ **已拍板（2026-09-18）**

> 用户原话：「全部使用推荐」。拍板记录见 `审计报告-EJS模板渲染层.md` §11。**本 SSOT 已定稿，可进入编码。**

| # | 决策 | **已确认取值** |
|---|---|---|
| **D1** | 范围边界 | ✅ 只做"运行依赖 EJS 的卡"，不做编写功能 |
| **D2** | 命名 | ✅ 目录 `plugins/EJS-template/`；`meta.id = "ejs-template"`；`meta.name = "EJS模板"`；`icon = "Sparkles"`（白名单内）；`order = 20`；`author = "Nyaa"`；`version = "1.0.0"` ⚠️ registry 的 import 路径大小写须与磁盘一致（Linux 构建敏感） |
| **D3** | 宿主缝隙 | ✅ 接受（叶子模块 ~50 行 + 一处 `await` ~10 行 + `chatPipeline` 两处 ~8 行） |
| **D4** | 抽象粒度 | ✅ 合并为**渲染器链**（变量宏 = 实现 1，EJS = 实现 2），带逐字节回归 |
| **D5** | 引擎选型 | ✅ **自实现**最小 EJS 源码生成器（纯字符串，不碰 `new Function`） |
| **D6** | CSP | ✅ 保持现状（**不加** `'unsafe-eval'`），走内联 `<script>` 注入（普通脚本、非 module） |
| **D7** | 执行载体 | ✅ 自建轻量 srcdoc 载体（不复用 JSR `ScriptHost`） |
| **D8** | env 桥 | ✅ 快照式 + `getScriptHostApi()` **按需取用**（**不得在 `setup` 期缓存**） |
| **D9** | 写入语义 | ✅ 渲染期即时写内存快照（保真）+ 持久层每轮只提交一次 + 每轮每条目**恰好渲染一次** |
| **D10** | lodash | ✅ 内联 9 函数子集：`get`/`random`/`has`/`omit`/`cloneDeep`/`isObject`/`set`/`sample`/`sampleSize` |
| **D11** | 未实现符号 | ✅ 照抄 JSR **D9**：显式抛错 + UI 可见 |
| **D12** | 死循环 | ✅ 登记为 **K1** + UI 明示 + 块数/耗时软上限；**不做** Worker |
| **D13** | 缓存策略 | ✅ 按条目粒度把"含 EJS"条目移出静态前缀 |
| **D14** | P 阶段划分 | ✅ P0–P7（见 §9） |
| **D15** | 随机性 | ✅ 真随机（保真 ST），黄金基准与验收**注入可控随机源** |

### 1.1 ✅ 修正项 D16-R（**已拍板：选项 A**）

> 写本 SSOT 时新发现：**EJS 在渲染链中的位置**会改变行为，且与 pre-pass 的可行性耦合。

**问题**：上游 ST-Prompt-Template 对每条消息的处理顺序是 **`substituteParams`（宏）→ `applyRegex`（正则）→ EJS**（`.ref/ST-Prompt-Template/src/modules/handler.ts:264-265`：`evalTemplateHandler(applyRegex(env, message.content, …), …)`）。即 **EJS 在最后**。

而 NyaaChat 的 `renderRule` 顺序是 **占位符 → 变量宏 → 正则**（`chatPipeline.ts:832-837`）。若要让 EJS 也在最后，则 **pre-pass 必须先完整复现"占位符 → 变量宏 → 正则"这一前缀链**，再跑 EJS；组装期对含 EJS 的条目直接取缓存。

**三个选项**：

| 选项 | 做法 | 代价 |
|---|---|---|
| **A ✅ 已采纳** | pre-pass 复现完整前缀链（占位符→变量宏→正则）后跑 EJS；组装期取缓存。**顺序与上游一致** | 需把 `renderRule` 的前缀链抽成可在 pre-pass 复用的函数（同一份代码，非两套） |
| B | EJS 只接在"占位符替换后"，组装期再对 EJS 输出做变量宏+正则 | pre-pass 极简；但**与上游顺序不一致**，若卡依赖"正则先处理"则行为偏移 |
| C | EJS 完全放到组装期同步执行 | ❌ 不可行 —— `await getwi` 要求异步 |

**已采纳 A**。理由：保真优先；且"同一份前缀链代码"不构成双轨（本就是同一函数）。
**补强证据**：写 `EJS技术性说明.md` 时逐字核对了该行 —— `[handler.ts]:264-265` 确为 `evalTemplateHandler(applyRegex(...))`。
**注**：`renderRule` 的世界书正则是 `getRegexedString(macroed, WORLD_INFO, promptRegex, { isPrompt: true })`（`:834-836`）—— **未传 `depth`**，故 pre-pass 可无副作用复现。

---

## 2. 架构

### 2.1 总体数据流

```
用户点发送
  │
  ├─[已有] web search → KB search（ChatInterface.tsx:735-805 的异步前置段）
  │        └─ 已在此处调用 getActivatedKeywordRules()（:749）→ 本轮激活集
  │
  ├─[新增] await preparePromptText({ activatedRules, ctx })          ← 异步 pre-pass（缝隙②）
  │        ├─ 宿主：对每个激活条目，若 needsPromptText(content)
  │        │    ├─ 复现前缀链：占位符 → 变量宏 → 正则（D16-R 选项 A）
  │        │    ├─ 交给已注册的渲染器（EJS）→ 插件侧
  │        │    │     ├─ 组 env 快照（变量树 + 世界书索引 + 身份）
  │        │    │     ├─ 载体渲染：源码生成 → 内联注入 → 执行
  │        │    │     └─ 回传 { renderedText, writes[] }
  │        │    └─ 记录 writes（延迟提交，见 §2.5）
  │        └─ 结果按 rule.id 缓存到本轮快照
  │
  └─ buildRequestMessages(...)                                       ← 保持同步纯函数
       ├─ 分流（缝隙①）：permanent 条目分三组：含EJS / 只含宏 / 静态
       ├─ 静态前缀：只含"静态"组（逐字节与改造前一致）
       ├─ 尾部 blocks[0] <session_rules>：
       │    ├─ ═ 硬约束 ═ / ═ 场景设定 ═（keyword 条目，原有）
       │    ├─ ═ 变量状态 ═（只含宏的 permanent 条目，**原有，字节不变**）
       │    └─ ═ 模板设定 ═（含 EJS 的 permanent 条目 + keyword 含 EJS 条目）← 新增小节
       ├─ blocks[1] <output_constraints>（原有）
       ├─ blocks[2] <FLAGALAC_BYPASS_TAG …>（原有，仍在最后）
       └─ 仍返回**唯一一条**尾部 system（硬约束 T1）
```

### 2.2 宿主侧：渲染器链与缝隙（`src/plugins/promptText.ts`，新增叶子模块）

```ts
// ⚠️ 叶子模块纪律：只允许 `import type` 自 `../types`（与 hostContext.ts / scriptHost.ts 同模式）
import type { WorldInfoRule } from "../types";

export interface PromptTextContext {
  sessionId: string;
  /** 本轮唯一键（宿主生成）—— 幂等去重的依据（D9） */
  turnId: string;
  identity: { user: string; char: string };
  character: { id: string | null; name: string };
}

export interface PromptTextRenderer {
  /** 归属插件 id（错误归因/日志） */
  pluginId: string;
  /** 同步、必须廉价：声明是否处理该文本 */
  matches(text: string): boolean;
  /** 渲染（可异步）。抛错由宿主降级（K3），不得阻断生成 */
  render(text: string, ctx: PromptTextContext): Promise<string> | string;
  /** 本轮渲染产生的副作用（D9）—— 由宿主在 pre-pass 结束后统一提交一次 */
  takeWrites?(): PromptTextWrite[];
}

export interface PromptTextWrite {
  path: string;                                  // 变量路径
  value: unknown;
  scope: "message" | "chat" | "global";
  messageId?: number | "latest";
}

/** 声明式判据：含变量宏 **或** 任一渲染器 matches ⇒ 不得进静态前缀 */
export function needsPromptText(text: string): boolean;

export function registerPromptTextRenderer(r: PromptTextRenderer): () => void;
export function getPromptTextRenderers(): readonly PromptTextRenderer[];

/** 宿主在异步前置段调用：渲染本轮激活条目并按 rule.id 缓存 */
export async function preparePromptText(
  rules: readonly WorldInfoRule[],
  ctx: PromptTextContext,
): Promise<void>;

/** 宿主在组装期同步调用：取本轮结果；缺失则回退原文（并告警一次） */
export function getPreparedPromptText(ruleId: string, fallback: string): string;
export function clearPreparedPromptText(): void;
```

### 2.3 宿主侧：`chatPipeline.ts` 的两处改动

| # | 位置 | 改动 | 逐字节保护 |
|---|---|---|---|
| ① | `:843-844` | 判据 `hasVariableMacro(r.content)` → `needsPromptText(r.content)`（含宏 **或** 任一渲染器 matches）；permanent 组由 2 组细分 3 组 | 无渲染器注册时 `needsPromptText ≡ hasVariableMacro` ⇒ **字节不变** |
| ② | `:833, 882-884` | 尾部渲染：含 EJS 的条目取 `getPreparedPromptText(rule.id, …)`；新增 `═ 模板设定 ═` 小节（**仅在存在含 EJS 条目时产出**） | 无 EJS 条目 ⇒ `tailParts` 与改造前**完全一致** |

**前置链复用（D16-R 选项 A）**：把 `renderRule` 的"占位符 → 变量宏 → 正则"抽为 `applyPrefixChain(text, { allowVariableMacros })`，供 `renderRule` 与 `preparePromptText` **共用同一份代码**。

**`ChatInterface.tsx` 一处改动**：在现有异步前置段（`:742-805`，紧邻 `getActivatedKeywordRules()` 调用之后）插入：

```ts
await preparePromptText(activatedRules, {
  sessionId, turnId: botMessageId, identity: { user: userName, char: charName },
  character: { id: currentCharacter?.id ?? null, name: currentCharacter?.name ?? "" },
});
```

> ⚠️ 必须复用**同一次** `getActivatedKeywordRules()` 的返回值（`:749`），不得再算一次 —— 否则口径可能与 `buildRequestMessages` 内部不一致，导致"渲染了未激活条目 ⇒ `setvar` 误写"。

### 2.4 插件侧：渲染驱动

```
plugins/EJS-template/
  plugin.tsx                 # NyaaPlugin 装配：meta / defaults / setup / SettingsPanel
  README.md                  # 该插件的移植/实现说明（含保真度损失登记）
  engine/
    compile.ts               # 自实现：EJS 模板 → 函数体源码（纯字符串，无 eval）
    escape.ts                # EJS 的 escapeXML（`<%=` 用）
    syntax.ts                # 定界符扫描（<%_ / _%> / -%> / <%= / <%- / <%# / <% / <%%）
  lodashSubset.ts            # 9 函数内联子集（含可控随机源注入点，D15）
  host/
    carrier.ts               # 轻量 srcdoc 载体：注入 / 握手 / 超时 / 销毁
    env.ts                   # env 快照组装（变量树 + 世界书索引 + 身份）
    renderEntry.ts           # 单条目渲染编排（含写入收集）
  registry.ts                # 向叶子 registerPromptTextRenderer 注册
  EjsTemplateSettings.tsx    # 最小 UI（开关复用框架 / 日志 / 统计 / 试渲染）
  errors.ts                  # 错误归类与用户可读文案（D11/K3）
```

### 2.5 env 快照与写入语义（D8 / D9）

**快照内容（每轮一次；⚠️ 实际是「同源直读、按引用」，**不是**结构化克隆 —— 见口径 6）**：

| 项 | 来源 | 对应 ST 符号 |
|---|---|---|
| `variables` 三作用域（只读视图） | `getScriptHostApi().variables.getVariables(scope, { messageId: 'latest' })` | `getvar` / `getMessageVar` |
| 世界书条目索引（`comment → content`） | `getScriptHostApi().lorebook.getEntries()` | `getwi`（**仅当前角色**；真机命中来源与 golden 断言表**不同**，见口径 7） |
| `identity`（展示口径） | `prepass ctx` | `userName`/`charName` |

> ⚠️ **`getScriptHostApi()` 必须每次渲染时取用**（`App.tsx:940` 的 `setup` 早于 `:988` 的注入）—— **禁止在 `setup` 期缓存**。
> ⚠️ **载体侧契约（口径 6）**：快照**顶层就是模板作用域**，按引用存 `window.__nyaEjsCarriers[nonce].env`、iframe 同源直读并作为 `anonymous(locals, …)` 的 `locals`；7 个符号必须**全部挂顶层**（`with (locals || {})` 下裸标识符才命中）。**刻意不做结构化克隆**：桩表与 `_` 是函数，克隆会静默丢弃；且同 realm 才能保证 `cloneDeep`/`omit` 的原型判定不退化。

**写入（D9）**：
- 模板内 `setvar` / `setMessageVar` **立即写入载体内的内存快照**（后续条目 `getvar` 能读到 ⇒ 保真 ST）；
- 同时记录为 `PromptTextWrite[]` 写入意图（**非枚举** `writes` 数组，落点约定 `__writes`→`writes`→`__nyaWrites`→`__takeWrites()`）；
- **作用域与路径口径见 §14 口径 10**（读缺省 `cache` 合并视图 / 写缺省 `message` / 写入路径原样不剥离）；
- pre-pass 结束后由宿主**统一提交一次**（`updateVariablesWith` / 门面暴露的写入口）—— **⚠️ 该提交点尚未接线，由 t10 完成**（见 §14「登记偏差」第 2 条）；
- 去重键 `(sessionId, turnId, ruleId)` ⇒ **每轮每条目恰好渲染一次**。

### 2.6 缓存与分流（D13）

| 条目类别 | 落点 | 缓存 |
|---|---|---|
| 静态（无宏、无 EJS） | 静态前缀 | ✅ 命中 |
| 只含变量宏的 permanent | `═ 变量状态 ═`（**原有行为，字节不变**） | ❌（既有设计） |
| **含 EJS 的 permanent** | `═ 模板设定 ═`（新增小节） | ❌（输出逐轮可变） |
| keyword 触发（含或不含 EJS） | 硬/软约束小节 | ❌（既有设计） |

### 2.7 错误与降级（K3 / D11）

| 情形 | 处置 |
|---|---|
| 模板编译错/运行错 | **丢弃该条目内容**（**绝不把 `<% %>` 原文发给 LLM**）+ 记录错误 + 日志可见 + **不阻断生成** |
| 载体超时 | 同上（按条目降级，不影响其他条目） |
| 调用了未实现的符号 | **显式抛错**（照抄 JSR D9），错误文案含符号名与条目名 |
| 无渲染器结果但 `needsPromptText` 为真 | 回退原文 + 一次性告警（避免逐轮刷屏） |

---

## 3. EJS 引擎实现规格（D5）

### 3.1 语法面（必须实现 / 不实现）

| 标记 | 语义 | 实测次数 | 处置 |
|---|---|---|---|
| `<% code %>` | 任意 JS 语句 | 基础 | ✅ 实现 |
| `<%= expr %>` | 转义输出（`escapeXML`） | 209 | ✅ 实现 |
| `<%- expr %>` | raw 输出 | 75 | ✅ 实现 |
| `<%# comment %>` | 注释 | 2 | ✅ 实现 |
| `<%_ … %>` | 删除**前导**空白 | 705 | ✅ 实现 |
| `<% … _%>` | 删除**尾随**换行 | 699 | ✅ 实现 |
| `<% … -%>` | 同上（EJS 的另一种写法） | 0 | 🟡 一并实现（成本极低） |
| `<%%` / `%%>` | 字面量转义 | 0 | 🟡 一并实现 |
| `include(...)` | 模板包含 | 0 | ❌ **不实现 ⇒ 显式抛错** |

### 3.2 源码生成规格

- 产物 = **函数体源码字符串**（不含 `function` 关键字与参数表），由载体拼成
  `async function anonymous(locals, escapeFn, include, rethrow) { … }`。
- 作用域：`with (locals || {})` —— 与上游 `_with: true` 一致（`ejs.ts:130`）
  ⇒ 注入脚本必须是**普通 `<script>`（非 module）**，因 `with` 在严格模式下非法。
- 输出函数名：`print`（与上游 `outputFunctionName: 'print'` 一致）。
- **`localsName: 'locals'`**、`escapeFn` 由载体提供（`escape.ts`）。
- **顶层 `return`**（实测 23 次）必须可用 ⇒ 产物本身就是函数体，天然支持。
- **异步**（实测 `await` 1 次）⇒ 产物按 `async function` 生成；**不**使用任何 `new Function`/`AsyncFunction` 构造器。

### 3.3 执行与作用域（载体，D6/D7）

```
载体 = 1×1 隐藏 srcdoc iframe（同源、不加 sandbox —— 与 JSR 既有形态一致）
  ├─ 首次：把「引擎产物（函数体）+ 模板」拼成内联 <script> 注入
  │        模板不变时按 templateHash 缓存函数（后续轮只更新数据）
  ├─ 每轮：window 上放 env 快照 → postMessage 触发 → 回传 { text, writes, errors }
  └─ 超时：软上限（默认与块数挂钩）→ 按条目降级
```

**不引入的能力**：`eval` / `new Function` / Worker / 远程脚本。

### 3.4 黄金基准与比对方法（P0 产出，P1 判据）

1. 在 **Node 侧**用上游 EJS 引擎（`.ref/ST-Prompt-Template/src/3rdparty/ejs.js` 的语义基准）+ **打桩的随机源**，对 5 张卡中 **57 个含 EJS 的条目**（1002 个块 / 161,256 字符）渲染出黄金输出（env 用固定桩数据）。
   - ⚠️ vendored `ejs.js` 含 `require('../package.json')`（`:55`）与模块加载期的 `new Function`（`:110`），**不能直接在 Node 里 require** ⇒ P0 需先做打包/路径 shim（P0 内部事项，不影响产品代码）。
2. 自实现引擎完成后，**逐块逐字节比对**；任何差异即缺陷。
3. 比对夹具必须是**真实卡的块**（不得自造简化用例 —— JSR 的"假缺陷"教训，`阶段交接…:667`）。

---

## 4. 宿主改动清单（文件级）

| # | 文件 | 改动 | 规模 |
|---|---|---|---|
| 1 | `src/plugins/promptText.ts` | **新增叶子模块**（§2.2 契约） | ~50 行 |
| 2 | `src/lib/chatPipeline.ts` | ① 判据泛化 + permanent 三分组（`:843-844`）② 尾部新增 `═ 模板设定 ═` 小节 + 取缓存（`:833, 882-884`）③ 抽 `applyPrefixChain()` 供 pre-pass 复用（D16-R） | ~30 行 |
| 3 | `src/components/ChatInterface.tsx` | 异步前置段插入 `await preparePromptText(...)`（复用 `:749` 的激活集） | ~10 行 |
| 4 | `plugins/registry.ts` | 追加 `import ejsTemplate from "./EJS-template/plugin";` 与数组项 | 2 行 |
| 5 | `plugins/EJS-template/**` | 插件实现（§2.4 文件清单） | ~900–1300 行 |
| 6 | `eslint.config.js` / `tsconfig.json` | **不改**（`files` 已含 `plugins/**`，`tsconfig` 无 `include`） | 0 |
| 7 | `nginx.conf` / `ext-host/**` | **不改**（纯前端，无后端） | 0 |

> **契约登记**：`src/plugins/promptText.ts` 属**新增宿主契约面**，须在 `插件框架规范.md` §2.5 / §6 补一行登记（与 `hostContext` / `scriptHost` 并列）。

---

## 5. 插件文件级清单

见 §2.4。关键约束：

- **只允许两类静态边**：`src/plugins/types`（type-only）与叶子 `src/plugins/promptText` / `scriptHost` / `pluginLog`。
  **禁止**值导入 `src/plugins/{index,runtime,registry,backend}`（模块环 ⇒ 插件静默消失）。
- `meta.icon` 必须取自 12 项白名单（`ExtensionsModal.tsx:92-105`）⇒ 用 `Sparkles`。
- `meta.id = "ejs-template"`（kebab-case）；目录名 `EJS-template` 仅作磁盘路径。

### 5.1 ✅ 落地前提：路径已纠正（原 P1 阻塞项，已解决）

**原现状**：`plugins/EJS-template` 曾是一个 **0 字节的普通文件**（非目录）。

**处置结果（2026-09-18，经用户确认）**：已删除该空文件并**重建为同名空目录**。脚本内置保护：删除前校验"必须是 0 字节普通文件"，非空或已是目录则拒绝。

**验证判据**：`Get-Item plugins\EJS-template` ⇒ `PSIsContainer = True`、条目数 = 0。
**注意**：Git 不跟踪空目录，故 `git status` 不会显示它（属预期，非缺失）。

---

## 6. env 映射表（并集 **7** 项 + lodash）

| ST 符号 | NyaaChat 实现 | 保真度 |
|---|---|---|
| `getvar(key, {defaults, scope})` | 自实现（三作用域 + `mergedCacheView` 合并视图）+ 自实现 `defaults` | 🟡 **`cache` 由合并视图近似**（与上游 `[variables.ts]:52-59` / `:437` 等价 —— 上游读缺省本就是 `'cache'`，**故这比"抛错"更高保真**）；`'initial'` 无对应物 ⇒ **显式抛错**；残留缺口见 §14 口径 10 末条 |
| `getMessageVar(key, opts)` | 同上，`scope: 'message'`（`messageId: 'latest'` 语义已对齐） | ✅ |
| `setvar(key, value)` | 写入快照 + `PromptTextWrite` → 宿主统一提交 | 🟡 ST 的 `flags:'nx'/'xx'/'nxs'` **无对应物** ⇒ 自实现或抛错（P3 定） |
| `setMessageVar(key, value)` | 同上 + `scope: 'message'` | 🟡 同上 |
| `getwi(name)` | `lorebook.getEntries()` 按 `comment`/`name` 匹配 ⇒ `content \| null` | ⚠️ **降级**：ST 可读任意世界书（含全局书），NyaaChat 只有当前角色 ⇒ **登记**（G5） |
| **`YAML`**（宿主全局，非扩展 env） | 用 NyaaChat **自托管**的同一份：`public/vendor/script-host/yaml/yaml.esm.js`（eemeli/yaml；JSR 给 iframe 挂 `window.YAML` 用的就是它，`scriptHostImpl.ts:230`） | ✅ **同一实现**；★ P0 实测发现（**5 次**，两张卡都用 `YAML.stringify(x, {blockQuote:'literal'})`） |
| lodash `_`（9 函数） | `lodashSubset.ts` 内联实现 | ✅（`_.sample*`/`_.random` 用可控随机源） |

> ⚠️ **`YAML` 与其它符号性质不同**：它**不在**上游扩展的 `prepareContext` 注入清单里（`[ejs.ts]:30-60` 只有 `_`/`$`/`z`/`toastr`/`console`），而是**页面全局**——即由**酒馆助手生态**在主页面暴露。
> NyaaChat 的 JSR 只在 **iframe** 里挂 `window.YAML`（`scriptHostImpl.ts:230`），**主页面没有** ⇒ EJS 插件**必须自己把它放进 env**（P0 已用同一份 vendor 产物验证）。
> 这也是"两张卡同时要求酒馆助手 + 提示词模板"的一层实证：**EJS 模板借用了酒馆助手提供的宿主全局**。

**未实现符号（调用即抛错，D11）**：`getchr`/`getchar`/`getprp`/`getpreset`/`getqr`/`getQuickReply`/`activewi`/`execute`/`injectPrompt`/`getPromptsInjected`/`define`/`evalTemplate`/`findVariables`/`activateRegex`/`getChatMessage(s)`/`matchChatMessages`/`applyVarYamlAnnotate`/`setVariableSchema`/`jsonPatch`/`parseJSON`/`SillyTavern`/`faker`/`include`/`$`。

---

## 7. lodash 子集规格（D10）

| 函数 | 实测次数 | 语义要点 |
|---|---|---|
| `get(obj, path, default)` | 212 | 支持 `a.b[0].c`；路径分隔 `.` 与 `[]` |
| `random(lower, upper)` | 38 | **可控随机源注入点**（D15）；缺参与 `floating` 形态按 lodash 语义 |
| `has(obj, path)` | 3 | — |
| `omit(obj, keys)` | 1 | — |
| `cloneDeep(v)` | 1 | 循环引用安全 |
| `isObject(v)` | 1 | lodash 语义（**数组与函数返回 true**） |
| `set(obj, path, value)` | 1 | — |
| `sample(arr)` | 1 | 用可控随机源 |
| `sampleSize(arr, n)` | 1 | 用可控随机源 |

> 若后续扩样发现新函数 ⇒ **按需补，不预置整库**（移植规范 §10.8）。

---

## 8. 最小 UI 规格（D14 / 用户要求：开关 + 报错 + 日志）

| 区块 | 内容 | 数据源 |
|---|---|---|
| 启用开关 | **复用框架**（插件列表绿点 + `AppState.plugins['ejs-template'].enabled`），面板内不再做第二套 | 框架 |
| 运行日志 | 按 `pluginId` 过滤的错误/警告列表；宿主插件卡片已自带日志区 | `pluginLogger` / `getPluginErrors` / `subscribePluginErrors`（`src/plugins/pluginLog.ts:311,330,345`） |
| 本轮渲染统计 | 渲染条目数 / EJS 块数 / 耗时 / 降级（失败）条目数 | 插件内状态 + `useSyncExternalStore` |
| 逐条目视图 | 哪些条目含 EJS、是否渲染成功、错误摘要 | 同上 |
| 试渲染 | 用当前变量对**指定条目**渲染一次并展示结果（只读，不提交写入） | 插件内 |
| 安全告知 | 照 JSR 文案风格：模板与宿主同源运行；只运行可信来源的卡 | 静态文案 |
| **明确不做** | EJS 编辑器 / 语法高亮 / 在线修改 / 变量管理器 | — |

---

## 9. P 阶段划分与验收标准（D14）

| P | 交付 | 验收（客观、可复跑） |
|---|---|---|
| **P0** ✅ **已完成（2026-09-18）** | 黄金基准与取证：`npx tsx dev-server/tools/verify-ejs-golden.ts` → `dev-server/ejs-golden/{golden.json,manifest.json,summary.md}` | ① **57/57 条目产出黄金输出（failed 0）** ✅；② 清单与审计报告 §4.2 数字**逐项一致**（代码 161,256 字符 / 语法面 11 项 / lodash 9 函数）✅；③ 两次运行 `golden.json` **SHA256 一致**（`C00DC334…`）✅；④ 耗时 42 ms |
| **P1** | 自实现 EJS 源码生成器（`engine/`），**规格来源 = `EJS技术性说明.md` §3 与 M1–M12** | ① **57/57 条目逐字节等于黄金基准**；② 不出现 `eval`/`new Function`（双方法交叉扫描）；③ `include` 调用显式抛错；④ 失败对照走 `EJS本地自测方法.md` §4 |
| **P2** | 轻量 srcdoc 载体（`host/carrier.ts`）；**前提见 `EJS本地自测方法.md` §2.1/§2.2** | ① 端到端渲染 1 块成功（`ejs-host-smoke`）；② 超时按条目降级、不阻断；③ 无 `eval`/`new Function`；④ 载体销毁无残留 iframe；⑤ 注入用**普通 script**（`with` 需非严格模式） |
| **P3** | env 桥 + lodash 子集（**符号清单见 `EJS技术性说明.md` §4**） | ① 7 个符号语义逐条对拍；② 未实现符号调用显式抛错且文案含符号名（O7）；③ `_.*` 9 函数与 lodash 行为一致（含 `isObject` 的数组/函数边界） |
| **P4** | 宿主缝隙 + 渲染器链 | ① **未启用插件时请求体与改造前逐字节一致**（反向验证：先伪造差异确认断言会红）；② 含 EJS 条目进 `═ 模板设定 ═` 且**尾部仍只有一条 system**（O10）；③ 无渲染器注册时 `needsPromptText ≡ hasVariableMacro`；④ import 闭包无环（插件不消失） |
| **P5** | 最小 UI | ① 开关生效；② 错误在面板可见（非仅 console）；③ 统计数字与 P4 实际渲染条目数一致 |
| **P6** | 真机验收 | ① 两张卡端到端生成成功且**无 `<% %>` 泄漏进请求**；② 用 provider `usage.cached_tokens` 实测：含 EJS 条目退出前缀、其余条目仍命中；③ `setvar` 每轮**恰好一次**（计数断言）；④ 模板抛错时降级 + 日志可见 + 生成不被阻断 |
| **P7** | 文档与交接 | ① 插件 README（含保真度损失登记）；② 阶段交接文档（含"续接提示词"）；③ 更新 `插件框架规范.md` 的契约登记 |

---

## 10. 可执行断言清单（V1–V10，P6 终跑）

| # | 断言 | 判据 |
|---|---|---|
| **V1** | 未启用插件时请求体逐字节一致 | 与"改造前基线"字节比对（**先伪造差异证明断言非恒真**） |
| **V2** | 黄金基准逐条一致 | **57/57**（且 1002 块语法面计数一致） |
| **V3** | 无 `<%` 泄漏进请求体 | 请求体扫描 `<%` 命中 0 |
| **V4** | 尾部仍为单条 system | 出站数组末尾 system 计数 = 1；次末条非 system（`api.ts:364` 前提） |
| **V5** | 缓存命中实测 | `usage.cached_tokens` ≈ 静态前缀 + 历史长度（含 EJS 条目已退出前缀） |
| **V6** | 写入幂等 | `setvar` 提交次数 = 激活且含 EJS 的条目数（不是块数、不是轮数的倍数） |
| **V7** | 抛错降级 | 注入一个必抛模板 ⇒ 该条目内容为空/降级、其余条目正常、生成完成、日志有记录 |
| **V8** | 未实现符号显式抛错 | 调 `getchr` ⇒ 抛错且文案含 `getchr` |
| **V9** | 死循环风险已登记 | 文档 K1 存在 + UI 安全告知可见 |
| **V10** | R-a 探测回归 | 造一个输出含完整合法 `<session_conventions target="x" options="y">` 的模板 ⇒ 记录实际行为并与 K2 登记一致 |

---

## 11. 风险与回滚

| # | 风险 | 等级 | 缓解 | 回滚 |
|---|---|---|---|---|
| **K1** | 模板死循环冻结应用（**发送路径**） | high | UI 明示 + 块数/耗时软上限；**不做** Worker（D12） | 停用插件 ⇒ 缝隙`needsPromptText` 退化为 `hasVariableMacro`，行为回到改造前 |
| **K2** | R-a 误触发（EJS 输出含合法 `<session_conventions …>`） | low | 登记 + 注释说明 | 同上 |
| **K3** | 模板抛错 | medium | 条目级降级 + 日志 | 同上 |
| **K4** | 自实现引擎语义偏差 | medium | 黄金基准 57 条目逐条比对 | 引擎可独立回退（不改宿主） |
| **K5** | `getwi` 保真度损失 | low | 文档登记 | — |

**整体回滚**：`plugins/registry.ts` 移除一项 + 停用即回到既有行为；宿主缝隙的改动在"无渲染器注册"时**逐字节等价**，因此**不需要回滚宿主改动**即可安全停用。

---

## 12. Non-Goals（NG，本阶段明确不做）

| # | 不做 | 原因 |
|---|---|---|
| **NG1** | EJS 编写功能（编辑器/高亮/在线修改） | 用户明确定义范围外 |
| **NG2** | 装饰器 `@@*` / `[GENERATE:*]` / `[RENDER:*]` / `[InitialVariables]` / `[Preprocessing]` | 5 卡 0 命中；不为假想需求补契约 |
| **NG3** | `@INJECT` 提示词注入 | **NG4 已拍板不做** |
| **NG4** | ext-host / nginx 后端 | 纯前端即可 |
| **NG5** | Worker 隔离 / 可中断执行 | 当前 CSP 下不可行（D6/D12） |
| **NG6** | 变量管理器 UI | JSR 侧 NG5 |
| **NG7** | ST 的 character/preset/script/extension 四作用域 | JSR 侧 NG8 |
| **NG8** | 按 swipe 分支 | 宿主无 swipe |

---

## 13. 变更记录

| 日期 | 变更 |
|---|---|
| 2026-09-18 | 初稿（待用户复核）。含 D1–D15 与修正项 **D16-R**（EJS 在渲染链中的位置）。**未进入编码**。 |
| 2026-09-18 | 用户拍板「全部使用推荐」⇒ SSOT 定稿（§1/§1.1/§14），路径纠正完成（§5.1）。 |
| 2026-09-18 | **P0 完成**（`dev-server/tools/verify-ejs-golden.ts`）：57/57 条目 ok、failed 0、42 ms；语法面 11 项与审计报告**逐项一致**；两次运行 `golden.json` **SHA256 一致**（`C00DC334081836DC78A478104B6BE73533DD0B9FE2DB859C2B26911E7CC58B82`）。<br>**P0 修正三处**：① 渲染单位 = **57 条目**（非 1002 块）；② env 符号 6 → **7**（新增宿主全局 **`YAML`**，见 §6）；③ 上游 `ejs.js` 是 **browserify UMD bundle**，Node 里**可直接 require**（无需 shim）。 |

---

## 14. 拍板与遗留

**已拍板（2026-09-18，用户：「全部使用推荐」）**：

1. ✅ **D1–D15**：全部按推荐取值（见 §1 表）。
2. ✅ **D16-R**：采纳 **选项 A**（pre-pass 复现完整前缀链，EJS 最后，与上游一致）。
3. ✅ **路径纠正**：`plugins/EJS-template` 已改为空目录（见 §5.1）。
4. ✅ **§0.3 范围外清单**：无需要收回的项（用户未提出补充需求）。

**遗留与偏差登记（2026-09-18，P1–P5 并行开发中）**

**进度**（10 任务）：✅ **t1–t9 全部 completed**（t1 引擎核心、t10 集成冒烟为 captain 自办）；⬜ **t10 集成冒烟 —— 唯一剩余任务**。其依赖（t1–t9）已全部满足，但**必须在 `host/env.ts` 的语义收口冻结之后、于最终快照上一次性跑完**（理由：口径 10 的语义修订正在落地、且存在"终态后修正"造成的哈希漂移，见下方「后交付修正清单」与「锚点冻结纪律」）。

**五条必须随结论一起传播的口径**：

1. **渲染单位 = 57 个"含 EJS 的条目"**（不是 1002 个块；后者是语法统计单位）。
2. **黄金 57 条里 `random`/`sample`/`sampleSize` 的实际调用次数 = 0**（t3 计数 + verify-engine **独立复现**）⇒ "57/57"只兜住 `get`/`has`/`set`/`omit`/`cloneDeep`/`isObject` 六个函数；随机三函数（文字层 `_.random` 出现 38 次但**分支未命中**）**不由 57/57 覆盖**，改由 verify-engine 新增的**「随机三函数 · 真 oracle 对拍」**（3 源 × 17 形态 = **51 组，差异 0**）+ 随机源契约探针覆盖。该段的取巧之值得留档：**lodash 在模块加载期捕获 `Math.random`（加载后改无效），但「清 require 缓存 + 临时替换 `Math.random` 再 require」可在加载前把随机源钉死** ⇒ 拿到真 lodash 作逐值 oracle（`try/finally` 复原 `Math.random` 与缓存）；并打印源敏感性抽样（`random(5,true)` = `0` / `4.999999509999999` / `2.10042`）证明该段非恒真。
3. **出货路径覆盖缺口 —— 已由 verify-engine 关闭**：原判据的 `makeEnv` 传真 lodash 包 + 整体替换三函数 ⇒ 只证明「上游 ejs.js + **真 lodash** ↔ 自实现引擎」。现新增"**出货路径复核**"段（默认开、`--no-lodash-subset` 可关、**进判定**）：`assertLodashSubsetSelfCheck()` 前置 + 全 57 条把 env 的 `_` 换成 `lodashSubset` ⇒ **57/57 差异 0**；随机源契约探针 `subset(()=>0)` = `"1|a|ab"` 与"真 lodash + P0 桩"逐值等价、`(()=>0.9999999)` = `"10|c|ca"`（证明确实吃到子集）。根因（值得记入脚本注释）：**lodash 在模块加载期捕获 `Math.random`**，之后改它无效 ⇒ 两条打桩路径不可互换。
4. **文字层出现次数 ≠ 运行期调用次数**（t3 / verify-engine 双重实测）：`_.get` 文字层 **212** 次、运行期 **95** 次；`_.random` 文字层 **38** 次、运行期 **0** 次。⇒ 任何"覆盖了哪些函数"的结论必须以**运行期计数**为准。
5. **组装期分流必须用"事实"判据 `hasPreparedPromptText(ruleId)`**，**不可**用 `needsPromptText` 的补集 —— 否则"插件已注册但本轮未启用/无 pre-pass 结果"会把含 EJS 条目移出静态前缀，破坏"未启用时逐字节一致"。t4 已用**篡改实验**证明（换错判据后 A1/A5/A7/C9 报红，A7 文案"含 EJS 条目被误移出静态前缀"）。
6. **⚠️ carrier 的 env 契约：快照顶层 = 模板作用域**（t6 按 `carrier.ts:362-366` 核实，与纸面描述不同）：`carrier.ts` 把 `envSnapshot` **按引用**存进 `window.__nyaEjsCarriers[nonce].env`，iframe 直读并作为 `anonymous(locals, …)` 的 **`locals`** 调用。⇒ `getvar` / `getMessageVar` / `setvar` / `setMessageVar` / `getwi` / `YAML` / `_` **必须全部挂在快照顶层**（`with (locals||{})` 下裸标识符才命中），**不是** postMessage 传"数据字段"；只给数据字段会让模板全面 `ReferenceError`。写入落点按 `writesSink` 约定（`__writes`→`writes`→`__nyaWrites`→`__takeWrites()`）放**非枚举** `writes` 数组。
7. **⚠️ `getwi` 桩 = null 的判据边界**（t6 登记、verify-engine 已完成登记并扩成形态矩阵）：P0 黄金的 `getwi` 桩是 `null`（`verify-ejs-golden.ts:118`，**刻意不改** —— 改了会与 golden 失配），而真机 `getwi(name)` 必须返回**当前角色世界书**对应条目的 `content`（来源是宿主 `lorebook.getEntries()` ⇒ `CharacterSettings.worldInfo[].content`，**不是** golden 断言表里那份 `data.character_book.entries[].content` ⇒ "条目在 57 条里却在同卡断言里查不到命中"属**预期**，不是缺陷）。实测：源码层含 `getwi(` 的条目 = **1 个**、运行期实际调用 = **1 次**（`实力至上主义教室(维多利亚版).json#1`「{章节控制器}」），魔法少女卡 0 次 ⇒ 与 P0 manifest `envSymbols.getwi: 1` 一致。
   - 已写入 PASS 摘要（stdout）与 `--json` 的 `boundaries[]` / `getwiBoundary`；
   - **附加差分（不进 57/57 主判据）**：把 `getwi` 换成**返回形态矩阵**（多行+标签 / 空串 `""` / 纯文本 / 含引号反斜杠换行 / 含 EJS 定界符字样 / 含 XML 保留字符 / 长文本 2k / null 基线）× 57 条，逐形态做**引擎 ↔ 上游**差分 ⇒ **全部差异 0**；每个非 null 形态与 golden 差 **1 条**（恰是 #1）⇒ 证明该分支是**活代码**、且在该分支上自实现引擎仍与上游逐字节一致（其中"空串 `""` 与 null 可观测不同"印证 t6 的 D 项）；
   - ⇒ 对上游/对后续阶段的表述口径：**「57/57 覆盖的是 `getwi → null` 分支（P0 桩口径）；返回 content 的分支由『上游 oracle 形态矩阵差异 0 + 换桩触发 golden 差 1』证明等价，但不在主判据内。」**
   - ⚠️ t6 的 A–E 实现语义（命中 / miss⇒`null` / 空白 trim / `content === ""` 返回 `""` 而非 `null` / 跨条目不串味）**未**进该矩阵：在 verify 脚本里复刻只会自证（"复刻版 = 复刻版"），真验需值导入 `env.ts`（会拖宿主 `scriptHost`）⇒ 如实登记为 t6/P6 范畴，**不冒充覆盖**（跨条目独立性在 verify 侧结构上不可能测：每条目新建 env）。
8. **未实现符号清单 = 单一来源（已从"两份人工对齐"升级为"类型系统保证"）**：`host/env.ts:56` 现从 `../errors` **导入** `UNIMPLEMENTED_EJS_SYMBOLS`、`:92` **原样再导出**为 `UNIMPLEMENTED_ENV_SYMBOLS`（**27 项**，含 `$`/`toastr`/`z`）—— 本地手抄的那份清单已删除，**漂移根源消除**。依赖方向 `host/env.ts → errors.ts` 单向、`errors.ts` 零 import ⇒ **无环**。
   - 为什么必须单一来源（不是"一致性好看"）：**`host/carrier.ts:69` 直接 import 这份表**，用它重建「env 快照被克隆 ⇒ 函数被静默丢掉」时的抛错桩表（`buildUnimplementedTable`）；**缺项会在那条降级路径上退化成原生 `ReferenceError`**（仍失败，但不再是"显式抛错桩"，V8/O7 文案会漂）。
   - 实证：`UNIMPLEMENTED_ENV_SYMBOLS === UNIMPLEMENTED_EJS_SYMBOLS`（同一引用）；27 项逐项经 `makeUnimplementedEnvSymbol` 抛错且文案含符号名（缺项列表为空）；`describeEjsError(<toastr 桩抛出的错>, { entryName })` ⇒ title 同时含符号名与条目名。
9. **`$` 的口径：保持显式抛错，不给"最小假实现"**（t6 提请、errors-docs 会同复核、captain 拍板）：`$` 是**上游注入的 env 符号**（`[ejs.ts]:31-32` 的 `SHARE_CONTEXT` 注入 jQuery）。
   - ⚠️ **事实修正**（errors-docs 复核）：**NyaaChat 有 jQuery，但只注入 JSR 的 script-host iframe**（`src/plugins/scriptHostImpl.ts:221` 的 `/vendor/script-host/jquery.min.js`），**EJS 载体（srcdoc）不注入** ⇒ 载体里**没有 `$` 提供方**（早期"本仓库无 jQuery"的表述不准确）。
   - 依据：SSOT §6 的未实现清单逐字含 `$`（D11 已拍板）；5 卡 EJS 块内 `$(` **0 命中**。⇒ 按 D11 进 UNIMPLEMENTED 桩表、**调用即抛错**。**不**给假实现 —— 假实现会让模板静默走错分支（产出看似正常但语义错误的文本），比显式抛错更糟。
   - 未来若确需：正确路线是**复用同一份 vendor 产物注入载体**（不自造假 `$`）+ 先走一次范围评审。
10. **⚠️ env 的读/写作用域与路径口径（t5 发现 → captain 裁定 → t6 落地）** —— 三条铁律，`host/env.ts`（宿主侧试渲染/诊断）与 `carrier.ts` iframe 内装配的 env **必须逐条同口径**：
    1. **读缺省 = `cache` 合并视图**（`Object.assign({}, global, chat, message)`，message 胜），依据上游 `[variables.ts]:437` 读缺省 `'cache'`；显式 `'message'` / `'chat'`(`'local'`) / `'global'` 各归其层；`'initial'` 无对应物 ⇒ **显式抛错**。**这条是卡里 26 次不带 scope 的 `getvar('stat_data')` 的真机命门**：只读 chat 会让它们全部命中 `defaults`、静默走错分支。
    2. **写缺省 = `message` 作用域**，依据上游 `[variables.ts]:307` 写缺省 `'message'`（"写 message + 合并读"自洽读回）。
    3. **写入路径原样、不剥离 `stat_data.`**；**读取**侧保留"原样 + 剥离"两试（读取宽容，保真两类模板写法）。
    - ⚠️ **必须纠正一条曾经的不成立理由**：早期（t5 报告 + `env.ts` 头注）以「剥离后**下一轮读不回来**、永远走 `defaults`」立论 —— **不成立**：`readPath` 本身两试，剥离写入的 `事件.信号` 会被第二次尝试命中。成立的理由只有两条：① **与 P0 判据基准（oracle）不一致**（`verify-ejs-golden.ts:109/114` 是 `lodash.set(vars, key, value)` **原样全路径**，无前缀处理）；② **保护 MVU 变量树结构**（NyaaChat 的 MVU 树以 `stat_data` 为根键，剥离会把 `stat_data.事件.信号` 落成根上的 `事件.信号`）。**已分别下达 env-bridge 与 carrier 改注释**，`env.ts` 的 3 处头注现为**否定式**表述（显式写明"不是读不回来，第二试仍会命中"）。
    - **读取宽容的精确边界（env-bridge 自检 B 钉死，captain 裁定保持现状）**：第二试**只在字面路径 miss 时触发、不做跨层兜底** —— ① 字面路径命中（`getvar('stat_data.预置.值')` ⇒ `'B'`）；② **P0 桩形状**下剥前缀宽容有效（store 根上无 `stat_data` 层时 `getvar('stat_data.阶段')` ⇒ 命中）；③ **不跨层**（`stat_data.X` 存在时 `getvar('X')` ⇒ `undefined`）。⇒ 第二试的正当性是"**同一个 key 的两种书写口径**"，**不是"任意 key 的跨层搜索"**；跨层兜底会让写错的路径也静默命中，与 D11 精神相反。（captain 原措辞"两者都返回 `v`"只在"该 key 位于根上"的形状下成立 ⇒ **修的是措辞，不是实现**。）
    - **`getMessageVar` 的语义（t6 写自检时发现并修正，后又经 carrier 交叉核对再修一次）**：原实现是"纯 message 作用域"（`{scope:'message'}`），**错**。上游 `[variables.ts]:475-483` 的 `case 'message'` 在**没有 `withMsg`** 时执行的正是 `get(STATE.cacheVars, …)` ⇒ **合并视图**；`withMsg`（逐楼层过滤）本阶段不支持 ⇒ **单一实参形态永远走合并视图**。
      · **中间态（曾短暂生效）**：改为 `getMessageVar → getvar(key, {scope:'cache'})`；
      · **终态（carrier 报差异、env-bridge 复核上游后确认 carrier 对）**：`getMessageVar` 内部改回 **`{scope:'message'}`**，而 **`getScope('message')` 本身已归合并视图** ⇒ `'cache'` 与 `'message'` 在实现里**同义**，与上游 `[ejs.ts]:285` 逐字镜像。**"只读当前楼层"不再由任何 scope 表达**，只能取内部 `snapshot.variables.message`。
      · 常驻自检已把这条钉住：`✓ 显式 scope:'message' 与缺省同源 ⇒ "chat"` + `✓ 纯楼层树可由 snapshot.variables.message 直接取`（**断言数 10 → 11**）。
    - ⚠️ **残留静默缺口（errors-docs 发现，captain 采纳并登记；这是"高保真读法"的代价，不得省略）**：NyaaChat 的合并视图缺上游 `cacheVars` 的两项来源 ——
      1. **`STATE.initialVariables`** 无对应物 ⇒ **⚠️ 精确的偏差只发生在一种情形**：某键的**唯一来源是 `[InitialVariables]` / `@@initial_variables` 装饰器条目**（NG2 不做 ⇒ 在 NyaaChat **永不初始化**）⇒ 上游 cache 视图**本应含该键**、而我们**静默**给出 `defaults`。（对**其它**缺失键的静默回落与上游 `get(STATE.cacheVars, key, defaults)` **一致、不构成偏差** —— 前者才是 D11 会介意的那类"静默产出"的**唯一残留面**。）
         · ⚠️ **这是结构性、确定性的缺口，不是"待验"**：`initialVariables` 的**唯一来源**是上游的 **`[InitialVariables]` / `@@initial_variables` 装饰器**（`.ref/.../features/initial-variables.ts`、`function/worldinfo.ts`），而该装饰器正是 **§12 NG2 明确不做的**（5 卡 0 命中）⇒ **那些键在 NyaaChat 永不初始化，不存在可验路径**。
         · ⚠️ **不可混淆**：NyaaChat 的 `[initvar]`（`src/plugins/scriptHost.ts:95`，指"被禁用条目由 JSR/MVU 侧初始化"）**≠** 上游 `initialVariables`，**不可能覆盖**这个静默面。
         · **表述更正（本轮）**：SSOT 早先版本曾写"**属 P6 真机可验项**" —— **该表述已被证伪并撤销**（captain 批准的措辞，errors-docs 独立核上游源码后证伪，README §5 同句一并修正）。教训：**"待验 / P6 可验"这类条件句，必须先有"存在可验路径"的实证，否则就是美化。**
      2. 上游 cache 另含两个**簿记键** `_trace_id` / `_modify_id`（`variables.ts:58`）⇒ 我们的合并视图没有它们。
    - **文档反向漂移已修**：README §5 损失 #2 原写"无 `cache`/`initial` ⇒ 抛错"与实现不符 ⇒ errors-docs 已按 A′（docs-only、一次改完）改为"`cache` 由合并视图近似 / `'initial'` 抛错 / 残留缺口如上"；SSOT §6 本行已同步；`EJS技术性说明.md` §6.3 的同一句待对齐。**这是与 `$` 前提同型的"实现更准、文档更旧"**——比"实现落后于文档"更隐蔽（实现更好 ⇒ 没人去文档里找 bug ⇒ 错前提被后续阶段当依据引用）。
    - **常驻自检（不是一次性探针）**：`host/env.ts` 导出 `assertEjsEnvSelfCheck()`（自带门面桩 + 结束复原，**11 条断言** —— 含"显式 `scope:'message'` 与缺省同源"哨兵与"纯楼层树可由 `snapshot.variables.message` 直接取"两条，失败即抛错并附期望/实测）、`assertEjsEnvStubOnly(snapshot, flatSnapshot)`（纯断言、可拿任意快照复用）、`checkEnvSnapshot()`、`mergedCacheView()`。复跑：`npx tsx -e "import('./plugins/EJS-template/host/env.ts').then(m=>{const r=m.assertEjsEnvSelfCheck();console.log('ok='+r.ok+' checked='+r.checked)})"` ⇒ **`ok=true checked=11`**（坐标 `env.ts = d5584aeba486` / 60,671 B / 09:13:40）。
      - ⚠️ **调用副作用（P6 假阳性陷阱）**：该自检会在 `getEnvStartupWarnings()` 里留下一条 `host-api-unavailable` 启动告警，而那条 API 正是插件 UI 首屏读的（详见下方第 11 条）。
    - **`$` 的注释前提（t10 获批修正）**："NyaaChat 没有对应物（上游是 jQuery）"是**事实错误**（NyaaChat **有** jQuery，只注入 JSR 的 **script-host** iframe；EJS 载体是 srcdoc、不加载）⇒ 已改为"**载体 env 里没有提供方**"。**结论不变（保持抛错）**，但前提必须准确，否则将来的范围评审会得出"新引一份 jQuery"的**错方案**（正确路线是**复用同一份 vendor 产物注入载体**、零新依赖）。
    - **已知差异（影响 0，不改行为）**：显式 `scope:'message'` 时 `env.ts` 读**楼层树**、而载体 iframe 内读**合并视图**（依据上游 `[variables.ts]:481`）。两张卡 **0 处**显式 scope ⇒ 对 P6 不可观测，仅登记。

**后交付修正清单（"终态后修正"：成员在任务 completed 之后继续改动自己 inScope 的文件）**

这是本轮**哈希漂移的根源**，t10 必须用现场重算的最终快照（见「锚点冻结纪律」）。逐条如实登记：

| 成员 / 任务 | 文件 | 性质 | 内容 | 复核 |
|---|---|---|---|---|
| errors-docs / t8 | `errors.ts` | **行为变更**（潜在缺陷修复） | `SYMBOL_PATTERNS` 改**精确形态优先** + 多候选**优先取命中未实现清单者**；修掉"自家工厂消息被 carrier 字符串化后符号名误报为 `EJS`"（宽松正则 `(?:未实现\|不支持)[^\w$]{0,4}([\w$]+)` 曾吃掉"未实现"与"EJS"之间的空格，且宽松式排在前面） | **captain 独立复现**（不采信回执）：8 符号 × 4 形态 + 负向对照 ⇒ `ALL_PASS`（探针 `dev-server/tools/_tmp_errors_probe.ts`，跑完即删）。**修复有效、保留** |
| errors-docs / t8 | `errors.ts`、`README.md` | docs/comments only（0 行为变更） | 清单头注明"全插件运行时权威 + env/carrier 消费点"；`$` 条目补依据；README §6 改为单一来源结构 + `$` 裁定段、§10 补结构验证记录 | `tsc` / `eslint` exit 0；captain 已核 `$` 裁定（见口径 9） |
| env-bridge / t6 | `host/env.ts` | **行为变更**（口径统一） | ① 未实现清单改为从 `errors.ts` **导入再导出**（单一来源，口径 8）；② 读缺省改 `cache` 合并视图、写缺省改 `message`、写入路径原样（口径 10） | captain **亲自读盘核对**；并已就"读不回来"这条**不成立理由**下达纠正 |
| lodash-subset / t3 | `lodashSubset.ts` | 注释 only（0 代码改动） | 文件头把"打桩只能整体替换三函数"放宽为"**要么**整体替换、**要么**在 `require` 之前改 `Math.random` 并摘 `require.cache`"；浮点边界定性由"差异"改为"P0 桩的形状近似"（附 60 组 / 3 源实测） | 与 verify-engine 的 57 组 / 3 源**互相独立、同结论**；哈希双向锁定（33989 B / 781 行 / `e0e881ed493b21b8…`） |
| verify-engine / t9 | `verify-ejs-engine.ts` | 判据增强（新增附加段与登记） | `getwi` 边界登记 + **返回形态矩阵 8 形态 × 57 条差分全 0**；随机三函数 oracle 升到 3 源 × **19** 形态 = 57 组差异 0；修掉样本标签按下标取的隐患 | 三模式（`both`/`subset`/`real`）复跑全绿；`--negative-control` 57/57 全检出 |
| plugin-ui / t7 | `EjsTemplateSettings.tsx` | UI 文案 + 排版修 | 运行日志区补"列表只显示首行 / 面板框保留 1200 字符"口径说明；修掉一处 `</p>        ) : (` 排版粘连 | `tsc` / `eslint` exit 0 + 模块加载冒烟（`meta.id='ejs-template'`） |
| carrier / t5 | `host/carrier.ts` | 任务内修正 + 保险 | ① 任务文本给的 type-only 路径 `../../src/plugins/promptText` 会解析到不存在的 `plugins/src/...` ⇒ 改 `../../../src/plugins/promptText`（类型仍是冻结的 `PromptTextWrite`）—— **captain 裁定接受（任务文本有误，非实现偏离）**；② 按 t2 的 5 条前提补 `includeFallback`（`with (locals \|\| {})` 下不可达的第二道保险） | `eslint` / `tsc` 全绿 + srcdoc 字符串 `new vm.Script` 语法级校验通过（12,204 字符） |

**⚠️ 哈希漂移实证（t10 必须处理的坑）**：verify-engine 末次快照报 `errors.ts 7cc62612008d` / `plugin.tsx 4f9ff7727f98` / `EjsTemplateSettings.tsx 7afdfec8991a` / `host/carrier.ts 0c264fab3786`，而 captain 事后实测磁盘为 `errors.ts df8e24108d98`（其后 errors-docs 又做了第二轮 docs 同步）/ `plugin.tsx e3afaf5e97c8` / `EjsTemplateSettings.tsx f44f08da3bf7` / `host/carrier.ts a456082cebd8`。⇒ **t9 的 PASS 记录与"当前磁盘"不是同一版本**；其中 `carrier.ts` **在 P1 判据的输入面上** ⇒ **t10 必须在冻结快照上重跑**，且**不得引用任何成员回执里的哈希**作为冻结依据。

**冻结状态（captain 已下达，2026-09-18）**：`errors-docs` / `plugin-ui` / `carrier` 已回执"已冻结"；`env-bridge` 的 `host/env.ts` 是**唯一获准在 t10 前继续改动**的文件（收口后立即冻结并报哈希）。冻结范围 = `plugins/EJS-template/**`、`src/plugins/promptText.ts`、`src/lib/chatPipeline.ts`、`src/components/ChatInterface.tsx`、`dev-server/tools/verify-ejs-engine.ts`。

**登记偏差（本样本影响 = 0 或不阻塞，留待后续阶段）**：

1. **`keyword` + 含 EJS 的条目被移入 `═ 模板设定 ═`**（t4 按 §2.1 原文实现）⇒ 会**丢失原有 `hard`/`soft` 分档**。实测本样本仅 2 条（`实力至上主义教室#89 Z1_Y1`、`#92 Z1_Y2`）**且均 `enabled:false`** ⇒ 不会被 pre-pass 渲染 ⇒ **实际影响 0**。正确语义应为"渲染与分档正交：`keyword + EJS` 渲染后仍进硬/软约束"。改正需动已完成的 t4 并作废其 26/26 对拍证据，故登记于后续阶段。
2. **D9 的"持久层统一提交一次"尚未接线**（t4 / t7 均独立登记；captain 已核实 API 与正确接法）：
   - **现状**：写入意图由 `host/env.ts` 的 `recordWriteIntents()` 登记到**本轮活快照**的 `writes`；`env.ts:624` 有 `takeSessionWriteLog(snapshot|sessionId)`、`:634` 有 `clearSessionWriteLog(...)`，但**全仓无调用者**（已 grep 确认；`plugin.tsx:41,450-451` 的注释也写明"该调用点属宿主侧"）。
   - ⚠️ **关键约束（决定了接法）**：`src/plugins/promptText.ts` 是**宿主叶子模块**，**不得 import 插件代码**（`plugins/EJS-template/host/env.ts`）⇒ 宿主**无法**直接调 `takeSessionWriteLog`。
   - ⇒ **正确接法（t10 执行）**：走**已冻结的契约**，不新增宿主→插件的反向依赖 —— ① 插件在 `PromptTextRenderer.takeWrites()` 里实现"取一次并清空"（内部调 `takeSessionWriteLog(sessionId)` + `clearSessionWriteLog(sessionId)`）；② 宿主 `promptText.ts` 新增 `flushPromptTextWrites()`，遍历 `getPromptTextRenderers()` 聚合；③ `ChatInterface` 在 `await preparePromptText(...)` 之后提交**一次**到变量层（按 `scope`/`messageId`）。⇒ **V6（每轮恰好一次）** 成立。
   - **t5 完成后的现状（2026-09-18，captain 亲自 grep 确认）**：① 插件侧 `plugin.tsx` 的 `takeWrites()` **已实现**（取一次并清空 `turn.pendingWrites`），契约正确、**不需改**；② 宿主侧 `src/plugins/promptText.ts` 仍**没有** `flushPromptTextWrites()`；③ `ChatInterface.tsx` 有 `await preparePromptText(...)` 但**没有**提交调用。⇒ 三步只差 ②③，**由 t10 补齐**。

3. **降级条目在宿主缓存里是空串**（`entry.text === ''`，t7 登记）：`chatPipeline` 若把它计入 `═ 模板设定 ═` 会产生多余空行 ⇒ **t10 须核对是否过滤空文本**（属 P4 字节回归的边角）。

4. **浏览器级面板 DOM 验证未做**（t7 登记：仓库无 jsdom / happy-dom，且**项目规范禁止未经用户明确要求启动容器** ⇒ 成员不得自行起 dev 容器）。⇒ t10 只提供"源码接线 + store 运行时行为"证据。
   - ✅ **captain 已就此事向用户请示，用户于 2026-09-18 裁定：「登记为验证缺口，留到 P6 真机验收」**（不启动 dev 实例、不 rebuild 容器）。
   - ⇒ **三项缺口如实登记、不在 P1–P5 内宣称覆盖**：① 开关生效；② 错误在面板可见（非仅 console）；③ 统计数字与 P4 实际渲染条目数一致。**归属 P6 真机验收**。
   - ⇒ 收尾文档（P7 交接）必须原样带出这三项，不得写成"P5 已全绿"。

**另**：`.verify-tmp/` **已在主仓 `.gitignore:14`**（与 `eslint.config.js` 的 ignores、`tsconfig.json` 的 exclude 三处一致）—— t4 报告中"未在 .gitignore"的判断不成立，无需动作。

**一条留档事实（避免后人误引"逐值等价"）**：`lodashSubset` 与 P0 桩在**浮点单参形态**上取值不同 —— `random(5, true)` 在随机源 `()=>0` 下：P0 桩给 `lower/2 = 2.5`，而 `lodashSubset` 走 lodash 真实浮点公式给 `0`（真 lodash 是 `[0, lower]` 均匀浮点，**子集才是对 lodash 的忠实复刻**）。
该结论已由**两个独立来源实测确认**（verify-engine：3 源 × 17 形态 = **51 组差异 0**；lodash-subset 自行复现：3 源 × 20 形态 = **60 组差异 0**，含 `Math.random` 复原校验与源敏感性抽样 `0 / 4.999999509999999 / 2.10042`）⇒ **真 lodash 在 `fn=()=>0` 时同样给 `0`**，P0 桩的 `lower/2` 只是"形状近似"（期望值上对、确定值上不对）。
⇒ 引用"与 P0 桩逐值等价"时必须**限定为** `random(2 参整数)` / `sample` / `sampleSize`；5 卡该形态 **0 命中**，对判据无影响。
⇒ **并修正一条早先表述**：lodash"打桩只能整体替换三函数"仅在**加载后**成立；**加载前**改 `Math.random` + 摘 `require.cache` 同样有效 —— 这正是"真 oracle 段"得以建立的手法。（已写入 `lodashSubset.ts` 文件头）

**一条文档引用纪律（errors-docs 提出、captain 采纳）**：文档/注释里引用他人代码时**以符号名为主、行号为辅**，并标注"核对时点" —— 本轮已实测到行号引用因他人编辑而集体漂移（`host/env.ts:56,92` → `:66,102`）。⇒ SSOT / README 中凡"行号"一律视为**核对时点的快照**，**不作为判据**。

**t10 集成记录（2026-09-18）—— ⚠️ 所有权与归属更正**

> **t10 由 `eng-tools` 持有**（scheduler 派发），**不是** captain 自办。captain 原计划自办，但 `reassign_task(t10, captain)` 被拒（"owned by eng-tools"）；且 eng-tools 已在跑**独立的**集成冒烟（`dev-server/tools/verify-ejs-integration.ts`，真实 fixture：1 条变量宏常驻条目 + 4 条真实 EJS 条目），**一轮就抓出 captain 引入的回归**。⇒ **captain 转为配合（裁定 + 协调 + 记录），不再抢 t10**；t10 的 output 由 eng-tools 写。
>
> **归属更正（captain 曾错误归因，已撤回并道歉）**：`src/plugins/promptText.ts` 的 `commitPromptTextWrites(turnId)`（`committedTurnId` 幂等 + 按作用域/messageId 批次合并 + `takeWritesSafely` + `isForbiddenWritePath` 第二道闸）与"把调用点放进 `preparePromptText` 末尾"的设计，**作者是 eng-tools**，不是 host-slot。captain 曾据此指控 host-slot"任务终态后未报告改动" —— **该指控不成立、已撤回**。技术裁定不变（该设计在正确性上更优：调用方不可能忘记提交，幂等键天然满足 V6）；**流程要求**：任务终态后的改动**先在群里报一声**。
>
> **另一笔独立发现（eng-tools）**：`host/env.ts` 的 `takeSessionWriteLog(sessionId)` 字符串形式**恒查不到快照**（表里的键是 `session:<id>`，函数却按原样查）⇒ 静默返回空数组；已修成两种键都认。

**captain 侧的发现与修复（含一处被 eng-tools 抓出的回归）**

1. **P1 判据由 captain 亲自复跑通过**（不采信成员回执）：`npx tsx dev-server/tools/verify-ejs-engine.ts` ⇒ `exit 0` + `结论：✅ PASS` + `一致 57/57，差异 0`；附加段 **8 项 ✅ + 1 项 ℹ️**（env 真机语义 13/13，标 `info`、非判据）；O1 = 57 条 / 1002 块、O2 = 161,256 字符（均与 P0 manifest 一致）；`golden.json` SHA256 仍 `C00DC334…58B82`（P0 产物未变）。
2. **🔴 t10 发现并修复一个 K3 缺陷（潜在 blocker + 可达的 medium）**：
   - **潜在 blocker（对本样本不可达）**：`promptText.ts` 的两条降级分支（catch / `!rendered`）**只设 `error`、不设 `text`** ⇒ `hasPreparedPromptText()` 判的是 `text !== undefined`，故为 **false** ⇒ 该条目落回 `nonRendererPermanentRules` ⇒ 再按 `hasVariableMacro` 分到**静态前缀**或 `═ 变量状态 ═` ⇒ **含 `<% %>` 的原文照发**，直接违反 §2.7 K3 与 §10 V3。原告警文案"已降级（**该条目回退原文**）"更把错误行为写成了设计。**对当前唯一渲染器不可达**（`plugin.tsx` 自己吞错并返回 `''`）⇒ 非活跃故障，但契约面必须正确。
   - **可达的 medium**：`text = ''` 时 `hasPreparedPromptText` 为 true ⇒ 条目进 `═ 模板设定 ═` ⇒ `renderSectionEntry` 产出 `[World Info] ` **空壳行**（模板正常渲染出空串时同样如此）。
   - **修复（两处，配套才完整）**：① `promptText.ts` 两条降级分支显式写 `text: ""`（= "已接管、无内容"）⇒ 不再落回原文路径；② `chatPipeline.ts` 的 `═ 模板设定 ═` 组装改为 `.filter((r) => getPreparedPromptText(r.id, "") !== "")` ⇒ 空文本条目**整条丢弃**、不留空壳行。
   - **新哈希**：`src/lib/chatPipeline.ts` **`bbd531f8f8ba`**（此后未再变）/ `src/plugins/promptText.ts` **`b74deccf8811`**（**已被下述 A6 修复取代**）。
   - ⚠️ **该修复本身引入了一个回归（由 eng-tools 的独立冒烟抓出，captain 认账）**：`!rendered` 分支同样被写成 `text: ""` ⇒ **只含变量宏的常驻条目**（`needsPromptText` 对它为真，因 `hasVariableMacro`；但 EJS 的 `matches()` 为假（正文没有 `<%`）⇒ 它**不是**"被渲染器接管"）被误判为"已接管" ⇒ 移出 `═ 变量状态 ═`，又被新加的空文本过滤丢掉 ⇒ **既有变量状态条目整条消失**，违反 §2.6"原有行为、字节不变"（原判据红：`✗ [A6] 只含变量宏的常驻条目仍在「═ 变量状态 ═」`）。
     - **正确修法（eng-tools 提出、captain 批准）**：渲染器循环记 `claimed`（`matches()` 命中才算"认领"）；**`catch` 分支保持 `text: ""`**（泄漏防线不动：渲染器抛错 ⇒ 必然认领过）；**`!rendered` 分支** `claimed` 真 ⇒ `text: ""`、`claimed` 假 ⇒ **不写 `text`**（保持"未被接管"语义 ⇒ 变量宏条目回到 `═ 变量状态 ═`）。
     - **教训（值得固化的通用坑）**：一个"事实判据"（`hasPreparedPromptText` = `text !== undefined`）被**两种语义共用**（"渲染器接管过" vs "含变量宏"）时，往 `undefined` 之外写值会**同时改变分流结果**。⇒ 修一处必须回归**另一条既有行为面**（§2.6 的字节不变承诺），不能只看"泄漏被堵住了"。
3. **接受 verify-engine 的判据隔离**：env 真机语义段（13/13，**直接驱动出货的 `snap.getvar/getwi/setvar`**，不是复刻）标 `info` ⇒ 显示 `ℹ️`、**不进 `allPass`**。理由成立：它是 t6/P3 的验收面，与 P1 耦合会让 env 问题连带把 P1 判红、t10 归因变糊。⇒ **t10 只断言 `✅` 项，显式忽略标了"非判据"的 `ℹ️` 行**。
4. **已知可选增强（未做）**：plugin-ui 提议的"只在能确证阶段处传 `phase`"（`compileTemplate()` 前 `compile` / `buildEnvSnapshot()` 前 `env`，catch 里仅当有值时传）。其技术反驳成立：`renderEntry.outcome` **不能**一一映射 `phase`（`degraded` 同时覆盖编译错 / 运行错 / 载体渲染失败，`carrier.render()` 抛错也走 `fail(..., true)`），照 errors-docs 原建议映射会把能分清的阶段**判粗成一种**。现状已被验证正确（形态矩阵 7/7 + captain 独立复现 8 符号 × 4 形态 `ALL_PASS`）⇒ **冻结期不做**，P6 若出现阶段误判再启用（届时先报 captain 解冻）。
5. **冻结令的例外通道（t10 期间获批的改动，逐条留痕）**：冻结**不是**"不许改"，而是"**改前必须报 captain、合并成一次、改完重报哈希**"。本轮据此处理了 4 件事：
   - ✅ **批准（错误前提必改）**：`host/env.ts` 里 `$` 的注释写成"**在 NyaaChat 没有对应物（上游是 jQuery）**"—— 这是**事实错误**（NyaaChat **有** jQuery，但只注入 JSR 的 script-host iframe（`scriptHostImpl.ts:221`）；EJS 载体是 srcdoc、不加载它）。错误前提会被 P6/P7 与将来的范围评审当依据引用，"没有 jQuery ⇒ 新引一个"是**错误方案**，正确路线是**复用同一份 vendor 产物注入载体**。⇒ env-bridge 只改这一处，改完重报哈希。
   - ✅ **批准（文档自相矛盾必改）**：`README.md` §6（已标"以符号名为准 + 核对时点"）与 §10（仍是旧行号 `:56`/`:92`）**自相矛盾**，复核者照 §10 读盘会扑空。⇒ errors-docs 按 **A′ 零行号**形式改（§10 → 符号名引用；§6 **删掉**核对时点行号）。**理由**：行号会随 `env.ts` 改动反复失效（"刚换的行号立刻过期"），而**删掉行号** ⇒ 文档**再也不因别人编辑而变假**，且三方**不必时序互等**。
   - ⛔ **不批准（冗余）**：把 `$` 的逐字依据重复补进 `env.ts` 注释 —— 依据权威在 `errors.ts` 清单本体 + README §6，`env.ts` 只是再导出。**冗余不补、错误必改。**
   - ⛔ **不批准（会制造误导）**：在 `carrier.ts` 注释里"钉一下 `readPath` 两试边界" —— 载体的读**不走** `readPath`（iframe 内是纯 `lodashSubset.get(view, key)`，无剥离、无第二试；carrier 的 `Select-String` 命中 0 是硬证据），写进去会让读者误以为"载体也做前缀宽容"或"该边界限制模板内 `getvar`"。**载体注释只讲载体自己的契约**（指向性版本同样不采纳）。
6. **t11 首次运行的结论（captain 亲自跑，不采信回执）**：`npx tsx dev-server/tools/verify-ejs-host.ts` ⇒ exit 1、**33 passed / 1 failed**。唯一失败是**断言口径**问题、**不是产品缺陷**：`commitPromptTextWrites` 的幂等键让"生产路径已提交"之后的显式调用返回 0，而脚本把它当成"首次提交应为 48"。
   - 旁证（都在脚本自己的输出里）：✓ 写入确已落到变量层（`patchSession` 收到同条数变量）、✓ 同 turnId 第二次返回 0、✓ 生产路径每轮恰好一次且条数 = 条目数。
   - 已要求 host-slot 改为断言"**生产路径提交条数 = 激活且含 EJS 条目数**"（提交发生在 `preparePromptText` 内部才是**生产事实**），并要求说明输出里那条 `ERR_MODULE_NOT_FOUND: /vendor/script-host/yaml/yaml.esm.js` 是否为**被捕获并跳过**的预期分支（若是，必须显式打印跳过原因，不许静默缺口）。
   - **其余全绿**：V1 双版本 dump sha256 一致 + 3 项负向对照变红 + 临时基线模块已删；V3 完整块 0 / 裸 `<%` 0 + 3 项前置 + 降级条目内容不进请求体 + 降级不阻断其余条目；V4 `trailingSystem=1 / prevRole=user` + 2 项负向对照；V6 其余 8 条。
7. **t10 期间的最终快照验证（captain 亲自跑）**：在 `host/env.ts = 9211c810f82a` 的快照上 —— `npx tsc --noEmit` **exit 0（零输出）**；`verify-ejs-engine.ts` 默认 `--lodash=both` 与 `--lodash=subset` **都 exit 0 + `结论：✅ PASS` + `一致 57/57，差异 0`**，夹具 32/32，env 语义段 13/13（ℹ️ 非判据）。此后 `env.ts`（`$` 前提精确化 + `readPath` 头注精确化，**最终 `bcfa83103de6`**）与 `README`（零行号）各获批改动一次 ⇒ **最终坐标已由下方「锚点哈希」表的终验固化**。
8. **环境限制登记（t11 发现）**：`host/env.ts` 用 `import.meta.url` 推 vendor YAML 路径 ⇒ 在 **Node / tsx** 下会解析到仓库外的 `/vendor/script-host/yaml/yaml.esm.js`（**仅 Node 复现，浏览器正确**），YAML 预热失败。`verify-ejs-host.ts` 已把它打成一行提示、**不计入判定**。⇒ **Node 侧验证不覆盖 YAML 相关路径**，该点归 P6 真机验收。**不追加进 README**（避免第三次字节变更），由本 SSOT 承载。
9. **两条流程教训（本轮真实发生，值得固化）**：
   - **会被引用的坐标，取的时候必须确认已落盘/稳定**：env-bridge 编辑 `env.ts` 后**未等落盘就取哈希**，报出过期坐标 `777605908996`（实际 `bcfa83103de6`），而下游 captain 会把它当锚点写进 SSOT 与任务输出 ⇒ **"证据绑定到不存在的版本"**。正确姿势：**改 → 门禁 → 间隔复测哈希 → 再上报**。
   - **不要写死会漂移的行号**：errors-docs 的 README 行号引用因他人编辑集体过期（`env.ts:56/:92` → `:66/:102` → 再漂），最终按 **A′「零行号」**处理（只写符号名 + "`file:line` 一律视为核对时点的快照、**不作判据**"）。两条是**同一类问题的两个面**：凡会被引用的坐标，都要选**不会因别人编辑而变假**的形态。
10. **eng-tools 的独立集成冒烟（captain 亲跑）：24/24 通过、exit 0** —— `dev-server/tools/verify-ejs-integration.ts`（真实 fixture：1 条变量宏常驻条目 + 4 条真实 EJS 条目 + 故障注入）。覆盖面**超出** captain 原先给 t10 的判据清单：`A3a/A3b/A3c` 三态字节回归（未注册 / 已注册但本轮未跑 pre-pass / **中途停用不留上一轮残影**）、`A1/A1b/A1c` 泄漏 0 + **降级条目原文既没进静态前缀也没进尾部小节**、`A2/A2b` 尾部单 system + 含 EJS 条目进 `═ 模板设定 ═`、`A5d` **一次批提交 15 条**、`A5f` 回读一致、`A5c` 幂等、`A5g` 新会话恰好一次、`A5h` **换会话不串味**（比对到深处对象结构）、`A4/A4b` 模块环**双方法交叉扫描**、**5 组 NC 负向对照全部检出**。⇒ 其中 `[A6]`（只含变量宏的常驻条目仍在 `═ 变量状态 ═`）正是 captain 引入那处回归的**回归判据**，现已绿（`promptText.ts` 修后哈希 `3ce0387f1ab3`）。
11. **一个 P6 假阳性陷阱（carrier 转达、env-bridge 发现，务必记住）**：`assertEjsEnvSelfCheck()` 虽在 `finally` 里复原门面，但其**唯一非幂等副作用**是会在 `getEnvStartupWarnings()` 里留下一条 **`host-api-unavailable` 启动告警** —— 而该 API 正是**插件 UI 首屏**（§8 的"安全告知 / 启动告警"区）所读。⇒ 若 P6 在**真实页面**里先跑该自检、再断言面板的告警/日志区，就会看到一条**本不存在的** `host-api-unavailable`，**可能被误判成缺陷**。**规避**：先 `resetEnvSnapshotsForTests()` 清干净，或把该自检放在独立上下文里跑。
12. **一条判据写法教训（host-slot 自记，captain 采纳）**：把「**被测量的口径**」与「**覆盖的前提**」混在同一个 ✓ 里，读者就会替你脑补完备性。实测案例：`blocks` / `openTags` / `emptyShells` 都算清了，却**没有显式断言"被认领覆盖率"**，于是"计数正确"与"覆盖完备"看起来是一件事 —— 差点被队友误读成漏洞。⇒ 写这类判据时**拆成两条独立断言**，或至少**显式打印覆盖数**（如 `49/49 被认领，未认领 0`）。
13. **一条"实验窗口"纪律（本轮真实撞车）**：host-slot 执行 captain 批准的"修复前必红"反向对照（缺陷态 `promptText.ts = a1311c9b24c4`）时，**eng-tools 的常规跑恰好撞上该窗口**，它的 A1/A1d 报红后按产品缺陷排查了一轮。⇒ 收益是**两个互不相干的脚本复现了同一条泄漏**（判据非恒真的最强证据）；代价是一次误判。⇒ **做"伪造差异"实验必须在群里报一声开始与恢复**，并**在跑完后复测被测文件哈希**（host-slot 已把这条纳入常规用法）。
14. **P6 前的收尾改进（已派活）**：① 让 `verify-ejs-integration.ts` 在运行时打印**自报坐标块**（每个哈希在输出那一刻 `createHash` 读盘现算，含脚本自身哈希；且与 `--json` 共用同一份现算结果）+ 一条"**故意写错期望值 ⇒ 坐标块必须变红**"的自证；② A1f 提示语中性化；③ 一并修 t12 的 F2/F3/F4。⇒ **已建 t14 派 eng-tools 一次做完**。
15. **t12 终局交叉复核（verify-engine，`verdict = pass`；报告 `dev-server/tools/verify-ejs-review.md` 231 行 / sha256 `131e15be32cb…`）**：
    - **六项门禁在同一轮全 exit 0**（`engine` both/subset **57/57 差异 0**、`--negative-control` **57/57 全检出**、`host` **44-0**、`integration` **27-27**、`tsc` 零错）；坐标用 `--json.pluginSha` **机器比对 10/10**；复跑确定性已验证（判定行哈希两次相同）。⇒ **可据以宣称 P1–P5 通过**。
    - **F1（medium）— ✅ 已由 t13 修复（host-slot）**：t11 的 V1 原取 `git show HEAD:src/lib/chatPipeline.ts` 当基线 ⇒ **一旦改动被 git 提交，`HEAD` 就等于工作树 ⇒ V1 退化为"自己比自己"却仍然打印 ✓**（判据**静默失效**，最危险的一类）。修法已落地：
      · **冻结基线** `dev-server/ejs-baseline/chatPipeline.ts.txt`（sha256 `fdf0acb894f7`，全量已作为常量钉进脚本）⇒ **V1 不再依赖 git 状态**；
      · **六道守卫**（基线存在 / sha256 相符 / 与工作树版不同 / `git HEAD` 版 == 基线 / 基线不含 `promptText` 痕迹 / 基线不随渲染器注册而变），**除④外均报红**，绝不静默通过；
      · **三组守卫实测**：模拟"改动已提交" ⇒ **49/1**（同时判据本体仍 ✓ ⇒ 证明"仍有效"而非失效后误报绿）；移走基线 ⇒ **39/3**；把基线刷成当前实现 ⇒ **46/4**；
      · 正常态 **50 passed / 0 failed**（t11 44 → 只增不减）；脚本 **`b8c2d11ff7b9`**。
      · **守卫④的处置（captain 裁定，两次修订，以本条为准）**：最初裁"降为告警、不计 failed"（理由：提交后跑 CI 会永远红）；**收口期权衡后改为「保持报红 + 交接注明」** —— ① 本轮改动**尚未提交**，守卫④当前为绿 ⇒ **实际影响 0**；② 报红本身有警示价值（"你是否在拿 HEAD 当基线？"）；③ 收口期不再动已 complete 的产物。**后续动作**：若将来改动被提交且 CI 要求脚本 exit 0 ⇒ 把守卫④从 `check()` 降为 `console.warn`（保留 `[t12-F1 GUARD]` 全文）。
      · **已知残留**：为模拟提交态，仓库留下一个**不可达的临时提交对象 `6421131`**（`reset --mixed` 只重置引用；无法被 push，不影响 `HEAD`/`log`/`status`）。**captain 裁定不清理** —— `git gc --prune=now` 属仓库级操作，应交用户按需执行，不为一次测试动全仓 gc。
      · **基线命名 `.ts.txt` 是实测结论**：其相对 import 在 `dev-server/` 下无法解析，若叫 `.ts` 会被 `tsc` 拉进编译并报 **8 个 TS2307**。脚本头已写明"何时才该更新基线 + 同步改钉死常量（**日常迭代别顺手刷新 —— 那正是 F1 死灰复燃**）"。
    - **F2/F3/F4（low，并入 t14）**：integration 的 A5g 标签过度声明（`writes3` 收集未用）、A5h 计数口径噪声 + 缺"另一会话读不到"的反向断言、A5 第 5 行 NC 是代理却写"⇒ 判据变红"。
    - **F5（low，文档）实际已被覆盖**：errors-docs 现役 §5（`408f9215590d` @09:25:26）已写明"唯一来源是 NG2 不做的 `[InitialVariables]` ⇒ 永不初始化 ⇒ 上游本应含它而我们**静默**回落 `defaults`（对其它缺失键与上游一致、不构成偏差）"。
    - **正面核实（读代码，非采信）**：K3 修复与 §2.6/§2.7 逐条一致；`claimedBy` 是"失败该不该丢弃"的唯一判据；两处 `text:""` 防线确为两条独立路径；**A6 成立**；五项缺口全部如实登记且**未被宣称覆盖**；不可测项一律写"未覆盖"。
16. **一条记账边界（verify-engine 提出，本轮两次踩坑的根因）**：**"可复现输出" ≠ "可追溯时刻"** —— 为保 golden 逐字节可复现，判据脚本**刻意不打印时间戳** ⇒ **取证时刻必须由外层证据日志记录**（谁跑、何时跑、贴了哪段原文）。⇒ 坐标应记成 **哈希 + 字节数 + mtime + 门禁退出码 + 取证时刻**，且"记录里的哈希"必须与"当前磁盘哈希"**同轮**比对（`--json.pluginSha` + 磁盘逐项比位即此维）。
    - 由此**结清** `plugin.tsx` 的"取证后被改"疑问：t10 记录里的 `0a8042f7bbe6` 与 t12 实测磁盘**一致**；`mtime 09:16:15` 只可能是**内容等价写入（或 A→B→A 回退对）** ⇒ **证据绑定有效，无需再挂"待确证"**（`t10.updatedAt 09:18:37` 只是事后记账）。

**P1 判据的引用锚点（t10 直接引用）**：
- 命令：`npx tsx dev-server/tools/verify-ejs-engine.ts`（默认 `--lodash=both` = 真 lodash 主判据 **＋** 出货路径复核段，两者都进判定；另有 `--lodash=subset`（**出货子集当主判据**）、`--lodash=real`（跳过出货段，回归用）、`--lodash=bogus`（参数校验 ⇒ exit 2）、`--negative-control`、`--dry`、`--limit=N`）
- 期望（**不要写死附加段条数**，当前 8 项）：`exit 0` + `结论：✅ PASS` + `一致 57 / 差异 0`；**夹具 32/32**；前置自检 57/57；O5 有效命中 0；O6 ✅；**出货路径复核 ✅**（默认开）；随机三函数真 oracle **57/57**；`getwi` 返回形态矩阵 **8 形态差异全 0**；O7 ✅；两条覆盖边界登记（`getwi` 桩 = null / 随机三函数运行期 0 调用）同时出现在 PASS 摘要与 `--json.boundaries[]`。
- ✅ **t10 最终快照（captain 实测磁盘，2026-09-18 09:19 之后；sha256 前 12 位）** —— 这是本计划的**权威坐标**：
  - 插件侧：`engine/compile.ts 0c4f8b05406b` · `engine/escape.ts 16bbcf0f73d9` · `engine/syntax.ts f524d90bf7d7` · `lodashSubset.ts e0e881ed493b` · `host/env.ts d5584aeba486` · `host/renderEntry.ts d1f555870943` · `host/carrier.ts a456082cebd8` · `errors.ts dbe082c4e623` · `plugin.tsx 0a8042f7bbe6` · `EjsTemplateSettings.tsx f44f08da3bf7`
  - 宿主侧：`src/lib/chatPipeline.ts bbd531f8f8ba` · `src/plugins/promptText.ts 0f539b905e19` · `src/components/ChatInterface.tsx 35d9ae51f4b3` · `plugins/registry.ts 27ef5f17e8ae`
  - 判据脚本：`dev-server/tools/verify-ejs-engine.ts **ab5a1740cde3**` · `verify-ejs-host.ts **d75909a2fbb9**` · `verify-ejs-integration.ts **c6dd52846390**`（t10 终态**之后**又增 A1d/A1e/A1f ⇒ 24 → **27/27**；t10 的 output 终端不可变，故该增量由 **t12 复核任务入卷**）
  - 文档：`README.md` 26,063 B / 311 行（sha256 `3A20FC25…FDB2`，09:18:41）· `errors.ts` 30,665 B / 721 行
- ✅ **上述快照上的 t10 终验（captain 亲跑，全部 exit 0；不采信任何成员回执）**：
  - `npx tsx dev-server/tools/verify-ejs-engine.ts` ⇒ `结论：✅ PASS` + **一致 57/57、差异 0** + 夹具 32/32（`--lodash=subset` 同样 PASS/57/57/0）
  - `npx tsx dev-server/tools/verify-ejs-host.ts` ⇒ **44 passed / 0 failed**（V1 双版本 dump `sha256=dfd40cc8485063a9 / len=223048` + **9 组负向对照**证明判据非恒真）
  - `npx tsx dev-server/tools/verify-ejs-integration.ts` ⇒ **24/24**（含 A3a/A3b/**A3c 停用不留残影**、A1/A1b/A1c、A2/A2b、A5d/A5f/A5c/A5e/A5g/A5h、A4/A4b 双方法模块环、5 组 NC）
  - `npx tsc --noEmit` ⇒ **exit 0（零输出）** —— 全轮唯一的类型门禁
  - 临时产物：`.verify-tmp/` 与 `src/temp/` **均已清空**（captain 复核不存在）
- **坐标事故链（值得留档，含 env-bridge 自陈的三处流程失误）**：`env.ts` 的哈希走过 `9211c810f82a → 777605908996（**取值时未落盘，作废**）→ bcfa83103de6 → d5584aeba486`。env-bridge 主动上报三处失误：① 报告里写错一个作废值；② **把已批准的内容在批复前就落地**（省窗口），时机早于批准；③ **`getScope('message')` 的语义修正未先报批就改**（它判断为"修正自己写错的语义"而非新增范围）。⇒ 定两条硬规矩：**报值必须"改 → 门禁 → 间隔双读 → 上报"**；**任何语义改动（哪怕是修正自己的错）先报批再动**。
  - 同轮第二例：errors-docs 的 README 行号因他人编辑集体过期 ⇒ 改为**零行号**（只写符号名 + "`file:line` 一律视为核对时点的快照、不作判据"）。
  - 同轮第三例：verify-engine 报的 4 个哈希"过期"**不是抄旧串**，而是那几分钟磁盘持续落盘（`carrier` 就变了 4 跳）⇒ **引用坐标只取"同一轮输出"**（captain 曾误判为"抄旧值"，已更正）。
- **文档"反向漂移"两例（均为"实现更准、文档更旧"，靠核上游源码而非"像不像"抓出）**：① `$` 的前提写成"NyaaChat 没有 jQuery"（事实错误，实为"载体 env 无提供方"）；② README §5 / SSOT §6 写"`scope:'cache'` 无对应物 ⇒ 抛错"，而实现早已是**合并视图近似**（上游读缺省本就是 `'cache'` ⇒ 实现更高保真）。两处均已对齐，且第二条的**代价**（`STATE.initialVariables` 缺失 ⇒ 静默回落 `defaults`；无 `_trace_id`/`_modify_id`）已如实登记进 README 与口径 10。
  - **新教训（env-bridge 自曝）**：**错误行为一旦被"可复跑自检"固定下来，就会被后续所有人当真** —— 它上一版自检第 10 条（"显式 `scope:'message'` 不合并"）正在把**错语义钉死**，若不是 carrier 交叉核对上游 `[variables.ts]:475-483`，会一路传到 P6。⇒ 印证两条规矩：**可复跑断言 > 口头结论**，且 **断言本身也要被审**。
- ✅ **该快照上的终验（captain 亲跑，不采信回执）**：`npx tsc --noEmit` **exit 0**；`verify-ejs-engine.ts` 在 `--lodash=both` **与** `--lodash=subset` 下**都 exit 0 + `结论：✅ PASS` + `一致 57/57，差异 0`** + 夹具 32/32；`verify-ejs-host.ts` **34 passed / 0 failed**（host-slot 最终版脚本 `7dcf05e034ad`；V1 双版本 dump `sha256=dfd40cc8485063a9 / len=223048` 逐字节一致 + 3 组负向对照变红；V3 泄漏完整块 0 / 裸 `<%` 0；V4 `trailingSystem=1 / prevRole=user` + 2 组负向对照变红；V6 宿主侧观测落库变量键 **48 = 激活且含 EJS 条目数 48**（EJS 块数 613 ⇒ 口径可区分条目/块）；模块环与叶子纪律通过）。
- 文档侧：`README.md` **25,368 B / 311 行**（sha256 `3915756C…5877`，mtime 09:13:29 —— 含"零行号"与"Node/vendor 环境限制"两项）；`errors.ts` 30,665 B / 721 行（`DBE082C4…B571`，逐字节未动）。
- ⚠️ **锚点冻结纪律（t10 执行）**：① 任何成员在终态后的修改都必须**先报 captain**（见「后交付修正清单」与「冻结状态」）；② t10 **开跑前重算 10 个文件的哈希**作为快照入库、**跑完后再算一次**，前后两次必须一致才算有效运行（verify-engine 已内建该自检并打印它实际验证的哈希）；③ **禁止引用任何成员回执里的哈希**作为冻结依据。

**一条流程盲点（需 t10 兜住）**：各实现的 `verify` 用的是**单文件 eslint**（并行期刻意避开全仓 `tsc`，以免被兄弟模块未落地误伤），而 **eslint 不检查类型**。因此"类型错"不会被成员自己的验收抓到 —— 实测本轮就出现过 `host/carrier.ts:693-694` 与 `host/renderEntry.ts(405,34)`（`Property 'error' does not exist on type 'CompileOutcome'`）两例**进行中的类型错**。⇒ **t10 的 `npx tsc --noEmit` 是唯一的类型门禁，必须全绿才算集成通过**。
