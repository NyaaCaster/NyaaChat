# NyaaChat ST 扩展移植规范（V1）

> **面向对象**：要把一个 SillyTavern 扩展搬进 NyaaChat 的人。
> **上游文档**：`.docs/plugin-system/开发计划-SSOT.md`（SSOT，尤其 §2.6/§2.7/§10.2）、`.docs/plugin-system/审计报告.md`（D1–D6、§2.3）、`.docs/plugin-system/插件框架规范.md`（框架契约、§4 装饰、§5 后端、§6 新增插件清单）、`.docs/plugin-system/验证报告-P1-P5.md`（R1–R7 残留风险）。
> **首个也是本文唯一完整范例**：`st-Quote-TTS` → `plugins/quote-tts/`。
> **勘测时点**：`2026-09-15T21:40+08:00`，基准 `master @ 7bbb43b` + 未提交工作树。
> **本文不改任何代码。**

---

## 0. 阅读约定

### 0.1 计量口径（每处引用都带 lines + bytes + mtime）

| 量 | 取法 | 说明 |
|---|---|---|
| 行数 | `(Get-Content <file>).Count` | **真实行数，含空行**；与 read 工具的 `total lines` 一致 |
| 字节 | `(Get-Item <file>).Length` | 原始字节 |
| mtime | `(Get-Item <file>).LastWriteTime` | 写作时点的最后修改时间 |

> ⚠️ 不要用 `Get-Content <file> \| Measure-Object -Line`：它会**跳过空行**，系统性少算。实例：`src/plugins/index.ts` 真实 **50 行** / Measure-Object **42 行**（8 行空行）；`src/plugins/types.ts` 真实 **111** / Measure-Object **100**。

### 0.2 ⚠️ 路径必须**限定根**：两份 ST 参考拷贝并存

工作空间里 `st-Quote-TTS` 的源码有**两份内容完全相同**的拷贝。**只写 `.ref/st-Quote-TTS/...` 是错的**（相对路径在不同 cwd 下指向不同文件，本阶段已因此产生过一次争议，见《验证报告-P1-P5》R7）——引用时必须写出**根**：

| 根 | 完整路径 | index.js 实测 |
|---|---|---|
| **项目根**（NyaaChat 仓内） | `H:\GitHub\NyaaChat\.ref\st-Quote-TTS\index.js` | 249 行 / **9357 B** / SHA256 `CC650C5E23FF…` / mtime `2026-06-14T05:33:29` |
| **工作空间根**（`H:\GitHub` 下的共享参考区） | `H:\GitHub\.ref\SillyTavern\st-Quote-TTS\index.js` | 249 行 / **9357 B** / SHA256 `CC650C5E23FF…` / mtime `2026-06-27T16:37:27` |

- 两份 **SHA256 相同**（`CC650C5E23FF7473B4EB0896228AB98F1E0B4EAFCD3D3E5D988990ED8AFDAC69`）⇒ 内容逐字节一致，引用任一份都可以，**但必须写清是哪一份**。
- **L107 的追加语义两份一致**：`` return `${match}<span class="quote-tts-btn interactable" …>🔊</span>`; ``（正文 `match` 保留 + 按钮追加）。
- 另一常见写法 `H:\GitHub\.ref\st-Quote-TTS\`（工作空间根下**不带** `SillyTavern/`）**不存在**，不要引用。
- 下文凡引用 ST 源码，一律写「项目根 `NyaaChat/.ref/st-Quote-TTS/`」或「工作空间根 `H:\GitHub\.ref\SillyTavern\st-Quote-TTS/`」。
- 若要引用**相对路径**的实测结论，必须同时给出 **cwd**。例如"`.ref/st-Quote-TTS/index.js` 存在"只在 **cwd = `H:\GitHub\NyaaChat`** 时成立。

### 0.3 方法学红线：残留扫描必须**双方法交叉**

`git grep` **只搜已跟踪文件**。本项目此刻 `.docs/plugin-system/**`、`plugins/**`、`src/plugins/**`、`src/components/ExtensionsModal.tsx` 全都**未跟踪** —— 在它们上面跑 `git grep` 会得到**假通过**（本阶段已发生 6 次，其中一次让 captain 误判 SSOT 无 `rehype` 残留，实际还有 4 处）。

> **凡扫描未跟踪路径：`git grep` ∪ 文件系统扫描（`Select-String` / `Get-ChildItem`）双方法交叉，两者都空才算通过。**

参考文件（本文引用的 NyaaChat 侧产物，均为实测）：

| 文件 | lines | bytes | mtime |
|---|---|---|---|
| `src/plugins/types.ts` | 111 | 4492 | 21:02:30 |
| `src/plugins/decorators.ts` | 221 | 9356 | 21:26:40 |
| `src/plugins/backend.ts` | 113 | 4211 | 20:10:57 |
| `src/plugins/hostContext.ts` | 136 | 6704 | 20:51:56 |
| `src/components/MessageItem.tsx` | 1002 | 51399 | 20:23:02 |
| `plugins/quote-tts/plugin.tsx` | 119 | 6626 | 20:41:45 |
| `plugins/quote-tts/quoteScan.ts` | 112 | 5402 | 21:02:39 |
| `plugins/quote-tts/QuoteTtsButton.tsx` | 187 | 8158 | 20:42:02 |
| `plugins/quote-tts/QuoteTtsSettings.tsx` | 346 | 16158 | 20:52:31 |
| `plugins/quote-tts/voices.ts` | 87 | 3847 | 20:18:50 |
| `plugins/quote-tts/README.md` | 120 | 8745 | 20:34:22 |
| `ext-host/src/server.js` | 368 | 13995 | 20:08:24 |
| `nginx.conf` | 385 | 18110 | 20:10:46 |

---

## 1. 移植总则：**不兼容，只重写**

NyaaChat V1 **不做** ST 扩展的 drop-in 兼容（SSOT §1.3 明确列为范围外）：

- 不解析 `manifest.json`；不读写 `extension_settings`；
- 不提供 `script.js` / `scripts/extensions/**` / `.mes_text` 这类 DOM 逃逸区；
- 扩展兼容层已在上一阶段整体摘除（见 `.docs/阶段交接-ST-EXT-REMOVAL.md`），**没有回头路**。

因此"移植"= **读懂它做什么 → 用 NyaaChat 的契约重新实现**。三个必答问题：

1. 这个 ST 依赖在 NyaaChat **有没有对应物**？（多数没有 —— `st-Quote-TTS` 的 8 项里有 4 项无对应物，见审计报告 §2.3）
2. 没有对应物时，**框架给的是什么契约**？（装饰 / 配置 / 设置面板 / 事件 / 后端能力 —— 见《插件框架规范》§2）
3. 拿不到的能力（如任意 DOM 注入），**该不该在 NyaaChat 做**？不该的话就在文档里如实登记为"未移植"，**不要**用 `dangerouslySetInnerHTML` 之类的旁路把它做出来。

---

## 2. ST 必须替换的依赖清单

出处一律为「项目根 `NyaaChat/.ref/st-Quote-TTS/`」（`index.js`，249 行 / 9357 B / mtime 2026-06-14T05:33:29）。

| # | ST 依赖 | ST 用法与出处（行号） | NyaaChat 替换 | 备注 |
|---|---|---|---|---|
| 1 | **`extension_settings` + `saveSettingsDebounced`** | 从 `../../../extensions.js` 导入（L1）；读 `extension_settings["quote_tts"].characterMap`（L150/L181/L245）；写 `characterMap[char] = voice` 后 `saveSettingsDebounced()`（L180-184） | `NyaaPlugin.defaults` + `ctx.updateConfig()` → `AppState.plugins["quote-tts"].config`（`plugins/quote-tts/voices.ts` 的 `QUOTE_TTS_DEFAULTS`，L60-64；`plugin.tsx` L106） | 写入**必须**经 `updateConfig`（宿主 writer → `handleSaveSettings()` 落盘）；参考《插件框架规范》§3 |
| 2 | **`getContext()`** | 从 `../../../extensions.js` 导入（L1）；读 `context.name2`（当前用户名）/ `context.characterId` + `window.characters[...]`（L120-129） | 宿主上下文叶子模块 **`src/plugins/hostContext.ts`**（136 行 / 6704 B）：`PluginHostContext.identity.{user,char}` + `sessionMessages`；`plugins/quote-tts/QuoteTtsSettings.tsx` 的 `collectParticipantNames(host)`（L130-143）读它，组件里用 `useSyncExternalStore(subscribeHostContext, getHostContext)`（L166-167）订阅 | ⚠️ 插件**不要**从 `runtime` / `backend` / `index` 取「值」（模块环，见《插件框架规范》§7.1 第 24 条）；`hostContext.ts` 是**叶子模块**，可以直接引 |
| 3 | **`eventSource` + `event_types`** | 从 `../../../../script.js` 导入（L2）；`eventSource.on(MESSAGE_RECEIVED, …setTimeout(…,200))`、`CHAT_CHANGED, …setTimeout(…,1000)`（L63-70），另有启动兜底 `setTimeout(…,2000)`（L71） | **结构性消除**：NyaaChat 在**渲染期逐块调用**装饰器，控件就是这次渲染的产物，没有"等 DOM 稳定"这一步 ⇒ `quote-tts` **不注册任何事件、不实现 `setup`**（`plugin.tsx` L18/L21-29 有专门说明） | 不要为了"像 ST"而搬 `setTimeout` —— 那是 ST 只能等 DOM 的无奈产物 |
| 4 | **`.mes_text` DOM** | `$('.mes_text').each(...)`（L76）；`$element.html()` 取 HTML、`$element.html(newHtml)` 回写（L88/L111）；`$msgBlock.closest('.mes_block')...find('.name_text')`（L81-82） | **逐块消息装饰契约**：`decorators.messageText(text, ctx) => TextDecoration[]`（`src/plugins/types.ts` L31-67）→ 宿主 `src/plugins/decorators.ts` 切分并渲染 React 节点（**不注入 DOM**）。`quoteScan.ts` 扫描的是**块纯文本**，不是 HTML 字符串 | 不要 `document.querySelector`；不要 `innerHTML` 回写；装饰产物是 React 节点（§4） |
| 5 | **`$.get(.../settings.html)` 设置面板** | 轮询 `#extensions_settings` 容器（L43-46），`await $.get(EXTENSION_FOLDER_PATH + '/settings.html')`（L48）后 `append`（L49），再手工 `on("click")` 绑事件（L50） | `NyaaPlugin.SettingsPanel`（React 组件），由 `ExtensionsModal` 渲染：`plugins/quote-tts/QuoteTtsSettings.tsx`（346 行 / 16158 B） | **不移植** `settings.html`（36 行 / 1679 B）与 `style.css`（112 行 / 2677 B）—— 用 Tailwind + 既有控件风格重写（审计报告 D3 补充） |
| 6 | **`getRequestHeaders()`** | 从 `../../../../script.js` 导入（L2），用于带 ST 会话头的 `fetch`（L197） | **不需要**：前端只打**同源** `/api/ext-host/...`，由 nginx 精确 location 转发；鉴权/上游由 ext-host 的服务端 `env` 决定（§6） | ST 的会话头是 ST 后端协议的一部分，NyaaChat 没有对应物 |
| 7 | **`toastr`** | `toastr.error(...)`（L234，`typeof toastr !== 'undefined'` 守卫） | **插件内 React 状态**：`QuoteTtsButton.tsx` 用按钮自身的 `state` 表现 loading / 失败（L76-163），不引入全局 toast | 宿主没有全局 toast 对象；反向依赖也不允许 |
| 8 | **`window.playQuoteTTS` 全局函数 + 内联 `onclick`** | 拼 HTML 时写 `onclick="window.playQuoteTTS(this, '<text>', '<charName>')"`（L107）；函数挂在 `window`（L240-249） | **React 组件 + props**：`<QuoteTtsButton text charName config callBackend />`（`plugin.tsx` L81-88） | 内联 `onclick` + 全局函数是 DOM 注入形态的必然产物；React 下不存在 |

**另外两项"没有对应物、也不需要对应物"的 ST 依赖**（移植时直接删掉，不要找替身）：

- **jQuery 本身**（`jQuery(...)` L38、`$(...)` 多处、`$.get` L48）：NyaaChat 前端是 React + TS，仓库里没有 jQuery。
- **硬编码的上游端点 / `DUMMY_KEY`**（`TARGET_ENDPOINT` L9、`DUMMY_KEY` L11、`MODEL_ID` L12、`ST_PROXY_URL` L15）：端点与模型**搬到服务端 `env`**；`DUMMY_KEY` 的"必须非空 Authorization"语义由 ext-host 保留（§6）。

---

## 3. `st-Quote-TTS` 8 项实现的逐条对照

（对照表源头：审计报告 §2.3；落点实测见 `plugins/quote-tts/plugin.tsx` L10-19。）

| # | ST 实现（出处） | ST 依赖 | NyaaChat 落点 | 移植动作 |
|---|---|---|---|---|
| 1 | 扫消息取引号并插 🔊（L75-113；正则 L90） | jQuery + `.mes_text` DOM + HTML 回写 | `decorators.messageText[0]`（`plugin.tsx` L74-89）→ `quoteScan.scanQuotes()`（`quoteScan.ts` L66-112）→ `<QuoteTtsButton>` | **重写**：DOM 扫描 → 块文本正则取区间；HTML 拼接 → React 节点 |
| 2 | 设置面板挂载（L43-56） | `#extensions_settings` + `$.get(settings.html)` | `SettingsPanel`（`QuoteTtsSettings.tsx`，346 行 / 16158 B） | **重写**：React 组件 + 宿主上下文枚举参与者 |
| 3 | 音色偏好存储（L150/L180-184） | `extension_settings` + `saveSettingsDebounced()` | `defaults.characterMap` + `updateConfig`（`voices.ts` L60-64；`plugin.tsx` L106） | **改接线**，配置形状保持 `{ characterMap: { 角色名: 音色 } }` |
| 4 | 参与者枚举（L120-142：`context.name2` / `window.characters` / `#chat .name_text` / 前缀扫描） | ST context + DOM | `QuoteTtsSettings.collectParticipantNames(host)`（L130-143）：`host.identity.user` / `host.identity.char` / `host.sessionMessages` 的**行首前缀扫描**（`INLINE_NAME_LINE_RE` L109） | **重写数据源**：DOM → 宿主上下文只读快照 |
| 5 | 播放（L187-238）：`fetch('/api/openai/custom/generate-voice', { provider_endpoint, model, input, voice, response_format, api_key, token })` → blob → `new Audio` | ST 自带**开放代理** | `backend[]` 声明（`plugin.tsx` L107-114）+ `ctx.callBackend('quote-tts.speech', { input, voice })`（`QuoteTtsButton.tsx` L132） | **换通道**：上游由服务端 `env` 决定（§6，安全红线） |
| 6 | 音色常量（L17-32，14 个 Edge-TTS 音色）/ `MODEL_ID = "tts-1-hd"` / `DUMMY_KEY = "none"` | 硬编码 | 音色表**原样移植**（`voices.ts` L18-33）；模型/端点/鉴权移到 ext-host env（`.env.example` 的 `PLUGIN_QUOTE_TTS_*`） | 常量照搬，**端点不留前端** |
| 7 | 事件订阅（L62-72）+ `setTimeout` 等 DOM | ST `eventSource` | **不需要** —— 渲染期同步取运行时快照（`plugin.tsx` L21-29） | **删除**该机制（结构性消除） |
| 8 | 试听固定文案（L34 `PREVIEW_TEXT`，L171-174 绑定） | 无 | `voices.ts` L41 `PREVIEW_TEXT`（原样移植）；面板试听按钮走同一条 `callBackend` | 常量照搬 |

> **结论（抄给下一个移植者）**：8 项里 **4 项（1/5/7 及 2 的宿主侧）在 NyaaChat 无对应物**，必须由框架先给契约。移植一个 ST 扩展前，先按本表把它拆成"照搬 / 改接线 / 重写 / 删除"四类，再动手。

---

## 4. 契约差异（最容易出错的一条）：**装饰 = 追加，不是替换**

| | ST | NyaaChat |
|---|---|---|
| 实现 | `html.replace(re, (match, …) => `${match}<span …>🔊</span>`)`（项目根 `NyaaChat/.ref/st-Quote-TTS/index.js` **L107**） | 宿主输出**正文（顶层 string）**，再把 `render` 的返回值作为**独立带 key 的 Fragment** 追加 |
| 语义 | `match` 保留 + 按钮追加 | 同一语义，但**由宿主保证**，不由插件拼字符串 |
| 出处 | L107（两份拷贝一致） | `decorators.ts` L199-215、L26-36；`types.ts` L42-49 |

**给插件作者的两条硬约束**（原文可直接抄进你的插件 README）：

1. **`TextDecoration.render` 只输出"装饰节点"本身，不要在里面再渲染 `text`。** 被标注的原文由**宿主**以顶层文本节点输出；`render` 的返回值追加在其后。若在 `render`（或其返回的组件内部）再渲染 `text`，页面上会出现**两份原文**。
2. 宿主侧必须保持**两级输出**：`nodes.push(slice)`（顶层 string）+ `React.createElement(React.Fragment, { key }, rendered)`。**把 `slice` 与 `rendered` 同置一个 Fragment 会让被装饰的引号丢掉 `.quote-highlight`**（`MessageItem.decorateAndHighlight` 只对 `string` 型 children 做高亮）—— 这正是《验证报告-P1-P5》的 R2。

> ⚠️ **本次移植真的踩过这两个坑**：初版实现把契约理解成"**替换**片段"，只 push `render` 的返回值 ⇒ 引号文字从消息里整个消失（`猫娘: 「第一条引用」` → `猫娘: 🔊`，`verify` 在 t7 以该用例复现）。修复后 `decorators.ts` 与 `types.ts` 都写进了契约说明。

---

## 5. 保真度损失（**必须如实登记，不得含糊**）

### 5.1 全角「：」不作前缀分隔符 —— **与 ST 行为一致**

- ST 的前缀正则用的是 **ASCII `:`**（选项 1 出处：项目根 `NyaaChat/.ref/st-Quote-TTS/index.js` L90；参与者扫描 L137）。
- NyaaChat 同样只用 ASCII（`quoteScan.ts` L49-50；`QuoteTtsSettings.tsx` L109 的 `INLINE_NAME_LINE_RE`）。
- 后果：`猫娘：「早上好呀」`（全角冒号）**不会被当作"人名 + 引号"**，`charName` 落回 `senderName`。
  ⚠️ **但那个引号仍然会被装饰、仍然有 🔊** —— 它走的是**无前缀**分支 `PLAIN_QUOTE_RE`（`quoteScan.ts` L53）。**丢的是"这句是谁说的"这一归属，不是按钮。**
- 若产品希望支持全角冒号：**必须同时改两处**（`quoteScan.ts` L49-50 与 `QuoteTtsSettings.tsx` L109）—— 一处改会造成"装饰命中了但面板列不出该角色、用户配不到音色"。这是**行为变更**，不是修 bug。

### 5.2 单行中段「人名:」落回 `senderName` —— **引号仍会被装饰**

- `PREFIXED_QUOTE_RE` 要求 `人名:` 出现在 **`^`（块首）或 `\n` 之后**（`quoteScan.ts` L49-50）。因此单行中段形如
  `猫娘：「早上好呀」然后 “再来一句” 结束` —— **两处引号都仍然被装饰**，只是两者的 `charName` 都落回 `senderName`。
- ST 原版的前缀判定是 `(?:^|>|[\n\r])`（L90），因为 ST 扫的是 **HTML 字符串**、标签边界天然产生 `>`，所以它在单行中段也能命中。移植到**纯文本**后没有 `>` 这个概念，该形态随之消失。
- ⇒ **丢的是人名归属（用哪个音色），不是按钮。** 本阶段已把它登记为《验证报告-P1-P5》的 **R4**（low / 非本阶段引入）。
- ⚠️ **写文档/交接时不要写成"没有按钮"** —— 那是错的，会把"音色选错人"误报成"功能缺失"。

### 5.3 另一条既有覆盖边界（顺带登记）

嵌套内联元素**内部**的引号不被装饰：`<strong>“引用”</strong>` 里的引号没有 🔊。原因：`MessageItem.renderTextWithQuotes()` 只转换 **`string` 类型**的 children，React 元素原样透传（`MessageItem.tsx` L145-154；`decorators.ts` L38-43）。这是**既有 `quote-highlight` 就有的行为**，不是本次移植引入。

---

## 6. 后端通道差异：**开放代理 → 受控代理**

| | ST 原版 | NyaaChat |
|---|---|---|
| 调用点 | `fetch(ST_PROXY_URL, { body: JSON.stringify({ provider_endpoint: TARGET_ENDPOINT, model: MODEL_ID, input, voice, response_format: 'mp3', api_key: DUMMY_KEY, token: DUMMY_KEY }) })`（项目根 `NyaaChat/.ref/st-Quote-TTS/index.js` L195-210） | `ctx.callBackend('quote-tts.speech', { input, voice })`（`QuoteTtsButton.tsx` L132） |
| 上游地址 | **由请求体 `provider_endpoint` 指定**（任意 URL 转发 = SSRF 面） | **只能来自 ext-host 的 `process.env.PLUGIN_QUOTE_TTS_UPSTREAM_URL`**；body 里的 `provider_endpoint` / `baseUrl` / `model` / `api_key` **一律忽略**（`ext-host/src/server.js` L47-60、L86-127、L119） |
| 模型 | body `model` | env `PLUGIN_QUOTE_TTS_MODEL`（默认 `tts-1-hd`），服务端强制（`server.js` L57/L121-127） |
| 鉴权 | body `api_key` / `token`（ST 代理再用它生成 `Authorization`） | env `PLUGIN_QUOTE_TTS_API_KEY`（默认 `"none"`，但**仍发送非空 `Authorization`** —— 上游 schema 要求，`server.js` L58-59/L135） |
| 通道 | ST 自带的 `/api/openai/custom/generate-voice` | `backend[]` 声明 → nginx **精确** `location = /api/ext-host/plugins/quote-tts/speech`（`nginx.conf` L216-226）→ ext-host `POST /plugins/quote-tts/speech`（`server.js` L337-338） |
| 校验 | 无（任意 voice / 任意长度） | `input ≤ 1000` 字符、`voice` 14 音色白名单、body ≤ 64 KB（`server.js` L64-80/L95-117） |

**红线**：ST 那条"上游由 body 指定"的通道**不得以任何理由重建**。它对应的 `/openai/custom/generate-voice` 已在上一阶段随扩展兼容层一起删除。详见《插件框架规范》§5.7。

---

## 7. 移植操作清单（从零搬一个 ST 扩展）

1. **拆解**：把 ST 扩展的每项实现列成表，标出"照搬 / 改接线 / 重写 / 删除"（§3 是范例）。
2. **列依赖**：逐条对照 §2，确认每个 ST 依赖在 NyaaChat 的替换物；**找不到替换物就先问框架要不要补契约**，不要用旁路硬做。
3. **建目录**：`plugins/<id>/`（见《插件框架规范》§6 步骤 1）。ST 的 `manifest.json` / `style.css` / `settings.html` **不移植**。
4. **常量先行**：把音色表、默认文案这类纯常量照搬成 `<id>/voices.ts` 风格的模块（本范例：`voices.ts` 87 行 / 3847 B）。
5. **设置面板**：用 React + 既有控件重写 `SettingsPanel`；数据源改成宿主上下文（`hostContext.ts`）。
6. **业务主逻辑**：装饰/播放这类"和消息、和外部服务打交道"的部分，按 §4（追加语义）与 §6（受控后端）重做。
7. **注册**：`plugins/registry.ts` 加一行（《插件框架规范》§6 步骤 2）。
8. **工程配置**：`eslint.config.js` 的 `files` 已含 `plugins/**`（**实测 L38**），`tsconfig.json` 无 `include` —— **都不用改**；跑 `npm run lint` + `npm run build`。
9. **如实登记保真度损失**：像 §5 那样把"做不到/变了样"的地方写清楚，包括"引号还在、只是归属回落"这类**别被误读成功能缺失**的细节。
10. **文档落位**：`.docs/plugin-system/`（本文件 + 该插件的 `README.md`），并在交接文档的"已知行为变化"里登记。

---

## 8. 本次移植的产物对照（可直接当模板）

| NyaaChat 文件 | lines / bytes | 对应 ST 出处 | 说明 |
|---|---|---|---|
| `plugins/quote-tts/plugin.tsx` | 119 / 6626 | 整个 `index.js` 的装配部分 | `NyaaPlugin` 契约实现（meta / defaults / backend / SettingsPanel / decorators） |
| `plugins/quote-tts/quoteScan.ts` | 112 / 5402 | L87-113（正则 + 追加） | 区间计算（captain 自办）；块文本空间 |
| `plugins/quote-tts/QuoteTtsButton.tsx` | 187 / 8158 | L187-238（playTTS） | React 版播放按钮（object URL 回收 + 互斥） |
| `plugins/quote-tts/QuoteTtsSettings.tsx` | 346 / 16158 | L115-184（面板） | React 设置面板（参与者枚举 + 音色选择 + 试听） |
| `plugins/quote-tts/voices.ts` | 87 / 3847 | L4-35（常量） | 音色表 / 默认值 / 预览文案 / 能力名与路径 |
| `plugins/quote-tts/README.md` | 120 / 8745 | — | 该插件的移植说明 |
| `ext-host/src/server.js` | 368 / 13995 | L187-238 的 fetch 目标 | 受控 TTS 代理（`POST /plugins/quote-tts/speech`） |
| `nginx.conf` | 385 / 18110 | — | 精确 location（L216-226） |

---

## 9. 常见错误（移植版）

| # | 症状 | 根因 | 处置 |
|---|---|---|---|
| 1 | 引号文字**整个消失**，只剩 🔊 | 把装饰当成"**替换**片段" | 契约是**追加**：正文由宿主输出（§4） |
| 2 | 同一段原文**出现两份** | `render` 里又渲染了一遍 `text` | `render` 只输出装饰节点（§4） |
| 3 | 被装饰的引号**丢了 `.quote-highlight`**（文本与按钮都在） | 宿主的两级输出被合并成一个 Fragment | 恢复两级输出（§4；R2） |
| 4 | 在 React 里 `document.querySelector('.mes_text')` | 照搬 ST 的 DOM 依赖 | NyaaChat 无 `.mes_text`；改用装饰契约（§2 第 4 项） |
| 5 | 插件 import 宿主 `runtime` 后**静默消失** | 模块环（`plugins/registry → plugin → … → src/plugins/registry`） | 走上下文注入或叶子模块 `hostContext.ts`（§2 第 2 项） |
| 6 | 移植后单行中段 `人名:` **没有按钮** | 误判：其实**有**按钮，只是 `charName` 落回 `senderName` | 见 §5.2；先看屏幕上是否真的有 🔊 再下结论 |
| 7 | 指望 `猫娘：`（全角）触发人名归属 | 与 ST 一致的既有口径 | 见 §5.1；要改必须同时改两处 |
| 8 | 在插件里 `fetch` 一个自己拼的上游地址 | ST 的开放代理形态 | **红线**：上游只能由 ext-host `env` 决定（§6） |
| 9 | 搬了 `setTimeout(…, 200/1000)` 等"DOM 稳定" | ST 的时序无奈 | NyaaChat 渲染期同步取快照，**删掉**（§2 第 3 项） |
| 10 | 移植 `settings.html` / `style.css` | ST 的 HTML 片段形态 | 用 React + Tailwind 重写（§2 第 5 项） |

---

## 10. 迁移经验总结（本次 `st-Quote-TTS` 的实证，2026-09-16）

> 本节是**做过一遍之后**才写得出来的东西：它不是流程复述（那在第 7 节），而是"哪里会翻车、为什么、下次怎么防"。
> 用户明确定性：`引用朗读` 只是**流程样例**，后续还有更多 ST 扩展要迁 —— 本节就是给那些迁移用的。

### 10.1 一句话结论

**ST 扩展 → NyaaChat 插件不是"搬代码"，而是"把 ST 给出的能力，用 NyaaChat 的契约重新表达一次"。**
ST 侧 `index.js` 249 行 / 9357 B，最终落成 **7 个插件文件**；本次另有 **8 个框架模块**属一次性投入。真实工作量在**对齐契约语义**与**补宿主能力**，不在翻译业务逻辑 —— 逻辑（扫描引号、查音色、播放）只占很小一部分。

### 10.2 本次实际踩到的 7 个坑（按发现顺序，全部有据）

| # | 症状 | 根因 | 现在的防线 |
|---|---|---|---|
| 1 | **引号原文被从消息里整个删掉**（`猫娘: 「第一条引用」` → `猫娘: 🔊`） | 契约只写"切分文本并插入插件返回的 React 节点"，**没说清是替换还是追加**，实现按"替换"理解；而 ST 原版是**追加**（参考拷贝 L107 形如 `` `${match}<span …>🔊</span>` ``） | §4 把语义写死为"追加"；**教训：契约里"二选一"的语义必须写成不能有第二种读法的句子** |
| 2 | 修 #1 时**打坏了引号高亮**（`.quote-highlight` 变 0） | 把正文 `slice` 塞进了 Fragment，而宿主 `decorateAndHighlight` **只对顶层 string 型 children** 做高亮 | 正文=顶层 string、装饰=独立 Fragment（§4）；**教训：修一个缺陷时必须问"这让哪些原本成立的断言失效"** —— 当时的断言只覆盖了"正文在/按钮在"，没覆盖"高亮在" |
| 3 | **插件静默消失**（列表没有、后端拒绝、装饰跳过），只留一条 `[plugins] meta: …不是对象` | 插件树 import 了 `runtime`/`backend`，而它们下游含插件注册表 ⇒ **模块环**，以插件模块为图入口时注册表读到 `undefined` 槽位 | 插件**只允许**引 `types`（type-only）与叶子 `hostContext`；**新增宿主数据要再加一个只依赖 `types` 的叶子**，不要往 runtime 里塞 |
| 4 | 主 bundle **+829 kB**（1,410 → 2,240 kB） | `import * as LucideIcons from "lucide-react"` + 动态取属性 ⇒ 打包器**无法 tree-shake**，整套图标（约 1700 个）进包 | 显式允许集（具名导入 + 映射，表外回退 `Puzzle`）；**移植时先问"这个 ST 依赖会不会把整套库拉进包"** |
| 5 | 配好上游后仍**无声**，上游 404 | `PLUGIN_QUOTE_TTS_UPSTREAM_URL` 的语义是**基地址**（`ext-host/src/server.js` 自追加 `/v1/audio/speech`），却被填成完整端点 ⇒ 路径重复成 `…/v1/audio/speech/v1/audio/speech` | 配置项注释必须写清"**基地址还是完整端点**"；本次已把 SSOT 与 `.env.example` 的措辞统一 |
| 6 | 失败时界面只闪一下 ❌，**用户看不出为什么**（原因仅在浏览器 console） | 错误只 `console.error`，没有可见反馈 | **待办**：错误原因应能在界面上看到（本次未做） |
| 7 | 插件列表显示"名称 + 版本号 + 开关"，信息冗余 | 初版按"管理表格"思路做 UI | 列表只给**名称 + 启用绿点**，版本/id/开关都进详情页（对齐 `对话模型供应商`） |

### 10.3 契约措辞的三条硬要求（本次踩过 2 条）

1. **二选一的语义必须写死** —— "追加 vs 替换"、"覆盖 vs 合并"这类，不能只写"插入/处理一下"（本次 #1 就是这么翻车的）。
2. **偏移空间必须写明** —— 本次装饰的区间是**当前块纯文本**内的偏移；历史上曾按"整条消息的渲染后纯文本"设计过，两者**不可互换**。
3. **谁输出什么必须写明** —— 正文由**宿主**以顶层文本节点输出，插件的 `render` **只输出装饰节点本身**；否则页面上会出现**两份原文**。

### 10.4 宿主能力获取的正确姿势

- 插件树里**只允许两类静态边**：`src/plugins/types`（**type-only**，编译期擦除）与 `src/plugins/hostContext`（**叶子**）。
- 需要新的宿主数据 ⇒ **再加一个只 `import type ../types` 的叶子模块**；**不要**往 `runtime` 里加（它的下游含注册表 ⇒ 环）。
- 自检判据：插件树内不得存在指向 `registry` / `runtime` / `backend` 的**值导入**。

### 10.5 角色 / 用户语义（这类"按角色配置"的插件最容易错的一半）

- **默认值要按说话人类型区分**，不能只有一个全局默认。本次：用户角色 → `zh-CN-YunjianNeural`（云健），对话角色 → `zh-CN-XiaoxiaoNeural`（晓晓）。
- **面板与渲染两侧必须同一口径**：本次面板按 `charName === host.identity.user` 判定、装饰按 `ctx.role === "user"` 判定。**两侧不一致的后果是"面板显示晓晓、播放却是云健"**，用户会直接判定"配置无效"。
- 身份字符串必须是**展示口径**（与消息行上显示的名字一致），否则"按人名建表"的音色映射查不到 —— 这也是 `getMacroIdentity()`（原始口径、空串）**不能**直接当身份用的原因。

### 10.6 验证方法学（本次最大的可复用产出）

| 纪律 | 为什么（本次的实证） |
|---|---|
| 断言要覆盖**改动的副作用面** | 修"正文消失"时打坏了"引号高亮"，而后者不在当时断言清单里 |
| **产物来源级验证**：改动的字符串字面量"在/不在" | 新告警文案在产物里命中 1、旧文案命中 0 ⇒ 比 mtime 推断硬得多（**前提见下一行**） |
| 字面量 grep 的**适用边界** | 只对**源码里写成字面量**的内容有效（写死的 className、告警/错误文案）；**运行期拼装或被 minifier 改名**的（`lucide-volume-2`、局部变量名）两侧都查不到 ⇒ **不能当判据**，只能靠 DOM 断言 |
| 未跟踪路径上 `git grep` **必得 0** | `plugins/`、`src/plugins/`、`.docs/plugin-system/` 均未跟踪 ⇒ 残留扫描一律 **`git grep` ∪ 文件系统扫描双方法交叉** |
| 相对路径必须同时给 **cwd** | 两处 `.ref` 内容不同，同一串相对路径在两个 cwd 下**结论相反**（本次一度误判"文档路径写错"） |
| "我重建过了"必须**用证据确认** | 全量缓存命中会让重建变 **no-op**；判据是 `image Created` / `container Created` / 容器内 assets 文件名是否变化（`docker image inspect` 的 `Created` 是 **UTC**，差 8 小时） |
| 镜像与源码一致性判据 | **镜像 Created > 会进 bundle 的最新源码 mtime**；改完 `src/**` 必须重建，否则验收的是旧产物 |
| 行数用 `(Get-Content <file>).Count` | `Measure-Object -Line` 会少算（本次实测差 5–22 行） |
| 计数用 `(Get-Content -Raw).Split($needle).Count - 1` | `Select-String -AllMatches` 的 `Matches.Count` 在**单行大体积压缩产物**上恒返回 0 ⇒ 会把"计数器坏了"误推成"某物不存在" |
| **反向验证** | 对"应当为 0 / 应当失败"的检查，先伪造一个"应当被检出"的形态，证明判据不是恒真 |

### 10.7 一次移植的成本参考（给后续需求排期用）

- **一次性投入**：框架（契约类型 / 注册表 / 运行时 / 归一化 / 后端客户端 / 装饰入口 / 叶子宿主上下文）+ 扩展 modal + 设置体系接入 + 宿主接线。
- **每个插件**：契约实现 + 设置面板（React 重写）+ 装饰（若有）+ 后端通道（若有）+ README。
- **判断"这个 ST 扩展好不好搬"三问**：
  1. 它靠 **DOM** 还是靠**数据**？（靠 DOM 的必须重写为 React，成本高）
  2. 它要的能力在 NyaaChat **有没有对应契约**？（没有 ⇒ 先补框架、或明确降级）
  3. 它有没有**后端代理依赖**？（有 ⇒ 走受控代理，且要在 NyaaChat 侧新增 env 与路由）

### 10.8 不要做的事（本次已踩过或被明令禁止）

- **不恢复任何 ST 通道**：`extension_settings` / `saveSettingsDebounced` / `script.js` / `.mes_text` / `#extensions_settings` / jQuery。
- **不迁移 ST 的设置面板 HTML/CSS**：用 React + 现有 Tailwind 控件风格重写（本次 `settings.html` 1679 B + `style.css` 2677 B 全部弃用）。
- **不在 `plugins/registry.ts` 里塞探针或占位插件** —— 它就是"真实插件集合"，塞进去的东西会**出现在用户界面上**。
- **不把"完整端点"当"基地址"填**（本次 #5）。
- **不引入整套库**撑大主 bundle（本次 #4；另一个例子：给扩展列表加拖拽用的 `@dnd-kit`，因扩展 modal 是静态导入而进了主 bundle，约 +49 kB）。

---

## 附：本文的核对命令（含双方法交叉）

```powershell
# 结论所依赖的 cwd（相对路径的实测结论只在 cwd = H:\GitHub\NyaaChat 时成立）
cd H:\GitHub\NyaaChat

# ① 两份 ST 拷贝并存、内容一致、各 9357 B
foreach ($p in @('H:\GitHub\NyaaChat\.ref\st-Quote-TTS\index.js',
                 'H:\GitHub\.ref\SillyTavern\st-Quote-TTS\index.js')) {
  $i = Get-Item $p
  "{0}`t{1} lines`t{2} B`t{3}`t{4}" -f $p, (Get-Content $p).Count, $i.Length,
    (Get-FileHash $p -Algorithm SHA256).Hash.Substring(0,12), $i.LastWriteTime.ToString('o')
}
# 期望：两份都是 249 行 / 9357 B / SHA256 CC650C5E23FF…
# 反例（不应存在）：H:\GitHub\.ref\st-Quote-TTS\ —— Test-Path 应为 False

# ② L107 追加语义（两份一致）
foreach ($p in @('H:\GitHub\NyaaChat\.ref\st-Quote-TTS\index.js',
                 'H:\GitHub\.ref\SillyTavern\st-Quote-TTS\index.js')) {
  (Get-Content $p)[106]      # 期望：return `${match}<span class="quote-tts-btn …
}

# ③ ST 依赖清单的出处（项目根拷贝；用绝对路径，避免 cwd 歧义）
Select-String -Path 'H:\GitHub\NyaaChat\.ref\st-Quote-TTS\index.js' -Pattern 'extension_settings|getContext|eventSource|\.mes_text|\.name_text|\$\.get|getRequestHeaders|toastr|window\.playQuoteTTS'

# ④ NyaaChat 侧产物（未跟踪路径 —— 双方法交叉）
Get-ChildItem plugins,src\plugins -Recurse -File -Include *.ts,*.tsx |
  Select-String -Pattern 'extension_settings|\.mes_text|scripts/extensions|jQuery|\$\(|toastr|getRequestHeaders|window\.playQuoteTTS'
git grep -n -F -e "extension_settings" -e ".mes_text" -e "scripts/extensions" -e "toastr" -- src plugins
# 两者都空才算"无 ST 残留"（注意 git grep 对未跟踪路径必然返回 0 命中 —— 那是假通过）

# ⑤ 契约语义（装饰=追加）
Select-String -Path src\plugins\decorators.ts -Pattern 'nodes\.push\(slice\)|React\.createElement|装饰语义|不是替换'
Select-String -Path src\plugins\types.ts -Pattern '旁边加东西|不要再渲染|两份原文'

# ⑥ 保真度损失的口径（两处必须一致）
Select-String -Path plugins\quote-tts\quoteScan.ts -Pattern 'PREFIXED_QUOTE_RE|PLAIN_QUOTE_RE'
Select-String -Path plugins\quote-tts\QuoteTtsSettings.tsx -Pattern 'INLINE_NAME_LINE_RE'

# ⑦ 后端通道（生产 nginx 只有精确匹配）
Select-String -Path nginx.conf -Pattern 'location = /api/ext-host/plugins/'
Select-String -Path ext-host\src\server.js -Pattern 'PLUGIN_QUOTE_TTS_|plugins/quote-tts/speech|provider_endpoint'
```
