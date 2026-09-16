# NyaaChat 插件系统 V1 第二阶段（JS-Slash-Runner）阶段交接

> **交接目的**：本文件是「插件系统 V1 · 第二阶段（JS-Slash-Runner 移植 + 变量系统）」的阶段收尾记录。
> **续接前必读**（按顺序）：
> 1. `.docs/阶段交接-插件系统-V1.md` —— 上一阶段（插件框架本体）的交接，插件树纪律/装饰契约在那里
> 2. `.docs/plugin-system/插件开发_JS-Slash-Runner/开发计划-SSOT.md` —— **本阶段唯一事实来源**（§11 变更记录、§12 已知问题、§9 验收清单）
> 3. `.docs/plugin-system/插件开发_JS-Slash-Runner/MVU技术性说明.md` —— MVU 逆向工程报告（状态栏契约在 §3.9 / §4.6）
> 4. `.docs/plugin-system/插件开发_JS-Slash-Runner/审计报告-JS脚本运行层与变量系统.md` —— D1–D15 决策与依据
> 5. `.docs/plugin-system/插件开发_JS-Slash-Runner/验证报告-P1-P5.md` —— P1–P5 的静态验证证据
> 6. `NyaaChat/CLAUDE.md` + `.claude/skills/commit-push/SKILL.md`
>
> 生成时间：2026-09-16 深夜 · 工作树 `master`，本轮起点基线 `3e255c5`，收尾基线 `bf2639e`。

---

## 1. 交接目的与当前进度

### 1.1 一句话状态

**脚本执行层、变量层、卡片 IO、脚本库 UI、前端卡状态栏注入都已落地并在真机跑通；剩下的主要是"把验收写成可复跑断言"和几处未复核项，不是功能缺口。**

### 1.2 已完成并已提交

| 范围 | 落点 | 证据 |
|---|---|---|
| 变量层内核（P1） | `src/lib/variables/{types,paths,adapter,scopes,api,macros,yamlOut,index}.ts` | `dev-server/tools/check-variables-core.ts` 全绿；`src/lib/sessionStorage.ts` 的 message 级退休守门已撤销 |
| 脚本宿主门面（P3） | `src/plugins/scriptHost.ts`（叶子）/ `scriptHostImpl.ts`（实现） | `check-script-host.ts` 全绿（含反引号守卫、载体不变量、注册接线） |
| 脚本执行器（P3） | `plugins/js-slash-runner/executor/{host,srcdocHost,predefine}.ts` | 真机：MVU + mvu_zod 两脚本无未捕获错误跑完（见 §2） |
| vendor 自托管（D7①/D15） | `public/vendor/script-host/**`（**100 个文件**，含 `manifest.json` + `PROVENANCE.md`） | `/vendor/script-host/mvu/bundle.js` 200 且 sha256 与 PROVENANCE 一致 |
| 卡片脚本 IO（P4） | `src/lib/sillyTavernScripts.ts` + `sillyTavernImport/Export` 接线 | 卡片脚本随角色卡进出，`character.scripts.length === 2` 已在诊断快照里实测 |
| 脚本库 UI + 设置面板（P5） | `plugins/js-slash-runner/{ScriptLibraryModal,ScriptRunnerSettings}.tsx` | UI 落地（列表/绿点/启停/删除/拖拽/导入；无在线编辑） |
| 前端卡状态栏注入（D14） | `src/lib/frontendCard/{detect,srcdoc,FrontendCard}.tsx` + `plugins/js-slash-runner/executor/predefine.ts` | **本轮真机验收通过**（见 §2） |

### 1.3 本轮的 4 个真机缺陷 + 1 个验证缺口

本轮（`3e255c5` → `bf2639e`）是**真机验收轮**，用户逐张卡试出问题，逐条定位修复。
**完整技术细节见 SSOT §11 最后一条**，此处只列索引：

| # | 提交 | 症状（用户视角） | 根因 |
|---|---|---|---|
| 1 | `9ca5caf` | 状态栏能渲染，但每个字段都是卡片里写死的初值（时间永远 07:00） | 卡片 predefine 的 `getAllVariables()` 返回 `{global,chat,message}` 嵌套壳，而 ST 的契约是**顶层即合并后的变量表**（卡片读 `vars.stat_data`）⇒ 永远 `undefined` |
| 2 | `9ca5caf` | MVU/mvu_zod 之间的事件参数丢失 | `eventEmit(name, payload)` 只转发第一个参数，MVU 发两个 |
| 3 | `9ca5caf` | 整条消息漏成纯文本（正文 + CSS + `<!DOCTYPE html>` 一起显示） | 惰性正则围栏配对：裸 ``` 围栏（CSS 片段）抢走了卡片围栏的配对，`types: null` |
| 4 | `0acb763` | **"无法连接变量系统，当前仅显示静态卡面。"**；非 MVU 卡状态栏整块不渲染 | `buildCardPredefineScript()` 第一行 `if (!bridge) return;` —— 卡片 iframe 早于插件 mount 完成就渲染时，**该 iframe 什么都没装**，卡片 init 直接 `ReferenceError` |
| 5 | `0acb763` | 同一张卡出现两次、卡片源码夹在中间 | 未闭合卡片围栏分支用 `continue`，后面又出现一行 ``` 时把同一张卡切了第二遍（`[card, markdown, card]`） |

> 缺陷 1–3 由 `9ca5caf` 修；4–5 由 `0acb763` 修。`bf2639e` 只是把构建标记抬到 `v12-2230`，便于日志归属。

---

## 2. 本轮已修复 / 已实现（按文件）

### 2.1 `plugins/js-slash-runner/executor/predefine.ts`

**卡片注入脚本 `buildCardPredefineScript()` 被重写为"分层 + 动态 getter"结构。**

| 改动 | 为什么 |
|---|---|
| 删除开头的 `if (!bridge) return;` | 卡片 iframe 可能在插件 mount 之前渲染（打开已有会话 / 楼层重渲染 / 宿主重挂载）。整体 return 会让该 iframe **一个 API 都没有**，卡片的 `$(errorCatched(init))` 直接 ReferenceError，init 不跑 ⇒ 卡片退回静态卡面 |
| 不依赖桥的立即安装：`errorCatched` / `tavern_events` / `eventOn`·`eventRemoveListener`·`eventEmit` / `__nyaCardDispatch` / `Mvu` getter | 这些与宿主桥无关，必须**在卡片自己的脚本执行前**就位 |
| 依赖桥的改为**动态 getter**：`getAllVariables` / `getVariables` / `getLastMessageId` / `getLastMessage` / `getChatMessages` / `getCurrentPersonaName` / `getCurrentCharName` / `SillyTavern` | 每次调用现取 `window.parent.__nyaScriptHostBridge` ⇒ 桥晚到、或宿主重挂载换了新桥，都能自动跟上（早先是闭包快照，重挂载后指向已废弃的桥） |
| **新增** `waitGlobalInitialized(name, timeoutMs)` | 道渊卡报过 `ReferenceError: waitGlobalInitialized is not defined`；MVU 卡普遍用它等 `Mvu` 就绪 |
| `getAllVariables()` 返回**扁平**的 `message` 作用域快照 | 对齐 ST 契约（缺陷 1） |
| 新增 `__nyaCardReady` 广播（桥就绪时 + 轮询补齐，最多 ~20s） | 给"桥晚到"的卡片一个可重画的信号；卡不用它也照常工作 |

**未做（刻意）**：没有把 `global` / `chat` 摊进 `getAllVariables()` 顶层。MVU 的 `stat_data` 只存在于楼层变量；摊入 `chat` 反而有键名冲突风险（MVU 的"更新到聊天变量"兼容副本也带 `stat_data`）。将来若遇到依赖全局变量的卡片，在 `getAllVariables()` 里补合并即可（SSOT §11 已登记）。

### 2.2 `plugins/js-slash-runner/executor/srcdocHost.ts`

- `emit(tavernEventValue, payload?)` → `emit(tavernEventValue, ...args)`：与 `predefine` 的多参数事件转发同源（缺陷 2）。**酒馆语义是 `emit(event, ...args)`，多参数事件（MVU 的 `VARIABLE_INITIALIZED` 等）必须原样转发。**
- 修掉 `catch {…}    for (var j = …)` 的换行粘连（补 `#tavern_helper` 时吃掉的换行）。
- 构建标记 `v12-2230`。

### 2.3 `plugins/js-slash-runner/plugin.tsx`

- `BUILD_MARKER` → `v12-2230`（唯一用途：让诊断快照/日志能归属到具体构建）。
- 顺带落在本文件但**早于本轮**的 `chat_id_changed` 去重（`lastChatId`）：宿主重复派发同一 chat id 会让 MVU 反复重建监听器，留下"已 abort 但仍在册"的僵尸处理器，导致回复楼层永不补 `<StatusPlaceHolderImpl/>`。真机 v12-2109 实证（`chatIdHistory` 全程同一 id）。**判据是"值真的变了"才派发。**

### 2.4 `src/lib/frontendCard/detect.ts`（**本轮改动最大**）

`splitFrontendContent()` 由"一个惰性正则配对围栏"重写为**按行扫描**：

```ts
const FENCE_LINE = /^[ \t]*```[ \t]*([a-zA-Z0-9_-]*)[ \t]*\r?$/;
```

语义（与改前**刻意保持**一致的部分已标注）：

| 规则 | 说明 |
|---|---|
| 围栏的开关/配对只由「这一行是不是**纯围栏行**」决定 | 对齐 GFM"收尾围栏不得带 info string"。这是修缺陷 3 的关键：裸 ``` 围栏与 ` ```html ` 各归各位 |
| 语言标签是**显式意图**：`html`/`htm` 一律当卡片（保留原语义） | ST 卡片的状态栏/变量美化常是 `<div>`+`<style>` 片段，不含 `html>`/`<head>`/`<body` 子串 |
| **未闭合的卡片围栏**按"到消息末尾"处理（保留原"整段无围栏就当卡片"的兜底意涵） | 模型经常漏掉收尾围栏；不兜底则状态栏整块漏成正文 |
| **未闭合的普通代码块**不切（新增，防误切） | — |
| 未闭合卡片围栏处理后**结束扫描** | 缺陷 5：否则后面的 ``` 行会开新块、把同一张卡切两遍 |
| 整条消息**一个围栏都没有**时才允许整段当卡片（保留原语义） | 有围栏但都不成卡片 ⇒ 返回 `null`，正文老实走 markdown（封住"吞正文"回归） |
| 语言标签后允许空格/制表符、行尾允许 CRLF（保留 `v12-2043` 的修复） | — |

**验证**：14 个构造形态 + 2 个真实序列（用角色卡里解出的真卡文本回放）逐条比对，详见 §4。

### 2.5 `src/components/ChatInterface.tsx`（上轮落地，本轮沿用）

MVU 状态栏占位符的**宿主侧兜底**：当显示正则链里存在以 `<StatusPlaceHolderImpl/>` 为 findRegex 的规则、且最后一条助手楼层确实带 `stat_data`、正文却还没占位符时，补一个（幂等）。原因：MVU bundle 的收尾步骤（负责追加占位符）在本仿真环境里其 `message_received` 监听器被 abort，不会执行。

### 2.6 `src/lib/frontendCard/FrontendCard.tsx`（上轮落地，本轮沿用）

变量变更 → 通知卡片重绘：`subscribeVariables(...)` + iframe 的 `onLoad` 各调一次卡片 iframe 的 `__nyaCardDispatch('mag_variable_update_ended')`。没有这一步，面板只会停在 iframe 加载那一刻的快照。

---

## 3. 本轮新增的验证工具（已入 dev-server 仓）

`NyaaChat-dev.git`（独立仓）提交 `a4acd75`：

| 工具 | 用途 |
|---|---|
| `dev-server/tools/verify-card-status.ts` | **本轮的主力验证器**。每张卡一个独立 Chrome profile：用仓库自己的 `convertSillyTavernCharacter` 导入卡片 → 向 IDB 播种"插件启用 + 该卡为当前角色 + 开场白" → reload → 采集宿主 iframe 诊断（`__nyaScriptRunnerDiag()`）、**每个卡片 iframe** 的 `getAllVariables()` 形状与渲染文本、切分结果、未捕获错误 |
| `dev-server/tools/diag-card-structure.ts` | 打印一张卡的脚本清单 / 世界书 `[initvar]` / 正则清单 / **状态栏 HTML 的 API 使用统计与读取相关行** |
| `dev-server/tools/diag-regex-replacement.ts` | 打印某条正则的替换文本、**围栏行普查**（哪一行是"整行只有围栏"），排查状态栏不渲染 |

用法：

```bash
npx tsx dev-server/tools/verify-card-status.ts "<卡1.png>" "<卡2.png>"
npx tsx dev-server/tools/diag-card-structure.ts "<卡.png>"
npx tsx dev-server/tools/diag-regex-replacement.ts "<卡.png>"
```

**这套工具的价值在于"不需要用户截图"**：它是本轮 5 个缺陷里 4 个的定位手段（唯一例外是缺陷 4 的竞态，靠用户截图里的文案 + 代码阅读定位）。

---

## 4. 验证结果（本轮的实测证据）

### 4.1 真机卡片验证（`verify-card-status.ts`，构建 `v12-2230`）

| 卡 | 类型 | 结果 |
|---|---|---|
| 苏婷（万象编辑器 MVU 样例卡） | MVU + mvu_zod + 状态栏 | ✅ **零未捕获错误**；状态栏为他真实变量（`07:00` / `2022.09.01` / `早起洗漱` / `417寝室-自身床位`，舍友好感度 `+20 / -35 / -5`） |
| 变装女友（`E:\Downloads\HTTP-Downlord\变装女友.png`） | MVU + mvu_zod + 状态栏 | ✅ **零未捕获错误**；`getAllVariables().stat_data` 顶层键 `[世界, 白石栞, 物品栏, NPC列表]`；状态栏为真实变量（好感度 85 / 羞耻度 70 / 勇气 25 / 顺从度 85 / 性欲 20、時刻 上午、場所 同居公寓·客厅） |
| 变装女友（**修复前**，构建 `v12-2135`） | 同上 | ❌ 复现用户症状：卡片报 `ReferenceError: errorCatched is not defined`，状态栏显示兜底值 / "无法连接变量系统" |

> **对照组是关键**：同一个 harness 在修复前后各跑一遍，证明修复真的改变了行为，而不是"恰好这次好了"。

### 4.2 切分器（`splitFrontendContent`，跑真实源码）

16 个形态逐条验证，摘要：

| 形态 | 结果 |
|---|---|
| 正文 + 裸 CSS 围栏 + 未闭合 ```html 卡片 | `[markdown, card]` ✅（改前 `null`） |
| 正文 + 模态框的"两张闭合 ```html 卡片 + 尾" | `[markdown, card, markdown, card, markdown]` ✅ |
| 未闭合卡片围栏（消息到此结束） | `[card]` ✅ |
| 未闭合的**普通**代码块 | `null` ✅ 不误切 |
| 卡片体内含 `"```html"` 字面量 | 不再被截断 ✅ |
| 纯 CSS 裸围栏、无卡片 | `null` ✅ 无回归 |
| CRLF / 语言标签后带空格 / 正文提及 ``` / js·css 代码围栏 / 整段无围栏 | 与原行为一致 ✅ |
| **真实失败序列**（正文 + CSS 裸围栏 + 22481 字符真卡文本回放） | `[markdown, card]` ✅（改前 `null`） |
| 未闭合卡片围栏 + 之后又出现一行 ``` | `[markdown, card]` ✅（改前 `[card, markdown, card]`） |

### 4.3 静态门禁

- `npx tsx dev-server/tools/check-script-host.ts` → **全部通过 ✅**（含 `predefine.ts` / `srcdocHost.ts` 的**反引号守卫**——本轮被它拦下过一次，见 §5）
- `npx tsc --noEmit` → 干净
- `npx eslint src/lib/frontendCard/detect.ts plugins/js-slash-runner/executor/predefine.ts` → 干净
- `python dev-server/tools/rebuild-dev.py --up` → 成功，`GET /` 200，`/__dev__/health` ok
- **产物核对**（不靠时间戳）：容器内 bundle 含 `v12-2230` 字面量、且**不含**旧的 `getVariables("global"),` 嵌套形状

---

## 5. 仍需继续验证 / 已知问题（**接手者请优先结账**）

### 5.1 未复核项（SSOT §11 同步登记）

1. **§9 的 `dev-server/tools/verify-js-slash-runner.py` 从未创建**。⇒ P2/P3/P4/P5 的验收断言（V1–V8）**都没有可复跑载体**。本轮的 `verify-card-status.ts` 覆盖了"宿主 iframe 起得来 + 变量写进楼层 + 卡片读到真实变量 + 切分正确"，但**未覆盖**：
   - V6：变量宏进 prompt 的**位置**（须在尾部 system 消息）
   - V7：静态前缀**逐字节一致**
   - V2b：撤销守门的行为断言（写 `Message.variables` → 重载仍在；`metadata` → 仍被剥离）
   - V4：导入样例卡 → `character.scripts.length == 2`
2. **P2 的"非空 `stat_data` → 合法 YAML 块"没有实例证据**。已完成的部分：`substituteVariableMacros` + 永久条目分流（`chatPipeline.ts:831-844`）落地；真机日志里 `<status_current_variables>` **确实出现在组装后的 `session_rules` 中**（证明宏参与了渲染）。缺的是"非空值时的输出是否正确"。
3. **P1 的四作用域真机往返**（§8 P1 验收 4/5）未在 dev 上复跑。
4. **S-b / S-c / S-d**（§2.4 的 spike 结论）仍未逐条复核。
5. **K1（CSP 未下发）** 依旧未修：修完后**必须**同步迁移脚本载体（`ScriptHost` 换实现）+ 前端卡载体（`__nyaCardDispatch` 是私有约定，见 SSOT §12 K6）。

### 5.2 已知问题（不修，登记）

- **`K3`**：`{{phone_chat:…}}` 等其它 ST 扩展宏不被替换（透传）。
- **`K4`**：同源 iframe 共享事件循环 ⇒ 脚本死循环冻结整个应用（与 K1 一起考虑）。
- **`K5`**：`ScriptLibraryModal` 自带 `LocalModal` 底座 ⇒ 两套 ESC 处理叠加行为**未实测**。若实测有问题，改为 import `BaseModal`。
- **`K6`**：前端卡刷新走 `__nyaCardDispatch('mag_variable_update_ended')` 私有通道，换载体时需迁移。
- **`K7`**：非 MVU 卡（如 G·RPG）的状态栏**同样驶过**这条注入通道 ⇒ **非 MVU 卡也会被注入层缺陷影响**。这是"无法连接变量系统"能出现在一张没有脚本的卡上的原因。
- **`getAllVariables()` 只摊 `message` 作用域**（不含 `global`/`chat`）：刻意取舍，见 §2.1。

### 5.3 本轮踩到并应固化的纪律（**接手者必读**）

1. **"能渲染" ≠ "读到数据"**：卡片状态栏有**两层**兜底 —— 卡里写死的字面兜底值（`07:00` / `--:--`）和"连接失败"文案。看到状态栏"有内容"就先确认那是变量还是兜底。**判定方法**：`diag-card-structure.ts` 打印状态栏 HTML 的读取行（如 `_.get(statData, '世界.当前时间', '07:00')`），兜底值就在第三个参数里。
2. **不能用"我传进去的文本"当夹具**：我先用正则的 `replaceString` 直接播种测试，结果卡里出现未替换的 `$<名字>` —— 那不是缺陷，是我绕过了正则引擎的命名组替换。**夹具必须是"模型真实输出"**（`<CharData>` 原文），让应用自己的正则去替换。
3. **围栏解析必须按行**：任何"用一个正则配对开关闭围栏"的实现都会在"裸围栏 + 卡片围栏"同现时错配。判定围栏只看"这一行是不是纯围栏行"。
4. **`predefine.ts` / `srcdocHost.ts` 是模板字符串**：改它们的**注释**时也会被反引号守卫拦（本轮真实发生）。改完**必须**跑 `npx tsx dev-server/tools/check-script-host.ts`。
5. **不要用 PowerShell 重写源文件**：会改行尾（CRLF/LF）从而破坏 dev patch。改动一律走 `edit` 工具（本轮全程遵守；`git diff` 会提示 `predefine.ts` 工作区是 CRLF，这是既有状态）。
6. **验证 harness 要留"反向对照"**：本轮 harness 在修复前后各跑一遍才有说服力（否则分不清"修好了"和"恰好这次好了"）。
7. **构建标记是唯一的日志归属手段**：`BUILD_MARKER`（`plugin.tsx`）与 `srcdocHost.ts` 里的字面量必须**同步**抬；看日志先看 `build=`。
8. **`git commit -m "$(cat <<'EOF' …)"` 在 PowerShell 下不可用**（HEREDOC 语法错误）。改成把提交信息写进临时文件再 `git commit -F <file>`。

---

## 6. 续接提示词

> 继续开发 NyaaChat 插件系统第二阶段（JS-Slash-Runner）。**以 plan 模式推进**。
>
> 先读：`.docs/阶段交接-插件系统-V1.md`（前一阶段）→ `.docs/plugin-system/插件开发_JS-Slash-Runner/开发计划-SSOT.md`（**唯一事实来源**，重点看 §8 状态总览、§9 验收清单、§11 变更记录、§12 已知问题）→ `MVU技术性说明.md`（状态栏契约 §3.9/§4.6）→ `NyaaChat/CLAUDE.md` + `commit-push` skill。
>
> 当前状态：脚本执行层 / 变量层 / 卡片脚本 IO / 脚本库 UI / 前端卡状态栏注入**都已落地并在真机跑通**（收尾基线 `bf2639e`，dev 构建 `v12-2230`）。本轮修掉 5 个真机缺陷（`getAllVariables` 形状、多参数事件、围栏配对、卡片 API 注入竞态、未闭合围栏被切两遍），详见 SSOT §11 最后一条。
>
> 下一件事（按优先级）：① **补 `dev-server/tools/verify-js-slash-runner.py`**，把 §9 的 V1–V8 写成可复跑断言（现有 `verify-card-status.ts` 可直接复用其 CDP/seeding 骨架）；② 补齐 P2 的"非空 `stat_data` → 合法 YAML"实例证据与 P1 的四作用域真机往返；③ 复核 §2.4 的 S-b/S-c/S-d。
>
> **关键约束**：改 `plugins/js-slash-runner/executor/{predefine,srcdocHost}.ts` 前**必跑** `npx tsx dev-server/tools/check-script-host.ts`；不要用 PowerShell 重写源文件（改行尾会破坏 dev patch）；未经明确要求**不** commit/push；`dev-server/` 是**独立仓库**（`NyaaChat-dev.git`，分支 `main`），与主仓分开提交。
