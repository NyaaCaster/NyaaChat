import React, { useRef, useState } from "react";
import { History, Download, Trash2, Upload } from "lucide-react";
import { ChatSession } from "../types";
import { newId } from "../lib/id";
import { loadSessions, saveSession, deleteSession } from "../lib/sessionStorage";
import { BaseModal } from "./BaseModal";
import { ConfirmDialog } from "./ConfirmDialog";

// Re-export so existing call sites keep working without further refactors.
export { loadSessions, saveSession, deleteSession };

function getSessionLabel(session: ChatSession): string {
  const firstUserMsg = session.messages.find((m) => m.role === "user");
  const ts = firstUserMsg?.timestamp ?? session.createdAt;
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${d.getFullYear().toString().slice(-2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${session.characterName}-${stamp}`;
}

interface ChatHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSessionId: string | null;
  onSelectSession: (session: ChatSession) => void;
  onSessionsChange: () => void;
}

export function ChatHistoryModal({
  isOpen,
  onClose,
  currentSessionId,
  onSelectSession,
  onSessionsChange,
}: ChatHistoryModalProps) {
  const sessions = loadSessions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleExport = (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation();
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${getSessionLabel(session)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDeleteRequest = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setPendingDeleteId(id);
  };

  const handleDeleteConfirm = () => {
    if (pendingDeleteId) {
      deleteSession(pendingDeleteId);
      onSessionsChange();
    }
    setPendingDeleteId(null);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(`文件过大（${(file.size / 1024 / 1024).toFixed(2)} MB），上限 10 MB`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    try {
      const parsed = JSON.parse(await file.text());
      if (
        typeof parsed.id !== "string" ||
        typeof parsed.characterId !== "string" ||
        typeof parsed.characterName !== "string" ||
        !Array.isArray(parsed.messages) ||
        typeof parsed.createdAt !== "number"
      )
        throw new Error("格式不符合本项目聊天记录格式");
      const session: ChatSession = { ...parsed, id: newId() };
      saveSession(session);
      setImportError(null);
      onSessionsChange();
    } catch (err: any) {
      setImportError("导入失败：" + (err?.message || String(err)));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const pendingSession = pendingDeleteId
    ? sessions.find((s) => s.id === pendingDeleteId)
    : null;

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="聊天记录"
        titleIcon={<History size={16} className="text-blue-600 dark:text-blue-400" />}
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
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
            >
              <Upload size={16} /> 导入聊天记录
            </button>
          </>
        }
      >
        <div className="p-4 sm:p-5 min-h-[200px]">
          {sessions.length === 0 ? (
            <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-8">暂无聊天记录</p>
          ) : (
            <div className="grid grid-cols-1 gap-2">
              {sessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => {
                    onSelectSession(session);
                    onClose();
                  }}
                  className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                    currentSessionId === session.id
                      ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500"
                      : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm font-medium truncate ${
                        currentSessionId === session.id ? "text-blue-700 dark:text-blue-400" : "text-gray-900 dark:text-gray-100"
                      }`}
                    >
                      {getSessionLabel(session)}
                    </p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                      {session.messages.filter((m) => m.role !== "system").length} 条消息
                    </p>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={(e) => handleExport(e, session)}
                      className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/20 rounded-md transition-colors"
                      title="导出"
                    >
                      <Download size={14} />
                    </button>
                    {currentSessionId !== session.id && (
                      <button
                        onClick={(e) => handleDeleteRequest(e, session.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </BaseModal>

      <ConfirmDialog
        isOpen={pendingDeleteId !== null}
        title="删除聊天记录"
        message={
          pendingSession
            ? `确定要删除「${getSessionLabel(pendingSession)}」吗？此操作不可撤销。`
            : "确定要删除这条聊天记录吗？此操作不可撤销。"
        }
        destructive
        confirmText="删除"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDeleteId(null)}
      />
    </>
  );
}
