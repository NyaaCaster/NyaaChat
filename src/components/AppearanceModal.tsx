import React from "react";
import { Palette, Sun, Moon, Monitor, Check } from "lucide-react";
import { AppState } from "../types";
import { BaseModal } from "./BaseModal";

interface AppearanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
}

type ThemeOption = {
  value: AppState["theme"];
  label: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

const THEME_OPTIONS: ThemeOption[] = [
  {
    value: "light",
    label: "浅色",
    description: "始终使用明亮主题",
    icon: Sun,
  },
  {
    value: "dark",
    label: "深色",
    description: "始终使用暗黑主题",
    icon: Moon,
  },
  {
    value: "system",
    label: "跟随系统",
    description: "根据系统偏好自动切换",
    icon: Monitor,
  },
];

export function AppearanceModal({
  isOpen,
  onClose,
  settings,
  onSave,
}: AppearanceModalProps) {
  const handleSelect = (theme: AppState["theme"]) => {
    onSave({ ...settings, theme });
    onClose();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="外观设置"
      titleIcon={<Palette size={16} className="text-blue-600 dark:text-blue-400" />}
      maxWidth="max-w-lg"
    >
      <div className="p-4 sm:p-5 min-h-[200px]">
        <div className="grid grid-cols-1 gap-3">
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = settings.theme === opt.value;
            return (
              <div
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                className={`flex items-center text-left p-4 rounded-xl border cursor-pointer transition-all duration-200 group relative ${
                  active
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500 shadow-sm"
                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10"
                }`}
              >
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center mr-4 flex-shrink-0 ${
                    active
                      ? "bg-blue-500/15 text-blue-600 dark:text-blue-400"
                      : "bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 group-hover:text-gray-700 dark:group-hover:text-gray-200"
                  }`}
                >
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0 pr-8">
                  <h4
                    className={`text-base font-medium mb-0.5 truncate ${
                      active
                        ? "text-blue-700 dark:text-blue-400"
                        : "text-gray-900 dark:text-gray-100"
                    }`}
                  >
                    {opt.label}
                  </h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                    {opt.description}
                  </p>
                </div>

                {active && (
                  <div className="absolute right-4 top-1/2 -translate-y-1/2">
                    <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white">
                      <Check size={12} strokeWidth={3} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </BaseModal>
  );
}
