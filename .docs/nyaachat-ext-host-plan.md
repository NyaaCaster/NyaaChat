# NyaaChat 扩展运行宿主补充开发计划（nyaachat-ext-host）

> 本文件是 NyaaChat 后续「类 SillyTavern 扩展运行宿主」工作的可跟踪计划。
> 目标是在**不支持运行时安装 / 更新 / 删除扩展**的前提下，让通过 git + rebuild 内置进项目的 SillyTavern 扩展获得足够的前端宿主与轻量后端能力。
>
> 创建：2026-06-14
> 状态：规划中

---

## 0. 背景与边界

NyaaChat 已完成第一阶段 SillyTavern 兼容工作：扩展 registry、静态扩展加载、ST 目录深度 serving、部分 ESM shim、`SillyTavern.getContext()`、事件总线、变量、slash 子集、正则兼容等。

但当前能力仍是「扩展加载器 + 高频 shim」，还不是「完整 ST 扩展运行宿主」。后续支持目标聚焦在两类扩展样本：

- `JS-Slash-Runner`：大型前端 UI、渲染器、脚本库、TavernHelper/常用 ST shim 深依赖。
- `st-Quote-TTS`：轻量 jQuery 设置面板、消息 DOM 扫描、后端 TTS proxy。

它们共同需要：

- 类 ST 的扩展设置 UI 宿主（如 `#extensions_settings`）。
- 可持久化的 `extension_settings` / `chat_metadata` / 角色扩展字段。
- 更完整的 ST 模块导出面（按真实缺口补 shim）。
- 若干扩展运行时 API（但不包括安装、更新、删除）。

本计划补的是**扩展运行环境**，不是扩展治理系统。

---

## 1. 目标

让 NyaaChat 能够运行通过 git/rebuild 内置的 ST 扩展，首批聚焦两类可控样本：JS-Slash-Runner 这类大型前端/渲染器扩展，以及 st-Quote-TTS 这类轻量设置面板 + 消息 DOM + 后端代理扩展。不把 JSR 代码重写进 NyaaChat，也不把 memory/prompt 注入类扩展纳入本阶段核心目标。

具体目标：

1. 新增轻量 Node sidecar：`nyaachat-ext-host`。
2. 保持现有 NyaaChat MCP 功能不变，不复用、不迁移、不改造当前 MCP 服务。
3. 保持扩展安装 / 更新 / 删除由 git + rebuild 治理，不提供运行时管理 API。
4. 将 NyaaChat 的「扩展」界面补全为类 ST 扩展前端宿主：能显示扩展列表、启停扩展、显示扩展自己的设置 UI。
5. 支持用户在前端导入 / 编辑 / 保存扩展自定义数据（例如 JSR 自定义脚本），默认落浏览器本地存储；必要的共享运行时状态由 `nyaachat-ext-host` 提供薄 API。
6. 以 JS-Slash-Runner 与 st-Quote-TTS 组成首批验收样本矩阵：前者覆盖大型前端 UI / 渲染器 / 用户脚本，后者覆盖轻量设置 UI / 消息 DOM 扫描 / TTS proxy。

---

## 2. 非目标

明确不做：

- 不支持运行时安装扩展。
- 不支持运行时更新扩展。
- 不支持运行时删除扩展。
- 不实现 ST 的完整账号 / 用户隔离 / 多用户服务端存档模型。
- 不复刻完整 SillyTavern 后端。
- 不改动现有 NyaaChat MCP 架构；MCP 仍只服务 LLM 工具链。
- 不把 JS-Slash-Runner 的功能内置重写进 NyaaChat；扩展内容由扩展本体提供。
- 不支持 memory/prompt 注入类 ST 扩展作为本阶段核心目标，例如深度改写 `CHAT_COMPLETION_PROMPT_READY`、注册复杂宏、读写大量消息级扩展字段的扩展。此类扩展会触及 NyaaChat prompt builder 与信任边界，需未来另立「受控 prompt bridge」计划。

---

## 3. 总体架构

```text
browser
  ├─ NyaaChat React app
  ├─ ST compat frontend layer
  ├─ Extension UI host (#extensions_settings)
  └─ bundled ST extensions (JS-Slash-Runner, st-Quote-TTS, etc.)

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
| `extension_settings` | localStorage / IndexedDB 优先 | JSR 自定义脚本、渲染器设置等用户私有数据 |
| 大型脚本库 | IndexedDB 优先 | 避免 localStorage 容量限制 |
| `chat_metadata` | 当前会话 / localStorage | 与 NyaaChat session 绑定 |
| message variables | `Message.variables` | 已有基础 |
| 角色扩展字段 | `settings.characters[].extensions` 或映射字段 | 仍随用户 localStorage 设置走 |
| 服务端共享运行态 | `nyaachat-ext-host` 可选 | 仅放无用户隔离也安全的共享信息 |

原则：JSR 用户自定义脚本属于用户定制化数据，应保存在用户浏览器侧；不要求服务端按用户保存。

---

## 5. 前端宿主补充

### 5.1 类 ST 扩展设置容器

新增稳定 DOM 容器：

- `#extensions_settings`
- 必须在扩展脚本加载前存在。
- 不应随 modal 开关销毁；可以常驻隐藏，Modal 只负责显示其内容。
- 扩展可以向其中 append 自己的根节点，例如 JSR 的 `#tavern_helper`。

### 5.2 扩展面板改造

当前 `ExtensionsModal` 只有列表和启停。目标形态：

- 顶部 / 左侧：扩展列表、启停、状态、刷新提示。
- 主区域：扩展设置 UI 宿主（`#extensions_settings` 的可视区域）。
- 去掉安装 / 更新 / 删除。
- 保留「启停变更需刷新」提示。
- 若启用 JS-Slash-Runner，提示关闭 NyaaChat 自带前端渲染，避免双渲染。

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
- 提供 st-Quote-TTS 需要的受控 TTS proxy，避免浏览器扩展变成任意 URL 开放代理。

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

`POST /api/openai/custom/generate-voice` 用于兼容 st-Quote-TTS 这类扩展。该接口必须使用服务端白名单或 preset 映射约束目标 endpoint；不得信任扩展传入的任意 `provider_endpoint` 直接转发。

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

不盲目复刻 ST 全量导出。以真实扩展运行缺口为驱动：

1. 把 JS-Slash-Runner 与 st-Quote-TTS 作为内置扩展样本加入本地 registry（仅开发分支/测试环境）。
2. 浏览器加载，记录：
   - missing module URL
   - missing named export
   - runtime `notImplemented()` 调用
   - DOM mount failure
3. 对每个缺口分类：
   - shim 纯前端可补；
   - localStorage/IndexedDB 可补；
   - 需要 `nyaachat-ext-host`；
   - 明确不支持。
4. 每轮只补一批高价值 API，并写入兼容表。

---

## 8. 分阶段任务

### P0：审计与样本接入

- [ ] 在开发环境以 git/rebuild 方式加入 JS-Slash-Runner 样本扩展。
- [ ] 在开发环境以 git/rebuild 方式加入 st-Quote-TTS 样本扩展。
- [ ] 确认两个样本的 manifest / CSS / JS 能被 loader 注入。
- [ ] 记录首轮 missing module / missing export / runtime error / DOM mount failure。
- [ ] 产出 `docs` 内兼容缺口表，按 JSR 型与 Quote-TTS 型分别归类。

验收：能稳定复现并记录两类样本扩展启动缺口，而不是盲补。

### P1：extension_settings 本地持久化

- [ ] `extension_settings` 从内存对象改为 localStorage/IndexedDB backed store。
- [ ] `saveSettingsDebounced()` 真正持久化。
- [ ] 页面刷新后扩展设置不丢。
- [ ] 预留大对象迁移到 IndexedDB 的接口。

验收：JSR 写入的基础设置、st-Quote-TTS 写入的 `extension_settings.quote_tts` 音色映射可刷新保留。

### P2：类 ST 扩展设置 UI 宿主

- [ ] 创建常驻 `#extensions_settings`。
- [ ] 改造 `ExtensionsModal`，显示扩展列表 + 扩展设置区域。
- [ ] 确保扩展 append 到 `#extensions_settings` 的 UI 能显示。
- [ ] 不提供安装 / 更新 / 删除。

验收：JSR 的 `#tavern_helper` 根节点能挂载并在 NyaaChat 扩展面板中可见；st-Quote-TTS 的 `settings.html` 能 append 到 `#extensions_settings` 并可交互。

### P3：ST DOM / 事件兼容补强

- [ ] 补 `#chat` / `.mes` / `.mes_text` / `.name_text` / `mesid` 结构或等价逃逸区。
- [ ] 保证 JSR 渲染器能扫描前端卡代码块。
- [ ] 保证 st-Quote-TTS 能扫描消息文本、角色名与当前聊天 DOM，并能在目标文本旁注入按钮。
- [ ] 对 React 受控 DOM 与扩展 jQuery 操作划边界。
- [ ] 补齐 JSR / st-Quote-TTS 依赖的消息渲染事件与 payload（如 `MESSAGE_RECEIVED` / `CHARACTER_MESSAGE_RENDERED` / `CHAT_CHANGED` 的等价触发）。

验收：关闭 NyaaChat 自带前端渲染后，JSR 渲染器能接管至少一个前端卡样例；st-Quote-TTS 能在带引号消息中注入播放按钮。

### P4：新增 `nyaachat-ext-host`

- [ ] 新建 Node sidecar 项目目录。
- [ ] 实现 health/status API。
- [ ] 实现受控 `POST /api/openai/custom/generate-voice` TTS proxy。
- [ ] docker-compose 增加 `ext-host` 服务。
- [ ] nginx 增加 `/api/ext-host/` 反代。
- [ ] nginx 为 `/api/openai/custom/generate-voice` 接到 `ext-host` 或等价后端路径。
- [ ] 保证现有 MCP 路径不变。

验收：rebuild 后 `nyaachat-ext-host` 容器启动，`/api/ext-host/health` 返回 OK，st-Quote-TTS 的 TTS 请求可被受控转发，MCP 功能不受影响。

### P5：扩展字段与 metadata 桥

- [ ] 设计 `writeExtensionField` 到 NyaaChat 用户本地角色/聊天设置的映射。
- [ ] 接通 JSR `predefine.js` 期望的 `writeExtensionField`。
- [ ] 支持角色脚本绑定和角色脚本变量的最小持久化。

验收：JSR 脚本绑定类设置能在刷新后保留。

### P6：JSR shim 缺口迭代

- [ ] 按 P0 缺口补 `/script.js` 导出。
- [ ] 补 `@sillytavern/scripts/openai` / promptManager 必要桩或等价实现。
- [ ] 补 slash argument 相关模块。
- [ ] 补 JSR 脚本管理 UI 运行所需的最小 API。

验收：JSR 设置界面、渲染器设置、用户脚本列表、基础脚本执行路径可用。

---

## 9. 风险与约束

- JS-Slash-Runner 是大型扩展，完整功能面远大于当前 shim；必须按真实缺口迭代。
- st-Quote-TTS 会引入后端代理面；TTS proxy 必须做 endpoint 白名单或 preset 映射，避免成为任意 URL 开放代理。
- 用户自定义脚本运行在浏览器，具备读取页面状态/localStorage 的能力；安全模型是用户信任自己导入的脚本。
- localStorage 容量有限，脚本库可能需要 IndexedDB。
- 没有账号系统，因此服务端不可保存用户私有脚本，除非未来引入用户隔离。
- React DOM 与扩展 jQuery/Vue DOM 操作存在天然冲突，需要明确扩展可操作区域。
- memory/prompt 注入类扩展暂不纳入本阶段，避免为兼容扩展破坏 NyaaChat prompt builder、缓存布局与信任边界。
- 不要为了兼容扩展而破坏现有 NyaaChat MCP、聊天、正则、角色设置路径。

---

## 10. 当前决策

- 采用轻量 Node sidecar，服务名暂定 `nyaachat-ext-host`。
- 扩展治理继续使用 git + rebuild。
- 首批核心验收样本限定为 JS-Slash-Runner 与 st-Quote-TTS 两类；放弃 st-memory-enhancement 这类 memory/prompt 注入型扩展作为本阶段目标。
- 用户定制脚本和扩展设置优先存浏览器本地。
- st-Quote-TTS 所需 TTS proxy 由 `nyaachat-ext-host` 或等价后端路径受控提供，必须限制目标 endpoint。
- MCP 不作为扩展运行宿主；现有 MCP 代码和部署不动。
- 前端渲染不是本计划主线；若启用真实 JS-Slash-Runner 渲染器，应关闭 NyaaChat 自带前端渲染。
