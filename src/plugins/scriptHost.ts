/**
 * 脚本宿主门面（SSOT §2.3）—— **叶子模块**。
 *
 * ⚠️ 叶子规则（与 `hostContext.ts` 同一纪律）：本文件只允许 `import type`；
 * **不得** import `./runtime` / `./registry` / `./backend` / `./normalize` /
 * `./index` / `src/lib/**` / `src/components/**` —— 任何一条都会让插件树重新
 * 出现通向注册表的静态边，插件会静默消失（t12 记录的模块环）。
 *
 * 两条正交通道：
 *  · A 宿主 → 插件：`setScriptHostApi()` 由 `src/App.tsx` 启动时推送（实现见
 *    `src/plugins/scriptHostImpl.ts`，插件禁止 import 它）；
 *  · B 插件 → 前端卡：插件在 `setup()` 里 `setCardApiPredefine(script)`，
 *    `src/lib/frontendCard/srcdoc.ts` 读它并注入卡片 iframe（D14）。
 */
import type { Message, ScriptRecord, WorldInfoRule } from "../types";

export type ScriptHostVariableScope = "message" | "chat" | "global";

export interface ScriptHostVariableOption {
  /** `number` 楼层下标（负数从末尾计）或 `"latest"`（末尾第一个有变量的楼层）。 */
  messageId?: number | "latest";
}

export interface ScriptHostVariableApi {
  getVariables(scope: ScriptHostVariableScope, option?: ScriptHostVariableOption): Record<string, unknown>;
  replaceVariables(
    next: Record<string, unknown>,
    scope: ScriptHostVariableScope,
    option?: ScriptHostVariableOption,
  ): Record<string, unknown>;
  updateVariablesWith(
    updater: (current: Record<string, unknown>) => Record<string, unknown> | void,
    scope: ScriptHostVariableScope,
    option?: ScriptHostVariableOption,
  ): Record<string, unknown>;
  insertVariables(
    vars: Record<string, unknown>,
    scope: ScriptHostVariableScope,
    option?: ScriptHostVariableOption,
  ): Record<string, unknown>;
  deleteVariable(path: string, scope: ScriptHostVariableScope, option?: ScriptHostVariableOption): boolean;
  hasVariable(path: string, scope: ScriptHostVariableScope, option?: ScriptHostVariableOption): boolean;
  /** 按路径读单值（`undefined` = 不存在）。`{{get_*_variable}}` 用它。 */
  getVariableAtPath(path: string, scope: ScriptHostVariableScope, option?: ScriptHostVariableOption): unknown;
}

/** JSR `getChatMessages()` 的返回项（V1 只填 MVU 用得到的字段）。 */
export interface ScriptHostChatMessage {
  message_id: number;
  role: Message["role"];
  name: string;
  message: string;
  /** ⚠️ **必须与 `Message.variables[swipe_id]` 是同一个对象**（M4）。 */
  data: Record<string, unknown>;
  swipes_data: Array<Record<string, unknown>>;
  swipes_id: number[];
  swipe_id: number;
}

export interface ScriptHostMessagesApi {
  /** 当前会话消息数组（引用直传；只读约定）。 */
  getAll(): Message[];
  /** 宿主聊天状态是否**已就绪**（会话已解析 **且** 至少有一层）。脚本不应在此之前运行：
   *  MVU 的 initvar 读 `SillyTavern.chat.length`，为 0 时直接判"不存在任何一条消息，退出"
   *  且不再重试（真机原文，i18n key `runtime.initvar.noMessagesLog`）。 */
  chatReady(): boolean;
  /** 诊断：区分"适配器未注册 / 会话 id 未解析 / 会话查不到 / 会话无楼层"四种"未就绪"。
   *  真机排查用（`__nyaScriptRunnerDiag()`），脚本不依赖它。 */
  diagnostics(): {
    adapterReady: boolean;
    sessionId: string | null;
    sessionFound: boolean;
    liveMessages: number;
  };
  /** 最后一条消息的下标；空会话返回 `-1`（与 ST 一致）。 */
  getLastId(): number;
  /** 以不可变更新的方式改写消息（宿主负责落盘）。 */
  update(updater: (messages: Message[]) => Message[]): void;
}

export interface ScriptHostLorebookEntry {
  id: string;
  comment: string;
  content: string;
  enabled: boolean;
  constant: boolean;
  keys: string;
  position: "system" | "assistant";
}

export interface ScriptHostLorebookApi {
  /** 兼容壳：NyaaChat 没有"全局世界书"。 */
  getSettings(): { world_info: { global: null } };
  getCharLorebooks(): { primary: string | null; additional: string[] };
  /** 当前角色的世界书条目，**包含 `enabled:false` 的**（M11：`[initvar]` 正是禁用条目）。 */
  getEntries(bookName?: string): ScriptHostLorebookEntry[];
}

/** 角色卡访问由宿主提供（`App.tsx` 持有 AppState，插件拿不到）。 */
export interface ScriptHostCharacterApi {
  getId(): string | null;
  getName(): string;
  getScripts(): ScriptRecord[];
  setScripts(next: ScriptRecord[]): void;
  getWorldInfo(): WorldInfoRule[];
}

export interface ScriptHostApi {
  variables: ScriptHostVariableApi;
  messages: ScriptHostMessagesApi;
  lorebook: ScriptHostLorebookApi;
  identity: { user: string; char: string };
  /** M10 `substitudeMacros`（上游错拼名照抄）：`{{user}}`/`{{char}}` + 6 个变量宏。 */
  macros: { substitute(text: string): string };
  character: ScriptHostCharacterApi;
  /** 自托管资源（§5.2/§5.3）：zip 清单 + 全局库路径，供执行器装配 iframe。 */
  vendor: {
    /** `/vendor/script-host/manifest.json`（importmap 由它生成）。 */
    manifestUrl: string;
    /** 按顺序加载的全局库。`esm` = 用 `import()` 加载；`globalName` = 加载后把模块
     *  命名空间挂到 window 的那个键（ESM 条目必须有，因为脚本里是裸用 `z`/`YAML`）。
     *  ⚠️ **路径不得使用 `.mjs`**：nginx 的 `mime.types` 没有 `mjs`，会以
     *  `application/octet-stream` + `nosniff` 下发，动态 import 直接被拒
     *  （t7 实测的 F1 blocker）。 */
    globals: Array<{ path: string; esm: boolean; globalName?: string }>;
  };
}

let scriptHostApi: ScriptHostApi | null = null;

export function setScriptHostApi(next: ScriptHostApi | null): void {
  scriptHostApi = next;
}

export function getScriptHostApi(): ScriptHostApi | null {
  return scriptHostApi;
}

// ─── 通道 B：插件 → 前端卡（D14）────────────────────────────────────────────

let cardApiPredefine: string | null = null;
const cardPredefineListeners = new Set<() => void>();

export function setCardApiPredefine(script: string | null): void {
  const next = typeof script === "string" && script.length > 0 ? script : null;
  if (cardApiPredefine === next) return;
  cardApiPredefine = next;
  for (const listener of [...cardPredefineListeners]) {
    try {
      listener();
    } catch (err) {
      console.error("[plugins] 卡片注入订阅者抛错", err);
    }
  }
}

export function getCardApiPredefine(): string | null {
  return cardApiPredefine;
}

export function subscribeCardApiPredefine(listener: () => void): () => void {
  cardPredefineListeners.add(listener);
  return () => {
    cardPredefineListeners.delete(listener);
  };
}

// ─── 通道 C：插件 → 宿主 UI（脚本初始化期的忙碌状态）────────────────────────
//
// 卡片脚本装配（加载运行时库 → 建 iframe → 跑脚本）需要一个短暂的窗口。这期间
// 允许用户发消息会让"脚本写入变量"与"用户追加消息"交错，虽然写回路径已改成
// 只增不减（不会丢数据），但按用户要求仍需给一个**非模态**提示并短暂禁用发送。
//
// ⚠️ 上限由插件侧控制（≤5s）：脚本可能挂住（30s 超时），绝不能把 UI 长时间锁住。

let scriptInitBusy = false;
const scriptInitListeners = new Set<() => void>();

export function setScriptInitBusy(next: boolean): void {
  const value = next === true;
  if (scriptInitBusy === value) return;
  scriptInitBusy = value;
  for (const listener of [...scriptInitListeners]) {
    try {
      listener();
    } catch (err) {
      console.error("[plugins] 脚本初始化状态订阅者抛错", err);
    }
  }
}

export function getScriptInitBusy(): boolean {
  return scriptInitBusy;
}

export function subscribeScriptInitBusy(listener: () => void): () => void {
  scriptInitListeners.add(listener);
  return () => {
    scriptInitListeners.delete(listener);
  };
}

/** 便于单测/探针：清空两条通道（生产代码不调用）。 */
export function resetScriptHostForTests(): void {
  scriptHostApi = null;
  cardApiPredefine = null;
  cardPredefineListeners.clear();
  scriptInitBusy = false;
  scriptInitListeners.clear();
}
