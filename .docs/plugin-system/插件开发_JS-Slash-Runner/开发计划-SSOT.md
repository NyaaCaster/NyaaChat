# NyaaChat 插件系统 V1 · 第二阶段（JS-Slash-Runner 移植 + 变量系统）—— 开发计划（SSOT）

> **本文件是开发阶段的唯一事实来源。**
> 上游输入：`初始设计.md`（需求）+ `审计报告-JS脚本运行层与变量系统.md`（审计与 D1–D15 拍板）+ `MVU技术性说明.md`（MVU 逆向工程）。
> **状态：待用户审核。** 审核通过前不写任何实现代码（`初始设计.md:50`）。

---

## 0. 范围与术语

### 0.1 本阶段做什么（D1）

| 做 | 不做（non-goals） |
|---|---|
| ① **JS 脚本运行层**：在隐藏同源 iframe 内执行角色卡自带的 JS 脚本，并向脚本提供 TavernHelper 兼容 API 子集 | NG1 酒馆助手的**前端渲染**（NyaaChat 有 `frontendCard`） |
| ② **卡片脚本 IO**：脚本随角色卡导入 / 导出 / 切换 / 列表 / 启用禁用 / 删除 / 排序 | NG2 ST **预设导入** |
| ③ **变量系统定向扩展**：message + chat + global 三作用域，使其满足 MVU 的最低要求 | NG3 **语音/音频**（与 `quote-tts` 冲突） |
| ④ **变量宏进提示词**：`{{get_/format_*_variable::}}`（D6-①'） | NG4 **提示词注入框架**（JSR 的 `injectPrompts`） |
| ⑤ **前端卡宿主 API 注入**（D14）：让 MVU 的 View 在卡片 iframe 内可读变量 | NG5 **变量管理器 UI**（`初始设计.md:12` 明确不要） |
| ⑥ **自托管 vendor**（D7①/D15）：MVU bundle 与运行时依赖同源化 | NG6 **脚本在线编辑**（`初始设计.md:14` 明确不要） |
| | NG7 用户自创 MVU 脚本的能力（只保证"跑别人的卡"） |
| | NG8 ST 扩展机制本身、character/preset/script/extension 四个变量作用域 |

### 0.2 术语

- **宿主**：NyaaChat 主应用（`src/**`）。
- **插件**：`plugins/**` 下的构建期模块（本阶段新增 `plugins/js-slash-runner/`）。
- **脚本**：**运行期数据**（来自角色卡 JSON），不是插件代码。
- **脚本宿主 / ScriptHost**：执行脚本的载体抽象（D13② 的可替换层）。
- **MVU**：`MagVarUpdate`，被塞进酒馆助手脚本的社区变量框架（Model-View-Update）。

---

## 1. 已确认决策（D1–D15）

完整拍板表见审计报告 §11。实施时必须逐条落地，**不得静默偏离**；需要偏离时先回来改本 SSOT 并经用户确认。

| # | 决策 | 落地要点 |
|---|---|---|
| D1 | 范围边界 | §0.1 表，NG1–NG8 一律不做 |
| D2 | 变量路线 **A**（按 B 的第一阶段组织） | 作用域做成**注册表**（`SCOPES` 表驱动），后续加 character/preset 只需加一项 |
| D3 | 守门解除 **①** | 仅撤销 `src/lib/sessionStorage.ts:24-25` 的 `RETIRED_MESSAGE_KEYS`；`RETIRED_SESSION_KEYS=["metadata"]` **保留**；`settingsBackup.ts` **完全不动**；chat 变量用会话自有新字段，**不**用 `chat_metadata`/`extension_settings` |
| D4 | 变量形状 **①** | `Message.variables: Array<Record<string, unknown>>`，**恒 1 槽**；`swipe_id ≡ 0`；`getChatMessages()` 返回项的 `.data === variables[0]` |
| D5 | 执行/隔离 **①** | 同源隐藏 iframe、**不加 sandbox**、UI 风险提示；不做 postMessage 沙箱桥 |
| D6 | 变量宏 → **①'（修正后）** | 永久条目命中变量宏 ⇒ **改由动态尾部渲染**（静态前缀字节不变）；详见审计报告 §11「修正项 D6-R」 |
| D7 | MVU bundle **①** | 自托管 + 记录 upstream commit/日期/sha256；**不**放宽 CSP 到 CDN |
| D8 | 落盘字段 **①** | `CharacterSettings.scripts?: ScriptRecord[]` ↔ ST `data.extensions.tavern_helper.scripts` 双向映射 |
| D9 | API 面 **①** | 只实现 §4.4 表内 API；表外的 JSR API **必须显式报错**（`throw new Error("[js-slash-runner] V1 未实现：<name>")`），**禁止静默返回 undefined** |
| D10 | 脚本库 UI | 列表（名称 + 绿色启用点）/ 启用禁用 / 删除 / 拖拽排序 / 导入；**无**在线编辑 |
| D11 | 可见性 **①** | 不新增用户可见变量 UI；同步修正 `NyaaChat-Docs` 的 `variables.md`（**另一仓库，单独提交**） |
| D12 | P 划分 | §8（P1–P5） |
| D13 | CSP **②** | **本阶段不修 nginx/前端卡 CSP**；脚本载体抽成 `ScriptHost` 抽象；CSP 未下发登记为独立问题（§12） |
| D14 | 前端卡 API 注入 | `frontendCard` 的卡片 iframe 在插件启用时注入只读+变量宿主 API（MVU 的 View 在其内调用 `getAllVariables()`） |
| D15 | vendor 自托管 | `public/vendor/script-host/**` + 脚本宿主文档内 `<script type="importmap">` 重映射远程 ESM |

---

## 2. 架构

### 2.1 分层（谁 import 谁）

```
                    ┌──────────────────────── 宿主（构建期，src/**）────────────────────────┐
plugins/js-slash-runner/*  ──type-only──▶ src/plugins/types.ts
        │                  ──runtime────▶ src/plugins/scriptHost.ts   ← 叶子（新）
        │                  ──runtime────▶ src/plugins/hostContext.ts  ← 叶子（既有）
        │
        └── 不得 import：src/plugins/{registry,runtime,backend,normalize,index}.ts、
                        src/lib/**（含变量层）、src/components/**
                                    │
宿主在启动时把 API 推入叶子 ───────▶ setScriptHostApi(...)   （src/App.tsx effect）
插件把前端卡注入脚本推入叶子 ──────▶ setCardApiPredefine(...)（插件 setup）
src/components/FrontendCard.tsx ──读叶子──▶ getCardApiPredefine()
src/lib/frontendCard/srcdoc.ts  ──参数───▶ buildCardSrcdoc(html, predefine?)
src/lib/chatPipeline.ts         ──core→core──▶ src/lib/variables/**（变量宏）
src/App.tsx                     ──core→core──▶ src/lib/variables/**（注入 adapter）
```

**硬规则（沿用并扩展既有纪律）**

1. **真正的硬不变量：插件树里不得存在通向 `plugins/registry` 的静态边。** t12 记录的模块环就是这条被破坏的后果 —— 注册表拿到 `undefined` 槽位，插件**静默消失**（列表不显示、backend 调用被拒、装饰被跳过）。由此得出：
   - **禁止**插件 import：`src/plugins/{registry,runtime,backend,normalize,index}.ts`（下游含注册表），以及任何**有状态**的宿主核心（`src/lib/**`、`src/App.tsx`、`src/components/{ChatHeader,ExtensionsModal,MessageItem}.tsx` …）。
   - **允许**插件 import：`src/plugins/types.ts`（type-only）、**叶子** `src/plugins/{hostContext,scriptHost}.ts`、`src/types.ts`（type-only），以及**无状态展示型 UI 原语**。
   - UI 原语白名单（2026-09-16 核对闭包后登记）：`src/components/BaseModal`、`src/components/SettingsFormBits`、`src/components/DeleteConfirmDialog`、`src/components/ConfirmDialog`。判据 = 该模块的 import 闭包内**不存在**任何指向 `plugins/registry` 的路径。**新增白名单条目必须先核对闭包并在本 SSOT 登记**（这是"登记式白名单"，不是"默认可引"）。
   - 说明：`plugins/quote-tts/QuoteTtsSettings.tsx` 早已 import `SettingsFormBits`，与旧版"只允许两个模块"的措辞相抵。本次把规则改写成上面的**真实不变量 + 白名单**，该既有用法**从此合规**，不属偏差。反之，插件**不得**为了沿用旧措辞而复制一份 UI 原语（重复实现会漂移）。
2. 反向（宿主 → 叶子）允许：`App.tsx`、`FrontendCard.tsx` 可 import 叶子。
3. 变量层（`src/lib/variables/**`）**不得** import 任何 `plugins/**`（避免宿主核心依赖插件）。
4. 插件 id：`js-slash-runner`；`meta.name`：**`脚本运行器`**；icon `FileCode2`；`order: 10`。

### 2.2 变量层（`src/lib/variables/**`，新增）

| 文件 | 职责 |
|---|---|
| `types.ts` | `VariableScope = "message" \| "chat" \| "global"`、`VariableOption`、`VariableAdapter` |
| `paths.ts` | `getByPath` / `setByPath` / `deleteByPath`（支持 `a.b[0].c`、`a.-` 追加、数字段）；非法路径抛错 |
| `adapter.ts` | `setVariableAdapter(a)` / `getVariableAdapter()`；**纯读写委托，不含持久化** |
| `scopes.ts` | 三作用域的实现：`message`（会话内 `Message.variables[0]`）、`chat`（会话 `ChatSession.variables`）、`global`（IDB `nyaachat_vars_global` + 内存缓存） |
| `api.ts` | 对外 API：`getVariables` / `replaceVariables` / `updateVariablesWith` / `insertVariables` / `deleteVariable` / `hasVariable` / `subscribeVariables` |
| `macros.ts` | `substituteVariableMacros(text)`：`{{get_/format_*_variable::路径}}`（6 个） |
| `yamlOut.ts` | 最小 YAML 输出器（仅 `format_*` 用；对象/数组/标量/多行块），**不引入新依赖** |
| `index.ts` | barrel（供宿主与 `scriptHost` 实现使用） |

**语义（对齐 JSR，取 MVU 需要的子集）**

- `getVariables(scope, option?)` → **深拷贝**（写回必须经 `replaceVariables`/`updateVariablesWith`）。
- `option.messageId`: `number | "latest"`，默认 `"latest"`；负数按 JSR 语义从末尾计；**越界抛错**（M2 要求）。
- `"latest"` 对 `message` 作用域的取法：**从末尾往前找第一个 `variables[0]` 非空的楼层**（对齐 JSR `macro_like.ts:22`）。
- `updateVariablesWith(updater, scope, option?)`：把当前值深拷贝交给 `updater`，用其返回值整体替换。
- `subscribeVariables(listener)`：任一作用域变更即回调（去抖由订阅方自理）。

**持久化**

- `message` / `chat`：**不做直接持久化** —— 通过 `adapter.commitSession(session)` 交回宿主，由既有会话自动保存链路落盘。
- ⚠️ **适配器注册在 `src/components/ChatInterface.tsx`，不在 `App.tsx`**（2026-09-16 P1 实施期修正）：
  权威的 live `messages` 属于 `ChatInterface`；`App` 的 `currentSession.messages` 只是**上一次自动保存时的快照**，
  而 `ChatInterface` 只在 `currentSession?.id` 变化时才从 prop 同步 `messages`（`ChatInterface.tsx` 末尾的 effect）。
  若按 App 的快照重建会话再写回，会把此刻刚生成的回复与楼层变量一起覆盖掉 —— 这是实施期实测到的**真实数据丢失路径**。
  因此 `commitSession` 就地把补丁合到 live `messages` 上，并**显式** `saveSession`（不能只靠自动保存：它 800ms 防抖
  且"没有用户消息就跳过"，而 MVU 正是在开场白楼层写变量）。
- `global`：`idbStorage.setItem("nyaachat_vars_global", json)`，**防抖 500 ms** + `pagehide` 兜底落盘；启动时 `hydrateVariables()` 读入内存缓存。
- `idbStorage.MIGRATED_KEYS` **不新增**该项（该表只服务于"一次性 localStorage→IDB 搬运"；新键是直接写 IDB 的新数据）。

### 2.3 宿主门面：叶子 `src/plugins/scriptHost.ts`（新增）

只 import `../types`（type-only）。两条正交通道：

```ts
// ── 通道 A：宿主 → 插件（App.tsx 启动时推送）──────────────────────────────
export interface ScriptHostVariableApi {
  getVariables(scope: VariableScope, option?: VariableOption): Record<string, unknown>;
  replaceVariables(next: Record<string, unknown>, scope: VariableScope, option?: VariableOption): void;
  updateVariablesWith(updater: (cur: Record<string, unknown>) => Record<string, unknown>, scope: VariableScope, option?: VariableOption): Record<string, unknown>;
  insertVariables(vars: Record<string, unknown>, scope: VariableScope, option?: VariableOption): Record<string, unknown>;
  deleteVariable(path: string, scope: VariableScope, option?: VariableOption): void;
  hasVariable(path: string, scope: VariableScope, option?: VariableOption): boolean;
}

export interface ScriptHostLorebookEntry {
  id: string; comment: string; content: string;
  enabled: boolean; constant: boolean; keys: string; position: "system" | "assistant";
}

export interface ScriptHostApi {
  variables: ScriptHostVariableApi;
  messages: {
    getAll(): Message[];                 // 引用直传（只读约定）
    getLastId(): number;
    update(updater: (messages: Message[]) => Message[]): void;  // 交回宿主 commitSession
  };
  lorebook: {
    getSettings(): { world_info?: { global?: string[] } };      // 兼容壳，见 §4.4
    getCharLorebooks(): { primary: string | null; additional: string[] };
    getEntries(bookName: string): ScriptHostLorebookEntry[];
  };
  identity: { user: string; char: string };
  macros: { substitute(text: string): string };                   // M10 substitudeMacros
  /** 当前角色卡与它携带的脚本（插件**不得**直接读 AppState）。 */
  character: {
    getId(): string | null;
    getName(): string;
    /** 返回 `CharacterSettings.scripts` 的引用快照（只读约定）。 */
    getScripts(): ScriptRecord[];
    /** 交回宿主 commit（宿主负责 setState + 自动保存）。 */
    setScripts(next: ScriptRecord[]): void;
  };
  /** 上游 bundle 的 import-map 目标（同源），见 §5.3 */
  vendor: { mvuBundleUrl: string; mvuZodUrl: string };
}
export function setScriptHostApi(api: ScriptHostApi | null): void;
export function getScriptHostApi(): ScriptHostApi | null;

// ── 通道 B：插件 → 前端卡（插件 setup 推送，FrontendCard 读取）─────────────
export function setCardApiPredefine(script: string | null): void;
export function getCardApiPredefine(): string | null;
export function subscribeCardApiPredefine(listener: () => void): () => void;
```

实现方（宿主侧）：`src/plugins/scriptHostImpl.ts`（**实现文件，插件禁止 import**），由 `App.tsx` 的 effect 构造并调用 `setScriptHostApi`。

### 2.4 脚本执行器（插件内）

```
plugins/js-slash-runner/
  plugin.tsx              # NyaaPlugin 契约实现（meta/defaults/setup/SettingsPanel）
  executor/
    host.ts               # ScriptHost 接口 + 选择器（spike 结论决定默认实现）
    srcdocHost.ts         # 实现 1：srcdoc iframe（D13② 下的当前实现）
    predefine.ts          # 注入脚本生成（TavernHelper / _ / z / $ / YAML / toastr / Mvu / SillyTavern 壳）
    importMap.ts          # 远程 URL → 自托管 URL 的 importmap 生成
    apiSurface.ts         # JSR 兼容 API 的**形状**实现（调用 scriptHost 门面）
    events.ts             # tavern_events 常量表 + 宿主事件 → 脚本事件的派发
    errors.ts             # 脚本错误收集（环形缓冲，最多 20 条）
  scripts/
    store.ts              # 当前角色脚本的读/写/启停/排序（**唯一**经 scriptHost 门面的 `character` 通道）
  ScriptLibraryModal.tsx  # 脚本库 UI（列表/启用/删除/排序/导入）
  ScriptRunnerSettings.tsx# 插件设置面板（开关/风险提示/最近错误/脚本库入口）
  vendor.ts               # vendor 路径常量 + 溯源信息
```

**ScriptHost 接口（D13② 的可替换层）**

```ts
export interface ScriptHostMountArgs {
  container: HTMLElement;
  scripts: ScriptRecord[];      // 已按 UI 顺序排好，仅 enabled 的
  api: ScriptHostApi;           // 门面快照
  identity: { user: string; char: string };
  scriptId: string;             // M12 getScriptId()
}
export interface ScriptHostHandle {
  reload(args: ScriptHostMountArgs): Promise<void>;
  emit(eventName: string, payload?: unknown): void;   // 派发 tavern 事件
  dispose(): void;
}
export interface ScriptHost {
  readonly kind: "srcdoc" | "resource-document";
  mount(args: ScriptHostMountArgs): Promise<ScriptHostHandle>;
}
```

- 当前实现 = `srcdocHost.ts`（一个角色一个隐藏 iframe；脚本按顺序在同一 iframe 内依次执行）。
- 预留 `resource-document`：将来修 CSP 时改为指向真实同源文档 `/script-host.html`（该文档自带放宽的响应头）。**切换只允许改 `host.ts` 的选择器 + 新增一个实现文件。**

**iframe 装配（`srcdocHost.ts`）**

1. `<base href="{origin}/">`（沿用 `frontendCard/srcdoc.ts` 的做法）。
2. `<script type="importmap">`：把上游远程 ESM 映射到自托管 URL（§5.4）。
3. 顺序加载自托管全局库：`lodash` → `jquery` → `toastr` → `yaml` → `zod`（ESM 包装，写 `window.z`）。
4. 内联 `predefine.ts` 产出的脚本：定义 `TavernHelper`（去前缀绑定）、`SillyTavern` 壳、`Mvu` 镜像、`waitGlobalInitialized`/`initializeGlobal`、`substitudeMacros`、事件函数与 `tavern_events`。
5. 逐个把脚本内容包成 `<script type="module">` 注入（顺序执行，`await import` 链或 `type=module` 的自然序）。
6. 全局初始化握手：MVU bundle 执行后写 `window.Mvu`；predefine 用轮询/MutationObserver 检测到后 → 镜像到 `window.parent.Mvu` → 触发 `global_Mvu_initialized`（M7）。

**`<script type="module">` 内的脚本无法用 `eval` 之外的方式拿到"当前脚本 id"** ⇒ `getScriptId()`（M12）由 predefine 在每个模块前设置一个模块局部常量：本实现把每个脚本包成

```js
const __scriptId = "mvu_VariableUpdate_<id>";
window.getScriptId = () => __scriptId;   // 逐个脚本覆盖，脚本执行期间有效
```

> ⚠️ 这是 V1 的近似做法（脚本多为"加载即注册事件"的形态，执行期取值足够）。若实测发现脚本在事件回调里取 `getScriptId()` 且拿错 id，则回退方案：每个脚本一个独立 iframe（代价：多 iframe 且 `window.parent.Mvu` 镜像仍成立）。
> **该点在 P3 的 spike 中必须验证并记录结论。**

### 2.5 脚本模型与卡片 IO

```ts
// src/types.ts（新增，纯增量可选字段）
export interface ScriptRecord {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  /** —— 以下为 ST 互操作保真字段，原样往返，插件不解释 —— */
  type?: string;                                   // ST: "script"
  info?: string;
  button?: unknown;
  data?: unknown;
  exportWith?: { data?: boolean; button?: boolean }; // ST: export_with
}

export interface CharacterSettings {
  // …既有字段不动…
  /** 角色卡附带的 JS 脚本（ST: data.extensions.tavern_helper.scripts）。
   *  与 regexScripts 对称：随角色卡导入/导出/切换。 */
  scripts?: ScriptRecord[];
}

export interface Message {
  // …既有字段不动…
  /** 楼层变量（MVU 的 Model）。按 swipe 索引 —— NyaaChat 无 swipe，
   *  恒为单元素数组（swipe_id ≡ 0）。D4。 */
  variables?: Array<Record<string, unknown>>;
}

export interface ChatSession {
  // …既有字段不动…
  /** 会话级变量（MVU 的"更新到聊天变量"）。D3①：不用 chat_metadata 命名。 */
  variables?: Record<string, unknown>;
}
```

**映射（唯一实现 = 宿主 `src/lib/sillyTavernScripts.ts`，纯函数）**

| 方向 | 规则 |
|---|---|
| ST 卡 → NyaaChat | `data.extensions.tavern_helper.scripts[]` → `ScriptRecord[]`：`id`（缺失时生成 `st-<n>`）、`name`（缺失时 `脚本 <n>`）、`content`、`enabled ?? true`、`type/info/button/data` 原样、`export_with` → `exportWith` |
| NyaaChat → ST 卡 | 反向映射，**保留未知字段**（`type/info/button/data/exportWith` 原样写回 `export_with`），使往返保真 |
| 原生卡 | 直接读写 `scripts` 字段 |

**职责边界（避免同一份映射写两遍）**

- **ST 结构 ↔ `ScriptRecord` 的映射**：只存在于宿主 `src/lib/sillyTavernScripts.ts`，只有 `sillyTavernImport.ts` / `sillyTavernExport.ts` 调用。
- **插件侧**（`plugins/js-slash-runner/scripts/store.ts`）：只做"当前角色 `ScriptRecord[]` 的读 / 写 / 启停 / 排序"，**完全不认识 ST 结构**，数据经 `scriptHost` 门面的 `character` 通道进出。

**导入/导出的落点（宿主侧，必须改）**

- `src/lib/sillyTavernImport.ts`：`convertSillyTavernCharacter`（161-209）与 `convertNativeCard`（74-93）调用 `sillyTavernScripts.ts` 读取 `scripts`。
- `src/lib/sillyTavernExport.ts`（117-124）：在写 `data.extensions.regex_scripts` 的同一处调用 `sillyTavernScripts.ts` 写回 `data.extensions.tavern_helper.scripts`。

### 2.6 提示词侧变量宏（D6-①'）

改 `src/lib/chatPipeline.ts`：

1. `renderRule(text, allowVariableMacros: boolean)` 增加第二参数；`true` 时在 `{{user}}/{{char}}` 之后、WORLD_INFO 正则之前调用 `substituteVariableMacros`。
2. `:820-827` 的永久条目循环：把 `activeRules.filter(triggerType==="permanent")` 拆成
   - `permanentStatic`（`content` 不含变量宏）→ 仍进 `systemMessages`（前缀字节不变）；
   - `permanentDynamic`（含变量宏）→ 作为**新的一段**加进 `tailParts`（在关键词条目之后、MCP 之前），沿用同一 `[tag]` 前缀。
3. `:833-849` 的关键词条目：`renderRule(content, true)`。
4. 检测函数：`hasVariableMacro(text)`（在 `variables/macros.ts` 导出）。

**宏语义**

| 宏 | 输出 | 取值口径 |
|---|---|---|
| `{{get_message_variable::路径}}` | 一行 JSON（`JSON.stringify(value)`） | 默认"最后一个变量非空的楼层"；`路径` 省略 = 整个对象 |
| `{{format_message_variable::路径}}` | YAML 块（`yamlOut`） | 同上 |
| `{{get_chat_variable::路径}}` / `{{format_chat_variable::路径}}` | 同上 | 会话作用域 |
| `{{get_global_variable::路径}}` / `{{format_global_variable::路径}}` | 同上 | 全局作用域 |

- 路径分隔符 `/`（JSR 风格，`/stat_data/世界/当前日期`）与 `.` 两种写法都接受。
- **路径不存在**：输出空串 + `console.warn` 一次（每会话每宏一次，避免刷屏）。
- `format_*` 的输出必须是**合法 YAML**（缩进块），用 `yamlOut.ts` 生成。
- 样例卡 `变量列表` 的期望结果：`<status_current_variables>\n<stat_data 的 YAML>\n</status_current_variables>`。

### 2.7 事件模型

`src/plugins/types.ts` 的 `PluginEventName` **纯增量扩展**（SSOT §10.1 的契约变更流程已由本文件满足）：

```ts
export type PluginEventName =
  | "message:received" | "session:changed" | "character:changed"      // 既有 3 个
  | "message:sent" | "generation:started" | "generation:stopped"       // 新增
  | "message:deleted" | "message:rendered" | "worldinfo:updated"
  | "completion:settings-ready";
```

| 宿主事件 | 发射点（宿主侧） | 映射到脚本侧 `tavern_events` | 接线优先级 |
|---|---|---|---|
| `generation:started` | `chatPipeline.ts` 组装 prompt 之前 | `GENERATION_STARTED` | **必须** |
| `message:sent` | 用户消息写入会话后 | `MESSAGE_SENT` | **必须** |
| `message:received` | 助手回复写入会话后 | `MESSAGE_RECEIVED` | **必须** |
| `session:changed` | 切换会话 | `CHAT_CHANGED` | **必须** |
| `character:changed` | 切换角色卡 | `CHARACTER_CHANGED`（JSR 常量名以参照实现为准） | **必须** |
| `message:deleted` | 删除/重生成消息 | `MESSAGE_DELETED` | **必须** |
| `generation:stopped` | 用户中止生成 | `GENERATION_STOPPED` | best-effort |
| `message:rendered` | `MessageItem` 提交后（`useEffect`，**不在渲染期发射**） | `CHARACTER_MESSAGE_RENDERED` | best-effort |
| `worldinfo:updated` | 世界书编辑保存后 | `WORLDINFO_UPDATED` | best-effort |
| `completion:settings-ready` | prompt 组装完成 | `CHAT_COMPLETION_SETTINGS_READY` | best-effort |

- **`tavern_events` 常量表必须完整定义**（含上表全部 + `SETTINGS_UPDATED` 等），即使宿主不发射 —— 否则脚本拿到 `undefined` 事件名并静默失效（M6）。
- best-effort 项若在 P3 结束时**未接线**，必须在 SSOT 的 §11 变更记录与本阶段交接文档中如实登记为"未接线"，不得含糊。

---

## 3. 存储与兼容

| 项 | 结论 |
|---|---|
| `Message.variables` | 新增**可选**字段；老存档无该字段 ⇒ **无需迁移** |
| `ChatSession.variables` | 新增可选字段，同上 |
| `src/lib/sessionStorage.ts` | **撤销** `RETIRED_MESSAGE_KEYS`（连同其常量、`hasRetiredKeys` 的 message 分支与注释）；**保留** `RETIRED_SESSION_KEYS=["metadata"]` 及其剥离逻辑 |
| `src/lib/idbStorage.ts` | **不改**（新键 `nyaachat_vars_global` 直接读写） |
| `src/lib/settingsBackup.ts` | **不改**（`RETIRED_TOP_LEVEL_KEYS` 保留；`plugins`/`pluginOrder` 的过滤逻辑不变） |
| `SCHEMA_VERSION` | **保持 13**（无结构性变更） |
| `EXPORT_VERSION` | **保持 9**（纯增可选字段，符合 `settingsBackup.ts:30-40` 的冻结理由）。若实施中发现必须上调，**先回本文件拍板** |
| 老数据 | 被剥离的 `variables` 从此被保留（无害）；`metadata` 仍被剥离 |

---

## 4. 宿主 API 面（D9：V1 只实现这些）

### 4.1 全局对象（在脚本宿主 iframe 内注入）

> 🔺 **2026-09-16 增补 `Vue`（必备，非可选）**：t14/t21 实测 —— `mvu/bundle.js` 的 webpack externals 明写 **`Vue` / `YAML` / `z`**（`4061(e){e.exports=Vue}` 等），并使用 `createApp(...).use(pinia)`（**pinia 已内置进 bundle，不是 external**，无需自托管）。缺 `window.Vue` 会在**模块求值阶段**抛 `ReferenceError: Vue is not defined` ⇒ 整链失败。
> **注入顺序（有断言守着）**：`lodash → jquery → toastr → vue → yaml(ESM,globalName:YAML) → zod(ESM,globalName:z)`。自托管源：`/vendor/script-host/vue.global.js`（Vue 3.5.42 classic 全局构建，167,536 B）。
> **两条硬约束**：① Vue 必须是 **classic 全局构建**（`esm:false`，挂 `window.Vue`）且在 bundle 被 `import` 之前就绪；② 所有自托管库路径**必须 `.js` 结尾** —— `.mjs` 会被 nginx 以 `application/octet-stream` + `nosniff` 下发，动态 import 直接被拒（t7 实测的 F1 blocker，dev/prod 同基底）。

| 全局 | 来源 | 说明 |
|---|---|---|
| `TavernHelper` | predefine | 去前缀绑定：`TavernHelper.getVariables === getVariables`（JSR `_bind` 语义） |
| `_` | 自托管 `lodash.min.js` | MVU 用 `_.has/_.set/_.clamp/_.get` |
| `z` | 自托管 zod（ESM 包装） | **必须是 zod v4**（卡片脚本用 `.prefault`） |
| `$` | 自托管 `jquery.min.js` | MVU 的 `initCheck` 第一行即用；mvu_zod 用 `$(() => …)` |
| `YAML` | 自托管 `yaml.min.js` | `[initvar]` YAML 解析 |
| `toastr` | 自托管 `toastr.min.js` | 通知（无 CSS 也不影响逻辑） |
| `SillyTavern` | predefine 壳 | 至少 `name1`(=user) / `name2`(=char)；mvu_zod 读 `SillyTavern.name1` |
| `Mvu` | 上游 bundle 写 `window.Mvu` 后由 predefine 镜像 | 同时写 `window.parent.Mvu`（M7） |

### 4.2 变量 API

`getVariables` / `replaceVariables` / `updateVariablesWith` / `insertVariables` / `deleteVariable` / `hasVariable` / `get_variables_without_clone`(=`getVariables` 直接别名，**返回深拷贝**并在文档注明差异) / `getAllVariables`（N5，**D14 必需**）。

### 4.3 消息 / 事件 / 宏 / 世界书 API

| API | V1 口径 |
|---|---|
| `getChatMessages(range, option?)` | 返回对象含 `{ message_id, role, name, message, data, swipes_data, swipes_id, swipe_id }`；**`data === variables[0]`**（M4）；`range` 支持 `number`/`"latest"`/数组/`{start,end}`；`option.include_swipes` 支持（M3，单槽） |
| `setChatMessages(msgs)` | 仅支持 MVU 需要的字段：`message_id` + `data`/`variables` + `swipes_data`；其余字段 **抛"V1 未实现"** |
| `getLastMessageId()` | `messages.length - 1`（空会话返回 `-1`，与 ST 一致） |
| `eventOn` / `eventEmit` / `eventRemoveListener` / `eventOnce`(未实现→抛错) | 见 §2.7 |
| `tavern_events` | 常量表（§2.7） |
| `substitudeMacros`（**上游错拼名，必须保持**） | `{{user}}`/`{{char}}` + §2.6 的 6 个变量宏；其余宏原样保留并 `console.warn` 一次 |
| `getCurrentPersonaName()` | 返回当前用户角色名（`identity.user`） |
| `getScriptId()` | 见 §2.4 的模块局部常量方案 |
| `getLorebookSettings()` | 返回 `{ world_info: { global: null } }` 的兼容壳（NyaaChat 无全局世界书） |
| `getCharLorebooks()` | `{ primary: <角色名>, additional: [] }` |
| `getLorebookEntries(bookName)` | 当前角色的 `worldInfo` **全部条目（含 `enabled:false`）**（M11：`[initvar]` 正是禁用条目）；字段 `{ id, comment, content, enabled, constant, keys, position }` |
| `waitGlobalInitialized(name)` / `initializeGlobal(name, value)` | 支持 `'Mvu'`；`global_Mvu_initialized` 事件（M7） |
| `registerMvuSchema` | **不提供** —— 由脚本自己从远程 ESM import（已由 importmap 映射到自托管） |

### 4.4 未实现者一律显式报错

`createChatMessages` / `deleteChatMessages` / `rotateChatMessages` / `refreshMessage` / `triggerSlash` / `eventEmitAndWait` / `iframe_events.*` / `registerMacroLike` / `injectPrompts` / `generate` / `generateRaw` / `stopGenerationById` / 工具调用 / `getTavernHelperVersion` / character·preset·script·extension 四作用域 / `registerVariableSchema` → 全部经 §4.5 的 Proxy 抛 `[js-slash-runner] V1 未实现：<name>`。

### 4.5 未实现面的实现方式

`TavernHelper` 用 `Proxy` 包裹：已知 API 正常返回；未知属性 get 时 `console.error` + 返回一个**抛错函数**（不是 `undefined`），使脚本立刻报出可读错误而非静默失效（D9 要求）。

---

## 5. 执行环境与 vendor（D7① / D13② / D15）

### 5.1 为什么不是"直接 eval"

- 现状可用（CSP 未下发），但 D13② 决定抽成 `ScriptHost` 抽象；`srcdoc` 在 CSP 生效时不可用 ⇒ 实现必须可替换。
- **不使用 `eval`/`new Function`**：脚本以 `<script type="module">` 注入 srcdoc 文档，天然获得模块作用域与 `import` 能力（MVU 的 loader 就是 `import '…'`）。

### 5.2 vendor 目录（自托管）

```
public/vendor/script-host/
  PROVENANCE.md          # 每个文件的来源 URL / upstream commit / 取回日期 / sha256
  lodash.min.js
  jquery.min.js
  toastr.min.js
  yaml.min.js
  zod.mjs                # zod v4 ESM（含写 window.z 的一行包装）
  mvu/bundle.js          # MagicalAstrogy/MagVarUpdate artifact/bundle.js
  mvu/mvu_zod.js         # StageDog/tavern_resource dist/util/mvu_zod.js
```

- 体积代价：≈ 0.9–1.1 MB 的**跟踪文件**（与既有 `public/webfonts/**` ~800 KB 同量级）。
- **禁止硬编码任何部署地址**；`PROVENANCE.md` 只记录**上游公开 URL + commit + sha256**。
- 更新流程：`dev-server/tools/update-script-host-vendor.py`（新增，Python，符合工作空间脚本规范）：下载 → 校验 sha256 → 写入 `PROVENANCE.md`。

### 5.3 远程 ESM 重映射（importmap + 清单驱动）

> ⚠️ **2026-09-16 修正（t1 实测发现）**：MVU 的产物**不自包含** —— `mvu/bundle.js` 开头有 **51 个**静态 `import … from 'https://testingcf.jsdelivr.net/npm/…'`（`@earendil-works/pi-ai@0.85.1`×43 + `@google/genai` + `mathjs` + `@intlify/*` + `json5`/`jsonrepair`/`klona`/`compare-versions`），`mvu/mvu_zod.js` 另有 5 个。**只映射 2 个顶层 URL 是不够的**：那 56 个依赖会**直接走公网 CDN**（当前无 CSP 时才"看起来能用"），一旦网络不可达或真下发 `script-src 'self'`，MVU 会**整链加载失败**。闭合体积约 **0.42 MB**。

**做法：importmap 由 vendor 清单生成，而不是手写两个 URL。**

> ✅ **t14 实测结论（spike S-a 已答）：importmap 能覆盖模块内部硬编码的绝对 `https://` 说明符。** headless Chrome 152 + CDP，把 `testingcf.jsdelivr.net` / `cdn.jsdelivr.net` / 虚构域**全部 DNS 黑洞到 `127.0.0.1:1`** 后加载真实 `mvu/bundle.js`：静态与动态 import、CDN 根相对 `/npm/…/+esm`、闭包文件全部解析到本地，整张模块图 **72 次取用全走本地、CDN 请求 0 次**，且在 **srcdoc iframe（P3 真实载体）内同样成立** ⇒ **无需改写上游说明符**（改写会破坏 sha256 溯源）。
> **验收口径裁定**：原验收“闭包内不得出现任何 https 说明符”与“不得改写 bundle.js 的 import”互斥，故按可执行口径落地为「**closure 子树 0 个 https 说明符 + 全目录 0 个*未映射*说明符**」；仅剩 56 个（bundle.js 51 + mvu_zod.js 5）全在 `manifest.json` 里且被 importmap 覆盖。
> ⚠️ **两个部署坑（t14 实测）**：① `.gitignore` / `.dockerignore` **会吞 `dist/` 目录**（曾有 6 个闭包文件被吞，已用段名转义 `dist_` + `git check-ignore` 断言修好）；② 将来真下发 `script-src 'self'` 时，**inline 的 `<script type="importmap">` 本身**也需 nonce/hash 或 `'unsafe-inline'`，否则 manifest 再全也白搭（补 D13① 的空白）。

```ts
// 运行时：同源读取清单（CSP 下 connect-src 'self' 允许），构建 importmap
const manifest = await (await fetch("/vendor/script-host/manifest.json")).json();
const imports = Object.fromEntries(manifest.entries.map(e => [e.url, e.path]));
srcdoc = `<script type="importmap">${JSON.stringify({ imports })}</script>` + …
```

- 清单 `public/vendor/script-host/manifest.json` 由 `dev-server/tools/update-script-host-vendor.py` **生成**（不得手工维护），字段 `{ url, path, sha256, bytes }`，按 `url` 排序以便复现；顶层两条（MVU bundle / mvu_zod）也在其中。
- **闭包必须完整闭合**：`public/vendor/script-host/**` 下所有 `.js` 中**不得再出现任何 `https://` 形式的 import 说明符**（这条有可复跑断言，不能靠人眼）。若实测证明 importmap **无法**覆盖"模块内部的绝对 https 说明符"，必须在实施报告里如实说明并改用最小说明符重写方案。
- 未登记的外部 import（ST 卡片里其它第三方库）：**不拦截**，走网络；失败由脚本自行报错。
- 上游引用的是**不带版本号**的 `artifact/bundle.js` ⇒ `PROVENANCE.md` 必须记录"取回时的 commit + 版本 + 文件 sha256"，作为可追溯的唯一手段。
- 加载方式（t1 实测）：`lodash`/`jquery`/`toastr` 是 classic 全局脚本；`yaml.min.js`/`zod.mjs` 是生成的**最小 ESM 包装**（两家官方都无 UMD 产物）⇒ **必须用 `<script type="module">` 加载**；顺序 lodash → jquery → toastr → yaml → zod（toastr 依赖 `window.jQuery`）。zod 必须是 **v4**（卡片脚本用 `.prefault`，已实测可用）。

### 5.4 前端卡 API 注入（D14）

- `src/lib/frontendCard/srcdoc.ts`：`buildCardSrcdoc(html: string, predefine?: string | null)`（**参数可选，默认行为完全不变** ⇒ 插件未启用时字节级等价）。
- `src/components/FrontendCard.tsx`：`useSyncExternalStore(subscribeCardApiPredefine, getCardApiPredefine)`，把非空值传给 `buildCardSrcdoc`。
- 注入内容由插件生成（只读 API + 变量读写，与 §4.2/§4.3 同一实现），使 MVU 的 View（`万象前端界面渲染` 正则产出的 21668 字符 dashboard）能调用 `getAllVariables()`。

### 5.5 已知安全/稳定性边界（如实登记）

1. iframe **同源、无 sandbox** ⇒ 卡片脚本可访问宿主 `window`/IndexedDB（其中含 LLM/ComfyUI/MCP 凭据）。**这不是本阶段引入的**（既有前端卡已如此），但本阶段把它扩展到"运行任意卡片 JS"。UI 必须给出明确风险提示。
2. 同源 iframe **共享事件循环** ⇒ 脚本内死循环会**冻结整个应用**（JSR 同样如此）。V1 不做超时中断（无法安全中断同步死循环）；登记为已知限制。
3. 脚本错误不冒泡到主应用（iframe 隔离），由 `errors.ts` 收集并在设置面板显示最近一条。

---

## 6. 契约变更清单（`src/plugins/types.ts`）

| 变更 | 性质 | 理由 |
|---|---|---|
| `PluginEventName` 增加 7 个成员 | 纯增量联合类型 | §2.7 事件接线；不破坏既有插件（`quote-tts` 未订阅新事件） |
| 其余契约（`PluginMeta`/`NyaaPlugin`/`TextDecoration`/`PluginContext`/`PluginSettingsPanelProps`/`PluginBackendDeclaration`） | **不动** | 变量与脚本 API 全部门面走叶子 `scriptHost.ts`，不改既有签名 |

> 与 SSOT §10.1「契约签名变更必须先改 SSOT 并经用户确认」的关系：本文件即该 SSOT 变更，用户审核通过即视为确认。

---

## 7. 文件级改动清单

### 新增

| 路径 | 内容 |
|---|---|
| `src/lib/variables/{types,paths,adapter,scopes,api,macros,yamlOut,index}.ts` | 变量层内核 |
| `src/lib/sillyTavernScripts.ts` | ST ↔ `ScriptRecord` 映射（宿主侧唯一实现） |
| `src/plugins/scriptHost.ts` | **叶子**：宿主机门面 + 前端卡注入通道 |
| `src/plugins/scriptHostImpl.ts` | 门面实现（宿主侧，插件禁止 import） |
| `plugins/js-slash-runner/**` | 插件本体（§2.4 目录树） |
| `public/vendor/script-host/**` | 自托管 vendor + `PROVENANCE.md` |
| `dev-server/tools/update-script-host-vendor.py` | vendor 更新脚本 |
| `dev-server/tools/verify-js-slash-runner.py` | 端到端验证脚本（§9） |

### 修改

| 路径 | 改动 |
|---|---|
| `src/types.ts` | 新增 `ScriptRecord`；`CharacterSettings.scripts?`；`Message.variables?`；`ChatSession.variables?` |
| `src/lib/sessionStorage.ts` | 撤销 message 级 `RETIRED_MESSAGE_KEYS`（保留 session 级 `metadata`） |
| `src/lib/sillyTavernImport.ts` | `convertSillyTavernCharacter` / `convertNativeCard` 读取 `scripts` |
| `src/lib/sillyTavernExport.ts` | 写回 `data.extensions.tavern_helper.scripts` |
| `src/lib/chatPipeline.ts` | `renderRule` 第二参数 + 永久条目分流（D6-①'）+ 事件发射点 |
| `src/lib/frontendCard/srcdoc.ts` | `buildCardSrcdoc` 增加可选 `predefine` 参数 |
| `src/components/FrontendCard.tsx` | 订阅并传入卡片 predefine |
| `src/plugins/types.ts` | `PluginEventName` 扩展 |
| `src/components/ChatInterface.tsx` | 注册 `VariableAdapter`（权威 live `messages` 在这里，见 §2.2）；自动保存的**逐字段重建**处补上 `variables` |
| `src/main.tsx` | bootstrap 里 `hydrateVariables()` |
| `src/App.tsx` | 启动时注入 `ScriptHostApi`；会话/消息写路径发射事件（**不再**注册 `VariableAdapter`，见 §2.2 的修正） |
| `plugins/registry.ts` | 注册 `jsSlashRunner` |

---

## 8. P 阶段划分与验收标准

> 每个 P 必须**可独立验证、可独立提交**；收尾按 Vibo 规范（commit + 交接文档 + memory）。

### 状态总览

| P | 名称 | 依赖 | 状态 |
|---|---|---|---|
| P1 | 数据模型与变量层内核 | — | ✅ **已复核**（2026-09-16 晚）：`verify-variables-scopes.py` 断言三作用域真机往返（播种 → 改写 → 重载 → 读回**新值**）全绿 |
| P2 | 变量宏进提示词（D6-①'） | P1 | ✅ **已复核**：§9 V6/V7 全绿（离线逐字节断言 + 真实 devlog 里的非空 YAML 实例） |
| P3 | 脚本执行器 + 宿主 API（含 spike） | P1 | ✅ **已复核**：§9 V4–V8 全绿 + **S-b/S-c/S-d 运行期复核全绿**（`verify-script-host-spike.py`；复核过程查出一个真缺陷，见 §11） |
| P4 | 卡片脚本 IO | P1 | ✅ 代码落地并已提交；验收入口＝§9 V4（导入样例卡得 `MVU`+`mvu_zod`）已绿；**原生卡 round-trip / 编辑弹窗保存路径仍无自动断言** |
| P5 | 脚本库 UI + 前端卡注入 + 端到端 | P2, P3, P4 | ✅ **端到端已复核**：§9 V1–V8 **9/9 全绿**（`verify-js-slash-runner.py`）+ `verify-card-status.ts` 逐卡真机验证（苏婷 / 变装女友状态栏为真实变量、零未捕获错误）（见 §12 滚动待办） |

> P2 / P3 / P4 三者在 P1 完成后**可并行**。

### P1 — 数据模型与变量层内核

**做**：`ScriptRecord` / `Message.variables` / `ChatSession.variables` 类型；`src/lib/variables/**`；撤销 message 级守门；global 的 IDB 持久化 + hydrate；`App.tsx` 注入 adapter。

**验收**
1. 三作用域读写往返：`replaceVariables` 后 `getVariables` 得到**深拷贝相等**的值；改动返回值**不影响**存储（深拷贝读契约）。
2. 路径语义：`a.b[0].c` 读/写/删；非法路径抛错；`deleteVariable` 删中间键不影响兄弟键。
3. `messageId` 语义：`"latest"` 命中"最后一个变量非空的楼层"；越界**抛错**；负数索引正确。
4. **守门回归**：写入 `Message.variables` → `saveSession` → 清缓存 → `hydrateSessions` → 变量**仍在**（证明守门确已撤销）。
5. **守门保留**：带 `metadata` 的会话写回后仍被剥离（证明只撤销了 message 级）。
6. `global` 变量：写入 → 重载页面/重新 hydrate → 仍在。
7. `npx tsc --noEmit` 通过；既有测试全绿（无回归）。

### P2 — 变量宏进提示词

**做**：`macros.ts`（6 个宏）+ `yamlOut.ts` + `chatPipeline.ts` 的 `renderRule` 分流。

**验收**
1. 动态/关键词条目里的 `{{format_message_variable::stat_data}}` 被替换为**合法 YAML 块**；非空 `stat_data` 时内容与变量一致。
2. **静态前缀字节不变**：给永久条目注入变量宏后，`:802-827` 产出的前缀与不含该条目的基线**逐字节一致**（断言用序列化字符串比较）；该条目出现在动态尾部。
3. 不含变量宏的永久条目（`[mvu_update]变量更新规则` 等）**仍在静态前缀**。
4. 路径不存在 → 空串 + 恰好一次 `console.warn`。
5. 样例卡 `变量列表`（93 字符）渲染结果包含 `<status_current_variables>` 与 `stat_data` 的 YAML。

### P3 — 脚本执行器 + 宿主 API

**做**：先做 **spike**（见下），再落 §2.4 全部文件 + 叶子 + impl + `PluginEventName` 扩展 + 事件接线。

**Spike（必须先行，结论写回本 SSOT §11）**
- S-a：srcdoc iframe + `<script type="importmap">` + 自托管 ESM 能否在 dev **与 prod 构建**下都加载成功。
- S-b：`<script type="module">` 注入的脚本能否拿到 predefine 定义的**全局**（`$`/`_`/`z`/`YAML`/`TavernHelper`）。
- S-c：MVU bundle 能否在 iframe 内跑起来并写 `window.Mvu`；`waitGlobalInitialized('Mvu')` 能否 resolve。
- S-d：`getScriptId()` 的模块局部常量方案是否够用（不够则改"一脚本一 iframe"）。
- Spike 失败时的回退顺序：① 文本级 URL 改写替代 importmap；② `blob:` URL 载体；③ 一脚本一 iframe。

**验收**
1. 样例卡的 `MVU` + `mvu_zod` 两个脚本在隐藏 iframe 内**无未捕获错误**地执行完毕（`errors.ts` 缓冲为空）。
2. `waitGlobalInitialized('Mvu')` resolve；`window.parent.Mvu` 可读。
3. 第 0 层（开场白）`variables[0].stat_data` 由 `[initvar]` 建立（M3+M11）。
4. 构造一条含 `<UpdateVariable><JSONPatch>…</JSONPatch></UpdateVariable>` 的助手消息并触发 `message:received` ⇒ 对应路径的变量按 patch 更新（M1+M2）。
5. 未实现 API 调用**抛可读错误**（不是 `undefined`）。
6. `tavern_events` 常量表逐项存在（`Object.keys` 断言）。
7. 插件被**停用**时：iframe 被 dispose、无事件订阅残留、前端卡 `predefine` 为 `null`。

### P4 — 卡片脚本 IO

**做**：`src/lib/sillyTavernScripts.ts` + import/export 接线 + 原生卡导出的唯一组装点（`toNativeCardJson`）+ 编辑弹窗保存路径带上 `scripts`。

**验收**
1. 导入样例卡 ⇒ `character.scripts.length === 2`，`names = ["MVU","mvu_zod"]`，`content` 长度分别为 89 / 7113（与卡片原始值一致）。
2. 导出 ST 卡 ⇒ `data.extensions.tavern_helper.scripts` 存在，两个脚本的 `type/enabled/name/id/content/info/button/data/export_with` 与源卡**逐字段相等**。
3. **原生卡导出**（`exportNyaaChat` → `toNativeCardJson`）含 `scripts`；`buildCurrentCharacter` 与**显式保存路径 `handleSave` 的 `onSave({...})`** 都保留 `scripts`（t9：两处都是"逐字段重建"，只修一处则保存仍丢脚本）。
4. 原生卡 round-trip（导出→导入）逐字段相等，**且对 `description` 为空串的卡也成立**（t11：`convertNativeCard` 原先把非空 description 当必填，而样例卡正是空 description ⇒ 往返直接失败；放宽为空档不拒、非字符串仍拒）。
5. 角色卡切换：脚本列表随角色切换（不串卡）。
6. 既有 regex 导入导出**无回归**（`data.extensions.regex_scripts` 仍正确）。
7. **唯一实现**：全仓只有 `src/lib/sillyTavernScripts.ts` 做 `export_with ↔ exportWith` 映射与 `tavern_helper` 键名组装；`CharacterEditModal` 不再内联拼卡 JSON。

### P5 — 脚本库 UI + 前端卡注入 + 端到端

**做**：`ScriptLibraryModal.tsx`（列表/启用/删除/排序/导入）、`ScriptRunnerSettings.tsx`、前端卡 predefine 注入、dev 服端到端验证。

**验收**
1. UI：列表显示脚本名 + 右侧绿色启用点（无开关控件）；可启用/禁用、删除、拖拽排序（顺序持久化）、从卡片/文件导入；**无**在线编辑入口。
2. 设置面板含：启用开关（由 ExtensionsModal 的插件总开关提供）、`defaults = { runOnLoad: true }` 的"加载即运行"开关、**明确的安全风险提示文案**（D5① 要求，须写明"卡片脚本与宿主同源、可访问本机数据，只运行可信来源的卡片"）、最近一条脚本错误。
3. 顺序语义：排序结果决定脚本执行顺序（断言：倒序时 `mvu_zod` 先执行并产出可观察的失败/警告差异，或至少断言执行顺序日志）。
4. 前端卡：MVU 的 View 正则产出的 dashboard 能在消息楼层内渲出**非空**变量内容（`getAllVariables()` 有值）。
5. **dev 服端到端**：见 §9。
6. 交接文档 + `NyaaChat-Docs` 的 `variables.md` 修正（另一仓库单独提交）。

---

## 9. dev 服验证方法（可执行断言）

环境：`NyaaChat/dev-server/`，`python tools/rebuild-dev.py --up`（~95 s），URL `http://127.0.0.1:4095/`（**无鉴权**），容器 `nyaachat-dev-dev-app-1` / `-ext-host-1` / `-devlog-1`。
纪律：**重建前确认源码稳定**（门禁全绿 + mtime 静止），重建后用**打包内字面量**证明生效（`docker image inspect` 的 `Created` 是 UTC）。

`dev-server/tools/verify-js-slash-runner.py`（新增）断言清单。**2026-09-16 晚已落地并跑通**（`python dev-server/tools/verify-js-slash-runner.py`，支持 `--only V5` / `--list`）；实现口径与「未覆盖」项见本节末尾的**执行说明**。

| # | 断言 | 证据 | 实测结果 |
|---|---|---|---|
| V1 | 镜像内产物含新代码 | `dev-app` 容器内 `index-*.js` 的**新字面量**（如 `js-slash-runner`、`nyaachat_vars_global`）出现次数 ≥1 | ✅ 容器内 `index-Co_OvTuh.js` 三个字面量齐全 |
| V2 | 新代码进入产物 | 打包产物内出现 `js-slash-runner` 与 `nyaachat_vars_global` 字面量（各 ≥1 次） | – 本地 `dist/` 是过期快照（实测旧 666 分钟）⇒ 记 **SKIP+原因**，不拿过期产物判失败；该断言已由 V1 用容器内产物覆盖 |
| V2b | 撤销守门生效 | **行为断言**（P1 验收 4/5）：写入 `Message.variables` → 重载 → 仍在；`metadata` → 重载 → 仍被剥离。⚠️ **不得**用"常量名字面量消失"证明 —— 压缩产物里常量名会被改名（本项目既有教训） | ✅ 真实保存后 `variables` 保留、`metadata` 剥离 |
| V3 | vendor 同源可达 | `GET /vendor/script-host/mvu/bundle.js` → 200 且响应体 sha256 == `PROVENANCE.md` 记录值 | ✅ `b0f30a7d…` 与 PROVENANCE 一致 |
| V4 | 导入样例卡得到 2 个脚本 | 端到端脚本（Playwright/CDP）导入 PNG → 断言 localStorage/IDB 中 `character.scripts.length == 2` | ✅ `MVU` + `mvu_zod` |
| V5 | 插件启用后脚本执行 | 断言 `Message.variables[0].stat_data` 存在且含 `世界`/`舍友列表` 键 | ✅ starter 楼层含两键 |
| V6 | 变量宏进 prompt | 经 `devlog` 取到本轮请求体，断言含 `<status_current_variables>` 与 `stat_data` 的 YAML，且**位于尾部 system 消息** | ✅ 双证据：离线 `pipeline` 断言"动态落位 + 宏渲染为非空 YAML"；真实 devlog 里有**非空 YAML 块**（`世界: 当前时间 "07:30" …`）——P2 缺的实例证据就此补齐 |
| V7 | 静态前缀未被污染 | 对比启用/停用插件两轮的静态前缀片段**逐字节一致** | ✅ 前缀 843 B；同变量重复一致、**跨变量变化仍逐字节一致**；对照（不含宏条目仍留前缀）成立 |
| V8 | 前端卡 dashboard 渲染 | 断言楼层内 iframe 出现且 `getAllVariables()` 返回非空（通过 CDP 在 iframe 内求值） | ✅ 卡片 iframe 的 `getAllVariables().stat_data` 非空 |

**执行说明（为什么这么实现，接手者必读）**

1. **零新依赖的 CDP**：宿主只装了 `requests`，没有 `websocket-client`。脚本用 `socket + struct + base64` 手写了一个最小 RFC6455 客户端（文本帧 / 分片 / ping-pong / 掩码），因此 `verify-js-slash-runner.py` **只需标准库 + requests** 即可驱使无头 Chrome。
2. **V6/V7 交给 Node 侧助手** `verify-js-slash-runner-helpers.ts`（Python 侧用 `npx tsx` 调用、只读它 stdout 的一行 JSON）。原因：这两项要跑真实的 `chatPipeline.buildRequestMessages` 并**逐字节**比较 prompt 前缀，而 devlog 里的 `renderedMessages` 是 **JS 对象字面量**（不是 JSON），Python 无法可靠解析。
3. **V2b 必须触发一次真实写入**：`hydrateSessions()` 只把 `metadata` 从**内存缓存**剥掉，**不写回 IDB**；真正落盘的剥离在 `saveSession()`。所以"播种 → 重载 → 读 IDB"会**假失败**。脚本改为用 UI 驱动一次真实发送（应用自己的保存链路），再断言改后的数据。
4. **V7 的切点不能写成 `content.includes("<session_rules>")`**：协议锚（第 0 条 system）的**说明文字本身**就含有该字样，会把它当成尾部、让"静态前缀"变成空串 ⇒ 字节比对退化成"空 == 空"的假通过。实现改为"**从第 1 条起、且以 `<session_rules>` 开头**的那条消息"作切点，并额外断言"前缀非空 + 含常驻条目"作为前置守卫。
5. **仍未覆盖**：`§9 V6` 里"**位于尾部 system 消息**"这一条由离线 `pipeline` 模式断言（真实请求体因日志截断无法可靠判定位置）；V2 需要**新鲜 `dist/`**（跑 `npm run build`）才会真正执行。

> V4–V8 需要登录 + 可用 LLM；若 dev LLM 不可用，则 V6 用"构造消息 + 直接调用 pipeline"的离线单测代替，并在交接文档如实标注**未做真实端到端**（沿用本项目"宁可标未验证，不写假通过"的纪律）。

---

## 10. 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| 撤销守门后老数据行为变化 | 老归档的 `variables` 被保留 | 无害（只是不再剥离）；P1 验收含"`metadata` 仍被剥离"的反向断言 |
| 永久条目分流（D6-①'）改动 prompt 结构 | 可能影响既有卡片的缓存命中 | 只有**含变量宏**的条目被移动；P2 验收含"静态前缀逐字节一致"断言 |
| 变量写入触发 React 重渲风暴 | 卡顿 | 变量写路径与消息写路径统一走 `commitSession`（既有防抖）；global 只在设置面板/状态栏读取 |
| srcdoc 载体在 CSP 修复后失效 | 将来返工 | `ScriptHost` 抽象 + 预留 `resource-document` 实现；spike 结论写回 SSOT |
| 同源 iframe 死循环冻结应用 | 应用不可用 | 已知限制，如实登记（§5.5）；不做不可靠的超时中断 |
| vendor 版本漂移（上游 URL 无版本号） | 行为静默变化 | `PROVENANCE.md` 记录 sha256；升级走 `update-script-host-vendor.py` 并单独提交 |
| 脚本写坏会话数据 | 数据损坏 | `setChatMessages` 只开放必要字段；其余抛错；变量写在深拷贝上进行 |

**回滚**：全部改动集中在**可停用的插件 + 可选字段**上。回滚 = 停用插件（iframe 不挂载、前端卡 predefine 为 `null`、无事件订阅）⇒ 除"会话 JSON 里多一个可选 `variables` 字段"外，系统行为回到本阶段之前。若需彻底回滚：恢复 `sessionStorage.ts` 的 `RETIRED_MESSAGE_KEYS` 即可重新剥离该字段。

---

## 11. 变更记录 / 未完成登记

| 日期 | 变更 |
|---|---|
| 2026-09-16 | 初版：依据审计报告与 D1–D15 拍板建立 |
| 2026-09-16 | **用户拍板：接受 vendor 体积 4.67 MiB**（4,898,223 B / 100 个产物 = 88 closure + 2 top-level + 1 global + 工具产物）。理由：CDN 回退路线有坑（离线或将来修好 CSP 即失效），而 vendor 已实测 importmap 能覆盖全部 56 个模块内说明符 ⇒ 自托管是唯一同时满足"离线可跑"与"未来 CSP 可跑"的路线。已独立核对：public/vendor 下 **无文件被 .gitignore 吞**、closure 恰 88 个文件。 |
| 2026-09-16 | **运行期修复（t19/t22）与 vendor 闭包实测（t14/t21）**：① t7 真机发现 **F1 blocker** —— .mjs 被 nginx 以 pplication/octet-stream+
osniff 下发 ⇒ 动态 import 被拒 ⇒ 库加载整轮中止、mvu/bundle.js 请求 0 次；t19 修法**不动 nginx、不改 vendor 文件**：改 import 官方 ESM 产物（.esm.js）并由 bootstrap 按 globalName 挂 window.YAML/window.z；同时修 **F3**（逐库 try/catch，单库失败不再整链中止）。② t14/t21 实测出 MVU 的 webpack externals 是 **Vue/YAML/z**（pinia 内置、非 external）⇒ **Vue 是必备全局**，t21 自托管 Vue 3.5.42 classic 构建、t22 接入 globals（顺序 lodash→jquery→toastr→vue→yaml→zod）。③ 验收口径裁定与 importmap 实测结论、两个部署坑见 §5.3；全局表增补见 §4.1。④ 独立验证哨兵：cardio 的 harness 在接线前 13 ✓/5 ✗（5 条红全指向缺 Vue）→ t22 后 **18 ✓/0 ✗**。 |
| 2026-09-16 | **P1 实施期修正**：① `VariableAdapter` 的注册点由 `App.tsx` 改为 `src/components/ChatInterface.tsx`（权威 live `messages` 在那里，按 App 快照重建会覆盖刚生成的回复与楼层变量 —— 实测到的真实数据丢失路径）；② 因此新增改动 `src/components/ChatInterface.tsx` 与 `src/main.tsx`（后者只为 `hydrateVariables()`），二者不在 t2 初始 inScope 内，已按"只扩大、不缩小"的记录原则显式登记；③ 新发现并修补"自动保存逐字段重建 session 会丢掉 `ChatSession.variables`"这一陷阱（与退休守门同类）；④ `setByPath` 对中间层数组下标采取"只允许紧接末尾增长、拒绝跳号"的规则（跳号会造出 JSON null 空洞）；⑤ `yamlOut` 对任何含 `:` 的字符串加引号（避免 `07:00` 在 YAML 1.1 下被解析成六十进制数）。 |
| 2026-09-16 | **P3（t6）实施记录**：见 §2.4 的落地文件与下方「spike 结论」。**文件树偏差（如实登记）**：原 §2.4 列的 `executor/{apiSurface,events,errors,importMap}.ts` 与 `scripts/io.ts` **未单独成文件**，而是并入 —— `apiSurface`+`events` → `executor/predefine.ts`（生成注入文本 + `tavern_events` 常量表 + 宿主事件映射，一处内聚更不易漂移）；`errors` → `executor/srcdocHost.ts`（父窗口订阅 iframe 的 `error`/`unhandledrejection`，就近记入 `pluginLog`）；`importMap` → `vendor.ts`（清单加载与回退同处）；`scripts/io.ts` → `scripts/store.ts`（且**刻意不认识 ST 结构**，以保住 t3 的"唯一映射"性质）。另：`ScriptHostHandle` **去掉 `reload`**，重挂载由插件层 `dispose + mount` 实现（避免句柄自我替换的循环依赖）。 |
| 2026-09-16 | **P3 spike 结论（S-a..S-d）**：⚠️ **未在浏览器/headless 里实跑**（本轮未起 dev 容器），故以下为**设计级结论 + t1 的实测输入**，运行期结论一律登记为待 §9 V4–V8 复核，不当作已通过：<br>· **S-a（srcdoc + importmap + 自托管 ESM）**：importmap **由 `manifest.json` 生成**（t14 产出）；t1 已实测 `yaml`/`zod` 是生成的最小 ESM 包装、**必须 `import()` 加载**，zod v4 `.prefault` 可用。**未验证**：importmap 能否覆盖"模块内部的绝对 https 说明符"（`mvu/bundle.js` 的 51 个 import）—— 已列为 t14 的必答项。<br>· **S-b（脚本能否拿到 predefine 定义的全局）**：设计为同一 iframe 文档内、预置脚本先于用户脚本执行；`_`/`$`/`YAML`/`z` 由自托管全局提供。**未验证**（需浏览器）。<br>· **S-c（MVU bundle 能否跑起来、`waitGlobalInitialized('Mvu')` 能否 resolve）**：设计为脚本全跑完后 `__nyaSyncMvu()` 把 iframe 的 `Mvu` 镜像到 `window.parent.Mvu` 并派发 `global_Mvu_initialized`；`waitGlobalInitialized` 亦支持"已存在则立即 resolve"。**未验证**（需浏览器）。<br>· **S-d（`getScriptId()` 方案）**：采用"每个脚本执行前写 `window.__nyaScriptId`"的模块内常量方案（已实现并有断言）；**回退方案**（实测不够用时）：一脚本一 iframe。**未验证**（需浏览器）。<br>若 V4–V8 判定 S-a/S-b/S-c 失败，按 §2.4 的回退顺序切换载体实现（`ScriptHost` 抽象已就位，改 `host.ts` 选择器即可）。 |
| 2026-09-16 | **t1 实测修正 §5.3（重要）**：MVU 产物**不自包含** —— `mvu/bundle.js` 有 51 个、`mvu_zod.js` 有 5 个静态远程 ESM import（全部指向 `testingcf.jsdelivr.net/npm/…`）。故原"只映射 2 个 URL"的方案不足：那 56 个依赖会直接走公网 CDN（当前无 CSP 才"看起来能用"），网络不可达或真下发 `script-src 'self'` 时 MVU 整链失败。已新增 **t14**：用同一张 ASSETS 表把**传递闭包**自托管（闭合约 0.42 MB），并让更新脚本生成 **`manifest.json`**（`url → path + sha256`），P3 的 importmap 改为**由清单生成**而非手写。另记：`yaml`/`zod` 官方无 UMD ⇒ 用生成的最小 ESM 包装、**必须以 `<script type="module">` 加载**；zod 必须 v4（`.prefault` 已实测可用）。 |
| 2026-09-16 | **新增 P6「插件观测层」（用户拍板）**：统一日志叶子 `src/plugins/pluginLog.ts` + 事件处理器归属修复 + 扩展面板运行日志区 + 全局错误兜底（F4，由 t6 在 App.tsx 接线）+ backend 失败记录（F6）。**F5（iframe 卡片脚本错误捕获）仍在 P3/t6。** 同时把 §2.1 的模块规则由"只允许两个模块"改写成**真实不变量（不得通向 `plugins/registry`）+ UI 原语登记式白名单**，使既有 `quote-tts → SettingsFormBits` 用法合规，并禁止插件复制 UI 原语。 |
| 2026-09-16 | **深夜真机验收轮（v12-2043 → v12-2230，4 次修复）**。`3e255c5` 之后，前端卡状态栏在真机上"能渲染但读不到变量"，逐条定位并修复，均已提交（`9ca5caf` / `0acb763` / `bf2639e`）。**逐条如实登记**：<br>① **`getAllVariables()` 形状错误（`9ca5caf`）**：卡片 predefine 原先返回 `{global, chat, message}` 嵌套壳，而 ST 的 `getAllVariables()` 顶层就是合并后的变量表（卡片直接读 `vars.stat_data`）⇒ `stat_data` 永远 `undefined` ⇒ 状态栏每个字段落回**卡片里写死的字面兜底值**（真机：JSONPatch 已把 `世界.当前时间` 改成 07:05，面板仍显示 07:00）。改为返回 `message` 作用域的扁平快照。<br>② **提示词侧 `eventEmit` 丢参数（同 `9ca5caf`）**：`predefine` 的 `eventEmit(name, payload)` 只转发第一个参数，而 MVU 用 `eventEmit(VARIABLE_INITIALIZED, a, o)` 发两个 ⇒ zod 侧处理器拿到 `undefined`（真机 v12-1753 报 `Cannot read properties of undefined (reading 'forEach')`）。改为 `eventEmit(event, ...args)` 逐参转发，`srcdocHost.emit` 同步放宽为 `(name, ...args)`。<br>③ **围栏配对错误（同 `9ca5caf`，`detect.ts`）**：模型会在同一条消息里先给**裸 ``` 围栏**（"[美化]变量完成"正则产出的 CSS 片段）再给卡片围栏；"惰性正则配对"会拿裸围栏去配 ` ```html `，把真正的卡片开围栏当成 CSS 代码块的收尾 ⇒ 整条消息 `types: null`，正文 + CSS + 卡片 HTML 一起漏成气泡纯文本。改为**按行扫描**（`FENCE_LINE`，对齐 GFM"收尾围栏不得带 info string"），未闭合的**卡片**围栏按"到消息末尾"处理，未闭合的**普通**代码块不切。**该修复经 14 个构造形态 + 2 个真实序列（真卡文本回放）验证。**<br>④ **卡片 API 注入整体竞态（`0acb763`）**：`buildCardPredefineScript()` 第一行 `if (!bridge) return;` —— 卡片 iframe 可能早于插件 mount 完成就渲染（打开已有会话 / 楼层重渲染 / 宿主重挂载），那一刻 `window.parent.__nyaScriptHostBridge` 不存在 ⇒ **该 iframe 什么都不装** ⇒ 卡片的 `$(errorCatched(init))` 直接 `ReferenceError`，init 根本没跑。用户可见症状 = **"无法连接变量系统，当前仅显示静态卡面。"**（变装女友卡），非 MVU 卡则是状态栏整块不渲染。改为：不依赖桥的（`errorCatched` / `tavern_events` / 事件总线 / `__nyaCardDispatch` / `Mvu` getter）**无条件先装**；依赖桥的改**动态 getter**（每次调用现取桥，宿主重挂载后自动跟上）；另补上缺失的 `waitGlobalInitialized`，并广播一次 `__nyaCardReady` 供卡片重画。<br>⑤ **未闭合卡片围栏被切两遍（同 `0acb763`，`detect.ts`）**：未闭合分支原来 `continue`，后面再出现一行 ` ``` ` 会被当成新的开围栏，把同一张卡再切一遍 ⇒ `types: [card, markdown, card]`（真机 G·RPG 那次），卡片 HTML 源码夹在中间漏成正文。改为处理完**结束扫描**。<br>**验证方式（新增工具，已入 dev-server 仓 `a4acd75`）**：`dev-server/tools/verify-card-status.ts` —— 每张卡一个独立 Chrome profile，用仓库自己的 `convertSillyTavernCharacter` 导入卡片、向 IDB 播种"插件启用 + 该卡为当前角色 + 开场白"，reload 后采集宿主 iframe 诊断、每个卡片 iframe 的 `getAllVariables()` 形状与渲染文本、切分结果与未捕获错误。**修复前后各跑一遍**：修复前 苏婷卡报 `ReferenceError: errorCatched is not defined`、状态栏退化为 `--:-- 加载中...`；修复后 苏婷 / 变装女友 两张卡**零未捕获错误**且状态栏为真实变量（变装女友：好感度 85 / 羞耻度 70 / 勇气 25 / 顺从度 85 / 性欲 20、時刻 上午、場所 同居公寓·客厅）。 |
| 2026-09-16 | **P2 复核结果（原「待复核」条，已更新）**：`substituteVariableMacros` 与永久条目分流（`chatPipeline.ts:831-844`）已落地，且真机日志里 `<status_current_variables>` **确实出现在组装后的 `session_rules` 中**（证明宏参与了渲染），但**尚未抓到"非空 `stat_data` 时输出合法 YAML 块"的实例**，`§8 P2 验收 1–5` 亦未写成可复跑断言。⇒ 该缺口已由下面的 §9 验收清单补齐（真实 devlog 里取到非空 YAML 块 + 离线逐字节断言）。**P2 现记"验收通过"**。 |
| 2026-09-16 | **真缺陷：事件表在运行期根本不存在 ⇒ `global_Mvu_initialized` 从未被派发**。由 §2.4 的 spike 复核（`verify-script-host-spike.py`）查出，非推断。**症状**：`__nyaSyncMvu()` 在把 `window.Mvu` 镜像到父窗口**之后**、派发 `global_Mvu_initialized` 之前抛 `ReferenceError: TAVERN_EVENTS is not defined` ⇒ 该事件从未派发 ⇒ 订阅它的脚本（典型的：`mvu_zod` 挂在 `mag_variable_initialized` / `VARIABLE_UPDATE_ENDED` 上的用户键迁移逻辑）**静默失效**；`waitGlobalInitialized('Mvu')` 只能靠"已存在即 resolve"兜底才能工作。**根因**：`TAVERN_EVENTS` 只是**构建期的 TS 常量**，脚本字符串里不存在该名字；运行时真正存在的是 `window.tavern_events`，而它原先要到 `implemented` 汇总处才赋值，`initializeGlobal`（原 L359/L360）与 `__nyaSyncMvu` 却在更早处引用了裸 `TAVERN_EVENTS`。**为何长期未被发现**：镜像那一步在派发之前，所以"MVU 就绪/父窗口可读/端到端全绿"都成立，只有事件链是断的（§9 的 V1–V8 原本也覆盖不到这一点）。**修法**：在脚本**早期**用构建期的 `${events}` 字面量建立运行时变量 `TAVERN_EVENT_NAMES` 并同时挂 `window.tavern_events`，三处引用改用它；顺带修正 `initializeGlobal` 的语义（原先无论 `name` 是什么都派发 `global_Mvu_initialized`，现按契约派发 `global_<name>_initialized`）。**验证**：修复后 `dispatchCalls` 观测到 `global_Mvu_initialized` 被派发 3 次、注入订阅者收到（`viaSubscriber=true`）；S-b/S-c/S-d 三项全绿；§9 V1–V8 回归 9/9 仍绿。 |
| 2026-09-16 | **§2.4 spike S-b/S-c/S-d 运行期复核完成**（`dev-server/tools/verify-script-host-spike.py`）：**S-b** ✅ 宿主 iframe 内 `$`/`_`/`z`/`YAML`/`TavernHelper` 五项就位且可调用（`TavernHelper.getVariables` 是函数）；**S-c** ✅ `window.Mvu` 已发布、`Mvu.events.VARIABLE_UPDATE_ENDED` 实测值 = `mag_variable_update_ended`、`window.parent.Mvu` 镜像成立、`global_Mvu_initialized` 已派发（**修复上述缺陷之后**）、`waitGlobalInitialized` 存在；**S-d** ✅ 每个脚本执行期 `getScriptId()` 只读到自己的 id，**且回调期**（注入探针在 `eventOn` 处理器里取值）同样是自己的 id ⇒ **模块局部常量方案成立，无需回退到"一脚本一 iframe"**。**S-a** 未单独复核：它（srcdoc + importmap + 自托管 ESM）已由 §9 V3–V5 的运行期链路间接覆盖（vendor 可达 + MVU 起得来 + 变量落盘），但 **"prod 构建下同样成立"这一半仍未直接验证**。 |
| 2026-09-16 | **待复核项汇总（结账后状态）**：① ✅ §9 的 `verify-js-slash-runner.py` **已创建并跑通 V1–V8**（本条下一行）；② ⬜ P1 的四作用域真机往返（§8 P1 验收 4/5）仍未在 dev 上复跑；③ ⬜ S-b/S-c/S-d（§2.4 的 spike 结论）仍未逐条复核；④ ✅ 变量宏的非空 YAML 实例证据与静态前缀字节一致**已补**（V6/V7）；⑤ ⬜ §9 的 V6"位于尾部 system 消息"目前只由离线 `pipeline` 模式断言（真实请求体被日志截断，无法可靠判定位置）。 |
| 2026-09-16 | **§9 验收清单落地并跑通（`verify-js-slash-runner.py`）**：V1–V8 全部通过（V2 记 SKIP+原因，见下表）。新增两个文件：`dev-server/tools/verify-js-slash-runner.py`（Python 主脚本，**手写最小 RFC6455/CDP 客户端** ⇒ 零新依赖）与 `dev-server/tools/verify-js-slash-runner-helpers.ts`（Node 侧助手，提供 V6/V7 需要的真实 `chatPipeline` 逐字节比较与 devlog 解析）。**连带补齐两项此前的缺口**：① **P2 的实例证据**——真实 devlog 里取到非空 YAML 块（`世界: 当前时间 "07:30" …`），"非空 `stat_data` → 合法 YAML"不再只有代码依据；② **V2b 的守门行为断言**（此前只有"设计上会剥离"的推断）。**三个实现陷阱已写入 §9 的执行说明**（V2b 必须触发真实写入、V7 的切点不能用 `includes("<session_rules>")`、V2 需新鲜 dist）。 |

> 实施期间发现的偏离、spike 结论、未接线事件、未验证项，**必须追加到本表**，不得静默。

---

## 12. 已知问题登记（本阶段**不**修）

| # | 问题 | 证据 | 建议 |
|---|---|---|---|
| K1 | **CSP 与全部安全头未下发**（dev + 生产） | `location = /index.html` 自带 `add_header` 顶掉服务器级头；`try_files … /index.html` 内部重定向命中该 location。实测响应无 CSP/X-Frame-Options/nosniff/Referrer-Policy | 独立立项修复（属既有 bug）；修完后**必须**同步迁移脚本载体（`ScriptHost` 换实现）与前端卡载体 |
| K2 | 站点可被任意站点 iframe 嵌套（`X-Frame-Options: DENY` 同样未下发） | 同 K1 | 随 K1 一并修 |
| K3 | `[phone_link]` 等其它 ST 扩展的宏（`{{phone_chat:…}}`）不被替换 | 样例卡世界书条目 | 透传；如需要另立阶段 |
| K4 | 同源 iframe 共享事件循环 ⇒ 死循环冻结应用 | 架构事实 | 与 K1 一起考虑（独立文档 + 沙箱化） |
| K5 | `ScriptLibraryModal` 自带了 `LocalModal` 底座（复制了 BaseModal 的 class/ESC/焦点/滚动锁），而 §2.1 现已允许 import UI 原语 | uilib 的 t4 交付说明；§2.1 白名单为 2026-09-16 事后登记 | 功能上可用；风险是**两套 ESC 处理**在内层弹窗叠加时的行为（LocalModal 的栈顶判定 vs 扩展面板的 ESC）。**必须在 P5 端到端（§9 V4–V8）里实测**：脚本库弹窗打开时按 ESC 只关最内层。若实测有问题，改为 import `BaseModal`（届时一个 PR 内替换即可）。 |
| K6 | **前端卡的状态栏刷新依赖"宿主广播变量变更"这一私有通道** | `src/lib/frontendCard/FrontendCard.tsx` 订阅 `subscribeVariables` 后调用卡片 iframe 的 `__nyaCardDispatch('mag_variable_update_ended')`；卡片侧由 `buildCardPredefineScript()` 提供同名事件总线 | 与 ST 的"渲染器把变量变更派进楼层 iframe"等价，但**接口名 `__nyaCardDispatch` 是本工程私有约定**。将来若换前端卡载体（K1 修复后）需一并迁移；已在该文件与本表双向登记。 |
| K7 | **非 MVU 卡的状态栏也走同一条前端卡通道，且同样被注入宿主 API** | G·RPG 卡（`tavern_helper.scripts` 为空）的状态栏是"正则把 `<CharData>` 替换成整页 HTML"；插件启用时该 iframe 同样拿到 `errorCatched`/事件总线/`Mvu` getter | 注入是**超集**：卡片用不到也无害，但**非 MVU 卡因此也受注入层缺陷影响**（2026-09-16 的"无法连接变量系统"就是这条）。已在 `verify-card-status.ts` 里保留"无脚本卡"的回归位。 |

| K8 | **事件派发曾长期静默失效**（已在 2026-09-16 修复，此处登记为"同类风险的体检点"） | `__nyaSyncMvu()` 引用构建期常量 `TAVERN_EVENTS` ⇒ 运行期 `ReferenceError` ⇒ `global_Mvu_initialized` 从未派发；§9 的 V1–V8 全部通过也**没能**发现它 | 教训：**"端到端全绿"不等于"事件链完整"**。凡是"派发一个事件让别人响应"的路径，都应有独立断言（本次新增 `verify-script-host-spike.py`）。同类体检点：`eventMakeFirst/Last`、`GENERATION_STOPPED`、`WORLDINFO_UPDATED`、`completion:settings-ready` 等 best-effort 事件接线（SSOT §2.7 已登记为"未接线需如实标注"） |

---

## 13. 团队编制与并行度（供开发指令阶段使用）

- 上限 8 个子代理；**不得出现无前置需求的悬空任务**，**不得让成员空转**。
- 建议编制（P1 完成后并行 3 路）：

| 任务 | 角色 | 依赖 |
|---|---|---|
| T1 数据模型 + 变量层内核 + 守门解除 | 实现 | — |
| T2 变量宏 + chatPipeline 分流 | 实现 | T1 |
| T3 脚本执行器 spike | 实现（先） | T1 |
| T4 脚本执行器 + 宿主 API（依赖 T3 结论） | 实现 | T1, T3 |
| T5 卡片脚本 IO | 实现 | T1 |
| T6 脚本库 UI + 前端卡注入 | 实现 | T4, T5 |
| T7 验证（独立于实现者，按 §8/§9 断言） | 验证 | T2, T4, T5 |
| T8 端到端 dev 服验证 + 交接文档 | 验证/文档 | T6, T7 |

- 每 P 收尾：commit（Conventional Commits 英文、`git add <file>`、无 `Co-Authored-By`）+ `.docs/阶段交接-*.md` + memory。

---

## 14. 待用户审核确认项（1 项）

> 其余 13 项决策已拍板；以下 1 项因**实测与已拍板结论冲突**而修正，请一并确认：

**D6-R（修正）**：变量宏的允许位置，由「只允许动态/关键词条目 + 永久条目仅警告」改为
「**永久条目命中变量宏时自动改由动态尾部渲染**」。
理由：样例卡的 `变量列表` 条目是 `constant=True`（且 ST 原始 `position=at_depth`/`depth=0`），按原决策会导致变量状态块以字面量发给 LLM、MVU 不可用；修正后既让 MVU 可用，又保住静态前缀的字节一致性（prompt 缓存不受影响），且比现状更贴合 ST 语义。详见审计报告 §11「修正项 D6-R」。
