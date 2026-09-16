/**
 * 脚本库弹窗（SSOT §2.4 目录树 / §8 P5 验收 1；决策 D10）。
 *
 * ## 契约（**受控 + 纯展示**）
 *
 * 本组件**不持有任何脚本列表状态**：列表来自 `scripts`，启停 / 删除 / 拖拽排序
 * 全部算好新数组后经 `onChange(next)` 交回宿主（P3 的 `scripts/store.ts` →
 * `scriptHostApi.character.setScripts` → 角色卡保存链路）。因此：
 *  · 宿主换角色卡 ⇒ 新 `scripts` 直接反映到 UI（无需同步 effect，不串卡）；
 *  · 弹窗内不出现"本地改了但没落盘"的中间态。
 *
 * `onImport` 只负责把"用户点了导入"这件事告诉宿主：导入（选文件 / 解析 ST 卡的
 * `data.extensions.tavern_helper.scripts`）在 P3/P4 侧实现（`src/lib/sillyTavernScripts.ts`）。
 *
 * **明确不做**（SSOT §0.1 的 non-goals）：NG6 在线编辑脚本体、NG5 变量管理器 ——
 * 本文件里没有编辑器、没有变量面板，也不给任何入口。
 *
 * ## 为什么弹窗底座是本文件自带的 `LocalModal`，而不是复用 `src/components/BaseModal`
 *
 * SSOT §2.1「硬规则 1」：插件树里只能存在两条通向宿主运行时的静态边 ——
 * `src/plugins/types.ts`（type-only）与叶子 `src/plugins/scriptHost.ts`；插件**不得**
 * import `src/components/**`（`plugins/quote-tts/QuoteTtsSettings.tsx` 引
 * `SettingsFormBits` 是同一条规则的既有例外，不在本任务范围内）。任务契约同样只允许
 * `src/plugins/types`（type-only）+ React / dnd-kit / lucide。因此这里按 `BaseModal`
 * 的**视觉与交互规格**（backdrop-blur 卡片、`max-h-[90vh]`、ESC、Tab 焦点环、
 * body 滚动锁、关闭后焦点归位）自带一份最小实现，class 串逐条对齐，外观与既有
 * 弹窗一致。若将来 SSOT 放开插件 → `src/components` 的边，本组件可直接换回
 * `BaseModal`（props 一一对应）。
 *
 * ⚠️ **ESC 用 `window` + capture 阶段**：本弹窗总是从「扩展」弹窗（`ExtensionsModal`
 * 的 `BaseModal`，z-50）内部打开，两层都监听 ESC。`BaseModal` 在 `document` 上以
 * 冒泡阶段监听，而本组件的监听器在**捕获阶段**先执行并 `stopPropagation()` ⇒
 * ESC 只关最内层弹窗，不会连「扩展」面板一起关掉。栈顶判定（`modalStack`）用于
 * 本文件内嵌套的「删除确认」：两个监听器同挂 `window` capture，`stopPropagation`
 * 拦不住同节点的其它监听器，所以只有栈顶那个处理 ESC。
 *
 * ## 交互约定（对齐既有控件风格）
 *
 *  · **绿色启用点**（`.w-1.5 h-1.5 rounded-full bg-green-500`）—— 与「扩展」面板的
 *    插件列表、供应商列表同一视觉约定：**不是**开关控件。点它即切换启用/停用
 *    （`title` / `aria-label` 给出动作语义），停用时显示灰色空心环。
 *  · **拖拽排序**用 `@dnd-kit`，与 `ExtensionsModal` / `LlmProvidersModal` /
 *    `CharacterEditModal` 同款（垂直轴约束 + 手柄拖动 + 键盘传感器）。
 *  · 列表顺序 = 执行顺序（自上而下），行首序号只是把这个语义显式化。
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import { FileCode2, GripVertical, Trash2, Upload, X } from "lucide-react";
import type { ScriptRecord } from "../../src/types";

export interface ScriptLibraryModalProps {
  /** 是否显示（受控；`false` 时返回 `null`，不渲染任何 DOM）。 */
  open: boolean;
  /** 当前角色卡携带的脚本（`CharacterSettings.scripts`），顺序即执行顺序。 */
  scripts: ScriptRecord[];
  /** 启停 / 删除 / 排序的唯一出口：交回宿主落盘。 */
  onChange: (next: ScriptRecord[]) => void;
  /** 从卡片 / 文件导入（逻辑由 P3/P4 侧提供）。 */
  onImport: () => void;
  onClose: () => void;
}

/** 未命名脚本的回退名（与 `RegexModal` 的 `scriptName || "(未命名)"` 同口径）。 */
const UNNAMED_SCRIPT = "(未命名脚本)";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** 当前打开的 `LocalModal` 栈（只有栈顶响应 ESC），与 `BaseModal` 同一手法。 */
const modalStack: Array<() => void> = [];

/** 展示用脚本名（空名回退到占位文案）。 */
function scriptNameOf(script: ScriptRecord): string {
  return script.name?.trim() || UNNAMED_SCRIPT;
}

// ── 三个变更路径的**纯函数**实现 ────────────────────────────────────────────
// 组件本身只负责"算好新数组 → onChange"，这三步的语义（数组顺序、字段只改哪些）
// 都在这里，导出以便脱离 DOM 独立验证（沿用本仓 quote-tts「纯函数 + 导出」的做法）。

/**
 * 拖拽落点 → 新顺序（`activeId` 移到 `overId` 原来的位置）。
 *
 * 找不到目标（列表在拖动期间被替换 / id 不匹配）时**原样返回**，绝不猜位置。
 */
export function moveScript(
  scripts: ScriptRecord[],
  activeId: string,
  overId: string,
): ScriptRecord[] {
  if (activeId === overId) return scripts;
  const from = scripts.findIndex((script) => script.id === activeId);
  const to = scripts.findIndex((script) => script.id === overId);
  if (from < 0 || to < 0) return scripts;
  return arrayMove(scripts, from, to);
}

/** 切换某脚本的启用状态（只动 `enabled`，其余字段原样保留 —— ST 保真字段不丢）。 */
export function toggleScriptEnabled(scripts: ScriptRecord[], id: string): ScriptRecord[] {
  return scripts.map((script) =>
    script.id === id ? { ...script, enabled: !script.enabled } : script,
  );
}

/** 删除某脚本。 */
export function removeScript(scripts: ScriptRecord[], id: string): ScriptRecord[] {
  return scripts.filter((script) => script.id !== id);
}

export function ScriptLibraryModal({
  open,
  scripts,
  onChange,
  onImport,
  onClose,
}: ScriptLibraryModalProps) {
  const [pendingDelete, setPendingDelete] = useState<ScriptRecord | null>(null);

  // 弹窗关闭时收起待确认的删除（否则下次打开会带着上次的确认框）。
  useEffect(() => {
    if (!open) setPendingDelete(null);
  }, [open]);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  /**
   * 拖动结束 → `arrayMove` 出新顺序交回宿主。
   *
   * 列表受控，所以这里**不做任何本地排序**：宿主写回新 `scripts` 后 React 重新渲染，
   * 与「扩展」面板 `handleDragEnd` 的语义一致（差异只在于那边落盘的是显示顺序偏好，
   * 这边落盘的是脚本真实执行顺序）。排序语义在纯函数 `moveScript` 里，可独立验证。
   */
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const next = moveScript(scripts, String(active.id), String(over.id));
      if (next === scripts) return;
      onChange(next);
    },
    [scripts, onChange],
  );

  const toggleEnabled = useCallback(
    (id: string) => {
      onChange(toggleScriptEnabled(scripts, id));
    },
    [scripts, onChange],
  );

  const confirmDelete = useCallback(() => {
    if (!pendingDelete) return;
    onChange(removeScript(scripts, pendingDelete.id));
    setPendingDelete(null);
  }, [scripts, onChange, pendingDelete]);

  const enabledCount = scripts.filter((script) => script.enabled).length;
  const total = scripts.length;

  return (
    <>
      <LocalModal
        open={open}
        onClose={onClose}
        title="脚本库"
        titleIcon={<FileCode2 size={16} className="text-blue-500" />}
        maxWidth="max-w-xl"
        titleExtra={
          total > 0 ? (
            <span className="text-[11px] text-gray-500 dark:text-gray-400 tabular-nums">
              {enabledCount}/{total} 已启用
            </span>
          ) : undefined
        }
        footer={
          <div className="space-y-2">
            <p className="text-[11px] text-gray-500 dark:text-gray-400">
              列表顺序即脚本执行顺序（自上而下）；启用状态与顺序随角色卡保存。
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onImport}
                className="flex-1 px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
              >
                <Upload size={16} /> 导入脚本
              </button>
              <button
                type="button"
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
              >
                完成
              </button>
            </div>
          </div>
        }
      >
        <div className="p-4 sm:p-5">
          {total === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500">
              该角色还没有脚本。
              <br />
              脚本随角色卡导入（ST 卡的 tavern_helper 字段）或从文件导入。
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            >
              <SortableContext
                items={scripts.map((script) => script.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col gap-2 list-none">
                  {scripts.map((script, index) => (
                    <SortableScriptRow
                      key={script.id}
                      script={script}
                      index={index}
                      onToggle={toggleEnabled}
                      onDelete={() => setPendingDelete(script)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </LocalModal>

      {/* 删除走二次确认（与角色 / 正则 / 供应商等既有删除入口一致）。 */}
      <LocalModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="删除确认"
        maxWidth="max-w-sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setPendingDelete(null)}
              className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-xl transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              data-autofocus
              onClick={confirmDelete}
              className="px-4 py-2 text-sm font-medium text-white rounded-xl transition-colors bg-red-600 hover:bg-red-700"
            >
              确认删除
            </button>
          </div>
        }
      >
        <div className="p-5 text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
          确认是否要删除脚本
          {pendingDelete ? `「${scriptNameOf(pendingDelete)}」` : ""}？
          <br />
          删除只影响当前角色卡；脚本内容随角色卡一起保存，删除后无法恢复。
        </div>
      </LocalModal>
    </>
  );
}

interface SortableScriptRowProps {
  script: ScriptRecord;
  /** 0 基下标（展示为执行序号）。 */
  index: number;
  onToggle: (id: string) => void;
  onDelete: () => void;
}

/**
 * 可拖动排序的脚本行。
 *
 * 行内**没有开关控件**（用户 2026-09-15 对插件/供应商列表的要求，本列表沿用）：
 * 启用状态用右侧绿点表示、**点绿点即切换**，这样"拖动手柄"与"删除"都不会误触启停。
 * 上行内序号把"顺序即执行顺序"显式化。
 */
function SortableScriptRow({ script, index, onToggle, onDelete }: SortableScriptRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: script.id,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  const name = scriptNameOf(script);
  const enabled = script.enabled;

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-1.5 p-2 rounded-xl border transition-colors ${
        enabled
          ? "border-gray-200/70 dark:border-white/10 bg-gray-50/50 dark:bg-white/5"
          : "border-gray-200/60 dark:border-white/5 bg-gray-50/40 dark:bg-white/[0.02]"
      }`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="p-1.5 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 touch-none flex-shrink-0 rounded-lg focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400"
        aria-label={`拖动排序 ${name}`}
        title="拖动排序"
      >
        <GripVertical size={14} />
      </button>

      <span
        className="w-4 text-[11px] tabular-nums text-gray-400 dark:text-gray-500 flex-shrink-0 text-center select-none"
        title="执行顺序"
        aria-hidden="true"
      >
        {index + 1}
      </span>

      <span
        className={`flex-1 min-w-0 truncate text-sm ${
          enabled
            ? "text-gray-900 dark:text-gray-100 font-medium"
            : "text-gray-500 dark:text-gray-400"
        }`}
        title={name}
      >
        {name}
      </span>

      {/* 启用点：与「扩展」面板插件列表同一视觉约定（绿点 = 已启用，无开关控件）。 */}
      <button
        type="button"
        onClick={() => onToggle(script.id)}
        aria-pressed={enabled}
        aria-label={enabled ? `停用脚本 ${name}` : `启用脚本 ${name}`}
        title={enabled ? "已启用，点击停用" : "已停用，点击启用"}
        className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 flex-shrink-0 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400"
      >
        <span
          role="img"
          aria-label={enabled ? "已启用" : "已停用"}
          className={`w-1.5 h-1.5 rounded-full ${
            enabled ? "bg-green-500" : "bg-transparent ring-1 ring-gray-400 dark:ring-gray-500"
          }`}
        />
      </button>

      <button
        type="button"
        onClick={onDelete}
        aria-label={`删除脚本 ${name}`}
        title="删除"
        className="p-2 text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-all flex-shrink-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400"
      >
        <Trash2 size={16} />
      </button>
    </li>
  );
}

interface LocalModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  titleIcon?: React.ReactNode;
  /** 标题右侧的次要信息（如「2/3 已启用」），渲染在关闭按钮左边。 */
  titleExtra?: React.ReactNode;
  /** Tailwind max-width 片段，如 `max-w-xl`。 */
  maxWidth?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * 本文件自带的弹窗底座（`BaseModal` 的最小等价物，见文件头「为什么」）。
 *
 * 具备：`createPortal` 到 `body`（逃离 `ExtensionsModal` 卡片的
 * `backdrop-blur` 包含块，否则 `fixed` 定位会被钉在卡片内 —— 与 `RegexModal`
 * 给嵌套编辑器套 portal 是同一条理由）、ESC 关栈顶、Tab 焦点环、
 * body 滚动锁、关闭后焦点归位、`aria-modal` / `aria-labelledby`。
 *
 * 刻意**不做**：入场动画（不引 motion）、点遮罩关闭（与「正则」「扩展」一致，
 * 避免误触丢失列表操作）。
 */
function LocalModal({
  open,
  onClose,
  title,
  titleIcon,
  titleExtra,
  maxWidth = "max-w-lg",
  children,
  footer,
}: LocalModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  // 回调放 ref：调用点传的是内联箭头，避免父组件重渲染导致 effect 重跑、
  // 把本弹窗重复压栈（与 `BaseModal` 同一处理）。
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const closeSelf = () => onCloseRef.current();
    modalStack.push(closeSelf);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // 只有栈顶弹窗响应（本文件内可能同时开着「脚本库」与「删除确认」）。
        if (modalStack[modalStack.length - 1] !== closeSelf) return;
        // 捕获阶段拦截：别让 ESC 继续下传到「扩展」面板的 BaseModal。
        e.stopPropagation();
        e.preventDefault();
        closeSelf();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey, true);

    // 打开后把焦点送进弹窗（首个 `data-autofocus`，否则第一个可聚焦元素）。
    const timer = window.setTimeout(() => {
      if (!dialogRef.current) return;
      if (dialogRef.current.contains(document.activeElement)) return;
      const target =
        dialogRef.current.querySelector<HTMLElement>("[data-autofocus]") ??
        dialogRef.current.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      target?.focus();
    }, 50);

    return () => {
      window.removeEventListener("keydown", handleKey, true);
      document.body.style.overflow = prevOverflow;
      const index = modalStack.indexOf(closeSelf);
      if (index >= 0) modalStack.splice(index, 1);
      window.clearTimeout(timer);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    // z-[60]：高于 ExtensionsModal（z-50）。
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative w-full ${maxWidth} bg-white/95 dark:bg-[#111111]/95 backdrop-blur-xl rounded-2xl shadow-elevation-3 border border-gray-200/50 dark:border-white/10 max-h-[90vh] flex flex-col overflow-hidden`}
      >
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-100 dark:border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {titleIcon && (
              <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
                {titleIcon}
              </div>
            )}
            <h3
              id={titleId}
              className="text-lg font-semibold tracking-tight truncate"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {title}
            </h3>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {titleExtra}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-all"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer && (
          <div className="p-4 sm:p-5 border-t border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-black/20 flex-shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

export default ScriptLibraryModal;
