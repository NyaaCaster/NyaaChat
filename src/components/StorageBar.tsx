import React from "react";
import { HardDrive } from "lucide-react";

// ---------------------------------------------------------------------------
// Shared storage bar — used by both ChatHistoryModal and CharacterSelectionModal
// ---------------------------------------------------------------------------

export interface StorageBarProps {
  /** Display label, e.g. "聊天记录储存" or "角色卡储存" */
  label: string;
  /** Current usage in bytes */
  usage: number;
  /** Quota ceiling in bytes (the "100 MB" limit) */
  quota: number;
  /** Optional custom warning message shown when usage >= 80 % of quota */
  warnMessage?: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StorageBar({ label, usage, quota, warnMessage }: StorageBarProps) {
  const pct = quota > 0 ? Math.min(100, (usage / quota) * 100) : 0;
  const warn = pct >= 80;

  return (
    <div className="mb-3 px-1">
      <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 mb-1">
        <span className="flex items-center gap-1">
          <HardDrive size={12} />
          {label}
        </span>
        <span>
          {formatBytes(usage)}
          {quota > 0 ? ` / ${formatBytes(quota)}` : " / 未知"}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            warn ? "bg-amber-500" : "bg-blue-500"
          }`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
      {warn && (
        <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
          ⚠ {warnMessage || "存储空间紧张，建议清理后继续使用"}
        </p>
      )}
    </div>
  );
}
