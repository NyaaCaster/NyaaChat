/**
 * 变量层对外 API（SSOT §2.2 的 `api.ts`）。
 *
 * 语义对齐酒馆助手 / TavernHelper 的同名 API，但只保留 MVU 需要的子集：
 *  `getVariables` / `replaceVariables` / `updateVariablesWith` / `insertVariables`
 *  / `deleteVariable` / `hasVariable`。
 *
 * **读契约（重要）**：`getVariables` 返回**深拷贝**。改返回值不会影响存储，
 * 必须经 `replaceVariables` / `updateVariablesWith` 写回 —— 这与被摘除的旧兼容层
 * （`git show 6310735^:src/compat/variables.ts`）以及酒馆助手一致。
 */
import { deleteByPath, getByPath, parsePath, setByPath } from "./paths";
import {
  deepClone,
  isPlainObject,
  readScopeData,
  subscribeVariablesInternal,
  writeScopeData,
} from "./scopes";
import type { VariableListener, VariableOption, VariableScope } from "./types";

export { subscribeVariablesInternal as subscribeVariables };
export type { VariableListener };

function assertScope(scope: VariableScope): void {
  if (scope !== "message" && scope !== "chat" && scope !== "global") {
    throw new Error(
      `[variables] 未知作用域 "${String(scope)}"（本阶段只支持 message / chat / global）`,
    );
  }
}

/** 取某作用域的变量（深拷贝）。作用域为空时返回 `{}`。 */
export function getVariables(
  scope: VariableScope,
  option?: VariableOption,
): Record<string, unknown> {
  assertScope(scope);
  return readScopeData(scope, option);
}

/** 整体替换某作用域的变量。 */
export function replaceVariables(
  next: Record<string, unknown>,
  scope: VariableScope,
  option?: VariableOption,
): Record<string, unknown> {
  assertScope(scope);
  if (!isPlainObject(next)) {
    throw new TypeError(
      `[variables] replaceVariables(scope=${scope}) 需要普通对象，收到 ${
        Array.isArray(next) ? "array" : typeof next
      }`,
    );
  }
  const copy = deepClone(next);
  writeScopeData(scope, copy, option);
  return copy;
}

/**
 * 以回调修改变量：回调拿到当前值的**深拷贝**草稿。
 *  · 回调**返回值**为对象 ⇒ 用它作为新值；
 *  · 回调返回 `undefined` ⇒ 采用被原地修改的草稿（lodash `updateWith` 语义，
 *    酒馆助手的 `updateVariablesWith` 就是这样被脚本使用的）。
 */
export function updateVariablesWith(
  updater: (current: Record<string, unknown>) => Record<string, unknown> | void,
  scope: VariableScope,
  option?: VariableOption,
): Record<string, unknown> {
  assertScope(scope);
  if (typeof updater !== "function") {
    throw new TypeError("[variables] updateVariablesWith 需要函数");
  }
  const draft = getVariables(scope, option);
  const returned = updater(draft);
  const next = returned === undefined ? draft : returned;
  if (!isPlainObject(next)) {
    throw new TypeError(
      `[variables] updateVariablesWith(scope=${scope}) 的回调必须返回普通对象或 undefined`,
    );
  }
  return replaceVariables(next, scope, option);
}

/** 浅合并（顶层键覆盖）写入若干变量。 */
export function insertVariables(
  vars: Record<string, unknown>,
  scope: VariableScope,
  option?: VariableOption,
): Record<string, unknown> {
  assertScope(scope);
  if (!isPlainObject(vars)) {
    throw new TypeError("[variables] insertVariables 需要普通对象");
  }
  const current = getVariables(scope, option);
  return replaceVariables({ ...current, ...deepClone(vars) }, scope, option);
}

/** 按路径读取单个值；不存在返回 `undefined`。 */
export function getVariableAtPath(
  path: string,
  scope: VariableScope,
  option?: VariableOption,
): unknown {
  assertScope(scope);
  const segments = parsePath(path);
  if (segments.length === 0) return getVariables(scope, option);
  return getByPath(getVariables(scope, option), segments);
}

/** 按路径写入单个值（中间层不存在会自动创建）。 */
export function setVariableAtPath(
  path: string,
  value: unknown,
  scope: VariableScope,
  option?: VariableOption,
): Record<string, unknown> {
  assertScope(scope);
  const segments = parsePath(path);
  if (segments.length === 0) {
    return replaceVariables(deepClone(value) as Record<string, unknown>, scope, option);
  }
  const draft = getVariables(scope, option);
  setByPath(draft, segments, deepClone(value));
  return replaceVariables(draft, scope, option);
}

/** 按路径删除；删到了返回 `true`。 */
export function deleteVariable(
  path: string,
  scope: VariableScope,
  option?: VariableOption,
): boolean {
  assertScope(scope);
  const segments = parsePath(path);
  if (segments.length === 0) {
    // 空路径 = 清空整个作用域（酒馆助手用 deleteVariable 删单个键，这里给一个
    // 明确的语义而不是静默无操作）。
    writeScopeData(scope, {}, option);
    return true;
  }
  const draft = getVariables(scope, option);
  const removed = deleteByPath(draft, segments);
  if (removed) writeScopeData(scope, draft, option);
  return removed;
}

/** 路径是否存在（值可以是 `null` / `false` / `0`）。 */
export function hasVariable(
  path: string,
  scope: VariableScope,
  option?: VariableOption,
): boolean {
  assertScope(scope);
  const segments = parsePath(path);
  if (segments.length === 0) return Object.keys(getVariables(scope, option)).length > 0;
  return getByPath(getVariables(scope, option), segments) !== undefined;
}
