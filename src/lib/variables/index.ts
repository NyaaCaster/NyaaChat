/**
 * 变量层 barrel（SSOT §2.2）。
 *
 * ⚠️ 本模块是**宿主 core**：`plugins/**` **不得**直接 import 它（会构成模块环，
 * 见 `src/plugins/hostContext.ts` 头部的说明）。插件侧只能经叶子
 * `src/plugins/scriptHost.ts` 暴露的 `ScriptHostVariableApi` 使用这些能力。
 */
export {
  deleteVariable,
  getVariableAtPath,
  getVariables,
  hasVariable,
  insertVariables,
  replaceVariables,
  setVariableAtPath,
  subscribeVariables,
  updateVariablesWith,
} from "./api";
export type { VariableListener } from "./api";
export { getVariableAdapter, setVariableAdapter } from "./adapter";
export { hasVariableMacro, substituteVariableMacros } from "./macros";
export {
  GLOBAL_VARIABLES_KEY,
  flushGlobalVariables,
  hydrateVariables,
  isGlobalHydrated,
  readGlobalData,
  resetVariablesForTests,
  writeGlobalData,
} from "./scopes";
export type {
  MessagePatch,
  PathSegment,
  VariableAdapter,
  VariableOption,
  VariableScope,
} from "./types";
export { toYaml } from "./yamlOut";
