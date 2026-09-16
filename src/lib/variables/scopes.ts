/**
 * 三作用域的实际存储与定位（SSOT §2.2 的 `scopes.ts`）。
 *
 * | 作用域 | 存储位置 | 持久化 |
 * |---|---|---|
 * | `message` | `Message.variables[0]`（恒 1 槽，D4） | 经 `commitSession` → 宿主自动保存 |
 * | `chat`    | `ChatSession.variables`             | 同上 |
 * | `global`  | IndexedDB `nyaachat_vars_global`    | 本模块防抖写入（500ms）+ pagehide 兜底 |
 *
 * ⚠️ 两个必须记住的既有陷阱：
 *  1. `Message.variables` 曾被 `src/lib/sessionStorage.ts` 的退休守门在每次写
 *     会话时剥离；本阶段（D3①）已只撤销 message 级那一半。
 *  2. `ChatInterface.tsx` 的自动保存是**逐字段重建** session 对象（不 spread
 *     `currentSession`）—— 所以 `ChatSession.variables` 必须在那边显式带上，
 *     否则第一次自动保存就丢。
 */
import type { ChatSession, Message } from "../../types";
import { getItem, setItem } from "../idbStorage";
import { getVariableAdapter } from "./adapter";
import type { VariableOption, VariableScope } from "./types";

/** 全局变量的 IndexedDB 键（沿用历史命名；它是 NyaaChat 自有数据，
 *  不属于被摘除的 ST 扩展兼容面，故**不**进 `idbStorage.MIGRATED_KEYS`
 *  ——那张表只服务于"一次性 localStorage→IDB 搬运"，本键直接写 IDB）。 */
export const GLOBAL_VARIABLES_KEY = "nyaachat_vars_global";

const GLOBAL_PERSIST_DEBOUNCE_MS = 500;

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 深拷贝：优先 `structuredClone`，回落 JSON 往返（值都是 JSON 数据）。 */
export function deepClone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value) as T;
    } catch {
      /* 含有不可克隆值时回落到 JSON */
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

const variableListeners = new Set<() => void>();

/** 订阅"任一作用域发生写入"。返回取消订阅函数。 */
export function subscribeVariablesInternal(listener: () => void): () => void {
  variableListeners.add(listener);
  return () => {
    variableListeners.delete(listener);
  };
}

function notifyVariableListeners(): void {
  // 逐个 try/catch：一个订阅者抛错不能拖垮其它订阅者（与 runtime 的通知器同一约定）。
  for (const listener of [...variableListeners]) {
    try {
      listener();
    } catch (err) {
      console.error("[variables] 订阅者抛错", err);
    }
  }
}

/**
 * 由**宿主适配器**在「非变量层写入」改变量时手动广播一次。
 *
 * 为什么需要它：脚本侧（典型是 MVU）大量用 `setChatMessages([{message_id, swipes_data}])`
 * 直接写楼层的 `variables`（那才是 MVU 的变量权威形态），这条路径走的是
 * `VariableAdapter.patchMessages`，**不经过** `writeScopeData` ⇒ 不会 notify ⇒ 前端卡
 * （状态栏）永远收不到重绘信号。用户症状："对话让 MVU 变量更新了，但更新的数值未进入状态栏"。
 * 见 `src/components/ChatInterface.tsx` 里三处适配器实现（patchMessages / patchSession / commitSession）。
 */
export function notifyVariablesChanged(): void {
  notifyVariableListeners();
}

// ---------------------------------------------------------------------------
// global 作用域
// ---------------------------------------------------------------------------

let globalCache: Record<string, unknown> = {};
let globalHydrated = false;
let globalWriteTimer: ReturnType<typeof setTimeout> | null = null;
let globalLifecycleBound = false;

/** 启动时把全局变量读进内存缓存（由 `src/main.tsx` 的 bootstrap 调用）。 */
export async function hydrateVariables(): Promise<void> {
  try {
    const raw = await getItem(GLOBAL_VARIABLES_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    globalCache = isPlainObject(parsed) ? parsed : {};
  } catch (err) {
    console.error("[variables] 读取全局变量失败，按空对象处理", err);
    globalCache = {};
  }
  globalHydrated = true;
  notifyVariableListeners();
}

/** 同步落盘（测试与 pagehide 兜底用）。 */
export async function flushGlobalVariables(): Promise<void> {
  if (globalWriteTimer) {
    clearTimeout(globalWriteTimer);
    globalWriteTimer = null;
  }
  try {
    await setItem(GLOBAL_VARIABLES_KEY, JSON.stringify(globalCache));
  } catch (err) {
    console.error("[variables] 全局变量持久化失败", err);
  }
}

function scheduleGlobalPersist(): void {
  if (!globalLifecycleBound && typeof window !== "undefined") {
    globalLifecycleBound = true;
    // 防抖窗口内用户直接关页面 ⇒ 最后一次写入丢失。pagehide 兜底同步落盘。
    window.addEventListener("pagehide", () => {
      void flushGlobalVariables();
    });
  }
  if (globalWriteTimer) clearTimeout(globalWriteTimer);
  globalWriteTimer = setTimeout(() => {
    globalWriteTimer = null;
    void flushGlobalVariables();
  }, GLOBAL_PERSIST_DEBOUNCE_MS);
}

export function readGlobalData(): Record<string, unknown> {
  return deepClone(globalCache);
}

export function writeGlobalData(next: Record<string, unknown>): void {
  if (!isPlainObject(next)) {
    throw new TypeError("[variables] global scope value must be a plain object");
  }
  globalCache = deepClone(next);
  scheduleGlobalPersist();
  notifyVariableListeners();
}

/** 仅供测试/探针：重置全局缓存与订阅者。 */
export function resetVariablesForTests(): void {
  variableListeners.clear();
  globalCache = {};
  globalHydrated = false;
  if (globalWriteTimer) {
    clearTimeout(globalWriteTimer);
    globalWriteTimer = null;
  }
}

export function isGlobalHydrated(): boolean {
  return globalHydrated;
}

// ---------------------------------------------------------------------------
// 会话与楼层的定位
// ---------------------------------------------------------------------------

function currentSession(): ChatSession | null {
  const adapter = getVariableAdapter();
  if (!adapter) return null;
  const id = adapter.getCurrentSessionId();
  if (!id) return null;
  return adapter.getSession(id);
}

function messageHasVariables(message: Message | undefined): boolean {
  const slot = message?.variables?.[0];
  return isPlainObject(slot) && Object.keys(slot).length > 0;
}

/**
 * 把 `option.messageId` 解析成楼层下标。
 *
 *  · `number`：负数从末尾计；越界**抛错**（对齐酒馆助手语义，M2）。
 *  · `"latest"`（缺省）：从末尾往前找第一个"已有变量"的楼层；
 *    一个都没有时 —— 读返回 `null`（= 空对象），写回落到最后一条楼层。
 */
function resolveMessageIndex(
  session: ChatSession,
  messageId: number | "latest" | undefined,
  forWrite: boolean,
): number | null {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  const mode = messageId === undefined ? "latest" : messageId;

  if (typeof mode === "number") {
    const real = mode < 0 ? messages.length + mode : mode;
    if (!Number.isInteger(mode) || real < 0 || real >= messages.length) {
      throw new Error(
        `[variables] message scope: messageId ${mode} out of range (session has ${messages.length} messages)`,
      );
    }
    return real;
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    if (messageHasVariables(messages[i])) return i;
  }
  if (!forWrite) return null;
  return messages.length > 0 ? messages.length - 1 : null;
}

// ---------------------------------------------------------------------------
// 统一读 / 写入口（api.ts 只用这两个）
// ---------------------------------------------------------------------------

/** 读取某作用域的**深拷贝**值；读不到时返回 `{}`。 */
export function readScopeData(
  scope: VariableScope,
  option?: VariableOption,
): Record<string, unknown> {
  if (scope === "global") return readGlobalData();

  const session = currentSession();
  if (!session) return {};

  if (scope === "chat") {
    return isPlainObject(session.variables) ? deepClone(session.variables) : {};
  }

  const index = resolveMessageIndex(session, option?.messageId, false);
  if (index === null) return {};
  const slot = session.messages[index]?.variables?.[0];
  return isPlainObject(slot) ? deepClone(slot) : {};
}

/** 写入某作用域（整体替换）。返回是否真的写成功。 */
export function writeScopeData(
  scope: VariableScope,
  next: Record<string, unknown>,
  option?: VariableOption,
): boolean {
  // 临时诊断（真机排查"变量写进去了没有/写到哪个会话"）：环形记录，由
  // `__nyaScriptRunnerDiag()` 的 `varTrace` 打印。定位到根因后整块删除。
  const traceWrite = (entry: Record<string, unknown>) => {
    try {
      if (typeof window === "undefined") return;
      const w = window as unknown as { __nyaVarTrace?: unknown[] };
      w.__nyaVarTrace = (w.__nyaVarTrace || []).concat([{ t: Date.now(), ...entry }]).slice(-60);
    } catch {
      /* 诊断失败不影响主流程 */
    }
  };

  if (!isPlainObject(next)) {
    throw new TypeError(
      `[variables] ${scope} scope value must be a plain object (got ${Array.isArray(next) ? "array" : typeof next})`,
    );
  }

  if (scope === "global") {
    writeGlobalData(next);
    return true;
  }

  const adapter = getVariableAdapter();
  const session = currentSession();
  if (!adapter || !session) {
    // 诊断要能区分四种"未就绪"（真机排查用；v11-1542 只打一句，无法定位）：
    //   adapter=null → 变量层适配器还没注册（ChatInterface 未挂载）
    //   sessionId=null → 宿主没有可用的会话 id（例如"只有开场白、还没落盘"的草稿态）
    //   session=null → 有 id 但宿主查不到该会话
    let sessionId: string | null = null;
    try {
      sessionId = adapter?.getCurrentSessionId() ?? null;
    } catch {
      sessionId = null;
    }
    console.warn(
      `[variables] 写入 ${scope} 作用域失败：当前没有打开的会话` +
        `（adapter=${adapter ? "ok" : "null"}, sessionId=${sessionId ?? "null"}, session=${session ? "ok" : "null"}）`,
    );
    return false;
  }

  if (scope === "chat") {
    // 首选意图补丁路径：只交"chat 作用域变量"，绝不把（可能过期的）整会话快照交给宿主 ——
    // 用快照当权威会把同一 tick 里刚落地的楼层变量覆盖掉（v12-1625 真机实证）。
    if (typeof adapter.patchSession === "function") {
      adapter.patchSession({ variables: deepClone(next) });
    } else {
      adapter.commitSession({ ...session, variables: deepClone(next) });
    }
    traceWrite({ k: "write", scope: "chat", sid: session.id, liveLen: session.messages.length, keys: Object.keys(next).length });
    notifyVariableListeners();
    return true;
  }

  const index = resolveMessageIndex(session, option?.messageId, true);
  if (index === null) {
    console.warn("[variables] 写入 message 作用域失败：会话里没有消息");
    return false;
  }

  const target = session.messages[index];
  const cloned = deepClone(next);
  if (typeof adapter.patchMessages === "function") {
    adapter.patchMessages([{ id: target.id, variables: [cloned] }]);
  } else {
    const messages = session.messages.slice();
    messages[index] = { ...messages[index], variables: [cloned] };
    adapter.commitSession({ ...session, messages });
  }
  traceWrite({
    k: "write",
    scope: "message",
    mid: option?.messageId ?? "latest",
    idx: index,
    msgId: target.id,
    sid: session.id,
    liveLen: session.messages.length,
    keys: Object.keys(next).length,
  });
  notifyVariableListeners();
  return true;
}
