# NyaaChat · EJS 模板插件（`ejs-template`）阶段交接 001 —— P1–P5 完成

## 交接目的

本文件是 **EJS 模板插件 P1–P5 交付**的交接记录。续接前必读（按顺序）：

1. `.docs/plugin-system/插件开发_EJS-template/开发计划-SSOT.md`（**唯一事实来源**：D1–D16 决策、九条口径、坐标、发现、缺口、教训）
2. `.docs/plugin-system/插件开发_EJS-template/审计报告-EJS模板渲染层.md`、`EJS技术性说明.md`、`EJS本地自测方法.md`
3. `dev-server/tools/verify-ejs-review.md`（**t12 终局交叉复核报告**，verdict = pass，含 F1–F5 发现清单与逐条覆盖审计）
4. `plugins/EJS-template/README.md`（插件侧保真度损失与未实现符号登记）
5. 上游参考：`.ref/ST-Prompt-Template/`（`3rd/.../ejs.js` 为 browserify UMD，含 ST 修改：`<%_`/`_%>` 预处理、嵌套标签平衡）

---

## 当前进度

**P1–P5 全部完成**，判据已在**最终冻结集**上由 captain 亲手复跑，全部 `exit 0`：

| 门禁 | 命令 | 结果 |
|---|---|---|
| P1 引擎判据 | `npx tsx dev-server/tools/verify-ejs-engine.ts`（及 `--lodash=subset`） | **一致 57/57、差异 0**、夹具 32/32 |
| P4 宿主判据（t11） | `npx tsx dev-server/tools/verify-ejs-host.ts` | **49 passed / 0 failed** |
| P1–P5 集成冒烟（t10） | `npx tsx dev-server/tools/verify-ejs-integration.ts` | **29/29** |
| 类型门禁 | `npx tsc --noEmit` | **exit 0** |
| 终局交叉复核（t12） | `dev-server/tools/verify-ejs-review.md` | **verdict = pass** |

**金标准未动**：`dev-server/ejs-golden/golden.json` SHA256 = `C00DC334081836DC78A478104B6BE73533DD0B9FE2DB859C2B26911E7CC58B82`。

---

## 本轮已实现（按文件）

**插件（`plugins/EJS-template/`）**

| 文件 | 内容 |
|---|---|
| `engine/syntax.ts` | EJS 定界符扫描 + 切分 + **嵌套标签平衡** + trim/slurp 预处理 |
| `engine/compile.ts` | 逐模式**源生成**（产出函数体源码字符串，**无 `eval`/`new Function`**）+ `include` 编译期显式抛错 + `templateHash` |
| `engine/escape.ts` | `escapeXML`（源码自包含，可内联进 srcdoc）/ `stripSemi` / 字面量转义 |
| `lodashSubset.ts` | 9 函数内联子集（零依赖、无 lodash import）+ `setRandomSource` 可控随机源 + 常驻自检 |
| `host/carrier.ts` | 轻量 srcdoc 载体：同源 iframe（**不加 sandbox**）、env **按引用**同源直读、模板以**普通 `<script>`** 注入并按 hash 缓存 |
| `host/env.ts` | 快照 + 7 符号（`getvar`/`getMessageVar`/`setvar`/`setMessageVar`/`getwi`/`YAML`/`_`）+ 作用域/路径口径 + **常驻自检 `assertEjsEnvSelfCheck()`（11/11）** |
| `host/renderEntry.ts` | 逐条目渲染编排（编译按需 + LRU 64 + 写入回放 + 幂等） |
| `plugin.tsx` | 装配：meta / setup 注册渲染器 + disposer / 渲染编排 / 软上限与降级（K3） |
| `EjsTemplateSettings.tsx` | 最小 UI：开关 / 统计 / 逐条目视图 / 试渲染 / 运行日志 / 安全告知（K1 死循环风险） |
| `errors.ts` | `describeEjsError` + 27 项未实现符号权威清单（零依赖） |

**宿主缝（`src/`）**

| 文件 | 内容 |
|---|---|
| `src/plugins/promptText.ts`（新增叶子模块） | `registerPromptTextRenderer` / `needsPromptText` / `preparePromptText` / `getPreparedPromptText` / `hasPreparedPromptText` + **D9 写入提交 `commitPromptTextWrites(turnId)`**（按 `turnId` 幂等、按「作用域+messageId」批次合并、`isForbiddenWritePath` 第二道闸） |
| `src/lib/chatPipeline.ts` | 前缀链抽取（`buildPrefixChain`，**pre-pass 与组装期共用同一份**）+ 三组分流（静态 / `═ 变量状态 ═` / **`═ 模板设定 ═`**）+ 空文本条目过滤 |
| `src/components/ChatInterface.tsx` | `activatedRules` 提升 + 一次 `await preparePromptText(...)` |
| `plugins/registry.ts` | 注册 `ejs-template` |

**判据脚本（`dev-server/tools/`，独立仓 `NyaaChat-dev`）**：`verify-ejs-golden.ts`（P0 基准）/ `verify-ejs-engine.ts`（P1）/ `verify-ejs-host.ts`（t11 宿主）/ `verify-ejs-integration.ts`（t10 集成）/ `verify-ejs-review.md`（t12 复核报告）+ 冻结基线 `dev-server/ejs-baseline/chatPipeline.ts.txt`。

---

## 本轮抓出并修掉的 8 个真问题（这是本次交付最有价值的部分）

| # | 问题 | 发现者 | 性质 |
|---|---|---|---|
| 1 | **K3 泄漏路径**：两条降级分支只写 `error` 不写 `text` ⇒ 条目被当成"渲染器未接管"⇒ **含 `<% %>` 的原文照发** | captain | 潜在 blocker（对本样本不可达） |
| 2 | **A6 回归**：修复 #1 时误伤"只含变量宏的常驻条目"⇒ 从 `═ 变量状态 ═` 消失（§2.6 字节不变承诺） | eng-tools（独立冒烟） | 可达 medium |
| 3 | **A3c**：插件中途停用时未清 prepared 缓存 ⇒ 含 EJS 条目两边都不在（静默丢条目） | eng-tools | 可达 medium |
| 4 | **`takeSessionWriteLog` 静默失配**：表键是 `session:<id>`、函数按原样查 ⇒ 恒返空数组 | eng-tools | 高（"每轮恰好一次"会静默退化为"一次都不提交"） |
| 5 | **`getScope('message')` 错语义**：读纯楼层树、而上游无 `withMsg` 时读**合并视图**——**且错语义已被写进一份自检"钉死"** | carrier 交叉核上游 → env-bridge 修 | 高（会一路传到 P6） |
| 6 | **`$` 前提错误**：写成"NyaaChat 没有 jQuery"，实为"**载体 env 无提供方**"（jQuery 只注入 JSR iframe） | errors-docs | 中（会误导范围评审出"新引一份 jQuery"的错方案） |
| 7 | **`scope:'cache'` 文档反向漂移**：文档写"无对应物 ⇒ 抛错"，实现早已是**合并视图近似**（更高保真） | errors-docs | 中 |
| 8 | **V1 基线提交后会退化为恒真**：基线取 `git show HEAD:` 且无守卫 ⇒ 提交后"自己比自己"却仍打印 ✓（判据**静默失效**） | verify-engine（t12-F1） | **中（最危险的一类：判据失效而无人察觉）** |

**共同规律**：后 7 个都不是靠"看谁说得像"发现的，而是靠**独立核上游源码 / 独立跑断言**。本轮共发生 **5 起"任务终态后继续改自己文件"**，若证据是"跑完即删的探针"，这些一个都抓不到。

---

## 仍需继续验证 / 已知问题

### 如实登记的缺口（**不得据此宣称全绿**）

1. **浏览器级 UI 三项**（面板开关生效 / 错误在面板可见 / 统计与实际渲染条目数一致）：仓库无 jsdom，且规范禁止未经用户要求起容器 ⇒ **用户已裁定登记为验证缺口、归 P6 真机验收**。
2. **Node/tsx 下 `YAML` 预热失败**：`env.ts` 用 `import.meta.url` 推 vendor 路径，在 Node 下解析到仓库外（**浏览器/生产正确**）⇒ 仅影响探针工效，脚本已按"已捕获并跳过"显式打印、不参与判定。
3. **`STATE.initialVariables` 缺失**：若某键的**唯一来源是 `[InitialVariables]` / `@@initial_variables` 装饰器条目**（**NG2 不做** ⇒ 在 NyaaChat **永不初始化**），则上游 cache 视图本应含它、而我们会**静默**回落 `defaults`（对其它缺失键的静默回落与上游一致、不构成偏差）。**结构性、无可验路径** ⇒ 只登记、**不做兜底**（兜底会偏离上游 oracle）。
4. **V5 缓存命中实测**（`usage.cached_tokens`）、**V10 R-a 探测**：不在本阶段脚本内。
5. **t12 复核颗粒度边界**：`verify-ejs-review.md` §4 的**逐条覆盖审计绑定原坐标**（host `d75909a2fbb9` / integration `c6dd5284`）；新修订（host `11e6ba0bf37e` / integration `42d2e4b3696e`）只做了 **delta 复核**（重跑六项 + 逐个读新增/改动项），**未重做**同等颗粒度的逐条覆盖审计。**不要写成"全面复核通过"。**

### 三条登记偏差（影响 0 或不阻塞）

- `keyword` + 含 EJS 的条目被移入 `═ 模板设定 ═` ⇒ 丢失原 `hard`/`soft` 分档（本样本仅 2 条且均 `enabled:false`）。
- 显式 `scope:'message'`：宿主侧 `env.ts` 读楼层树、载体 iframe 内读合并视图（卡里 0 处显式 scope ⇒ 不可观测）。
- 合并视图有**两份实现**（宿主侧**浅**合并只读 / 载体侧**深拷贝**做写入隔离）—— 语义同构、用途不同，**刻意保持两份**。

### 遗留物

- 仓库内有一个**不可达的临时提交对象 `6421131`**（t13 模拟"改动已提交"时产生；`reset --mixed` 只重置引用，无法被 push，不影响 `HEAD`/`log`/`status`）。**captain 裁定不清**——`git gc --prune=now` 属仓库级操作，应交用户按需执行。
- `verify-ejs-host.ts` 的**守卫④**（"`git HEAD` 版 == 冻结基线"）在**改动被提交后**会**有意报红**（提醒"别再拿 HEAD 当基线"）。若届时 CI 要求脚本 `exit 0`，把守卫④从 `check()` 降为 `console.warn`（保留 `[t12-F1 GUARD]` 全文）即可。
- 基线文件 `dev-server/ejs-baseline/chatPipeline.ts.txt` **刻意用 `.ts.txt`**：其相对 import 在 `dev-server/` 下无法解析，若叫 `.ts` 会被 `tsc` 拉进编译并报 8 个 TS2307。**日常迭代不要顺手刷新它**——那正是 F1 死灰复燃。

---

## 本轮沉淀的纪律（比任何单个实现细节更值得留）

1. **可复跑断言 > 口头结论，且断言本身也要被审** —— 错语义一旦被自检"钉死"，会比没有断言更危险（问题 #5 就是）。
2. **会被引用的坐标必须成对且确认稳定**：`哈希 + 字节数 + mtime + 门禁退出码`，且"**记录里的哈希**"必须与"**当前磁盘哈希**"**同轮**比对。本轮共发生 **5 次"消息里的哈希 ≠ 某一轮实测"**。
3. **"可复现输出" ≠ "可追溯时刻"** —— 判据脚本为保 golden 逐字节可比而**刻意不打印时间戳** ⇒ **取证时刻必须由外层证据日志记录**（谁跑 / 几点跑 / 贴了哪段原文）。
4. **`mtime` ≠ 内容变**：只有**哈希不同**、或**能确证写入晚于取证时刻**，才算"必须重取"。
5. **不要写死会漂移的行号**：文档引用一律"**以符号名为准**"，`file:line` 只算"核对时点的快照、**不作判据**"。
6. **"待验 / P6 可验"这类条件句必须有"存在可验路径"的实证**，否则就是美化（问题 #6、#7 两条都是这样被抓出来的）。
7. **"批准"不能替代"实证"** —— captain 批准的 `$` 前提与"P6 可验"两处措辞都被实测证伪。
8. **改完文件必须重报哈希**（连一次任务内的小步改动也算）；**做"伪造差异"实验必须群里报一声开始与恢复**（本轮 eng-tools 的常规跑撞上 host-slot 的回退实验，被误判为产品缺陷排查了一轮）。
9. **判据边界要自觉**：宿主单元判据用**桩渲染器**（不依赖真实渲染成功路径），真实插件 E2E 归集成冒烟 —— 两套独立实现覆盖同一不变量，互为兜底。

---

## 续接提示词（P6 真机验收）

```
继续 NyaaChat 的 EJS 模板插件（ejs-template）开发，当前处于 P6 真机验收阶段。
请以 plan 模式推进。

必读（按顺序）：
1. NyaaChat/.docs/plugin-system/插件开发_EJS-template/开发计划-SSOT.md   ← 唯一事实来源
2. NyaaChat/.docs/阶段交接-EJS模板插件-P1-P5.md                          ← 本文件
3. NyaaChat/dev-server/tools/verify-ejs-review.md                        ← t12 复核报告（verdict=pass + F1–F5）

当前进度：P1–P5 已全部完成并通过判据（engine 57/57 差异 0、host 49/0、integration 29/29、tsc exit 0、
t12 终局交叉复核 verdict=pass）。P1–P5 的产物均已冻结，坐标见 SSOT §14。

P6 要做的第一件事：起真实实例（本地 dev 测试机 http://127.0.0.1:4095/ 或 macmini 生产），
用两张目标卡跑端到端，逐条验收 SSOT §9 P6 的四项：
  ① 端到端生成成功且请求体无 `<% %>` 泄漏；
  ② 用 provider `usage.cached_tokens` 实测：含 EJS 条目退出前缀、其余条目仍命中；
  ③ `setvar` 每轮恰好一次（计数断言；注意真实卡是条件写 ⇒ 判据为"有写入的轮次恰好一次 + 任何轮次 ≤1"）；
  ④ 模板抛错时降级 + 日志可见 + 生成不被阻断。
另外补做 P1–P5 登记的三项浏览器级缺口：面板开关生效 / 错误在面板可见 / 统计与实际渲染条目数一致。

关键约束：
- 判据脚本一律**可复跑留档**，不许"跑完即删的探针"；坐标只取**同一轮输出**（用脚本自报坐标块）。
- 冻结基线 `dev-server/ejs-baseline/chatPipeline.ts.txt` 是 V1 判据的基准，**不要顺手刷新它**。
- 任何"任务终态后的改动"先报一声；改完文件立刻重报哈希。

已知缺口（不得写成"已通过"）：浏览器级 UI 三项、Node 下 YAML 预热失败、`STATE.initialVariables`
静默回落、V5 缓存命中、V10 R-a 探测、以及 t12 §4 逐条覆盖审计绑定的是**原坐标**。
```

---

*交接人：captain（本阶段全程自办高风险部分并保留最终裁定）*
*日期：2026-09-18*
*团队 `ejs-template-p1` 已于本阶段结束时归档（8 名成员 / 14 个任务）*
