/**
 * 脚本载体抽象（SSOT §2.4，D13②）。
 *
 * **为什么要抽象**：NyaaChat 现在**没有下发 CSP**，`srcdoc` iframe 里的内联脚本能跑；
 * 但配置意图是 `script-src 'self'`，一旦真生效，srcdoc 内联脚本会被 `script-src-elem`
 * 拦掉（S5 实测，加 `sandbox` 也无效）。届时只需新增一个
 * `resource-document` 实现（指向真实同源文档、自带放宽的响应头），
 * 并改本文件的 `createScriptHost()` 选择器 —— **其余代码一行不动**。
 */
import type { ScriptHostApi } from "../../../src/plugins/scriptHost";
import type { ScriptRecord } from "../../../src/types";

export interface ScriptHostMountArgs {
  /** 隐藏 iframe 挂到哪里。 */
  container: HTMLElement;
  /** 已按脚本库 UI 顺序排好、仅 `enabled` 的脚本。 */
  scripts: ScriptRecord[];
  api: ScriptHostApi;
  /** 是否在挂载时就执行（`runOnLoad`）。false ⇒ 只装配不跑。 */
  runOnLoad: boolean;
  /** 单个脚本的事件/错误回调（宿主用于日志与 UI 展示）。 */
  onScriptResult?: (scriptId: string, ok: boolean, error?: string) => void;
}

export interface ScriptHostHandle {
  /** 把宿主事件派发进 iframe（`name` 是 `tavern_events` 的**值**）。 */
  emit(tavernEventValue: string, payload?: unknown): void;
  /** 拆掉 iframe、解绑监听、清理桥（插件停用时必须调用）。 */
  dispose(): void;
  /** 探针/日志：iframe 是否存活。 */
  isAlive(): boolean;
}

// 说明：**没有** `reload`。重新加载 = 插件层 `dispose()` + 重新 `mount()` ——
// 载体只负责"一次装配"，把重入语义留给调用方，避免句柄自我替换的循环依赖。

export interface ScriptHost {
  readonly kind: "srcdoc" | "resource-document";
  mount(args: ScriptHostMountArgs): Promise<ScriptHostHandle>;
}

import { createSrcdocScriptHost } from "./srcdocHost";

/** 当前实现选择器。将来换载体只改这里（见文件头）。 */
export function createScriptHost(): ScriptHost {
  return createSrcdocScriptHost();
}
