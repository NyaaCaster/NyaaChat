import React, { useState } from "react";
import { Save, Download } from "lucide-react";
import { UserRoleSettings } from "../types";
import { newId } from "../lib/id";
import { BaseModal } from "./BaseModal";

interface UserRoleEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (userRole: UserRoleSettings) => void;
  initialUserRole?: UserRoleSettings | null;
}

export function UserRoleEditModal({
  isOpen,
  onClose,
  onSave,
  initialUserRole,
}: UserRoleEditModalProps) {
  const [name, setName] = useState("");
  const [profile, setProfile] = useState("");

  React.useEffect(() => {
    if (initialUserRole) {
      setName(initialUserRole.name);
      setProfile(initialUserRole.profile || "");
    } else {
      setName("");
      setProfile("");
    }
  }, [initialUserRole, isOpen]);

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      id: initialUserRole?.id || newId(),
      name: name.trim(),
      profile: profile.trim(),
    });
    onClose();
  };

  const handleExport = () => {
    const data = {
      name: name.trim(),
      profile: profile.trim(),
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const timestamp = `${now.getFullYear().toString().slice(-2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `NyaaChatUser-${timestamp}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={initialUserRole ? "编辑用户角色" : "创建用户角色"}
      maxWidth="max-w-lg"
      footer={
        <div className="flex gap-3">
          <button
            onClick={handleExport}
            className="flex-shrink-0 px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
          >
            <Download size={16} /> 用户角色导出
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 border border-transparent disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
          >
            <Save size={16} /> 保存用户角色
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
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. user"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
              用户人设描述 (User Profile)
            </label>
            <textarea
              className="w-full px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow resize-none min-h-[120px]"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
              placeholder="描述用户的人设，例如性格、背景、特殊偏好等..."
            />
          </div>
        </div>
      </div>
    </BaseModal>
  );
}
