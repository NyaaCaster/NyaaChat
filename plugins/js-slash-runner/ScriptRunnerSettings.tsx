/**
 * js-slash-runner 插件设置面板（SSOT §2.4 目录树 / §8 P5 验收 2）。
 *
 * 面板由宿主 `src/components/ExtensionsModal.tsx` 以
 * `PluginSettingsPanelProps`（§2.2 契约）渲染在插件详情页里，包含四件事：
 *
 *  1. **「加载即运行」开关** —— 写 `updateConfig({ runOnLoad })`（`defaults.runOnLoad = true`，
 *     §8 P5 验收 2）。它只声明"要什么"，真正的执行时机由 P3 的插件 setup 读取本配置后决定。
 *  2. **安全风险提示（D5① 硬要求）** —— 文案必须写明"卡片脚本与 NyaaChat 宿主**同源**运行、
 *     可访问本机数据与凭据；只运行你信任来源的角色卡"。脚本载体是同源隐藏 iframe（不 sandbox，
 *     D5 决策①），这不是可以折叠隐藏的次要说明，所以常驻显示、紧贴面板顶部。
 *  3. **脚本库入口** —— 打开 `ScriptLibraryModal`（列表/启停/删除/排序/导入）。
 *  4. **最近一条脚本错误** —— 脚本在 iframe 里抛错时宿主只会在控制台留痕，用户看不到；
 *     这里把 P3 `executor/errors.ts` 环形缓冲的最后一条呈现出来。
 *
 * ## 与宿主控件的取舍（为何自带 `LocalToggleSwitch` / 不引 `SettingsFormBits`）
 *
 * SSOT §2.1「硬规则 1」禁止插件树 import `src/components/**`，任务契约也只允许
 * `src/plugins/types`（type-only）+ React / dnd-kit / lucide。因此开关按下
 * `SettingsFormBits.ToggleSwitch` 的 **class 串逐条对齐**自带一份（同样的
 * `peer-checked:after:translate-x-full` 结构、同样的 label 排版），外观与
 * 「对话模型供应商」等设置面板完全一致；若日后 SSOT 放开该边，可直接换回原控件。
 *
 * ## 额外 props 的接线（P3 待办，见交付说明）
 *
 * 宿主只传 `PluginSettingsPanelProps` 的四个字段。脚本列表 / 导入入口 / 最近错误
 * 都需要插件运行时数据，所以本面板把它们声明为**可选**额外 props：
 *
 * ```tsx
 * // plugins/js-slash-runner/plugin.tsx（P3）——
 * // SettingsPanel 由插件自己包一层，注入 store 与错误缓冲后交给宿主渲染。
 * const SettingsPanel = (props: PluginSettingsPanelProps) => (
 *   <ScriptRunnerSettings
 *     {...props}
 *     scripts={useScripts()}
 *     onScriptsChange={(next) => scriptHostApi.character.setScripts(next)}
 *     onImportScripts={openImportDialog}
 *     recentError={useLastScriptError()}
 *   />
 * );
 * ```
 *
 * 未注入时（例如面板被单独渲染做样式核对）本面板**如实降级**：脚本库入口按钮禁用并给出
 * 一行说明，最近错误显示空态文案 —— 不伪造一个点了没反应的交互。
 */
import { useState } from "react";
import { AlertTriangle, FileCode2 } from "lucide-react";
import type { PluginSettingsPanelProps } from "../../src/plugins/types";
import type { ScriptRecord } from "../../src/types";
import { ScriptLibraryModal } from "./ScriptLibraryModal";

/** 配置键：加载即运行（与 `plugin.tsx` 的 `defaults` 同键）。 */
export const RUN_ON_LOAD_KEY = "runOnLoad";

/** `defaults.runOnLoad` 的默认值（§8 P5 验收 2）。 */
export const DEFAULT_RUN_ON_LOAD = true;

/** 最近一条脚本错误的形状（P3 `executor/errors.ts` 环形缓冲的一条）。 */
export interface ScriptRunError {
  /** 出错脚本名（`ScriptRecord.name`；空名时由本面板回退成占位文案）。 */
  scriptName: string;
  /** 错误信息，通常直接取 `Error.message`。 */
  message: string;
  /** 发生时间（epoch ms），面板只展示"时:分:秒"。 */
  at: number;
}

export interface ScriptRunnerSettingsProps extends PluginSettingsPanelProps {
  /** 当前角色卡携带的脚本（P3 由 `scripts/store.ts` 注入）。 */
  scripts?: ScriptRecord[];
  /** 启停 / 删除 / 排序的唯一出口（P3 落到 `scriptHostApi.character.setScripts`）。 */
  onScriptsChange?: (next: ScriptRecord[]) => void;
  /** 从卡片 / 文件导入（P3/P4 侧提供）。 */
  onImportScripts?: () => void;
  /** 最近一条脚本错误；未注入 ⇒ 空态文案。 */
  recentError?: ScriptRunError | null;
}

/** 安全风险提示正文（D5① 指定必须写明的三件事：同源 / 可访问本机数据与凭据 / 只运行可信来源）。 */
export const SECURITY_NOTICE_TEXT =
  "卡片脚本与 NyaaChat 宿主同源运行，可访问本机数据与凭据；只运行你信任来源的角色卡。";

const UNNAMED_SCRIPT = "(未命名脚本)";

function formatTime(at: number): string {
  if (!Number.isFinite(at) || at <= 0) return "";
  try {
    return new Date(at).toLocaleTimeString();
  } catch {
    return "";
  }
}

export function ScriptRunnerSettings({
  pluginId,
  config,
  updateConfig,
  scripts,
  onScriptsChange,
  onImportScripts,
  recentError,
}: ScriptRunnerSettingsProps) {
  const [libraryOpen, setLibraryOpen] = useState(false);

  // 配置缺失（面板被单独渲染）时回落到与 `defaults` 相同的默认值，不把默认值显示成 undefined。
  const runOnLoad =
    typeof config[RUN_ON_LOAD_KEY] === "boolean"
      ? (config[RUN_ON_LOAD_KEY] as boolean)
      : DEFAULT_RUN_ON_LOAD;

  const list = scripts ?? [];
  const enabledCount = list.filter((script) => script.enabled).length;
  // 只读列表（拿不到写回出口）时不给入口：可拖可点却什么都不发生比禁用更糟。
  const libraryWired = Array.isArray(scripts) && typeof onScriptsChange === "function";

  const errorTime = recentError ? formatTime(recentError.at) : "";
  const errorScriptName = recentError?.scriptName?.trim() || UNNAMED_SCRIPT;

  return (
    <div className="space-y-5" data-plugin-id={pluginId}>
      {/* ── 安全风险提示（D5①）──────────────────────────────────────────── */}
      <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
        <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
        <div className="space-y-1 min-w-0">
          <p className="font-medium">安全提示</p>
          <p className="leading-relaxed break-words">{SECURITY_NOTICE_TEXT}</p>
        </div>
      </div>

      {/* ── 加载即运行 ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 min-h-[1.25rem]">
          <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            加载即运行
          </label>
          <LocalToggleSwitch
            checked={runOnLoad}
            onChange={(next) => updateConfig({ [RUN_ON_LOAD_KEY]: next })}
            label={runOnLoad ? "已开启" : "已关闭"}
          />
        </div>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          开启后，插件启用 / 切换角色卡时自动执行该卡里已启用的脚本（顺序即脚本库中的列表顺序）。
          关闭后脚本不会自动执行，但依旧随角色卡保存，可随时重新开启。
        </p>
      </div>

      {/* ── 脚本库入口 ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          脚本库
        </label>
        <button
          type="button"
          onClick={() => setLibraryOpen(true)}
          disabled={!libraryWired}
          title={
            libraryWired
              ? "打开脚本库"
              : "脚本列表尚未接入宿主（等待 P3 注入 scripts / onScriptsChange）"
          }
          className="w-full px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white dark:disabled:hover:bg-white/5"
        >
          <FileCode2 size={16} />
          打开脚本库
          {list.length > 0 ? `（${enabledCount}/${list.length} 已启用）` : ""}
        </button>
        <p className="text-[11px] text-gray-500 dark:text-gray-400">
          {libraryWired
            ? "可在脚本库里启用 / 停用、删除、拖动排序，以及从角色卡或文件导入脚本。"
            : "脚本列表尚未接入宿主（等待 P3 注入 scripts / onScriptsChange），接入后此处可管理脚本。"}
        </p>
      </div>

      {/* ── 最近一条脚本错误 ───────────────────────────────────────────── */}
      <div className="space-y-2">
        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          最近一条脚本错误
        </label>
        {recentError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-700 dark:text-red-400 space-y-1">
            <p className="font-medium break-words">
              脚本「{errorScriptName}」执行出错
              {errorTime ? ` · ${errorTime}` : ""}
            </p>
            <p className="leading-relaxed whitespace-pre-wrap break-all">{recentError.message}</p>
          </div>
        ) : (
          <p className="text-[11px] text-gray-500 dark:text-gray-400">暂无脚本错误记录。</p>
        )}
      </div>

      {/* 脚本库弹窗：portal 到 body（见 ScriptLibraryModal 文件头）。 */}
      <ScriptLibraryModal
        open={libraryOpen}
        scripts={list}
        onChange={
          onScriptsChange ??
          (() => {
            console.warn(
              `[js-slash-runner] 脚本列表变更未接入宿主（pluginId=${pluginId}），改动被丢弃`,
            );
          })
        }
        onImport={
          onImportScripts ??
          (() => {
            console.warn(
              `[js-slash-runner] 导入入口未接入宿主（pluginId=${pluginId}），点击被忽略`,
            );
          })
        }
        onClose={() => setLibraryOpen(false)}
      />
    </div>
  );
}

interface LocalToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** 可见标签，同时作为 title。 */
  label: string;
  disabled?: boolean;
}

/**
 * 开关（`src/components/SettingsFormBits.tsx` 的 `ToggleSwitch` 等价物，class 串逐条对齐）。
 * 见文件头「与宿主控件的取舍」。
 */
function LocalToggleSwitch({ checked, onChange, label, disabled = false }: LocalToggleSwitchProps) {
  return (
    <label
      className={`inline-flex items-center gap-2 select-none ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      }`}
      title={label}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </span>
      <span className="relative inline-flex items-center">
        <input
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
          aria-label={label}
        />
        <span className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"></span>
      </span>
    </label>
  );
}

export default ScriptRunnerSettings;
