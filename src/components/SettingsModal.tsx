import React, { useRef, useState } from "react";
import {
  Settings as SettingsIcon,
  ChevronRight,
  MessageSquare,
  ImagePlus,
  Sun,
  Moon,
  Monitor,
  Check,
  Download,
  Upload,
  AlertTriangle,
} from "lucide-react";
import { AppState } from "../types";
import { BaseModal } from "./BaseModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { ToggleSwitch } from "./SettingsFormBits";
import { exportSettings, parseImportText } from "../lib/settingsBackup";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
  onOpenLlmProviders: () => void;
  onOpenImageProviders: () => void;
}

type ThemeOption = {
  value: AppState["theme"];
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const THEME_OPTIONS: ThemeOption[] = [
  { value: "light", label: "浅色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟随系统", icon: Monitor },
];

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
  onOpenLlmProviders,
  onOpenImageProviders,
}: SettingsModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Pending import state — held until the user confirms in the dialog so a
  // mis-clicked import doesn't silently wipe their config.
  const [pendingImport, setPendingImport] = useState<AppState | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleThemeSelect = (theme: AppState["theme"]) => {
    onSave({ ...settings, theme });
  };

  const handleStreamingToggle = (next: boolean) => {
    onSave({ ...settings, isStreaming: next });
  };

  const handleFrontendRenderingToggle = (next: boolean) => {
    onSave({ ...settings, isFrontendRenderingEnabled: next });
  };

  const handleFrontendRenderingDepthChange = (next: number) => {
    onSave({ ...settings, frontendRenderingDepth: next });
  };

  const handleExport = () => {
    exportSettings(settings);
  };

  const handlePickImportFile = () => {
    setImportError(null);
    fileInputRef.current?.click();
  };

  const handleImportFileChosen = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    // Reset the input value so picking the same file twice still fires
    // change events.
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      const result = parseImportText(text);
      if (result.kind === "ok") {
        setPendingImport(result.settings);
      } else {
        setImportError(result.error);
      }
    } catch (err: any) {
      setImportError(`读取文件失败:${err?.message || String(err)}`);
    }
  };

  const handleConfirmImport = () => {
    if (!pendingImport) return;
    onSave(pendingImport);
    setPendingImport(null);
    onClose();
  };

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="设置"
        titleIcon={<SettingsIcon size={16} className="text-blue-600 dark:text-blue-400" />}
        maxWidth="max-w-lg"
      >
        <div className="p-4 sm:p-6 space-y-8">
          <SectionHeading>模型设置</SectionHeading>
          <div className="space-y-3 -mt-4">
            <div className="grid grid-cols-2 gap-3">
              <FeatureToggleCard
                checked={settings.isStreaming}
                onChange={handleStreamingToggle}
                label="流式输出"
                description="流式输出开启后敏感内容容易被截断"
              />
              <FeatureToggleCard
                checked={settings.isFrontendRenderingEnabled}
                onChange={handleFrontendRenderingToggle}
                label="前端渲染"
                depth={settings.frontendRenderingDepth}
                onDepthChange={handleFrontendRenderingDepthChange}
              />
            </div>
            <RowButton
              onClick={onOpenLlmProviders}
              icon={<MessageSquare size={20} className="text-blue-500" />}
              label="对话模型设置"
            />
            <RowButton
              onClick={onOpenImageProviders}
              icon={<ImagePlus size={20} className="text-purple-500" />}
              label="生图模型设置"
            />
          </div>

          <SectionHeading>外观设置</SectionHeading>
          <div className="grid grid-cols-3 gap-2 -mt-4">
            {THEME_OPTIONS.map((opt) => {
              const Icon = opt.icon;
              const active = settings.theme === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => handleThemeSelect(opt.value)}
                  className={`relative flex flex-col items-center justify-center gap-2 p-4 rounded-xl border transition-all duration-200 ${
                    active
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500"
                      : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10"
                  }`}
                >
                  <Icon
                    size={22}
                    className={
                      active
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-gray-500 dark:text-gray-400"
                    }
                  />
                  <span
                    className={`text-sm font-medium ${
                      active
                        ? "text-blue-700 dark:text-blue-400"
                        : "text-gray-900 dark:text-gray-100"
                    }`}
                  >
                    {opt.label}
                  </span>
                  {active && (
                    <div className="absolute top-2 right-2 w-4 h-4 rounded-full bg-blue-500 flex items-center justify-center text-white">
                      <Check size={10} strokeWidth={3} />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <SectionHeading>备份与恢复</SectionHeading>
          <div className="space-y-3 -mt-4">
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={handleImportFileChosen}
            />
            <div className="grid grid-cols-2 gap-3">
              <BackupButton
                onClick={handleExport}
                icon={<Download size={16} />}
                label="导出设置"
              />
              <BackupButton
                onClick={handlePickImportFile}
                icon={<Upload size={16} />}
                label="导入设置"
              />
            </div>
            <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">
              <AlertTriangle size={11} className="inline -mt-0.5 mr-1" />
              导出文件包含 API Key
              明文与全部供应商配置,请妥善保管;导入会覆盖当前所有设置(角色、Bypass、用户人设、MCP 工具配置等)。
            </p>
            {importError && (
              <p className="text-[11px] text-red-600 dark:text-red-400 break-all leading-relaxed">
                {importError}
              </p>
            )}
          </div>
        </div>
      </BaseModal>

      <ConfirmDialog
        isOpen={!!pendingImport}
        title="导入设置"
        destructive
        confirmText="替换并导入"
        message={
          <>
            导入后将
            <span className="font-semibold text-gray-900 dark:text-gray-100 mx-1">
              替换当前所有设置
            </span>
            ,包括对话/生图供应商配置、外观、角色卡片、Bypass、用户人设、MCP 工具配置等。
            该操作不可撤销 —— 建议先点 `导出设置` 备份后再继续。
          </>
        }
        onConfirm={handleConfirmImport}
        onCancel={() => setPendingImport(null)}
      />
    </>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-200 pb-2 border-b border-gray-100 dark:border-white/5">
      {children}
    </h4>
  );
}

interface RowButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function RowButton({ onClick, icon, label }: RowButtonProps) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10 transition-all text-left group"
    >
      <div className="w-10 h-10 rounded-xl bg-gray-100 dark:bg-white/5 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <span className="flex-1 text-base font-medium text-gray-900 dark:text-gray-100">
        {label}
      </span>
      <ChevronRight
        size={18}
        className="text-gray-400 group-hover:text-gray-600 dark:group-hover:text-gray-300 group-hover:translate-x-0.5 transition-all flex-shrink-0"
      />
    </button>
  );
}

interface FeatureToggleCardProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  depth?: number;
  onDepthChange?: (next: number) => void;
}

function FeatureToggleCard({
  checked,
  onChange,
  label,
  description,
  depth,
  onDepthChange,
}: FeatureToggleCardProps) {
  const hasDepth = typeof depth === "number" && !!onDepthChange;

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 min-w-0">
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <div className="text-base font-medium text-gray-900 dark:text-gray-100 whitespace-nowrap">
            {label}
          </div>
          {description && (
            <div className="mt-1 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
              {description}
            </div>
          )}
        </div>
        <ToggleSwitch
          checked={checked}
          onChange={onChange}
          label={checked ? "已开启" : "已关闭"}
        />
      </div>
      {hasDepth && (
        <label className="flex items-center justify-between gap-2 min-w-0 text-xs text-gray-500 dark:text-gray-400">
          <span className="shrink-0 whitespace-nowrap">渲染层数</span>
          <input
            type="number"
            min={0}
            step={1}
            value={depth}
            onChange={(e) => {
              const next = Number(e.target.value);
              onDepthChange?.(Number.isFinite(next) && next >= 0 ? Math.floor(next) : 0);
            }}
            className="w-16 min-w-0 rounded-md border border-gray-200 dark:border-white/10 bg-white dark:bg-black/20 px-2 py-1 text-right text-xs text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
            aria-label="前端渲染层数，0 为全部"
          />
        </label>
      )}
    </div>
  );
}

interface BackupButtonProps {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}

function BackupButton({ onClick, icon, label }: BackupButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center justify-center gap-2 p-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10 text-sm font-medium text-gray-900 dark:text-gray-100 transition-all"
    >
      {icon}
      {label}
    </button>
  );
}
