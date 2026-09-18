# EJS 模板引擎 · 技术性说明

> **定位**：本文是 **`ejs-template` 插件（P1 自实现引擎）的实现依据**，对标 `../插件开发_JS-Slash-Runner/MVU技术性说明.md`。
> **读者**：要实现/复核 EJS 引擎与 env 桥的人。
> **上游**：`.ref/ST-Prompt-Template`（v1.17.9，AGPL-3.0）；卡样本 `.ref/EJS/*.json`（5 张，其中 2 张依赖 EJS）
> **配套**：`EJS本地自测方法.md`（不依赖 LLM 的可复跑自测）、`审计报告-EJS模板渲染层.md`（决策）、`开发计划-SSOT.md`（计划与验收）
> **取证时点**：2026-09-18，基准 `master @ 77723ee`

---

## 0. 取证方式与引用规范

### 0.1 材料清单（本文引用的全部文件）

| 代号 | 路径 | 用途 |
|---|---|---|
| `[ejs.js]` | `.ref/ST-Prompt-Template/src/3rdparty/ejs.js`（1793 行） | **引擎本体**（vendored，CJS 风格，webpack 打包） |
| `[ejs.ts]` | `.ref/ST-Prompt-Template/src/function/ejs.ts`（664 行） | 扩展侧的引擎适配（opts / 缓存 / 沙箱 / env 组装） |
| `[handler.ts]` | `.ref/ST-Prompt-Template/src/modules/handler.ts`（1005 行） | **唯一提示词拦截器**（事件 → 逐条 EJS） |
| `[ui.ts]` | `.ref/ST-Prompt-Template/src/modules/ui.ts`（191 行） | 设置项（默认值/开关） |
| `[卡]` | `.ref/EJS/{实力至上主义教室(维多利亚版),魔法少女V3.2.6}.json` | 依赖 EJS 的真实样本 |
| `[参照卡]` | `.ref/EJS/{长安v2.24,人妻公寓,逐梦演艺圈4.3}.json` | 0 依赖样本（用于边界对照） |

### 0.2 引用规范

- 上游侧一律写 `[文件]:行号`（如 `[ejs.js]:859`）；NyaaChat 侧写 `src/…:行号`。
- 计数一律用 `(Get-Content).Count`（**不用** `Measure-Object -Line`，它会漏算空行）。
- 未跟踪路径（`plugins/**`、`src/plugins/**`、`.docs/plugin-system/**`）的存在性/残留判定必须 **`git grep` ∪ 文件系统扫描双方法交叉**。
- **区分"实测"与"推断"**：★ 标记为实测，☆ 标记为推断/未确认（详见 §7）。

### 0.3 角色卡数据的解码方式（可复现）

ST PNG 卡的 JSON 藏在 `tEXt` 块（keyword = `chara` / `ccv3`），base64 + JSON：

```python
import base64, json, struct
def text_chunks(p):
    d = open(p, "rb").read(); off, out = 8, []
    while off < len(d):
        (ln,) = struct.unpack(">I", d[off:off+4])
        typ = d[off+4:off+8].decode("latin1")
        if typ == "tEXt":
            kw, _, txt = d[off+8:off+8+ln].partition(b"\x00")
            out.append((kw.decode("latin1"), json.loads(base64.b64decode(txt))))
        off += 12 + ln
        if typ == "IEND": break
    return out
```

★ 实测：本轮 5 张卡的两块（`chara` / `ccv3`）内容**逐字节一致**（SHA256 相同）⇒ 一份 JSON 足够。

**EJS 的唯一承载位置**：`data.character_book.entries[*].content`（世界书条目**正文**）。
★ 实测：两张卡的**卡片顶层字段**（`description`/`first_mes`/`personality`/`scenario`/`system_prompt`/`post_history_instructions`/`mes_example`/`alternate_greetings`/`extensions.depth_prompt.prompt`）**均无 EJS**。

---

## 1. EJS 是什么，以及在 ST 里怎么跑起来

### 1.1 一句话定义

**EJS = Embedded JavaScript（嵌入式 JavaScript 模板）**，一个把 `<% %>` 之间的 JS 编译成函数、与字面量文本拼接成输出的通用模板引擎（npm 包 `ejs`）。ST-Prompt-Template 把它的产物**当作提示词文本**：对 ST 组装好的每条 prompt 消息逐条渲染，再改写回消息内容。

### 1.2 完整数据流（文字版流程）

```
角色卡（PNG → JSON）
  └─ data.character_book.entries[*].content         ← EJS 唯一承载位置
        │
        ▼  ST 载入角色卡 → 世界书条目进入角色设定
ST 组装 prompt（宏 / 世界书 / 预设 / 历史）
        │
        ▼  事件：GENERATION_AFTER_COMMANDS / WORLDINFO_ENTRIES_LOADED
   [handler.ts]:976-982  生成前预处理（过滤器安装 / 世界书条目增删 / [Preprocessing]）
        │
        ▼  事件：CHAT_COMPLETION_SETTINGS_READY（chat-completion 路径）
   [handler.ts]:201-210  handleChatCompletionReady
        │     data.messages = await processGenerateAfter(data.messages, type)
        ▼
   [handler.ts]:212-407  processGenerateAfter：**逐条遍历 chat 数组**
        │     对每条 message.content（纯文本）或 content[]（多模态）：
        │       [handler.ts]:264-265
        │       prompt = await evalTemplateHandler(
        │                  applyRegex(env, message.content, { generate: true, role }),
        │                  env, `message #${idx+1}(${role})`, { options: { filename, cache }, sandbox })
        │       [handler.ts]:289  message.content = beforeMessage + prompt + afterMessage   ← **追加**
        ▼
   [ejs.ts]:106-171  evalTemplate：不含定界符 ⇒ 原样返回；否则 ejs.compile → func.call(data, …)
        ▼
   [ejs.js]:572-727  compile：generateSource → 拼接包裹 → new Function / AsyncFunction
        ▼
   渲染结果文本 → 写回 data.messages → 发给 LLM
```

★ 实测要点（`[handler.ts]`）：
- `main_api === 'openai'` 时**跳过** `GENERATE_AFTER_DATA`，改走 `CHAT_COMPLETION_SETTINGS_READY`（`:183-186`、`:201-210`）。两张目标卡都推荐 OpenAI 兼容路径（Gemini/DeepSeek）⇒ **走后者**。
- `[handler.ts]:289` 是**追加**（`before + prompt + after`），不是替换。

### 1.3 触发时机（事件钩子表）

| 事件 | 注册 | 回调 | 对 EJS 的意义 |
|---|---|---|---|
| `CHAT_COMPLETION_SETTINGS_READY` | `on`（`[handler.ts]:980`） | `handleChatCompletionReady` | ★ **主路径**：整体替换 `data.messages` |
| `GENERATE_AFTER_DATA` | `on`（`:979`） | `handleGenerateAfter` | text-completion 路径（openai 时跳过） |
| `WORLDINFO_ENTRIES_LOADED` | `on`（`:982`） | `handleWorldInfoLoaded` | 世界书条目**增删/预处理**（`[Preprocessing]` 走这里） |
| `CHARACTER_MESSAGE_RENDERED` | `makeFirst`（`:986`） | `handleMessageRender` | **渲染期**EJS（本插件按 NG 不做） |
| `MESSAGE_UPDATED`/`SWIPED`/`USER_MESSAGE_RENDERED` | `on`（`:981`） | `handleMessageRender` | 同上 |

> ⚠️ ST 的事件总线有**优先级**（`makeFirst` / `makeLast`）；NyaaChat 的 10 个插件事件**无优先级、无返回值**（`src/plugins/types.ts:78-98`）。

### 1.4 「EJS 在渲染链中的位置」—— D16-R 的依据

★ 实测（`[handler.ts]:264-265`）：

```ts
const prompt = await evalTemplateHandler(
    applyRegex(env, message.content, { generate: true, role: message.role }),   // ← 正则先
    env, `message #${idx + 1}(${message.role})`, { … });
```

⇒ 上游顺序是 **`substituteParams`（宏）→ `applyRegex`（正则）→ EJS**，即 **EJS 最后**。
（宏替换在更早处：`env` 的构造成分里已跑过 `substituteParams`；`[ejs.ts]:344,363,381,431,440` 亦在 `getwi`/`getchr` 等内部再跑。）

**对 NyaaChat 的含义**：`src/lib/chatPipeline.ts:832-837` 的 `renderRule` 顺序是 **占位符 → 变量宏 → 正则**。若要让 EJS 也在最后，**异步 pre-pass 必须先完整复现这条前缀链**，再把结果交给 EJS —— 这正是 SSOT 的 **D16-R 选项 A**（推荐）。

---

## 2. 引擎构成与编译包裹

### 2.1 三份文件的职责

| 文件 | 职责 | 本插件是否移植 |
|---|---|---|
| `[ejs.js]` | 引擎本体：扫描 / 源生成 / 编译 | ✅ **语义全量对齐**（但换执行方式，见 §3.8） |
| `[ejs.ts]` | opts 默认值、缓存键、沙箱、env 组装 | 🟡 **只取 opts 与短路逻辑**；env 组装按 §4 重写 |
| `[handler.ts]` | 事件钩子与逐条改写 | ❌ 不移植（NyaaChat 侧改为"条目文本渲染缝"，见 SSOT §2） |

### 2.2 上游调用 opts（逐字）

★ `[ejs.ts]:127-133`：

```ts
_.defaults(opts.options, {
    async: true,
    outputFunctionName: 'print',
    _with: true,
    localsName: 'locals',
    client: true,
});
```

★ 短路（`[ejs.ts]:115-119`）：内容里不含 `${openDelimiter ?? '<'}${delimiter ?? '%'}`（即 `<%`）⇒ **原样返回，不求值**。

★ 缓存（`[ejs.ts]:143-148`）：`opts.options.cache` 为真时，`filename += '/' + hashString(content, 0xfacefeed)` 作为缓存键。

★ 沙箱（`[ejs.ts]:156-167`）：`settings.sandbox` 时走 `FunctionSandbox.run(func, [...], {}, data)`；**默认关**（`[ui.ts]:25` `sandbox: false`）。

### 2.3 编译包裹结构（三层）

★ `[ejs.js]:587-624` 生成的 `this.source` 结构（**这是自实现必须逐字对齐的骨架**）：

```js
// ── 第 1 层：EJS 固定前导（prepended）────────────────────────────
  var __output = "";
  function __append(...args) { args.filter(x => x !== undefined && x !== null).forEach(s => __output += s) }
  const print = __append;              // ← outputFunctionName = 'print'
  with (locals || {})                  // ← _with: true、localsName = 'locals'
 {                                     // ← 块开始
// ── 第 2 层：generateSource() 的产物（逐 token 生成，见 §3.3）────
    ; __append("字面量…")
    ; <EVAL 代码>
    ; __append(escapeFn(<ESCAPED 表达式>))
    ; __append(<RAW 表达式>)
// ── 第 3 层：固定后导（appended）────────────────────────────────
  }
  return __output;                     // ← :623
```

★ 再外层（`compileDebug` **默认 true**，`:521` `opts.compileDebug !== false`；`:627-639`）：

```js
var __line = 1
  , __lines = "<模板原文 JSON>"
  , __filename = undefined;
try {
  <上面整段>
} catch (e) {
  rethrow(e, __lines, __filename, __line, escapeFn);
}
```

★ client 模式再前置两行（`:641-646`）——**自带依赖、无需外部提供**：

```js
escapeFn = escapeFn || <escapeXML.toString()>;
rethrow  = rethrow  || <rethrow.toString()>;
```

### 2.4 函数构造与参数表

★ `[ejs.js]:660-678`：

| opts | 构造器 | 说明 |
|---|---|---|
| `async: true` | `(new Function('return (async function(){}).constructor;'))()` → `AsyncFunction` | ★ 这是 **`[ejs.js]` 里第二处 `new Function`**（`:664`） |
| 否则 | `Function` | — |

★ 参数表逐字：`locals, escapeFn, include, rethrow`（`:678`）。

★ 返回（`:703-713`）：`client: true` ⇒ **返回裸 `fn`**（不再包 `function anonymous(data)`，也不注入 `include`）。
⇒ **`include` 在 client 模式下不存在**：模板若调 `include(...)` 会 `ReferenceError`。★ 5 卡实测 `include(` **0 命中** ⇒ 安全。

★ **两处 `new Function` 的位置**（决定 CSP 路线）：

| 位置 | 时机 | 影响 |
|---|---|---|
| `[ejs.js]:110` `exports.promiseImpl = (new Function('return this;'))().Promise;` | **模块加载期即执行** | ⚠️ 只要 `import` 整份 `[ejs.js]`，在无 `'unsafe-eval'` 的 CSP 下**立刻报错** |
| `[ejs.js]:664` | 运行期（`async` 编译时） | 自实现若直接产出 `async function` 源码注入，**不需要它** |

★ `_VERSION_STRING = require('../package.json').version`（`:55`）⇒ 打包时解析为**扩展自身版本**（`1.17`），**不是 ejs 版本**。

---

## 3. EJS 语法与语义规格（自实现的实现依据）

### 3.1 定界符正则与匹配优先级

★ `[ejs.js]:61`：

```
_REGEX_STRING = (<%%|%%>|<%=|<%-|<%_|<%#|<%|%>|-%>|_%>)
```

★ 默认定界符（`:56-58`）：`openDelimiter='<'`、`closeDelimiter='>'`、`delimiter='%'`。
★ `createRegex()`（`:561-570`）把 `%`→delimiter、`<`→open、`>`→close 后编译。
**注意顺序即优先级**：`<%%` 必须排在 `<%` 前、`%%>`/`-%>`/`_%>` 必须排在 `%>` 前，否则最长匹配失效。

### 3.2 模式判定表

★ `[ejs.js]:859-890`（`scanLine` 的 `switch`）：

| token | 模式 | 备注 |
|---|---|---|
| `<%` 或 `<%_` | `EVAL` | `<%_` 与 `<%` **同一模式** |
| `<%=` | `ESCAPED` | 走 `escapeFn` |
| `<%-` | `RAW` | 直出 |
| `<%#` | `COMMENT` | 不产出任何代码 |
| `<%%` | `LITERAL` | 输出 `<%`（`:875`） |
| `%%>` | `LITERAL` | 输出 `%>`（`:879`） |
| `%>` / `-%>` / `_%>` | 关闭 | `:881-890`；`truncate = token 以 '-' 或 '_' 开头` |
| 其它（非标签文本） | 字面量 | 走 `_addOutput` |

### 3.3 源生成规则（逐模式）

★ `[ejs.js]:903-928`：

| 模式 | 生成 | 说明 |
|---|---|---|
| `EVAL` | `    ; <code>` | 原样嵌入 |
| `ESCAPED` | `    ; __append(escapeFn(<stripSemi(code)>))` | |
| `RAW` | `    ; __append(<stripSemi(code)>)` | |
| `COMMENT` | （无） | |
| `LITERAL` | `    ; __append("<转义后的字面量>")` | |
| 字面量文本 | `_addOutput(line)` | 见 §3.4 |

★ `stripSemi`（`:365`）：`str.replace(/;(\s*$)/, '$1')` —— 去掉**末尾**分号（防 `__append(expr;)` 语法错）。
★ EVAL/ESCAPED/RAW 三者：若内容里 `//` 出现在最后一个换行之后 ⇒ **自动补一个 `\n`**（`:899-901`，防行注释吞掉后续生成代码）。
★ `compileDebug` 且该 token 跨行时，追加 `; __line = <currentLine>`（`:931-934`）。

### 3.4 trim / slurp 精确规则

★ 预处理（`[ejs.js]:739-740`）—— **先做，且是全局替换**：

```js
this.templateText = this.templateText
    .replace(/[ \t]*<%_/gm, '<%_')      // 吃掉 `<%_` 之前的行内空白
    .replace(/_%>[ \t]*/gm, '_%>');     // 吃掉 `_%>` 之后的行内空白
```

★ 收尾 trim（`[ejs.js]:823-832`，在 `_addOutput` 内）：

```js
if (this.truncate) {                       // 上一个闭合标签是 -%> 或 _%>
    line = line.replace(/^(?:\r\n|\r|\n)/, '');   // 只吃掉**紧跟的一个**换行
    this.truncate = false;
}
if (!line) return line;                    // 空串不产出语句
```

★ `rmWhitespace`（`:735-738`）：`[\r\n]+`→`\n`、每行首尾空白剥除。**上游调用 opts 未开**（`[ejs.ts]:127-133`）⇒ 默认关。
★ `-%>` 与 `_%>` 的差异：**仅**语法写法（`:881-883` 同一分支），行为一致（均置 `truncate`）。

### 3.5 字面量转义

★ `<%%` ⇒ 输出 `<%`；`%%>` ⇒ 输出 `%>`（`:873-880`，经 `replace` 还原）。
★ 输出语句里的字面量转义顺序（`:837-846`）：`\`→`\\`、`\n`→`\\n`、`\r`→`\\r`、`"`→`\"`。

### 3.6 escapeXML 字符集

★ `[ejs.js]:1038-1045`：

```js
_ENCODE_HTML_RULES = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&#34;', "'":'&#39;' };
_MATCH_HTML = /[&<>'"]/g;
```

⇒ `<%=` 只转义这 **5 个字符**（注意 `"` 是 `&#34;`、`'` 是 `&#39;`，不是 `&quot;`/`&apos;`）。
★ 入参为 `undefined`/`null` ⇒ 返回空串。

### 3.7 输出与 undefined 语义

★ `__append`（`:591`）：`args.filter(x => x !== undefined && x !== null).forEach(s => __output += s)`
⇒ **`undefined` / `null` 被静默丢弃**（不输出 `"undefined"`）。★ 这是行为要点：`<%- someUndefined %>` 不产出文本。

### 3.8 ⚠️ 与 npm 原版 EJS 的差异（**自实现必须以本份为准**）

★ 实测：本份 `[ejs.js]` 与 npm 原版 EJS 的**已知差异**：

| # | 本份的实现 | 为何重要 |
|---|---|---|
| 1 | `generateSource` 开头做 `[ \t]*<%_` / `_%>[ \t]*` 预处理（`:739-740`） | 决定 `<%_` 的**前导空白**处理；npm 原版在 `scanLine`/`rmWhitespace` 路径处理 |
| 2 | **嵌套标签平衡**（`:743-793`，`nestingLevel` / `contentBuffer`）：把标签内的标签合并为单一 token 的内容 | 影响"模板里出现 `<%` 字样"的解析；npm 原版无此逻辑 |
| 3 | `__append(...args)` 接收**任意参数**并过滤 `undefined/null`（`:591`） | 决定 `undefined` 的输出语义 |
| 4 | `_VERSION_STRING = require('../package.json').version`（`:55`） | ⚠️ **实测修正**：browserify 内联的是 **ejs 自己的** package.json ⇒ `require(ejs.js).VERSION` 实测 = **`"3.1.9"`** ⇒ **可以**用它判断 ejs 版本（与本文初稿的推断相反） |
| 5 | 打包形式是 **browserify UMD bundle**（`:1` 的 UMD 头 + 内置模块表 `{1:[fn,{…}], …}`） | ⇒ **Node 里可直接 `require`，无需任何 shim**（实测）；但模块 1 顶层即执行 `:110` 的 `new Function` ⇒ 浏览器 CSP 下仍**不可整包引入** |

★ **实测补充（P0 探针，2026-09-18）**：`require('.ref/ST-Prompt-Template/src/3rdparty/ejs.js')` 在 Node v24 下**直接成功**，导出 `VERSION="3.1.9"` / `compile` / `render` / `Template` / `escapeXML` / `cache` / `clearCache`；
且 `ejs.compile('A<%= v %>B<% if (v > 1) { %> big <% } %>C', {async:true, outputFunctionName:'print', _with:true, localsName:'locals', client:true})` 渲染得 `"A2B big C"`（裸变量 `v` 生效 ⇒ **`with` 在该路径下可用**）。
**唯一注意**：`new Template(text, opts)` **不会**生成源码（`this.source` 为 `''`），必须**手动调** `t.generateSource()`。

⇒ **结论（D5 的直接依据）**：**不能**用 npm `ejs` 当语义基准；自实现必须以**这份改造成品**为准，并用 §附录 B 的黄金基准逐块比对。
☆ **未确认**：上述 1/2 是否确为"上游叠加"（无法在本地对照 npm 原版源码）；但"以本份为准"这一结论**不依赖**该判断。

---

## 4. 模板环境（env）全清单

### 4.1 ★ 5 卡实测：真正用到的只有 **7 个**符号

| 符号 | 次数 | 语义 | 出处（`[ejs.ts]`） |
|---|---|---|---|
| `getvar(key, {defaults, scope})` | 89（31+58） | 读变量；**点路径** + `defaults` 兜底 | `:282` |
| `getMessageVar(key, opts)` | 14 | = `scope:'message'` | `:285` |
| `setvar(key, value)` | 8 | 写变量 | `:278` |
| `setMessageVar(key, value)` | 1 | = `scope:'message'` 写 | `:281` |
| `getwi(name)` | 1 | **异步**读世界书条目 | `:269-270` |
| **`YAML`**（宿主全局） | **5** | `YAML.stringify(x, { blockQuote: 'literal' })` —— ⚠️ **不是扩展注入的 env**，而是**页面全局**（酒馆助手生态提供） | ★ **P0 实测发现**，见 §4.5 |
| lodash `_` | 9 个函数 | 见 §4.2 | `:30-60` 的 `SHARE_CONTEXT` |

★ 语法面附带实测（决定实现范围）：`<%_` 705、`_%>` 699、`<%=` 209、`<%-` 75、`<%#` 2、顶层 `return` 23、`await` 1；
`-%>` **0**、`include(` **0**、`<%%`/`%%>` **0**。
★ **渲染单位口径**：P0 实测 —— 5 卡共 **424 个世界书条目**，其中 **57 个含 EJS**；这 57 个（而非 1002 个块）才是黄金基准的**渲染单位**（块数 1002 用于语法面统计）。

### 4.2 lodash 精确清单（9 个）

| 函数 | 次数 | 函数 | 次数 |
|---|---|---|---|
| `_.get` | 212 | `_.isObject` | 1 |
| `_.random` | 38 | `_.set` | 1 |
| `_.has` | 3 | `_.sample` | 1 |
| `_.omit` | 1 | `_.sampleSize` | 1 |
| `_.cloneDeep` | 1 | | |

★ **非确定性警告**：`_.random` ×38 + `_.sample` + `_.sampleSize` ⇒ **EJS 输出本身是随机的**（如"BOSS 强度 = 45 + 已击败数×6 + `_.random(-5,10)`"）⇒ 黄金基准与验收**必须注入可控随机源**（SSOT D15）。

### 4.3 上游提供的其余符号（本阶段**不实现**，调用即抛错）

按 `[ejs.ts]:30-60` 与 `:215-309` 的 `prepareContext`，上游共注入约 60 个键。本阶段**仅**实现 §4.1 的 6 个；其余（`getchr`/`getchar`/`getprp`/`getpreset`/`getqr`/`activewi`/`execute`/`injectPrompt`/`getPromptsInjected`/`define`/`evalTemplate`/`findVariables`/`activateRegex`/`getChatMessage(s)`/`matchChatMessages`/`applyVarYamlAnnotate`/`setVariableSchema`/`jsonPatch`/`parseJSON`/`faker`/`$`/`z`/`toastr`/`SillyTavern`…）

⇒ 处置：**显式抛错**（照抄 JSR 的 D9 纪律），错误文案含符号名；**绝不**静默返回 `undefined`（那会让模板产出静默错误文本）。

### 4.4 两条逃生门（**必须删除或重造**）

★ `[ejs.ts]:220-223`：

```ts
execute: async (cmd) => (await executeSlashCommandsWithOptions(cmd)).pipe,   // → 任意 STscript
get SillyTavern() { return SillyTavern.getContext(); }                        // → ST 全量 API
```

⇒ NyaaChat 无 STscript 引擎、无 `SillyTavern` 全局 ⇒ **不提供**（调用即抛错）。★ 5 卡 0 命中。
### 4.5 ★ `YAML`：一个不属于扩展 env 的宿主全局（P0 实测发现）

**事实**：`实力至上主义教室` 的 `book[9]「变量列表」` 与 `book[16]「日历内容」` 里逐字写着：

```ejs
<%= YAML.stringify(cleanData, { blockQuote: 'literal' }) _%>
```

**它在哪来**：**不在**上游 `prepareContext` 的注入清单里（`[ejs.ts]:30-60` 的 `SHARE_CONTEXT` 只有 `_`/`$`/`z`/`toastr`/`console` 与约 60 个数据访问函数）⇒ `YAML` 是**页面全局**，由**酒馆助手生态**在主页面暴露。

**对 NyaaChat 的含义**：
- NyaaChat 的 JSR 把 `YAML` 挂在 **iframe 的 window**（`src/plugins/scriptHostImpl.ts:230` `globalName: "YAML"`），**主页面没有** ⇒ EJS 插件**必须自己把它放进 env**。
- 可用同一份自托管产物：`public/vendor/script-host/yaml/yaml.esm.js`（eemeli/yaml，104,951 B）。★ P0 已用它验证：加进桩 env 后 `failed` 从 2 → 0。

**这也解释了"为什么两张卡同时要求酒馆助手 + 提示词模板"**：EJS 模板**借用了酒馆助手提供的宿主全局**——两者是生态耦合，不是功能重叠。

---


---

## 5. 它调用的宿主能力 → NyaaChat 映射

| 上游依赖（`[ejs.ts]`） | 用途 | NyaaChat 落点 | 保真度 |
|---|---|---|---|
| `chat[i].variables[0]` | `getvar` 数据源 | `Message.variables[0]`（同形） | ✅ |
| `chat_metadata.variables` | chat 作用域 | `ChatSession.variables` | ✅ |
| `extension_settings.variables.global` | global 作用域 | IndexedDB `nyaachat_vars_global` | ✅ |
| `loadWorldInfo(name)` + `world_names` | `getwi` 数据源（**任意世界书，含全局书**） | `getScriptHostApi().lorebook.getEntries()`（**仅当前角色**，无全局书） | ⚠️ **降级**（G5/K5） |
| `substituteParams` | 宏替换 | `chatPipeline` 的占位符 + 变量宏 | 🟡 顺序见 §1.4 |
| `getRegexedString` / `regex_placement` | 正则 | `src/lib/regex/engine.ts`（**四位置语义已完整实现**） | ✅ |
| `saveChatConditional` | 变量落盘 | 变量层 `writeScopeData` → adapter 提交 | ✅ |
| `name1`/`name2`/`this_chid`/`characters` | 身份 | `prepass ctx`（**展示口径**）+ `ScriptHostCharacterApi` | 🟡 无 group 概念 |
| `executeSlashCommandsWithOptions` | 逃生门 | ❌ 不提供 | — |
| `SillyTavern.getContext()` | 逃生门 | ❌ 不提供 | — |

---

## 6. NyaaChat 侧：必须复刻 / 现有基础 / 降级

### 6.1 必须复刻清单（M1–M12，P1 的验收对象）

| # | 必须复刻的行为 | 依据 |
|---|---|---|
| **M1** | 定界符正则与**匹配优先级**（最长优先） | `[ejs.js]:61` |
| **M2** | 模式判定表（`<%`/`<%_` = EVAL、`<%=`、`<%-`、`<%#`、`<%%`/`%%>` = LITERAL） | `:859-890` |
| **M3** | 源生成（EVAL/ESCAPED/RAW/COMMENT/LITERAL 逐模式） | `:903-928` |
| **M4** | `stripSemi`（去末尾分号）+ `//` 补换行 | `:365`、`:899-901` |
| **M5** | trim/slurp：`[ \t]*<%_` 与 `_%>[ \t]*` 预处理 + 只吃**一个**换行 | `:739-740`、`:823-832` |
| **M6** | 字面量转义顺序：`\` `\n` `\r` `"` | `:837-846` |
| **M7** | 包裹三层：`var __output` / `__append`（过滤 `undefined`/`null`）/ `const print=__append` / `with (locals\|\|{})` / `return __output` | `:589-624` |
| **M8** | **顶层 `return` 可用**（模板体即函数体） | ★ 23 次 |
| **M9** | **`await` 可用**（产物为 `async function`） | ★ 1 次 |
| **M10** | `escapeXML` 五字符（`&#34;`/`&#39;`） | `:1038-1045` |
| **M11** | 不含 `<%` 的文本**快速短路**（不求值） | `[ejs.ts]:115-119` |
| **M12** | 错误信息带上下文（`rethrow` 等效：±3 行 + ` >> ` 标记） | `:341-363` |

### 6.2 现有基础（可直接复用，**无需重造**）

| 能力 | 位置 |
|---|---|
| 变量三层读写（含**路径**读写） | `src/lib/variables/api.ts:34,67,102,114` |
| `messageId: 'latest'` 语义（**已对齐酒馆助手**） | `src/lib/variables/types.ts:14-21` |
| 世界书读取（含 `enabled:false` 条目） | `src/plugins/scriptHost.ts:91-97` |
| 正则引擎（四位置语义） | `src/lib/regex/engine.ts` |
| 插件日志/错误可见 | `src/plugins/pluginLog.ts:252,262,311,330,345` |
| 错误安全网（宿主已全局安装） | `pluginLog.ts:431`、`App.tsx:989` |

### 6.3 降级与保真度损失（**必须如实登记**）

| # | 损失 | 说明 |
|---|---|---|
| 1 | `getwi` 只能读**当前角色**的世界书 | 无全局书（`scriptHost.ts:92`）；ST 可读任意世界书名 |
| 2 | `scope: 'cache'` / `'initial'` 无对应物 | NyaaChat 只有 `message`/`chat`/`global` |
| 3 | `flags: 'nx'/'xx'/'nxs'` 无对应物 | 写变量的条件语义需自实现或抛错 |
| 4 | 无 group 概念 | 群聊相关上下文（`groups`/`groupId`）不存在 |
| 5 | 渲染期 EJS（`[RENDER:*]` / 楼层渲染）**不做** | 卡片顶层/消息正文的 EJS 不渲染（★ 实测两张卡都未使用） |

---

## 7. 不确定 / 未确认项（U1–U6，如实标注）

| # | 未确认项 | 影响 |
|---|---|---|
| **U1** | `[ejs.js]:739-740`（trim 预处理）与 `:743-793`（嵌套平衡）**是否确为上游叠加**（本地无 npm 原版可对照） | 不影响结论：自实现一律**以本份为准** |
| **U2** | `_.sample` / `_.sampleSize` 的具体调用形态（只统计了次数） | 实现时以黄金基准为准 |
| **U3** | `_.random` 的 `floating` 参数形态（1/2/3 参语义） | 同上 |
| **U4** | npm `ejs` 新版本是否已去掉 `[ejs.js]:110` 的模块加载期 `new Function` | **仅当选择方案 B（复用 npm ejs）时才需验证**；方案 A 不需要 |
| **U5** | 真机渲染耗时（408 / 594 块/轮） | P2 实测 |
| **U6** | 更广卡池是否会出现本清单外的语法/符号 | 已定 NG 策略：**未实现即显式抛错**，不做假想补全 |

---

## 附录 A：关键结论速查（给实现者的 12 条）

1. EJS **只出现在世界书条目正文**（`character_book.entries[*].content`），卡片顶层字段没有。
2. 上游只在 **`CHAT_COMPLETION_SETTINGS_READY`**(chat-completion) 与 **`GENERATE_AFTER_DATA`**(text-completion) 上做提示词侧渲染；openai 路径只走前者。
3. 上游对每条消息的顺序是 **宏 → 正则 → EJS**（EJS 最后）——D16-R 的依据。
4. 渲染是**追加**到消息内容（`before + prompt + after`），不是替换。
5. **`[ejs.js]` 不能整包 import**：`:110` 在模块加载期就 `new Function` ⇒ CSP 报错。
6. 只需取 **`generateSource()`**（纯字符串，不碰 `new Function`）；⚠️ **必须手动调**（构造函数不生成源码）；执行靠**内联 `<script>` 注入**（普通脚本，因 `with` 需非严格模式）。
7. 包裹骨架必须逐字对齐：`__output` / `__append`（过滤 `undefined`/`null`）/ `const print` / `with (locals||{})` / `return __output`。
8. `escapeXML` 是 **5 字符**且 `"`→`&#34;`、`'`→`&#39;`。
9. trim 规则：**先**全局吃掉 `<%_` 前与 `_%>` 后的**行内空白**，**再**在下一个字面量处只吃**一个**换行。
10. `<%%` / `%%>` 是字面量转义（本样本 0 命中，但建议实现）。
11. env 只需 **7 个符号（含宿主全局 `YAML`）+ lodash 9 函数**；其余一律**显式抛错**。
12. EJS 输出**非确定**（`_.random`/`_.sample`）⇒ 比对与验收必须注入可控随机源。

---

## 附录 B：取证命令（可复现）

```powershell
cd H:\GitHub\NyaaChat
$env:PYTHONIOENCODING='utf-8'

# ① 语法面与 lodash 清单（5 卡世界书正文全量）
#    （脚本内容见 EJS本地自测方法.md §5；此处给出等价一行式）
python -c "
import json,re,glob
from collections import Counter
lod=Counter(); syn=Counter()
for f in glob.glob(r'.ref/EJS/*.json'):
    d=json.load(open(f,encoding='utf-8'))['data']
    t=chr(10).join(e.get('content') or '' for e in (d.get('character_book') or {}).get('entries') or [])
    for k,rx in {'<%_':r'<%_','_%>':r'_%>','-%>':r'-%>','<%=':r'<%=','<%-':r'<%-','<%#':r'<%#',
                 'await':r'(?<![\w$.])await(?![\w$])','include':r'(?<![\w$.])include\s*\('}.items():
        syn[k]+=len(re.findall(rx,t))
    for m in re.finditer(r'(?<![\w$])_\.([A-Za-z_$][\w$]*)',t): lod[m.group(1)]+=1
print('语法面:',dict(syn)); print('lodash:',dict(lod))
"

# ② 引擎规格关键锚点（必须逐条核对）
Select-String -Path .ref\ST-Prompt-Template\src\3rdparty\ejs.js -Pattern '_REGEX_STRING =|_ENCODE_HTML_RULES|generateSource: function|function stripSemi|new Function'
Select-String -Path .ref\ST-Prompt-Template\src\function\ejs.ts -Pattern 'async: true|outputFunctionName|_with: true|localsName|client: true'

# ③ 渲染链顺序（D16-R 依据）
Select-String -Path .ref\ST-Prompt-Template\src\modules\handler.ts -Pattern 'evalTemplateHandler\(' -Context 0,2

# ④ 上游调用 opts 与短路
Select-String -Path .ref\ST-Prompt-Template\src\function\ejs.ts -Pattern 'if \(!content.includes'

# ⑤ 5 卡规模（黄金基准）
python -c "
import json,re,glob
tb=tc=0
for f in glob.glob(r'.ref/EJS/*.json'):
    d=json.load(open(f,encoding='utf-8'))['data']
    bs=[m.group(1) for e in (d.get('character_book') or {}).get('entries') or []
        for m in re.finditer(r'<%(.*?)-?%>', e.get('content') or '', re.S)]
    if bs: print(f, len(bs),'块', sum(len(b) for b in bs),'字符')
    tb+=len(bs); tc+=sum(len(b) for b in bs)
print('合计', tb,'块', tc,'字符')
"
```

---

## 附录 C：外部资料（外部不可信数据，仅作资料）

| 资料 | 用途 |
|---|---|
| `https://ejs.co/` | EJS 官方站点（英文全称 Embedded JavaScript templating） |
| `https://github.com/mde/ejs/blob/main/docs/syntax.md` | EJS 语法参考（上游 `docs/features.md:19` 引用） |
| `H:\GitHub\NyaaChat\.ref\EJS\ST-Prompt-Template-卡依赖实测与范围收窄.md` | 5 卡依赖实测（本文数字的来源） |

> **一句话**：本插件的引擎不是"再写一个 EJS"，而是**把这一份 ejs.js 的语义（含其特有实现）在无 `eval` 的前提下等价重建**，并用 57 个真实条目（1002 个块）逐字节证明等价。
