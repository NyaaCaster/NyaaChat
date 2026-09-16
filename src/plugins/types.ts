/**
 * NyaaChat 插件系统 V1 —— 契约类型（SSOT §2.2）。
 *
 * 本文件是**全部**对外契约的唯一定义处，逐字对应 `.docs/plugin-system/开发计划-SSOT.md`
 * §2.2。除 `normalize.ts` / `runtime.ts` / `registry.ts` / `backend.ts` 暴露的
 * 小函数外，插件系统的对外面就是这些类型。
 */
import type * as React from "react";
import type { Message } from "../types";

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
export type { PluginState, PluginStateMap } from "../types";

/** 消息文本装饰。
 *
 *  ⚠️ **区间空间**：宿主**逐块**调用装饰器（`p` / `li` / `blockquote` / `h1`~`h6` /
 *  `td`），`start` / `end` 是**当前块的纯文本**内的字符偏移 —— 不是"整条消息的渲染后
 *  纯文本"（那是 SSOT §2.6 初稿的 rehype 方案，2026-09-15 经用户复核改为逐块方案，
 *  两个偏移空间互不通用）。详见 SSOT §2.6。 */
export interface TextDecoration {
  start: number;
  end: number;
  /** 同一消息内唯一，作为 React key。 */
  key: string;
  /**
   * 渲染这个装饰节点。⚠️ **语义是「在片段旁边加东西」，不是「替换片段」** ——
   * 被标注的原文由宿主**始终原样输出**，本函数的返回值**追加在它之后**。
   * 因此 `render: ({ text }) => <Btn text={text} />` 的结果是 `原文` + `按钮`；
   * **不要**在这里重复输出 `text`，否则页面上会出现两份原文。
   * 抛错时宿主只保留正文并 `console.warn`，不拖垮整条消息。
   */
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
  /** 当前**块**的纯文本；返回的区间必须落在本字符串内。 */
  text: string,
  ctx: MessageDecorationContext,
) => TextDecoration[];

export type PluginBackendCaller = <T = unknown>(
  capability: string,
  payload?: unknown,
) => Promise<T>;

/** 插件可订阅的宿主事件（SSOT §2.7）。
 *
 *  前三个是 V1 首版就有的；后七个是 2026-09-16 第二阶段为 JS-Slash-Runner 增加的
 *  **纯增量**成员。脚本侧把它们映射成 `tavern_events` 常量（错拼名照抄上游）。 */
export type PluginEventName =
  | "message:received"
  | "session:changed"
  | "character:changed"
  | "message:sent"
  | "generation:started"
  | "generation:stopped"
  | "message:deleted"
  | "message:rendered"
  | "worldinfo:updated"
  | "completion:settings-ready";

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
