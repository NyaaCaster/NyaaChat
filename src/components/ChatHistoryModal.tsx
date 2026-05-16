import React, { useRef } from "react";
import { X, History, Download, Trash2, Upload } from "lucide-react";
import { ChatSession, Message } from "../types";
import { newId } from "../lib/id";
import { loadSessions, saveSession, deleteSession } from "../lib/sessionStorage";
import { motion, AnimatePresence } from "motion/react";

// Re-export so existing call sites keep working without further refactors.
export { loadSessions, saveSession, deleteSession };

function getSessionLabel(session: ChatSession): string {
  const firstUserMsg = session.messages.find(m => m.role === "user");
  const ts = firstUserMsg?.timestamp ?? session.createdAt;
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${d.getFullYear().toString().slice(-2)}${pad(d.getMonth()+1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteSession(id);
    onSessionsChange();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
    if (file.size > MAX_IMPORT_BYTES) {
      alert(`文件过大（${(file.size / 1024 / 1024).toFixed(2)} MB），上限 10 MB`);
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
      ) throw new Error("格式不符合本项目聊天记录格式");
      const session: ChatSession = { ...parsed, id: newId() };
      saveSession(session);
      onSessionsChange();
    } catch (err: any) {
      alert("导入失败: " + err.message);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
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
                    <History size={16} className="text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="text-lg font-semibold tracking-tight" style={{ fontFamily: "var(--font-display)" }}>聊天记录</h3>
                </div>
                <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-all">
                  <X size={18} />
                </button>
              </div>

              <div className="p-4 sm:p-5 overflow-y-auto flex-1 min-h-[200px]">
                {sessions.length === 0 ? (
                  <p className="text-center text-sm text-gray-400 dark:text-gray-500 py-8">暂无聊天记录</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2">
                    {sessions.map(session => (
                      <div
                        key={session.id}
                        onClick={() => { onSelectSession(session); onClose(); }}
                        className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                          currentSessionId === session.id
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500"
                            : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium truncate ${
                            currentSessionId === session.id ? "text-blue-700 dark:text-blue-400" : "text-gray-900 dark:text-gray-100"
                          }`}>{getSessionLabel(session)}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{session.messages.filter(m => m.role !== "system").length} 条消息</p>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <button onClick={e => handleExport(e, session)} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/20 rounded-md transition-colors" title="导出">
                            <Download size={14} />
                          </button>
                          {currentSessionId !== session.id && (
                            <button onClick={e => handleDelete(e, session.id)} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors" title="删除">
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-4 sm:p-5 border-t border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-black/20">
                <input type="file" accept=".json" className="hidden" ref={fileInputRef} onChange={handleImport} />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Upload size={16} /> 导入聊天记录
                </button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}