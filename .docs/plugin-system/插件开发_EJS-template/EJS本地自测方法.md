# EJS 渲染 · 本地自测方法（**不依赖 LLM 对话**）

> **定位**：对标 `../插件开发_JS-Slash-Runner/MVU变量更新-本地自测方法.md`，是 `ejs-template` 插件的**可复跑自测载体**。
> **状态**：⬜ 方法已定稿，**P0 落地脚本**；本文给出的命令在 P0 完成后可直接执行。
> **上游依据**：`EJS技术性说明.md`（引擎规格）、`开发计划-SSOT.md`（P0–P7 与 V1–V10）
> **取证时点**：2026-09-18，基准 `master @ 77723ee`

---

## 0. 一句话用法

> 运行器与命名遵循 `dev-server/tools/` 既有惯例（`.ts` + `npx tsx`，见 `check-variables-core.ts` 头部注释）。
> 产物落 **`dev-server/`**（独立仓），避免污染主仓工作树。

```powershell
cd H:\GitHub\NyaaChat

# ① P0：用上游引擎渲染 57 个含 EJS 的真实条目（共 1002 个块），产出黄金基准（随机源打桩）+ 语法面/env/lodash 清单
npx tsx dev-server/tools/verify-ejs-golden.ts

# ② P1：用自实现引擎渲染同一批块，逐字节比对
npx tsx dev-server/tools/verify-ejs-engine.ts

# ③ P3/P4：载体 + env 桥的端到端烟测（不碰 LLM，需 headless 浏览器，复用 _nya_cdp.py）
python dev-server/tools/verify-ejs-host-smoke.py
```

三个脚本都**不依赖 LLM**；①② 是纯 Node（无浏览器），③ 需要 headless 浏览器。

**产物落点**：`dev-server/ejs-golden/`（`golden.json` + `manifest.json` + `summary.md`）。
该目录需加入 `dev-server/.gitignore`（大产物不提交，可按需重跑再生）。

---

## 1. 它替你把什么搭了出来

| 环节 | 手工做很麻烦的地方 | 本方法代劳 |
|---|---|---|
| **取样本** | 从 PNG 解 base64 → JSON → 定位 `character_book.entries[*].content` → 切出含 EJS 的条目（57 个，共 1002 个块） | 脚本一键完成（解码逻辑见 `EJS技术性说明.md` §0.3） |
| **拿基准** | 在 Node 里跑 `[ejs.js]` 需要先解决 `require('../package.json')`（`:55`）与 CJS 包装 | 脚本内置最小 shim（见 §2.4） |
| **消除随机** | `_.random`/`_.sample` 让输出不可复现 | 脚本注入**可控随机源**（见 §2.3） |
| **比对** | 57 条目 / 1002 块人工比对不可行 | 逐块**逐字节**比对 + 差异归类 + 首个差异上下文 |
| **隔离 CSP** | 浏览器里 `new Function` 被 CSP 拦，报错信息容易误导 | 脚本显式断言"产物中不含 `eval`/`new Function`"（双方法交叉） |

**为什么必须先做这一步**：`js-slash-runner` 那轮的实证是"**静态全绿、真机全红**"——F1 blocker 与 5 个真机缺陷都是端到端才暴露（`阶段交接-插件系统-V1-第二阶段JS-Slash-Runner.md` §5.3）。EJS 的等价风险是"**自实现引擎看着对、某类模板静默渲染错**"，而黄金基准是唯一能在**不花 LLM 成本**的前提下把它逼出来的手段。

---

## 2. 必须遵守的前提（每一条都对应一个已知的坑）

### 2.1 引擎产物里**不允许出现** `eval` / `new Function`

- 原因：`nginx.conf:51/95` 的 CSP **无 `'unsafe-eval'`** ⇒ `eval`/`new Function` 被禁止。
- **特别注意**：`[ejs.js]:110`（`exports.promiseImpl = (new Function('return this;'))().Promise;`）是**模块加载期**执行 ⇒ **整包 import 就会炸**，报错点与"编译"无关，极易误判。
- 自测要求：比对脚本必须**双方法交叉**断言产物里既无 `new Function` 也无 `eval(`（源码 grep ∪ 产物 grep）。

### 2.2 `with` 需要**非严格模式** ⇒ 注入脚本必须是**普通 `<script>`（非 module）**

- 原因：上游用 `_with: true`（`[ejs.ts]:130`），生成的包裹里有 `with (locals || {})`；`with` 在严格模式（`type="module"`、`"use strict"`）下**语法非法**。
- 后果：若用 module 注入，会得到 `SyntaxError: Strict mode code may not include a with statement`，而模板本身看起来毫无问题。
- 自测要求：③ 号脚本断言载体注入用的是普通 script，且渲染成功。

### 2.3 输出**非确定** ⇒ 必须注入**可控随机源**

- 原因：★ 实测 `_.random` ×38、`_.sample` ×1、`_.sampleSize` ×1（`EJS技术性说明.md` §4.2）。
- 后果：不注入随机源时，"同输入两次输出逐字节相同"这类断言**根本不成立**；黄金基准也无法作为判据。
- 做法：`lodashSubset.ts` 暴露 `__setRandomSource(fn)`（仅测试/基准使用）；P0/P1 均设为**确定性序列**（如固定种子 PRNG 或"按调用序返回预置数组"）。
- 自测要求：同一输入连续渲染两次 ⇒ **逐字节相同**；把随机源换成另一序列 ⇒ 输出**确实变化**（反向验证：证明打桩真的生效，而不是"恰好没用到随机"）。

### 2.4 ✅ 在 Node 里跑上游 `[ejs.js]`：**实测无需任何 shim**

**实测结论（P0 探针，2026-09-18，Node v24.13.0）**：`[ejs.js]` 是 **browserify UMD bundle**（`:1`），Node 里**直接 `require` 即可**：

```powershell
node -e "const e=require('./.ref/ST-Prompt-Template/src/3rdparty/ejs.js');console.log(e.VERSION,typeof e.compile,typeof e.Template)"
# 实测输出：3.1.9 function function
```

- `require('../package.json')`（`:55`）**已被 browserify 内联**（取到的是 **ejs 自己的版本 `3.1.9`**），不需要造 `package.json`。
- `require('fs')` / `require('path')` 经 bundle 的模块系统**回落到 Node 内置**，正常可用。
- 该 bundle 是 UMD（`:1` 首行判断 `typeof exports==="object" && typeof module!=="undefined"`）⇒ Node CJS 分支生效。

**唯一要记住的一条**：`new Template(text, opts)` **不生成源码**，必须**手动** `t.generateSource()`（`compile()` 里才会自动调，见 `:587-588`）。

> ⚠️ 该结论**只适用于 Node**。浏览器里同一份文件仍**不可整包引入**——`:110` 在模块顶层执行 `new Function`，无 `'unsafe-eval'` 的 CSP 会立刻拦下（§2.1）。
> ⚠️ 不要修改 `.ref/` 下的上游文件（只读参考区）。

---

## 3. 观测点怎么读

| # | 观测点 | 读法 | 正常值 |
|---|---|---|---|
| O1 | **目标条目数 / 块总数** | `manifest.json` | **57 条目**（ok 57 / failed 0）；块总数 **1002**（实力至上 408 + 魔法少女 594） |
| O2 | **代码字符总量** | 同上 | **161,256** |
| O3 | **逐块差异数** | `ejs-compare` 摘要 | **0** |
| O4 | **首个差异上下文** | 差异块的前后 200 字符 + 生成源码对照 | 无 |
| O5 | **禁用原语扫描** | `grep` 产物 | `eval(` / `new Function` 命中 **0** |
| O6 | **随机源打桩有效性** | 两次渲染 + 换源对照 | 两次相同；换源后不同 |
| O7 | **未实现符号行为** | 构造一个调 `getchr` 的模板 | **抛错**且文案含 `getchr`（不是 `undefined`） |
| O8 | **含 `<%` 判定** | 对无标签文本调用 matches | `false`，且渲染输出 === 输入（M11 短路） |
| O9 | **载体端到端** | `ejs-host-smoke` | 1 块渲染成功、无残留 iframe、无 CSP 违规 |
| O10 | **尾 system 唯一性**（P4） | 出站数组末尾扫描 | system 计数 = 1，且次末条非 system |

---

## 4. 判定与常见失败对照

| 症状 | 最可能的原因 | 定位手段 |
|---|---|---|
| **0 块**（样本为空） | 卡的 EJS 不在 `character_book.entries[*].content`，或在 `comment` 里 | 打印 `entries` 字段分布（§附录） |
| 块数 ≠ 1002 | 正则 `<%(.*?)-?%>` 与引擎正则不等价（非贪婪 vs 最长匹配） | 改用 `_REGEX_STRING` 同款正则切分后再统计 |
| **目标条目数 ≠ 57** | 桩 env 不完整导致条目渲染抛错（P0 实测：缺 `YAML` ⇒ 2 条 `ReferenceError`） | 对照 `manifest.json` 的 `envSymbols` 补齐桩 env |
| **`SyntaxError: ... with statement`** | 用了 module / 严格模式（§2.2） | 检查注入脚本的 `type` |
| **`EvalError`/CSP 违规，且在渲染前就炸** | 整包 import 了 `[ejs.js]`（`:110` 模块加载期 `new Function`） | 只取 `generateSource`，或改用自实现 |
| 输出**每次都不一样** | 随机源未打桩（§2.3） | `__setRandomSource` 是否生效（O6 反向验证） |
| `<%_` 前后**多/少一个空行** | trim/slurp 规则实现错（M5） | 对照 `[ejs.js]:739-740` + `:823-832`，逐字符 diff |
| `<%=` 输出里 `"` 变成 `&quot;` | escapeXML 字符集写错（M10） | 必须是 `&#34;` / `&#39;` |
| `<%- undefined %>` 输出了字样 `undefined` | `__append` 未过滤 `undefined`/`null`（M7） | 对照 `[ejs.js]:591` |
| 末句分号报语法错 | 缺 `stripSemi`（M4） | 对照 `[ejs.js]:365` |
| `include is not defined` | 模板真的用了 `include`（上游 client 模式也不提供） | 按 NG 政策：**显式抛错**并给出符号名 |
| 差异集中在"含 `<%` 字样的块" | 嵌套平衡逻辑（`[ejs.js]:743-793`）未实现 | 单独为这类块建夹具 |
| 渲染成功率 100% 但真机无效果 | **缝隙未接通**（P4 未完成）：渲染了但没进 prompt | 跑 O10 + V3（请求体无 `<%` 泄漏） |

---

## 5. 相关文件

| 文件 | 角色 | 归属 |
|---|---|---|
| `.ref/EJS/*.json` | 卡样本（5 张，2 张依赖 EJS） | 参考区（**不进代码仓库**） |
| `.ref/ST-Prompt-Template/src/3rdparty/ejs.js` | 语义基准（**只读**，不改） | 参考区 |
| `dev-server/tools/verify-ejs-golden.ts` | P0：产出黄金基准 + 清单 | dev-server 独立仓 |
| `dev-server/tools/verify-ejs-engine.ts` | P1：逐块比对 | dev-server 独立仓 |
| `dev-server/tools/verify-ejs-host-smoke.py` | P3/P4：载体 + env 烟测 | dev-server 独立仓 |
| `dev-server/ejs-golden/` | 基准产物（`golden.json`/`manifest.json`/`summary.md`） | dev-server 独立仓（**须加 .gitignore**） |
| `plugins/EJS-template/lodashSubset.ts` | 可控随机源注入点 | 插件代码 |
| `plugins/EJS-template/engine/compile.ts` | 自实现引擎 | 插件代码 |

> **清理纪律**：P0 的临时 shim 目录、任何一次性脚本与调试 dump，完成后必须删除，并 `git status` 确认无残留（工作空间 MUST 规则）。
> `dev-server/ejs-golden/` 是可重跑的基准产物，保留在 dev-server 仓但不入库（`.gitignore`）。

---

## 6. 范例：用黄金基准定位一类偏差

> ⚠️ **如实标注**：以下为**按 `EJS技术性说明.md` 规格推导的预期偏差**，**不是**已经发生的真机案例。P1 实际比对后，本节应替换为**真实记录**（含提交号与块 id）。

**预期偏差 #1 ——「多一个空行」**

1. `ejs-compare` 报：`book[29]「[系统] H事件引擎」` 的第 3 个块输出多一个 `\n`。
2. 取该块原文，与基准输出做**逐字符 diff**，发现差异紧跟在 `_%>` 之后。
3. 对照规格：`[ejs.js]:823-832` 的 `truncate` 只吃 **一个**换行（`/^(?:\r\n|\r|\n)/`），且 `:739-740` 的 `_%>[ \t]*` 预处理会吃掉**同行后续空白**。
4. 结论：自实现把"吃一个换行"写成了"吃掉所有连续空白" ⇒ 修 `/^(?:\r\n|\r|\n)/` 的等价实现。
5. 回归：重跑 `ejs-compare` ⇒ 差异数回到 0。

**预期偏差 #2 ——「某块整体语法错」**

1. `ejs-compare` 报：`SyntaxError`，且块内含 `//` 行注释。
2. 对照规格：`[ejs.js]:899-901` 在 `//` 之后无换行时会**自动补 `\n`**。
3. 结论：自实现漏掉该保护 ⇒ 生成代码被行注释吞掉后续语句。

**预期偏差 #3 ——「含 `<%` 字样的块」**

1. 差异仅出现在正文里**真的写了 `<%` 字样**（如文档示例）的块。
2. 对照规格：`[ejs.js]:743-793` 的嵌套平衡 ⇒ 这类 token 不会被当作独立开标签。
3. 结论：自实现按"逐 token 简单处理"⇒ 需补嵌套平衡。

---

## 7. 局限（本方法**不覆盖**的部分）

| # | 不覆盖 | 为什么 | 谁来兜 |
|---|---|---|---|
| 1 | **真实请求体形态** | 该方法只到"条目文本渲染"，不到"请求组装/折叠" | P4 的 V1/V4/V5 |
| 2 | **缓存命中** | 需要真实 provider 的 `usage.cached_tokens` | P6 真机（V5） |
| 3 | **与 JSR/MVU 的时序交互** | 变量是本轮快照，非真实 MVU 写入序列 | P6 真机（两张卡端到端） |
| 4 | **死循环/超时** | 死循环会冻结进程（Node 侧无法安全中断） | 不做断言；仅登记 K1 + UI 明示（D12） |
| 5 | **R-a 误触发**（EJS 输出含合法 `<session_conventions …>`） | 概率极低、需要完整网络栈 | P6 的 V10（构造夹具 + 记录行为） |
| 6 | **更广卡池** | 本方法只用 5 张真实卡 | 按 NG 政策：未实现符号显式抛错（不做假想补全） |

---

## 8. 附：真机侧的自动快照（P5 落地）

插件 UI（**借鉴脚本运行器**）应内置一份只读快照，便于出问题时**不依赖 devtools** 定位：

| 字段 | 内容 |
|---|---|
| `build` | 构建标记（与 JSR 的 `BUILD_MARKER` 同做法，便于日志归属） |
| `enabled` | 插件启用状态 |
| `turn` | 本轮 `turnId` |
| `matched` | 本轮 `matches()` 命中的条目数 |
| `rendered` / `failed` | 渲染成功/降级条目数（**含失败条目的错误摘要**） |
| `blocks` | 本轮 EJS 块数 |
| `elapsedMs` | 渲染耗时 |
| `writes` | 本轮提交的变量写入条数 |
| `lastError` | 最近一次错误（用户可读文案，**含符号名与条目名**） |

**为什么必须有**：`ST扩展移植规范.md` §10.2 坑 #6 的原文教训是"失败时界面只闪一下 ❌，用户看不出为什么（原因仅在浏览器 console）"。本插件从第一天起就要把错误摆在面板上。
