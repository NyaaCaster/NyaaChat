/**
 * 插件运行时（SSOT §2.4）—— 启用状态、配置快照读写、事件总线、setup 生命周期。
 *
 * **模块级快照范式**：与既有 `setChatAccessor`（src/lib/chatPipeline.ts）/
 * `setDefaultEnvProvider`（src/lib/regex/macros.ts，由 MessageItem.tsx 注册）一致
 * —— 宿主注册写入器，渲染期同步读快照。React 侧通过
 * `useSyncExternalStore(subscribePluginRuntime, getPluginRuntimeSnapshot)` 订阅，
 * 因此配置变更后消息装饰会自动重渲染，无需手动传参。
 *
 * **配置写入单一路径**：`App.tsx` 注册 writer（内部走既有 `handleSaveSettings()`），
 * 因此插件配置变更必然落盘（`nyaachat_settings`）。`updateConfig` 把 patch 深合并
 * 进当前 config 后整体交给 writer，插件不得只改内存快照。
 *
 * **宿主上下文已拆到叶子模块 `./hostContext`**（t12 断环）：本文件是"下游含插件注册表"
 * 的模块，插件实现直接引用它会构成模块环 ⇒ 插件侧只能引 `./hostContext`。本文件仍
 * re-export 旧名（`setPluginHostContext` / `getPluginHostContext`）以保持既有用法不变。
 */
import type {
  NyaaPlugin,
  PluginContext,
  PluginEventName,
  PluginStateMap,
} from "./types";
import { getPluginById, getRegisteredPlugins } from "./registry";
import { deepMergeConfig, mergePluginDefaults, normalizePluginStates } from "./normalize";
import { callPluginBackend as callPluginBackendRequest } from "./backend";

type ConfigWriter = (pluginId: string, patch: Record<string, unknown>) => void;
type PluginEventHandler = (payload?: unknown) => void;

/** 当前启用状态 + 配置快照；只在 `syncPluginRuntime` 里被替换（引用稳定，供
 *  `useSyncExternalStore` 使用）。 */
let snapshot: PluginStateMap = {};
let configWriter: ConfigWriter | null = null;

const runtimeListeners = new Set<() => void>();
/** pluginId → setup 返回的 disposer（停用时调用）。 */
const disposers = new Map<string, () => void>();
/** pluginId → 该插件注册的全部事件取消订阅函数（停用时兜底清理）。 */
const pluginSubscriptions = new Map<string, Set<() => void>>();
/** 事件名 → 处理器集合。 */
const eventHandlers = new Map<PluginEventName, Set<PluginEventHandler>>();

function notifyRuntimeListeners(): void {
  // 逐个 try/catch：一个订阅者抛错不能拖垮其它订阅者。
  for (const listener of [...runtimeListeners]) {
    try {
      listener();
    } catch (err) {
      console.error("[plugins] 运行时订阅者抛错", err);
    }
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (!a || !b || typeof a !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/** 内容相等即视为无变化 —— 避免一次无关的设置保存触发全屏消息重渲染。 */
function pluginStateMapsEqual(a: PluginStateMap, b: PluginStateMap): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => key in b && deepEqual(a[key], b[key]));
}

/** 由 `App.tsx` 注册：`(pluginId, patch) => void`，内部走 handleSaveSettings。 */
export function setPluginConfigWriter(fn: ConfigWriter): void {
  configWriter = fn;
}

export function getPluginRuntimeSnapshot(): PluginStateMap {
  return snapshot;
}

export function subscribePluginRuntime(listener: () => void): () => void {
  runtimeListeners.add(listener);
  return () => {
    runtimeListeners.delete(listener);
  };
}

/** 当前插件的配置只读快照（已含 defaults 深合并；未启用时也能读到 defaults）。 */
export function getPluginConfig(pluginId: string): Record<string, unknown> {
  const plugin = getPluginById(pluginId);
  const config = snapshot[pluginId]?.config ?? {};
  if (!plugin) return { ...config };
  return mergePluginDefaults(plugin, config);
}

/**
 * 写入插件配置：深合并进当前 config 后交给宿主 writer（必然落盘）。
 *
 * **边界：`enabled` 由 UI/宿主拥有，`config` 由插件拥有。**
 * `enabled` 的权威位置是 `AppState.plugins[id].enabled`，只由扩展 modal 的启用开关
 * 写、由 App 的 writer 负责保持；插件配置通道（本函数）**不接受** `enabled`。
 *
 * 为什么必须显式剥离（ui 实测复现的真实缺陷）：若不剥离，`{ enabled: true }` 会被
 * 深合并进 **config**，而 App writer 又把 `enabled` 强制回写为原值 ⇒ 存档落成
 * `{ enabled: false, config: { enabled: true } }`：开关"视觉上点了"但实际没生效，
 * 且 config 里凭空多出一个从未声明过的 `enabled` 键（还会被归一化/导出一路带下去）。
 * 这里剥离并告警；若 patch 剥离后为空则直接返回，避免一次无意义的设置落盘。
 * 签名不变，属防御性修复，不触发 SSOT §10.1 的契约变更流程。
 */
export function updatePluginConfig(pluginId: string, patch: Record<string, unknown>): void {
  if (!getPluginById(pluginId)) {
    console.error(`[plugins] updateConfig 被未知插件调用：${pluginId}`);
    return;
  }
  if (!configWriter) {
    console.error(
      `[plugins] 配置 writer 尚未注册（App 未挂载？），插件 "${pluginId}" 的配置写入被丢弃`,
    );
    return;
  }

  let configPatch = patch;
  if (Object.prototype.hasOwnProperty.call(patch, "enabled")) {
    const { enabled: _enabled, ...rest } = patch;
    console.warn(
      `[plugins] 插件 "${pluginId}" 试图经配置通道写入 enabled=${String(_enabled)}：` +
        "enabled 属于宿主状态（AppState.plugins[id].enabled），由扩展 UI 的启用开关写入，" +
        "该键已被剥离、不会进入 config。",
    );
    if (Object.keys(rest).length === 0) return;
    configPatch = rest;
  }

  const next = deepMergeConfig(getPluginConfig(pluginId), configPatch);
  configWriter(pluginId, next);
}

export function emitPluginEvent(name: PluginEventName, payload?: unknown): void {
  const handlers = eventHandlers.get(name);
  if (!handlers || handlers.size === 0) return;
  for (const handler of [...handlers]) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[plugins] 事件 "${name}" 的处理器抛错`, err);
    }
  }
}

export function callPluginBackend<T = unknown>(
  pluginId: string,
  capability: string,
  payload?: unknown,
): Promise<T> {
  return callPluginBackendRequest<T>(pluginId, capability, payload);
}

// ─────────────────────────────────────────────────────────────────────────────
// 宿主上下文 —— **已迁出到叶子模块 `./hostContext`**（t12 断环）
//
// 这段状态（identity + 当前会话消息）原先就放在本文件里，代价是一个模块环：
//   plugins/quote-tts/QuoteTtsSettings → src/plugins/runtime → ./registry
//   → src/plugins/registry → ../../plugins/registry → plugin →（回到起点）
// 环使"直接 import 插件模块"时注册表出现 `undefined` 槽位、插件静默消失。
// 宿主上下文与插件注册表毫无关系，因此拆到只依赖 `../types` 的叶子模块 —— 插件树里
// 再没有任何通向 `./registry` 的静态边，环从根上消失。
//
// 下面**原样 re-export**（含 `setPluginHostContext` / `getPluginHostContext` 两个旧名），
// 因此 `App.tsx` 的推送端与既有用法一行不改。新代码请直接从 `./hostContext` 导入。
//
// ⚠️ 本文件是**下游含插件注册表**的模块（`import ... from "./registry"`），插件实现
// 引用它会立刻重建环；插件侧只能用 `./hostContext` 这个叶子。
// ─────────────────────────────────────────────────────────────────────────────

export {
  getHostContext,
  setHostContext,
  subscribeHostContext,
  // 兼容旧名（拆分前这两个函数就定义在本文件里）。
  getHostContext as getPluginHostContext,
  setHostContext as setPluginHostContext,
} from "./hostContext";
export type { PluginHostContext, PluginHostIdentity } from "./hostContext";

function subscribePluginEvent(
  pluginId: string,
  event: PluginEventName,
  handler: PluginEventHandler,
): () => void {
  let handlers = eventHandlers.get(event);
  if (!handlers) {
    handlers = new Set();
    eventHandlers.set(event, handlers);
  }
  handlers.add(handler);
  const handlerSet = handlers;

  let active = true;
  const unsubscribe = () => {
    if (!active) return;
    active = false;
    handlerSet.delete(handler);
    if (handlerSet.size === 0) eventHandlers.delete(event);
    pluginSubscriptions.get(pluginId)?.delete(unsubscribe);
  };

  let owned = pluginSubscriptions.get(pluginId);
  if (!owned) {
    owned = new Set();
    pluginSubscriptions.set(pluginId, owned);
  }
  owned.add(unsubscribe);

  return unsubscribe;
}

function createPluginContext(plugin: NyaaPlugin): PluginContext {
  const pluginId = plugin.meta.id;
  return {
    meta: plugin.meta,
    getConfig: () => getPluginConfig(pluginId),
    updateConfig: (patch) => updatePluginConfig(pluginId, patch),
    callBackend: <T = unknown>(capability: string, payload?: unknown) =>
      callPluginBackend<T>(pluginId, capability, payload),
    on: (event, handler) => subscribePluginEvent(pluginId, event, handler),
  };
}

function startPlugin(plugin: NyaaPlugin): void {
  const pluginId = plugin.meta.id;
  if (typeof plugin.setup !== "function") return;
  try {
    const disposer = plugin.setup(createPluginContext(plugin));
    if (typeof disposer === "function") disposers.set(pluginId, disposer);
    else disposers.delete(pluginId);
  } catch (err) {
    console.error(`[plugins] 插件 "${pluginId}" 的 setup 抛错（其余插件不受影响）`, err);
  }
}

function stopPlugin(pluginId: string): void {
  // 先清事件订阅（即使插件忘了调用 on() 返回的取消函数，也不会留下野处理器），
  // 再调用 setup 返回的 disposer。
  const owned = pluginSubscriptions.get(pluginId);
  if (owned) {
    pluginSubscriptions.delete(pluginId);
    for (const unsubscribe of [...owned]) {
      try {
        unsubscribe();
      } catch (err) {
        console.error(`[plugins] 插件 "${pluginId}" 的事件退订抛错`, err);
      }
    }
  }

  const disposer = disposers.get(pluginId);
  if (!disposer) return;
  disposers.delete(pluginId);
  try {
    disposer();
  } catch (err) {
    console.error(`[plugins] 插件 "${pluginId}" 的 disposer 抛错`, err);
  }
}

/**
 * 由 `App.tsx` 的 effect 调用（依赖 `settings.plugins`）：收敛入参 → 与上一份
 * 快照对比 → 应用启用/停用与 setup 生命周期 → 通知订阅者。
 */
export function syncPluginRuntime(next: PluginStateMap): void {
  const normalized = normalizePluginStates(next);
  if (pluginStateMapsEqual(snapshot, normalized)) return;

  const previous = snapshot;
  snapshot = normalized;

  for (const plugin of getRegisteredPlugins()) {
    const pluginId = plugin?.meta?.id;
    if (!pluginId) continue;
    const wasEnabled = previous[pluginId]?.enabled === true;
    const isEnabled = normalized[pluginId]?.enabled === true;
    if (wasEnabled === isEnabled) continue;
    if (isEnabled) startPlugin(plugin);
    else stopPlugin(pluginId);
  }

  notifyRuntimeListeners();
}

/** 便于单测/探针：清空运行时状态（生产代码不调用）。 */
export function resetPluginRuntimeForTests(): void {
  const pluginIds = new Set([...disposers.keys(), ...pluginSubscriptions.keys()]);
  for (const pluginId of pluginIds) stopPlugin(pluginId);
  eventHandlers.clear();
  snapshot = {};
  configWriter = null;
  notifyRuntimeListeners();
}
