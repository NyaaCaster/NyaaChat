# NyaaChat 扩展运行宿主补充开发计划（nyaachat-ext-host）

> 本文件是 NyaaChat 后续「类 SillyTavern 扩展运行宿主」工作的可跟踪计划。
> 目标是在**不支持运行时安装 / 更新 / 删除扩展**的前提下，让通过 git + rebuild 内置进项目的 SillyTavern 扩展获得足够的前端宿主与轻量后端能力。
>
> 创建：2026-06-14
> 状态：P6 完成；扩展运行宿主补充计划阶段性收口

---

## 0. 背景与边界

NyaaChat 已完成第一阶段 SillyTavern 兼容工作：扩展 registry、静态扩展加载、ST 目录深度 serving、部分 ESM shim、`SillyTavern.getContext()`、事件总线、变量、slash 子集、正则兼容等。

但当前能力仍是「扩展加载器 + 高频 shim」，还不是「完整 ST 扩展运行宿主」。后续支持目标通过两类第三方扩展样本考察通用宿主缺口，但样本扩展不得被写死进 NyaaChat / `nyaachat-ext-host`：

- `JS-Slash-Runner`：大型前端 UI、渲染器、脚本库、TavernHelper/常用 ST shim 深依赖。
- `st-Quote-TTS`：轻量 jQuery 设置面板、消息 DOM 扫描、后端 TTS proxy。

它们只用于发现共同需要的 ST 通用宿主能力：

- 类 ST 的扩展设置 UI 宿主（如 `#extensions_settings`）。
- 可持久化的 `extension_settings` / `chat_metadata` / 角色扩展字段。
- 更完整的 ST 模块导出面（按真实缺口补 shim）。
- 若干扩展运行时 API（但不包括安装、更新、删除）。

本计划补的是**扩展运行环境**，不是扩展治理系统。

---

## 1. 目标

让 NyaaChat 能够运行通过 git/rebuild 内置的 ST 扩展。开发期以 JS-Slash-Runner 这类大型前端/渲染器扩展，以及 st-Quote-TTS 这类轻量设置面板 + 消息 DOM + 后端代理扩展作为考察样本，反推出通用 ST 宿主能力；不得把任一扩展的代码、私有数据结构、默认 endpoint、扩展 ID 特判或业务逻辑写入 NyaaChat / `nyaachat-ext-host`。memory/prompt 注入类扩展不纳入本阶段核心目标。

具体目标：

1. 新增轻量 Node sidecar：`nyaachat-ext-host`。
2. 保持现有 NyaaChat MCP 功能不变，不复用、不迁移、不改造当前 MCP 服务。
3. 保持扩展安装 / 更新 / 删除由 git + rebuild 治理，不提供运行时管理 API。
4. 将 NyaaChat 的「扩展」界面补全为类 ST 扩展前端宿主：能显示扩展列表、启停扩展、显示扩展自己的设置 UI。
5. 支持用户在前端导入 / 编辑 / 保存扩展自定义数据（例如 JSR 自定义脚本），默认落浏览器本地存储；必要的共享运行时状态由 `nyaachat-ext-host` 提供薄 API。
6. 以 JS-Slash-Runner 与 st-Quote-TTS 组成开发期考察样本矩阵：前者覆盖大型前端 UI / 渲染器 / 用户脚本，后者覆盖轻量设置 UI / 消息 DOM 扫描 / TTS proxy；最终验收必须先在 0 扩展部署状态确认宿主正常，再通过 git clone 到扩展目录 + rebuild 验证扩展工作。

---

## 2. 非目标

明确不做：

- 不支持运行时安装扩展。
- 不支持运行时更新扩展。
- 不支持运行时删除扩展。
- 不实现 ST 的完整账号 / 用户隔离 / 多用户服务端存档模型。
- 不复刻完整 SillyTavern 后端。
- 不改动现有 NyaaChat MCP 架构；MCP 仍只服务 LLM 工具链。
- 不把任何具体扩展的功能内置重写进 NyaaChat；扩展内容由扩展本体提供，宿主只提供通用 ST 兼容契约。
- 不支持 memory/prompt 注入类 ST 扩展作为本阶段核心目标，例如深度改写 `CHAT_COMPLETION_PROMPT_READY`、注册复杂宏、读写大量消息级扩展字段的扩展。此类扩展会触及 NyaaChat prompt builder 与信任边界，需未来另立「受控 prompt bridge」计划。

---

## 3. 总体架构

```text
browser
  ├─ NyaaChat React app
  ├─ ST compat frontend layer
  ├─ Extension UI host (#extensions_settings)
  └─ operator-managed ST extensions (optional; installed by git clone + rebuild)

nginx app container
  ├─ serve dist/
  ├─ serve /extensions/*
  ├─ serve ST-depth alias /scripts/extensions/third-party/*
  ├─ serve static ESM shim modules (/script.js, /scripts/*.js)
  ├─ proxy /api/mcp              → existing NyaaChat-MCP (unchanged)
  └─ proxy /api/ext-host/*       → nyaachat-ext-host

nyaachat-ext-host (new Node sidecar)
  ├─ ST-like extension runtime APIs
  ├─ optional shared extension runtime metadata
  ├─ extension field write/read bridge
  ├─ health/status endpoint
  └─ no install/update/delete endpoints
```

### 3.1 为什么使用 Node sidecar，而不是 MCP

MCP 是 LLM tool protocol，适合模型调用工具；ST 扩展运行时需要的是浏览器可直接 `fetch()` 的 Web API、静态资源路径、设置读写与 DOM/事件配合。

因此：

- `nyaachat-ext-host` 用 Node.js（建议 Fastify 或 Express）实现普通 HTTP API。
- 现有 MCP 服务保持不变。
- 未来如扩展需要调用 MCP 工具，可由前端或 `nyaachat-ext-host` 作为桥接方按需调用，但 MCP 不作为扩展宿主主体。

---

## 4. 数据与用户隔离策略

NyaaChat 当前没有服务端用户账号；用户配置主要存在浏览器 localStorage。扩展运行宿主应保持这一原则。

| 数据类型 | 默认存储 | 说明 |
|---|---|---|
| 扩展本体文件 | git + 镜像 | `public/extensions/<id>/`，运营方 rebuild 分发 |
| rootEnabled / defaultUserEnabled | git + registry | 仓库治理 |
| 用户启停偏好 | localStorage | 当前已有 `nyaachat_ext_prefs` |
| `extension_settings` | localStorage / IndexedDB 优先 | 扩展自定义脚本、渲染器设置等用户私有数据 |
| 大型脚本库 | IndexedDB 优先 | 避免 localStorage 容量限制 |
| `chat_metadata` | 当前会话 / localStorage | 与 NyaaChat session 绑定 |
| message variables | `Message.variables` | 已有基础 |
| 角色扩展字段 | `settings.characters[].extensions` 或映射字段 | 仍随用户 localStorage 设置走 |
| 服务端共享运行态 | `nyaachat-ext-host` 可选 | 仅放无用户隔离也安全的共享信息 |

原则：扩展自定义脚本属于用户定制化数据，应保存在用户浏览器侧；不要求服务端按用户保存。

---

## 5. 前端宿主补充

### 5.1 类 ST 扩展设置容器

新增稳定 DOM 容器：

- `#extensions_settings`
- 必须在扩展脚本加载前存在。
- 不应随 modal 开关销毁；可以常驻隐藏，Modal 只负责显示其内容。
- 扩展可以向其中 append 自己的根节点。

### 5.2 扩展面板改造

当前 `ExtensionsModal` 只有列表和启停。目标形态：

- 顶部 / 左侧：扩展列表、启停、状态、刷新提示。
- 主区域：扩展设置 UI 宿主（`#extensions_settings` 的可视区域）。
- 去掉安装 / 更新 / 删除。
- 保留「启停变更需刷新」提示。
- 若启用第三方前端卡渲染扩展，提示关闭 NyaaChat 自带前端渲染，避免双渲染。

### 5.3 扩展加载顺序

加载前置条件：

1. 安装 `window.SillyTavern`、`window.__NYAA_COMPAT__`。
2. 安装 `extension_settings` 持久化桥。
3. 创建 `#extensions_settings`。
4. 创建/同步必要 ST DOM 兼容节点。
5. 注入扩展 CSS / JS。

---

## 6. Node sidecar：nyaachat-ext-host

### 6.1 职责

`nyaachat-ext-host` 只提供扩展**运行时**所需服务，不提供扩展生命周期治理。

建议职责：

- 健康检查。
- 返回扩展运行宿主状态。
- 可选：保存/读取共享 extension runtime metadata。
- 可选：提供 extension field 写入接口，用于前端桥接角色 / 聊天扩展字段。
- 可选：提供受控资源 proxy 或临时文件接口（仅在具体扩展需要时补）。
- 提供 ST-compatible 受控 TTS / voice proxy，避免浏览器扩展变成任意 URL 开放代理。

### 6.2 API 草案

```http
GET  /api/ext-host/health
GET  /api/ext-host/status
GET  /api/ext-host/runtime-metadata
PUT  /api/ext-host/runtime-metadata
POST /api/ext-host/extension-field
POST /api/openai/custom/generate-voice
```

保留但明确不实现：

```http
POST /api/extensions/install   -> 501 operator-managed
POST /api/extensions/update    -> 501 operator-managed
POST /api/extensions/delete    -> 501 operator-managed
```

`POST /api/openai/custom/generate-voice` 是 ST-compatible 通用 voice proxy。该接口必须使用服务端白名单或 preset 映射约束目标 endpoint；不得信任扩展传入的任意 `provider_endpoint` 直接转发，也不得内置任何具体扩展的 endpoint、voice、model 或私有参数默认值。

#### 受控白名单来源：扩展声明 + rebuild 聚合（2026-06-16）

为避免"每装一个有出站网络需求的扩展都要手动配 env"导致扩展管理失去意义，白名单改为由**已安装扩展静态声明、rebuild 时自动聚合**，ext-host 代码仍保持扩展无关（不内置任何具体扩展 endpoint）：

- 声明位置（两者取并集）：
  - 扩展上游 `manifest.json` 的 `network_endpoints: string[]`（扩展作者声明，随 `auto_update` 自动带下来，装好即用，零配置）。
  - 运营方 `public/extensions/registry.overrides.json` 中按扩展 id 的 `network_endpoints`（用于无法改上游的第三方扩展；集中、入库、**不触碰扩展目录**、不被 auto_update 覆盖）。
- `scripts/generate-extension-registry.mjs` 在 rebuild 前扫描全部 manifest + overrides，URL 规范化（清 hash）+ 去重，写出 `ext-host/network-allowlist.generated.json`（git-ignored 生成产物，0 声明则空数组）。
- `ext-host/Dockerfile` 在 build 时 `COPY` 该文件；`server.js` 启动读取并并入 `allowedTtsEndpoints`，与 `TTS_DEFAULT_ENDPOINT`/`TTS_PRESETS`/`TTS_ALLOWED_ENDPOINTS` 等运营级 env 覆盖层取并集。
- 信任边界不变：声明是静态、本地、可审阅的（安装即 git clone + rebuild + code review）；运行时 ext-host 仍**只转发到聚合白名单内**的地址，未声明地址照拒，SSRF 防护完整保留。

实际是否需要暴露这些 501 endpoint，按扩展调用情况决定；默认不主动添加。

### 6.3 Docker / nginx 接线

新增 compose 服务：

```yaml
ext-host:
  build: ./ext-host
  restart: unless-stopped
  environment:
    - TZ=Asia/Shanghai
```

nginx 新增：

```nginx
location /api/ext-host/ {
    proxy_pass http://ext-host:PORT/;
}
```

现有 `/api/mcp`、MCP 相关环境变量和服务不动。

---

## 7. ST shim 补全策略

不盲目复刻 ST 全量导出。以真实扩展运行缺口为驱动，但只沉淀通用 ST 宿主能力，不沉淀扩展专属逻辑：

1. 先在 0 扩展状态完成宿主开发与 rebuild 验证，确认 NyaaChat 无扩展也能正常运行。
2. 再由运营方通过 git clone 将考察样本放入 `public/extensions/<id>/`，配套 registry 后 rebuild。
3. 浏览器加载样本扩展，记录：
   - missing module URL
   - missing named export
   - runtime `notImplemented()` 调用
   - DOM mount failure
4. 对每个缺口分类：
   - shim 纯前端可补；
   - localStorage/IndexedDB 可补；
   - 需要 `nyaachat-ext-host`；
   - 明确不支持。
5. 每轮只补一批高价值通用 API，并写入兼容表；若缺口只属于某个扩展私有实现，则标为扩展侧能力或不支持，不进入宿主。

---

## 8. 分阶段任务

### P0：审计与样本接入

- [x] 在开发环境以 git/rebuild 方式加入 JS-Slash-Runner 样本扩展。
- [x] 在开发环境以 git/rebuild 方式加入 st-Quote-TTS 样本扩展。
- [x] 确认两个样本的 manifest / CSS / JS 能被 loader 注入。
- [x] 记录首轮 missing module / missing export / runtime error / DOM mount failure。
- [x] 产出 `docs` 内兼容缺口表，按 JSR 型与 Quote-TTS 型分别归类。

验收：能稳定复现并记录两类样本扩展启动缺口，而不是盲补。

#### P0 接入记录（2026-06-14）

- 样本来源：`.ref/JS-Slash-Runner` 与 `.ref/st-Quote-TTS`。
- 治理边界：`public/extensions/` 下的第三方扩展子目录不属于 NyaaChat 主仓库；由运营方以独立 git 项目/子目录在部署环境中加入，并通过 rebuild 分发。NyaaChat 主仓库只保留宿主代码、shim、文档和 `public/extensions/registry.json`。
- 审计接入方式：本轮曾临时复制样本到 `public/extensions/JS-Slash-Runner/` 与 `public/extensions/st-Quote-TTS/` 验证 manifest / asset 路径，审计后已从主仓库移除扩展本体，避免把第三方扩展发布包纳入 NyaaChat 源码。
- 默认状态建议：真实样本在部署 registry 中使用 `rootEnabled=true`、`defaultUserEnabled=false`，避免普通启动时直接触发大量未兼容 shim；审计时在扩展面板手动启用后刷新复现。
- 构建验证：`npm run build` 通过；manifest / CSS / JS 均会作为 public 静态资源进入 `dist/`。
- 首轮审计方式：对 JSR bundle 的静态 ESM import 与现有 `public/script.js`、`public/scripts/*.js` shim 导出做对照；对 Quote-TTS 读取入口依赖与 DOM/API 访问点。

#### 兼容缺口表（首轮）

| 样本 | 类型 | 触发点 / 现象 | 当前状态 | 分类 | 后续阶段 |
|---|---|---|---|---|---|
| JS-Slash-Runner | missing module | `../../../../../scripts/i18n.js` -> `/scripts/i18n.js` | 未提供 shim，模块加载会 404 / import 失败 | shim 纯前端可补 | P6 |
| JS-Slash-Runner | missing module | `/scripts/world-info.js` | 未提供世界书模块 shim | shim + 数据桥；完整写入暂不支持 | P6 / P5 |
| JS-Slash-Runner | missing module | `/scripts/extensions/regex/engine.js` | 现有正则实现只在 `src/compat`，未暴露 ST 深度模块 | shim 纯前端可补 | P6 |
| JS-Slash-Runner | missing module | `/scripts/preset-manager.js` | 未提供 preset manager shim | shim 桩；完整 preset 管理非 P0 | P6 |
| JS-Slash-Runner | missing module | `/scripts/openai.js` | 未提供 OpenAI/promptManager 相关导出 | prompt / generation 深依赖；需谨慎桩化 | P6，prompt 注入类能力不扩大 |
| JS-Slash-Runner | missing module | `/scripts/macros.js`、`/scripts/RossAscends-mods.js`、`/scripts/power-user.js`、`/scripts/user.js`、`/scripts/authors-note.js`、`/scripts/PromptManager.js`、`/scripts/sse-stream.js`、`/scripts/tokenizers.js` | 未提供 shim | 多数可先用只读常量 / no-op / 轻量函数桩 | P6 |
| JS-Slash-Runner | missing module | `/scripts/slash-commands/SlashCommandArgument.js`、`SlashCommandCommonEnumsProvider.js`、`SlashCommandEnumValue.js` | 当前只提供 `SlashCommand.js` 与 `SlashCommandParser.js` | slash 参数元数据 shim | P6 |
| JS-Slash-Runner | missing export | `/scripts/utils.js` 缺 `getImageSizeFromDataURL`、`ensureImageFormatSupported`、`isDataURL`、`Stopwatch`、`showFontAwesomePicker`、`getSanitizedFilename` | import 会因 named export 不存在失败 | shim 纯前端可补 | P6 |
| JS-Slash-Runner | missing export | `/script.js` 缺 `reloadMarkdownProcessor`、`getThumbnailUrl`、`user_avatar`、`clearChat`、`printMessages`、`saveSettings`、`is_send_press`、`getPastCharacterChats`、`system_avatar`、`default_avatar`、`showSwipeButtons`、`saveMetadata`、`saveCharacterDebounced`、`getOneCharacter`、`selectCharacterById`、`printCharacters`、`unshallowCharacter`、`deleteCharacter`、`getCharacters`、`scrollChatToBottom`、`system_message_types`、`activateSendButtons`、`setGenerationProgress`、`extension_prompts`、`baseChatReplace`、`getCharacterCardFields`、`getBiasStrings`、`getExtensionPromptRoleByName`、`getMaxContextSize`、`getExtensionPromptByName`、`cleanUpMessage`、`isOdd`、`countOccurrences`、`stopGeneration`、`deactivateSendButtons`、`main_api`、`online_status`、`Generate` | import 会因 named export 不存在失败 | 纯前端 shim + generation/metadata 桥分层 | P6 / P5 |
| JS-Slash-Runner | missing export | `/scripts/extensions.js` 缺 `saveMetadataDebounced` | import 会因 named export 不存在失败 | shim 纯前端可补；实际持久化属 metadata 桥 | P6 / P5 |
| JS-Slash-Runner | DOM mount failure | bundle 末尾执行 ` $('<div id="tavern_helper">').appendTo('#extensions_settings'); G0.mount(e[0])` | 当前 NyaaChat 没有常驻 `#extensions_settings`，且 parent window 未提供 jQuery；即使 import 补齐也无法挂载设置 UI | DOM 宿主 + jQuery 全局 | P2 |
| JS-Slash-Runner | runtime error | 依赖 `globalThis.YAML`、`globalThis.z`、Vue app 与 JSON editor；`../lib/jsoneditor.js` 需从扩展目录正确 served | `jsoneditor.js` 已随样本复制；其它全局需实机加载后继续确认 | 运行时全局 / 静态资源 | P6 |
| st-Quote-TTS | missing module/export | `../../../extensions.js`、`../../../../script.js` 的当前导出足以满足入口静态 import：`extension_settings`、`getContext`、`saveSettingsDebounced`、`getRequestHeaders`、`eventSource`、`event_types` | 静态 import 层暂无缺口 | 已覆盖 | P0 完成 |
| st-Quote-TTS | DOM mount failure | 初始化轮询 `#extensions_settings`，再 `$.get('scripts/extensions/third-party/st-Quote-TTS/settings.html')` 并 append | 当前缺 `#extensions_settings` 与 parent window jQuery；设置面板不会加载 | DOM 宿主 + jQuery 全局 | P2 |
| st-Quote-TTS | DOM mount failure | 扫描 `#chat .mes_text`、`.mes_block .name_text` 并注入 `.quote-tts-btn` | 当前 React 消息 DOM 未提供 ST 形状逃逸区；按钮无法注入 | ST DOM 兼容区 | P3 |
| st-Quote-TTS | runtime/API error | 播放调用 `POST /api/openai/custom/generate-voice`，body 带 `provider_endpoint`、`api_key`、`token` | 当前 nginx/app 没有该接口；未来必须受控代理，不得任意转发扩展传入 endpoint | 需要 `nyaachat-ext-host` | P4 |
| st-Quote-TTS | persistence gap | 写 `extension_settings.quote_tts.characterMap` 后调用 `saveSettingsDebounced()` | 当前 `extension_settings` 仍内存对象，刷新丢失 | localStorage / IndexedDB | P1 |


### P1：extension_settings 本地持久化

- [x] `extension_settings` 从内存对象改为 localStorage/IndexedDB backed store。
- [x] `saveSettingsDebounced()` 真正持久化。
- [x] 页面刷新后扩展设置不丢。
- [x] 预留大对象迁移到 IndexedDB 的接口。

验收：JSR 写入的基础设置、st-Quote-TTS 写入的 `extension_settings.quote_tts` 音色映射可刷新保留。

#### P1 实施记录（2026-06-14）

- 新增 `src/compat/extensionSettings.ts`，以 `nyaachat_extension_settings` localStorage key 作为同步主存储，并在模块初始化时原地恢复稳定的 `extension_settings` 对象。
- `src/compat/stContext.ts` 的 `saveSettingsDebounced()` 默认接入本地持久化；扩展脚本持有的对象引用不变，嵌套写入后调用保存即可落盘。
- 预留 `loadExtensionSettingsFromIndexedDb()` / `saveExtensionSettingsToIndexedDb()`，后续可把大型脚本库迁移到 IndexedDB，而不改变 ST 兼容 API 面。
- 构建验证：`npm run build` 通过；Vite 仍提示主 chunk 超过 500 kB（既有体积告警，不影响本阶段）。

### P2：类 ST 扩展设置 UI 宿主

- [x] 创建常驻 `#extensions_settings`。
- [x] 改造 `ExtensionsModal`，显示扩展列表 + 扩展设置区域。
- [x] 确保扩展 append 到 `#extensions_settings` 的 UI 能显示。
- [x] 不提供安装 / 更新 / 删除。

验收：JSR 的 `#tavern_helper` 根节点能挂载并在 NyaaChat 扩展面板中可见；st-Quote-TTS 的 `settings.html` 能 append 到 `#extensions_settings` 并可交互。

#### P2 实施记录（2026-06-14）

- 新增稳定 DOM 宿主 `src/compat/extensions/settingsHost.ts`，在扩展加载前创建 `#extensions_settings`，关闭面板时停泊到 React 外部隐藏容器，避免扩展自有 DOM 被卸载。
- 改造 `ExtensionsModal` 为左侧扩展启停列表 + 右侧扩展设置区域；启停仍只写 `nyaachat_ext_prefs`，不提供安装 / 更新 / 删除。
- 父窗口新增最小 jQuery-like 全局 `$` / `jQuery`，覆盖 P2 设置面板所需的 ready、选择器、`$.get()`、append/appendTo、事件绑定与表单读写路径。
- 构建验证：`npm run build` 通过；Vite 仍提示主 chunk 超过 500 kB（既有体积告警，不影响本阶段）。

### P3：ST DOM / 事件兼容补强

- [x] 补 `#chat` / `.mes` / `.mes_text` / `.name_text` / `mesid` 结构或等价逃逸区。
- [x] 保证 JSR 渲染器能扫描前端卡代码块。
- [x] 保证 st-Quote-TTS 能扫描消息文本、角色名与当前聊天 DOM，并能在目标文本旁注入按钮。
- [x] 对 React 受控 DOM 与扩展 jQuery 操作划边界。
- [x] 补齐 JSR / st-Quote-TTS 依赖的消息渲染事件与 payload（如 `MESSAGE_RECEIVED` / `CHARACTER_MESSAGE_RENDERED` / `CHAT_CHANGED` 的等价触发）。

验收：关闭 NyaaChat 自带前端渲染后，JSR 渲染器能接管至少一个前端卡样例；st-Quote-TTS 能在带引号消息中注入播放按钮。

#### P3 实施记录（2026-06-14）

- 在聊天滚动主区域补稳定 `#chat`，每条消息补 ST 风格 `.mes`、`mesid`、`data-mesid`、用户消息 `is_user`、消息块 `.mes_block`、消息正文 `.mes_text` 与角色名 `.name_text`，让扩展可按 ST 选择器扫描当前聊天。
- 将 `.mes_text` 限定为扩展可装饰的逃逸区；React 仍是消息状态的单一写入者，扩展按钮/HTML 注入只作用于渲染后的正文 DOM，不回写消息源文本。
- 聊天消息提交、接收、编辑、删除、会话/角色切换后补发 ST 等价事件：`MESSAGE_SENT`、`MESSAGE_RECEIVED`、`USER_MESSAGE_RENDERED`、`CHARACTER_MESSAGE_RENDERED`、`MESSAGE_UPDATED`、`MESSAGE_DELETED`、`CHAT_CHANGED` 与 `chatLoaded`。
- `CHARACTER_MESSAGE_RENDERED` 与 `MESSAGE_RECEIVED` payload 按 ST 常用形态补齐 `(mesid, "normal")`，满足 JSR 渲染监听与 st-Quote-TTS 消息扫描触发。
- 扩展父窗口 jQuery-lite 增加 context selector、`filter()`、`first()`、`last()`、`toArray()`，覆盖 JSR `$('#chat > .mes')` / `$(selector, window.parent.document)` 与 Quote-TTS 设置/扫描路径的常用调用。
- 构建验证：`npm run build` 通过；Vite 仍提示主 chunk 超过 500 kB（既有体积告警，不影响本阶段）。

### P4：新增 `nyaachat-ext-host`

- [x] 新建 Node sidecar 项目目录。
- [x] 实现 health/status API。
- [x] 实现受控 `POST /api/openai/custom/generate-voice` TTS proxy。
- [x] docker-compose 增加 `ext-host` 服务。
- [x] nginx 增加 `/api/ext-host/` 反代。
- [x] nginx 为 `/api/openai/custom/generate-voice` 接到 `ext-host` 或等价后端路径。
- [x] 保证现有 MCP 路径不变。

验收：rebuild 后，0 扩展部署状态下 `nyaachat-ext-host` 容器启动，`/api/ext-host/health` 返回 OK，NyaaChat 与 MCP 功能不受影响；随后通过 git clone 安装第三方扩展到扩展目录并 rebuild，验证其 TTS 请求只能经白名单 / preset 受控转发。

#### P4 实施记录（2026-06-14）

- 新增 `ext-host/` 轻量 Node sidecar，默认监听容器内 `3099`，只通过 nginx 同源反代暴露给浏览器，不映射宿主机端口。
- 实现通用扩展宿主 API：`GET /health`、`GET /status`、`GET/PUT /runtime-metadata`、`POST /extension-field` 与 ST-compatible `POST /openai/custom/generate-voice`。
- `generate-voice` 仅作为通用受控 voice proxy：endpoint 必须来自 `TTS_DEFAULT_ENDPOINT`、`TTS_PRESETS` 或 `TTS_ALLOWED_ENDPOINTS`；请求体只剥离 `provider` / `provider_endpoint` / `api_key` / `token` 控制字段，其余字段原样转发，不内置任何扩展专属 endpoint / model / voice / 默认参数。
- `docker-compose.yml` 增加 `ext-host` 服务，`app` 通过 `depends_on` 等待 sidecar 启动；`nginx.conf` 增加 `/api/ext-host/` 与 `/api/openai/custom/generate-voice` 反代，现有 `/api/mcp` 与 `/api/mcp/health` 路径不变。
- 新增 `scripts/generate-extension-registry.mjs`，并接入 `npm run build`、`rebuild.ps1`、`rebuild.sh`：rebuild 前自动按 `public/extensions/*/manifest.json` 生成 `public/extensions/registry.json`，0 扩展状态生成空清单。
- 更新 `rebuild` skill，明确安装 / 更新 / 删除第三方扩展目录后通过 rebuild 自动刷新 registry。
- 验证：`node --check ext-host/src/server.js` 通过；`npm run lint` 通过但保留既有 `src/components/ChatInterface.tsx:612` hooks warning；`npm run build` 通过（仍有既有 chunk size warning）；`docker compose config` 通过；`powershell -ExecutionPolicy Bypass -File .\rebuild.ps1` 成功构建并启动 `nyaachat-app-1` 与 `nyaachat-ext-host-1`。
- 运行验证：`http://localhost:3095/api/ext-host/health` 返回 `{"ok":true,"service":"nyaachat-ext-host"}`；`/api/ext-host/status` 返回 sidecar 状态且 TTS 未配置时 `configured=false`；`/extensions/registry.json` 返回 0 扩展空清单；`/api/mcp/health` 返回现有 MCP 健康状态。

### P5：扩展字段与 metadata 桥

- [x] 设计 `writeExtensionField` 到 NyaaChat 用户本地角色/聊天设置的映射。
- [x] 接通 JSR `predefine.js` 期望的 `writeExtensionField`。
- [x] 支持角色脚本绑定和角色脚本变量的最小持久化。

验收：JSR 脚本绑定类设置能在刷新后保留。

#### P5 实施记录（2026-06-14）

- 新增 `src/compat/metadataBridge.ts`，把 ST 的 `character.data.extensions` 映射到 NyaaChat `CharacterSettings.extensions`，并通过 `setExtensionFieldWriter()` 让 compat 层把写入意图回交给 React/`onSettingsChange`，继续由浏览器本地设置持久化。
- `window.SillyTavern.getContext()` 现在返回由当前角色列表生成的 ST-like character 对象，包含 `data.extensions`、顶层 `extensions` 与 `json_data`，并提供 `writeExtensionField`、`saveMetadata`、`saveMetadataDebounced`。
- `/scripts/extensions.js` 的 `writeExtensionField()` 不再是 no-op，改为转发到宿主桥；同步导出 ST sentinel `UNSET_VALUE`。`/script.js` 也补出 `saveMetadata*` 与 `UNSET_EXTENSION_FIELD` 便于 ESM import shim 使用。
- `chat_metadata` 增加按会话 scoped 的 localStorage backing，并在保存聊天记录时写入 `ChatSession.metadata`；会话切换时恢复对应 metadata，未保存草稿使用 `__draft__` scope。
- `src/compat/variables.ts` 的 `character` scope 从内存占位升级为写入当前角色的 `TavernHelper_characterScriptVariables` 扩展字段，覆盖角色脚本变量的最小持久化路径；`preset` scope 仍为内存占位，留到 P6/后续按真实缺口扩展。
- 验证：`npm run lint` 通过，仅保留既有 `src/components/ChatInterface.tsx:634` hooks warning；`npm run build` 通过，仍有既有主 chunk > 500 kB 告警。

### P6：JSR shim 缺口迭代

- [x] 按 P0 缺口补 `/script.js` 导出。
- [x] 补 `@sillytavern/scripts/openai` / promptManager 必要桩或等价实现。
- [x] 补 slash argument 相关模块。
- [x] 补 JSR 脚本管理 UI 运行所需的最小 API。

验收：JSR 设置界面、渲染器设置、用户脚本列表、基础脚本执行路径可用。

#### P6 实施记录（2026-06-14）

- `/script.js` 补齐 JSR `dist/index.js` 静态 import 所需的 UI / 聊天生命周期 / 角色 / prompt 查询类导出：`reloadMarkdownProcessor`、头像常量、`clearChat`、`printMessages`、`saveSettings`、`saveCharacterDebounced`、`scrollChatToBottom`、`extension_prompts`、`Generate` 等；写入/删除类高风险能力保持 warn-once 或 no-op，不扩大宿主治理面。
- 新增 JSR import 图所需的静态 shim 模块：`i18n.js`、`world-info.js`、`preset-manager.js`、`openai.js`、`PromptManager.js`、`macros.js`、`RossAscends-mods.js`、`power-user.js`、`user.js`、`authors-note.js`、`sse-stream.js`、`tokenizers.js` 与 `/scripts/extensions/regex/engine.js`。
- `openai.js` / `PromptManager.js` 仅提供容器、模型名、消息集合与 inert request helpers；不把第三方扩展 promptManager 接入 NyaaChat 主对话 prompt builder，保持动态提示词与外部文本的信任边界由 NyaaChat 自身请求构造层控制。
- 补 slash argument 元数据模块：`SlashCommandArgument.js`、`SlashCommandEnumValue.js`、`SlashCommandCommonEnumsProvider.js`，满足 JSR 注册命令时的参数描述、枚举、自动补全元数据 import；实际执行仍走现有 `src/compat/slash` 子集。
- `utils.js` 补 `isDataURL`、`getImageSizeFromDataURL`、`ensureImageFormatSupported`、`Stopwatch`、`showFontAwesomePicker`、`getSanitizedFilename`；`extensions.js` 补 `saveMetadataDebounced` re-export；`slash-commands.js` 接收 options 参数但仍委托现有执行器。
- 验证：以 `.ref/JS-Slash-Runner/dist/index.js` 静态 import 图对照 `public/` shim，所有相对 ST 模块与 named export 均已覆盖；`npm run build` 通过（仍有既有主 chunk > 500 kB 告警）；`npm run lint` 通过，仅保留既有 `src/components/ChatInterface.tsx:634` hooks warning。

---

## 9. 风险与约束

- JS-Slash-Runner 是大型扩展，完整功能面远大于当前 shim；必须按真实缺口迭代。
- TTS / voice proxy 会引入后端代理面；必须做 endpoint 白名单或 preset 映射，避免成为任意 URL 开放代理。
- 用户自定义脚本运行在浏览器，具备读取页面状态/localStorage 的能力；安全模型是用户信任自己导入的脚本。
- localStorage 容量有限，脚本库可能需要 IndexedDB。
- 没有账号系统，因此服务端不可保存用户私有脚本，除非未来引入用户隔离。
- React DOM 与扩展 jQuery/Vue DOM 操作存在天然冲突，需要明确扩展可操作区域。
- memory/prompt 注入类扩展暂不纳入本阶段，避免为兼容扩展破坏 NyaaChat prompt builder、缓存布局与信任边界。
- 任何具体扩展都只能作为考察样本；禁止在 NyaaChat / `nyaachat-ext-host` 中写扩展 ID 特判、扩展私有数据结构、扩展专属默认值、专属 endpoint 或内置扩展业务逻辑。

---

## 10. 当前决策

- 采用轻量 Node sidecar，服务名暂定 `nyaachat-ext-host`。
- 扩展治理继续使用 git + rebuild；基础宿主必须支持 0 扩展部署正常运行，第三方扩展通过 git clone 到 `public/extensions/<id>/` 后 rebuild 生效。
- JS-Slash-Runner 与 st-Quote-TTS 仅作为开发期通用能力考察样本，不作为内置扩展或专属适配目标；放弃 st-memory-enhancement 这类 memory/prompt 注入型扩展作为本阶段目标。
- 用户定制脚本和扩展设置优先存浏览器本地。
- ST-compatible TTS / voice proxy 由 `nyaachat-ext-host` 或等价后端路径受控提供，必须限制目标 endpoint，且不得内置任何扩展专属 endpoint / model / voice / 默认参数。
- MCP 不作为扩展运行宿主；现有 MCP 代码和部署不动。
- 前端渲染不是本计划主线；若启用第三方前端卡渲染扩展，应关闭 NyaaChat 自带前端渲染。
- 不要为了兼容扩展而破坏现有 NyaaChat MCP、聊天、正则、角色设置路径。
