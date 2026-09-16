/**
 * NyaaChat 插件系统 V1 —— 宿主侧对外出口（SSOT §2.1 的 `src/plugins/index.ts`）。
 *
 * 边界约定：
 *  · 这里的导出面向**宿主代码与插件作者**；插件实现只允许依赖
 *    `src/plugins/types`（契约）+ `src/plugins/hostContext`（宿主上下文叶子）
 *    + `src/plugins/runtime` 的读写函数。⚠️ 插件引 `runtime` / `backend` / 本文件
 *    都会构成模块环（见 `hostContext.ts` 顶部说明，t12）；插件需要什么，要么走
 *    装饰/面板上下文注入，要么走叶子模块。
 *  · 装饰管线实现在 `src/plugins/decorators.ts`（**逐块**方案，见 SSOT §2.6；
 *    2026-09-15 由 captain 落地，取代初稿的 rehype 全局管线）。
 */
export * from "./types";

export {
  PLUGIN_BACKEND_PATH_PREFIX,
  PLUGIN_ID_PATTERN,
  getPluginById,
  getRegisteredPlugins,
  validatePlugins,
} from "./registry";
export type { PluginRegistryIssue, PluginRegistryIssueKind } from "./registry";

export {
  callPluginBackend,
  emitPluginEvent,
  getPluginConfig,
  getPluginRuntimeSnapshot,
  resetPluginRuntimeForTests,
  setPluginConfigWriter,
  subscribePluginRuntime,
  syncPluginRuntime,
  updatePluginConfig,
  // 拆分前的旧名由 runtime 以别名 re-export（同一绑定，见 runtime.ts 的 hostContext 段）。
  getPluginHostContext,
  setPluginHostContext,
} from "./runtime";

// 宿主上下文：定义在叶子模块 `./hostContext`（t12 从 runtime 拆出，断模块环）。
// 新名从叶子直接导出；旧名（getPluginHostContext / setPluginHostContext）仍在上面
// 由 runtime 提供，两者是同一绑定，插件侧应直接用这里的新名 + 叶子模块本身。
export { getHostContext, setHostContext, subscribeHostContext } from "./hostContext";
export type { PluginHostContext, PluginHostIdentity } from "./hostContext";

export { deepMergeConfig, mergePluginDefaults, normalizePluginStates } from "./normalize";

export { getPluginBackendDeclaration } from "./backend";

export { renderPluginDecorations } from "./decorators";
export type { DecorationRenderInput } from "./decorators";
