/**
 * AnswererFlagalac —— 流式输出自动同步（开发计划 §4.4；D-06 / D-09 / D-10 / D-11）。
 *
 * 选中某个绕过目标时，把**全局** `settings.isStreaming` 改写成该目标要求的状态，
 * 并在界面上告知用户。三条已拍板的规则：
 *
 * 1. **不记录原值**（D-09）：切回「无」时**不恢复**任何值 —— 流式开关保持上一个
 *    目标设定的状态，只清掉覆盖标志；
 * 2. **覆盖标志是单个布尔** `streamingOverridden`（D-10）：用户在目标激活期间手动
 *    改过流式开关后置真，此后当前目标不再自动改写；**每次目标切换都会清除它**，
 *    因此进入新目标必定拿到该目标要求的状态（A7）；
 * 3. **只改 `isStreaming` 这一项**（§4.4 规则 6 / A9）：其余设置逐字段原样透传。
 *
 * 本文件只做「策略计算 + 返回新对象」，不落盘、不依赖 React：写入由调用方
 * （BypassModal 的目标切换 / SettingsModal 的流式开关）经既有的 onSave 完成。
 *
 * ⚠️ 目标要求值取自 FlagalacTemplates.ts 的条目元数据（`requiresStreaming`），
 * 这里**不硬编码任何目标 id** —— 新增/下线目标只改那一个文件。
 */
import type { AppState } from "../types";
import { getFlagalacTarget, resolveFlagalacTarget } from "./FlagalacTemplates";

/**
 * 该目标要求的流式状态。
 * 「无」以及未声明 `requiresStreaming` 的目标（含未知/已下线的 id）返回
 * `undefined` = **不干预**：既不读也不写流式设置。
 */
export function requiredStreamingForTarget(targetId: string): boolean | undefined {
  const required = getFlagalacTarget(targetId)?.requiresStreaming;
  return typeof required === "boolean" ? required : undefined;
}

/**
 * 目标切换：**先清除** `streamingOverridden`，再按新目标的要求改写 `isStreaming`。
 *
 * - 目标要求 `undefined`（「无」/未知）⇒ 不碰 `isStreaming`（D-09：不恢复原值），
 *   只把 target 收敛为新值并清掉覆盖标志；
 * - 目标要求为布尔 ⇒ 无条件写入该值（覆盖标志已在本函数内清除，D-10 规则 2）；
 * - 结果与入参逐字段等价时返回**入参原值**（不制造无谓的新对象/重渲染）。
 *
 * 返回的是**新对象**，入参不被改写。
 */
export function syncStreamingOnTargetChange(
  settings: AppState,
  nextTarget: string,
): AppState {
  const target = resolveFlagalacTarget(nextTarget);
  const required = requiredStreamingForTarget(target);
  const current = settings.bypass.answererFlagalac;

  // D-09：没有「进入目标时快照、切回时恢复」的逻辑 —— 要求值缺省时保持现有值。
  const nextIsStreaming = required === undefined ? settings.isStreaming : required;
  const clearsOverride = current.streamingOverridden !== undefined;

  if (
    current.target === target &&
    !clearsOverride &&
    nextIsStreaming === settings.isStreaming
  ) {
    return settings;
  }

  return {
    ...settings,
    isStreaming: nextIsStreaming,
    bypass: {
      ...settings.bypass,
      // 显式重建（而不是展开 current）：D-10 要求每次目标切换都清掉覆盖标志。
      answererFlagalac: { target, perTarget: current.perTarget },
    },
  };
}

/**
 * 用户在设置里**手动**改过流式开关后调用（§4.4 规则 4）：置
 * `streamingOverridden = true`，此后当前目标的自动同步不再改写 `isStreaming`。
 *
 * 只在「本模块确实为该目标管理流式」时落标志（即目标声明了 `requiresStreaming`）；
 * 「无」或未声明要求的目标不受本模块干预，不写这个字段。
 * 返回**新对象**；标志已为真（或不该落）时返回入参原值。
 */
export function markStreamingOverridden(settings: AppState): AppState {
  const current = settings.bypass.answererFlagalac;
  const target = resolveFlagalacTarget(current.target);
  if (requiredStreamingForTarget(target) === undefined) return settings;
  if (current.streamingOverridden === true) return settings;

  return {
    ...settings,
    bypass: {
      ...settings.bypass,
      answererFlagalac: { ...current, target, streamingOverridden: true },
    },
  };
}
