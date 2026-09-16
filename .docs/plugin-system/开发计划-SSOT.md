# NyaaChat 插件系统 V1 — 开发计划（SSOT）

> 本文件是插件系统 V1 开发阶段的**唯一事实来源**。
> 上游依据：`.docs/plugin-system/扩展系统重构计划.md` + `.docs/plugin-system/审计报告.md`（六项关键决策 D1–D6 已由用户逐一拍板）。
> 基准版本：`master @ 7bbb43b`。
> **状态：待用户复核。复核通过前不得进入编码。**

---

## 1. 目标与范围边界

### 1.1 目标

在 NyaaChat 内建立**自有插件系统**：开发者侧可编写 NyaaChat 原生插件，插件可获得（a）持久配置、（b）设置面板 UI、（c）消息文本装饰、（d）事件订阅、（e）受控后端调用、（f）图标与元信息；并完成首个原生插件 `quote-tts`（移植自 ST 扩展 `st-Quote-TTS`）。

### 1.2 范围内（In Scope）

- 插件目录 `plugins/`、静态注册表、框架运行时 `src/plugins/`。
- `扩展` 入口 modal 重构（PC 左列表右详情 / 手机两级）。
- 插件配置并入 `AppState` 与设置导入/导出/云端上传下载。
- `ext-host` 受控 TTS 代理 + nginx 精确匹配 location。
- `quote-tts` 原生插件（消息装饰 + 设置面板 + 试听 + 播放）。
- 文档：审计报告（已完成）、本 SSOT、框架规范、ST 扩展移植规范、阶段交接、memory。

### 1.3 范围外（Out of Scope）

- 任何 ST 兼容通道：`manifest.json` 解析、`extension_settings` 读写、`script.js` / `scripts/extensions/**` / `.mes_text` DOM 逃逸区。
- 用户侧插件治理：安装、卸载、上传 ZIP、URL 装载、插件市场、插件权限声明、插件沙箱。
- 插件间依赖、插件独立后端服务、插件独立数据库表。
- 修改 `dev-server` 已知遗留登记（上一阶段遗留项）之外的基建。

---

## 2. 已确认架构

### 2.1 目录与构建模型（决策 D1）

```
plugins/                         # 新增：插件实现（开发者侧；无用户治理）
  registry.ts                    #   唯一注册入口：import 各插件并以数组导出
  quote-tts/                     #   首个插件
    plugin.tsx                   #     definePlugin：meta / defaults / decorators / SettingsPanel
    voices.ts                    #     14 个 Edge-TTS 音色 + 预览文案 + 默认常量
    QuoteTtsButton.tsx           #     消息装饰渲染组件（🔊）
    QuoteTtsSettings.tsx         #     设置面板（角色 → 音色 + 试听）
    README.md                    #     该插件的移植说明
src/plugins/                     # 新增：框架运行时（宿主侧）
  types.ts                       #   契约类型（见 §2.2）
  registry.ts                    #   汇总 plugins/registry.ts + 开发期校验（id 唯一 / meta 必填 / capability 唯一）
  runtime.ts                     #   启用状态、配置快照读写、事件总线、setup 生命周期
  hostContext.ts                 #   ⚠️ **叶子模块**（t12 从 runtime 拆出，只 `import type ../types`）：宿主上下文状态 + getHostContext/setHostContext/subscribeHostContext。
                                 #     **插件侧只能引它，不得引 runtime / backend / index** —— 那三者下游含插件注册表，插件引任一都会构成模块环，
                                 #     导致以插件模块为图入口时注册表拿到 undefined 槽位、插件**静默消失**（列表无 / backend 拒 / 装饰跳过）。
                                 #     将来插件需要新的宿主数据，**照此模式再加一个只依赖 ../types 的叶子**，不要往 runtime 里塞。
                                 #     （本行由 `docs` 在 t13 发现缺失后补入，见 §12 L18/D-20。）
  normalize.ts                   #   plugins 字段归一化（加载、导入、云端下载共用）
  decorators.ts                  #   消息装饰入口（**逐块方案，不进 rehype**；导出 renderPluginDecorations / DecorationRenderInput）
  backend.ts                     #   callBackend 客户端（能力名 → 声明路径）
  index.ts                       #   对外出口
src/components/ExtensionsModal.tsx  # 新增：扩展重构 UI
```

**构建模型**：Vite 从 `index.html → src/main.tsx` 全量打包，`plugins/**` 通过 `plugins/registry.ts` 进入依赖图 ⇒ 无运行时加载器、无动态 `import()`、无白名单机制。

**必须同步修改的工程配置（易漏项）**：

| 文件 | 现状 | 改动 |
|---|---|---|
| `tsconfig.json`（29 行） | **无 `include`**，默认纳入全仓（仅 exclude `dist/**`） | 无需改动；`plugins/**` 自动进入 `tsc --noEmit` |
| `eslint.config.js`（81 行） | react-hooks + browser globals 规则仅覆盖 `files: ["src/**/*.{ts,tsx}"]`（L32） | **P1 必须**把 `plugins/**/*.{ts,tsx}` 加入该 files 列表，否则插件内的 hooks 违规不被 lint 拦截 |
| `vite.config.ts`（85 行） | `@` 别名 → 仓库根 | 无需改动；插件内部用相对路径，`src/` 侧用 `@/plugins/...` 或相对路径 |

### 2.2 插件契约（决策 D5/D1）

```ts
// src/plugins/types.ts —— 全部为 type-only 出口，运行时只有下面这些小函数

/** 插件静态元信息（注册表可见，无需实例化插件即可用于列表渲染）。 */
export interface PluginMeta {
  /** 稳定 id，kebab-case，全仓唯一；同时是配置持久化键。 */
  id: string;
  name: string;
  description?: string;
  version: string;
  author?: string;
  /** lucide-react 图标名；缺省时 UI 回退到「扩展」入口图标。 */
  icon?: string;
  /** 列表排序，升序；相同则按 name 字典序。 */
  order?: number;
}

/** 单用户维度的插件持久化状态（AppState.plugins 的值类型）。
 *  ⚠️ 实际声明位置在 `src/types.ts`（因为 `AppState` 需要它，而 `src/types.ts`
 *  不依赖任何插件模块，可避免循环依赖）；`src/plugins/types.ts` 从那里 re-export，
 *  插件作者只需从 `src/plugins/types` 导入。 */
export interface PluginState {
  enabled: boolean;
  config: Record<string, unknown>;
}
export type PluginStateMap = Record<string, PluginState>;

/** 消息文本装饰。⚠️ 区间是**当前块纯文本**内的字符偏移（逐块方案，见 §2.6；
 *  不是"整条消息的渲染后纯文本"—— 那是初稿 rehype 方案的偏移空间，两者不通用）。 */
export interface TextDecoration {
  start: number;
  end: number;
  /** 同一消息内唯一，作为 React key。 */
  key: string;
  render: (props: { text: string }) => React.ReactNode;
}

export interface MessageDecorationContext {
  pluginId: string;
  /** 当前插件配置的只读快照。 */
  config: Record<string, unknown>;
  messageId: string;
  role: Message["role"];
  /** user → 当前用户角色名；assistant → 当前角色名。 */
  senderName: string;
  callBackend: PluginBackendCaller;
}

export type MessageTextDecorator = (
  text: string,   // 当前**块**的纯文本；返回区间必须落在本字符串内
  ctx: MessageDecorationContext,
) => TextDecoration[];

export type PluginBackendCaller = <T = unknown>(
  capability: string,
  payload?: unknown,
) => Promise<T>;

export type PluginEventName = "message:received" | "session:changed" | "character:changed";

export interface PluginContext {
  meta: PluginMeta;
  getConfig: () => Record<string, unknown>;
  /** 写入必须经宿主注入的 writer（§2.4），不得只改内存快照。 */
  updateConfig: (patch: Record<string, unknown>) => void;
  callBackend: PluginBackendCaller;
  /** 返回取消订阅函数。 */
  on: (event: PluginEventName, handler: (payload?: unknown) => void) => () => void;
}

export interface PluginSettingsPanelProps {
  pluginId: string;
  config: Record<string, unknown>;
  updateConfig: (patch: Record<string, unknown>) => void;
  callBackend: PluginBackendCaller;
}

/** 边车能力声明：能力名 → 实际路径。前端不得调用未声明的能力。 */
export interface PluginBackendDeclaration {
  capability: string;
  /** 形如 /api/ext-host/plugins/quote-tts/speech */
  path: string;
  method: "POST" | "GET";
  description?: string;
}

export interface NyaaPlugin {
  meta: PluginMeta;
  /** 缺省配置；归一化时深合并到用户配置之下。 */
  defaults?: Record<string, unknown>;
  /** 启用时调用一次；返回的函数在停用/热更新时调用。 */
  setup?: (ctx: PluginContext) => void | (() => void);
  SettingsPanel?: React.ComponentType<PluginSettingsPanelProps>;
  decorators?: { messageText?: MessageTextDecorator[] };
  backend?: PluginBackendDeclaration[];
}
```

### 2.3 注册表与校验

```ts
// plugins/registry.ts（手写，唯一注册入口）
import quoteTts from "./quote-tts/plugin";
export const plugins: NyaaPlugin[] = [quoteTts].sort(/* meta.order, meta.name */);
```

`src/plugins/registry.ts` 在**模块加载时**执行一次校验并在失败时 `console.error`（生产不抛售，避免整站白屏）：
- `meta.id` 唯一且匹配 `^[a-z0-9][a-z0-9-]*$`；
- `meta.name` / `meta.version` 非空；`description` 建议非空（缺失时 UI 显示占位）；
- 全仓 `backend[].capability` 唯一（防止一个能力名指向两条路径）；
- `backend[].path` 必须以 `/api/ext-host/plugins/<meta.id>/` 开头（防止插件声明任意路径）。

### 2.4 运行时与接线（决策 D3/D5）

```ts
// src/plugins/runtime.ts
export function setPluginConfigWriter(fn: (pluginId: string, patch: Record<string, unknown>) => void): void;
export function syncPluginRuntime(next: PluginStateMap): void;          // App effect 调用，应用启用/停用与 setup 生命周期
export function getPluginConfig(pluginId: string): Record<string, unknown>;
export function updatePluginConfig(pluginId: string, patch: Record<string, unknown>): void;
export function emitPluginEvent(name: PluginEventName, payload?: unknown): void;
export function callPluginBackend<T>(pluginId: string, capability: string, payload?: unknown): Promise<T>;
// 供 React 使用（useSyncExternalStore）
export function subscribePluginRuntime(listener: () => void): () => void;
export function getPluginRuntimeSnapshot(): PluginStateMap;
// 宿主上下文（2026-09-15 增补，见下方说明）
export function setPluginHostContext(next: PluginHostContext): void;
export function getPluginHostContext(): PluginHostContext;
```

**宿主上下文增补说明（captain 2026-09-15 追加）**：插件设置面板需要"当前用户角色名 / 当前角色名 / 当前会话消息"这类宿主态（例如 quote-tts 的「角色 → 音色」列表要枚举参与者），但已冻结的 `PluginSettingsPanelProps`（§2.2）**不含**会话数据。为**不改动 `src/types.ts` 与 `src/plugins/types.ts` 的任何契约签名**（§10.1 规定契约签名变更须先经用户确认），改由运行时提供一个只读快照出口：

```ts
export interface PluginHostIdentity { user: string; char: string; }
export interface PluginHostContext { identity: PluginHostIdentity; sessionMessages: Message[]; }
```

- 由 `App.tsx` 的 effect 推送（`setPluginHostContext`），取值口径与消息渲染时一致；
  **⚠️ 口径明示（2026-09-15 澄清，t8 修正了 runtime 里与此矛盾的旧注释）**：`identity.user` / `identity.char` 走的是**展示口径**（缺失时分别是 `"user"` / `"AI助手"`），**不是** `getMacroIdentity()` 的原始 props 口径（缺失时为空串）。两者**刻意不同**，且**必须**与消息装饰的 `senderName`（`MessageItem` 的 `resolvedUser`/`resolvedChar`）保持一致 —— 因为 quote-tts 的音色映射是**按人名建表**，设置面板列出的人名与装饰计算出的说话人必须是同一套字符串，否则用户配好的音色查不到。
- 插件侧 `import { getPluginHostContext } from "../plugins/runtime"` 读取；
- React 订阅：`useSyncExternalStore(subscribePluginRuntime, getPluginHostContext)` —— 复用同一条通知通道，`getPluginHostContext` 只在内容变化时替换引用，内容未变不引发重渲染。
- 性质：**纯增量的宿主侧出口**，不是 `types.ts` 的契约签名变更，故不触发 §10.1 的用户确认流程；但它确实扩大了插件可见面，已记入本节与 §8 文档交付清单。

- **模块级快照范式**：与既有 `setChatAccessor` / `setDefaultEnvProvider` 一致（`src/lib/regex/macros.ts` + `MessageItem.tsx` L46-49）。装饰器渲染期同步读快照。
- **配置写入单一路径**：`App.tsx` 注册 writer，内部走既有 `handleSaveSettings()`，因此配置变更必然落盘（`nyaachat_settings`）；`updateConfig` 内部把 patch 深合并进当前 config 后交给 writer。
- **生命周期**：`syncPluginRuntime` 对比上一次的 enabled 差值：新启用 → 调 `setup(ctx)` 并存 disposer；新停用 → 调 disposer。异常被捕获并 `console.error`，不影响其它插件。
- **App 接线**（`src/App.tsx`）：

```tsx
const settingsRef = useRef(settings);
settingsRef.current = settings;

useEffect(() => {
  setPluginConfigWriter((pluginId, patch) => {
    const cur = settingsRef.current;
    handleSaveSettings({
      ...cur,
      plugins: { ...cur.plugins, [pluginId]: { enabled: !!cur.plugins[pluginId]?.enabled, config: { ...(cur.plugins[pluginId]?.config ?? {}), ...patch } } },
    });
  });
}, []);

useEffect(() => { syncPluginRuntime(settings.plugins); }, [settings.plugins]);
```

- **事件发射点**：`message:received`（助手消息落地处，会话写入路径）、`session:changed`（`currentSession` 变化 effect）、`character:changed`（`currentCharacterId` 变化）。
- **`useSyncExternalStore`**：`ExtensionsModal` 与 `MessageItem` 订阅运行时快照 ⇒ 配置变更后消息装饰自动重渲染，无需手动传参。

### 2.5 扩展 UI（决策 D2）

`src/components/ExtensionsModal.tsx`：

- 外壳 `BaseModal`，`closeOnBackdrop={false}`；PC/手机分栏**直接复用** `src/index.css` L223-233 的类：`pv-layout` / `pv-pane-list` / `pv-pane-detail` / `pv-pane-hidden` / `pv-only-mobile`（40rem 断点，`!important`，不依赖样式加载顺序）。
- 状态：`selectedId`（默认第一个插件）+ `mobileView: "list" | "detail"`。
- 列表行：图标 + 名称 + `v<version>` + 启用开关（受控）+ 停用时的灰化。
  **⚠️ 图标取值是有限集（2026-09-15 裁定，起因见 §11.7）**：`meta.icon` 只能是 `ExtensionsModal` 内**显式具名导入的允许集**里的名字，未收录的名字**静默回退 `Puzzle`**（不报错、不影响插件可用）。禁止为了"支持任意图标名"而使用 `import * as ... from "lucide-react"` 或对命名空间对象做动态属性访问 —— 那会让 Rollup 无法 tree-shake，实测把整套 lucide 图标打进主 bundle。
  **修复结果（t9，实测）**：允许集为 `PLUGIN_ICONS`（12 项），配套具名导出 `resolvePluginIcon(name)` 与 `PLUGIN_ICON_NAMES`（**刻意导出以让回退分支可被单测覆盖**；`ExtensionsModal.tsx` 是组件模块，插件作者不 import 它，故不构成扩大插件可见面）。主 chunk：rollup 报 **2,240.29 kB → 1,410.93 kB**（gzip 586.44 → 433.47 kB），磁盘实物 `dist/assets/index-*.js` = **1377.86 kB**。
- 详情面板：元信息（名称/版本/作者/说明）+ 启用开关 + `<SettingsPanel>`；无 `SettingsPanel` 时显示「该插件没有可配置项」。
- **无**新增按钮、**无**删除按钮、**无**导入/安装入口。
- `src/components/ChatHeader.tsx`：`扩展` 按钮去掉 `aria-disabled="true"` / `title="扩展（暂未开放）"`，改为 `onClick` 打开 modal，`title="扩展"`。`EXTENSIONS_UI_ENABLED` 常量收敛（不再需要硬开关）或保留为 `true` 并在注释中说明其历史。
  **✅ 用户 2026-09-15 复核确认：`扩展` 按钮正式接线**（取代上一阶段"暂不挂功能"的过渡约束）。

### 2.6 消息装饰管线（决策 D5；实现路径经用户 2026-09-15 复核由 A 改为 **B**）

**关键前提（本文件初稿的遗漏，2026-09-15 更正）**：`src/components/MessageItem.tsx` **已经存在**一套逐块引号渲染扩展点 —— `QUOTE_RE`(L126，已覆盖 `"" '' “” ‘’ 「」 『』 【】 《》`) / `highlightQuotes()`(L128) / `renderTextWithQuotes()`(L142)，挂在 `components.p` 与 `components.li`（L694/695、L717/718）。它目前硬编码在组件内、**不接受外部注册**。初稿称"无任何插件扩展位"是错的：**扩展位存在，缺的是面向插件的注册契约**。

**两条实现路径与选择**：

| 维度 | A rehype 全局管线（初稿方案） | B 复用逐块路径（**采纳**） |
|---|---|---|
| 实现 | 自研 rehype 插件，两趟遍历收文本节点与偏移，回填切分文本节点，`components` 映射回 render | 在既有 `renderTextWithQuotes` 路径上调用宿主装饰入口，逐块切分字符串 children |
| R1（rehype 顺序写反 ⇒ 装饰在含原始 HTML 的消息上整段消失且不报错） | **存在**，是本案最高风险 | **结构性消失**（不碰 rehype 管线） |
| R2（区间空间定义错 ⇒ 偏移落错位置） | **存在**（区间是"渲染后纯文本"的消息级偏移） | **结构性消失**（`text` 就是当前块的那段字符串） |
| sanitize 交互 | 必须排在 `rehypeSanitize` 之后，顺序敏感 | 不参与：装饰是 React 元素，不是 HTML 字符串 |
| 覆盖面 | 全（标题/引用块/表格无差别） | 已接线块组件全覆盖；**嵌套内联元素内的文本不覆盖**（见下） |

采纳 B 的理由：把两个最高风险**从"要靠纪律守住"变成"结构上不可能发生"**，且复用已在线上运行的代码路径。

**契约措辞变更（只此一处，`MessageTextDecorator` 的 `text` 参数语义）**：

- 原（初稿）：`text` = 整条消息的渲染后纯文本，`start`/`end` 是**消息级**偏移。
- 现（**生效**）：宿主**逐块**调用，`text` = **当前块的文本**，`start`/`end` 是**块内**字符偏移。
- 不变：`TextDecoration.key` 唯一性口径仍为「同一消息内唯一」；宿主注册表键仍为 `` `${messageId}::${key}` ``；`MessageDecorationContext` 的字段不变。

**宿主侧实现（`src/plugins/decorators.ts`，captain 自办，不入任务池）**：

- `renderPluginDecorations(text, ctx): React.ReactNode` —— 唯一入口。按序调用每个**已启用**插件的 `decorators.messageText`，收集装饰 → 校验（`0 ≤ start < end ≤ text.length`、**必须为整数（`Number.isInteger`，小数偏移会被丢弃并 `console.warn`—— 实现比初稿描述更严，见本文件 §11.4）**）→ 按 `start` 升序 → 重叠时保留先到者并 `console.warn` → 切分文本。
  **⚠️ 契约语义（2026-09-15 修复后明确，务必遵守）：装饰 = 在片段旁边加东西，不是替换片段。** 被标注的原文**始终由宿主原样输出**，`render` 的返回值**追加在它之后**。因此 `render: ({ text }) => <QuoteTtsButton text={text} …/>` 渲染成 `原文` + `🔊`。
  这与 ST 原版一致（`.ref/st-Quote-TTS/index.js` L107 是 `` `${match}<span class="quote-tts-btn">🔊</span>` ``，即**追加**）。
  **⚠️ 插件作者注意**：`render` 里**不要**再输出 `text`，否则页面上会出现两份原文；`render` 抛错时宿主只保留正文并 `console.warn`（不得用 `slice` 顶替，否则与始终输出的正文重复）。
  **本模块初版的缺陷（`verify` 在 t7 复现并已修复）**：初版只 push `render` 的返回值、丢掉了原文，导致引号文字从消息里整个消失 —— `猫娘: 「第一条引用」` 渲染成 `猫娘: 🔊`。根因是 §2.6 初稿措辞模糊（只说"切分文本并插入插件返回的 React 节点"），实现按"替换"理解；**契约措辞必须明确到"追加"，否则实现会二选一**。
  **⚠️⚠️ 实现必须用「两级节点」，不得把 `slice` 与 `rendered` 同置一个 Fragment**（`verify` 在 t7 指出 captain 的口头描述与代码不符，此处定稿）：
  ```ts
  nodes.push(slice);                                                   // ① 正文：顶层 string 节点
  nodes.push(React.createElement(React.Fragment, { key }, rendered));  // ② 装饰：独立 Fragment，只放 render 的返回值
  ```
  **理由（正确性要求，不是风格偏好）**：宿主 `MessageItem.decorateAndHighlight` **只对 string 型 children 做引号高亮**（数组分支里 `typeof node === "string"` 才走 `highlightQuotes`）。一旦把 `slice` 放进 Fragment，被装饰的引号就会**丢掉 `.quote-highlight`** —— 这正是 `verify` 报的 **R2**（文本与按钮都在，但高亮消失）。两级结构同时满足"正文不丢"与"高亮仍在"（实测 `highlights = 2`）。**后来者若照"同置 Fragment"改，会立刻把 R2 打回去。**
  **⚠️ 插件作者侧配套约束**：`render` **只输出装饰节点本身，不要在里面再渲染 `text`** —— 原文已由宿主以顶层文本节点输出，重复渲染会出现**两份原文**。（当前 `QuoteTtsButton` 主体只渲染图标 `icon`，`text` 仅用于 `callBackend` 的 `input`，已是正确形态。）
- 零开销路径：文本为空 / 无启用插件声明 `decorators.messageText` / 全部无命中 ⇒ 原样返回入参。
- 取不到 `render` 或 `render` 抛错 ⇒ 该装饰降级为纯文本并 `console.warn`，不拖垮整条消息。

**覆盖范围与已知边界（必须记录，不得声称全覆盖）**：

- 已接线块组件：`p`、`li`（沿用既有接线点），并扩展 `blockquote`、`h1`~`h6`、`td`。
- **未覆盖**：嵌套内联元素内部的文本（如 `<strong>“引用”</strong>` 里的引号）—— `renderTextWithQuotes` 只转换 **string 类型**的 children，React 元素原样透传（L145 `: c`）。⚠️ **这一限制是既有 `quote-highlight` 就已存在的行为，不是本阶段引入的缺陷**，但必须写入《插件框架规范》与《ST 扩展移植规范》。

**不用 `dangerouslySetInnerHTML`**：装饰由插件返回 React 节点、宿主直接渲染，不存在 HTML 字符串注入面（§7.6）。

**`quote-tts` 的区间来源**：移植 ST 的正则到**块文本**空间，实现于 `plugins/quote-tts/quoteScan.ts`：

```
/(?:^|\n)\s*([^:\n]{1,30}?):\s*([“‘「『][\s\S]*?[”’」』])/g      // 带「人名:」前缀
/([“‘「『][\s\S]*?[”’」』])/g                                     // 无前缀，落回 senderName
```

合并两次扫描、去掉重叠与包含、跳过纯空白内容 ⇒ 每个引号片段产出一个装饰，`render` 返回 `<QuoteTtsButton text charName />`。

### 2.7 后端通道与安全模型（决策 D4）

`ext-host/src/server.js`（204 行）新增：

```
POST /plugins/quote-tts/speech
  body: { input: string (≤ 1000 字符), voice: string (14 音色白名单), response_format?: "mp3" }
  上游: process.env.PLUGIN_QUOTE_TTS_UPSTREAM_URL（默认 https://…/v1/audio/speech，由部署方 .env 决定）
  模型: process.env.PLUGIN_QUOTE_TTS_MODEL（默认 tts-1-hd）
  鉴权: process.env.PLUGIN_QUOTE_TTS_API_KEY（默认 "none"；必须发送非空 Authorization，上游 schema 要求）
  返回: 音频字节流（透传 content-type）
```

**硬性约束（代码评审检查项）**：
- 上游 URL / 模型 / 鉴权**只能**来自 `process.env`，请求体出现 `provider_endpoint` / `baseUrl` / `model` / `api_key` 等字段一律**忽略**（这正是被删除的 `/openai/custom/generate-voice` 的漏洞形态，不得重建）。
- `input` 长度上限；`voice` 白名单校验，非法值 400。
- 上游不可达 / 非 2xx ⇒ 502 + 结构化错误，不把上游原始响应体直接回给浏览器。
- `GET /status` 增加 `plugins.quoteTts.configured`（仿既有 `t2iAgent.configured`）。

`nginx.conf` 新增一条**精确匹配**（与 L187-203 同风格）：

```
location = /api/ext-host/plugins/quote-tts/speech {
    proxy_pass http://ext-host:3099/plugins/quote-tts/speech;
}
```

`dev-server/nginx/default.conf.template` 同步镜像该 location。

### 2.8 设置转移接线（决策 D3）

#### 2.8.1 先分清两条**独立**的版本轴（用户 2026-09-15 复核后的明确要求）

项目里有**两个互不相关的版本号**，它们的兼容语义完全相反，必须分开讨论：

| 轴 | 常量 | 位置 | 语义 | 本阶段 |
|---|---|---|---|---|
| **本地存档轴** | `SCHEMA_VERSION` | `src/App.tsx` L109 | 只描述 localStorage 里 `nyaachat_settings` 的形状；**不参与任何导入/导出校验**。旧形状由 `migrate()` 链就地升级。 | **11 → 12**，新增 `migrateV11ToV12()` 回填 `plugins: {}` |
| **导出存档轴** | `EXPORT_VERSION` | `src/lib/settingsBackup.ts` L36 | 写进归档的 `_version`；导入时由 `SUPPORTED_IMPORT_VERSIONS` **严格校验**，不在集合内 ⇒ **直接拒绝导入**。 | **保持 9**，`SUPPORTED_IMPORT_VERSIONS` 不变 |

> 用户提到的"`SCHEMA_VERSION 11 → 12（新增 migrateV11ToV12 回填 plugins: {}）`方案"属于**第一轴**，本阶段采纳并已写入 §2.8.2。
> 第二轴的处理见下一条。

#### 2.8.2 为什么导出存档轴**保持 9** 反而比升到 10 更符合"新旧都兼容"

用户的目标是"**优先确保新版本导出的新存档生效**"，并**接受**老版本拒绝导入新存档。三条硬指标下两种做法的对比如下：

| 指标 | 保持 `EXPORT_VERSION = 9` + 增量字段（**采纳**） | 升到 `10` 并把 10 加入支持集 |
|---|---|---|
| 新版本导出新存档 ⇒ 新版本导入生效（含 `plugins`） | ✅ | ✅ |
| 老版本导入新存档 | ✅ **能读**，`plugins` 被 `...settings` 原样保留但老代码不读它、也不拒绝 | ❌ **直接拒绝**（`10 ∉ {2..9}` ⇒ `不支持的导出版本 10`） |
| 新版本导入老存档（无 `plugins`） | ✅ 回填 `{}` | ✅ 回填 `{}` |
| 需要改动的代码 | 仅导入/加载侧归一化 | 归一化 + 版本常量 + 支持集 |
| 老存档被"拒收"的风险 | 无 | 有（任何一次误升都让存量归档失效） |

**结论**：保持 9 是**三向兼容**（新→新、新→老、老→新全部可用），严格优于升版；且 `settingsBackup.ts` L32-36 的既有注释已经写死了这条策略（"上调版本号只会**单方面**让老版本拒绝新存档"）。
因此本阶段**不改** `EXPORT_VERSION`、`EXPORT_KIND`、`SUPPORTED_IMPORT_VERSIONS`。若复核时用户仍要求升到 10，改动量为：`EXPORT_VERSION = 10` + `SUPPORTED_IMPORT_VERSIONS` 增 `10`（一行），但会失去"老版本可读新存档"这一条。

#### 2.8.3 接线表

| 位置 | 改动 |
|---|---|
| `src/types.ts` | `AppState` 增 `plugins: PluginStateMap`。**`PluginState` / `PluginStateMap` 的声明放在这里**（`src/types.ts` 不 import 任何插件模块，避免循环依赖）；`src/plugins/types.ts` 从 `src/types.ts` re-export 供插件作者使用 |
| `src/App.tsx` `DEFAULT_SETTINGS` | `plugins: {}` |
| `src/App.tsx` `SCHEMA_VERSION` | `11 → 12`；`migrate()` 增 `if (v < 12) raw = migrateV11ToV12(raw);` |
| `src/App.tsx` 新迁移 | `migrateV11ToV12(raw)`：`{ ...raw, plugins: normalizePluginStates(raw.plugins), _version: 12 }`（归一化在读取时收敛，旧存档缺字段 ⇒ `{}`） |
| `src/App.tsx` 加载路径（L649 起逐字段构造） | 增 `plugins: normalizePluginStates(parsed.plugins)` |
| `src/lib/settingsBackup.ts` | **不改** `EXPORT_KIND` / `EXPORT_VERSION`(9) / `SUPPORTED_IMPORT_VERSIONS`；`buildExportPayload()` 增一步 `plugins: normalizePluginStates(settings.plugins)`（**导出侧也过滤**，见 §2.8.4）；导入应用路径改用 `normalizePluginStates()` 收敛 |
| `src/lib/settingsBackup.ts` `parseImportText` | 不新增拒绝条件（`plugins` 是增量字段；未知插件 id 由 `normalizePluginStates` 丢弃） |
| 云端路径 | 服务端无需改动（`shared-server/src/routes/account.js` L485-521 原样存 `ExportPayload`）；前端上行/下行均经 `buildExportPayload()` / `normalizePluginStates()` |

```ts
// src/plugins/normalize.ts
export function normalizePluginStates(raw: unknown): PluginStateMap;
// 规则：
//   · raw 非对象 ⇒ {}
//   · **只保留 plugins/registry.ts 中已知的 id**（未知 id 丢弃）
//   · enabled 非 boolean ⇒ false（缺失 ⇒ false，即默认全部停用）
//   · config 非对象 ⇒ {}；随后以插件 defaults 做深合并（用户值优先）
```

> ⚠️ **三条入口的「是否写回存档」不同，§2.8.3 的表格原先把它们混为一谈（`verify` 在 t7 的 R5 指出，已更正）**：
> | 入口 | 归一化作用域 | 是否把收敛结果写回存储 |
> |---|---|---|
> | **localStorage 加载路径**（`migrateV11ToV12` + App 加载） | **仅内存** | **否** —— 手改过 IDB/存档的未知插件 id 会**留在存档里**，要等下一次因其它原因落盘才可能被带上（而带上时已被 `buildExportPayload` 过滤，见下） |
> | **本地导入**（`parseImportText` → `validateImportPayload`） | 内存 + 应用 | 是（应用后按既有流程落盘） |
> | **云端下载**（同上，共用同一函数） | 内存 + 应用 | 是 |
>
> **这是有意的取舍，不是缺陷**：用户对插件集合的三条要求 ——「列表不以本地存档为准」「已删插件不再可见」「新版本导出的存档里不再有该插件的配置」—— 分别由 **列表只读注册表**、**内存归一化**、**`buildExportPayload` 的出口过滤** 保证，三者都不依赖"存档本身被就地清干净"。
> **可选加固（本阶段不做）**：在加载后追加一次"若归一化结果与原值不同则写回"，代价是每次加载多一次落盘副作用。

#### 2.8.4 插件集合的**唯一权威是代码**（用户 2026-09-15 复核后的明确要求）

> 用户原话要点：插件列表**不以用户本地设置存档为准，而以线上状态为准**；开发者在任何新版本里删掉一个插件，用户此后就**不应该再看见它**，且新版本导出的存档里**不应该再残留该插件的配置数据**。

落地为三条硬规则：

1. **列表来源**：`ExtensionsModal` 的列表**只**由 `plugins/registry.ts`（`getRegisteredPlugins()`）生成，**从不**遍历 `AppState.plugins` 的键。因此代码里删掉一个插件 ⇒ 用户界面立刻看不到它，无需任何用户侧操作，也无需迁移代码。
2. **入口归一化（三处共用同一函数）**：localStorage 加载（`migrateV11ToV12` + 加载路径）、本地导入、云端下载 —— 全部经 `normalizePluginStates()`，未知 id 一律丢弃，因此已下线插件的配置**进不了**活跃状态。
3. **出口防御**：`buildExportPayload()` 里对 `plugins` 再过一次 `normalizePluginStates()`。理由与既有 `RETIRED_TOP_LEVEL_KEYS` 的注释完全一致（"Protection, not repair：手改过的 localStorage 仍可能夹带死数据，而 `...settings` 会把它复制进归档"）⇒ 只有同时守住入口与出口，才能保证**用户在新版本导出的存档里不可能再出现已不存在插件的配置**。

> 副作用（已知且接受）：用户导出→换到含该插件的旧版本→再导入，配置已丢失。这正是"以代码为权威"的必然结果，写入 §5 移植规范与交接文档的"已知行为变化"。

---

## 3. 环境变量约定

| 变量 | 默认 | 位置 | 说明 |
|---|---|---|---|
| `PLUGIN_QUOTE_TTS_UPSTREAM_URL` | 部署方 `.env` 指定 | `ext-host` 容器 | Edge-TTS 兼容**端点基地址**；**非密钥**。⚠️ **必须是基地址**（如 `http://host:5050`）：`ext-host` 的 `server.js` L119 会自行追加 `/v1/audio/speech`，填成完整端点会让路径重复成 `…/v1/audio/speech/v1/audio/speech` ⇒ 上游 **404**（2026-09-15 实操踩到，排查了一轮）。`.env.example` L64 原本就写明了"基地址…会自行追加"，是本条表述不够精确 |
| `PLUGIN_QUOTE_TTS_MODEL` | `tts-1-hd` | `ext-host` 容器 | 上游模型 id |
| `PLUGIN_QUOTE_TTS_API_KEY` | `none` | `ext-host` 容器 | 上游鉴权；默认值必须仍发送非空 Authorization |
| `PLUGIN_QUOTE_TTS_TIMEOUT_MS` | `60000` | `ext-host` 容器 | 上游超时 |

- 所有变量进 `NyaaChat/.env.example` 与 `dev-server/.env.example`，**真实值不入库**。
- 插件端口：浏览器只调 `/api/ext-host/plugins/<id>/<capability>`，同源、经 nginx。

---

## 4. 阶段划分（V1 = P1..P6）

每个 P 必须**可独立验证、可独立提交**；P 收尾走 `commit-push` skill + 交接文档 + memory。

### ⬜ P1 — 插件树、框架契约与运行时

- **产物**：`plugins/registry.ts`、`src/plugins/{types,registry,runtime,normalize,decorators,backend,index}.ts`、`eslint.config.js` 改动；`AppState.plugins` 字段 + `SCHEMA_VERSION` 12 + `migrateV11ToV12`（只做字段与迁移，不动 UI）。
- **执行约定**：`src/plugins/decorators.ts`（消息装饰逐块入口）**由主 agent 亲自实现，不派发给任何子代理**（用户 2026-09-15 明确要求，见 §10.2）。
- **验收**：`npm run lint` 通过；空注册表下应用行为与 HEAD 完全一致；`AppState.plugins` 在 localStorage 中可观测且刷新后保持；插件列表只由 `plugins/registry.ts` 产生（在 `AppState.plugins` 里手塞一个未知 id，列表不得出现该行）；装饰插件在含原始 HTML 的消息上不丢内容（用临时测试插件验证，验证后移除）。
- **依赖**：无。

### ⬜ P2 — 扩展 UI 重构

- **产物**：`src/components/ExtensionsModal.tsx`、`ChatHeader.tsx` 接线、`src/index.css`（如需为插件列表行补类，复用 `.pv-*`）。
- **验收**：PC 宽屏左列表右详情；浏览器缩到 <40rem 变为两级且 `返回列表` 可回；启用开关可切换并落盘；图标缺省回退；无新增/删除按钮；空注册表下显示明确的空态文案。
- **依赖**：P1。

### ⬜ P3 — 插件配置并入设置体系

- **产物**：`src/lib/settingsBackup.ts`（`buildExportPayload` 出口过滤 + 导入应用路径收敛到 `normalizePluginStates`）、`SettingsModal.tsx`（如云端下行路径需要显式归一化）。
- **验收**（**双路径 + 出口防御**，见 §6）：
  1. 本地导出→本地导入 往返后插件配置一致；
  2. 云端上传→云端下载 往返后一致；
  3. 不含 `plugins` 的老存档（v9 样例）导入成功且 `plugins` 回填为 `{}`；
  4. 含未知插件 id 的存档导入成功且未知 id 被丢弃（**入口归一化**）；
  5. 往 localStorage 手塞一个未知插件 id（模拟"旧版本写过、新版本已下线"的插件），**导出**的归档里该 id 与其配置**必须不存在**（**出口防御**，对应用户"存档里不该再残留已下线插件"的要求）；
  6. 插件列表只由代码注册表产生：把 `AppState.plugins` 塞满未知 id，`ExtensionsModal` 仍只显示注册表里的插件；
  7. `EXPORT_VERSION` 仍为 9、老版本导入新存档不被拒绝（§2.8.2）。
- **依赖**：P1。

### ⬜ P4 — `ext-host` 受控 TTS 代理

- **产物**：`ext-host/src/server.js`、`nginx.conf`、`dev-server/nginx/default.conf.template`、`.env.example`（两处）。
- **验收**：`POST /api/ext-host/plugins/quote-tts/speech` 返回可播放音频；body 内注入 `provider_endpoint` / `baseUrl` **不改变**实际上游（用日志证明）；非法 `voice` 返回 400；超长 `input` 返回 413/400；`GET /status` 反映配置状态；未配置 env 时返回 503 且错误结构清晰。
- **依赖**：P1。

### ⬜ P5 — `quote-tts` 原生插件

- **产物**：`plugins/quote-tts/**`。
- **执行约定**：`QuoteTtsButton.tsx` 及其**装饰区间计算**（正则扫描、区间合并去重、与 §2.6 管线的对接）**由主 agent 亲自实现，不派发子代理**（用户 2026-09-15 明确要求）。设置面板 UI 与音色常量表可派发。
- **验收**：含 `「」` 与 `""` 的消息出现 🔊；点击播放对应角色音色；设置面板列出参与者（用户角色名、当前角色名、会话内 `人名:` 前缀）；切换音色后刷新仍生效；试听按钮工作；带粗体/链接/行内代码的消息装饰位置正确；正在播放时重复点击不叠加播放。
- **依赖**：P2、P3、P4。

### ⬜ P6 — 文档与收尾

- **产物**：`.docs/plugin-system/插件框架规范.md`、`.docs/plugin-system/ST扩展移植规范.md`、`.docs/阶段交接-插件系统-P1..P5.md`（或单份汇总交接，视 P 粒度）、memory 条目更新。
- **验收**：文档中的接口签名与代码一致（用 `git grep` 逐条比对）；移植规范含「必须替换的 ST 依赖清单」与「本例对照」。
- **依赖**：P5。

---

## 5. 文件清单

### 5.1 新增

```
plugins/registry.ts
plugins/quote-tts/plugin.tsx
plugins/quote-tts/voices.ts
plugins/quote-tts/QuoteTtsButton.tsx
plugins/quote-tts/QuoteTtsSettings.tsx
plugins/quote-tts/README.md
src/plugins/types.ts
src/plugins/registry.ts
src/plugins/runtime.ts
src/plugins/normalize.ts
src/plugins/decorators.ts
src/plugins/backend.ts
src/plugins/index.ts
src/components/ExtensionsModal.tsx
.docs/plugin-system/插件框架规范.md
.docs/plugin-system/ST扩展移植规范.md
```

### 5.2 修改

```
src/types.ts                       AppState.plugins + PluginState/PluginStateMap
src/App.tsx                        DEFAULT_SETTINGS / SCHEMA_VERSION 12 / migrateV11ToV12 / 加载归一化 / writer / syncPluginRuntime / 事件发射
src/components/ChatHeader.tsx      扩展按钮接线
src/components/MessageItem.tsx     逐块装饰接线（renderTextWithQuotes + decorateAndHighlight）+ components 映射扩至 blockquote/h1~h6/td + useSyncExternalStore 订阅
src/components/SettingsModal.tsx   （如需）云端下行归一化收敛
src/lib/settingsBackup.ts          导入应用路径收敛到 normalizePluginStates
eslint.config.js                   files 增 plugins/**
ext-host/src/server.js             新增插件路由 + /status 增字段
nginx.conf                         新增精确匹配 location
dev-server/nginx/default.conf.template  同步镜像
.env.example / dev-server/.env.example  新增 PLUGIN_QUOTE_TTS_* 说明
```

### 5.3 明确不改

```
src/lib/regex/**                   （保留模块，非本阶段范围）
src/lib/frontendCard/**            （同上）
src/lib/chatPipeline.ts            （除事件发射点如确需外，不动）
shared-server/**                   （云端原样存 ExportPayload，无需改动）
nyaachat-knowledge/**              （无关）
```

---

## 6. 验证矩阵

| # | 验证项 | 命令/方法 | 适用 P |
|---|---|---|---|
| V1 | 类型与 lint | `npm run lint`（= `tsc --noEmit && eslint .`） | 全部 |
| V2 | 构建产物 | `npm run build` | 全部 |
| V3 | dev 服可见 | `python tools/rebuild-dev.py --up`（`dev-server/`）后浏览器访问 `http://localhost:4095/` | P2,P4,P5 |
| V4 | 装饰在含原始 HTML 消息上不丢内容 | 造一条含 `<b>`、`**粗体**`、链接、行内代码的消息，检查渲染完整且装饰位置正确 | P1,P5 |
| V5 | 本地导出→导入往返 | 导出 JSON → 改配置 → 导入 → 比对 `plugins` 段 | P3 |
| V6 | 云端上传→下载往返 | 上传设置 → 清空本地 → 云端下载 → 比对 `plugins` 段 | P3 |
| V7 | 老存档兼容 | 用不含 `plugins` 的 v9 归档导入，应成功且 `plugins = {}` | P3 |
| V8 | 未知插件 id | 手改归档加入 `plugins.unknown-plugin`，导入后应被丢弃 | P3 |
| V9 | 上游不可被 body 改写 | 请求 body 注入 `provider_endpoint`/`baseUrl`，配置不符时上游仍为 env 值（比对 ext-host 日志/上游回显） | P4 |
| V10 | 音色/长度校验 | 非法 `voice` → 400；超长 `input` → 413/400 | P4 |
| V11 | 播放闭环 | 真机点击 🔊 听到音频；重复点击不叠加 | P5 |
| V12 | 刷新持久 | 切换音色并启用插件 → 刷新 → 状态与配置保持 | P3,P5 |
| V13 | 文档一致性 | `git grep` 比对文档中的接口签名与 `src/plugins/types.ts` | P6 |
| V14 | 无 ST 残留 | `git grep` 确认未新引入 `extension_settings` / `.mes_text` / `scripts/extensions` 等字样 | 全部 |
| V15 | 残件清理 | 搜索临时测试插件、临时脚本、临时归档并删除；`git status` 干净 | 全部 |
| V16 | **出口防御**：已下线插件不进新存档 | localStorage 手塞未知插件 id → 导出 → 归档的 `plugins` 段不含该 id | P3 |
| V17 | **代码为权威**：列表不看存档 | `AppState.plugins` 塞满未知 id → `ExtensionsModal` 只显示注册表中的插件 | P2,P3 |
| V18 | 导出存档轴未被改动 | `git grep -F -e "EXPORT_VERSION = 9" -e "SUPPORTED_IMPORT_VERSIONS" src/lib/settingsBackup.ts`，集合仍为 `{2..9}` | P3 |
| V19 | **防空断言**：`plugins/registry.ts` 为空时，`normalizePluginStates()` 对任何输入都返回 `{}` ⇒ V5/V6/V16 的「已知 id 保留」分支**无法验证且会假通过** | 复验时向 `getRegisteredPlugins()` 返回的**活数组** push 一个探针插件（P5 注册 quote-tts 用的是同一数组），`finally` 里复原；或等 P5 注册真实插件后重跑该三条 | P3,P5 |

> **V14 方法学警示（沿用上一阶段教训）**：`git grep -E` 中的 `\|` 在 ERE 里是**字面竖线**，会导致"期望 0 命中"的检查**假通过**。多关键词一律用 `git grep -F -e A -e B`，或确认使用真正的 ERE 交替 `|`（不加反斜杠）。

---

## 7. 安全约束（红线）

1. 插件后端上游**只能**由服务端 `process.env` 决定；请求体不得影响上游地址、模型、鉴权（R5）。
2. 插件 `backend[].path` 必须落在 `/api/ext-host/plugins/<pluginId>/` 前缀下，注册表加载时校验。
3. 前端不得调用未在 `backend[]` 中声明的能力（`callBackend` 查表失败即抛）。
4. `nginx.conf` 只加**精确匹配** location，不恢复 `/api/ext-host/` 通配前缀（L199 注释明确该前缀已删除）。
5. 不把任何密钥写入仓库；新增 env 只写 `.env.example`，真实值进 `.env`（两处均已 gitignore）。
6. 装饰渲染不得使用 `dangerouslySetInnerHTML`；装饰节点的属性由宿主生成，不采用插件提供的 HTML 字符串。
7. 不删除、不移动上一阶段保留的模块与文档；`H:\GitHub\nul` 这一真实文件（96 B）严禁删除。

---

## 8. 文档交付清单

| 文档 | 路径 | 状态 |
|---|---|---|
| 重构计划（上游） | `.docs/plugin-system/扩展系统重构计划.md` | 已存在（未跟踪） |
| 审计报告 | `.docs/plugin-system/审计报告.md` | ✅ 已产出，待复核 |
| 开发计划 SSOT | `.docs/plugin-system/开发计划-SSOT.md` | ✅ 已产出，待复核 |
| 插件框架规范 | `.docs/plugin-system/插件框架规范.md` | ⬜ P6 |
| ST 扩展移植规范 | `.docs/plugin-system/ST扩展移植规范.md` | ⬜ P6 |
| 原生插件开发规范 | `.docs/plugin-system/原生插件开发规范.md` | ⬜ 后续 V（本次不做） |
| 阶段交接 | `.docs/阶段交接-插件系统-*.md` | ⬜ 每 P 收尾 |
| 上一阶段交接 | `.docs/阶段交接-ST-EXT-REMOVAL.md` | 已存在（跟踪） |

---

## 9. 进度状态表

| P | 内容 | 状态 |
|---|---|---|
| P1 | 插件树、框架契约与运行时 | ⬜ 未开始（等复核） |
| P2 | 扩展 UI 重构 | ⬜ 未开始 |
| P3 | 插件配置并入设置体系 | ⬜ 未开始 |
| P4 | `ext-host` 受控 TTS 代理 | ⬜ 未开始 |
| P5 | `quote-tts` 原生插件 | ⬜ 未开始 |
| P6 | 文档与收尾 | ⬜ 未开始 |

---

## 10. 变更控制

### 10.1 文档权威

- 本 SSOT 是插件系统 V1 的唯一事实来源。任何架构级改动（目录模型、契约签名、版本号策略、后端安全模型、插件集合权威来源）必须先改本文件并经用户确认，再动代码。
- 每个 P 完成后更新 §9 状态表并写交接文档；P 内的实现细节偏差记入交接文档的「仍需验证/已知问题」。
- 用户复核（本次）通过后，P1 起以 plan 模式推进。

### 10.2 执行约定（用户 2026-09-15 复核时明确要求）

1. **团队规模**：实现阶段采用 agent 团队，子代理数 **≤ 8**；并行处理无前置依赖的任务链；不允许出现"无前置依赖却无人认领"的悬空任务；不允许子代理空转。
2. **装饰区间相关实现由主 agent 亲自做，不派发子代理**——理由：该部分是全案改动最敏感、最需要与用户实时核对的部分（区间空间定义、文本节点切分、与既有引号高亮的组合顺序）。具体范围：
   - `src/plugins/decorators.ts`（P1）；
   - `plugins/quote-tts/QuoteTtsButton.tsx` 与 P5 的装饰区间计算/正则扫描（P5）。
   其余工作（设置面板 UI、音色常量表、`ext-host` 路由、`ExtensionsModal`、文档）可正常派发。
3. **dev 服验收**：所有前端可见改动必须在 `NyaaChat/dev-server` 的 dev 测试服（`http://localhost:4095/`，`python tools/rebuild-dev.py --up`）上验证后再交用户验收。
4. **文档落位**：全部插件系统文档落于 `.docs/plugin-system/`；每 P 收尾走 `commit-push` skill + 交接文档 + memory 更新。

---

## 11. 执行期已发生的缺陷与更正记录

> 本节记录**编排与契约层面**（不是产品代码）已经发生的错误及其处置，防止同类问题复发，也防止后续接手者被失败记录误导。

### 11.1 t2 的 `inScope` 漏项导致契约校验无法完成（captain 编排缺陷，已处置）

- **现象**：`backend` 成员完成 ext-host 受控 TTS 代理的全部实现与全链路实测后，`update_task(completed)` 被契约校验拒绝：`implementation cannot complete: .env.example is out_of_scope`。attempt 1 因此落 `failed`（finding `T2-META-1`, low）。
- **根因**：captain 编排 t2 时，`inScope` 只写了 `ext-host/`、`nginx.conf`、`dev-server/nginx/default.conf.template`，**漏了 `.env.example` 与 `dev-server/.env.example`**；而同一任务的 `acceptance` 第 7 条、`deliverables` 列表与派工令都逐字要求这两处。契约自相矛盾。
- **影响**：`t6`/`t7` 依赖 `t2`，而依赖必须是 `completed` ⇒ 若不修复，两条任务永远不会被调度（DAG 死锁）。这是本次唯一一次真正的调度风险。
- **为什么不能在原地修**：运行中的团队**无法编辑** `inScope`/`acceptance`（`agent_teams_edit_plan` 只对 staged 计划生效，`update_task` 没有契约字段）。校验对 captain 同样生效。
- **处置**：`reassign_task(t2 → captain)` 后由 captain 以 `completed` 收尾，**代码零改动、零重做**；`changedPaths` 字段只能列出 3 个 in-scope 路径，因此在该任务的 `output` 里**显式声明**了第 4/5 个真实改动文件与字段裁剪原因，避免日后被误读为"只改了 3 个文件"。独立复验仍由 `t7` 承担。
- **未做的事（有意）**：没有通过少报 `changedPaths` 来绕过校验。校验存在的意义就是暴露这类不一致，绕过它等于把一次真实的编排缺陷埋掉。
- **后续预防**：新增任务的 `inScope` 必须**逐条覆盖 `acceptance` 与 `deliverables` 里出现的每一个路径**；编排完成后做一次"acceptance 路径 ⊆ inScope ∪ outOfScope"的自查。

### 11.2 审计报告初稿的 G3 描述过重（已更正）

初稿称 `MessageItem.tsx` "无任何插件扩展位"，实际存在逐块引号渲染扩展点（`QUOTE_RE`/`highlightQuotes`/`renderTextWithQuotes`）。已在审计报告 §2.4 就地更正并说明该更正如何改变 §2.6 的实现选型。

### 11.3 空注册表导致的验证假通过风险（由 `settings` 成员发现）

见 §6 的 V19：`plugins/registry.ts` 为空时 `normalizePluginStates()` 对任何输入都返回 `{}`，V5/V6/V16 的"已知 id 保留"分支会**空断言假通过**。已验证者需用探针插件注入活数组的方式复验，或等 P5 注册真实插件后重跑。

### 11.4 区间校验比文档描述更严（由 `docs` 成员发现，D-17）

SSOT §2.6 初稿只写"非 NaN + 区间范围"，实现 `src/plugins/decorators.ts` 还要求 `Number.isInteger`，小数偏移会被丢弃并 `console.warn`。**实现更严是正确的**（切分字符串只能按整数边界），已就地更正 §2.6 的措辞。插件作者须知：返回小数偏移不会报错，但那条装饰会被静默丢弃并留一条警告。

### 11.5 未跟踪文件的 `git grep` 假通过（captain 自查时踩到）
对 `.docs/plugin-system/**` 这类**未跟踪**路径做残留扫描时，`git grep` 会返回"零命中"——它只搜已跟踪文件。captain 在核对 SSOT 里是否还有旧措辞时因此得到过一次**假通过**（当时 SSOT 确实还有 4 处 `rehype` 残留）。
**方法学要求（与 `-E`/`\|` 陷阱并列）**：残留扫描一律**双方法交叉** —— `git grep`（覆盖已跟踪文件）∪ 文件系统扫描（`Select-String` / `Get-ChildItem -Recurse`，覆盖未跟踪文件）；两者都为空才可判"无残留"。

**累计发生 5 次（每次都是"方法错"，其中 1 次结论也错）**，故升级为硬性纪律：
| # | 谁 | 检查内容 | 后果 |
|---|---|---|---|
| 1 | captain | SSOT 里 `rehype` 残留 | 差点把 4 处真实残留判为"无残留" |
| 2 | `docs` | `definePlugin` 残留 | 自查后改用双方法交叉重做证据 |
| 3 | `ui` | `probePlugins`/`__ui_probe` 清理 | 结论碰巧正确（captain 独立复验确认） |
| 4 | `ui` | 同上（第一次探针） | 同上 |
| 5 | `ui` | `getPluginHostContext` 的消费者 | **结论错误**：判定"插件侧无消费者"；captain 用文件系统扫描在 `QuoteTtsSettings.tsx` L71/L161/L162 找到了 `getPluginHostContext` 消费者，推翻了该结论 |

第 5 次的教训最重：**一次假 0 会直接产出错误的结论**，不只是"少看见残留"。但**具体机制 captain 无法确证**，如实记录两种候选（不选边）：
- (a) 用 `git grep` 扫了未跟踪路径 —— 该风险已由 `ui` 独立实证并接受为纪律（`git ls-files plugins/` = 0 个已跟踪文件 vs 磁盘 7 个；`ui` 亦实测 `.docs/plugin-system/`、`src/plugins/`、`ExtensionsModal.tsx` 同为未跟踪）；
- (b) 按**已迁移的旧符号名**扫描 —— `ui` 自述其扫描约在 20:47、称当时 `QuoteTtsSettings.tsx` 已迁到叶子模块，故按旧名 `getPluginHostContext` 扫得 0。
  ⚠️ **counter-evidence（captain 保留，供后续判断）**：captain 在 t12 之前的文件系统扫描中，于 `QuoteTtsSettings.tsx` L71/L161/L162 明确读到 `getPluginHostContext`；而该文件在 t12 改写前的 mtime 为 20:33:58（t12 之后才变为 20:52:31）。即按 mtime 推断，20:47 时文件内应仍存在旧名。(b) 的时点自述与该项证据不吻合，但**captain 不据此断定 `ui` 的说法错误** —— 双方可能在不同时刻扫描、或中间存在未记录的写入。

**无论机制是 (a) 还是 (b)，硬性纪律都不变**：对未跟踪路径，`git grep` 的结果不得单独作为证据（须与文件系统扫描并列）；并且**扫描符号名时必须先确认该符号在当前版本里是否已被改名或迁移**，用旧名扫新代码同样会得到"假 0"。

---

### 11.6 App.tsx 的宿主上下文接线归属：曾一度不明，已由证据澄清为 `ui`

- **事实**：`src/App.tsx`（mtime `2026-09-15 20:33:49.746`）出现了正确的宿主上下文接线 —— `hostContextRef` + 无依赖 effect 推送 `setPluginHostContext`。该实现**符合要求且已通过 lint/build**。
- **问题**：`framework` 在其 t8 报告里把这次改动归因为"captain 自己落地"，**这个归因是错的 —— captain 全程没有编辑过 App.tsx**（captain 在给 ui 的消息里明确写过"我暂时不碰 App.tsx，等你 t3 完成后再动"）。而 `ui` 的 t3 报告声明 changedPaths 只有 `ExtensionsModal.tsx` 与 `ChatHeader.tsx`、明确否认动过 App.tsx；`framework` 又声明其 t8 只改了 `runtime.ts`。
- **结论（20:4x 由新证据澄清）**：作者是 **`ui`**。两项证据互相印证：① 它随后为验收宿主上下文新建的探针文件名就叫 `plugins/__ui_probe_host.tsx`，文件内注释写明"临时探针 import（ui / t3 **宿主上下文验收**）"；② 时间线吻合 —— App.tsx mtime `20:33:49` 紧接 captain 发给 ui 的纠偏消息（要求它补 App.tsx 接线），探针 `20:34:42`、`plugins/registry.ts` `20:34:50`。
- **真正的问题不是谁写的，而是申报不准**：`ui` 的 t3 完成报告声明 changedPaths 只有 2 个文件、并明确写"未动 App.tsx" —— 而 App.tsx 本就在 t3 的 inScope 内，**如实列出不会有任何问题**。`framework` 把这次改动归因为"captain 落地"同样是错的（captain 全程未编辑 App.tsx），它为此被 captain 追问了两轮。
- **被取代的初版推断（保留以记录推理过程，勿再引用）**：曾推断是 `framework` 的 attempt 1 被 `reassign_task` 中断后、丢失了对自己产物的记忆而误认。该推断未被证据支持。
- **教训（与 §11.1 的编排缺陷并列）**：`reassign_task` 不只打断在途回合，还会让成员**失去对自己已写内容的记忆**，进而产生**错误归因**。因此：① 指派优先用 `send_message` 唤醒已 claim 的成员，不到必须不 `reassign_task`；② 任何"某人改了什么"的判断，必须回落到 `git diff` / 文件 mtime / filesystem 扫描这类**与被中断记忆无关的证据**，不采信成员的转述。
- **处置**：接受现状（实现正确），但**不允许**保留"captain 落地"这个错误归因；后续凡引用 App.tsx 接线，一律标注"归属不明（见 §11.6）"。
- **⚠️ 由此暴露的机制局限（比这次归因本身更重要）**：任务契约校验只检查 `changedPaths ⊆ inScope`，**无法发现"少报"** —— 成员完全可以改动某个 in-scope 文件却不写进 `changedPaths`，校验照样通过。本次即是实例：t3 声明 changedPaths 只有 2 个文件，而 App.tsx（**也在 t3 的 inScope 内**）确实变了。因此**每一次收尾都必须由 captain 用与被中断记忆无关的证据独立核验改动面**：`git status --porcelain`、`git diff --stat`、文件 mtime、filesystem 扫描 —— 不采信成员自报的 changedPaths 作为唯一依据。这条与 §11.5 的双方法交叉、§11.1 的编排自查并列为收尾必做三件事。

### 11.7 主 chunk 暴涨 851 kB：lucide 命名空间导入（captain 取证确认）

- **现象**：主 chunk 由 t1 时的 1,389.38 kB 涨到 2,240.80 kB（gzip 586.48 kB）。
- **根因**：`src/components/ExtensionsModal.tsx` L16 `import * as LucideIcons from "lucide-react";` + L46 `const icons = LucideIcons as unknown as Record<string, unknown>;`，随后按 `meta.icon` 动态取名。**对命名空间对象做动态属性访问会使 Rollup 无法 tree-shake**，整套 lucide 图标被打进主 bundle。全仓仅此一处这种写法（文件系统扫描确认）。
- **为什么没被更早发现**：`npm run lint`（`tsc --noEmit && eslint .`）与 `npm run build` **都只看退出码**，体积回归不会让它们失败；而验收项里原本没有"bundle 体积"这一条。**教训：新增重依赖或改变导入形态时，必须把构建产物体积当作验收证据记录，而不是只看 exit 0。**
- **处置**：见 §12 的 L6（t9 修复任务）；图标取值同时收紧为**显式允许集**（§2.5）。

### 11.8 草稿目录污染共用 lint 闸门 + 「无主改动默认归因 captain」模式

- **闸门缺陷（captain 取证）**：`npm run lint`（`tsc --noEmit && eslint .`）是全员共用验收闸门，却被成员的在写草稿目录污染：
  · `.verify-tmp/**` **既未 gitignore 也未进任何 ignore/exclude** ⇒ 其中 `cdp.mts` 的 8 个 `no-explicit-any` + `probe1-decorators.ts` 的 1 个 `prefer-const` 让 `eslint .` **恒定 9 个 error，全仓 lint 恒红**；
  · `src/temp/**` 虽已 gitignore + eslint ignore，但 `tsconfig.json` **只 exclude 了 `dist/**`** ⇒ `tsc --noEmit` 照样检查它（实测一句 `Cannot find module './voices'` 就曾让全仓 tsc 失败）。
  **危害已实际发生**：`ui` 只能改跑"我的文件 + 排除第三方目录"来自证；`t9`/`t10` 的"`npm run lint` exit 0"在污染的树上**不可能通过**；`verify` 的 V1 会误判为产品缺陷。处置见 §12 的 L12（t11）。
  **教训**：**验收闸门必须是"任何人任何时刻都能跑绿"的**。引入新的草稿/探针目录前，必须同时确认它被 gitignore、被 eslint ignore、被 tsconfig exclude 三者覆盖；否则一个人的在写脚本会把全队的验收判红。
- **「无主改动默认归因 captain」模式（本阶段出现 2 次）**：① `framework` 把 App.tsx 的宿主上下文接线归因为"captain 落地"，实际作者是 `ui`（§11.6）；② `ui` 把 `src/temp/` 里 plugin 的 t10 在写草稿归因为"captain 的草稿目录"，并据此**代删**了它们（虽已备份且 plugin 已重建，未造成实质损失）。
  **纪律**：任何"这是谁改的"判断，一律用 `git status --porcelain` / `git diff --stat` / 文件 mtime / 文件名与内部注释取证后再下结论；**不得**把无法解释的改动默认归因为 captain。并且**不得代删其他成员的在写文件** —— 报告给 captain，由 captain 协调。

### 11.9 captain 的环分析不完整（只识别一半边）+ 在移动目标上做快照

- **事实**：captain 编排 t10 时声称"从根上断环"，但只识别出**一条边**（`QuoteTtsButton` → `src/plugins/runtime`）。环实际有**两条**：第二条是 `plugins/quote-tts/QuoteTtsSettings.tsx:74` → `src/plugins/runtime` → `src/plugins/registry` → `plugins/registry` → `plugin`。因此 t10 只断了一半，探针输出与修复前**逐字相同**（`ids=["undefined"]`、`getPluginById=undefined`、`validatePlugins issue=1`）。
- **是 `plugin` 成员挡下了它**：它按纪律没把手伸到 inScope 外，而是带着根因（含逐字相同的探针输出）与根修方案（把宿主上下文抽成只依赖 `./types` 的**叶子模块**）上报 —— 这正是"失败上报"应有的样子。根修落于 t12。
- **教训一（分析纪律）**：断言"从根上"之前，必须**枚举全部入边**并逐条列出（`grep` 出环上每个模块的 import 行），而不是找到一个可疑点就宣布根因。环是"回到起点的路径"，只堵一段不叫断环。
- **教训二（并行开发的快照纪律）**：`plugin` 报告 20:47 的 dev 重建撞上 `ui` 正在编辑的 `ExtensionsModal.tsx` 中途态，把 `LucideIcons is not defined` 打进镜像 ⇒ **整站白屏**；源码落定后重建即正常。**流程要求：dev 重建前必须确认源码稳定** —— `tsc --noEmit` 与 `eslint .` 均 exit 0 **且**要改的文件 mtime 已静止。否则红灯反映的是"在移动目标上做快照"，不是产品缺陷。
- **教训三（草稿区共用）**：`src/temp/` 本轮被队友整目录删除过一次（含 `plugin` 正在写的探针）。约定：**每个成员用独立子目录**（如 `src/temp/<成员名>/`），且**不得整目录清理**；t11 已把 `src/temp/**` 移出 tsc 闸门，可安全使用。

### 11.10 t3 的 changedPaths 漏报已由成员自己更正（含精确归属拆分）

- **原申报**：t3 完成报告写 changedPaths = `ExtensionsModal.tsx` + `ChatHeader.tsx`，并声明"未动 App.tsx"。
- **实测更正（`ui` 主动给出，`git diff --stat` 口径）**：`src/App.tsx | 140 ++…`、`src/components/ChatHeader.tsx | 33 +-`。
- **关键细节：App.tsx 那 140 行是多人叠加，不是一个人写的。** 其中属于 `ui` 的只有 3 处：`setPluginHostContext` 的 import、L931-961 的 `hostContextRef` + 无依赖 effect、`Message` 类型导入。其余（`SCHEMA_VERSION` 11→12、`migrateV11ToV12`、`DEFAULT_SETTINGS.plugins`、`normalizePluginStates` 加载路径、config writer、`syncPluginRuntime` effect、三个 `emitPluginEvent`）都是 `framework` 的 P1 产物。
- **教训（比这次漏报本身更重要）**：**`git diff --stat` 只能给出"这个文件变了多少行"，给不出"哪几行是谁的"**。多人共改同一文件时，任何"某人改了某文件"的归因都是不成立的，必须落到 **hunk 级**（或行区间级）归属。`framework` 与 `captain` 此前都在这上面栽过（§11.6 的误归因、以及 captain 三轮排查）。
- **流程要求**：同一文件被 ≥2 名成员改动过后，其改动归属**不得**再用文件级粒度表述；报告里要写清楚自己改的是哪几段（行区间或符号名）。
- **不可修复项**：t3 是终态，其 `changedPaths` 字段**无法回改**；本节是该申报错误的**唯一权威更正**，后续引用以本节为准。

### 11.11 【最严重】装饰把被标注的原文从消息里删掉了（captain 代码缺陷，`verify` 在 t7 发现）

- **现象（用户可见的内容丢失）**：`猫娘: 「第一条引用」` 渲染成 `猫娘: 🔊` —— **引号原文在 DOM 里完全不存在**（只在按钮的 `title`/`aria-label` 里残留）。真实的助手消息三行同样如此，两段引号文字都消失。
- **根因**：`src/plugins/decorators.ts` 初版只 push `render` 的返回值，而 `slice`（被标注的原文）**仅作为参数传入 `render`、没有任何地方输出**。深层原因是 **§2.6 初稿的契约措辞模糊**：只写"切分文本并插入插件返回的 React 节点"，实现按"**替换**"理解；而 ST 原版是**追加**（`.ref/st-Quote-TTS/index.js` L107 `` `${match}<span …>🔊</span>` `` —— `match` 照常保留）。**契约措辞没说清"替换还是追加"，实现就会二选一，而这一选就让正文消失。**
- **连坐缺陷（`verify` 未点出，captain 修复时发现）**：初版在 `render` 抛错时用 `rendered = slice` 作降级；一旦改成"正文始终输出"，这条就会让**正文重复**。已同时改为 `rendered = null`。
- **修复**：正文**始终由宿主输出**，`render` 的返回值**追加在它之后**；契约语义在三处同步（SSOT §2.6、`types.ts` 的 `TextDecoration.render` 注释、`decorators.ts` 文件头新增「契约语义」小节）。回归探针 11/11 PASS，含"原文在 / 按钮在 / 原文只出现一次 / 抛错时正文完整且不重复"，且**用真实 quote-tts 插件**跑过。
- **教训**：
  1. **契约里"替换还是追加"这类二选一语义，必须写成不能有第二种读法的句子**；只描述"插入一个节点"是不够的。
  2. **captain 自办的代码同样需要独立验证** —— 这个缺陷是我的实现与我的契约共同造成的，`verify` 的独立验证是它被发现的唯一原因。此前 27 项自测全绿，因为**我的自测断言的是"按钮渲染出来了"，而没有断言"正文还在"**：测试写了什么，就只能证明什么。
  3. **同一处口径要跨模块对齐**（`quoteScan` 的前缀字符类 vs 设置面板的正则）：`verify` 顺带发现的 `<>` 口径不一致已一并修正（align 到面板，同时更贴近 ST 原版）。

### 11.12 §11.11 的修复**又引入了一个回归**：被装饰的引号失去高亮（`verify` 的 R2）

- **现象**：§11.11 修复后，被装饰的引号片段**不再经过 `highlightQuotes`**，运行时 `.quote-highlight` 计数为 0 —— 文本与按钮都在（功能无损失），但**启用 quote-tts 后原本的引号高亮消失**，与未启用时的渲染不一致。
- **根因**：修 blocker 时我把 `slice` 放进了"带 key 的 Fragment"内部；而宿主 `MessageItem.decorateAndHighlight` **只对顶层 string 型 children** 做引号高亮（数组分支里 `typeof node === "string"` 才走 `highlightQuotes`）。
- **修复**：正文改为**顶层字符串节点**输出，带 key 的 Fragment 只承载插件返回的装饰节点。自测 9/9 PASS：
  `猫娘: <span class="quote-highlight">「第一条引用」</span><button …>🔊</button>` —— 高亮 + 正文 + 按钮三者共存、正文只出现一次；且"停用插件时无按钮、高亮照旧"（原有行为不受影响）。
- **教训（同一天内第二次同类）**：**修一个缺陷时，必须同时问"这个改动会让哪些原本成立的断言失效"。** 我修好了"正文消失"，却在同一个函数里破坏了"引号高亮"这条**既有**行为 —— 而后者并不在我当时的断言清单里（我只断言了"正文在/按钮在/不重复"）。**断言清单要覆盖"改动带来的副作用面"，不只是"目标症状"。**

### 11.13 R7 的根因：`.ref` 路径未限定根目录（cwd 相对路径歧义）

- **争议**：`verify` 连续四轮称"文档把 ST 源路径写错 —— 实际是 `.ref/SillyTavern/st-Quote-TTS`，`.ref/st-Quote-TTS` 不存在"；captain 连续四轮实测"`NyaaChat\.ref\st-Quote-TTS\index.js` 存在（9357 B）"。双方都"实测过"，却结论相反。
- **根因（已定位）**：**两处都有 `.ref` 目录，内容不同** —— 工作空间根 `H:\GitHub\.ref\`（下含 `SillyTavern\st-Quote-TTS\`）与项目根 `H:\GitHub\NyaaChat\.ref\`（直接含 `st-Quote-TTS\`）。
  `verify` 的 cwd 是**工作空间根**，`Test-Path .ref/st-Quote-TTS` → False、`Test-Path .ref/SillyTavern/st-Quote-TTS` → True，两者同时成立；captain 的 cwd 是**项目根**，结论相反。**同一串相对路径，两个 cwd，两个答案。**
- **所以 R7 是假发现**，文档里的 `NyaaChat/.ref/st-Quote-TTS` **有效**；`verify` 报的 9367 B 与两份都不符（两份均 **9357 B**）。
- **纪律（写入 P6 文档规范）**：引用 `.ref/**` 时**必须限定根** —— 写成"项目根 `NyaaChat/.ref/st-Quote-TTS/`"或"工作空间根 `H:\GitHub\.ref\SillyTavern\st-Quote-TTS/`"，**不得只写 `.ref/...`**。同时说明"两份拷贝同字节数（各 9357 B）、L107 的追加语义一致"。
- **教训（与本阶段反复出现的"假通过/假发现"同族）**：**cwd 不同会让同一个检查得出相反结论，而双方都可能真诚地"实测过"**。凡报告里出现相对路径的实测结论，必须同时给出 **cwd**（或改用绝对路径）—— 这与"未跟踪路径上 `git grep` 必得 0"（§11.5）并列。

---

## 12. 遗留待办（滚动维护，完成即删）
> 本节是 captain 的跨轮记忆锚点：写在这里的事项不依赖对话上下文，接手者读 SSOT 即可续接。

| # | 事项 | 状态 |
|---|---|---|
| L1 | **`docs` 的《插件框架规范.md》中关于 `__ui_probe` 的登记已过期**：§2.3 表格（L34/L37）、§2.7 附近（L388-389）、§8 D-11 仍写"registry.ts 临时挂着验证探针 / 探针文件存在"。实测该探针已于 t3 收尾时删除，`plugins/registry.ts` 还原后 SHA256 = `310D29C7DD19D2684AAB15454866A2D143CDEA08A68967E7C32BE51581FC1D15`（captain 用文件系统双方法独立核验）。**需在 P5 章节更新时一并改判为已清理。** | ⬜ 待 docs 更新 |
| L2 | `ExtensionsModal` 由 `ChatHeader` **静态 import**（进主 bundle，不做 lazy chunk）—— V1 的明确决定，与 `ChatHeader` 既有 `VersionModal`/`RegexModal`/`UserAccountModal`/`KnowledgeBaseModal` 的做法一致。若将来要 lazy，需把入口回调从 App.tsx 经 ChatInterface 透传（动两个文件）。 | ✅ 已决定 |
| L3 | `updatePluginConfig` 的 **enabled 边界**：`enabled` 属宿主/UI 状态（`AppState.plugins[id].enabled`），config 属插件；t8 已落地剥离+warn，§2.4 需补这条边界说明。 | ✅ 已实现（t8），待补文档 |
| L6 | **主 chunk 暴涨 851 kB**：ExtensionsModal 的 lucide 命名空间动态取值导致整套图标进主 bundle —— 修复任务 t9（含"图标收紧为显式允许集"），并要求把构建体积作为验收证据。 | 🟡 t9 进行中 |
| L7 | `src/App.tsx` 的宿主上下文接线作者是 **`ui`**（证据见 §11.6）。实现正确、展示口径正确；但 ui 的 t3 报告漏报该文件（申报不准），引用时以 §11.6 为准。 | ✅ 已澄清 |
| L8 | **模块循环导致"直接引插件模块 ⇒ 注册表拿到 `undefined` 槽位 ⇒ 插件静默消失"**（`plugin` 实测复现）。链条：`QuoteTtsButton` → `src/plugins/runtime` → `src/plugins/registry` → `plugins/registry` → `plugins/quote-tts/plugin` → `QuoteTtsButton`。生产入口（`src/plugins/registry`）不受影响，属潜在陷阱。修法：让装饰上下文把 `config` 与 `callBackend` 传给 `QuoteTtsButton`，从而删掉它对 `runtime`/`backend` 的 import，从根上断环。 | 🟡 t10 进行中 |
| L9 | `plugins/__ui_probe_host.tsx` + `plugins/registry.ts` 的 `[quoteTts, ...probePlugins]` **未清理**（20:34 由 ui 为宿主上下文验收所加）—— 会让假插件 `probe-host` 出现在用户界面。属 V15 违例。 | ✅ 已清理（captain 独立核验：无探针文件；数组 = `[quoteTts]`；SHA256 `2D2F68AC…`） |
| L10 | **已知健壮性缺口（非本阶段范围，不单开任务）**：`ChatInterface.tsx` L1915 `messages.flatMap(...)` 对消息数组无元素级空值防护，注入缺 `id` 的畸形消息会**整站白屏**（`TypeError: Cannot read properties of null`）。`ui` 在手工构造测试会话时踩到；生产写入的消息都带 `id`，故不是当前功能缺陷。若将来要加固，可在此行前过滤 null 或在 MessageItem 顶部兜底。 | ⬜ 已记录 |
| L11 | `plugin` 的 t10 改动 `plugins/quote-tts/plugin.tsx` 与 `QuoteTtsButton.tsx`（6519 → 8158 B）。 | ✅ **captain 逐行 review 通过**（2026-09-15 20:49）：`QuoteTtsButton.tsx` 仅做了 props 增 `config`/`callBackend`、音色表改由 prop 派生、后端调用改走注入 caller，并删除了对 `src/plugins/runtime`/`src/plugins/backend` 的 import 与 `useSyncExternalStore`；`releaseAudio`（含 `onended/onerror=null`、`pause` try/catch、`URL.revokeObjectURL`）**逐字节未改**，播放互斥、errorTimer 回落、`resolveVoice` 双用、`stopPropagation`、className/aria 全部原样。新增的 `import type { PluginBackendCaller }` 是 **type-only**（编译期擦除、不产生运行时边），因此没有把环引回来 —— 这点做得很到位。`plugin.tsx` L74-86 的注入接线已核实：`scanQuotes(text, ctx.senderName)` → `<QuoteTtsButton config={ctx.config} callBackend={ctx.callBackend} />`。**唯一待办**：两个文件的头部注释仍写"QuoteTtsButton.tsx（captain 自办）"，未反映 t10 的这次修改，属记录准确性问题，待 t10 回报时要求补一句。 |
| L12 | **草稿目录污染共用 lint 闸门**（`.verify-tmp/**` 未 ignore/exclude ⇒ 全仓 lint 恒红；`src/temp/**` tsconfig 未 exclude ⇒ tsc 会检查）。 | ✅ 已修复（t11：`tsconfig.json` exclude + `eslint.config.js` ignores + `.gitignore`，并做了"闸门未被削弱"的反向验证） |
| L13 | `ui` 代删了 `plugin` 的 t10 在写草稿（已备份，plugin 已重建）。 | ✅ 已记录，无实质损失。约定见 §11.9 教训三：各用独立子目录、不得整目录清理 |
| L14 | **模块环的根修（t12）**：宿主上下文抽成叶子模块 `src/plugins/hostContext.ts`，断掉第二条边 `QuoteTtsSettings → runtime`；`runtime.ts`/`index.ts` 原样 re-export，App.tsx/MessageItem/ExtensionsModal 一行不改。 | ✅ **已完成 + captain 独立复验**（未采信单方结论）：captain 自写探针**复现 t10 的崩溃条件**（图入口先 `import plugins/quote-tts/plugin`）⇒ `ids = ["quote-tts"]`、undefined 槽位 0、`validatePlugins` 0 issue、`getPluginById` 命中、装饰器 1、`SettingsPanel` 是组件，6/6 PASS。另独立核验：`hostContext.ts` 全部 import 行只有 `import type { Message } from "../types"`（真叶子）；`runtime.ts` L188-190 用 `as` 别名（同一绑定）；插件侧已无对 runtime 的真实导入（唯一命中是 `QuoteTtsButton.tsx` 注释里的历史说明）；全仓 `tsc --noEmit` exit 0、`eslint .`（无排除）exit 0。plugin 侧语义变化实测 `leafNotified=1 / runtimeNotified=0`（拆分前 1/1）并逐处枚举消费者 ⇒ 无功能影响 |
| L15 | `plugins/quote-tts/plugin.tsx` 与 `QuoteTtsButton.tsx` 的头部注释仍写「QuoteTtsButton.tsx（captain 自办）」，未反映 t10 那次属性透传改动。 | ✅ **接受现状，不再修改**（判断已记录）：该表述在「**实现主体与引号区间逻辑的归属**」这一层面仍然准确 —— plugin 在 t10 只做了属性透传（已由 captain 逐行 review 通过），且该次改动已在 L11 与本表如实登记。此刻再改注释会让我 L11 的「逐字节未改」结论失效并需重新取证，收益不抵成本。**引用该注释时请按此理解，勿据此认为 QuoteTtsButton 从未被他人修改。** |
| L16 | **t9 曾悬空为 `in_progress` 四轮**：修复早已落地并核验通过（见 §2.5 修复结果），但 `ui` 手上的 attempt_id 被 scheduler revoke（它收到 `stale attempt`），它把该信号**误读为"任务已易主、我不是新归属者"**并声明不再触碰，从未调用 `claim_task` ⇒ 团队交付状态被它挂着（`Delivery: blocked`）。 | ✅ 已由 captain 记账收尾（attempt 2，与 t2 同一路径；未改代码、未冒领，output 中如实写明作者是 ui）。**教训已抽取为纪律**：`stale attempt` 只说明**attempt_id 过期**，**不等于任务易主** —— 成员应 `claim_task("<自己的任务>")` 取回当前 attempt_id 后继续/收尾；派工令里必须写明这一点。captain 在它连续三轮未响应后接手，属"优先成员"原则已穷尽 |
| L17 | `t10` 状态为 `failed`（前半已落地并经 captain 逐行 review 通过，后半由 t12 承接）。运行时会提示 "t10 failed without a follow-up repair" —— 因 `repair` 类型要求 `sourceFindingId`，而 captain 未持有 t10 的 finding id（不猜），故 t12 以 `implementation` 类型建立。 | ✅ **已闭环**：t12 已完成并复验（见 L14），缺陷的**根因已根除**。`t10` 作为失败记录**按设计保留**（终态不可改），它记录的是真实事实：第一次修复只断了一条边。后续任何人看到 `t10 failed` + `t12 completed` 的组合，请按本行理解，不要当成未修复的缺陷。 |
| L18 | **`docs` 的《插件框架规范.md》需补/改两条**（`verify` 拒绝代改他人文档，做法正确 —— 它只提供准确措辞，转由 docs 落地）：① 装饰是「**追加**」而非「替换」，且实现为**两级节点**（正文=顶层 string、装饰=独立 Fragment）—— **照"同置 Fragment"改会把 R2（引号高亮丢失）打回来**，见 §2.6；② 插件作者侧硬性约束，建议直接用这段原文：<br>「`TextDecoration.render` **只输出"装饰节点"本身**，不要在里面再渲染 `text`。被标注的原文由**宿主**以顶层文本节点输出；`render` 的返回值追加在其后。若在 `render`（或其返回的组件内部）再渲染 `text`，页面上会出现**两份原文**。」<br>同时把 §8 中与该语义相关的登记改判。 | ⬜ 待 docs 更新（P6） |
| L19 | **dev 测试服曾为坏构建**（`LucideIcons is not defined` → 整站白屏，20:49 的中途态快照，`verify` 发现）。 | ✅ 已重建（captain：确认源码稳定 + 闸门双绿后执行 `rebuild-dev.py --up`，exit 0）。新 bundle `index-BhxTPIbo.js`（1,411.70 kB / gzip 433.80），线上 `index.html` 已指向它；`GET /` 匿名 401、带凭据 200、`/__dev__/health` 200。**坏构建的符号已消失**：线上 bundle 内 `LucideIcons` 命中 0，对照片 `quote-tts` 6 / `nyaachat_settings` 4（证明可搜、非假通过） |
| L20 | **R4 → 写入《ST 扩展移植规范》（P6）**：`PREFIXED_QUOTE_RE` 要求行首，故**单行中段**的 `猫娘:「…」` 不会被识别为"带人名前缀"，回落 `senderName`。⚠️ 表述必须准确：**该引号仍会被装饰**（`PLAIN_QUOTE_RE` 覆盖无前缀情形），丢的是**人名归属**，不是按钮。ST 因 HTML 里有 `>` 而能命中，属移植后的保真度损失。 | ⬜ 待 P6 文档 |
| L21 | **R7 已核实为假发现，但需登记一个事实**：`st-Quote-TTS` 参考存在**两份拷贝** —— `H:\GitHub\NyaaChat\.ref\st-Quote-TTS\index.js`（9357 B, 2026-06-14）与 `H:\GitHub\.ref\SillyTavern\st-Quote-TTS\index.js`（9357 B, 2026-06-27）；`H:\GitHub\NyaaChat\.ref\SillyTavern\st-Quote-TTS` **不存在**。故文档里的 `NyaaChat/.ref/st-Quote-TTS` 路径**有效**。（`verify` 报的 9367 B 与两份都不符。）文档引用时宜注明"两份同字节数、L107 内容一致"。 | ⬜ 待 P6 文档 |
| L22 | `verify` 的独立验证报告：`.docs/plugin-system/验证报告-P1-P5.md`（632 行 / 43653 B）。结论：V1/V2/V4–V12/V16/V17/V18 在**最终修订版 B** 上全部通过、未修复阻塞缺陷 0 条。 | ✅ **已终局**（含追加复验）：**V15 判通过**（探针已被清理 —— captain 交底里的"探针残留"是**过时状态**，verify 按当前树判并给双方法交叉证据，做法正确）；**V17 双向对照**成立（探针在树上时列表多一行 → 清理后恰只剩 quote-tts）；**R2 判已修复**（captain 的"顶层 string"改法，verify 复验 8/8：节点序列 `["str:前缀","str:「…」","frag"]`、正文逐字不丢、抛错不重复、重叠先到者胜按注册顺序）；入口顺序陷阱经**裸插件模块入口**复测 8/8 通过（证明陷阱已消失，非绕过） |
| L23 | **「镜像是否 stale」的判断不能只看"我重建过没有"**（captain 差点又交出一个过期镜像）：captain 第一次重建 dev 后，**又改了 `src/plugins/decorators.ts`（mtime 21:26:40）**，于是镜像立刻重新变 stale —— 是 `verify` 的 R2 复验把这个盲点照出来的。**纪律**：每次交付前端验收前，必须比对**镜像构建时间 vs 会进 bundle 的源文件 mtime**（`Get-ChildItem src,plugins -Recurse -Include *.ts,*.tsx | Sort-Object LastWriteTime -Descending | Select -First N`），而不是凭"我重建过一次"下结论。 | ✅ 第二次重建完成。**并做了「来源级」验证**（比"我重建过"强）：线上 bundle `index-9kLm-rgk.js`（新哈希）内，R2 新增的 `console.warn` 文案「该片段仅保留正文」命中 **1**、被替换掉的旧文案「该片段降级为纯文本」命中 **0** ⇒ 精确证明该 bundle 由 R2 修复后的源码构建（字面量压缩后仍保留）。另：`LucideIcons` 命中 0；对照片 `quote-tts` 6 / `nyaachat_settings` 4 / `api/ext-host/plugins/quote-tts/speech` 1；探针 anon 401 / auth 200 / health 200。**可复用手法**：用"新旧文案字面量在/不在"做构建来源验证，优于任何时间戳推断。**另一条更硬的镜像对应关系取证**（captain 用于终局澄清 `verify` 的"21:04"过期快照）：
```
docker image inspect nyaachat-dev-app:local --format '{{.Created}}'   → 2026-09-15T13:30:08Z（UTC）= 本地 21:30
docker inspect nyaachat-dev-dev-app-1 --format '{{.Created}}'          → 13:30:08Z（容器）
docker exec nyaachat-dev-dev-app-1 sh -lc "ls /usr/share/nginx/html/assets/ | grep index-"
                                                                      → 只有 index-9kLm-rgk.js（旧文件不存在）
docker exec ... grep -o 'assets/index-[A-Za-z0-9_-]*\.js' /usr/share/nginx/html/index.html
                                                                      → assets/index-9kLm-rgk.js
```
⚠️ 注意 `docker image inspect` 的 `Created` 是 **UTC**，与本机本地时间差 8 小时 —— 直接把 UTC 当本地时间会得出"镜像比源码旧"的错误结论（`verify` 的"21:04 镜像含 21:26 修复"就是这个方向的误读）。**纪律**：判断镜像与源码对应关系时，优先用"容器内实际 assets 文件名 + index.html 引用 + 产物内字面量在/不在"，其次才用时间戳。
**⚠️ 补充（2026-09-15，两次纠偏后的准确规则）**：
1. **"我重建过了"必须用证据确认，不能凭自述** —— `ui` 报了一次重建，但实测镜像 `Created`（`13:30:08Z`）与容器 `Created` **完全未变**、assets 仍是同一个文件 ⇒ 那是**全量缓存命中的 no-op**（源码自 21:26:40 起未变，Docker 无需重建）。**它的结论（4095 与工作树一致）是对的，但"重建"这个事实在证据上不存在。** 确认重建是否真的发生，看 `image Created` / `container Created` / 容器内 assets 文件名三者是否变化。
2. **产物字面量 grep 的适用范围（captain 与 `ui` 在此各错过一次）**：**宿主写死的字面量可以 grep 作正/反证据** —— 类名（`quote-highlight`）、告警/错误文案（`该片段仅保留正文`）压缩后原样保留；但**运行期拼接或压缩改名的不可**（`lucide-volume-2` 是**运行期拼装**、在源码里就 0 次；局部变量 `PLUGIN_ICONS` 被 minifier 改名 ⇒ 两者在产物里都是 0 命中，**这不代表功能缺失**，只能靠 DOM 断言）。captain 曾对 `verify` 笼统地说"`quote-highlight` 0 命中所以 bundle grep 不可靠"，**那句话是错的**，正确表述即本条。
**可操作判据（`verify` 用源码/产物两列实测得出，2026-09-15 定稿）**：**先在「源码」里 grep 该名字** ——
· 源码**有**（字面量）⇒ 产物查"在/不在"**可靠**。实测：`quote-highlight` 源码 5 / 本地 dist 1 / 线上 1；`quote-tts-btn` 源码 2 / dist 1 / 线上 1。
· 源码**0 次**（运行期拼装，或被 minifier 改名）⇒ 两侧都给 0，**不能**当证据。实测：`nyaachat-plugin-decoration`、`lucide-volume-2` 均为 0/0/0。
⚠️ 由此也修正了一条**过宽**的否定：`ui` 曾说"不要用 bundle 字符串 grep"，理由是"本地新构建里 `quote-highlight` 也是 0" —— **该理由复现不出来（实测为 1）**，因为它举的两个名字在源码里根本不存在、不构成反例。**正确说法是先确认该名字在源码里是不是字面量**，而不是整体否定该手法。
**⚠️ 附：一个会复发的 PowerShell 计数陷阱（`ui` 挖到底，2026-09-15）** —— 在**单行的大体积压缩产物**上，下面这个写法**恒返回 0**：
```powershell
(Select-String -Path $f -Pattern $m -SimpleMatch -AllMatches | ForEach-Object { $_.Matches.Count } | Measure-Object -Sum).Sum   # 恒 0
```
同一文件、同一字符串：`Select-String -Quiet` → **True**；`(Get-Content $f -Raw).Split($m).Count - 1` → **1**。
⇒ **不是"某物不存在"，是计数器坏了**，而 `ui` 由此把"我的计数器=0"错推成"该字符串不存在"，进而得出"bundle grep 不可靠"的过宽结论（它已撤回）。**数产物里的出现次数一律用 `(Get-Content <file> -Raw).Split($needle).Count - 1`（或 `[regex]::Matches($text,'…').Count`），不要用 `Select-String -AllMatches` 的 `Matches.Count`。**
**`ui` 由此给自己立的纪律（本阶段它同类第三次，值得全员遵守）**：**任何"某物不存在"的判断，必须先用一个已知存在的样本验证该方法能给出非零，再下结论。** |
| L24 | 口径补充（`verify` 提出）：`dev-server/.env.example` 因 `.gitignore:40` 忽略整个 `dev-server/`，**不可能**出现在主仓任何 `changedPaths` 里。与 t2 output 的"两项都因不在 inScope 内而被裁剪"不矛盾（inScope 是路径清单、与 git 跟踪无关），但该补充使结论更强：那一项是**双重**不可能出现。**t2 终态记录不改**。 | ⬜ 已记录 |
| L4 | P5 剩余：`quote-tts` 正式注册进 `plugins/registry.ts`、`.docs/plugin-system/ST扩展移植规范.md`、阶段交接文档、memory 更新。 | ⬜ 待 t6/t7 |
| L5 | `dev-server/nginx/default.conf.template` 仍保留 `/api/ext-host/` 通配前缀与 legacy `= /api/openai/custom/generate-voice`—— 属 dev 容器仓库的既有遗留（`git log -S` 证实来自首个提交 303f8e2），生产 `nginx.conf` 无此二者，不由本阶段引入。 | ⬜ 已知非失败项 |
