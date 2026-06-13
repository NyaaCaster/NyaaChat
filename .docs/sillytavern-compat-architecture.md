# NyaaChat × SillyTavern 兼容架构规范（SSOT）

> 本文件是「NyaaChat 兼容酒馆（SillyTavern）扩展 / 正则 / 酒馆助手渲染」这一大版本工作的唯一事实源。
> 所有实现以本文档为准；变更需同步更新本文件。
>
> 状态：**地基设计阶段** · 创建：2026-06-13
>
> 已定决策：**A = A3 混合**（先原生重实现渲染器内核，地基按 ST 契约搭建，预留逼近完整仿真的接口）。
> **B = 双层权限模型（已定方向，见 §5.B）**：扩展为服务端共享资源，管理员经 `/manage` 统一安装/更新/根启停；用户仅能在删减版「扩展」面板里为自己启停未被根禁用的扩展，个人偏好存 localStorage。**B′ = Node 边车容器**（已定，见 §5.B′）。
> 当前动工点：**P1 兼容层地基**（已定起点）。

---

## 0. 目标

让 NyaaChat 能够：

1. **兼容酒馆扩展（extensions）机制**：支持安装 / 列表 / 启用禁用 / 更新 / 删除第三方扩展（不止 JS-Slash-Runner 一个）。
2. **兼容酒馆正则（Regex）模块**：支持正则脚本对「显示」与「发给 LLM 的 prompt」双管线生效，含全局与角色卡两级作用域。
3. **兼容酒馆助手（JS-Slash-Runner）的「渲染」功能**：把 AI / 用户消息气泡里的 HTML 前端卡渲染成可交互界面（核心交付）。

---

## 1. 现状基线（NyaaChat）

| 维度 | 现状 | 对兼容的影响 |
|---|---|---|
| 技术栈 | React 19 + Vite + TS，纯前端 SPA | 无 Node 后端；扩展「安装 = git clone」这条 ST 假设不成立 |
| 部署 | nginx 静态托管 + 反代上游 API | 运行时不能在服务端跑 git；扩展来源需重新设计 |
| 消息渲染 | `MessageItem.tsx`：`react-markdown` + `rehypeRaw` + **`rehypeSanitize`** | sanitize 主动剥离 `script` / `iframe` / `on*` / `javascript:`，**与前端卡渲染直接冲突**，必须为渲染区开「逃逸口」 |
| 消息模型 | `types.ts` `Message{ id, role, content, ... }` | 缺 ST 的 `mesid` / `is_system` / swipes / `extra` 等；渲染器靠 `mesid` 反查楼层，需补 |
| 持久化 | `localStorage`（`sessionStorage.ts`，`nyaachat_sessions`） | 扩展设置 / 正则脚本 / 变量需要新的存储键与模型 |
| 状态 | `App.tsx` 顶层 state → `ChatInterface` → `messages.map(MessageItem)` | 渲染器要在 React 受控 DOM 之外操作 DOM，需治理冲突 |
| prompt 组装 | `chatPipeline.ts` + `api.ts` | 正则 promptOnly 管线、扩展 `setExtensionPrompt` 注入点都挂这里 |

关键文件：
- `src/components/MessageItem.tsx`（气泡渲染，sanitize 在此）
- `src/components/ChatInterface.tsx:796`（`messages.map`）
- `src/lib/chatPipeline.ts`（prompt 组装）
- `src/lib/sessionStorage.ts`（持久化）
- `src/types.ts`（消息 / 设置模型）

---

## 2. 调研结论速查

### 2.1 ST 扩展加载契约
- manifest.json 字段：`display_name` / `loading_order`（数字，升序加载）/ `requires`（模块依赖，子集校验）/ `optional` / `js` / `css` / `author` / `version` / `homePage` / 可选 `auto_update` / `minimum_client_version` / `i18n` / `hooks`。
  - 参考：`.ref/st-extension-example/manifest.json`、`.ref/JS-Slash-Runner/manifest.json`
- 加载方式：`<script type="module" src="/scripts/extensions/{name}/{manifest.js}">` 动态注入 `document.body`（`extensions.js:814-843`）。CSS 同理 link 注入。
- 第三方扩展前缀 `third-party/`，装在 `scripts/extensions/third-party/<repo>/`。
- 安装 / 更新 = **后端 git clone / pull**（`extensions.js:1352+` 调 `/api/extensions/*`）。**NyaaChat 无后端，这条必须替换**（见 §5 决策 B）。

### 2.2 扩展运行时依赖面（NyaaChat 必须提供的兼容层）
- 全局 `window.SillyTavern.getContext()`：返回约 80+ 字段的上下文对象（`st-context.js:115+`），关键：`chat` / `characters` / `this_chid` / `chat_metadata` / `eventSource` / `eventTypes` / `substituteParams(Extended)` / `setExtensionPrompt` / `extension_settings` / `saveSettingsDebounced` / `messageFormatting` / `addOneMessage` / `generate(Raw)` / `getRequestHeaders` …
- `eventSource`（emit/on/once/makeFirst/makeLast/removeListener/emitAndWait）+ `event_types`。渲染触发命脉事件：`CHARACTER_MESSAGE_RENDERED` / `USER_MESSAGE_RENDERED` / `MESSAGE_UPDATED` / `MESSAGE_SWIPED` / `MESSAGE_DELETED` / `MORE_MESSAGES_LOADED` / `chatLoaded` / `app_ready`。
- 全局：`window.$`(jQuery)、`window._`(lodash)、`window.toastr`、`window.hljs`。
- DOM 约定：`#chat > .mes[mesid="N"]`、`.mes_text`、`#extensions_settings`。

### 2.3 正则模块（双管线是精髓）
- 核心 `getRegexedString(raw, placement, { isMarkdown, isPrompt, isEdit, depth, characterOverride })`（`extensions/regex/engine.js:334-381`）。
- 同一条消息文本会被跑两遍、传不同标志：**一遍给屏幕（`isMarkdown:true`），一遍给 LLM（`isPrompt:true`）**。`markdownOnly` 只在前者生效，`promptOnly` 只在后者。两者都不勾 = 改写存盘原文。
- placement 枚举（数组）：`USER_INPUT=1` / `AI_OUTPUT=2` / `SLASH_COMMAND=3` / `WORLD_INFO=5` / `REASONING=6`。
- depth 范围匹配：0=最后一条，倒序索引。`minDepth/maxDepth` 可为 null。
- 作用域：全局（`extension_settings.regex`）+ 角色卡（`character.data.extensions.regex_scripts`）+ 预设；按固定优先级拼成单数组**链式串联**。
- 依赖 `substituteParams`（宏替换）—— 最大隐式依赖，必须先有。
- TS interface 草案见 §6。

### 2.4 JS-Slash-Runner 渲染功能（端到端）
1. 监听 ST 渲染事件 + watch → 在 `#chat .mes` 下找含 HTML 的 `<pre>`（`is_frontend.ts`：文本含 `html>` / `<head>` / `<body` 任一即判定为前端卡，**宽松子串匹配**）。
2. `$pre.wrap('<div class="TH-render">')` 作为载体，Vue `<Teleport>` 注入 `Iframe.vue`。
3. iframe：**无 sandbox、同源**，`srcdoc`（或同源 blob URL）。id = `TH-message--{mesid}--{idx}`（API 靠这个反查楼层）。
4. iframe 内 `predefine.js` 通过 `window.parent` 直连：继承父页 `_`/`$`，把 `TavernHelper.*` 摊平成全局函数，`window.SillyTavern = parent.SillyTavern`。
5. CDN 依赖（jsdelivr 的 jQuery/Vue/FontAwesome/tailwind + 远程 log.js）。
6. 高度自适应：iframe 内 `ResizeObserver` 直接写父文档 `frameElement.style.height`（同源才行）。
- 暴露给前端卡的 `TavernHelper` API：chat_message / event / generate / variables(global·chat·message·script·preset) / slash / worldbook / character / preset / displayed_message / tavern_regex / inject / macro_like / script / audio / util / version 等十几个域。
- 构建产物 `dist/index.js`（Vue3+Pinia，ESM），`@sillytavern/*` 全部 external、靠相对 URL 运行时解析。

---

## 3. 三个硬骨头

1. **React 受控 DOM ↔ 外部 jQuery 篡改冲突**：JSR 直接 `$pre.wrap` / `addClass('hidden!')` / `Teleport` 进 `.mes` 内部，而这些 DOM 由 React 渲染管控。必须给气泡设计「逃逸区」：消息体某块 DOM 交由渲染器自由操作，React 不再 diff（`dangerouslySetInnerHTML` 占位 + ref 移交 / portal）。
2. **`@sillytavern/*` ESM 模块面**：若直接复用 JSR `dist/index.js`，浏览器会去 fetch 一堆 `../../script.js` 相对路径模块，NyaaChat 必须在这些 URL 上提供导出齐全、且 `chat`/`eventSource` 有真实语义的 shim 模块。符号面巨大。
3. **无后端的扩展安装 / 更新**：ST 靠服务端 git。NyaaChat 要换成「上传 zip / 远程 URL 运行时拉取 / 内置打包」之一。

---

## 4. 兼容层分层设计（路线无关的地基）

```
┌─────────────────────────────────────────────────────────┐
│  前端卡（HTML）  ← AI 消息里的 ```html 代码块             │
├─────────────────────────────────────────────────────────┤
│  渲染 iframe（同源·无 sandbox·srcdoc）                    │
│   └ bridge: 注入 window.TavernHelper / window.SillyTavern │
├─────────────────────────────────────────────────────────┤
│  兼容层 Shim（NyaaChat 新增 src/compat/）                  │
│   ├ stContext: getContext() 字段映射到 NyaaChat 状态      │
│   ├ eventBus: eventSource + event_types（驱动渲染触发）    │
│   ├ tavernHelper: TavernHelper.* API（渐进实现）          │
│   ├ macros: substituteParams 宏引擎                       │
│   └ globals: window.$ / _ / toastr（按需）               │
├─────────────────────────────────────────────────────────┤
│  正则引擎（src/compat/regex/）双管线集成                   │
│   ├ 显示管线 → MessageItem 渲染前                          │
│   └ prompt 管线 → chatPipeline 组装时                      │
├─────────────────────────────────────────────────────────┤
│  扩展系统（src/compat/extensions/）                        │
│   ├ manifest 模型 + 加载器（script type=module）          │
│   ├ 来源 / 安装 / 更新（无后端方案）                       │
│   └ 管理 UI（列表 / 开关 / 删除）                          │
├─────────────────────────────────────────────────────────┤
│  NyaaChat 既有：React state · chatPipeline · api · 存储    │
└─────────────────────────────────────────────────────────┘
```

---

## 5. 关键决策点（待用户拍板）

### 决策 A：JS-Slash-Runner 集成策略 ✅ 已定 = A3
- **A1 完整 ST 仿真**：提供 `@sillytavern/*` ESM shim + 全局 + 事件 + DOM 约定，直接挂载 JSR 官方 `dist/index.js`。
  - ＋ 一套地基吃下多个扩展；跟随上游更新。
  - － 符号面巨大、硬骨头 1+2 全吃；Vue 面板与 React 并存；调试困难。
- **A2 原生重实现「渲染器」**：NyaaChat 自建前端卡渲染器（检测 HTML → 同源 iframe → 注入兼容版 bridge），只复刻 JSR 渲染功能依赖的那部分 `TavernHelper` API，不跑 JSR 的 Vue 面板。
  - ＋ 与 React 架构契合、可控、调试简单；规避硬骨头 2。
  - － 每个扩展单独适配；不直接享受 JSR 上游迭代。
- **A3 混合（推荐）**：先做 A2 内核把前端卡跑通（最快见效、风险可控），地基（兼容层 / 正则 / 扩展系统）按 ST 契约搭建，为后续逐步逼近 A1、纳入更多扩展留接口。

### 决策 B：扩展分发与权限模型 ✅ 方向已定 = 双层权限

**与 ST 的本质差异**：ST 是「每用户账号 + 服务端各自安装」；NyaaChat 是「多用户共享公共后端 + 无账号 + 各自 localStorage」。因此扩展不能像 ST 那样按用户安装，而是**服务端共享、管理员统一治理、用户各自启停**。

#### B.1 角色与数据分治

| 层 | 谁 | 能做什么 | 数据存哪 |
|---|---|---|---|
| **服务端共享层** | 系统 | 持有扩展本体文件；记录每个扩展的「根开关」（管理员级 enable/disable） | 服务端（文件 + 一份共享清单 JSON） |
| **管理页 `/manage`** | 管理员（`.env` 账号密码） | 安装 / 更新 / 删除扩展、根启用 / 根禁用 | 操作落到服务端共享层 |
| **用户面「扩展」面板** | 普通用户（无账号） | 仅对**未被根禁用**的扩展，为自己启用 / 禁用 | 用户 localStorage（个人偏好） |

- 用户面**看不到**被管理员根禁用的扩展；**不能**安装 / 更新 / 删除。
- 「某扩展对当前用户是否生效」= `根启用(服务端) AND 用户个人启用(localStorage)`。默认用户启用态由扩展清单的默认值决定（建议默认启用）。
- 非纯前端能力受限：用户扩展偏好不落服务端，跨设备不同步；需要服务端态的扩展能力由管理员在��装时把控。

#### B.2 路由与入口

- `/manage`：**独立管理页**，用户面**无任何入口链接**（仅靠手输 URL 进入）。进入需管理员登录（`.env` 凭据）。扩展管理是其**子模块**，页面结构需为未来管理功能（用户/会话治理、全局配置、用量统计等）预留可扩展的导航。
- 用户面：在**「绕过机制(Bypass)」图标与「设置」图标之间**新增「扩展」入口按钮，打开删减版扩展面板（无安装/更新/删除）。

#### B.3 关键架构结论：需要后端组件 ⚠️

`/manage` 的两项核心能力——**管理员密码校验**、**扩展安装/更新（写文件/解包/可能 git）**——纯 nginx 静态托管无法实现。当前部署是「`node:20` 构建 → `nginx:1.27` 静态托管 + 反代」，**无运行时后端**。引入扩展管理必然要加一个最小后端服务（见决策 B′）。

> 用户面（聊天、渲染、正则、个人扩展启停）仍是纯前端 + localStorage，**不依赖**该后端在线——后端只服务于 `/manage` 与「拉取共享扩展清单/资源」。

#### 决策 B′：后端形态 ✅ 已定 = B′-1 Node 边车容器

新增一个 Node 服务容器，与现有 app(nginx) 容器并列于 docker-compose：

- **职责**：管理员密码校验(`.env`) + 扩展存储读写 + 共享清单 API + 安装/更新/删除 + 扩展静态资源服务。
- **存储**：docker named volume（或绑定挂载）持有扩展本体文件 + 共享清单 JSON，跨镜像重建存活（参照现有 `image-cache` 卷模式）。
- **接线**：nginx 反代 `/manage/api/*`（管理 API）与 `/ext/*`（扩展静态资源 js/css）到该 Node 容器；与现有 `nginx → MCP` 反代模式一致。
- **隔离**：用户面（聊天/渲染/正则/个人启停）不依赖该容器在线；它只服务 `/manage` 与共享清单/资源拉取。
- **凭据**：管理员账号密码存 `.env`（如 `MANAGE_ADMIN_USER` / `MANAGE_ADMIN_PASS`），经 env_file 注入 Node 容器，**不**进前端 bundle、**不**经 nginx envsubst（仅 `^MCP_` 过滤，需新增过滤或直接由 Node 读 env）。

候选淘汰：B′-2 openresty+Lua（用 nginx 做文件管理别扭）、B′-3 复用 MCP（跨主机存扩展文件不便、职责耦合）。

#### 决策 B′ 后续子问题（P3a 实施时细化，非顶层决策）

- 会话机制：cookie（HttpOnly）vs JWT —— 倾向 HttpOnly cookie（同源、简单）。
- 安装来源优先级：先 **上传 zip 解包**（最可控）→ 再 **远程 URL / git**。
- 扩展目录布局：`<volume>/extensions/<id>/{manifest.json, dist/...}` + `<volume>/registry.json`。

---

### 决策 C（原 B 候选，降级为 B′ 的子选项参考）

安装来源仍可在 B′-1 后端内按需支持：上传 zip 解包、远程 URL 拉取、git clone。这些现在归入 P3 实施细节，不再是顶层决策。

---

## 6. 数据模型草案

```ts
// 正则脚本（兼容 ST 角色卡 data.extensions.regex_scripts）
interface RegexScript {
  id: string;
  scriptName: string;
  findRegex: string;            // 支持 /pattern/flags
  replaceString: string;        // {{match}} $1 $<name> {{macro}}
  trimStrings: string[];
  placement: number[];          // 1=USER_INPUT 2=AI_OUTPUT 3=SLASH 5=WORLD_INFO 6=REASONING
  disabled: boolean;
  markdownOnly: boolean;        // 仅显示
  promptOnly: boolean;          // 仅 prompt
  runOnEdit: boolean;
  substituteRegex: 0 | 1 | 2;   // NONE | RAW | ESCAPED
  minDepth: number | null;
  maxDepth: number | null;
}

// 扩展登记（服务端共享清单中的一条）
interface SharedExtension {
  id: string;                   // 目录名 / repo 名
  manifest: ExtensionManifest;  // display_name/loading_order/js/css/requires/...
  source: 'uploaded' | 'remote-url' | 'git';
  sourceRef?: string;           // URL / git 地址 / 上传包标识
  rootEnabled: boolean;         // 管理员「根开关」。false=对所有用户隐藏且不加载
  defaultUserEnabled: boolean;  // 用户首次见到时的默认启停（建议 true）
  installedVersion: string;
  installedAt: number;
  updatedAt: number;
}

// 用户个人偏好（localStorage，不落服务端）
interface UserExtensionPrefs {
  // key = 扩展 id；value = 该用户是否为自己启用。缺省时取 defaultUserEnabled
  [extensionId: string]: boolean;
}

// 生效判定：rootEnabled && (userPrefs[id] ?? defaultUserEnabled)

// Message 需要补充（供渲染器反查楼层）
interface Message {
  // ...existing
  mesid?: number;               // 楼层号（在 chat 数组中的 index）
  isSystem?: boolean;
}
```

---

## 7. 实施阶段（与任务清单对应）

- **P0 调研 & 设计**（本文档）— 进行中
- **P1 兼容层地基**：消息逃逸区 + eventBus + getContext shim + 宏引擎 + 全局
- **P2 正则模块**：数据模型 + 存储 + getRegexedString 双管线 + 接入显示/prompt
- **P3 扩展系统（按双层权限模型）**，拆分：
  - **P3a 后端服务（决策 B′）**：管理员密码校验(.env) + 扩展存储 + 共享清单 API + 安装/更新/删除 + 扩展静态资源服务；docker-compose / nginx 反代接线。
  - **P3b 管理页 `/manage`**：独立路由 + 管理员登录 + 可扩展导航骨架 + 扩展管理子模块 UI（安装/更新/删除/根启停）。用户面无入口。
  - **P3c 用户扩展面板**：Bypass 与设置之间的入口按钮 + 删减版面板（仅列出根启用扩展、个人启停存 localStorage）。
  - **P3d 加载器**：按 loading_order 升序注入根启用且用户启用的扩展 js/css；生效判定 `rootEnabled && (userPref ?? default)`。
- **P4 渲染器（核心）**：HTML 卡检测 + 同源 iframe + bridge 注入 + 高度自适应 + TavernHelper 渲染所需 API
- **P5 JS-Slash-Runner 端到端**：按决策 A 落地 + generate 接真实 LLM + 变量系统 + 验证真实前端卡

依赖关系：P1 → (P2 ‖ P4)；P4 依赖 P1 的 eventBus/getContext；P3a 待决策 B′ 拍板，P3a → P3b/P3d，P3c 依赖 P3a 的清单 API + P1；P5 依赖 P1+P4（+ 正则可选）。
