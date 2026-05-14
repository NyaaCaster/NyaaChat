import React from "react";
import { User, X, Save } from "lucide-react";
import { AppState, UserRoleSettings } from "../types";
import { motion, AnimatePresence } from "motion/react";

interface UserRoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
}

export function UserRoleModal({
  isOpen,
  onClose,
  settings,
  onSave,
}: UserRoleModalProps) {
  const [localSettings, setLocalSettings] = React.useState<UserRoleSettings>(
    settings.userRole || { name: "user", profile: "" },
  );

  React.useEffect(() => {
    setLocalSettings(settings.userRole || { name: "user", profile: "" });
  }, [settings, isOpen]);

  const handleSave = () => {
    onSave({
      ...settings,
      userRole: localSettings,
    });
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
            className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 transition-opacity"
          />
          <div className="fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white/90 dark:bg-[#111111]/90 backdrop-blur-xl w-full max-w-md rounded-2xl shadow-elevation-3 border border-gray-200/50 dark:border-white/10 pointer-events-auto overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-100 dark:border-white/5">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <User
                      size={16}
                      className="text-blue-600 dark:text-blue-400"
                    />
                  </div>
                  <h3
                    className="text-lg font-semibold tracking-tight"
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    用户角色设定
                  </h3>
                </div>
                <button
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-all"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-4 sm:p-5 overflow-y-auto w-full">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                      用户名称 (User Name)
                    </label>
                    <input
                      type="text"
                      className="w-full px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                      value={localSettings.name}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          name: e.target.value,
                        })
                      }
                      placeholder="e.g. user"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                      用户人设描述 (User Profile)
                    </label>
                    <textarea
                      className="w-full px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow resize-none min-h-[120px]"
                      value={localSettings.profile}
                      onChange={(e) =>
                        setLocalSettings({
                          ...localSettings,
                          profile: e.target.value,
                        })
                      }
                      placeholder="描述用户的人设，例如性格、背景、特殊偏好等..."
                    />
                  </div>
                </div>
              </div>
              <div className="p-4 sm:p-5 border-t border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-black/20 flex justify-end">
                <button
                  onClick={handleSave}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
                >
                  <Save size={16} /> 保存设定
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
