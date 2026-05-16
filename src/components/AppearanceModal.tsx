import React from "react";
import { Palette, X, Sun, Moon, Monitor, Check } from "lucide-react";
import { AppState } from "../types";
import { motion, AnimatePresence } from "motion/react";

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
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50"
          />
          <div className="fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white/90 dark:bg-[#111111]/90 backdrop-blur-xl w-full max-w-lg rounded-2xl shadow-elevation-3 border border-gray-200/50 dark:border-white/10 pointer-events-auto overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-100 dark:border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Palette
                      size={16}
                      className="text-blue-600 dark:text-blue-400"
                    />
                  </div>
                  <h3
                    className="text-lg font-semibold tracking-tight"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    外观设置
                  </h3>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-all"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-4 sm:p-5 overflow-y-auto w-full flex-1 min-h-[200px]">
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
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
