/**
 * 变量层类型（SSOT §2.2）。
 *
 * 本阶段（插件系统 V1 第二阶段 · D2 方案 A）只落三个作用域：
 *   · `message` —— MVU 的 Model，挂在 `Message.variables[0]`（恒 1 槽，D4）
 *   · `chat`    —— 会话级变量，挂在 `ChatSession.variables`
 *   · `global`  —— 全局变量，IndexedDB 键 `nyaachat_vars_global`
 *
 * character / preset / script / extension 四个作用域**不在本阶段范围**（NG8），
 * 但作用域表（`scopes.ts`）是表驱动的，将来加一项即可（D2：按 B 的第一阶段组织）。
 */
import type { ChatSession } from "../../types";

export type VariableScope = "message" | "chat" | "global";

/** 读/写定位参数。`messageId`：
 *   · `number`  —— 楼层下标；负数从末尾计（`-1` = 最后一条）
 *   · `"latest"` —— 从末尾往前找**第一个已有变量的楼层**（对齐酒馆助手
 *     `macro_like.ts` 的 message 分支语义）；写回时若一个都没有，则落在最后一条。
 *  缺省 = `"latest"`。 */
export interface VariableOption {
  messageId?: number | "latest";
}

/** 一条消息的**意图补丁**：只表达"要改哪条消息的什么字段"，不携带整份会话快照。
 *
 *  为什么需要它（真机 v12-1625 实证）：`commitSession` 交回的是**整份会话**，而这份快照
 *  往往比宿主的 live state 旧（React 的 `setMessages` 还没渲染）。宿主按 id 合并时若把
 *  快照当权威，"快照里没有 variables"就会被当成"要清空 variables"——MVU 的 initvar 刚把
 *  变量写到开场白楼层，同一个 tick 里紧跟的 chat 作用域写入就把它覆盖成 undefined，
 *  于是 `withVariables` 恒为 0、每轮回复都没有状态栏。
 *  补丁路径只应用**显式列出的字段**，因此不受快照新旧影响。 */
export interface MessagePatch {
  /** 目标消息 id（宿主按 id 应用；找不到就忽略）。 */
  id: string;
  /** 要写入的正文（省略 = 不动正文）。 */
  content?: string;
  /** 要写入的楼层变量（省略 = 不动变量；显式给 `[]`/`undefined` 才是清空）。 */
  variables?: unknown;
}

/** 宿主适配器——变量层**不做持久化**，全部交回宿主（SSOT §2.2）。
 *
 *  为什么是注入而不是直接 import 会话存储：变量层要能被"插件门面/单测"在
 *  没有 React 的环境下驱动；同时写入必须走宿主既有的 setState + 自动保存链路，
 *  否则变量改完不会落盘。 */
export interface VariableAdapter {
  /** 当前活动会话 id（`"latest"` 定位 message 作用域时的默认会话）。 */
  getCurrentSessionId(): string | null;
  /** 按 id 取会话（宿主应优先返回内存中的 live 会话）。 */
  getSession(sessionId: string): ChatSession | null;
  /** 把改好的会话交回宿主（宿主负责 setState + 既有自动保存）。
   *  必须收到**新对象**（不可变更新），否则 React 不会重渲、也不触发自动保存。 */
  commitSession(session: ChatSession): void;
  /** 逐条**意图补丁**（首选路径）。宿主只应用补丁里显式出现的字段，因此不会被
   *  过期快照回滚；未实现时调用方退回 `commitSession`。 */
  patchMessages?(patches: MessagePatch[]): void;
  /** 只改会话级字段（chat 作用域变量）。 */
  patchSession?(fields: { variables?: Record<string, unknown> }): void;
}

/** 路径语义（对齐酒馆助手 / lodash 风格）：
 *   · 分隔符 `/` 或 `.`（`/stat_data/世界/当前日期`、`stat_data.世界.当前日期`）
 *   · 数组下标 `[0]`、`[12]`；`[-]`（或 `.-`）表示**追加**
 *   · 空串 / `"/"` 表示"整个作用域对象" */
export interface PathSegment {
  /** 原始文本（对象容器上按字符串键用）。 */
  raw: string;
  /** 纯数字段在**数组**容器上按下标用；非数字为 null。 */
  index: number | null;
  /** `-` 追加段（只在数组容器上合法）。 */
  append: boolean;
}

/** 变量变更订阅者（任一作用域变更即回调）。 */
export type VariableListener = () => void;
