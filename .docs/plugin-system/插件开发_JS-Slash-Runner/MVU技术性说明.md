# MVU 变量框架 技术性说明

> **面向读者**：要在 NyaaChat 里实现"酒馆助手 JS 脚本运行层"、从而让 ST 角色卡自带的 MVU 脚本跑起来的开发者。
> **本文定位**：逆向工程报告 + 宿主能力需求书。MVU 是 ST 社区（"类脑"用户）的魔改行为，**没有正式文档**，本文全部结论来自脚本源码、角色卡数据与酒馆助手官方文档的交叉取证。
> **本文不改任何代码**：它是 `.docs/plugin-system/插件开发_JS-Slash-Runner/` 目录下唯一新增产物。
> **写作时点**：2026-09-16。所有行数用 `(Get-Content <file>).Count`（**不用** `Measure-Object -Line`）。

---

## 0. 取证方式与引用规范

### 0.1 材料清单（本文引用的全部文件）

| 代号 | 路径 | 实测 |
|---|---|---|
| `[MVU.json]` | `H:\GitHub\.ref\SillyTavern\mvu\酒馆助手脚本-MVU.json` | **42 行** / 846 B |
| `[zod.json]` | `H:\GitHub\.ref\SillyTavern\mvu\酒馆助手脚本-mvu_zod.json` | **17 行** / 8284 B |
| `[card.png]` | `H:\GitHub\.ref\SillyTavern\mvu\SillyTavern-万象编辑器MVU角色卡-身为男生的我竟然被安排进了女生宿舍.png` | 2816444 B；单个 `tEXt` chunk，键 `chara`，值为 base64(JSON)，base64 长 822240，解码后 JSON **497361 字符** |
| `[TH]` | `H:\GitHub\.ref\SillyTavern\JS-Slash-Runner\`（酒馆助手源码） | 版本见 `@types/iframe/exported.mvu.d.ts`（**189 行**） |
| `[bundle]` | `https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js` 的下载副本 | **538090 字符** / **3 行**（压缩）；自述 build 时间 `2026-09-15 08:44`，commit `42753fd`（bundle 尾部 toast 文案实测） |

### 0.2 引用规范

- 引用 JSON 脚本时写 **`文件 + JSON 内定位`**，例如：`[zod.json] / 顶层 content 字段 / __mvuResolveUserKey() 函数`。
- 引用角色卡时写 **`[card.png] / data.<路径>`**，例如：`[card.png] / data.character_book.entries[11].comment`。
- 引用 `[bundle]` 时给 **字符偏移（0-based，实测）**，格式 `[bundle] @349797`。
- **`[bundle]` 不是给定材料**，而是 `[MVU.json]` 的 `content` 所 `import` 的远端实现。本文分析它是因为 `[MVU.json]` 本身只有一行代码。它**未落盘到仓库**（遵守"只写一个 .md"的约束），复现命令见 §6.3。

### 0.3 角色卡数据的解码方式

`[card.png]` 的 PNG 里只有一个 `tEXt` chunk（`len=822246`），键名 `chara`，值是该角色 JSON 的 base64。解码后顶层字段为 `name / description / personality / scenario / first_mes / mes_example / creatorcomment / avatar / talkativeness / fav / tags / spec / spec_version / data`，其中 `spec = "chara_card_v3"`、`spec_version = "3.0"`。**所有脚本、正则、世界书都在 `data` 里**：

```
[card.png] / data.name                                  = "苏婷"
[card.png] / data.first_mes                             (536 字符，末尾自带 <StatusPlaceHolderImpl/>)
[card.png] / data.extensions.talkativeness              = "0.5"
[card.png] / data.extensions.world                      = "苏婷 世界书"
[card.png] / data.extensions.depth_prompt               = {"prompt":"","depth":4,"role":"system"}
[card.png] / data.extensions.regex_scripts              = 数组，5 项
[card.png] / data.extensions.tavern_helper              = {"scripts":[...]}   ← 只有 scripts，无 variables
[card.png] / data.extensions.persona_engine             = 角色卡编辑器(万象编辑器)的导出快照，与 MVU 无关
[card.png] / data.character_book                        = {"name":"苏婷 世界书","entries":[...]}，16 项
```

> ⚠️ **`data.extensions.tavern_helper` 下只有 `scripts` 一个键，没有 `variables`。** 变量初始值**不在** tavern_helper 里，而在世界书条目里（见 §4.2）。

---

## 1. MVU 是什么，以及在 ST 里怎么跑起来

### 1.1 一句话定义

MVU = **Model–View–Update**。它不是 ST 的功能，而是一段**由 AI 输出驱动的状态机**，被塞进酒馆助手的"脚本库"里：

| 部分 | 在 ST 里的落点 | 载体 |
|---|---|---|
| **Model（状态）** | **消息楼层变量**（`chat[i].variables[swipe_id]`）里的一棵 `stat_data` 树 + 一份 `schema` | 酒馆助手的 `getVariables/replaceVariables` API |
| **View（渲染）** | 角色卡自带的**酒馆正则**（markdownOnly 阶段）把消息里的 `<StatusPlaceHolderImpl/>` 替换成一段 ```html 代码块；酒馆助手"渲染器"把该代码块变成**楼层 iframe**，iframe 内用 `getAllVariables()` 读 Model 画 UI | ST 原生正则 + 酒馆助手渲染器 + 楼层 iframe |
| **Update（更新）** | 监听 `MESSAGE_RECEIVED` / `MESSAGE_SENT` 等事件 → 从 AI 回复正文里解析 `_.set(...)` 或 `<JSONPatch>[...]</JSONPatch>` 命令 → 应用到一个"假想的新楼层" MvuData 上 → 写回**当前楼层**变量 → 触发重渲染 | 酒馆助手事件总线 + 变量 API |

也就是说：**AI 只负责"说"，脚本负责"算"，正则+iframe 负责"看"。**

### 1.2 完整数据流（文字版流程）

以 `[card.png]` 这张卡为例，一次完整的"新聊天 → 用户发言 → AI 回复 → 看板刷新"流程：

```
【阶段 0：脚本加载（每次打开酒馆 / 切角色卡）】
 0.1 酒馆助手读 data.extensions.tavern_helper.scripts
 0.2 为每个 enabled 脚本建一个 iframe，srcdoc 里放：
       parent_jquery.js → predefine.js → log.js → <script type="module">{content}</script>
     （依据 [TH] src/panel/script/iframe.ts L5-23）
 0.3 模块脚本执行 [MVU.json].content = import'…/MagVarUpdate/artifact/bundle.js'
     → 远端 ESM 下载并执行 → 框架向 window.parent 注册 Mvu 并广播 global_Mvu_initialized

【阶段 1：新聊天 → 变量初始化】
 1.1 MESSAGE_SENT / GENERATION_STARTED 触发初始化函数。
 1.2 从"最后一层的后面一层"（虚拟楼层）取继承的 MvuData；没有就造一个空壳。   ← [bundle] @362xxx
 1.3 读世界书：getLorebookSettings().selected_global_lorebooks + getCharLorebooks()
     → 遍历，用 getLorebookEntries(书名) 取条目
     → 只挑 comment 里含 "[initvar]" 的条目（大小写不敏感）
     → 先剥掉 <initvar>…</initvar> 或 ```…``` 包裹，再 substitudeMacros()，再 YAML 解析
     → 合并成 stat_data                                                        ← [bundle] @364672
 1.4 若首楼(first_mes)的某个 swipe 里写了 <initvar>…</initvar> 块，也解析并覆盖/合并
 1.5 由 stat_data 反推 schema（推断型 schema），或（zod 版）由 zod Schema 产出
 1.6 广播 Mvu.events.VARIABLE_INITIALIZED  → 【zod 版在这里做 zod 校验与补齐】
 1.7 把 MvuData 写进**首楼楼层变量**（若是 0 层，则逐 swipe 写 swipes_data）
 1.8 可选：同步一份到 **聊天变量**（兼容性开关"更新到聊天变量"）

【阶段 2：把变量喂给 AI（提示词阶段）】
 2.1 世界书条目 [card.png] / data.character_book.entries[13] "变量列表"
     content = "<status_current_variables>\n{{format_message_variable::stat_data}}\n</status_current_variables>"
 2.2 该宏在**每次组装提示词时**求值 = 最新楼层的 message 变量里 stat_data 的 YAML 形式
     → AI 因此"看得见"当前状态
 2.3 另有条目 entries[12] "[mvu_update]变量更新规则"、entries[14] "[mvu_update]变量输出格式"
     告诉 AI 该怎么写更新命令（JSON Patch 方言）

【阶段 3：AI 回复 → 更新变量】
 3.1 AI 回复末尾输出：
       <UpdateVariable><Analysis>…</Analysis><JSONPatch>[{"op":"delta","path":"/舍友列表/苏婷/好感度","value":2}]</JSONPatch></UpdateVariable>
 3.2 MESSAGE_RECEIVED 事件 → 更新编排函数
 3.3 取上一楼层的 MvuData 作基准（Ct/At：向前找最近一个同时有 stat_data 与 schema 的楼层）
 3.4 命令解析器扫正文：[bundle] @341xxx 起
       - 抓 <JSONPatch>/<json_patch> 块（剥 ``` 围栏）→ 解析 JSON → RFC6902 操作映射为内部命令
         replace→set / delta→add / insert|add→insert / remove→delete / move→move  ← [bundle] @~342500
       - 或抓 _.set/_.insert/_.assign/_.remove/_.unset/_.delete/_.add(…) 调用（含括号配对与行尾注释）
 3.5 依次应用命令到 stat_data 副本；过程写入 $internal.display_data / $internal.delta_data
 3.6 每步广播 SINGLE_VARIABLE_UPDATED；解析完成时广播 COMMAND_PARSED
     → 【zod 版在这里做 zod 校验/裁剪/丢弃非法命令】
 3.7 收尾广播 VARIABLE_UPDATE_ENDED（携带更新前/后两份数据），删掉 stat_data.$internal
 3.8 若开启"更新到聊天变量"，再写一份到 chat 作用域
 3.9 把 MvuData 写回**当前楼层**变量；再次写 chat 变量（可选）；
     确保消息正文尾部含 <StatusPlaceHolderImpl/>，并删除正文里的 <status_current_variable> 段
     → setChatMessages(..., {refresh:'affected'}) 触发该楼层重渲染

【阶段 4：渲染（View）】
 4.1 渲染该楼层时，ST 正则条目 [card.png] / data.extensions.regex_scripts[0] "万象前端界面渲染"
     （findRegex=<StatusPlaceHolderImpl/>，placement=[2]，markdownOnly=true）
     把占位符替换成 21668 字符的 ```html …``` 看板（整页 HTML+CSS+jQuery 脚本）
 4.2 酒馆助手渲染器把 html 代码块转成楼层 iframe；iframe 内 predefine.js 已注入
     _ / $ / getAllVariables / eventOn / Mvu / waitGlobalInitialized / substitudeMacros /
     errorCatched / SillyTavern …
 4.3 看板脚本 init()：await waitGlobalInitialized('Mvu') → render()
     render() 里 getAllVariables().stat_data → 画 3 张舍友卡（好感度/亲密度条、位置、着装、态度）
 4.4 看板脚本 eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, render) → 变量一变就自动重画

【阶段 5：其它维护路径（脚本按钮）】
 - "重新读取初始变量"：重跑 initvar → 合并进现存数据 → 写回楼层 + （可选）chat 变量
 - "重演楼层"：从某楼取变量快照 → 逐楼重跑该楼正文里的更新命令
 - "快照楼层"：把当前 stat_data 复制成一份独立快照楼层
 - "重试额外模型解析"：重跑阶段 3 的额外模型路径
 - "清除旧楼层变量"：按保留数与间隔删除旧楼层的 variables
 - 自动清理：MESSAGE_DELETED / MESSAGE_RECEIVED 时按设置清旧楼层变量
```

---

## 2. 脚本清单、职责与差异

### 2.1 角色卡里实际带的脚本

`[card.png] / data.extensions.tavern_helper.scripts` 是长度 2 的数组：

| # | `name` | `id`（卡内） | `content` 长度 | `button.buttons` |
|---|---|---|---|---|
| 0 | `MVU` | `5973ad05-c104-4a14-ab85-ed3e6d01bd08` | 89 | 6 个（`visible` 全为 `false`） |
| 1 | `mvu_zod` | `2971da1a-ad52-41cf-8336-575208e082fb` | 7113 | 0 个（`button.enabled=true`） |

**实测核对**：

- `scripts[0].content.trim()` 与 `[MVU.json] / content` **逐字符相同**；
- `scripts[1].content` 与 `[zod.json] / content` **逐字符相同**（7113 字符，与 `[zod.json]` 里 `content` 的长度一致）；
- 但 **id 不同**：本地两个 `.json` 文件的 `id` 是 `9708b4b4-…` / `daeb51fe-…`，卡内是 `5973ad05-…` / `2971da1a-…`。⇒ 这两个 `.json` 是"独立脚本库导出件"，角色卡是"另一份拷贝"。**结论：脚本 id 是导入时重新生成的，不能当稳定标识用。**

### 2.2 `MVU` 脚本的职责

`[MVU.json]` 全文只有 42 行，`content` 只有一行：

```
[MVU.json] / 顶层 content 字段（第 6 行）:
import'https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js';
```

它是一个**加载器**。全部 MVU 逻辑（Model 读写、命令解析、事件总线、变量初始化、额外模型解析、脚本按钮挂载、设置面板）都在那个远端 `bundle.js` 里（538090 字符）。

`[MVU.json] / button.buttons` 声明的 6 个按钮（`visible` 全 `false`，即默认不显示在 UI 上）：

| 按钮 `name` | 职责（由 `[bundle]` 实现推断） |
|---|---|
| `重新处理变量` | 重新解析当前楼层正文中的更新命令 |
| `重新读取初始变量` | 重跑 initvar 读取并合并（[bundle] @409238） |
| `快照楼层` | 复制当前 stat_data 成快照楼层（[bundle] @413496） |
| `重演楼层` | 从某楼层快照起重放后续楼层的更新（[bundle] @411360） |
| `重试额外模型解析` | 重试"额外模型"路径（[bundle] @413194） |
| `清除旧楼层变量` | 删除旧楼层的 variables |

`[MVU.json] / export_with` = `{"data":true,"button":true}` ⇒ 导出角色卡时脚本的 `data` 与 `button` 一并带走。

### 2.3 `mvu_zod` 脚本的职责

`[zod.json] / content`（7113 字符）做了三件事：

1. **声明 Schema**：`content` 末尾 `export const Schema = z.object({ 世界:…, '{{user}}':…, 舍友列表:{苏婷/林栀/江筱雨}, 寝室公共事务:… })`，用 zod v4 的 `prefault()` 给每个字段设默认值，用 `_.clamp(v,-100,100)` 裁好感度/亲密度。
2. **key 映射与迁移**：`__mvuResolveUserKey()` 把字面量 `'{{user}}'` 换成真实用户名（依次尝试 `substitudeMacros('{{user}}')` → `getCurrentPersonaName()` → `SillyTavern.name1` → 兜底 `'用户'`）；`__mvuBuildUserRuntimeSchema()` 用 `schema.omit({...}).extend({[USER]: …})` 把 Schema 的 `{{user}}` 键改名；`__mvuMigrateUserRoot()` 把 `stat_data` 下旧的 `'{{user}}'` / 旧用户名键合并进新键并删除旧键。
3. **安装运行时钩子**：`__mvuInstallUserRuntime()` 里 `await waitGlobalInitialized('Mvu')`，然后 `eventOn` 监听 `Mvu.events.VARIABLE_INITIALIZED` / `VARIABLE_UPDATE_ENDED`（迁移）与 `COMMAND_PARSED`（把命令路径里的 `{{user}}` 前缀改写为真实用户名），并监听 `tavern_events.CHAT_CHANGED`、`tavern_events.SETTINGS_UPDATED`（300ms 去抖后刷新）；最后把刷新函数挂到 `window.__mvuRefreshUserRuntime`。

`content` 最后一行：`$(() => { registerMvuSchema(__mvuBuildUserRuntimeSchema(Schema)), void __mvuInstallUserRuntime(); });`

### 2.4 `MVU.json` vs `mvu_zod.json` 差异

| 维度 | `MVU` | `mvu_zod` |
|---|---|---|
| 代码位置 | 只有一行 `import`，实现全在远端 bundle | 全部逻辑内联在 `content`（7113 字符） |
| 外部依赖 | `MagicalAstrogy/MagVarUpdate/artifact/bundle.js` | `StageDog/tavern_resource/dist/util/mvu_zod.js`（该模块自身又 `import` 4 个 npm ESM：`compare-versions@6.1.1`、`json5@2.2.3`、`jsonrepair@3.15.0`、`lodash` 的 `klona@2.0.6`，以及从 `zod/v4/core` 取 `toDotPath`） |
| 是否有 Schema | **无**。schema 由脚本从 `stat_data` **反推**（`[bundle]` 的 `ht()` 建 schema、`gt()` 做 reconcile） | **有**。显式 zod Schema，带 `prefault()` 默认值与 `z.enum` 枚举 |
| 校验能力 | 只做"结构推断 + 可扩展性/必填"级别的宽松校验 | 每个变量更新命令都 `safeParse`，非法则**丢弃该命令**并 toastr 报错（`issues` 按 path 深度排序输出） |
| 初始化行为 | 直接用 initvar 的 YAML 结果 | 初始化后再 `safeParse`，**补齐默认值**（`t.stat_data={...t.stat_data,...a.data}`） |
| 额外事件契约 | 广播 `COMMAND_PARSED` / `VARIABLE_UPDATE_ENDED` 等"主"事件 | 依赖 MVU 额外广播的**三个 `_for_zod` 后缀事件**（见 §3.2），并会在结束时 `_.set(t,'schema','没有用别管这个')`、`_.unset(t,'display_data'/'delta_data')` |
| 变量管理器集成 | 无 | 调 `registerVariableSchema(z.object({stat_data: looseObject(shape)}),{type:'message'})`，让变量管理器按结构校验 |
| 用户身份处理 | 无（`{{user}}` 由宏层处理） | 自建 `{{user}}` → 真实用户名的运行时键映射与存量迁移 |
| 按钮 | 6 个（全不可见） | 0 个 |

**为什么要有 zod 版**：MVU 主框架对 AI 输出的更新命令只做"结构上天真"的接受；LLM 极易把 `好感度` 写成字符串、把枚举写成不存在的值。zod 版提供 (a) 类型的强制与默认值兜底、(b) 非法更新的拒绝与提示、(c) 用户切换时的键迁移、(d) 变量管理器里的结构提示。**代价**是它把 MVU 主框架的内部事件契约（`*_for_zod`）变成了硬依赖。**

---

## 3. 它调用的酒馆助手 API 全清单

分三组：**A** = `[MVU.json]` 加载的 `[bundle]` 调用；**B** = `[zod.json]` 直接调用；**C** = 角色卡前端 HTML（`regex_scripts[0].replaceString`）调用。

> 全清单由「把 `[TH] @types/function/*.d.ts` + `@types/iframe/*.d.ts` 里 171 个 `declare function/const` 逐个在 `[bundle]` 里做词边界匹配」得出，非印象。

### 3.1 A 组：`[bundle]`（MVU 主框架）调用的酒馆助手 API

| # | API | 用途 | 脚本内出处（`[bundle]` 字符偏移） |
|---|---|---|---|
| A1 | `getVariables` | 取楼层/脚本变量 | @411360 `getVariables({type:'message',message_id:r})`；@413496；@428198 `getMvuData:function(e){return getVariables(e)}` |
| A2 | `replaceVariables` | 整体替换变量表 | @363309 `replaceVariables(e,{type:'message'})`；@368730 `{type:'message',message_id:t}` 与 `{type:'chat'}`；@409238；@428251 |
| A3 | `updateVariablesWith` | 事务式更新 | @362501（chat 作用域）、@360366 附近（message 作用域）、@413496、@428502 区段 |
| A4 | `insertOrAssignVariables` | 写全局变量 | @324546 `insertOrAssignVariables({extra_analysis:e},{type:'global'})` |
| A5 | `deleteVariable` | 拆毁时清理全局变量 | @534656 `deleteVariable('extra_analysis',{type:'global'})` |
| A6 | `eventOn` | 订阅事件（包一层 should_enable 门控） | @343903 `function kt(e,t){…eventOn(e,o)…}`；@174552 `eventOn(tavern_events.GENERATION_STOPPED,b)` |
| A7 | `eventEmit` | 广播事件（21 处） | @350274 `SINGLE_VARIABLE_UPDATED`；@350854 `VARIABLE_UPDATE_STARTED`；@351311 `COMMAND_PARSED` + `COMMAND_PARSED_for_zod` + `COMMAND_PARSED_ended_for_zod`；@356000 区段 `VARIABLE_UPDATE_ENDED` / `…_for_zod`；@359913 `BEFORE_MESSAGE_UPDATE`；@534675 `eventEmit('global_Mvu_initialized')` |
| A8 | `eventMakeFirst` | 把监听器插到最前（拦世界书请求） | @377526 `eventMakeFirst(Rn,Ln)`, `eventMakeFirst(jn,Ln)` |
| A9 | `eventMakeLast` | 把监听器插到最后（抓生成结束） | @174598 `eventMakeLast(tavern_events.CHAT_COMPLETION_SETTINGS_READY,w)` |
| A10 | `eventRemoveListener` | 注销（6 处） | @343903、@377548、@534224 等 |
| A11 | `getChatMessages` | 读楼层（含 role/swipe） | @359705 `getChatMessages(e).at(-1)`；@362501 `getChatMessages(0,{include_swipes:!0})`；@368479、@402788 |
| A12 | `setChatMessages` | 写楼层正文/变量 + 指定刷新策略 | @359913 `setChatMessages([{message_id:e,message:n}],{refresh:'none'})`；@362501 `{swipes_data:…}`；@409238 `setChatMessage({},t)`；@413194 `{refresh:'affected'}` |
| A13 | `getLastMessageId` | 定位最新楼层（8 处） | @362501、@368479、@402788、@413194 |
| A14 | `getCurrentMessageId` | 楼层 iframe 语境下定位自身楼层 | @428391 `getVariables({type:'message',message_id:getCurrentMessageId()})`；@428502 |
| A15 | `getScriptId` | 取脚本 id（做按钮事件名、函数工具名） | @534675 区段 `listenPreferenceState(e=>e===getScriptId())`；@367xxx `mvu_VariableUpdate_${getScriptId()}` |
| A16 | `substitudeMacros` | 展开 `{{user}}` 等宏（4 处） | @364672（initvar 内容求值）、@367xxx `An(e)` 包装器、@350537 `Ft(substitudeMacros(e))` |
| A17 | `getLorebookSettings` | 读世界书全局设置 | @363965、@364017 |
| A18 | `setLorebookSettings` | 强制世界书设置（深度/预算/递归等一组默认值） | @364017 |
| A19 | `getCharLorebooks` | 取当前角色绑定书（primary + additional） | @364188 |
| A20 | `getCharWorldbookNames` | 取当前角色主书（初始化标记键） | @363034 `getCharWorldbookNames('current').primary??'unknown'`；@420388 |
| A21 | `getCurrentCharPrimaryLorebook` | 判定本卡是否有 MVU 条目 | @365367 `getCurrentCharPrimaryLorebook()` |
| A22 | `getLorebookEntries` | 逐条读世界书（找 `[initvar]`） | @364672 `await getLorebookEntries(t)` |
| A23 | `updateWorldbookWith` | 读写角色卡"MVU 设置覆盖"条目 | @427161 |
| A24 | `getScriptButtons` | 读脚本按钮列表 | @533947、@534037 区段 |
| A25 | `replaceScriptButtons` | 增删按钮（3 处） | @534037 区段 |
| A26 | `appendInexistentScriptButtons` | 补齐 6 个按钮 | @533947 `appendInexistentScriptButtons(Fo.map(e=>({name:e.name,visible:!1})))` |
| A27 | `getButtonEvent` | 按钮 → 事件名 | @533947 `kt(getButtonEvent(e.name),e.function)` |
| A28 | `generate` | 额外模型解析（使用当前预设） | @390482 `generate({...u,injects:[{position:'in_chat',depth:0,…},…]})` |
| A29 | `generateRaw` | 额外模型解析（其他预设/裸请求） | @401831 `generateRaw(e)` |
| A30 | `stopGenerationById` | 中止额外请求 | @144408、@174301 |
| A31 | `getTavernHelperVersion` | 版本闸（要求 ≥ `4.8.4`，实测常量 `Qt='4.8.4'`） | @325509、@325918 |
| A32 | `getLorebookEntries`/`updateWorldbookWith` 之外的 `getLorebookSettings` 已在 A17/A18 | — | — |

**A 组同时依赖的非 TavernHelper 全局**（由 `[TH]` 的 predefine 层注入）：

| 全局 | 用途示例 | 出处 |
|---|---|---|
| `_`（lodash） | `_.get/_.set/_.mergeWith/_.clamp/_.unset/_.isEqual/_.debounce/_.throttle` | 全篇 |
| `$` / `jQuery` | `$('#chat > .welcomePanel')`、`$('#mvu_notification_error').prop('checked')` | @356xxx、@324xxx |
| `YAML` | 解析 initvar 的 YAML | @364672 区段、@313xxx |
| `z`（zod v4） | 设置项的 zod schema | @323170、@324546 |
| `toastr` | 用户提示（78 处） | 全篇 |
| `SillyTavern`（含 `chat`/`name`/`name1`/`name2`/`getCurrentChatId`/`saveChat`/`callGenericPopup`/`POPUP_TYPE`/`POPUP_RESULT`/`registerMacro`/`unregisterMacro`/`chatCompletionSettings`/`getRequestHeaders`/`getCharacterCardFields`/`ToolManager`/`getCurrentLocale`/`loadWorldInfo`/`characters`/`characterId`） | `SillyTavern.chat[i].variables[swipe_id]` 是真正的存储位置 | @341xxx 起 |
| `tavern_events` | 事件名常量表 | @174552、@418937、@535484、@536360 等 |
| `window.parent` | MVU 自己挂在父窗口上 | @534656 `_.set(window.parent,'Mvu',e)` |

`tavern_events.*` 用到的常量（去重计数）：`CHAT_COMPLETION_SETTINGS_READY`(5)、`CHARACTER_MESSAGE_RENDERED`(2)、`GENERATION_STOPPED`(2)、`MESSAGE_RECEIVED`(2)、`MESSAGE_SENT`(2)、`CHAT_CHANGED`(1)、`GENERATION_STARTED`(1)、`MESSAGE_DELETED`(1)、`WORLDINFO_UPDATED`(1)。

**MVU 自己对外提供的事件契约**（`[bundle] @339839` 一带实测）：

```js
const st='mag_invoke_mvu', lt='mag_update_variable';
const ct = {
  VARIABLE_INITIALIZED:      'mag_variable_initialized',
  VARIABLE_UPDATE_STARTED:   'mag_variable_update_started',
  COMMAND_PARSED:            'mag_command_parsed',
  VARIABLE_UPDATE_ENDED:     'mag_variable_update_ended',
  BEFORE_MESSAGE_UPDATE:     'mag_before_message_update',
  SINGLE_VARIABLE_UPDATED:   'mag_variable_updated',
};
const ut = /\[mvu_update\]/i, pt = /\[mvu_plot\]/i;
```

对照 `[TH] / @types/iframe/exported.mvu.d.ts` L55-119：`.d.ts` 写的是 `'mag_variable_initiailized'`（**多了一个 i，是文档里的拼写错误**），实际运行值是 `'mag_variable_initialized'`。另外 `SINGLE_VARIABLE_UPDATED` 与 `mag_invoke_mvu` / `mag_update_variable` 两个"外部调用入口"**在 `.d.ts` 里根本没写**。

### 3.2 B 组：`[zod.json]` 直接调用的 API

| # | API / 全局 | 出处（`content` 字段内） |
|---|---|---|
| B1 | `registerMvuSchema`（来自 `tavern_resource` 的 `mvu_zod.js`） | 顶部 `import { registerMvuSchema } from '…/util/mvu_zod.js'`；末尾 `$( () => { registerMvuSchema(…) … })` |
| B2 | `substitudeMacros` | `__mvuResolveUserKey()` 第一 try 分支 `substitudeMacros('{{user}}')` |
| B3 | `getCurrentPersonaName` | `__mvuResolveUserKey()` 第二 try 分支 |
| B4 | `SillyTavern.name1` | `__mvuResolveUserKey()` 第三 try 分支 |
| B5 | `waitGlobalInitialized('Mvu')` | `__mvuInstallUserRuntime()` 首行 |
| B6 | `Mvu.getMvuData({type:'message',message_id:'latest'})` | `refreshUserRuntime()` 与 `__mvuInstallUserRuntime()` 尾部迁移 |
| B7 | `Mvu.replaceMvuData(data, option)` | 同上（`await`） |
| B8 | `Mvu.events.VARIABLE_INITIALIZED` | `eventOn(Mvu.events.VARIABLE_INITIALIZED, __mvuMigrateUserRoot)` |
| B9 | `Mvu.events.VARIABLE_UPDATE_ENDED` | `eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, __mvuMigrateUserRoot)` |
| B10 | `Mvu.events.COMMAND_PARSED` | `eventOn(Mvu.events.COMMAND_PARSED, function(first,second){…})` 改写 `args[0]`/`move.args[1]` |
| B11 | `tavern_events.CHAT_CHANGED`（兜底 `'chat_id_changed'`） | `eventOn(hostEvents.CHAT_CHANGED \|\| 'chat_id_changed', …)` |
| B12 | `tavern_events.SETTINGS_UPDATED`（兜底 `'settings_updated'`） | 同上 |
| B13 | `window.__mvuRefreshUserRuntime` | `window.__mvuRefreshUserRuntime = refreshUserRuntime` |
| B14 | `z`（zod v4，**裸全局**） | `export const Schema = z.object({…})`，用 `z.string()/z.enum()/z.coerce.number()/z.array()/prefault()` |
| B15 | `_`（lodash，**裸全局**） | `_.clamp(v,-100,100)` |
| B16 | `$`（jQuery） | 末尾 `$(() => {…})` |
| B17 | `console.warn` | 三处失败降级路径 |

**`mvu_zod.js`（外部模块）自己调用的酒馆助手 API**（这一步很关键，NyaaChat 若直接抓这个 URL 会连带承担这些依赖）：

- `registerVariableSchema(z.object({stat_data: looseObject(shape)}), {type:'message'})`
- `eventOn('mag_variable_initialized', …)` → `safeParse` + 合并默认值 + `z.prettifyError`
- `eventOn('mag_command_parsed_for_zod', …)` → 逐条命令 `safeParse`、非法则 `toastr.warning`、`_.pullAt` 丢弃
- `eventOn('mag_command_parsed_ended_for_zod', (t,e)=>{e.length=0})` → 清空命令数组
- `eventOn('mag_variable_update_ended_for_zod', t=>{_.set(t,'schema','没有用别管这个'); _.unset(t,'display_data'); _.unset(t,'delta_data')})`
- `$('#mvu_notification_error').prop('checked')`、`toastr.warning/error`、`YAML.parse`、`_`

> ⇒ **MVU 主框架必须主动广播 `COMMAND_PARSED_for_zod` / `COMMAND_PARSED_ended_for_zod` / `VARIABLE_UPDATE_ENDED_for_zod` 这三个后缀事件**，zod 版才有作用。这三个事件**不在 `exported.mvu.d.ts` 里**，是"未文档化的内部契约"。NyaaChat 若自己实现 MVU 主框架，必须在对应位置补上这三个 `eventEmit`，否则 zod 版静默失去校验能力（`[bundle] @351311` 与 `@356000` 区段实测有这三处 emit）。

### 3.3 C 组：角色卡前端 HTML 调用的 API（View 层）

出处：`[card.png] / data.extensions.regex_scripts[0].replaceString`（21668 字符，```html 内的 `<script>`）：

| # | API / 全局 | 用途 |
|---|---|---|
| C1 | `getAllVariables()` | 取"全局→角色→聊天→各楼层"合并后的变量表，读 `.stat_data` |
| C2 | `eventOn(Mvu.events.VARIABLE_UPDATE_ENDED, render)` | 变量更新后自动重绘 |
| C3 | `waitGlobalInitialized('Mvu')` | 等 MVU 就绪再渲染 |
| C4 | `errorCatched(init)` | 包一层错误捕获 |
| C5 | `substitudeMacros('{{user}}')` | 解析用户名（看板里与 zod 版同一套 fallback 逻辑） |
| C6 | `getCurrentPersonaName()` | 同上 fallback |
| C7 | `SillyTavern.name1` | 同上 fallback |
| C8 | `_`（lodash） | `_.get(charData,'好感度',0)` 等 |
| C9 | `$`（jQuery） | DOM 构建与 `$('#btn-refresh').on('click',…)` |

> C 组说明：**View 层不依赖 `Mvu` 对象本身**（只用事件名），所以只要宿主提供"变量读取 + 事件总线 + 等 Mvu 就绪"，看板就能跑。

---

## 4. 变量结构注册与持久化的具体形态

### 4.1 作用域（Scope）

| 作用域 | 谁在用 | 键路径 | 是否持久化 |
|---|---|---|---|
| **`message`（消息楼层）** | **主存储**。stat_data/schema/display_data/delta_data/initialized_lorebooks 全在这里 | ST: `chat[mesId].variables[swipe_id]`；酒馆助手 API: `{type:'message', message_id}` | ✅ 随聊天文件保存（`saveChatConditionalDebounced`） |
| `chat`（聊天变量） | 可选兼容开关"更新到聊天变量"，写一份副本 | ST: `chat_metadata.variables`；API: `{type:'chat'}` | ✅ 随聊天文件（`saveMetadataDebounced`） |
| `global`（全局变量） | 只用来放一个跨脚本的开关 `extra_analysis` | `extension_settings.variables.global`；API: `{type:'global'}` | ✅ 用户存档（`saveSettingsDebounced`） |
| `character` / `preset` / `script` / `extension` | **MVU 未使用**（实测 `[bundle]` 中无相应调用） | — | — |

### 4.2 MvuData 的形状（`[TH] / @types/iframe/exported.mvu.d.ts` L2-10 + `[bundle] @360366` 实测）

```jsonc
// chat[mesId].variables[swipe_id] —— 一个楼层的完整 MvuData
{
  "stat_data": {                 // ← 真正被 AI 读写的状态树（根就是"世界/舍友列表/{{user}}/寝室公共事务"）
    "世界": { "当前日期": "2022.09.01", "当前时间": "07:00", "寝室状态": "早起洗漱" },
    "{{user}}": { "当前位置": "417寝室-自身床位", "当前状态": "刚醒来…", "当前着装": "纯棉宽松睡衣短裤" },
    "舍友列表": { "苏婷": { "好感度": 20, "亲密度": 0, "当前位置": "…", "当前行动": "…", "当前着装": "…", "外显态度": "客套礼貌" },
                 "林栀": { "好感度": -35, … }, "江筱雨": { "好感度": -5, … } },
    "寝室公共事务": { "卫浴使用状态": "空闲", "阳台晾晒人员": [], "今日值日生": "苏婷" },
    "$internal": { "display_data": {…}, "delta_data": {…} }   // 仅更新过程中存在，收尾时 _.unset
  },
  "initialized_lorebooks": { "苏婷 世界书": [] },   // 已初始化过的世界书 → 条目列表
  "schema": { "type": "object", "properties": {…}, "extensible": false, "recursiveExtensible": false,
              "strictTemplate"?: true, "strictSet"?: true, "concatTemplateArray"?: true },
  "display_data": { … },   // 本次更新的"展示态"（旧值），渲染可用
  "delta_data":  { … }     // 本次更新的"增量"（只含被改动的路径）
}
```

- **`$` 前缀的键不会被 `{{get/format_xxx_variable}}` 宏发送给 AI**（酒馆助手文档：《获取变量》"额外特性"）——这是 MVU 把 `$internal`、`$meta` 放进去却不污染提示词的原因。
- `stat_data.$meta` 是用户可写的元信息：`extensible` / `recursiveExtensible` / `template` / `strictTemplate` / `strictSet` / `concatTemplateArray`（`[bundle] @341xxx` 与 @360366 区段实测会读它们并写回 schema）。

### 4.3 变量如何注册

**没有"注册"这一步。** MVU 的变量不是注册出来的，而是：

1. **初始值来自 `[initvar]` 世界书条目**（`[card.png] / data.character_book.entries[11]`）：

   ```
   comment = "[initvar]变量初始化勿开"
   keys = []   constant = true   selective = false   insertion_order = 100
   position = "before_char"     extensions.position = 0     extensions.depth = 4
   enabled = false              ← ★ 关键：条目被禁用，所以不会进提示词，只被脚本读取
   use_regex = true
   content = YAML（世界:/'{{user}}':/舍友列表:/寝室公共事务: 四棵树）
   ```

   `enabled:false` 是 MVU 的约定：**用"禁用条目"当纯数据容器**。宿主必须能读到"已禁用"的条目。

2. **schema** 由脚本生成：zod 版来自 `Schema` 常量；非 zod 版由 `stat_data` 反推。

3. **运行时注册（仅 zod 版）**：`registerVariableSchema(z.object({stat_data: …}), {type:'message'})` —— 只影响酒馆助手的**变量管理器 UI 校验**，对代码层无影响（官方文档《注册变量结构》原文："这只是方便使用变量管理器这一 UI 查看和管理变量, 对于代码层面没有任何影响"）。初始化的实际补默认值是靠 `safeParse` 的结果合并。

### 4.4 变量如何初始化

三条入口：

| 入口 | 触发 | 行为 |
|---|---|---|
| 常规初始化 | `GENERATION_STARTED` / `MESSAGE_SENT` / 打开聊天（`CHAT_CHANGED`） | 取"最后楼层之后"的虚拟楼层 → 从世界书 `[initvar]` 读初值 → 写回 |
| 首楼 `<initvar>` 块 | 首楼正文里带 `<initvar>…</initvar>`（`markdownOnly` 前） | 逐 swipe 解析、覆盖 `stat_data`、重跑 initvar、逐 swipe 广播 `VARIABLE_INITIALIZED` |
| 脚本按钮 | `[MVU.json]` 的 `重新读取初始变量` | `reloadInitVar()` 后合并写回 + 可选写 chat 变量 |

初始化后**必须**广播 `VARIABLE_INITIALIZED`（`(variables, swipe_id)`）——zod 版就挂在这个事件上。

### 4.5 变量如何持久化

- 因为主存储是 **ST 聊天文件的消息楼层变量**，持久化 = ST 的 `saveChat`。`[bundle]` 里有 `const wt = _.debounce(SillyTavern.saveChat, 1e3)`（@341xxx 区段实测）。
- 写回动作实际是 `setChatMessages([{message_id}],{refresh:'affected'})` / `updateVariablesWith(..., {type:'message', message_id})`——**变量在消息对象上，所以"改变量"和"改消息"是同一次写盘**。
- **每层是否带变量是稀疏的**：读写逻辑靠 `Ct(e)`（`[bundle] @341xxx`）向前找"最近一个同时含 `stat_data` 与 `schema` 的楼层"来继承，找不到就回退到"无状态"。所以**中间楼层的变量可以不存在**。
- 出提示词的那一份，通过世界书条目 `{{format_message_variable::stat_data}}` 在**提示词组装阶段**动态求值（"最新楼层"始终跟随聊天的最后一条），不落盘。

### 4.6 变量如何被渲染

```
AI 回复正文（含/不含占位符）
   ↓ [bundle] 更新收尾时确保正文含 "\n\n<StatusPlaceHolderImpl/>"，并删掉正文里的 <status_current_variable>…</status_current_variable>
   ↓ ST 正则 regex_scripts[0]（findRegex=<StatusPlaceHolderImpl/>，placement=[2]，markdownOnly=true，runOnEdit=true）
占位符 → ```html <整页看板/> ```（21668 字符）
   ↓ 酒馆助手"渲染器"（markdown 扩展）把 html 代码块转成楼层 iframe
楼层 iframe 内：getAllVariables().stat_data → jQuery 画卡片；eventOn(VARIABLE_UPDATE_ENDED) → 自动重绘
```

同卡还有 3 条与 MVU 配套的正则（`[card.png] / data.extensions.regex_scripts`）：

| # | scriptName | findRegex | placement / 标志 | 作用 |
|---|---|---|---|---|
| 1 | `仅格式思维链` | `/<Analysis>[\s\S]+?<\/Analysis>/gm` | `[2]`, `promptOnly=true` | 只在**发给 AI 的提示词**里删掉历史 Analysis，正文保留 |
| 2 | `只发送最新2楼的变量更新` | `/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gm` | `[2]`, `promptOnly=true`, `minDepth=4` | 历史里更早的更新块不进提示词 |
| 3 | `[美化]变量完成-三明月喵` | `/<UpdateVariable(?:variable)?>\s*(.*)\s*<\/UpdateVariable(?:variable)?>/gsi` | `[2]`, `markdownOnly=true` | 把更新块渲染成折叠的"喵喵喵~变量完成了"卡片 |
| 4 | `一键生卡_隐藏状态栏标记` | `/<StatusPlaceHolderImpl\/>/g` | `[2]`, `promptOnly=true` | 占位符**不发给 AI** |

> ⇒ 一个 MVU 角色卡实际需要**正则的四个位置语义**：`markdownOnly`（改渲染不改提示词）、`promptOnly`（改提示词不改渲染）、`minDepth/maxDepth`（按楼层深度生效）、`placement`。

---

## 5. NyaaChat 侧缺失能力清单（N1–N14）

> 每条给：**能力** → **MVU 为什么非它不可** → **缺了会在哪一步失败**。
> 前置说明：NyaaChat 现有插件框架（`src/plugins/types.ts`，**111 行**）只提供 `meta / defaults / setup / SettingsPanel / decorators.messageText / backend / on(3 个事件)`；`TextDecoration` 的契约明确写着"**语义是「在片段旁边加东西」，不是「替换片段」**"（L42-49），装饰器返回的节点**追加在原文之后**。这对 MVU 的 View 层是**结构性不兼容**（见 N10）。

| # | 缺失能力 | 为什么必需 | 缺了会在哪一步失败 |
|---|---|---|---|
| **N1** | **任意 JS 的隔离执行环境**：能建 iframe，把脚本 `content` 放进 `<script type="module">` 执行；脚本之间作用域隔离、可销毁重建 | `[MVU.json].content` 就是一行 ESM `import`；`[zod.json].content` 是顶层 `export const Schema` + `$(()=>{})` | 第 0.3 步直接 SyntaxError/无法 import。**这是第一道门槛，其它能力都排在它后面。** |
| **N2** | **远端 ESM 加载**：`import 'https://…'` 可联网、可跨域、CSP 不拦 | MVU 主框架、`mvu_zod.js` 及其 4 个 npm 依赖全靠 jsdelivr | 同上。若要离线，必须**内置/自托管**这些依赖并改写 URL（见 §6 未确认项 U7） |
| **N3** | **脚本作用域全局注入层**：`_`(lodash)、`$`/`jQuery`、`z`(zod v4)、`YAML`、`toastr`、`SillyTavern`（含 `chat`/`name1`/`name2`/`getCurrentChatId`/`saveChat`/`registerMacro`/`getCharacterCardFields`/`ToolManager`/`callGenericPopup`）、`TavernHelper` 绑定函数、`getScriptId()`/`getCurrentMessageId()`/`errorCatched()`/`reloadIframe()` | `[zod.json]` 直接写 `z.object`、`_.clamp`、`SillyTavern.name1`；`[bundle]` 全篇用 `_.*`、`toastr`、`YAML`、`SillyTavern.chat` | `[zod.json]` 在**解析阶段**就 `ReferenceError: z is not defined`；`[bundle]` 在早期即崩。且 `SillyTavern.chat[i].variables[swipe_id]` 是数据真相所在，无法用别的东西假装 |
| **N4** | **多作用域变量系统**：至少 `message`(含 swipe 维度) / `chat` / `global`；API `getVariables / replaceVariables / updateVariablesWith / insertOrAssignVariables / insertVariables / deleteVariable / getAllVariables`；`message_id` 支持 `'latest'`、负数深度索引；`message_id` 越界要**抛错**（`[TH] src/function/variables.ts` L61-63） | MVU 的 Model 就是楼层变量 | 初始化/更新全部失败。NyaaChat 现在**根本没有**这套 API（全仓 `grep setVariable` = 0 命中；`src/` 与变量相关的只有 `sessionStorage.ts` 里"退役 `variables` 字段"的清理逻辑，共 3 处命中）。**需要重建变量层** |
| **N5** | **事件总线 + 事件常量表**：`eventOn / eventOnce / eventEmit / eventMakeFirst / eventMakeLast / eventRemoveListener / eventClearAll`；`tavern_events` 至少要有 `MESSAGE_SENT`、`MESSAGE_RECEIVED`、`MESSAGE_DELETED`、`GENERATION_STARTED`、`GENERATION_STOPPED`、`CHAT_CHANGED`、`WORLDINFO_UPDATED`、`CHARACTER_MESSAGE_RENDERED`、`CHAT_COMPLETION_SETTINGS_READY`；`eventMakeFirst/Last` 要有**排序语义**（不是普通 on） | 阶段 1/3/5 全靠它；`eventMakeFirst` 用来抢在世界书请求组装前插入监听 | 变量永远不更新（脚本订阅不到任何东西）。NyaaChat 现有只有 3 个插件事件（`message:received` / `session:changed` / `character:changed`），**粒度与语义都不够** |
| **N6** | **楼层消息读写**：`getChatMessages`（含 `include_swipes`）/ `setChatMessages`（含 `refresh:'none'｜'affected'`、`swipes_data`）/ `setChatMessage` / `getLastMessageId` / `getMessageId` | 变量挂在消息对象上；写变量和写正文是同一次写盘；`refresh` 决定是否重渲染 | 变量无法持久化，或写完不刷新（看板不更新） |
| **N7** | **世界书读写（含禁用条目）**：`getLorebookSettings / setLorebookSettings / getCharLorebooks / getCharWorldbookNames('current') / getCurrentCharPrimaryLorebook / getLorebookEntries / updateWorldbookWith` | `[initvar]` 条目 `enabled:false`，是 MVU 的**唯一初始值来源**；`[mvu_update]` / `[mvu_plot]` 靠 comment 正则过滤 | 初始变量拿不到 → 所有变量为空；`VARIABLE_INITIALIZED` 无意义 |
| **N8** | **脚本按钮**：`getScriptButtons / replaceScriptButtons / appendInexistentScriptButtons / getButtonEvent` + 数据层支持 `button.buttons` | `[MVU.json]` 带 6 个按钮；框架会按启用状态动态增删 | 6 个维护功能不可用（不致命，但角色卡作者依赖） |
| **N9** | **宏替换 `substitudeMacros` + 用户身份**：`getCurrentPersonaName`、`SillyTavern.name1`；`{{user}}` 等要能求值 | initvar 内容、命令路径、前端看板都调它 | 用户名为字面量 `{{user}}` → 看板与 zod key 映射错位 |
| **N10** | **View 层：能"替换"消息文本并渲染 HTML/iframe**：正则的 `markdownOnly` 阶段替换 + 把 ```html 代码块渲染成 iframe + iframe 内注入 `_`/`$`/`getAllVariables`/`eventOn`/`Mvu`/`waitGlobalInitialized`/`errorCatched` | MVU 的 View 完全走这条路 | **变量照常更新，但用户看不到任何 UI**。⚠️ 现有 `TextDecoration` 契约（`src/plugins/types.ts` L42-49）**只能追加、不能替换**，且 `MessageItem.tsx` 的装饰是逐块纯文本偏移——**必须新增"替换/整块渲染"通道**，不能复用装饰器 |
| **N11** | **角色卡 IO 扩展**：导入/导出 `data.extensions.tavern_helper`（`scripts[].{type,enabled,name,id,content,info,button,data,export_with}`）；按当前角色卡切换启用集合 | NyaaChat 已在 `src/lib/sillyTavernImport.ts` L108 读 `data.extensions.regex_scripts`、L170 读 `data.character_book.entries`，**但没有读 `tavern_helper`** | 脚本根本不会出现在 NyaaChat 里。现有实现可直接照 regex 的既有模式扩展 |
| **N12** | **全局初始化握手**：`initializeGlobal` / `waitGlobalInitialized('Mvu')`，语义 = "若已存在则立即返回，否则等 `global_<名字>_initialized` 事件"；另需 `waitMvu()` 式的"等变量真正出现"兜底 | `[zod.json]` 与前端看板都在等 `Mvu` | 脚本拿不到 `Mvu` → zod 校验与看板全废 |
| **N13** | **提示词阶段的变量宏**：`{{format_message_variable::路径}}` / `{{get_message_variable::路径}}`，作用于**最新楼层**、输出 YAML/JSON、且**跳过 `$` 开头键** | `[card.png] / data.character_book.entries[13]` 就靠它把当前状态喂给 AI | AI 看不到当前状态 → 只会瞎改或重复设置；`$internal` 会泄漏进提示词 |
| **N14** | **额外模型解析（可选但 `[MVU.json]` 默认启用相关 UI）**：`generate`（带 `injects:[{position:'in_chat',depth,role,content}]`）/ `generateRaw` / `stopGenerationById` / `SillyTavern.registerMacro('lastUserMessage',…)` / 临时改写 `chatCompletionSettings.custom_include_body` / `SillyTavern.ToolManager.isToolCallingSupported()` / 版本闸 `getTavernHelperVersion() >= '4.8.4'` | "额外模型解析"用第二个模型专门算变量；另有一条"工具调用"（function calling）路径 | 只影响"额外模型解析/工具调用"这两档更新方式；"随 AI 输出"档不需要。**建议 NyaaChat 首版只做"随 AI 输出"**，N14 整体降级或不做 |

### 5.1 现有基础（可直接复用，无需重造）

| 已有 | 位置 | 对 MVU 的用处 |
|---|---|---|
| ST v3 正则导入 | `src/lib/sillyTavernImport.ts` L102-133（`data.extensions.regex_scripts`） | View 层的正则部分已有进口通道 |
| ST v3 世界书导入 | 同上 L170 起（`data.character_book.entries`） | `[initvar]` 条目的**数据**进得来（但读/写 API 还没有） |
| ST v3 正则导出 | `src/lib/sillyTavernExport.ts` L117-123 / L145 | 导出侧同源 |
| 插件框架 | `src/plugins/*`（types 111 行 / runtime 306 行 / decorators 221 行 / hostContext 136 行 / backend 113 行） | 设置面板、启用状态、配置持久化可直接用 |
| 宏替换引擎 | `src/lib/regex/macros.ts`（`MacroEnv` / `setDefaultEnvProvider` / `setChatAccessor` / `substituteParams`） | N9、N13 的地基 |

---

## 6. 不确定 / 未确认项

| # | 项 | 现状 | 建议 |
|---|---|---|---|
| **U1** | `[bundle]` 并非给定材料，且随上游 commit 漂移 | 本文分析的是 build `2026-09-15 08:44` / commit `42753fd` 的副本（538090 字符 / 3 行）。`[MVU.json]` 每次运行都会重新拉最新版 | 若要固定行为，NyaaChat 侧必须**锁定版本**（自托管一份 artifact 或改为按 commit hash 的 jsdelivr URL），否则上游一改行为就变 |
| **U2** | MVU 完整设置项与默认值未逐一枚举 | `[bundle]` 内有大量设置（更新方式、破限方案、应答格式、模型来源、世界书白/黑名单正则、自动清理变量、通知开关、兼容性开关…），本文只列了被调用到的部分 | 实现前需对照 `[bundle]` 设置面板逐项确认"哪些是 MVU 自己的、哪些必须由宿主提供" |
| **U3** | `mag_invoke_mvu` / `mag_update_variable` 两个外部调用入口的语义 | `[bundle] @339839` 定义，`@535737` 区段 `kt(st,Qo)` / `kt(lt,qt)` 订阅；具体入参/返回值未逐行读透 | 若不做"脚本间互相调用"，可先不实现 |
| **U4** | `[card.png]` 的第三条正则（`只发送最新2楼的变量更新`）`minDepth:4` 与 ST 的深度语义对应关系 | 只读到字段值，未验证 ST 侧的实际裁剪窗口 | 实现正则的 minDepth/maxDepth 时以 ST 源码为准 |
| **U5** | 另一张参考卡 `SillyTavern-类脑角色卡-道渊v5.2_1.png`（同目录）是否使用同一套 MVU | **未分析**（任务未要求） | 可作为第二样本验证本文结论的普适性 |
| **U6** | `data.extensions.persona_engine` | 实测是"万象编辑器"的导出快照（`version:4` / `exportedAt` / `workflow_snapshot.card…`），**与 MVU 无关**；未深究 | 确认 NyaaChat 是否需要在导入时忽略/保留该字段 |
| **U7** | 离线可用性 | 全部依赖走 `testingcf.jsdelivr.net`。本文**未验证**这些 URL 的可替代性（是否有 npm 包形式的等价物、自托管后 UUID 化的相对导入是否还能解析） | 若要内网/离线运行，需单独立项评估 |
| **U8** | `[TH]` 本地源码版本 vs 文档站版本 | 本地 `[TH]` 为参考拷贝，`@types/iframe/exported.mvu.d.ts` 里事件名拼写（`mag_variable_initiailized`）与实际运行值不符，且缺 3 个 `_for_zod` 事件与 `SINGLE_VARIABLE_UPDATED` | 以 `[bundle]` 运行值为准；`.d.ts` 只当参考 |
| **U9** | NyaaChat "角色变量"的现状 | `NyaaChat-Docs/doc-files/roleplay/variables.md`（**75 行**）描述了 `variables` 字段 + `setVariable()` 正则更新，但 **NyaaChat 全仓 `grep setVariable` 0 命中**，`src/` 内与变量相关的实现未找到 | **需项目方确认**：该文档描述的是"已实现"还是"设计目标"。这直接决定 N5/N4 是"新建"还是"改造" |
| **U10** | `SINGLE_VARIABLE_UPDATED` 事件的消费者 | `[bundle]` 广播它，但本文未找到消费方（可能是给外部脚本/看板用的扩展点） | 实现事件总线时至少要让它可以被订阅 |

---

## 附录 A：关键结论速查（给实现者的 7 条）

1. **存储 = 消息楼层变量**（`chat[i].variables[swipe_id]`），不是角色卡变量、不是聊天变量。角色卡变量/聊天变量只是可选副本。
2. **初值 = `[initvar]` 世界书条目**，该条目 `enabled:false`——宿主必须能读禁用条目。
3. **schema 不是必需的**（非 zod 版靠推断），但 **`VARIABLE_INITIALIZED` 事件是必需的**（zod 版挂在这）。
4. **zod 版有 3 个未文档化的内部事件依赖**：`COMMAND_PARSED_for_zod`、`COMMAND_PARSED_ended_for_zod`、`VARIABLE_UPDATE_ENDED_for_zod`。宿主自己实现 MVU 主框架时**必须补 emit**，否则"支持 mvu_zod"是假的。
5. **View 走"正则替换 + html→iframe"**，与 NyaaChat 现有"只追加不替换"的装饰器契约冲突，必须新增替换通道。
6. **AI 侧协议**是"JSON Patch 方言"（`replace/delta/insert|add/remove/move`，JSON Pointer 路径），由世界书条目教给 AI；解析器同时兼容 `_.set(...)` 老式命令。
7. **更新触发点**是 `MESSAGE_SENT`（用户楼层）+ `MESSAGE_RECEIVED`（AI 楼层）+ `CHAT_CHANGED`/`GENERATION_STARTED`（初始化），另有 `MESSAGE_DELETED`（清理）。

## 附录 B：取证命令（可复现）

```powershell
# 行数（禁止用 Measure-Object -Line）
(Get-Content -LiteralPath "H:\GitHub\.ref\SillyTavern\mvu\酒馆助手脚本-MVU.json").Count        # 42
(Get-Content -LiteralPath "H:\GitHub\.ref\SillyTavern\mvu\酒馆助手脚本-mvu_zod.json").Count   # 17

# 解出 PNG 内嵌角色 JSON
$p = "H:\GitHub\.ref\SillyTavern\mvu\SillyTavern-万象编辑器MVU角色卡-身为男生的我竟然被安排进了女生宿舍.png"
$b = [System.IO.File]::ReadAllBytes($p); $pos = 8
while ($pos -lt $b.Length - 8) {
  $len = [int]$b[$pos]*16777216 + [int]$b[$pos+1]*65536 + [int]$b[$pos+2]*256 + [int]$b[$pos+3]
  $type = [System.Text.Encoding]::ASCII.GetString($b, $pos+4, 4)
  if ($type -eq 'tEXt') { $txt = [System.Text.Encoding]::UTF8.GetString($b, $pos+8, $len); break }
  if ($type -eq 'IEND') { break }
  $pos += 12 + $len
}
$nul = $txt.IndexOf([char]0); $key = $txt.Substring(0,$nul)
$json = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($txt.Substring($nul+1)))
$o = $json | ConvertFrom-Json
$o.data.extensions.tavern_helper.scripts | ForEach-Object { "$($_.name)  id=$($_.id)  contentLen=$($_.content.Length)" }

# 下载 MVU 主框架实现（本文 [bundle]）
Invoke-WebRequest "https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js" -UseBasicParsing -OutFile "$env:TEMP\mvu_bundle.js"

# 下载 mvu_zod 的 registerMvuSchema 实现
Invoke-WebRequest "https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js" -UseBasicParsing -OutFile "$env:TEMP\mvu_zod_util.js"

# 交叉验证：[bundle] 用到了哪些酒馆助手 API
#   1) 从 [TH]\@types\function\*.d.ts 与 @types\iframe\*.d.ts 抽出全部 declare function/const（实测 171 个）
#   2) 对每个名字在 bundle 里做词边界匹配 (?<![\w$.])名字\s*\(
#   结果即本文 §3.1 的 32 项。
```

## 附录 C：本文引用的外部资料（外部不可信数据，仅作资料）

- 变量类型 · 获取变量 · 替换或修改变量 · 注册变量结构 · 变量管理器 —— 酒馆助手官方文档
  <https://n0vi028.github.io/JS-Slash-Runner-Doc/>
- MVU 主框架源码仓库：`MagicalAstrogy/MagVarUpdate`
- `mvu_zod` 所在仓库：`StageDog/tavern_resource`
- 角色卡示例的编辑器：万象编辑器（`data.extensions.persona_engine` 快照）
