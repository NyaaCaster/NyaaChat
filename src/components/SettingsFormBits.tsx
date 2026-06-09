import { useEffect, useId, useState } from "react";
import { Trash2 } from "lucide-react";

/**
 * Small, reusable form primitives shared by the v2 settings modals
 * (LlmProvidersModal / ImageProvidersModal / etc.). Kept generic enough
 * that any future "settings detail" pane can drop them in without taking
 * on the larger modal's footprint.
 */

export function Field({
  label,
  children,
  actionSlot,
}: {
  label: string;
  children: React.ReactNode;
  /** Optional secondary content rendered to the right of the label, e.g.
   *  a "获取 API Key" link. Hidden when omitted. */
  actionSlot?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2 min-h-[1.25rem]">
        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          {label}
        </label>
        {actionSlot}
      </div>
      {children}
    </div>
  );
}

export function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
      {children}
    </p>
  );
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Visible label, also drives the title attribute. */
  label: string;
  disabled?: boolean;
}

export function ToggleSwitch({
  checked,
  onChange,
  label,
  disabled = false,
}: ToggleSwitchProps) {
  const id = useId();
  return (
    <label
      htmlFor={id}
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
          id={id}
          type="checkbox"
          className="sr-only peer"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
        />
        <span className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"></span>
      </span>
    </label>
  );
}

interface DeleteModelButtonProps {
  /** Fires on the second (confirming) click. */
  onConfirm: () => void;
  disabled?: boolean;
  /** Title shown while disabled, e.g. "健康测试进行中". */
  disabledReason?: string;
}

/**
 * Two-step delete icon for saved-model rows. First click arms (turns red),
 * second click within 3s confirms; the armed state auto-resets so a stray
 * click can't linger as a landmine. No modal — deleting a still-listed
 * model is recoverable via 管理模型, and for delisted (orphaned) models
 * removal is the whole point.
 */
export function DeleteModelButton({
  onConfirm,
  disabled = false,
  disabledReason,
}: DeleteModelButtonProps) {
  const [arming, setArming] = useState(false);

  useEffect(() => {
    if (!arming) return;
    const t = setTimeout(() => setArming(false), 3000);
    return () => clearTimeout(t);
  }, [arming]);

  useEffect(() => {
    if (disabled) setArming(false);
  }, [disabled]);

  const title = disabled
    ? disabledReason || "暂不可删除"
    : arming
      ? "再次点击确认删除"
      : "从模型列表中删除";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (!arming) {
          setArming(true);
          return;
        }
        setArming(false);
        onConfirm();
      }}
      onBlur={() => setArming(false)}
      className={`p-1 rounded-md flex-shrink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
        arming
          ? "text-white bg-red-500 hover:bg-red-600"
          : "text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10"
      }`}
      aria-label={title}
      title={title}
    >
      <Trash2 size={13} className={arming ? "animate-pulse" : ""} />
    </button>
  );
}
