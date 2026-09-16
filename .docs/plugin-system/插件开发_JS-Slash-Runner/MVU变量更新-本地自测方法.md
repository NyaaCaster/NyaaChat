# MVU 变量更新 · 本地自测方法（**不依赖 LLM 对话**）

> **目的**：把「MVU 的变量更新能否真正落到楼层变量上」变成**一条命令、可复跑、结论明确**的验证，
> 不再靠人肉对话试错 —— 那既消耗时间也消耗 token，而且每一轮只能看到一个现象。
>
> **首次沉淀**：2026-09-17 排查「状态栏数值永不更新」。真根因与定位过程见 §6，可以当作本方法的范例。
>
> **前置**：dev 栈已在 `http://127.0.0.1:4095` 运行（`python dev-server/tools/rebuild-dev.py --up`）。

---

## 0. 一句话用法

```bash
# 在 NyaaChat 仓根执行
python dev-server/tools/probe-mvu-update.py
```

输出形如（退出码 0 = 通过，1 = 未通过）：

```
✓ 楼层 0 变量已就绪
✓ mvu_zod 已注册（捕获到它的「变量结构注册成功」日志）
通知开关：checked | Ct(2) 下标：0
  ✓ replace  世界.当前场所     '同居公寓·客厅' → 'PROBE_PLACE'
  ✓ delta    白石栞.性欲       20 → 25
结论：✅ 全部 patch 已落到楼层 2 的变量上（变量更新链路正常）。
```

换用例：

```bash
python dev-server/tools/probe-mvu-update.py --ops '[{"op":"delta","path":"/白石栞/好感度","value":1}]'
python dev-server/tools/probe-mvu-update.py --card "E:\Downloads\HTTP-Downlord\变装女友.png"
python dev-server/tools/probe-mvu-update.py --no-notify-box    # 不勾选静默告警开关（默认勾选）
python dev-server/tools/probe-mvu-update.py --keep-open        # 保留页面 60s 供人工检查
```

---

## 1. 它替你把真机流程搭了出来

| 真机上的环节 | 脚本里的做法 |
|---|---|
| 打开角色卡、MVU 初始化 | ① 只 seed **开场白**，等 MVU 把变量初始化到**楼层 0** |
| 用户发言 → AI 回复（带 `<UpdateVariable>`） | ② 用上一步导出的变量**重建 3 层会话**，楼层 2 的正文里带 `<JSONPatch>` |
| `MESSAGE_RECEIVED` 事件驱动更新 | ③ 在宿主 iframe 里 `eventEmit(tavern_events.MESSAGE_RECEIVED, 2)` |
| 变量写回楼层 | ④ 读 `api.variables.getVariables('message', {messageId: 2})` 逐条比对 patch |
| 状态栏重绘 | 由 `getAllVariables()` 读同一份数据，因此**变量对了状态栏就对了**（渲染另有 §7 的边界） |

**关键**：全程不需要 LLM、不需要打字、不需要等模型；一次运行约 60–90 秒（大头是等 `mvu_zod` 注册）。

---

## 2. 三个**必须遵守**的前提（都是真机踩过的坑）

### 2.1 两阶段：先让变量落在**楼层 0**，再重建 3 层会话

MVU 取变量靠 `At(e) → Ct(e)`，而 `Ct(e)` 的实现是：

```js
function Ct(e){ return _(SillyTavern.chat).slice(0, e).findLastIndex(x => { const v = x.variables?.[x.swipe_id ?? 0]; return v?.stat_data !== undefined && v?.schema !== undefined }) }
function At(e){ const t = Ct(e); if (-1 !== t) return klona(SillyTavern.chat[t].variables[...]) }
```

⚠️ **`slice(0, e)` 不含第 e 层**。真机上"楼层 0 有变量"是历史结果（会话只有开场白时初始化过），
于是 `At(2)` 能找到楼层 0 的变量。若直接用 3 层会话 seed，变量只会在楼层 2：

- `At(2)` → `slice(0,2)` → 楼层 0/1 都没变量 → 返回 `undefined`
- `Yt()` 里 `if (!_.has(o,'stat_data')) return` → **整条更新链直接早退**
- 现象：**变量不更新**，但**事件链看起来正常**（`message_received` 已派发）

⇒ 这正是"脚本设计成两阶段"的原因。也要注意：`api.messages.update()` **只能按 id 打补丁、不能追加新消息**，
所以会话必须在 seed 时就建好。

### 2.2 必须等 **`mvu_zod` 注册完成**（约 30 秒）

`mvu_zod` 的 content 会 `import` 4 个 npm 模块（compare-versions / json5 / jsonrepair / klona）+ `zod/v4/core`，
**实测约 30s 后才注册钩子**（脚本本身还有 15s 执行超时记录，属正常）。

| 测试时机 | 实际走的路径 | 结论可信度 |
|---|---|---|
| 只等 `window.Mvu` | 走「**没有 zod**」：命令由 MVU 主循环应用 ⇒ **变量正常更新** | ❌ **会误判成"已修复"** |
| 等 `变量结构注册成功` 日志 | 走真机路径：命令由 `mvu_zod` 接管（校验 + 应用） | ✅ 可信 |

脚本默认以该日志为就绪判据，上限 `--zod-timeout`（默认 90s）；未就绪时会在结论里**明确标注本次不可信**。

### 2.3 必须打开 `mvu_zod` 的**静默告警开关**

`mvu_zod` 的校验失败告警写作：

```js
return l && s && n('warn', …)        // n = toastr.warning + console.warn
l = Boolean($('#mvu_notification_error').prop('checked'))
```

该复选框**默认不在 DOM 里** ⇒ `l` 恒为 `false` ⇒ **校验失败完全静默**（这正是一度"零警告却不变"的原因）。
脚本默认在**宿主 iframe** 内预置并勾选它，于是失败原因会以 zod 原文出现：

```
[warn] 发生变量更新错误, 可能需要重Roll: {"op":"delta","path":"/白石栞/性欲","value":5}
✖ Invalid input: expected object, received undefined
  → 路径: user
```

想复现"完全静默"的表现，用 `--no-notify-box`。

---

## 3. 观测点怎么读

| 观测点 | 含义 | 异常时的指向 |
|---|---|---|
| `before` / `after` / 逐条 patch 判定 | 变量是否真的变了 | 最终结论 |
| `events.message_received.handlers` | 宿主事件是否派发到 MVU | 为 0 ⇒ 插件没派发 |
| `events.mag_variable_update_started` | `$t` 是否开始执行 | 缺失 ⇒ `Yt` 在进入 `$t` 前早退（见 §2.1） |
| `events.mag_command_parsed` | 命令解析器 `Ft` 是否跑完 | 缺失 ⇒ 事件链断在 `$t` 之外 |
| `events.mag_command_parsed_for_zod.handlers` | **zod 是否已接管** | 0 ⇒ 本次走的是无 zod 路径，结论不可信 |
| `newLogs` / `newToastr` | MVU / zod 的日志与告警 | 为空但变量没变 ⇒ 静默失败（见 §2.3） |
| `ctAt2` | `At(2)` 实际会取哪一层（`-1` = 找不到） | `-1` ⇒ 会早退；`0` 是真机正常值 |

---

## 4. 判定与常见失败对照

| 现象 | 最可能的原因 | 下一步 |
|---|---|---|
| `变量不变` + `newLogs` 里有 zod 报错 | 变量结构与 zod schema 不符（缺键/类型错） | 按报错里的 `路径:` 定位；`stat_data` 的键是否与 `Schema` 一致 |
| `变量不变` + `newLogs`/`newToastr` **都为空** | 静默失败 ⇒ 告警开关没开，或命令根本没进 `mvu_zod` | 别用 `--no-notify-box`；再查 `events.*` 定位断点 |
| `mag_variable_update_started` 缺失 | `Yt` 早退：`At(e)` 找不到变量楼层 | 回到 §2.1（两阶段 seed） |
| `…_for_zod.handlers = 0` | `mvu_zod` 未注册 | 等够时间；确认脚本启用、容器能访问 jsdelivr |
| `变量变了` 但状态栏不刷新 | 渲染层问题（不是变量层） | 查卡片 iframe 的 `getAllVariables()`、`__nyaCardDispatch`、`VARIABLE_UPDATE_ENDED` 订阅 |
| 首次运行就失败 | dev 栈没起 / 卡路径不对 | 先 `rebuild-dev.py --up`；`--card` 指向存在的 PNG |

---

## 5. 相关文件

| 文件 | 作用 |
|---|---|
| `dev-server/tools/probe-mvu-update.py` | 本方法的主脚本 |
| `dev-server/tools/_nya_cdp.py` | 手写的最小 CDP/WebSocket 客户端 + `Chrome` + `seed_indexeddb`（零第三方依赖） |
| `dev-server/tools/verify-script-host-spike.py` | `read_chara_json()`（解 PNG 内嵌卡 JSON）、`map_scripts()` |
| `dev-server/tools/verify-js-slash-runner.py` | `build_character()`（**真实导入**：世界书 + 正则 + 脚本）、`map_regex_scripts()`、`map_world_info()` |

导入这两个验证模块时**必须先把模块注册进 `sys.modules` 再 `exec_module`**（它们用了 `@dataclass`，
不预注册会抛 `AttributeError`）—— 主脚本里的 `load_module()` 已经处理。

---

## 6. 范例：本方法如何定位「状态栏数值永不更新」（真根因）

**症状**：MVU 变量更新在界面上可见，但状态栏数值恒定不变，且 console **一条警告都没有**。

**定位过程（全部由本方法承载）**：

1. 用两阶段 seed 复现真机形态 ⇒ 拿到与真机**完全一致**的现象（变量不变、零日志）。
2. 二分：`Mvu.parseMessage(原文/最小块)`、带/不带 `schema`、单条 `replace`/`delta` ——
   在**手写简化变量**下全部成功 ⇒ 说明 `$t` 与格式没问题，问题只在"真机变量"上。
3. 关键：换成**真实世界书初始化**出来的变量后仍失败 ⇒ 排除"格式/操作类型"。
4. 打开 `#mvu_notification_error` ⇒ 拿到报错原文：
   ```
   ✖ Invalid input: expected object, received undefined
     → 路径: user
   ```
5. 顺着报错查：`mvu_zod` 的用户名键来自 `__mvuResolveUserKey()`（**活值** `getCurrentPersonaName()`），
   而 initvar 里的 `'{{user}}':` 键在 `stat_data` 里变成了 `""`（空键）⇒ 键不匹配。
6. 再查为什么变空：`App.tsx` 给 `createScriptHostApi` 传的是 `identity: { user: "", char: "" }` **空快照**，
   而 `scriptHostImpl` 的 `macros.substitute` 把它**闭包捕获**、每次调用读 `identity.user` 替换 `{{user}}`。
7. **修法**：`App.tsx` 改成传**活对象（getter）**；`api.identity` 与 `macros.substitute` 同源活值。
8. **验证**：修复前 `性欲` 停 20 且报错；修复后 `20 → 25` 且无警告。

**由此固化的三条纪律**（即 §2 的三个前提）：
① 两阶段 seed；② 等 `mvu_zod` 注册；③ 打开静默告警开关。
另有一条通用教训：**"活值"必须一路活到底**，中途解构成快照就会在闭包里僵死。

**反向对照（证明本方法真的能抓到它）**：把 `App.tsx` 的 `identity` 改回空快照并重建，再跑本脚本：

```
✗ replace  世界.当前场所    '同居公寓·客厅' → '同居公寓·客厅'（期望 'PROBE_PLACE'）
✗ replace  白石栞.当前计划   '' → ''（期望 'PROBE_PLAN'）
✗ delta    白石栞/性欲      20 → 20（期望 25）
[warn] ✖ Invalid input: expected object, received undefined → 路径: user
结论：❌ 变量未更新 …        退出码：1
```

修复版本上同一命令输出 `✓✓✓ + 退出码 0`。⇒ **脚本会随故障变红，不是恒真断言**；
改动变量层/宿主 API 后应把它当作回归项。

---

## 7. 局限（本方法**不覆盖**的部分）

- **不验证渲染/UI**：本方法只到"变量正确落到楼层"。状态栏 iframe 的绘制、卡片重绘
  （`__nyaCardDispatch` / `VARIABLE_UPDATE_ENDED`）需要另测 —— 用 §8 的自动快照或
  `dev-server/tools/verify-card-status.ts`。
- **不验证真实模型输出**：patch 是脚本构造的。若怀疑"模型输出的格式不对"，用
  `Mvu.parseMessage(消息正文, 变量)` 单测，或看 §8 的 `mvuParse.blockFromText`。
- **不替代端到端**：发布前仍应跑 §9 的 `verify-js-slash-runner.py`（V1–V8）与真机确认。

---

## 8. 附：真机侧的自动快照（插件已内置）

插件在**每次 AI 回复落地后 5 秒**自动往 devlog（`dev-server/logs/browser/*.ndjson`）写一份
`[js-slash-runner] 回复后快照JSON`，含：

| 字段 | 用途 |
|---|---|
| `floors[].sdHead` / `sdKeys` / `len` / `tail` | 每条楼层的变量取值与正文尾部（对比"哪一层是旧值"） |
| `cards[].sdHead` | **卡片 iframe 实际读到**的变量（与上面一对比就知道是变量没写还是卡片没刷） |
| `mvuParse.changed` / `patchOnlyChanged` / `noSchemaChanged` / `replaceOnlyChanged` | 用 MVU 自己的 `parseMessage` 做二分 |
| `mvuParse.ctProbe` | 模拟 `Ct(e)`，给出 `atIndex`（`At(2)` 会取哪一层） |
| `mvuParse.blockFromText` / `patchBlock` / `patchCodes` | 正文里 `<UpdateVariable>` 原文、patch 原文、不可见字符 |
| `iframe.shell.events` | MVU 内部事件链的派发次数与处理器数 |
| `iframe.varLogs` / `console` / `toastr` | MVU 与 zod 的日志、告警 |

**用法**：真机上复现一次 → 直接把这份快照（或用户在控制台执行 `__nyaScriptRunnerDiag()` 的输出）贴回来，
就能判断断点在哪一环，**不必再让用户反复试**。
