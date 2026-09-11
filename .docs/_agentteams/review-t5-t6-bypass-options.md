# 复审记录 t6：汇总文档落位章节是否忠实对齐 Q3 v3

> 复审对象：`H:\GitHub\NyaaChat\.docs\AnswererFlagalac-可行性考察汇总.md`（904 行 / 132,654 字节 / mtime 2026-09-12 00:34:07）
> 被复审任务：t5（repair，作者 synthesizer，attempt 2）
> 复审人：`bypass-options`（Q3 报告 v3 作者）
> 复审时间：本轮回合；**只读复审**，未修改被复审文档、未修改任何业务源码
> 结论：**needs_revision**（t5 的 9 条声明改动全部核实为真；但仍有 8 处 v1 残句未被覆盖，其中 1 处落在「开发前置条件清单」内，与本文档自身基线（E1-first）直接冲突）

---

## 1. 独立复跑的 verify 实测输出（未采信作者自报）

```
PS> Select-String -Path '.docs\AnswererFlagalac-可行性考察汇总.md' -Pattern 'E1-first','K1','V11','V12','可选增强','M1','M5' | Group-Object Pattern | Select-Object Name,Count

Name      Count
----      -----
可选增强      2
E1-first    24
K1          12
M1          13
M5           7
V11         10
V12          2

PS> Select-String -Path '.docs\AnswererFlagalac-可行性考察汇总.md' -Pattern '无 absolute','无 depth','无该通道'
hits=0

PS> git status --short
 M src/App.tsx
 M src/components/BypassModal.tsx
 M src/lib/settingsBackup.ts
 M src/types.ts
?? ".docs/AnswererFlagalac-可行性考察汇总.md"
?? .docs/_agentteams/
?? src/lib/FlagalacTemplates.ts
```

**判定**：三条 verify 与 t5 自报的计数**逐项一致**（E1-first=24 / K1=12 / V11=10 / V12=2 / 可选增强=2 / M1=13 / M5=7；旧断言 0 命中；git status 仅 `.docs/` 新增）。**t5 的自报是可信的**。

另有 mtime 复核：被复审文档 `2026/9/12 0:34:07`（与 t5 自报 00:34 一致）；`src/` 下 5 项均为 `2026/9/11 23:33`（属此前 UI 轮次，非本次产物）。

---

## 2. 逐条 acceptance 判定

| # | acceptance 项 | 判定 | 证据 |
|---|---|---|---|
| 1 | 独立复跑三条 verify 并原样给出 | **passed** | 见 §1，计数逐项一致 |
| 2 | §12.6 表述（需用户拍板 + 不改变基线）与 §5.5/§5.2/§1 不矛盾；§12.7 交叉自检逐条 | **passed（含 1 处 low finding F8）** | §12.6 line 870/889-891 明写「不以"已被取代"结案」「不是与 E1-first 并行的第二套基线 —— 首版一律按 E1-first 实施，本挑战不阻塞任何开发」「须用户/负责人拍板」；§12.7 四行与 §5.5/§12.2 逐条相符（7 载荷落位、L1 须 V10+V11、不是两方案待选、分歧只在 §12.6） |
| 3 | 位置类表述忠实（§3.2 B3 / §5.4(a) / §6.2 / §9.9 第 3 行） | **部分失败（F3/F4）** | 四个指定位置**全部正确**（B3 line 122、§5.4(a) 修正 3 line 331、§6.2 line 502、§9.9 第 3 行 line 697 均写「有注册位 `compat/stContext.ts:67`、无消费点 `:79` ⇒ 现成未接线、小–中改造」）；但**同类的第 5、第 6 处未同步**：§2 术语表 line 85 仍写「NyaaChat **无此通道**」、§5.8 C6 line 444 仍写「无绝对注入/预填/停止串三通道」——即 Q2 修正所禁止的「缩小成不可实现」表述仍存活 |
| 4 | §11 R1 全链路与源码相符 | **passed（逐处回源核实）** | `bypassTemplates.ts:38`（唯一门控 `if (!settings.bypass.enabled) return messages;`）、`:63-69`（7 条 `addPrompt`）、`:72-78`（splice 到 index 1）**全部实测相符**；`BypassModal.tsx:479` `checked={localSettings.bypass.enabled}`、`:486` 门控、注释块 467-610 **相符**；`App.tsx:87` 读版本、`:107-109` 仅在 `_version<8` 调 v7→v8、`migrateV7ToV8:123-131` 强制 false、`:756` 落盘 `_version: SCHEMA_VERSION(9)`（`:83`）**相符**；`settingsBackup.ts:424` 取 `bp`、`:455-468` 只补子对象、**全段无 `bp.enabled` 写入**；`SettingsModal.tsx:174-177` → `onSave(pendingImport)` **相符** |
| 5 | R2 四条 identifier 与预设实际一致，且要求映射表带 preset 维度 | **passed** | 逐条与我此前的预设解析结果比对：`2f2729f4`（P4 disclaimer_format / P37 censorship_bypass）、`3df19ba7`（P4 role=user 瞬发防输入截断 / P37 role=system 世界书设定）、`91918c0a`（P4 预填 / P37 `<\|no-convert\|>`）、`820a1944`（P4 `<\|check\|>` / P37 继续上文创作）**全部相符**；line 794/796 明确要求 preset 维度并在 §7 B5 落实为编码约定 |
| 6 | 未修改业务源码 | **passed** | 见 §1 git status + mtime |
| 补充 | 引用 Q3 的文件:行号是否张冠李戴 | **passed** | 抽查 §12.6 引「Q3 附录 A.1 order#3 / A.2 order#2」（`enhanceDefinitions` 在两份预设的实际 order 下标正是 3 / 2）、「P4 `main` = order#0 = role:user」（相符）；§5.10 引用的 Q3 §5.1/§6.1/§6.2/§6.4/§6.5 与 V10/V11/V12 编号全部存在且语义对应；未发现张冠李戴 |

**t5 的 9 条声明改动，逐条核实全部为真**（§12 全章、§5.5、§5.2 落位列、§3.2 B3/§5.4(a)/§6.2/§9.9、§1 速览 Q3 段、§8 U1/U21/U22 均已按 v3 落地）。失败项不在 t5 的声明改动清单内，而是**它未触及的章节里残留的 v1 片段**。

---

## 3. findings（8 处，均与被复审文档有关；修复工作量均很小，纯文档编辑）

### F1｜【high】开发前置条件清单把两个载荷指到 L1，与本文基线冲突
- 位置：`AnswererFlagalac-可行性考察汇总.md:545`（§7 P2 「C2 注入逻辑第一批」）
- 原文：`traceCleanup（L5，零改造）、identityCard/dualModelCard（L1）、refusalImmunity/disclaimerSpell/unicodeEncoding（L2，并入唯一尾块）`
- 问题：v3 基线是 **7 个载荷默认全落 E1**（本文 §1 line 57、§5.2 line 294/297、§5.5 line 353、§12.2 line 828、§12.7 line 897），L1 为「默认关、须 V10+V11、不在首版」（line 352、§12.4）。该行却把 `identityCard`/`dualModelCard` 放进 P2（可并行推进的第一批）并标 **L1**——实现者按此清单排期就会把身份类载荷写进静态前缀，**正是 K1 所禁止的设计**；同时与 §5.9 line 453（P3 = M1 + M4，M1 为「1 处改造供 5 个选项共用」）自相矛盾。
- requiredFix：改为 `identityCard/dualModelCard/refusalImmunity/disclaimerSpell/unicodeEncoding（E1 尾 system 新块，共用 M1 一处改造）`，并注明「L1 不在首版」。

### F2｜【medium】P0 阻塞项 A1 的理由仍是 v1 口径
- 位置：`:523`（§7 P0 A1）
- 原文：`P4→L2 与 P37→L1 的整个落位映射都建立在它之上；若为假，Q3 的 L1/L2 分配要重做`
- 问题：与 §8 U1 line 573（「v3 口径下它**不再是首版阻塞项**……只决定 L1『可选增强』是否有收益」）、§12.5 line 864（「首版不需要 U1 成立即可实施」）、§4/§9 M4 line 641 相互矛盾；`P37→L1` 已非现行映射。
- requiredFix：改为「本项只决定 L1 可选退路（V10/V11）是否有收益；**E1-first 首版不依赖它**。仍建议尽早实测以便决定 L1 是否值得启用」。

### F3｜【medium】术语统一表仍写「无此通道」（位置类旧口径，t5 漏改的第 5 处）
- 位置：`:85`（§2 术语统一表「绝对注入 depth=0」行）
- 原文：`…独立注入位（猫神报告 §2.1、§4.10）。NyaaChat 无此通道`
- 问题：与本文 §3.2 B3 line 122 / §5.4(a) line 331 / §6.2 line 502 / §9.9 line 697 以及 Q2 的更正（有注册位无消费点）冲突；术语表是全文权威口径表。**t5 的 verify2 检索词（`无 absolute|无 depth|无该通道`）未覆盖「无此通道」这一写法，故未被发现**。
- requiredFix：改为「`setExtensionPrompt`（`compat/stContext.ts:67`）有注册位，但 `getExtensionPrompts`（`:79`）全仓无消费点 ⇒ 现成未接线、需小–中改造；即便接线也只能并入 E1 新块」；并把 verify 检索词扩为 `无 absolute|无 depth|无该通道|无此通道|没有通道`。

### F4｜【medium】§5.8 的 C6 摘要未同步 Q3 v3 的 C6 改写
- 位置：`:444`（§5.8 冲突清单摘要 C6 行）
- 原文：`NyaaChat 无绝对注入/预填/停止串三通道，照抄条目位置会落空`
- 问题：Q3 v3 的 C6 已改写为「缺 request-side 能力：无 prefill、无 `stop`（**Q2 修正：位置类不是"无通道"，而是有注册位无消费点**）、Anthropic `max_tokens` 硬编码 4096」。本文自称「Q3 的冲突与风险清单（摘要）」，却保留了被 Q3 自己废弃的 v1 措辞，属同类「缩小成不可实现」。
- requiredFix：按 Q3 v3 C6 原文重写该行（含 `api.ts:859` 的 `max_tokens:4096` 与「位置类有注册位无消费点」两点）。

### F5｜【low】§5.8 的 C7 仍是 v1 措辞
- 位置：`:445`（C7 行）
- 原文：`P37 载荷放 L1 时只在改开关/编辑文本时变一次；禁止把每轮变化内容塞进 L1`
- 问题：P37 载荷现落 E1；且缺 Q3 v3 C7 的关键信息（E1-first 收敛、L1 需 UI 明示缓存代价）。
- requiredFix：改为「落静态前缀的载荷（仅 L1 可选退路）会击穿前缀缓存；首版 E1 不受影响；禁止把每轮变化内容塞进 L1」。

### F6｜【low】§6.1 推导链把 `identityCard` 说成 L1
- 位置：`:490`（§6.1 第 2 条）
- 原文：`这与 Q3 把 identityCard 放 L1（静态前缀）不冲突（锚点句恒定，载荷文本可随开关变）`
- 问题：v1 残留（v3 已改 E1）；且括注忽略 K1 的缓存代价，与本行自身「避免按开关动态改变静态前缀」的上下文张力。
- requiredFix：改为「这与 Q3 v3 的 E1-first 基线不冲突（锚点恒定 vs 载荷随配置变）；若载荷改走 L1，则触发 §12.6/K1 的缓存代价，须先过 V10/V11」。

### F7｜【low】术语表交叉引用错误
- 位置：`:84`（§2 术语表「前导 system 进 systemInstruction」行）
- 原文：`**未实测**，见 §8 M4`
- 问题：M4 在 **§9**（来源报告间矛盾），§8.1 里是 **U1**；引用混编。
- requiredFix：改为「见 §8 U1 / §9 M4」。

### F8｜【low】§12.7 交叉自检第 1 行的「全部标注 E1」不够精确
- 位置：`:897`（§12.7 表第 1 行）
- 原文：`| 7 个载荷的默认落位 | 全部标注 E1（L1 明确"默认不用"） | §12.2：全部落 E1 | ✅ 一致 |`
- 问题：§5.2/§5.5 中 `toolChannel` 为 **L4**（工具通道）、`traceCleanup` 为 **L5**（正则层）、`unicodeEncoding` 另含 **L6** 响应侧解码；「全部标注 E1」对这三行不成立。**注意：该措辞源于 Q3 v3 §6.1 的 L2 行（「全部 7 个载荷默认都落这里」），属两文档共享的措辞不精确**——本条不算 t5 引入的偏差，但既是交叉自检表，就应精确。
- requiredFix：改为「5 个注入类载荷 + `traceCleanup` 的规则文本落 E1；`toolChannel` = L4、`traceCleanup` = L5、`unicodeEncoding` 另含 L6 解码」；建议 Q3 v3 §6.1 的同一措辞一并收敛（可另行处理）。

---

## 4. 我抽查过的 Q3 引用清单（用于核对，不构成 finding）

| 本文引用 | 被引内容 | 核对结果 |
|---|---|---|
| §1 line 57、§5.2 line 294/297、§5.5 line 353、§12.2 line 828 | Q3 v3 §5.1 七开关表 / §6.1 L2 行 / §6.4-K1 | ✅ 落位、默认值、L1 门槛一致 |
| §5.2 line 302-308 | Q3 v3 §5.1「载荷默认文本必须按 NyaaChat 现状裁剪」 | ✅ 三项删改逐条对应 |
| §5.4(a) line 328-331 | Q3 v3 §5.3(a) 停止串/预填/位置类三行 | ✅ 与 v3 行内容一致 |
| §5.9 line 453、§5.10 line 469-477 | Q3 v3 §10 阶段划分 + §6.5 M1–M5 表 | ✅ M1 五项共用、M2 工具、M3 接线、M4 正则、M5 stop+max_tokens 全对 |
| §8 U20/U21/U22 line 580/581/593 | Q3 v3 V10/V11/V12 | ✅ 语义与验证方法一致 |
| §9 M4 line 638、M9 line 674-681、§9.9 line 697/698/699/702、§9.10 line 716-720 | Q3 v1→v3 演进与 K1 记录 | ✅ 历史记录定位正确、无一处被当作现行结论 |
| §12.6 line 876 | Q3 附录 A.1 order#3 / A.2 order#2（`enhanceDefinitions`）、A.1 order#0（`main` role=user） | ✅ identifier/order/role 全对 |

---

## 5. 声明

本次为**只读复审**：未修改被复审文档 `AnswererFlagalac-可行性考察汇总.md`，未修改 `src/` 下任何业务源码（git status 与 mtime 见 §1），唯一写入物是本复审记录。所有 finding 均为**文本修正类**，不含代码改动。
