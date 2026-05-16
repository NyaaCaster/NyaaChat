import React from "react";
import { User, Save } from "lucide-react";
import { AppState, UserRoleSettings } from "../types";
import { BaseModal } from "./BaseModal";

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
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="用户角色设定"
      titleIcon={<User size={16} className="text-blue-600 dark:text-blue-400" />}
      maxWidth="max-w-md"
      footer={
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
          >
            <Save size={16} /> 保存设定
          </button>
        </div>
      }
    >
      <div className="p-4 sm:p-5">
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
    </BaseModal>
  );
}
