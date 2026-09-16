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

### 1.4 第二轮（"继续完成"那轮）：1 个真缺陷 + 3 项复核结账

| # | 提交 | 症状 | 根因 |
|---|---|---|---|
| 6 | 见 §4.5 | `global_Mvu_initialized` **从未被派发**；订阅它的脚本（`mvu_zod` 的用户键迁移钩子）静默失效。`waitGlobalInitialized('Mvu')` 仅靠"已存在即 resolve"兜底才能工作 | `__nyaSyncMvu()` / `initializeGlobal()` 引用了**构建期 TS 常量** `TAVERN_EVENTS`，而脚本字符串里运行时存在的是 `window.tavern_events`（原先要到 `implemented` 汇总处才赋值）⇒ 运行期抛 `ReferenceError: TAVERN_EVENTS is not defined`，且**恰好发生在 `window.parent.Mvu` 镜像成功之后**，所以"MVU 就绪"看着一切正常 |

**这个缺陷是 §9 的 V1–V8 全绿都发现不了的**（它断的是端到端行为，而事件链断裂不影响 V1–V8 的任何一条）——
是专门为 §2.4 的 spike 结论写 `verify-script-host-spike.py` 时才查出来。**这是"继续完成"那轮最有价值的一件事。**

---

### 1.5 第三轮（"继续 4 条"那轮）：1 处接线缺口 + 1 处夹具假阴性 + 1 处登记更正

| # | 内容 | 结论 |
|---|---|---|
| 7 | **§2.7「必须」级事件接线缺 3 条** | `generation:started` / `message:sent` / `message:deleted` **一条发射点都没有**（6 条「必须」里只接了 3 条）。它们对应脚本侧 `GENERATION_STARTED` / `MESSAGE_SENT` / `MESSAGE_DELETED`，前两条正是 MVU 变量初始化的触发入口。→ **已补齐**，矩阵 6/6 |
| 8 | **S-a 生产产物复核** | **全绿**（`verify-prod-artifacts.py` S-a1/a2/a3）。生产产物下 srcdoc + importmap + MVU 全链路成立，56 个 closure 全走本地、**CDN 请求 0 次**；`dist/index.html` 不含 dev 收集器 |
| 9 | **P4 登记更正** | 上一轮写"P4 导出/round-trip 无自动断言"**有误**——`check-card-scripts.ts` 早已覆盖 §8 P4 验收 1–7 且全绿。同轮修掉其中一处**过宽断言**（把 DOM 元素 id 误当卡片 JSON 键名），并以三种违规形态做反向验证 |
| 10 | **V6 取证边界** | 应用**主动剥离** `renderedMessages`（`App.tsx` 的安全设计）⇒ 真实请求体上的位置按设计取不到，**这是结论而非待办** |

**过程中踩到一个夹具假阴性（值得记）**：S-a 的静态服务器最初用单线程 `socketserver.TCPServer`。
MVU 要拉 56 个 closure，串行应答慢到让脚本宿主的 15s 超时先触发 ⇒ **MVU 永远起不来、变量永远为空**，
看起来极像"生产构建有缺陷"。对照实验（同一夹具，只换服务器类）：

| 服务器 | `iframeMvu` | 变量楼层 |
|---|---|---|
| 单线程 `TCPServer` | undefined | 0 |
| 多线程 `ThreadingHTTPServer` | **object** | **1** |

⇒ 生产 nginx 是并发的，夹具必须对齐。已写进 `verify-prod-artifacts.py` 的注释。

---

### 1.6 第四轮：K1（安全头）修复 —— 含一处必须迁移载体才能补的部分

**K1 的真身不是"没写"，而是"写了被吃掉"**：`nginx.conf` 的 server 级早就写了 5 个安全头，但
`location = /index.html` 自带 `add_header`（Cache-Control/Pragma/Expires），按 nginx 的覆盖规则
把父级那组**整组吃掉**；而 SPA 回退最终正命中该 location ⇒ 文档响应**一个安全头都没有**。

| 项 | 结果 |
|---|---|
| 安全头真正下发 | ✅ 修前 `GET /` **0/5** → 修后 **5/5**（`/index.html`、任意 SPA 路由同）；`dev-server` 模板同源缺陷一并修（dev 现 6/6，并补上它此前漏的 `Permissions-Policy`） |
| 值只定义一次 | ✅ `set $nyaHeader*` + 两处 `add_header $var`（避免"改一处漏一处"） |
| 子资源 | ✅ `/assets/` 与 `/api/image-proxy/` 各补 `nosniff`（它们也自带 `add_header`）；CSP/XFO 对子资源无意义 |
| **CSP 收紧到 `script-src 'self'`** | ❌ **本次未做，且不能做** —— 见下 |
| 防漂移断言 | ✅ `verify-prod-artifacts.py --only K1`（凡自带 `add_header` 的 location 都必须带齐安全头） |

**为什么 CSP 不能直接收紧（S-a4 沙箱实验的硬结论）**：给静态服务器下发与 nginx 一致的 CSP 后，
宿主 iframe 的 `console` **连「宿主脚本构建」那行都没有** ⇒ srcdoc 的**内联**装配脚本被
`script-src 'self'` 拒绝执行 ⇒ MVU 永不就绪、变量全空（卡片 iframe 的 `statKeys` 为空）。
因此下发的版本**必须**保留 `'unsafe-inline'`；要收紧到 `'self'` 需先按 D13② 把内联脚本**外置成同源文件**，
那是独立改动。**CSP 下发后已实测端到端 V4/V5/V8 仍全绿** ⇒ 当前这版不破坏 srcdoc 与前端卡。

---

### 1.7 第五轮：撤回一条会崩脚本侧的事件派发（用户报错驱动）

补全 §2.7 四条 best-effort 事件后，用户在浏览器控制台收到：

```
[js-slash-runner] 事件处理器抛错 chat_completion_settings_ready
TypeError: Cannot read properties of undefined (reading 'filter')
    at dr (bundle.js)  ← MVU 的 chat_completion_settings_ready 处理器
    at eventEmit … at window.__nyaDispatch … at Object.emit (index-*.js)
```

**根因**：§2.7 只规定"哪些事件该发"，**没规定载荷形状**；而 MVU 的该处理器按**酒馆结构**读
（`e.chat ?? e.messages` → 再对某字段 `.filter`），宿主给的是 `ApiSettings` 那三字段，对它等于空载荷。
两条独立证据：① `__nyaShellProbe.events` 里 MVU **从未注册**该处理器（11 个已注册事件中没有它）；
② MVU bundle 里 `chat_completion_settings_ready` 只出现 1 次（定义常量处），另三条新事件的常量
**0 次出现**（从不订阅）。

**处理**：撤回该派发，并把它登记为矩阵的**第三态** `not-wired-by-contract`（刻意不派发），
同时反向断言"标记为不派发却存在发射点"必须 FAIL —— 否则将来有人"顺手补上"会再把错误带回来。

**为什么撤回而不是伪造完整载荷**：那条路径只服务 MVU 的"额外模型解析"（`generate`/`generateRaw`），
本阶段 NG4 明确不实现 —— 伪造一个 `chat_completion_settings` 只会让脚本以为拿到了真实设置，
与 D9「未实现即显式报错、不静默糊弄」相悖。

**验证**：撤回后 dev 日志最近 12 分钟内 `事件处理器抛错` **0 命中**（历史 57 次是修复前对照）；
端到端 V4/V5/V8 仍全绿；矩阵 `--matrix` 显示 9 接线 + 1 因契约不派发、必须级 6/6。

---

### 1.8 第六轮（用户报告「状态栏不刷新」+「初始化提示不阻塞输入」那轮）：2 个真缺陷

> 这一轮的两条都不是「补功能」，是**用户症状驱动**的定位：① 状态栏恒定落后一拍；② 初始化提示形同虚设。
> 两条都有**修复前 / 修复后对照**的可复跑证据（§4.7）。

1. **变量通知早于数据落地一拍（读路径丢了「本帧补丁覆盖层」）** —— 用户症状原文：
   「查看浏览器控制台落盘日志输出，变量 mvu 变量刷新了，但渲染的状态栏上依旧是初始数据」。
   **定位手法**：不再依赖伪造会话（其 `stat_data` 天然为空，无法区分「链路断」与「没数据」），
   而是**预置** `stat_data.白石栞.好感度=777 / 世界.当前场所=P0` 后加载卡片 —— 首渲染读到 `場所 P0`
   直接证明读取链路与 `getAllVariables()` 形状都没问题（`好感度 100` 是 777 经 `_.clamp(…,0,100)` 的显示值，**不是**兜底）；
   再把 `世界.当前场所` 改成 `MARKER_PLACE`：自动重绘的计数器 `+1`（**事件链是通的**），
   但 render 读到的仍是 `P0`，**再手动派发一次**才追上。
   **根因**：`patchMessages` 走 `setMessages`（React 下一帧才进 `messagesRef`），而变量层在 patch 后**同步**通知；
   适配器 `getSession` 读路径返回裸 `messagesRef.current`，没叠加 `varPatchOverlayRef`（落盘路径一直在叠）。
   **修法**：live/draft 两条分支都改用 `patchArrayOverlay(messagesRef.current, varPatchOverlayRef.current)`。
2. **初始化提示不阻塞输入 ⇒ 用户可抢跑**（用户拍板：既然存在这个机制，就应该阻塞用户的输入操作，
   而阻塞应该在实际初始完成不会造成初始化失败的状态到达后，再解开）。
   **真机证据**：v11-1542 那次 MVU 在 `chatReady:false / messages:0` 时装配 ⇒ console 打出
   「不存在任何一条消息，退出」，**且不重试**（`initialized_lorebooks` 已记名 ⇒ initvar 永久跳过）⇒
   该会话变量永久为空、状态栏只剩兜底值。**修法**：真正禁用输入（含按钮与全部提交路径）、
   窗口起点提前到打开会话、终点改为 `settleInitBusy()` 的就绪判据（会话就绪 + 宿主装配 + 有 MVU 脚本时
   **等宿主 iframe 内 `window.Mvu` 就位**），并去掉「第一个脚本返回就解锁」。

### 1.9 第七轮（用户报告"回复格式错误 → 正则失效"那轮）：1 个真缺陷 + 1 个真隐患

3. **切分器把带 info string 的围栏当收尾围栏**（**已确证并修复**）—— 用户原文：「回复的消息格式发生错误，
   导致正则失效，无法替换成状态栏渲染」。**先说证伪**：日志显示占位符**已被替换**（`hasPlaceholder:false`），
   所以不是正则失效，而是 `[frontend-card] 切分结果 {types: null, fenceLangs: ["```","```html","```"]}`。
   **根因**：`detect.ts` 注释写着"收尾围栏不得带 info string"，实现却是"任何围栏行都能收尾" ——
   正文里那个**未闭合的裸 ```**（美化正则留下的）把紧随其后的 ` ```html ` 卡片开围栏当成了自己的收尾，
   于是整条消息一张卡都切不出来，正文与状态栏 HTML 一起漏成纯文本。
   **修法**：`langOf()` + 收尾必须无 info string + 裸块内夹带标签围栏时跳过该裸块。
4. **`varPatchOverlayRef.clear()` 写在 render body 里**（**候选根因，待复测确认**）—— 用户原文：
   「我点重新生成消息后状态栏渲染出来，但正文不再出现」（日志同一时刻 `types:[markdown,card]` 而 head 直接是卡片，
   说明 markdown 段已空）。React 并发渲染可能丢弃一次渲染，清空却已发生 ⇒ 读路径拿不到未提交的补丁，
   脚本把**旧正文**写回覆盖。**修法**：清空移到 commit 后的 `useEffect`。

### 1.10 第八轮（用户报告"变量更新了但没进状态栏"那轮）：1 个真缺陷（探针盲区型）

5. **脚本经 `setChatMessages` 写变量不通知变量订阅者**（**已确证并修复，含反向对照**）—— 用户原文：
   「对话让 MVU 变量更新了，但更新的数值未进入状态栏」。
   **根因**：MVU 的变量权威形态是楼层的 `variables[0]`，它大量经
   `setChatMessages([{message_id, swipes_data}])` 直接写（initvar 与同步路径），底层是宿主
   `api.messages.update(...)` → `VariableAdapter.patchMessages` —— 这条路径**不经过**变量层的
   `writeScopeData`，所以**不 notify**，前端卡永远收不到重绘信号。
   ⚠️ **这是既有探针的盲区**：此前所有验证都走变量层 API（`updateVariablesWith`，它自己会 notify），
   于是"链路通"的结论把这条真实路径盖住了。**教训：验证必须走被测系统真正走的那条路。**
   **修法**：`scopes.ts` 导出 `notifyVariablesChanged()`；`ChatInterface` 的 `patchMessages` /
   `patchSession` / `commitSession` 在出现 `variables` 时各广播一次（重复通知幂等）。

### 1.11 第九轮（「数值还是没被更新」那轮）：1 个真缺陷 + 1 处同源残留

6. **`getChatMessages(n)` 违反 ST 契约**（**已确证并修复，本次问题的真正根因**）—— 用户原文：
   「状态栏上的数值还是没被 mvu 的变量更新」。
   **定位**：MVU 的变量更新入口（bundle `Yt(e)`）第一行就是
   `const t = getChatMessages(e).at(-1); const n = t.message;` —— 它要的是**最新那条消息**
   （本轮的 `<UpdateVariable>` 就在最新消息的正文里）。
   而我们把它实现成「只取第 n 条」⇒ `.at(-1)` 拿到的是**楼层 e 的正文**。
   真机上 MVU 拿到 `e=0`（开场白）时，每轮都在解析开场白、并把变量写回楼层 0 ⇒
   **最新 AI 楼层的变量永远是初值的拷贝**，而前端卡读的正是「最后一个有变量的楼层」⇒
   状态栏恒定显示初值（诊断快照里楼层 0 与楼层 2 的 `sdHead` 一字不差，就是直接证据）。
   **修法**：宿主侧 `normalizeRange()` 的 number 分支改为 `[start..last]`；卡片侧同步。
7. **宿主侧 `getAllVariables()` 仍是嵌套壳**（同一缺陷的残留）—— 卡片侧早已按 ST 扁平契约修正，
   宿主侧漏了。改为返回 message 作用域的扁平快照。

### 1.12 第十轮（回归 + 回滚 + 真根因）：1 个我引入的回归、1 个真结论

8. **⚠️ 我引入的回归：`getChatMessages(n)` 契约改动把消息正文逐层覆盖**（**已回滚并验证**）——
   上一轮（§1.11-6）判断"ST 契约应为从 n 到最新"，**该判断错误**。MVU 的 `Yt(e)` 是
   「`getChatMessages(e).at(-1)`（取最新）→ 处理 → `setChatMessages([{message_id:e}])`（写回 e）」，
   一旦前者返回 `[e..last]`，**每个楼层的事件都会拿最新消息的正文重写自己那一层**：
   用户截图实证 —— 消息 #0 / #2 的内容只剩 `<StatusPlaceHolderImpl/>`、状态栏错位、重新生成为空。
   **已回滚**宿主侧 `normalizeRange()` 与卡片侧 `window.getChatMessages`。
   **回滚验证**：`getChatMessages(0/1/2/'latest')` = 1/1/1/1；派发 `MESSAGE_RECEIVED(2)` 前后三层内容长度
   不变（30/2/29）。
   **教训**：`getChatMessages` 与 `setChatMessages` 是**配对**的公共契约，改一侧前必须做全局用法普查。
9. **变量不更新的真根因（与宿主无关）：模型输出缺少 `<JSONPatch>` 标签**（**已确证**）——
   新增快照字段 `mvuParse`（调用 MVU 自己的 `Mvu.parseMessage(最新消息正文, 该层变量)`）取证：
   `{"hasUpdateVariable":true,"hasPatchTag":false,"patchBlock":null,"changed":false}`。
   用户消息里是**裸 JSON 数组**，而 `Ft` 只认 `<JSONPatch>…</JSONPatch>` 或 `_.set(...)` ⇒
   解析 0 条命令 ⇒ **静默不更新**（`Ft` 每块 `try{}catch{}`，所以一条警告都没有）。
   **为什么看起来"有更新"**：卡的美化正则匹配整个 `<UpdateVariable>` 块，不要求 `<JSONPatch>`，
   于是折叠块能渲染出 patch，而 MVU 一条都没执行。

### 1.13 第十一轮（真根因）：`SillyTavern.chat` 引用不稳定 ⇒ MVU 静默放弃变量更新

10. **`SillyTavern.chat` 每次读都新建数组与元素对象**（**宿主缺陷，已修复并验证**）——
    用户连续多轮报「MVU 变量更新了，但状态栏数值永不变」。定位链（每一环都有日志/探针证据）：
    ① `mvuParse` 证明**消息格式完全正确**（`<JSONPatch>` 开闭各 1 个、合法 JSON、无零宽字符），
       但 `changed:false`、`patchOnlyChanged:false`；
    ② MVU 的 `Yt(e)` 用 `At(x)` 取变量，`At` → `Ct(e)` 只在 **`SillyTavern.chat`** 里找
       「同时含 `stat_data` 与 `schema` 的最新楼层」；
    ③ bundle 里 `SillyTavern.chat` **没有任何赋值点** ⇒ 必须宿主提供；
    ④ 宿主的 `buildSillyTavernShell` 提供了 `chat`，但 getter 每次 `map` 出新数组、新元素；
    ⑤ MVU 的 `jo` 守卫是 `const s = SillyTavern.chat[e]; … SillyTavern.chat[e] === s && …`
       （**引用相等**）⇒ 恒 false ⇒ `jo` 直接放弃、不调用 `Yt`。
    **这解释了全部反常**：变量不动、**console 零警告**、`write mid=0` 只来自 initvar。
    **修法**：`tavernChat()` 按内容指纹缓存（会话 id + 楼层数 + 各层 content 长度 + 各层 variables 的 hash），
    内容不变即返回**同一数组引用**。
    **验证**：`sameArray` false → **true**、`sameElement` 同样 true；端到端派发 `MESSAGE_RECEIVED(2)` 后
    楼层 2 = 好感度 **86**、性欲 **35**、場所 **同居公寓·卧室**，楼层 0 不变。
    **教训**：兼容壳的 "live getter" 只保证**内容最新**，不保证**引用稳定** —— 调用方一旦用 `===`
    比较，就必须加缓存。

### 1.14 第十二轮（真根因）：`identity` 空快照 ⇒ `{{user}}` 变空 ⇒ zod 校验永久失败

11. **`App.tsx` 传给 `createScriptHostApi` 的 `identity` 是空快照**（**宿主缺陷，已修复并端到端验证**）——
    用户连续多轮报「MVU 变量更新了，但状态栏数值永不变」。完整链条：
    ① `createScriptHostApi({ identity: { user: "", char: "" } })`（注释误以为"每次装配读一次即可"）；
    ② `scriptHostImpl` 里解构后，`macros.substitute` **闭包捕获该快照**，而它**每次调用**都读
       `identity.user` 替换 `{{user}}`；
    ③ `substitudeMacros('{{user}}')` → **空字符串**；
    ④ initvar 里的 `'{{user}}':` 键在 `stat_data` 中变成 `""`（真机 `sdKeys` 里那个空键就是它）；
    ⑤ `mvu_zod` 的 `Schema` 用**活值** `__mvuResolveUserKey()`（`getCurrentPersonaName()` = 真实用户名）
       ⇒ 键缺失且无兜底 ⇒ `safeParse` 失败；
    ⑥ `mag_command_parsed_for_zod` 处理器把命令 `_.pullAt` 掉、`_ended_for_zod` 再清空
       ⇒ MVU 主循环无命令可应用 ⇒ **变量永不更新**。
    **为什么零警告**：告警写作 `return l && s && n('warn', …)`，其中
    `l = Boolean($('#mvu_notification_error').prop('checked'))` —— 该复选框默认不在 DOM。
    **修法**：`App.tsx` 传**活对象（getter）**；`api.identity` 与 `macros.substitute` 同源活值。
    **验证**：修复前 `desire` 停 20 并报 `✖ Invalid input: expected object, received undefined → 路径: user`；
    修复后 `20→25`、无警告。

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

### 2.8 第六轮改动的文件（4 个，均在主仓）

| 文件 | 改动要点 |
|---|---|
| `src/components/ChatInterface.tsx` | ① `setVariableAdapter.getSession` 的 live/draft 两条分支改用 `patchArrayOverlay(messagesRef.current, varPatchOverlayRef.current)`（**读路径对齐落盘路径**，这是「状态栏落后一拍」的根因）；② `useSyncExternalStore(subscribeScriptInitBusy, getScriptInitBusy)` 订阅初始化忙碌状态；③ `handleSubmit` 增加初始化窗口二道闸；④ 把 `scriptInitBusy` 下发给 `ChatComposer` |
| `src/components/ChatComposer.tsx` | 新增 `scriptInitBusy?: boolean`：`textarea disabled`、placeholder 换成「正在初始化角色脚本…（完成前无法发送）」、表单 `onSubmit`／键盘 `submit()`／发送按钮三条路径全部早退、按钮 `disabled`，并在输入区下方显示转圈提示行 |
| `plugins/js-slash-runner/plugin.tsx` | ① 忙碌窗口起点提前到 mount 开头（等 `chatReady` 之前）；② `settleInitBusy({hasMvu})` 取代「第一个脚本返回即解锁」，就绪判据 = 会话就绪 + 宿主 iframe 已装配 + （有 MVU 脚本时）`window.Mvu` 就位；③ `INIT_BUSY_MAX_MS` 20s→60s（仅兜底）；④ 等 `chatReady` 6s→18s 且**超时不再照装**（放弃本次装配 + 放行输入，等 `session:changed` 重试）；⑤ `endBusy(reason)` 带原因日志，cleanup 里 `endBusy("disposed")` + `notice.remove()`；⑥ `BUILD_MARKER` → `v12-2400` |
| `plugins/js-slash-runner/executor/srcdocHost.ts` | 宿主脚本构建字面量同步抬到 `v12-2400`（日志归属用；改动前已按纪律跑 `check-script-host.ts`） |

## 3. 本轮新增的验证工具（已入 dev-server 仓）

`NyaaChat-dev.git`（独立仓）提交 `a4acd75`：

| 工具 | 用途 |
|---|---|
| `dev-server/tools/verify-js-slash-runner.py` | **§9 验收清单 V1–V8 的可复跑载体**（`--only V5` 单跑 / `--list` 看清单）。手写了最小 RFC6455/CDP 客户端 ⇒ 零新依赖；V4/V5/V8 用无头 Chrome 播种 IDB 驱动，V2b 用 UI 触发一次真实保存 |
| `dev-server/tools/verify-js-slash-runner-helpers.ts` | 上面那个脚本的 Node 侧助手：`pipeline` 模式离线跑真实 `buildRequestMessages`（V6 落位 + V7 逐字节比较），`devlog` 模式从落盘日志抽真实请求体（V6 实例证据）。**必须与 .py 一起改**：Python 侧只读它 stdout 的**一行 JSON** |
| `dev-server/tools/verify-card-status.ts` | **逐卡验证器**。每张卡一个独立 Chrome profile：用仓库自己的 `convertSillyTavernCharacter` 导入卡片 → 向 IDB 播种"插件启用 + 该卡为当前角色 + 开场白" → reload → 采集宿主 iframe 诊断、**每个卡片 iframe** 的 `getAllVariables()` 形状与渲染文本、切分结果、未捕获错误 |
| `dev-server/tools/diag-card-structure.ts` | 打印一张卡的脚本清单 / 世界书 `[initvar]` / 正则清单 / **状态栏 HTML 的 API 使用统计与读取相关行** |
| `dev-server/tools/diag-regex-replacement.ts` | 打印某条正则的替换文本、**围栏行普查**（哪一行是"整行只有围栏"），排查状态栏不渲染 |

用法：

```bash
python dev-server/tools/verify-js-slash-runner.py                 # §9 V1–V8 全套
python dev-server/tools/verify-js-slash-runner.py --only V5 --list
npx tsx dev-server/tools/verify-card-status.ts "<卡1.png>" "<卡2.png>"
npx tsx dev-server/tools/diag-card-structure.ts "<卡.png>"
npx tsx dev-server/tools/diag-regex-replacement.ts "<卡.png>"
```

**这两层是互补的**：`verify-js-slash-runner.py` 断的是**样例卡 + 框架行为**（V1–V8 的固定清单）；
`verify-card-status.ts` 断的是**任意一张卡的端到端**（用来复现"某张卡状态栏不对"）。本轮 5 个缺陷里，
4 个由后者定位，V2b/V6/V7 这三项此前根本没有载体、由前者补上。

---

### 3.1 新增：MVU 变量更新本地自测（**不依赖 LLM 对话**）

> 由 §1.14 那轮的排查成本催生：那轮消耗了大量用户时间与 token，而根因在本地 90 秒内即可定位。

| 交付 | 说明 |
|---|---|
| `dev-server/tools/probe-mvu-update.py` | 两阶段复现真机会话形态 → 等 `mvu_zod` 注册 → 打开其静默告警开关 → 派发 `MESSAGE_RECEIVED(2)` → 逐条 patch 断言；退出码 0/1 可作回归项 |
| `.docs/plugin-system/插件开发_JS-Slash-Runner/MVU变量更新-本地自测方法.md` | 原理、**三个必须遵守的前提**、观测点解读、失败对照表、范例、局限 |

**用法**：`python dev-server/tools/probe-mvu-update.py`（可 `--ops` / `--card` / `--no-notify-box` / `--keep-open`）。

**三条前提**：① 两阶段 seed（`At(e)=Ct(e)` 用 `chat.slice(0,e)`，不含第 e 层）；
② 等 `mvu_zod` 注册（约 30s；只等 `window.Mvu` 会走"无 zod"路径 ⇒ 变量正常更新 ⇒ **误判为已修复**）；
③ 打开 `#mvu_notification_error`（否则其校验失败**完全静默**）。

**反向对照**：`identity` 空快照版本 → 三条 `✗` + `路径: user` 报错 + 退出码 1；修复版本 → `✓✓✓` + 退出码 0。

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

### 4.4 §9 验收清单 V1–V8（`verify-js-slash-runner.py`，最终一跑）

`python dev-server/tools/verify-js-slash-runner.py` → **通过 8 / 失败 0 / 跳过 1**：

| # | 结果 | 关键证据 |
|---|---|---|
| V1 | ✅ | 容器内 `index-Co_OvTuh.js` 含 `js-slash-runner` / `nyaachat_vars_global` / `nyaCardDispatch` |
| V2 | – SKIP | 本地 `dist/` 比源码旧 666 分钟 ⇒ **不拿过期产物判失败**（该断言已由 V1 用容器内产物覆盖） |
| V2b | ✅ | 真实保存后 `Message.variables` 保留、`session.metadata` 被剥离 |
| V3 | ✅ | `/vendor/script-host/mvu/bundle.js` 的 sha256 = `b0f30a7d269ed5af…`，与 `PROVENANCE.md` 一致 |
| V4 | ✅ | 导入样例卡得 `MVU` + `mvu_zod` 两个脚本 |
| V5 | ✅ | starter 楼层 `stat_data` 含 `世界`/`舍友列表` |
| V6 | ✅ | 双证据：离线断言"动态落位 + 非空 YAML"；真实 devlog 里有非空 YAML 块（`世界: 当前时间 "07:30" …`） |
| V7 | ✅ | 静态前缀 843 B；同变量重复一致、**跨变量变化仍逐字节一致**；对照（不含宏条目仍留前缀）成立 |
| V8 | ✅ | 卡片 iframe 的 `getAllVariables().stat_data` 非空 |

**实现要点（三个坑，详见 SSOT §9 执行说明）**：

1. **零新依赖的 CDP**：宿主没有 `websocket-client`，脚本用 `socket + struct + base64` **手写了最小 RFC6455 客户端**，因此只需标准库 + `requests` 即可驱动无头 Chrome。
2. **V2b 必须触发一次真实写入**：`hydrateSessions()` 只把 `metadata` 从**内存**剥掉、**不写回 IDB**；落盘的剥离在 `saveSession()`。只播种+重载会**假失败**。脚本改为 UI 驱动一次真实发送（应用自己的保存链路）。
3. **V7 的切点不能用 `content.includes("<session_rules>")`**：协议锚的**说明文字本身**含该字样，会把"静态前缀"变成空串 ⇒ 字节比对退化成"空 == 空"的假通过。改为"**从第 1 条起、以 `<session_rules>` 开头**的那条消息"作切点，并加"前缀非空 + 含常驻条目"作前置守卫。

---

### 4.5 第二轮新增的两份可复跑清单（均全绿）

**(a) §8 P1 四作用域真机往返** —— `python dev-server/tools/verify-variables-scopes.py`：

```
✓ P1a  message：播种可读 → 改写落盘 → 重载读回**新值**
✓ P1b  chat：同上
✓ P1c  global：同上（IDB nyaachat_vars_global）
```

判据刻意是**"值真的换掉了"**而不是"键还在"：先播种初值、经插件变量 API
（`window.__nyaScriptHostBridge.api.variables.*`，即应用自己的写路径）改写成新值、
重载后同时从 **IDB** 与 **API** 两侧读回新值。只断言"存在"无法区分"没写进去"。

**(b) §2.4 spike S-b/S-c/S-d 运行期复核** —— `python dev-server/tools/verify-script-host-spike.py`：

```
✓ S-b  五个全局就位且可调用（$/_/z/YAML/TavernHelper，含 TavernHelper.getVariables）
✓ S-c  window.Mvu 已发布 + 事件名实测 = mag_variable_update_ended + window.parent.Mvu 镜像
       + global_Mvu_initialized 已派发（修复 §1.4 的缺陷之后）+ waitGlobalInitialized 存在
✓ S-d  注册期每脚本只读到自己的 id；**回调期**（注入探针在 eventOn 处理器里取值）同样是自己的 id
```

* **S-d 的结论是"模块局部常量方案成立、无需回退到一脚本一 iframe"** —— 这消除了 SSOT §2.4 里
  一直悬着的那条回退风险。回调期那半是用一段**注入探针脚本**做的（注册 `eventOn` 处理器读
  `getScriptId()`），因为真实卡片恰好没在回调里取值。
* **S-a 未单独复核**：srcdoc + importmap + 自托管 ESM 已由 §9 V3–V5 的运行期链路间接覆盖
  （vendor 可达 + MVU 起得来 + 变量落盘），但"**prod 构建下同样成立**"这一半仍未直接验证。
* 顺带修了 `initializeGlobal` 的语义：原先无论 `name` 是什么都派发 `global_Mvu_initialized`
  （对 `'Mvu'` 恰好等于契约公式、看着像对的），现按契约派发 `global_<name>_initialized`。

---

### 4.6 第三轮新增的三份证据

**(a) §2.7 事件接线矩阵** —— `python dev-server/tools/verify-script-host-spike.py --matrix`：

```
✓ EV:generation:started   [必须] 1 个发射点 —— src/components/ChatInterface.tsx:996
✓ EV:message:sent         [必须] 1 个发射点 —— src/components/ChatInterface.tsx:646
✓ EV:message:received     [必须] 1 个发射点 —— src/App.tsx:1058
✓ EV:session:changed      [必须] 1 个发射点 —— src/App.tsx:988
✓ EV:character:changed    [必须] 1 个发射点 —— src/App.tsx:996
✓ EV:message:deleted      [必须] 1 个发射点 —— src/components/ChatInterface.tsx:1573
– generation:stopped / message:rendered / worldinfo:updated / completion:settings-ready  （best-effort，未接线）
```

**首跑时前三条是缺的**（`generation:started` / `message:sent` / `message:deleted`），本轮补齐。
这个矩阵是"`global_Mvu_initialized` 从未派发"那件事的直接产物：
**"端到端全绿"证明不了"事件链完整"**。

**(b) §2.4 S-a 生产产物复核** —— `python dev-server/tools/verify-prod-artifacts.py`：**3/3 全绿**。
`npm run build` → 多线程静态服务器托管 `dist/` → 复用 `verify-card-status.ts`（新增 `NYAACHAT_ORIGIN` 覆盖）
跑真实卡片。关键证据：三个卡片 iframe 的 `getAllVariables().stat_data` 均非空、零未捕获错误；
资源计时显示 **56 个 closure 全部本地、CDN 请求 0 次**。

**(c) §8 P4 断言核实** —— `npx tsx dev-server/tools/check-card-scripts.ts`：**全绿**（[1]–[8] 覆盖
§8 P4 验收 1–7）。同轮修正一处过宽断言并做三种违规形态的反向验证。

---

### 4.7 第六轮的两份对照证据（修复前 → 修复后，同一探针）

**（a）状态栏重绘链路**（预置 `stat_data` 的探针：加载 → 读卡片文本 → 宿主写入 `MARKER_PLACE` → 等 2s 读文本）：

| 阶段 | 修复前（`v12-2300`） | 修复后（`v12-2400`） |
|---|---|---|
| 首渲染（预置 `場所 P0`） | `場所 P0`（读取链路正常） | `場所 P0` |
| 宿主写入 `MARKER_PLACE` 后（**不手动派发**） | `場所 P0` ← **旧值**；卡片事件计数器 `+1`（事件到了、数据没到） | **`場所 MARKER_PLACE`** ✅ |
| 手动 `__nyaCardDispatch` 一次 | `場所 MARKER_PLACE`（说明只差「再通知一次」） | 同值（幂等） |

**（b）初始化窗口是否真的挡住输入**（逐秒采样 `textarea.disabled` / 浮动提示 `opacity` / 宿主 iframe 的 `Mvu`）：

```
卡脚本名: ['MVU', 'mvu_zod']
t+ 0s {"build":"v12-2400","taDisabled":true, "noticeOpacity":"1","hostIframes":1,"hostMvu":"undefined","chatReady":true}
t+ 1s {"build":"v12-2400","taDisabled":false,"noticeOpacity":"0","hostIframes":1,"hostMvu":"object",   "chatReady":true}
```

⇒ 阻塞窗口 = 「等会话就绪 + 装配 + MVU 求值就位」，解除条件是 `window.Mvu` **就位**（= 变量系统真的起来了），
且完成后**自动恢复**输入（不会锁死）。修复前同一采样点的 `taDisabled` 恒为 `false`（只有一行不拦点击的提示）。

**（c）回归**：`verify-js-slash-runner.py` → **8 通过 / 0 失败 / 1 跳过**（V2 因 `dist/` 过期 SKIP，属既有口径）；
`npx tsc --noEmit` 无输出；`npx tsx dev-server/tools/check-script-host.ts` 全绿。

### 4.8 第七轮的证据

**（a）切分形态断言**（跑真实源码，17 个形态）→ **17/17 通过**。
**本轮已把它入库**（`detect.ts` 已经回归过两次，而它坏了的表现是「状态栏整块漏成正文」，光看代码发现不了）：
`npx tsx dev-server/tools/check-frontend-split.ts`（dev-server 仓）。

| 形态 | 结果 |
|---|---|
| ① 正文 + 成对裸 CSS 围栏 + 闭合 ` ```html ` 卡片 | `[markdown, card]` ✅ |
| ②【新】正文 + **未闭合**裸围栏 + 闭合 ` ```html ` 卡片（真机失败形态） | `[markdown, card]` ✅（改前 `null`），且卡片体内**不含**围栏行与裸 CSS |
| ③/④/⑤/⑥/⑦/⑧/⑨/⑩/⑪/⑫/⑬/⑭/⑮/⑯/⑰ | 全部与 §4.2 记录一致（含 CRLF、` ``` html ` 带空格、正文提及反引号、js/css 围栏、整段无围栏、未闭合普通块不切、两卡紧邻等） |

**（b）端到端**（种入真机失败形态的消息 → reload → 读 UI）：

```json
{"build":"v12-2500","cardCount":1,"cardIds":["nyaachat-card--1--0"],
 "cardTexts":["CARD_MARKER_9137"],"bodyHasProse":true,"bodyHasCardSource":false}
```

⇒ 正文留在气泡、卡片渲染成 iframe、卡片 HTML 源码不再漏出。

### 4.9 第八轮：一个探针盲区 + 一组反向对照

**（a）探针刻意改走 MVU 的真实路径**：`api.messages.update((msgs) => …)`（= `setChatMessages` 的底层），
而不是此前的 `api.variables.updateVariablesWith`。写入 `世界.当前场所：PLACE_A → PLACE_B`。

| 版本 | 变量层 `latestPlace` | 卡片文本 | 判定 |
|---|---|---|---|
| **去掉那行通知**（反向对照） | `PLACE_B` | `場所 PLACE_A`（+1s、+2s 均未变） | ❌ **精确复现用户症状** |
| 恢复通知（build `v12-2600`） | `PLACE_B` | **`場所 PLACE_B`**（+1s 内） | ✅ 状态栏跟上 |

**（b）回归**：`verify-js-slash-runner.py` 与 `check-frontend-split.ts` 均全绿（见 §4.10 口径）。

### 4.10 第九轮证据（契约语义的直接实测）

**（a）宿主 iframe 内的直接实测**（探针读 `iframe[data-js-slash-runner-host].contentWindow`）：

| 调用 | 修复前 | 修复后 | ST 契约 |
|---|---|---|---|
| `getChatMessages(0)` | **1 条**（id 0） | **3 条**（ids 0,1,2）✅ | 从 0 到最新 |
| `getChatMessages(2)` | 1 条（id 2） | 1 条（id 2）✅ | 从 2 到最新（仅 2） |
| `getChatMessages('latest')` | 1 条（id 2） | 1 条（id 2）✅ | 最新一条 |
| `getLastMessageId()` | 2 | 2 | 最后楼层下标 |

**（b）MVU 侧的因果链**（bundle 源码 + 真机 varTrace 对照）：
`Yt(e)` → `getChatMessages(e).at(-1)` 拿不到最新消息 ⇒ 解析楼层 e 的正文 ⇒
`updateVariablesWith(i, {type:'message', message_id:e})` 写回楼层 e。
真机 varTrace 里出现 `{k:"write", scope:"message", mid:0, idx:0}`，且逐楼层 `sdHead` 完全相同，
两个证据互相印证。

**（c）回归**：§9 V1–V8 → **8 通过 / 0 失败 / 1 跳过**；`tsc --noEmit` 干净；反引号守卫通过
（本轮**又被守卫拦下一次** —— 新写的注释里带了反引号，见 §5.3 纪律 4）。

### 4.11 第十轮证据

**（a）回归现象（用户截图）**：消息 #0 与 #2 的编辑框内容均为 `<StatusPlaceHolderImpl/>`；
状态栏卡片布局错位（場所栏换行）。

**（b）回滚验证**（探针读宿主 iframe）：

```json
阶段1: {"build":"v12-2800","getLastMessageId":2,"g0":1,"g1":1,"g2":1,"gLatest":1,
        "contents":[{"i":0,"len":30},{"i":1,"len":2},{"i":2,"len":29}]}
阶段2: 派发 MESSAGE_RECEIVED(2)
阶段3: {"g0":1,"g1":1,"g2":1,"gLatest":1,
        "contents":[{"i":0,"len":30},{"i":1,"len":2},{"i":2,"len":29}]}   ← 三层内容均未被改写
```

**（c）真根因取证**（`mvuParse` 快照字段，对**用户真实消息**调用 MVU 自己的解析器）：

```json
{"textLen":2278,"hasUpdateVariable":true,"hasPatchTag":false,"patchBlock":null,
 "before":"{..."好感度":85...}","after":"{..."好感度":85...}","changed":false}
```

**（d）工程纪律（本轮第三次加固）**：`executor/predefine.ts` 是模板字符串，**注释里出现反引号会直接
破坏编译**（本轮又中了一次，守卫拦下）—— 改该文件后必跑 `check-script-host.ts`。

### 4.12 第十一轮证据

**（a）引用稳定性**（探针读宿主 iframe 的 `window.SillyTavern`）：

| 版本 | `chat === chat` | `chat[2] === chat[2]` |
|---|---|---|
| 修复前 | **false** | **false** |
| 修复后 | **true** | **true** |

**（b）端到端**（真实导入卡 + 19 条世界书；派发 `MESSAGE_RECEIVED(2)`）：

```
派发前: 楼层0 = 85/20/同居公寓·客厅   楼层2 = 85/20/同居公寓·客厅
派发后: 楼层0 = 85/20/同居公寓·客厅   楼层2 = 86/35/同居公寓·卧室   ✅
```

**（c）方法论**：这一轮把「取证」做成了自动的（`mvuParse` 快照字段），并靠**逐层排除**收敛：
先证伪"模型格式问题"（Node 里复现 `Ft` 正则 4/4 通过 + `patchTag` 成对），再顺 `At`→`Ct`→
`SillyTavern.chat` 一路查到宿主自己的兼容壳。

### 4.13 第十二轮证据（端到端，本地自主复现真机）

**（a）复现方法**（关键，避免误判）：
1. 先只 seed **开场白** → MVU 把变量初始化到**楼层 0**（与真机会话一致）；
2. 导出楼层 0 的完整 variables（含严格 schema），用它重建 **3 层会话**（楼层 2 带 `<UpdateVariable>`）；
3. **等 `mvu_zod` 注册完成**（它 import 4 个 npm 模块，约 30s；只等 MVU 会走"无 zod"路径
   ⇒ 命令由 MVU 主循环应用 ⇒ **看起来修好了**，这是最容易误判的一步）；
4. 临时预置并勾选 `#mvu_notification_error`，让 zod 的失败现形。

**（b）结果对照**：

| 版本（zod 已注册） | 变量 | 日志 |
|---|---|---|
| 修复前 | `性欲 20`（不变）✗ | `[warn] 发生变量更新错误… ✖ Invalid input: expected object, received undefined → 路径: user` |
| 修复后 | **`性欲 25`** ✅ | 无警告（`Reconciling schema… / complete.`） |

**（c）回归**：`tsc --noEmit` 干净；反引号守卫通过；`check-frontend-split.ts` **17/17**；
§9 V1–V8 **8 通过 / 0 失败 / 1 跳过**。

## 5. 仍需继续验证 / 已知问题（**接手者请优先结账**）

### 5.1 未复核项（SSOT §11 同步登记）

> 三轮下来，原列的待办**只剩下面这 1 条**（外加 4 条 best-effort 事件，见 §4.6(a)）。

1. ⬜ **§2.7 的四条 best-effort 事件仍未接线**：`generation:stopped` / `message:rendered` /
   `worldinfo:updated` / `completion:settings-ready`。它们映射到脚本侧 BEST-EFFORT 档，
   本轮真实卡片（苏婷 / 变装女友）的状态栏与变量链均已跑通 ⇒ 补它们属于"扩大改动面"而非
   "修复已知缺陷"。**矩阵会持续把它们标成 SKIP，不会被误读成已接线。**
2. 🟡 **K1 已部分修复**：安全头（含 CSP 的 `frame-ancestors`/`base-uri`/`form-action`/`default-src` 等
   结构性限制）**已真正下发**，dev 与生产两侧都修好并有防漂移断言。
   **仍未做的是"收紧 `script-src` 到 `'self'`"** —— S-a4 实验已判定它**必须先迁移脚本载体**
   （把 srcdoc 的内联装配脚本外置成同源文件，靠 `import()` 加载），属独立改动；
   当前 CSP 保留 `'unsafe-inline'`，是**登记在案**的收窄缺口（SSOT §12 K1）。

> 第六轮又结掉两条**用户报告的真缺陷**（状态栏落后一拍 / 初始化提示不阻塞输入，见 §1.8 与 §4.7）。
> 已结账的（累计）：§9 V1–V8 9/9；§8 P1 三作用域真机往返；§2.4 S-a/S-b/S-c/S-d 全部；
> §8 P4 断言（早就有，本轮更正登记 + 收紧一处）；§2.7「必须」级 6/6。
> **V6 的"真实请求体位置"按设计取不到**（应用主动剥离 `renderedMessages`），已登记为结论。

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
> 先读：`.docs/阶段交接-插件系统-V1.md`（前一阶段）→ `.docs/plugin-system/插件开发_JS-Slash-Runner/开发计划-SSOT.md`
> （**唯一事实来源**：§2.7 事件接线现状、§8 状态总览、§9 验收清单、§11 变更记录、§12 已知问题 K1–K8）→
> `MVU技术性说明.md`（状态栏契约 §3.9/§4.6）→ `NyaaChat/CLAUDE.md` + `commit-push` skill。
>
> 当前状态：脚本执行层 / 变量层 / 卡片脚本 IO / 脚本库 UI / 前端卡状态栏注入**全部落地并复核通过**
> （dev 构建 `v12-2800`）。累计修 **16 个真缺陷/隐患**；第十轮另有 **1 个我引入的回归（已回滚）** 与 **1 个真结论（模型格式）**；第六轮那两条是用户症状驱动的：
> ③ **变量通知早于数据落地**（`getSession` 读路径丢了本帧补丁覆盖层）⇒ 状态栏恒定落后一拍（§1.8-1）；
> ④ **初始化提示不阻塞输入** ⇒ 用户抢发消息可让 MVU 在空聊天上完成**不可逆**的初始化（§1.8-2，SSOT §12 K9）。
> ⑤ **切分器把带 info string 的围栏当收尾** ⇒ 正文里的未闭合裸 ``` 把状态栏卡片围栏吃掉（§1.9-3）；
> ⑥ **`varPatchOverlayRef.clear()` 写在 render body** ⇒ 并发渲染丢弃时读路径丢补丁、旧正文被写回（§1.9-4）。
> ⑦ **脚本经 `setChatMessages` 写变量不通知订阅者** ⇒ 变量更新了、状态栏不动（§1.10；
>    此前探针只走变量层 API，属**探针盲区**）。
> ⑧ **`getChatMessages(n)` 违反 ST 契约**（只回第 n 条，而契约是「从 n 到最新」）⇒ MVU 的
>    `.at(-1)` 拿不到最新消息、变量被写回错误楼层 ⇒ 状态栏恒定显示初值（§1.11，**本次根因**）。
> ⑨ 宿主侧 `getAllVariables()` 仍是嵌套壳（卡片侧早已修正，同一缺陷的残留）。
> ⑩ **`SillyTavern.chat` 引用不稳定** ⇒ MVU 的引用相等守卫恒 false ⇒ 变量更新被静默放弃
>    （§1.13，**本轮真根因**）。
> ⑪ **`identity` 传空快照** ⇒ `{{user}}` 宏变空 ⇒ mvu_zod 的 safeParse 永久失败 ⇒
>    变量更新被**静默丢弃**（§1.14，**本轮真根因**）。
> 另两个只有专门断言才能发现的：
> ① `TAVERN_EVENTS` 运行期不存在 ⇒ `global_Mvu_initialized` 从未派发（§1.4）；
> ② §2.7「必须」级 6 条事件里有 3 条**根本没有发射点**（§1.5）。
>
> 已成体系的可复跑清单：
> ```bash
> python dev-server/tools/verify-js-slash-runner.py        # §9 V1–V8（9/9）
> python dev-server/tools/verify-variables-scopes.py       # §8 P1 三作用域往返（3/3）
> python dev-server/tools/verify-script-host-spike.py      # §2.4 S-b/S-c/S-d（3/3）
> python dev-server/tools/verify-script-host-spike.py --matrix   # §2.7 事件接线矩阵（6/6 必须）
> python dev-server/tools/verify-prod-artifacts.py         # §2.4 S-a 生产产物（3/3）
> npx tsx dev-server/tools/check-card-scripts.ts           # §8 P4 卡片 IO（全绿）
> ```
>
> 下一件事（按优先级）：
> ⓪ **若某会话曾踩过 K9**（变量恒空、状态栏只剩兜底值）：清掉该会话楼层变量里的 `initialized_lorebooks` 记名后重开，
>    让 MVU 重跑 initvar —— 本轮**未做自动自愈**（避免误删真实数据）；
> ① **补 §2.7 四条 best-effort 事件**（若用户要求把事件面做完整）—— 注意它们不阻塞任何已知功能；
> ② **K1（CSP 与安全头）独立立项**：修完必须同步迁移脚本载体与前端卡载体；
> ③ 若要让 §9 V6 有"真实请求体位置"证据，需要改 `App.tsx` 的 `SENSITIVE_LOG_META_KEYS` 策略
>    （当前**故意**剥离 `renderedMessages`，属安全设计，改前先确认这个取舍）。
>
> **关键约束**：改 `plugins/js-slash-runner/executor/{predefine,srcdocHost}.ts` 前**必跑**
> `npx tsx dev-server/tools/check-script-host.ts`——**模板字符串内部的注释里也不能出现反引号**（被拦过 3 次）；
> 不要用 PowerShell 重写源文件（改行尾会破坏 dev patch）；`.docs/` 下的文档是**纯 LF**；
> 写验证夹具时注意**并发性**（单线程静态服务器会让 MVU 的 56 个 closure 串行加载而超时 ⇒ 假阴性）；
> 未经明确要求**不** commit/push；`dev-server/` 是**独立仓库**（`NyaaChat-dev.git`，分支 `main`）。
