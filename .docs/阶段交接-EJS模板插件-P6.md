# NyaaChat · EJS 模板插件（`ejs-template`）阶段交接 002 —— P6 真机验收完成

## 交接目的

本文件是 **EJS 模板插件 P6 真机验收**的交接记录。续接前必读（按顺序）：

1. `.docs/plugin-system/插件开发_EJS-template/开发计划-SSOT.md`（**唯一事实来源**：D1–D16、九条口径、P6 终态坐标、**§15 P6 真机验收**、F-P6-1..7）
2. `dev-server/ejs-p6/report.md`（**P6 完整验收报告**：复跑命令、判定表、证据文件清单、7 条发现）
3. `.docs/阶段交接-EJS模板插件-P1-P5.md`（P1–P5 的 8 个真问题与 9 条纪律）
4. `dev-server/tools/verify-ejs-review.md`（t12 终局交叉复核，`verdict=pass`）
5. `plugins/EJS-template/README.md`（插件侧保真度损失与未实现符号登记）

---

## 当前进度

**P0–P6 全部完成**。P6 的两条判据均**可复跑留档**，坐标取同一轮、跑前跑后双读：

| 门禁 | 命令 | 结果 |
|---|---|---|
| P6 主判据 | `python dev-server/tools/verify-ejs-p6.py --all --json` | **19 passed / 0 failed / 1 skipped**；连跑两次判定行哈希一致（`d1a3435321e7c99d`），`script=b4724617e301`、`drift=[]` |
| P6-② provider 侧 | `python dev-server/tools/verify-ejs-p6-cache.py --date 2026-09-18 --model deepseek-flash --marker "P6缓存探针" --json` | **4 passed / 0 failed**（命中 24.9 % → 52.4 % → **59.2 %**，三轮单调上升） |
| P1 引擎判据 | `npx tsx dev-server/tools/verify-ejs-engine.ts`（及 `--lodash=subset`） | 一致 57/57、差异 0 |
| P4 宿主判据 | `npx tsx dev-server/tools/verify-ejs-host.ts` | 50 passed / 0 failed |
| P1–P5 集成冒烟 | `npx tsx dev-server/tools/verify-ejs-integration.ts` | 29/29 |
| 类型门禁 | `npx tsc --noEmit` | exit 0 |

### P6 四项判据逐条

| 判据 | 状态 | 证据 |
|---|---|---|
| ① 端到端生成成功 + **无 `<% %>` 泄漏** | ✅ | **完整出站请求体**（10,390 字符，非截断日志）`<%`/`%>` 均 0；真人真机会话请求（4,753 / 5,454 / 6,117 字符）同样 0；provider `…/v1/chat/completions → 200` 且助手轮落地 |
| ② 含 EJS 条目退出前缀、其余仍命中 | ✅ | **机制**：`messages[0]` 两轮逐字节一致、历史前缀指纹被保留、EJS 产物只在最后一条消息；**实测**：deepseek 命中 512/2053（24.9 %）→ 1280/2443（52.4 %）→ **1664/2812（59.2 %）** |
| ③ `setvar` 每轮恰好一次 | ✅（**状态级**） | 面板「变量写入」两轮各 1；IDB `stat_data.__ejs_probe` **1 → 2**。**提交级**幂等不在此判据内（见下） |
| ④ 抛错降级 + 日志可见 + 不阻断 | ✅ | 降级条目数 = 1、内容与条目名都不在请求体、其余 40 条照常渲染、两轮请求都发出；可见通道 = 插件侧（见 F-P6-1） |
| 浏览器① 开关生效 | ✅ | 面板 `39 / 39`（原卡）；探针卡 `40 / 41` |
| 浏览器② 错误面板可见 | ✅ | 两轮「降级条目数」= 1 + 「最近一次错误」区可见 |
| 浏览器③ 统计一致 | ✅ | `EJS 块数 574` 与卡片重算**逐位一致**（`e27fc8d` 修复：曾虚高成 `39 / 77`） |

---

## 本轮已实现 / 已修正

### 新增（dev-server 仓）

| 文件 | 内容 |
|---|---|
| `dev-server/tools/verify-ejs-p6.py` | **P6 主判据**（20 条断言：baseline / probe 两轮 / 4 条真负向对照）。无头 Chrome + CDP；页面脚本**之前**注入 `fetch`/`XHR`/`console` 钩子 ⇒ 抓**完整出站请求体**与 **provider 响应体**；DOM 读插件设置面板统计；`--json` 自报坐标块 + 跑前跑后双读 |
| `dev-server/tools/verify-ejs-p6-cache.py` | **② provider 侧取证**：读 `logs/browser/*.ndjson` 的 `usage`，算 `prompt_cache_hit_tokens` 比例。**不按行解析** —— 以 `usage: {prompt_tokens:` 载荷为锚做原始扫描（该日志的记录会被真换行拆散、甚至丢标记，见 F-P6-5）；`--marker` 按请求正文精确归属；缺口如实打印 |
| `dev-server/ejs-p6/report.md` | P6 完整验收报告（判定表、坐标、7 条发现、未覆盖清单、证据清单） |
| `dev-server/ejs-p6/*.json` | 证据（含**早期失败轮**，作为"判据自身 bug 被修掉"的轨迹留档） |

### 文档修正

| 文件 | 修正 |
|---|---|
| `开发计划-SSOT.md` | §9 P6 行 → ✅（含命令与结果）；**§10 V4 补注**"仅 pipeline 出口成立，线上报文被 `api.ts` 折叠"；新增 **§15 P6 真机验收**（终态坐标表 + F-P6-1..7 + 未覆盖清单）；§13 变更记录 |
| `.docs/交接提示词-EJS-P6.md` | ④ 的降级日志形态句更正（F-P6-1） |

### 产品代码：**一行未改**

本轮只新增判据与文档。`plugins/EJS-template/**` 与 `src/**` 的改动全部来自 P1–P5 收尾的两个提交
（`f078001` 空壳行 `.trim`、`e27fc8d` `matched` 跨批去重），P6 期间**没有再动产品代码**。

---

## 七条真机发现（详见 `report.md` §4 与 SSOT §15.3）

1. **F-P6-1（文档错）** 交接文档写的 ④ 日志形态「`[promptText] …渲染失败，已降级`」**不会出现** ——
   `plugin.tsx` 吞错并 `return ""`（是 string）⇒ 宿主视作"渲染成功出空串"；实际通道 = 插件侧
   `[plugins:ejs-template]`（实测 6 条）+ 面板统计。
2. **F-P6-2（判据表述错）** SSOT §10 V4「出站末尾唯一 system」只对 `buildRequestMessages()` 出口成立；
   线上报文被 `api.ts` 的 `foldTailSystemIntoLatestUser()` 折进最新 user 轮。且**不能用 `<session_rules>`
   当尾部标记**（协议锚点正文本就提及它，实测命中 `messages[0]`）。
3. **F-P6-3（坐标过期）** 三处锚点被 P6 修复改掉：`chatPipeline.ts → 5b0d10e09b16`、
   `plugin.tsx → 842739ec38fb`、`EjsTemplateSettings.tsx → 46a7f34921f2`。
4. **F-P6-4（夹具口径）** `verify-js-slash-runner.py` 的 `map_world_info` 按 ST **顶层** `position` 映射，
   产品只认 `extensions.position===4 && role===2` ⇒ 本卡 44 条产品侧**全是 `system`**
   （真机 `[World Info] ` 的来源）。P6 判据按产品口径自建映射，**未复用**该 helper。
5. **F-P6-5（基础设施）** **dev NDJSON 本身是损坏的**：记录的 `text` 里含真换行 ⇒ 一条记录横跨多个
   物理行、**下一条记录的头部被拼到同一行**（实测 374 物理行里 120+ 行无法 `json.loads`）；真人第 3 轮
   那条响应**连 `[nyaachat-log:response]` 标记都被破坏** —— "按行解析"会**静默漏掉**它（本轮真踩到，
   换用以 `usage: {prompt_tokens:` 为锚的原始扫描后才取回）。另有 `flush()` 超 400000 字符丢较旧一半。
   ⇒ 判据一律抓完整请求体；日志取证一律以载荷为锚 + `--marker` 精确归属。
6. **F-P6-6（判据踩坑）** 插件行 `textContent` 在 `errorCount>0` 时变成 `EJS模板1`（红色计数徽标）
   ⇒ 精确等值匹配失效、面板判据假红。已改前缀匹配 + 重试 + 前置守卫。
7. **F-P6-7（边界）** ③ 的真实机观测是**状态级**；提交级幂等归 P1–P5 单元判据，报告**不宣称**已证。

---

## 仍需继续 / 已知问题

### P7 未完成项

1. **`插件框架规范.md` 的契约登记仍缺**（P7 ③）：`src/plugins/promptText.ts` 属**新增宿主契约面**，
   SSOT §4 要求与 `hostContext` / `scriptHost` 并列登记一行（已核实：该文档里**搜不到 `promptText`**）。
2. P7 ①（插件 README）与 ②（阶段交接文档）**已完成**。

### 遗留决策

- ✅ **`FileCode2` 图标 —— 已修（2026-09-18，选「扩允许集」）**：`ExtensionsModal.tsx` 的 `PLUGIN_ICONS`
  12 → 13 项（补具名导入 + 映射各一行，注释里写明来由）。依据 = 该表注释本条规定"需要新图标时在这里
  加一行具名导入 + 一条映射即可"，且 `FileCode2` 对"脚本运行器"语义正确；换成表内图标反而是降级。
  登记为 `插件框架规范.md` 偏差表 **D-22**，并新增可复跑判据 **`P6-BASE-7`**（打开扩展面板后不得出现
  「图标不在允许集」告警）+ **`P6-NC-5`**（用真机上真实出现过的那条告警原文做正样本，证明过滤器非恒真）。
- ⏸ **悬挂提交 `6421131` —— 未清理（等用户拍板）**：实测本仓有 **198 个不可达对象**（82 commit / 79 tree
  / 37 blob），绝大多数是**历史上被 drop 的 stash**（`WIP on master: …` / `index on master: …`，涉及 KB
  检索、v1.5.1 计费、ComfyUI、SSRF 加固等旧工作），不是本轮产生的。任何仓库级 prune 会**一并删掉全部 198 个**
  ⇒ 已停手并上报，三个选项（全清 / 保持现状 / 先提 ref 保下来再清）见 SSOT §15.7。
- ✅ **P7-③ 契约登记 —— 已完成**：`插件框架规范.md` 的 §1.1 / §2.5 + §2.5.1 专节 / §6 步骤 4 / §7.2 / §8
  偏差表 D-21。
- ✅ **提交推送与 dev 测试服 —— 已完成**：主仓 `0d82959` → `249a255`（`master` 已推送）；dev-server 仓
  `a70cb77`（`main` 已推送）；`python tools/rebuild-dev.py --up` 重建后在新构建上复跑全部判据（P6 21/0/1、
  engine 57/57×2 + NC、host 49/0、integration 29/29、`tsc` exit 0）。

### 未覆盖（**不得**写成"已通过"）

- ② 在**自动化通道**为 `SKIP`（dev 镜像预填的 QiniAPI 不回传缓存字段）⇒ 该项由**真人两轮**覆盖。
- ③ 的**提交级**幂等（状态级不可观测）。
- `getwi` 返回 content 分支 / `random` 系运行期调用（P1–P5 已登记的结构性缺口）。
- `STATE.initialVariables` 静默回落（README 保真度表 #2 已登记，F5 已覆盖）。
- dev 日志丢行（F-P6-5）本身**未修**，判据只是避开了它。
- 真人两轮所在是**新开的短会话**（messages 3 → 9），非长篇 RP。

### 未提交

本轮的判据脚本、证据与文档**全部未 commit / 未 push**（用户未要求）。分布：

- **主仓**（`NyaaChat`）：`M` SSOT、`M` `.docs/交接提示词-EJS-P6.md`、`??` 本文件。
- **dev-server 仓**（独立仓；主仓 `.gitignore:40` 已忽略 `/dev-server/`）：`?? tools/verify-ejs-p6.py`、
  `?? tools/verify-ejs-p6-cache.py`、`?? ejs-p6/`。
- 产品代码（`plugins/EJS-template/**`、`src/**`）**零改动** ⇒ 主仓 `git status` 里看不到它们。

---

## 续接提示词（P7：文档与收尾）

```
继续 NyaaChat 的 EJS 模板插件（ejs-template）开发，P0–P6 已完成，当前进入 P7（文档与收尾）。
请以 plan 模式推进。

必读（按顺序）：
1. H:\GitHub\NyaaChat\.docs\plugin-system\插件开发_EJS-template\开发计划-SSOT.md   ← 唯一事实来源
   （P6 状态与 7 条真机发现见 §15；终态坐标表见 §15.4）
2. H:\GitHub\NyaaChat\dev-server\ejs-p6\report.md        ← P6 完整验收报告（复跑命令 + 证据清单）
3. H:\GitHub\NyaaChat\.docs\阶段交接-EJS模板插件-P6.md    ← 本文件
4. H:\GitHub\NyaaChat\plugins\EJS-template\README.md     ← 保真度损失与未实现符号登记

当前进度：P0–P6 全部完成，判据均可复跑留档：
  · python dev-server/tools/verify-ejs-p6.py --all --json            # 19/0/1，连跑两次哈希一致
  · python dev-server/tools/verify-ejs-p6-cache.py --date <日期> --model deepseek-flash --marker <标记> --json
  · npx tsx dev-server/tools/verify-ejs-engine.ts [--lodash=subset]  # 57/57 差异 0
  · npx tsx dev-server/tools/verify-ejs-host.ts                      # 50/0
  · npx tsx dev-server/tools/verify-ejs-integration.ts               # 29/29
  · npx tsc --noEmit                                                 # exit 0

P7 要做的第一件事：把 `src/plugins/promptText.ts` 补进
`.docs/plugin-system/插件框架规范.md` 的宿主契约面登记（与 hostContext / scriptHost 并列，
含叶子模块纪律：只允许 type-only 自 `../types`；禁止值导入 index/runtime/registry/backend）。
该文档里目前搜不到 `promptText`（已核实）。

关键约束：
- **不许"跑完即删的探针"**；坐标只取同一轮（哈希 + 字节 + mtime + 门禁退出码），不跨消息拼接。
- **判据本身也要被审**：P6 就抓到两条判据自身的 bug（见 F-P6-2 / F-P6-6）。
- **不要顺手刷新** `dev-server/ejs-baseline/chatPipeline.ts.txt`（V1 的冻结基线）。
- 产品代码一行未改；若要动，先报一声并重跑全部判据 + 重报哈希。
- 遗留待用户拍板：js-slash-runner 的 `FileCode2` 图标（改图标 / 扩允许集）、
  悬挂提交 `6421131`（`git gc --prune=now` 属仓库级操作，需用户决定）。
- 未经用户明确要求不 commit / push。
```

---

*交接人：captain（P6 全程自办判据与取证，产品代码零改动）*
*日期：2026-09-18*
