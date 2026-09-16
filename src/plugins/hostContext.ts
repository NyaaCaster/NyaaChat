/**
 * 宿主上下文（SSOT §2.4 增补）—— **叶子模块**，只依赖 `../types`（type-only）。
 *
 * ## 为什么需要宿主上下文
 *
 * 插件设置面板（如 quote-tts 的「角色 → 音色」列表）要枚举"参与者"：当前用户角色名、
 * 当前角色名、以及当前会话消息里的 `人名:` 前缀。但已冻结的
 * `PluginSettingsPanelProps` 契约（`types.ts`，SSOT §2.2）只有
 * `{ pluginId, config, updateConfig, callBackend }`，不含会话数据；而 SSOT §10.1 规定
 * 契约签名变更必须先改 SSOT 并经用户确认 —— 不值得为一个取值口径再走一轮。
 *
 * 因此由宿主提供一个**只读快照出口**：`App.tsx` 的 effect 推送（`setHostContext`），
 * 插件侧读取（`getHostContext` / `subscribeHostContext`）。不改动 `types.ts` 的任何既有
 * 签名，纯增量。
 *
 * ## 为什么它必须是**叶子**（t12 断环，改这里前务必读懂）
 *
 * 这段状态原先放在 `./runtime.ts` 里，代价是一个**模块环**：
 *
 * ```
 * plugins/registry → quote-tts/plugin → quote-tts/QuoteTtsSettings → src/plugins/runtime
 *                  → src/plugins/registry → ../../plugins/registry （回到起点）
 * ```
 *
 * 环的后果：以**插件模块本身**为图入口（不经 `src/plugins/registry`，例如验证脚本、
 * 工具、未来的另一个入口）时，`plugins/registry` 会在插件模块尚未求值完就读它的
 * `default`，注册表里于是留下一个 `undefined` 槽位 —— 插件静默消失（列表不显示、
 * backend 调用被拒、装饰被跳过），只在加载期留一条
 * `[plugins] meta: 插件对象或其 meta 不是对象` 的 console.error。生产入口恰好在环的
 * 另一端，所以线上未暴露，极难排查。
 *
 * 断环方式：宿主上下文与「插件注册表」毫无关系，把它挪进只依赖类型的叶子模块后，
 * 插件树里再没有任何通向 `./registry` 的静态边，环从根上消失。
 *
 * ⚠️ **不要在本文件里 import `./registry` / `./runtime` / `./backend` / `./normalize` /
 * `../../plugins/registry`** —— 任何一条都会立刻重建上述环。需要新的宿主数据时，请照
 * 这个模式再加一个只依赖 `../types` 的叶子，而不是去 import runtime。
 *
 * ## 通知通道的语义（t12 拆分带来的唯一行为变化，已核对无功能影响）
 *
 * 拆分前 `setPluginHostContext` 调的是 `runtime` 的通知器，所以**订阅运行时快照**的组件
 * （`MessageItem`、`ExtensionsModal`）也会因宿主上下文变化而重渲染；现在只通知本文件的
 * 订阅者。核对结论（t12 报告）：
 *   · `getHostContext` / `getPluginHostContext` 的读取方**只有**
 *     `plugins/quote-tts/QuoteTtsSettings.tsx`（已改为订阅本模块）；
 *   · `MessageItem` / `ExtensionsModal` 均**不读**宿主上下文（它们只读运行时快照），
 *     因此少一次"由宿主上下文触发的重渲染"不改变它们的渲染结果 ⇒ 无功能影响。
 */
import type { Message } from "../types";

export interface PluginHostIdentity {
  /** 当前用户角色名；`userRoles` 里找不到当前角色（或名字为空）时取界面**展示
   *  兜底** "user"。与 `MessageItem` 的 `resolvedUser`（消息行显示的用户名，
   *  也是装饰上下文 `MessageDecorationContext.senderName` 的用户侧取值）同口径。 */
  user: string;
  /** 当前角色名；无当前角色（或名字为空）时取界面**展示兜底** "AI助手"。与
   *  `MessageItem` 的 `resolvedChar`（`senderName` 的助手侧取值）同口径 ——
   *  插件设置面板按这个"人名"建音色映射，装饰侧用同一个值查表，两侧必须一致。
   *  ⚠️ 刻意**不**等同于宏语义：`chatPipeline.getMacroIdentity()` 拿的是原始
   *  props，无角色时 char 为空串（宏解析不能带展示兜底）。 */
  char: string;
}

export interface PluginHostContext {
  identity: PluginHostIdentity;
  /** 当前会话消息数组（引用直传，不做深拷贝；只读约定）。 */
  sessionMessages: Message[];
}

const EMPTY_HOST_CONTEXT: PluginHostContext = {
  identity: { user: "", char: "" },
  sessionMessages: [],
};

let hostContext: PluginHostContext = EMPTY_HOST_CONTEXT;

const hostContextListeners = new Set<() => void>();

function notifyHostContextListeners(): void {
  // 逐个 try/catch：一个订阅者抛错不能拖垮其它订阅者（与 runtime 的通知器同一约定）。
  for (const listener of [...hostContextListeners]) {
    try {
      listener();
    } catch (err) {
      console.error("[plugins] 宿主上下文订阅者抛错", err);
    }
  }
}

/** 订阅宿主上下文变更（React：`useSyncExternalStore(subscribeHostContext, getHostContext)`）。 */
export function subscribeHostContext(listener: () => void): () => void {
  hostContextListeners.add(listener);
  return () => {
    hostContextListeners.delete(listener);
  };
}

/** 由 `App.tsx` 的 effect 推送宿主上下文（identity + 当前会话消息）。 */
export function setHostContext(next: PluginHostContext): void {
  // 防御：App 侧很容易写成 `currentSession?.messages ?? []`，而 `?? []` 在无会话时
  // **每次渲染都产生新数组**。若按引用比较，就会每帧误判"变了"并通知全部订阅者。
  // 因此这里做两条收敛：
  //   · 非数组 ⇒ 回落空数组常量；
  //   · 两个都为空 ⇒ 视为未变（不比较引用）。
  const sessionMessages = Array.isArray(next?.sessionMessages)
    ? next.sessionMessages
    : EMPTY_HOST_CONTEXT.sessionMessages;
  const user = typeof next?.identity?.user === "string" ? next.identity.user : "";
  const char = typeof next?.identity?.char === "string" ? next.identity.char : "";

  const sameMessages =
    hostContext.sessionMessages === sessionMessages ||
    (hostContext.sessionMessages.length === 0 && sessionMessages.length === 0);

  if (
    hostContext.identity.user === user &&
    hostContext.identity.char === char &&
    sameMessages
  ) {
    return;
  }

  hostContext = { identity: { user, char }, sessionMessages };
  notifyHostContextListeners();
}

/** 宿主上下文只读快照（引用稳定，内容未变时不换引用，可直接喂 `useSyncExternalStore`）。 */
export function getHostContext(): PluginHostContext {
  return hostContext;
}

/** 便于单测/探针：清空宿主上下文订阅者与状态（生产代码不调用）。 */
export function resetHostContextForTests(): void {
  hostContextListeners.clear();
  hostContext = EMPTY_HOST_CONTEXT;
}
