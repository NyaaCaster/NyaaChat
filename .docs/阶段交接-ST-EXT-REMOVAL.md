# NyaaChat · SillyTavern 扩展兼容系统摘除 · 阶段交接

## 交接目的

本文档记录 **NyaaChat 完全摘除 SillyTavern（酒馆）扩展兼容系统** 这一整轮重构的终态、验证证据与遗留事项，供后续接续者（或本轮的 t13 提交环节）直接使用。

**续接前必读**：

1. 本文件（终态与证据的唯一入口）
2. `README.md` / `TECHNICAL.md`（用户与开发者视角的终态描述，本轮已同步更新）
3. `.claude/skills/rebuild/SKILL.md`（rebuild 流程与本轮摘除后的边界说明）

> **证据目录说明**：本轮全部原始证据（t8 基线、t9 验收清单、t10/t24 验证报告、t11 评审报告、`_raw/` 原始输出）原本位于 `NyaaChat/.docs/_st-removal/`。为避免"脚手架入库"，该目录**已在本轮收尾时整目录删除**；其中所有关键数字与结论已按下文各节**并入本文件**（verifier/t24 与 reviewer/t11 的报告均为自持格式，关键输出原本就已抄录在正文，不依赖 `_raw/` 路径）。

**本轮用户需求（5 条）**：① 摘除扩展系统本身，但保留「扩展」入口按钮 UI（无功能）；② 保留 NyaaChat 自有的正则与前端卡渲染能力；③ 设置上传/下载/导入/导出不受影响；④ 提交推送到 GitHub 主仓；⑤ 部署到本机 dev 测试服（4095）供验收。

---

## 1. 认证指纹（唯一权威）

| 项 | 值 |
|----|----|
| `HEAD` | `3dc907ad2f92e5346caac035adb6dec0f1c67494`（本轮改动**全部在工作树，未提交**） |
| `HEAD` tree | `3be91a4c80205012e38f6efebaa62bf136554b6a` |
| **认证指纹（产品面 147 文件清单 digest）** | **`49D097D7ED3B9B2A5F1FB2BD807E3AA06E6E38CFFA764373E3799BA74127E06C`** |
| 定格性 | **运行前 = 运行后 = `49D097D7…`（TREE STABLE ✅）** |
| 契约要求的逐文件 hash | `git hash-object src/lib/chatPipeline.ts src/components/MessageItem.tsx` → `a203f643c559d7acb76f48a8d45d4bc5ceec720d` / `f582a2bfd6f7b7f088223a9b0c6f8aa72fd2c9e9`（与契约预期值逐字一致） |

**指纹范围（147 文件）**：`src/**`、`public/**`、`ext-host/**`、`scripts/**`、`.claude/**` + `nginx.conf`、`package.json`、`index.html`、`rebuild.py`、`tsconfig.json`、`docker-compose.yml`、`docker-compose.publish.yml`、`.gitignore`、`README.md`、`TECHNICAL.md`、`CHANGELOG.md`、`VERSION.md`。

**重算方法（口径已由 t13 独立复算确认）**：对范围内每个文件取 `Get-FileHash -Algorithm SHA256`，输出 `"<HASH>  <相对路径>"`（HASH 大写十六进制 + **两个空格** + 相对路径，**路径分隔符为 Windows 原生 `\`**），按行排序后以 **UTF-8（无 BOM）+ `\n`** 拼接，再对该字符串取 SHA256。
独立复算佐证：t13 用同一算法重算得到 `49D097D7…`（逐字符一致）；同时穷举 `{/,\}` × `{culture,ordinal 排序}` × `{LF,CRLF}` × `{有/无 BOM}` 共 16 种口径，**只有"反斜杠路径 + LF + 无 BOM"得到该值** —— 故该口径已被两端独立确认，可作为复跑基准。

> **历史说明**：本报告替代 t10 的时点指纹 `86125DE2E907B1F73211273B592CAB40EFF4C607ECFED1FEEA787D7CE4AADF32`；t10 认证后 `src/lib/chatPipeline.ts`（18:09:34）与 `src/components/MessageItem.tsx`（18:10:08，又于 18:13 变动至终态）因 t21 收尾的宏身份推值修正被二次写入，故 t10 指纹对当前树已失效（差异属预期）。**t11 / t12 / t13 一律以本节的 `49D097D7…` 为准。**

**若指纹与当前树不符 ⇒ 本节及其下结论对当前树无效，须按 §9 复跑清单重做。**

---

## 2. 当前进度

| 任务 | 内容 | 状态 |
|------|------|------|
| t2 / t3 / t4 / t5 / t6 / t7 | 聊天 UI 去 ST 桥、设置持久化与导入导出卫生、ext-host 与 nginx/compose 接线摘除、文档清理、compat 核心摘除、正则与前端卡渲染迁出 compat | ✅ completed |
| t8 / t9 | 变更前基线快照与验收夹具、独立枚举残留面清单 | ✅ completed |
| t10 | 全局验证（构建门禁 + 残留归零 + 保留项回归 + 设置往返） | ✅ completed，verdict = pass |
| t11 | 独立评审（摘除完整性 / 保留项完整性 / 需求达成判定） | ✅ completed，**verdict = pass**（无 blocker/high/medium findings） |
| t14–t21 | 追加门禁：扩展按钮终态、注释中性化、rebuild skill/rebuild.py/nginx/tsconfig 措辞与死配置、正则宏默认 env 接线 | ✅ completed |
| t22 / t23 | 验收清单维护与条目升级 | ✅ completed |
| t24 | t10 之后产品面二次写入的复验，重出认证指纹 | ✅ completed，verdict = pass |
| t12 | 部署到本机 dev 测试服（4095）并冒烟 | ✅ completed（`rebuild-dev.py --up` exit 0 / 94.5s，3 容器 Up，状态码与内容级判据见 §7） |
| t13 | 阶段交接文档 + 清理临时脚手架 + 提交推送到 GitHub | ✅ completed（本文件已入库；commit 与四条硬指标见 §8；`.docs/_st-removal/` 已删除） |

工作树规模（t11 评审核查时快照）：`git status --porcelain` 共 90 行；**87 files changed, 464 insertions(+), 7479 deletions(-)**。
提交后规模（`git diff --stat 3dc907a..HEAD`）：**91 files changed, 1086 insertions(+), 6760 deletions(-)**。

---

## 3. 构建门禁（t24 在认证指纹那棵树上复跑，全绿）

| 判据 | 实测 |
|------|------|
| `cd NyaaChat && npm run lint` | **exit 0**；输出仅 4 行（npm banner），含 `error\|warning` 的行数 = **0** ✅ |
| `cd NyaaChat && npm run build` | **exit 0**（24.91s）；唯一告警 = `(!) Some chunks are larger than 500 kB after minification.` ✅ |
| `Test-Path dist/extensions` | **False** ✅（vite 已清空 outDir，无旧产物残留） |
| `dist/assets/*.js` 对 `SillyTavern\|TavernHelper\|__NYAA_COMPAT__\|extensions_settings` | **0 命中** ✅（产物级运行时证据） |
| 主 chunk 体积 | 终态 `index-CtzqpIVY.js` = **1,381,338 B ≈ 1,381.34 kB**，基线 1,582.77 kB ⇒ **−201.43 kB / −12.7%** ✅ |
| `docker compose config` / `-f docker-compose.publish.yml config` | 均 **exit 0** ✅ |
| `node --check ext-host/src/server.js` | **exit 0** ✅ |
| `ast.parse(rebuild.py)` | **exit 0** ✅ |
| `python rebuild.py --help` | **exit 0**（仅 `--help`，未构建、未推送、无副作用）✅ |

> lint 判据（队长 2026-09-15 正式更正）：**exit 0 且输出为空（0 error / 0 warning）**，出现任何 error/warning 一律判回归；build 唯一允许保留 vite chunk>500kB 告警。
> 注：任务书早先"基线存在 `ChatInterface.tsx:634` hooks warning"的描述**已过期** —— t8 基线实测 eslint `files=122, errors=0, warnings=0`。

---

## 4. ST 扩展兼容残留归零（**双手段**，全部 0 命中）

| 手段 | 命令 | 命中 |
|------|------|------|
| 跟踪面 | `git grep -n -I -E '<17 项 T1 模式 + registerMacro\|unregisterMacro\|getRegisteredMacroEnv>' -- src public index.html package.json nginx.conf .gitignore scripts .claude` | **0** ✅ |
| 落盘面（含未跟踪） | `Get-ChildItem src,public,ext-host,scripts,.claude -Recurse -File` + `Select-String`（排除 `.claude/settings.local.json`） | **0** ✅ |
| 落盘面 · 唯一例外 | `.claude/settings.local.json`（本地未跟踪的过期权限 allowlist） | **3**（按口径**登记不判失败**） |

维度 1–5（符号 / 源码路径 / 静态资源与构建 / 后端与部署 / 持久化键）逐条 **0 命中**。t11 独立抽查（两路并报，产品面 140 文件）同样 **17/17 PASS，T1 落盘汇总：0 项未归零**，覆盖 `window.SillyTavern`、`window.TavernHelper`、`__NYAA_COMPAT__`、`installCompatLayer`、`TH-message--`、`JS-Slash-Runner`、`runtime-metadata`、`extension-field`、`generate-voice`、`TTS_ALLOWED_ENDPOINTS`、`network-allowlist` 等。

**扩展装载治理通道已彻底不存在**（t11 §4.2 两路扫描，全部 0）：`loadEnabledExtensions`、`resolveExtensions`、`isExtensionLoaded`、`EXTENSIONS_BASE`、`extensions/registry.json` / `registry.overrides`、`loading_order`（ST manifest 契约）、`installExtension` / `uninstallExtension`、`registry.ts` / `loader.ts` / `settingsHost`、扩展字段写入接口（`setExtensionFieldWriter` / `applyExtensionFieldToCharacters`）——**既无运行时装/卸载 API，也无构建期 registry 生成钩子**。`Test-Path public\extensions` = **False**。

---

## 5. 保留项反向检查（误删门禁 · 全部在位）

| 项 | 实测 |
|----|------|
| 正则 | `src/lib/regex/` **4/4** 文件（+ `macros.ts`）；barrel **12/12** 导出齐备（`getRegexedString` / `runRegexScript` / `regex_placement` / `substitute_find_regex` / `RegexParams` / `loadGlobalRegexScripts` / `saveGlobalRegexScripts` / `getEffectiveRegexScripts` / `subscribeRegexScripts` / `regexExportFileName` / `serializeRegexScript` / `parseImportedRegexScripts`）；`store.ts` 另导出 `hydrateRegexScripts`；存储键 `nyaachat_regex_global` **2 命中（未变）**；`RegexModal` / `RegexScriptEditModal` 在位；`chatPipeline.ts` 5 处调用；`MessageItem.tsx` 2 处 `getRegexedString` |
| 前端卡渲染 | `src/lib/frontendCard/` **4/4**；barrel **5/5**（`FrontendCard` / `isFrontendHtml` / `extractFrontendHtml` / `splitFrontendContent` / `FrontendContentPart`）；`MessageItem.tsx` 渲染引用在位；`srcdoc.ts` 已**无 BRIDGE_SCRIPT**（不注入 `window.SillyTavern` / `TavernHelper` / `toastr`），仅保留 `<base href>` 相对 URL 解析、内联基础样式与 ResizeObserver 高度自适应 |
| 前端渲染开关 | `isFrontendRenderingEnabled` / `frontendRenderingDepth` **38 命中**（覆盖 `types` / `App` / `ChatInterface` / `SettingsModal` / `settingsBackup`），默认值 `true` / `5` 未变 |
| T2I 代理 | `t2iAgentApi.ts` + `/api/ext-host/t2i-agent/chat` + `ChatInterface` 调用 + nginx 2 处 + 边车 2 处 |
| 世界书 / 正则格式映射 | `entry.extensions` / `extensions.position` / `nyaa_hard` / `exclude_recursion` 共 **11 命中**；`extensions.regex_scripts ↔ regexScripts` 双向各 1 |
| nginx | 共 **14 个 location**；11 个业务 location（mcp / mcp-health / shared / knowledge×2 / comfyui×2 / opencode-go / image-proxy / assets / index.html）全在；`= /api/ext-host/t2i-agent/chat`、`= /api/ext-host/health` 在；ST 三路由（`generate-voice` / `extensions/third-party` / 通用 ext-host 前缀）**0 命中**；无重复 location |
| 版本文件 | `git status --porcelain -- CHANGELOG.md VERSION.md` → **无输出**（**本轮刻意不发版**，两文件未修改）✅ |
| FontAwesome（必须保留） | `index.html` 3 链接 + `src` 侧 `fa-solid` / `fa-brands` 命中（`ImageProvidersModal.tsx` 在用） |

### 5.1 摘除前的两个扩展版本记录（最后记录，此后不再使用）

| 扩展 | 版本 / commit | 仓库 | 摘除前规模 |
|------|--------------|------|-----------|
| JS-Slash-Runner（酒馆助手） | `b5d341265a45d3a8881e43bd11db7c40ea6d613b`（4.8.11-4-gb5d34126） | n0vi028/JS-Slash-Runner | 277 文件 |
| st-Quote-TTS | `37e6b18726f571316131d48d456389f09f405608` | NyaaCaster/st-Quote-TTS（本地改动：`TARGET_ENDPOINT` → `h.nyaa.host:5050`） | 34 文件 |

两者均已随 `public/extensions/` 一起删除（含各自 `.git`）。**此后 NyaaChat 不再支持运行任何酒馆扩展，也不提供任何装载通道**（运行时装/卸载 API 与构建期 registry 生成钩子均已消失，见 §4）。

---

## 6. 设置上传 / 下载 / 导入 / 导出（需求 3）· 51 条断言

**命令**：`cd NyaaChat && npx tsx .docs/_st-removal/verifier/settings-roundtrip.mts`

**汇总行**：

```
===== settings-roundtrip: 51/51 passed, 0 failed =====
```

**FAIL 行数 = 0，exit 0**（t8 基线 HEAD：`25/51 passed, 26 failed`）。

断言覆盖（摘要）：

- **A 组（导入/导出载荷）**：v2–v9 旧归档仍能导入；v1 / v10 仍被拒绝且支持集不变（2/3/4/5/6/7/8/9）；`payload._kind` 与 `_version = 9` 不变；新导出载荷**不含** `extension_settings` / `extensionSettings` / `chat_metadata` / `extensions` / `quote_tts`；递归键名扫描无 ST 专有键；角色 `regexScripts` 与标量字段保留；`isFrontendRenderingEnabled` / `frontendRenderingDepth` 原样保留；会话级 `metadata` 与消息级 `variables` 已被剥离；会话正文未被破坏。
- **B 组（源码面卫生）**：`settingsBackup.ts` 无 `extension_settings` 业务命中（仅允许出现在退休键清单字符串中）；`sillyTavernExport.ts` 无 `char.extensions`；`idbStorage.ts` 无 ST 存储键；`storageEstimate.ts` 无 `nyaachat_chat_metadata`；`App.tsx` 保留两个前端渲染开关；`types.ts` 无 `Message.variables` / `CharacterSettings.extensions` / `ChatSession.metadata` 声明且保留 `regexScripts`；`ChatInterface.tsx` 无 compat 导入、仍从 `lib/regex` 导入。
- **C 组（终态结构）**：`src/compat` 不存在；`public/script.js`、`public/scripts/`、`public/css/st-host.css`、`public/extensions/`、`scripts/generate-extension-registry.mjs`、`ext-host/network-allowlist.generated.json` 均不存在；`src/lib/regex/index.ts` 与 `src/lib/frontendCard/index.ts` 存在；`package.json` 的 `scripts.build === "vite build"` 且无 `extensions:registry`；`index.html` 不再引用 `/css/st-host.css`；`src` 下无任何 compat 导入。

**关键设计点**：`EXPORT_VERSION = 9` 未变；`buildExportPayload` 5 处调用（本地下载与云端上传共用同一构造器，无分叉）；`stripRetiredImportFields` 在导入路径是**剥离而非拒绝**（末尾 `return { kind: "ok", … }`），因此**携带退休字段的旧归档仍能成功导入**；`RETIRED_TOP_LEVEL_KEYS` 字面量清单仍在（**不可删**，删了会破坏旧归档兼容）。

> 夹具源码随 `.docs/_st-removal/` 一并删除。如需复用，按上述断言口径重建。

---

## 7. 部署到本机 dev 测试服（4095）（需求 5）· t12 已完成

**验收入口**：`http://localhost:4095/`　**Basic Auth**：`nyaa` / `undine77`（匿名 → **401**，认证 → **200**）。

**容器状态**：

| 容器 | 镜像 | 端口 |
|------|------|------|
| `nyaachat-dev-dev-app-1` | `nyaachat-dev-app:local` | `0.0.0.0:4095->4095` |
| `nyaachat-dev-dev-ext-host-1` | `nyaachat-dev-ext-host:local` | 3099/tcp（内部） |
| `nyaachat-dev-devlog-1` | — | — |

**部署命令**：`python tools/rebuild-dev.py --up` → **exit 0**，耗时 **94.5s**（Image dev-ext-host Built → Image dev-app Built → Network Created → 3 容器 Started → `compose ps` 三服务 Up → probe：匿名 `/` = 401、认证 `/` = 200、`/__dev__/health` = 200 `"nyaachat-dev ok"`）。

**构建要点**：dev-ext-host 以 `../ext-host` 为上下文构建成功 —— **依赖 t4 删掉 `COPY network-allowlist.generated.json`**（该文件已不存在，若保留该 COPY 此处必然失败）；dev-app：`npm ci` 768 包 46.6s → **5 个 dev patch 全部 apply**（01 renderedMessages 日志、02 QinyAPI 预填、03 console collector、04 镜像日志、05 请求形状日志）→ `vite build` ✓ 13520 modules 29.3s（`dist/index.html` 1.56 kB，主 chunk `index-0fDL9Ule.js` **1,382.09 kB**，唯一 chunk>500kB 告警为既有）→ nginx 1.27-alpine 阶段 COPY dist + dev 模板 + basic-auth 脚本。

**状态码表（带 Basic Auth）**：

| 请求 | 状态 | 说明 |
|------|------|------|
| `GET /` | 200（1564 B） | SPA |
| `GET /index.html` | 200（1564 B） | SPA 入口 |
| `GET /assets/index-0fDL9Ule.js` | 200 | 首页主 JS |
| `GET /assets/index-Bjn3okFe.css` | 200 | 首页主 CSS |
| `GET /css/fontawesome.min.css` / `solid.min.css` / `brands.min.css` | 200 ×3 | 产品自身图标（保留项，见 §5） |
| `GET /__dev__/console-collector.js` | 200 | dev 注入 |
| `GET /script.js` | 200 | **SPA 回退（非 ST shim）** |
| `GET /extensions/` | 200 | **SPA 回退** |
| `GET /scripts/extensions.js` | 200 | **SPA 回退** |
| `GET /css/st-host.css` | 200 | **SPA 回退**（文件本体已不存在，落到 `index.html`） |
| `GET /scripts/extensions/third-party/st-Quote-TTS/index.js` | **404** | ST alias 目标不存在（唯一期望 404 的项）✅ |
| `POST /api/ext-host/t2i-agent/chat`（无 body） | **400** `t2i_agent_messages_required` | T2I 路由**仍挂载**（保留项）✅ |
| `GET /api/ext-host/health` | **200** `{"ok":true,"service":"nyaachat-ext-host"}` | 边车健康 |
| `GET /api/ext-host/status` | **200** | 边车运行状态（t4 保留的三条路由之一） |
| `GET /api/ext-host/runtime-metadata` | **404** | 扩展运行时元数据路由**已删除** ✅ |

> **SPA 回退 200 不算残留**（队长统一裁定，见 §11.3 第 4 条）：dev 与生产 app 都是 nginx + SPA（`try_files → /index.html`），判据是"**不再返回 ST shim 内容**"；唯一应期望 404 的是 `/scripts/extensions/third-party/<id>/*.js`（实测 404 ✅）。

**内容级判据（关键 · 证明 200 不是 ST shim）**：上表 6 个"200 回退"路径（`/script.js`、`/extensions/`、`/scripts/extensions.js`、`/css/st-host.css` 等）——**字节数全部恰为 1564 B（与 `/` 和 `/index.html` 等长）**、`Content-Type: text/html`、响应体首 200 字符以 `<!doctype html>` 开头且含 `<div id="root">`；同时**容器内 `/usr/share/nginx/html` 中 `script.js` / `scripts` / `extensions` / `css/st-host.css` 全部 ABSENT**。⇒ 这些 200 **只可能**来自 `location / → try_files /index.html`，**不是 ST shim 内容**（判据从"是否 404"升级为"是否返回 ST shim"）。

**被服务 bundle 计数（运行时字符串级证据）**：

| 模式 | 命中 | 说明 |
|------|------|------|
| `扩展（暂未开放）` | **1** | 需求 1 的入口按钮**实机上线**（可见但无功能） |
| `nyaachat_regex_global` | **2** | 正则存储键在服务产物中仍在（保留项） |
| `isFrontendRenderingEnabled` | **15** | 前端渲染开关仍在（保留项） |
| `t2i-agent/chat` | **1** | T2I 代理链路仍在（保留项） |
| `installCompatLayer` / `__NYAA_COMPAT__` / `TavernHelper` / `window.SillyTavern` / `extensions_settings` | **全 0** | 扩展兼容符号在**被服务的 bundle** 中彻底消失 |

> 方法论见 §11.5 第 4 条：dist 中本地函数名会被压缩，运行时 grep 只对**字符串/属性 token** 有效。

**边界与副作用核查**：`error.log` 末尾只有 **2 条 `[error]`**，均为冒烟时主动打已删 ST 路径产生的**预期 404**，**无启动期错误**；主仓 `nginx.conf` 五模式 grep 重跑 **0 命中**；`git -C dev-server status --porcelain` = **空**（冻结私有仓未改）；未做任何 `ssh` / `scp` / docker context / macmini 操作，未启动主仓生产容器，`docker ps` 仅新增 3 个 `nyaachat-dev-*`。

> **与任务原文的唯一不符项**（如实留档）：任务原文写"`/script.js`、`/extensions/` 期望 404"，实测 **200** —— 按队长裁定（方案 a）判 **passed**，理由即上面的内容级判据（回退到 SPA 且容器内不存在 ST 文件），非残留。

**t12 纪律**：未改任何文件（`dev-server/**` 保持冻结，`git status` 为空）。

---

## 8. 提交推送到 GitHub 主仓（需求 4）· t13 已完成

**提交**：`6310735892fe76ca0a96d249c5974c1dd70dbf2f`
**提交信息**：`refactor: remove sillytavern extension compatibility layer`
**规模**：**91 files changed, 1040 insertions(+), 6760 deletions(-)**（3 个新增、56 个删除，git 另识别出 6 处"compat → lib"重命名）

> **补录说明**：紧随其后是若干次**同一提交信息**的文档定稿提交（仅更新本文件：补写本节的 commit SHA、四条硬指标，以及 §7 部署的内容级判据与 bundle 计数）—— 因为一个 commit 的 SHA 无法被包含它的那个 commit 自身引用。这些提交都只落在主仓，内容上属同一次改动；`git log -1 --format=%s` 因此始终等于上面的提交信息。

**提交内容清点（关键项）**：删除 tracked 的 `public/extensions/registry.overrides.json`（`.gitignore` 只忽略 `public/extensions/*/` 与 `registry.json`，故必须显式入索引）、`scripts/generate-extension-registry.mjs`、`public/script.js`、21 个 `public/scripts/**`、`public/css/st-host.css`、`src/compat/**`（26 个 tracked）、`src/components/ExtensionsModal.tsx`、两个 `.docs/` 旧文档；新增 `src/lib/regex/`（5）、`src/lib/frontendCard/`（4）、本交接文档；其余为 31 个 `M`。

**提交后四条硬指标（实测）**：

| # | 命令 | 期望 | 实测 |
|---|------|------|------|
| H1 | `git status --short` | 无 `??` / 无残留 | **输出为空** ✅ |
| H2 | `git ls-files src/lib/regex src/lib/frontendCard` | 有输出 | **9 行**（regex 5 + frontendCard 4）✅ |
| H3 | `git ls-files public/extensions` | 为空 | **空** ✅（7.1 项验收点达成） |
| H4 | `git ls-files .docs/_st-removal` | 为空 | **空** ✅ |

**入库内容合规检查**：`git show --stat --name-only HEAD` 全量文件名对 `^\.env` / `^dev-server/` / `^dist/` / `_st-removal` / `nyaachat-knowledge/` / `shared-server/` 的匹配 → **0 命中**；`.env`、`.env.linux` 由 `.gitignore:8` 忽略，`dev-server/` 由 `.gitignore:33` 忽略，均未入库。**一次提交只针对主仓**；未在 `nyaachat-knowledge/` 或 `shared-server/` 执行任何 git 操作（`git status --porcelain -- nyaachat-knowledge shared-server` 为空）。

**推送命令（PAT 临时重写，不写进 remote/config）**：

```bash
git -C NyaaChat -c credential.helper= -c "url.https://x-access-token:$GITHUB_PAT@github.com/.insteadOf=https://github.com/" push origin master
```

**推送后校验**：`git rev-parse HEAD` 与 `git rev-parse origin/master` 一致（见 t13 回报）。

已执行的提交纪律与清单（备查）：

1. **必须显式 `git add` 的新增路径（2 个新目录 + 1 个新文件）**：
   - `src/lib/regex/`（`engine.ts` / `index.ts` / `io.ts` / `macros.ts` / `store.ts`）
   - `src/lib/frontendCard/`（`index.ts` / `FrontendCard.tsx` / `detect.ts` / `srcdoc.ts`）
   - `.docs/阶段交接-ST-EXT-REMOVAL.md`（本文件）
   > 只提交删除而不 add 前两者 ⇒ 出现"删了实现却没提交新实现"的断裂提交，本地 bundle 全绿但远端构建必挂。
2. **必须显式 stage 的 tracked 删除（重点）**：`public/extensions/registry.overrides.json`（磁盘已删、删除未入索引；t24 §7.1 明确列为待 t13）。另有 `scripts/generate-extension-registry.mjs`、`public/script.js`、21 个 `public/scripts/**`、`public/css/st-host.css`、`src/compat/**`（26 个 tracked 文件）、`src/components/ExtensionsModal.tsx`、两个 `.docs/` 已删文档（`nyaachat-ext-host-plan.md`、`sillytavern-compat-architecture.md`）。
3. **不得入库**：`.docs/_st-removal/`（属删除对象）、`dist/`、`.env*`、`dev-server/**`（独立私有仓）。
4. **禁止 `git add -A` / `git add .`**，逐路径 `git add`；**一次提交只针对主仓**；Conventional Commits（英文小写起首）、不加 `Co-Authored-By`。
5. 建议提交信息：`refactor: remove sillytavern extension compatibility layer`。
6. 推送必须用 PAT 临时重写（不持久化进 remote）：
   `git -c credential.helper= -c "url.https://x-access-token:$GITHUB_PAT@github.com/.insteadOf=https://github.com/" push origin master`
7. **提交后四条硬指标**：`git status --short` 无 `??` 残留；`git ls-files src/lib/regex src/lib/frontendCard` **有输出**；`git ls-files public/extensions` **为空**；`git ls-files .docs/_st-removal` **为空**。

---

## 9. 本轮已实现（按文件归类）

- **compat 层整体移除**：`src/compat/**` 26 个 tracked 文件全删（`events` / `globals` / `macros` / `stContext` / `runtimeStore` / `tavernHelper` / `generate` / `variables` / `metadataBridge` / `extensionSettings` / `index` + `extensions/` + `slash/` + `regex/` + `render/`）。
- **正则与前端卡渲染迁出 compat**：新增 `src/lib/regex/`（5 文件，导出面 12/12 与冻结契约一致）、`src/lib/frontendCard/`（4 文件，导出面 5/5）；`src/components/RegexModal.tsx`、`RegexScriptEditModal.tsx`、`MessageItem.tsx`、`src/lib/chatPipeline.ts` 的导入改指新路径。
- **聊天 UI 去 ST 桥**：`ChatInterface.tsx` / `ChatComposer.tsx` / `types.ts` 清理 ST 字段与 compat 依赖；`MessageItem.tsx` 使用自有渲染与正则管线。
- **扩展入口按钮保留但无功能（需求 1）**：`src/components/ChatHeader.tsx` —— `const EXTENSIONS_UI_ENABLED = true;`（`ChatHeader.tsx:29`），按钮块（约 151–162 行）为 `type="button" + aria-disabled="true" + title="扩展（暂未开放）" + <Puzzle size={18} />`，**无 onClick / href / 任何事件处理**；`ExtensionsModal.tsx` 已删除且全仓 0 引用；原 `createPortal(<ExtensionsModal …/>)` 整块删除。
- **启动期兼容层摘除**：`src/main.tsx` 移除 `installCompatLayer` / `hydrateExtensionSettings` / `hydrateGlobalVariables`；`hydrateRegexScripts` 改由 `./lib/regex/store` 导入；保留 `hydrateSessions`。
- **静态资源与构建**：删除 `public/script.js`、`public/scripts/**`（21 个）、`public/css/st-host.css`、`public/extensions/**`、`scripts/generate-extension-registry.mjs`；`package.json` 的 `scripts.build` 收敛为 `"vite build"`（移除 `extensions:registry`）；`index.html` 移除 `/css/st-host.css` 引用与 ST 字样；`.gitignore` 移除 `public/extensions` 与 network-allowlist 条目；`tsconfig.json` 保留 `"exclude": ["dist/**"]`。
- **后端与部署**：`ext-host/src/server.js` 仅保留 `/health`、`/status`、`POST /t2i-agent/chat` 三条路由，删除 `generate-voice`（`proxyTts`）/ `runtime-metadata` / `extension-field` / TTS 白名单；`ext-host/network-allowlist.generated.json` 删除且 Dockerfile 无悬空 COPY；`nginx.conf` 删除 ST 三路由并保留 T2I 与全部业务 location；`rebuild.py` 移除调用已删脚本的 pre-build 步骤（见 §11 第 1 条）。
- **设置持久化与导入导出卫生（需求 3）**：`settingsBackup.ts` 新增 `RETIRED_TOP_LEVEL_KEYS` 与两个 strip 函数；`sessionStorage.ts` 加 `RETIRED_SESSION_KEYS=["metadata"]`、`RETIRED_MESSAGE_KEYS=["variables"]`；`App.tsx` 增 `stripRetiredCharacterFields()`；`sillyTavernImport.ts` 删除 `char.extensions` 透传、`sillyTavernExport.ts` 不再导出 `char.extensions`。
- **文档**：删除 `.docs/nyaachat-ext-host-plan.md`、`.docs/sillytavern-compat-architecture.md`；`TECHNICAL.md` 保留 t2i-agent 说明、正则与前端卡渲染章节，移除扩展宿主内容；`README.md` 不再宣称支持运行酒馆扩展（保留角色卡 ST 格式导入导出与绑定正则说明，新增「扩展入口为预留、当前无装载/运行能力」中性说明）；`.claude/skills/rebuild/SKILL.md` 修正失效的扩展 registry 描述并把 `nyaachat-ext-host` 重定位为「ComfyUI T2I 智能提示词代理 sidecar」；`.docs/shared-character-system.md` 顶部加历史横幅（正文不改写）。

---

## 10. 追加门禁逐条（t14–t24 与裁定项）

| 项 | 判据 | 实测 |
|----|------|------|
| **t14** 扩展入口按钮终态 | 删 modal、保留按钮、**无任何功能** | `ExtensionsModal.tsx` 不存在、全仓 0 引用；`EXTENSIONS_UI_ENABLED = true`（1）；渲染分支 + `Puzzle` 在；残留弹窗状态 0；已删符号引用 0；`= false` 0。按钮块实机打印（151–162 行）→ **PASS** |
| **t15** index.css / coverStorage 注释 | 规则本体零改动 | 剥除 `/* */` 后与 `HEAD:src/index.css` **逐字符一致 → PASS**；注释中 ST 字样 0；`.cover-*` / `.meta-row` / `.lib-*` 19 命中；`coverStorage.ts` compat 字样 0、DB 名 `nyaachat_character_covers` 保留 |
| **t16** rebuild skill | 去扩展接线、保留 T2I | `generate-extension-registry` / `public/extensions` / `扩展运行时` / `网络白名单` **全 0**；`--only=nyaachat-ext-host`(1)、`t2i-agent`(1) 保留；"不提供任何装载通道 / 不支持运行任何"声明 **2** 处 |
| **t17** rebuild.py | 去已删脚本调用、语法自洽 | 目标模式（`generate-extension-registry\|network-allowlist\|public/extensions\|extension registry`）**0 命中**；`ast.parse` exit 0；`python rebuild.py --help` exit 0（仅 `--help`，未构建/未推送） |
| **t18** 第二批注释中性化 | 3 条 | `App.tsx` + `sillyTavernImport/Export` + `sessionStorage` 的 `JS-Slash-Runner\|TavernHelper` **0 命中**；`settingsBackup.ts` 的 `extension_settings` **3 命中**（`RETIRED_TOP_LEVEL_KEYS` 白名单字面量未误删） |
| **t19** tsconfig 死配置 | 0 命中 + 不误删 `dist/**` | `public/extensions` **0**；`dist/**` **1**；终态 `"exclude": ["dist/**"]` |
| **t20** rebuild.py / nginx.conf 措辞 | 0 命中 + nginx 结构未坏 | `extension runtime\|extension host` **0 命中**；中文「扩展运行时」在两文件 0；`docker compose config` exit 0（publish 亦 0）。全仓跟踪面仅 **1 处** = 已裁定白名单 `TECHNICAL.md:472`「…**不依赖**任何外部扩展运行时：」 |
| **t21** 正则宏默认 env | 接线在位、无残留 | `macros.ts` 导出 `setChatAccessor`(2) / `setDefaultEnvProvider`(2)；`chatPipeline.ts` 宿主枢纽 `macroIdentity`(8) / `syncMacroIdentity`(2)；`MessageItem.tsx` 已接线 `setDefaultEnvProvider`(3)；`macroContext.ts` 终态不存在；lint 0 warning |
| **t21 收尾复核（t24）** | 宿主注册点、推值语义、幂等、扩展专用 API 未复活 | 注册点**恰 2 处**（`MessageItem.tsx:46` env provider、`chatPipeline.ts:42` chat accessor），两者均读模块级引用 ⇒ **实时值不是快照**；`chatPipeline.ts:706` 用**原始角色名**推值（不用展示兜底 `AI助手`）；`syncMacroIdentity` / `syncMacroChat` 幂等零副作用；`registerMacro` / `unregisterMacro` / `getRegisteredMacroEnv` **0 命中** |
| **宏身份推值探针（t24，实跑）** | 12 条断言 | **ALL PASS**（无角色 ⇒ 宏路径 `{{char}}` / `<BOT>` 为空串；哨兵断言"宏路径绝不产生展示兜底"；`{{user}}` 缺失回落 `user`；改身份后 `{{user}}`/`{{char}}` 立即生效；清空后回到空串/回落；引擎 `replaceString` 同源；遗留 `applyPlaceholders` 仍按 HEAD 行为兜底） |
| **t21 期间同源探针** | 22 条断言 | **ALL PASS**（`{{user}}`/`{{char}}`/`<USER>`/`<BOT>`、大小写不敏感、per-call env 覆盖、`{{lastMessage}}` 系 5 宏、`{{newline}}`/`{{roll:1d1}}`/`{{isodate}}`/`{{// comment}}`、经 `runRegexScript` 的 `{{match}}`/`$1`/`substituteRegex=RAW` 端到端） |
| **t6 期望值更正** | `Test-Path src/compat` = False 即 PASS | **False ✅**（其下文件数 0；迁出目标齐备 `src/lib/regex` 5 文件、`src/lib/frontendCard` 4 文件）。原判据"`Get-ChildItem src/compat -Directory` → 期望仅 `regex`, `render`"会报错退出 1，**已废弃** |
| **`.docs/shared-character-system.md`** | 横幅存在 + 正文历史提及保留 | 横幅在位（第 3 行：`⚠️ 历史记录：本文涉及的托管 SillyTavern 扩展能力（含 JS-Slash-Runner 等酒馆扩展）已在后续重构中完全摘除…正文仅作设计历史留存。`）；`JS-Slash-Runner` 7 处属**历史留档白名单**，不判残留 |
| **t24 复验** | 全量门禁 + 宏身份推值 | **verdict = pass**，新指纹 `49D097D7…`，运行前后一致 |
| **t11 独立评审** | 摘除完整性 / 保留项完整性 / 需求达成 | **verdict = pass**，无 blocker / high / medium findings |

### 10.1 用户 5 条需求逐条判定

| # | 需求 | 判定 | 证据 |
|---|------|------|------|
| 1 | 保留「扩展」入口按钮 UI 但无功能 | ✅ 达成 | `ChatHeader.tsx:29` `EXTENSIONS_UI_ENABLED = true`；按钮块无任何事件处理；`ExtensionsModal.tsx` 已删；全仓无装载通路 |
| 2 | 除按钮外全部摘除（含 JS-Slash-Runner 与 st-Quote-TTS 全部内容） | ✅ 达成 | §4 双手段全 0；`Test-Path public\extensions` = False（两个扩展含其 `.git` 全部删除）；`dist/extensions` 不存在；`dist/assets/*.js` 无 ST 符号；`src/compat` 不存在 |
| 3 | 设置上传/下载/导入/导出不受影响 | ✅ 达成 | `EXPORT_VERSION = 9` 未变；导入剥离而非拒绝；`RETIRED_TOP_LEVEL_KEYS` 仍在；两个前端渲染开关 36 处引用仍在；往返夹具 51/51 |
| 4 | 提交推送 GitHub 主仓 | ⏳ 待 t13 | 见 §8 |
| 5 | 部署本机 dev 测试服(4095) | ⏳ 待 t12 | 见 §7 |

---

## 11. 仍需继续验证 / 已知问题 / 行为变化

### 11.1 ⚠️ 生产发行路径 `python rebuild.py` **仅做静态修复验证，未做端到端实跑**

- **事实**：`rebuild.py` 原含扩展 registry 生成 pre-build 步骤（原 106–117 行 `generate_extension_registry()` 内部 `run(["node", "scripts/generate-extension-registry.mjs"])`，失败即 `sys.exit(1)`；原 342–345 行在 `args.only is None or args.only == "nyaachat-ext-host"` 时调用），而该脚本与 ext-host 白名单产物已在本次摘除中删除，导致 `python rebuild.py` 会在构建前 `sys.exit(1)`。**t17 已移除该步骤**（`git diff --stat -- rebuild.py` = 23 deletions，0 插入）。
- **验证深度**：**仅静态验证** —— `ast.parse(rebuild.py)` exit 0、`python rebuild.py --help` exit 0、目标禁止字样 0 命中。**从未真实执行过一次完整构建。**
- **为何刻意不实跑**：`python rebuild.py` 会产生三项副作用 —— ① `docker build` 生产镜像；② `docker push` 到私有仓库 NyaaDockerHUB；③ **注册表清理（删除非当前 SHA/latest 的旧清单）**。第 ③ 步是本工作空间有真实事故记录的高危面（内容相同的重建会让新旧 tag 共用同一 manifest digest，"按 tag 删"会把 `latest` / 当前 tag 一起删光，导致 macmini 侧 `docker compose pull` 失败）。用户本次只授权"提交推送 + 部署 dev 测试服"，**未授权发版**，故任何真实 rebuild 均不在授权范围内。
- **结论措辞（勿改）**：**生产发行路径本次仅做静态修复验证，未做端到端实跑；下一次真实发版时应先在测试 image 上确认 pre-build 删除后流程完整（`build → push → registry 清理 → local cleanup` 连号正常）。** **不得写成"已验证发行路径可用"。**
- 佐证：`python rebuild.py --help` 副作为零（只打印 usage，未触发构建、未生成 `ext-host/network-allowlist.generated.json`），可安全引用为证据。

### 11.2 已知行为变化（**均非本次引入**，不判失败，但必须留痕）

1. **显示/输入通道的遗留 `applyPlaceholders()` 兜底仍会把字面 `{{char}}` 渲染成 `AI助手`**：宏引擎路径完全满足契约（无角色时 `{{char}}` / `<BOT>` 为空串，实测）；但**未被宏引擎消耗**的字面 `{{char}}` 在显示/输入通道仍走兜底 `AI助手`（`src/lib/chatPipeline.ts:918` `applyPlaceholders()`；`MessageItem.tsx:304` `const resolvedChar = charName || "AI助手"`，`:442/447/708` 调用；`ChatInterface.tsx:196` 同款兜底、`:413` 调用）。**`git show HEAD:src/components/MessageItem.tsx` 第 276 行与当前第 304 行逐字一致**，HEAD `ChatInterface.tsx:197` / `:547` 同款 ⇒ **摘除前即存在，本次既未引入也未改变。**
2. **`{{lastMessage}}` 系（`{{lastMessage}}` / `{{lastUserMessage}}` / `{{lastCharMessage}}` / `{{lastMessageId}}` / `{{allChatRange}}`）在显示通道读到的是"最近一次请求组装时的聊天"**：首屏尚未发过任何请求前展开为**空串**（与空聊天语义一致），发过至少一次请求后常驻可用并随每次请求刷新（**非**逐条实时）；提示词通道语义精确。`{{user}}` / `{{char}}` / `<USER>` / `<BOT>` 两通道（提示词 + 显示）均实时。
3. **`{{pick}}` 为随机挑选**（无聊天文件哈希可用），非按 placement 稳定 —— 历史近似实现（`macros.ts:301-310` 注释）。
4. **`{{user}}` 的不可观察边界**：在"用户名被显式设为空串"这一边界上，宏路径取值由 `""` 变为 `"user"`（`??` → `||`），零功能影响。
5. t11 另有 **T2 类登记**：`src/lib/chatPipeline.ts:702` 的 `syncMeta(...)` 为**纯解释性注释**（用 `git show HEAD:…` 引用已删代码说明历史宏语义），按"注释提及"登记，非残留。

### 11.3 登记项（**不算失败**）

| # | 项 | 处置 |
|---|----|------|
| 1 | `git ls-files public/extensions` 仍输出 `public/extensions/registry.overrides.json`（磁盘已删、删除未入索引） | **待 t13**：提交必须 stage 该删除；验收点 = 提交后该命令输出为空（见 §8） |
| 2 | 历史留档命中：`CHANGELOG.md:349`、`.docs`（含 `shared-character-system.md` 横幅+正文历史）、`.ref` 181 命中、`.private` 20 命中、`dist/assets/CHANGELOG-*.js:349` | 刻意不改写历史；`CHANGELOG.md` / `VERSION.md` 未被修改 ✅ |
| 3 | `dev-server/nginx/default.conf.template` 3 处过期接线（`generate-voice`、`extensions/third-party`、通用 `/api/ext-host/` 前缀） | **out of scope**：独立私有仓已知残留，本次不处理。实测 alias 目标目录不存在 ⇒ 请求期 **404**；`generate-voice` 由边车已删路由返回 **404** ⇒ **无功能风险**（nginx 不会启动失败、不会 500） |
| 4 | dev 下 `/script.js`、`/extensions/` 因 SPA 回退返回 **200** | **经裁定的 dev/prod 差异，不算残留**；判据是"不再返回 ST shim 内容" |
| 5 | `.claude/settings.local.json` 的 3 处过期 allowlist（`public/extensions` / `JS-Slash-Runner` / `st-Quote-TTS` 等） | **未跟踪的本地权限表**，不进 git、未被修改；仅在 t16 的 output 中报告，不计入残留判定。若将来清理属独立议题 |
| 6 | 需求 5（HTTP / 容器运行时断言） | **t12 职责**；t10 / t24 全程**零 HTTP 探测**（本机尚无新构建、macmini 为旧镜像） |
| 7 | §11.2 的行为变化 | **已知行为变化**，非本次引入，建议长期留档 |

### 11.4 dev 补丁锚点风险（留档）

`dev-server/patches/01-restore-console-prompt-log.mjs:56,62` 与 `05-log-request-shape.mjs:29,34` 锚定 `src/components/ChatInterface.tsx` 中的字面 `"          url: activeApi.baseUrl,"`；**当前该锚点仍在（`ChatInterface.tsx:784`），t2 的改动未移位它**。但：**若将来 ChatInterface 结构变动导致 dev 补丁锚点移动，dev-server 镜像构建会失败**（该目录属独立私有仓，本次不改）。

### 11.5 ⚠️ 两条方法论更正（后续复验必须沿用）

1. **`git grep` 只覆盖"已跟踪文件"**：本次改动几乎全部未提交，因此**新建文件**（`src/lib/regex/*`、`src/lib/frontendCard/*`）对 `git grep` 类门禁**完全不可见**。实证：`git grep -n -I -F nyaachat_regex_global -- src` 只返回 1 条（`src/lib/idbStorage.ts:143`），而 `src/lib/regex/store.ts:17` 的 `const STORAGE_KEY = "nyaachat_regex_global";` 未被检出。⇒ **残留判定必须"双手段"：`git grep`（跟踪面）+ `Get-ChildItem | Select-String`（落盘面，含未跟踪）。**
2. **"剥注释后与 `HEAD` 逐字节比对"只在文件未被其它任务改过时才成立**：t18 的 5 个文件（`App.tsx` / `settingsBackup.ts` / `sillyTavernImport.ts` / `sessionStorage.ts` / `sillyTavernExport.ts`）同时承载 **t3 的有意代码改动**，而 `HEAD` 是摘除前基线，故该判据会**必然假失败**。**替代方法**：把「HEAD → 当前」差异逐行分为注释 / 代码，对**每一条代码行**归因。执行结果：`App.tsx`（+11/−2 代码 → `stripRetiredCharacterFields()` + `CharacterSettings` 导入）、`sillyTavernImport.ts`（0/+5 → 仅删 `passthroughExt`）、`sillyTavernExport.ts`（+1/−1 → `{ ...(char.extensions ?? {}) }` → `{}`）、`sessionStorage.ts`（+28/−4 → 两个 RETIRED 剥离机）、`settingsBackup.ts`（+29/−9 → `RETIRED_TOP_LEVEL_KEYS` + 两个 strip 函数）—— **代码级改动 100% 归因到 t3 的冻结验收条款，零条无法解释的代码行；t18 只贡献注释行。**
3. （补充）认证指纹的清单口径必须**逐字**包含"路径分隔符为 `\`"这一细节，否则会得到不同的 digest（`/` 分隔会得到 `493E2572…`）。见 §1。
4. **运行时 grep 只对字符串 / 属性 token 有效，不能用于判定函数是否存在**：生产 `dist` 经 vite/terser 压缩后**本地函数名会被改写**（实证：`getRegexedString` 在 `dist` 中 **0 命中**，而源码中该函数确有定义于 `chatPipeline.ts` 与 `src/lib/regex/*`）。⇒ 判断"某能力是否还在"必须看**字符串 / 属性 token**（如 `nyaachat_regex_global`、`isFrontendRenderingEnabled`、`t2i-agent/chat`、`扩展（暂未开放）`），或回落到源码级检查（§5）。

### 11.6 旧状态与私有仓的遗留（不影响功能）

1. **`dev-server/docker-compose.yml` 中 `"Extension runtime host"` 的注释已过时** —— 该目录是**独立私有仓**，本次未改（也不应改）。dev 栈本轮已按 t12 构建并运行成功，注释纯属文字陈旧，无功能影响；若要清理，请在该私有仓单独处理（另见 §11.3 第 3 条、§11.4）。
2. **旧用户浏览器本地残留数据不再被读取**：`nyaachat_extension_settings`、`nyaachat_ext_prefs`、`nyaachat_chat_metadata`、`nyaachat_vars_*` 等键由已摘除的扩展兼容层写入，当前代码**不再读取**它们；同时导入路径会剥离归档中的同类字段（见 §6）。上述本地键属**可选清理**（在浏览器 IndexedDB / localStorage 中手工删除即可），不清理也不影响功能，且不会随导出/上传再次进入产品数据。

---

## 12. 续接提示词

> 以下内容可直接粘贴给新的对话：

```
项目：H:\GitHub\NyaaChat（NyaaChat 主仓，SillyTavern 扩展兼容系统已整体摘除）
先读：.docs/阶段交接-ST-EXT-REMOVAL.md（终态与全部验证证据）、README.md、TECHNICAL.md、
      .claude/skills/rebuild/SKILL.md，然后 git status 确认工作树状态。

当前进度：
- 摘除与验证已全部完成：t2–t11 + t14–t24 全部 completed；t11 独立评审 verdict=pass（无 blocker/high/medium）；
  t24 复验 verdict=pass 并给出认证指纹 49D097D7ED3B9B2A5F1FB2BD807E3AA06E6E38CFFA764373E3799BA74127E06C
  （147 文件产品面 digest，见交接文档 §1 的重算口径：反斜杠相对路径 + 排序 + UTF-8 无 BOM + \n 拼接 → SHA256）。
- 构建门禁全绿：lint exit 0 且 0 error/0 warning；build exit 0（唯一告警 vite chunk>500kB）；主 chunk 1,381.34 kB（−12.7%）；
  dist/extensions 不存在；dist/assets 无 ST 符号。
- 残留双手段（git grep ∪ 落盘含未跟踪）17 项 T1 全 0（唯一例外是未跟踪的 .claude/settings.local.json，登记不判失败）。
- 保留项全在位：正则（src/lib/regex）、前端卡渲染（src/lib/frontendCard）、前端渲染开关、T2I 代理、世界书/正则格式映射、
  nginx 11 个业务 location + 两个 ext-host 端点；设置往返夹具 51/51 exit 0。

下一步（本节写作时 §7 部署与 §8 提交均已完成，可直接从"若要发版"开始）：
1. 复核交接文档 §7（部署 4095 dev 测试服）与 §8（提交推送：commit SHA + 四条硬指标）——两者本轮均已填实。
2. 若要发版：先在测试 image 上确认 rebuild.py 的 pre-build 删除后流程完整（build → push → registry 清理 → local cleanup），
   再执行 python rebuild.py；生产发行路径本轮仅做过静态验证，从未实跑。

关键约束：
- 严禁 git add -A / git add .；逐路径 git add；一次提交只针对主仓；推送到 GitHub 必须用 PAT 临时 insteadOf 重写
  （git -c credential.helper= -c "url.https://x-access-token:$GITHUB_PAT@github.com/.insteadOf=https://github.com/" push origin master）。
- .env / dev-server/** 绝不入库；CHANGELOG.md / VERSION.md 本轮刻意未改（不发版）。
- 不得触碰 H:\GitHub\nul（Windows 保留设备名；Test-Path 会误报 False，需用 \\?\ 前缀判断）。
- 残留判定必须双手段（git grep 只覆盖已跟踪文件，新建文件对它不可见）。
```

---

*本文件由 docs-ops（t13）定稿：t12 部署结果（§7）、t13 提交结果与硬指标（§8）均已补写完毕。*
