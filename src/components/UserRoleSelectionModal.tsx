import React, { useState, useRef } from "react";
import { User, Plus, Upload, Check, Edit2, Trash2 } from "lucide-react";
import { AppState, UserRoleSettings } from "../types";
import { newId } from "../lib/id";
import { BaseModal } from "./BaseModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { UserRoleEditModal } from "./UserRoleEditModal";

interface UserRoleSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
}

export function UserRoleSelectionModal({
  isOpen,
  onClose,
  settings,
  onSave,
}: UserRoleSelectionModalProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingUserRole, setEditingUserRole] = useState<UserRoleSettings | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSelectUserRole = (id: string) => {
    onSave({
      ...settings,
      currentUserRoleId: id,
    });
    onClose();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_IMPORT_BYTES = 1 * 1024 * 1024;
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(`文件过大（${(file.size / 1024 / 1024).toFixed(2)} MB），上限 1 MB`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    try {
      const content = await file.text();
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== "object") throw new Error("Invalid JSON object");
      if (!parsed.name || typeof parsed.name !== "string") throw new Error('Missing or invalid "name"');
      const newUserRole: UserRoleSettings = {
        id: newId(),
        name: parsed.name,
        profile: typeof parsed.profile === "string" ? parsed.profile : "",
      };

      onSave({
        ...settings,
        userRoles: [...(settings.userRoles || []), newUserRole],
      });
      setImportError(null);
    } catch (err: any) {
      setImportError("用户角色配置内容格式错误：" + (err?.message || String(err)));
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSaveUserRole = (userRole: UserRoleSettings) => {
    if (editingUserRole) {
      onSave({
        ...settings,
        userRoles: settings.userRoles.map((u) =>
          u.id === userRole.id ? userRole : u
        ),
      });
    } else {
      onSave({
        ...settings,
        userRoles: [...(settings.userRoles || []), userRole],
      });
    }
    setEditingUserRole(null);
  };

  const handleDeleteRequest = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (settings.userRoles.length <= 1) return;
    setPendingDeleteId(id);
  };

  const handleDeleteConfirm = () => {
    if (!pendingDeleteId) return;
    const newUserRoles = settings.userRoles.filter((u) => u.id !== pendingDeleteId);
    let nextCurrentId = settings.currentUserRoleId;
    if (settings.currentUserRoleId === pendingDeleteId) {
      nextCurrentId = newUserRoles[0].id;
    }
    onSave({
      ...settings,
      userRoles: newUserRoles,
      currentUserRoleId: nextCurrentId,
    });
    setPendingDeleteId(null);
  };

  const handleOpenEdit = (e: React.MouseEvent, userRole: UserRoleSettings) => {
    e.stopPropagation();
    setEditingUserRole(userRole);
    setIsEditModalOpen(true);
  };

  const handleOpenCreate = () => {
    setEditingUserRole(null);
    setIsEditModalOpen(true);
  };

  const pendingDeleteUserRole = pendingDeleteId
    ? settings.userRoles.find((u) => u.id === pendingDeleteId)
    : null;

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="用户角色选择"
        titleIcon={<User size={16} className="text-blue-600 dark:text-blue-400" />}
        maxWidth="max-w-lg"
        footer={
          <>
            <input
              type="file"
              accept=".json"
              className="hidden"
              ref={fileInputRef}
              onChange={handleImport}
            />
            {importError && (
              <p className="text-xs text-red-500 dark:text-red-400 mb-2 break-all">{importError}</p>
            )}
            <div className="flex gap-3">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
              >
                <Upload size={16} /> 导入用户角色
              </button>
              <button
                onClick={handleOpenCreate}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
              >
                <Plus size={16} /> 创建用户角色
              </button>
            </div>
          </>
        }
      >
        <div className="p-4 sm:p-5 min-h-[200px]">
          <div className="grid grid-cols-1 gap-3">
            {(settings.userRoles || []).map((userRole) => (
              <div
                key={userRole.id}
                onClick={() => handleSelectUserRole(userRole.id)}
                className={`flex items-start text-left p-4 rounded-xl border cursor-pointer transition-all duration-200 group relative ${
                  settings.currentUserRoleId === userRole.id
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500 shadow-sm"
                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10"
                }`}
              >
                <div className="flex-1 min-w-0 pr-16">
                  <h4
                    className={`text-base font-medium mb-1 truncate ${
                      settings.currentUserRoleId === userRole.id
                        ? "text-blue-700 dark:text-blue-400"
                        : "text-gray-900 dark:text-gray-100"
                    }`}
                  >
                    {userRole.name}
                  </h4>
                  <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                    {userRole.profile || <span className="italic opacity-60">（未填写人设）</span>}
                  </p>
                </div>

                <div className="absolute right-4 top-4 flex items-center gap-1">
                  <button
                    onClick={(e) => handleOpenEdit(e, userRole)}
                    className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/20 rounded-md transition-colors"
                    title="编辑用户角色"
                  >
                    <Edit2 size={14} />
                  </button>
                  {settings.currentUserRoleId !== userRole.id && settings.userRoles.length > 1 && (
                    <button
                      onClick={(e) => handleDeleteRequest(e, userRole.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors"
                      title="删除用户角色"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>

                {settings.currentUserRoleId === userRole.id && (
                  <div className="absolute right-4 bottom-4">
                    <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white">
                      <Check size={12} strokeWidth={3} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </BaseModal>

      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        title="删除用户角色"
        message={
          pendingDeleteUserRole
            ? `确定要删除用户角色「${pendingDeleteUserRole.name}」吗？此操作不可撤销。`
            : "确定要删除该用户角色吗？此操作不可撤销。"
        }
        destructive
        confirmText="删除"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDeleteId(null)}
      />

      <UserRoleEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={handleSaveUserRole}
        initialUserRole={editingUserRole}
      />
    </>
  );
}
