import React, { useEffect, useRef, useState } from "react";
import { History, Download, FileText, Trash2, Upload, CloudUpload, CloudDownload } from "lucide-react";
import { ChatSession } from "../types";
import { newId } from "../lib/id";
import { loadSessions, saveSession, deleteSession, replaceAllSessions } from "../lib/sessionStorage";
import { estimateChatStorage, DEFAULT_CHAT_STORAGE_QUOTA } from "../lib/storageEstimate";
import { loadStoredAccount } from "../lib/sharedAccountApi";
import { uploadChatSessions, downloadChatSessions } from "../lib/sharedAccountApi";
import { encryptChatPayload, decryptChatPayload } from "../lib/chatCrypto";
import { sessionToMarkdown } from "../lib/exportSession";
import { BaseModal } from "./BaseModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { StorageBar } from "./StorageBar";
import { UserAccountModal } from "./UserAccountModal";

function getSessionLabel(session: ChatSession): string {
  const firstUserMsg = session.messages.find((m) => m.role === "user");
  const ts = firstUserMsg?.timestamp ?? session.createdAt;
  const d = new Date(ts);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${d.getFullYear().toString().slice(-2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${session.characterName}-${stamp}`;
}

/** Full-screen overlay shown during cloud sync phases (API check + actual
 *  upload/download). Positioned above all modals (z-[60] > BaseModal's z-50)
 *  so it covers even the ConfirmDialog during the execution phase. */
function CloudBusyOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="bg-white dark:bg-[#1a1a1a] rounded-2xl shadow-2xl border border-gray-200 dark:border-white/10 px-8 py-6 flex flex-col items-center gap-4">
        <div className="w-8 h-8 border-[3px] border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
        <p className="text-sm text-gray-700 dark:text-gray-300 font-medium">{message}</p>
      </div>
    </div>
  );
}

interface ChatHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentSessionId: string | null;
  onSelectSession: (session: ChatSession) => void;
  onSessionsChange: () => void;
  onCurrentSessionDeleted: () => void;
}

export function ChatHistoryModal({
  isOpen,
  onClose,
  currentSessionId,
  onSelectSession,
  onSessionsChange,
  onCurrentSessionDeleted,
}: ChatHistoryModalProps) {
  const sessions = loadSessions();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [storageLimitDialog, setStorageLimitDialog] = useState<{
    label: string;
    usage: number;
    quota: number;
  } | null>(null);
  const [chatUsage, setChatUsage] = useState<number>(0);

  // --- cloud chat-sessions state --------------------------------------------
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudBusyMsg, setCloudBusyMsg] = useState<string | null>(null);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudMeta, setCloudMeta] = useState<{ updated_at: number; count: number } | null>(null);
  const [pendingCloudOp, setPendingCloudOp] = useState<"upload" | "download" | "no_archive" | null>(null);
  const [pendingCloudRaw, setPendingCloudRaw] = useState<Record<string, unknown> | null>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [chatStorageQuota, setChatStorageQuota] = useState<number>(DEFAULT_CHAT_STORAGE_QUOTA);

  /** YY-MM-DD hh:mm in local time from a unix-ms timestamp. */
  function formatCloudTime(ms: number): string {
    const d = new Date(ms);
    const YY = String(d.getFullYear()).slice(2);
    const MM = String(d.getMonth() + 1).padStart(2, "0");
    const DD = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${YY}-${MM}-${DD} ${hh}:${mm}`;
  }

  useEffect(() => {
    if (!isOpen) return;
    estimateChatStorage().then(setChatUsage);
    // Sync storage ceiling from account profile (fallback to default when logged out).
    loadStoredAccount().then((stored) => {
      setChatStorageQuota(stored?.profile.chatStorageMax ?? DEFAULT_CHAT_STORAGE_QUOTA);
    });
  }, [isOpen]);

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

  const handleExportMarkdown = (e: React.MouseEvent, session: ChatSession) => {
    e.stopPropagation();
    const blob = new Blob([sessionToMarkdown(session)], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${getSessionLabel(session)}.md`;
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
      const wasCurrent = pendingDeleteId === currentSessionId;
      deleteSession(pendingDeleteId);
      if (wasCurrent) onCurrentSessionDeleted();
      onSessionsChange();
    }
    setPendingDeleteId(null);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Re-estimate to avoid stale-closure usage value.
    const used = await estimateChatStorage();
    if (file.size > chatStorageQuota) {
      setImportError(`文件过大（${(file.size / 1024 / 1024).toFixed(2)} MB），上限 ${(chatStorageQuota / (1024 * 1024)).toFixed(0)} MB`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    // Capacity check — if import would exceed quota, offer expansion instead of hard-blocking.
    const estAfter = used + file.size * 2; // ×2 for UTF-16 after JSON.parse+stringify
    if (estAfter > chatStorageQuota * 0.95) {
      setStorageLimitDialog({
        label: "聊天记录储存",
        usage: used,
        quota: chatStorageQuota,
      });
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
      await saveSession(session);
      setImportError(null);
      onSessionsChange();
    } catch (err: any) {
      setImportError("导入失败：" + (err?.message || String(err)));
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // --- cloud chat-sessions handlers (cf. SettingsModal cloud settings) --------

  const handleCloudUpload = async () => {
    setCloudError(null);
    const stored = await loadStoredAccount();
    if (!stored) {
      setIsAccountOpen(true);
      return;
    }
    setCloudBusy(true);
    setCloudBusyMsg("正在检测云端存档…");
    try {
      const res = await downloadChatSessions(stored.token);
      if (res.kind === "network") {
        setCloudError("服务器无法连接，请稍后重试");
        return;
      }
      if (res.kind === "timeout") {
        setCloudError("连接超时，请检查网络后重试");
        return;
      }
      if (res.kind === "error") {
        setCloudError(`服务器错误：${res.error}`);
        return;
      }
      if (res.data.exists && res.data.updated_at) {
        setCloudMeta({ updated_at: res.data.updated_at, count: res.data.count ?? -1 });
      } else {
        setCloudMeta(null);
      }
      setPendingCloudOp("upload");
    } finally {
      setCloudBusy(false);
      setCloudBusyMsg(null);
    }
  };

  const handleCloudDownload = async () => {
    setCloudError(null);
    const stored = await loadStoredAccount();
    if (!stored) {
      setIsAccountOpen(true);
      return;
    }
    setCloudBusy(true);
    setCloudBusyMsg("正在检测云端存档…");
    try {
      const res = await downloadChatSessions(stored.token);
      if (res.kind === "network") {
        setCloudError("服务器无法连接，请稍后重试");
        return;
      }
      if (res.kind === "timeout") {
        setCloudError("连接超时，请检查网络后重试");
        return;
      }
      if (res.kind === "error") {
        setCloudError(`服务器错误：${res.error}`);
        return;
      }
      if (!res.data.exists) {
        setPendingCloudOp("no_archive");
        return;
      }
      setCloudMeta({ updated_at: res.data.updated_at ?? 0, count: res.data.count ?? -1 });
      // Store the raw server response (encrypted or legacy plaintext) for the
      // confirm step to decrypt.
      setPendingCloudRaw(res.data as unknown as Record<string, unknown>);
      setPendingCloudOp("download");
    } finally {
      setCloudBusy(false);
      setCloudBusyMsg(null);
    }
  };

  const handleConfirmCloudUpload = async () => {
    setCloudBusy(true);
    setCloudBusyMsg("正在上传聊天记录，请勿关闭页面…");
    try {
      const stored = await loadStoredAccount();
      if (!stored) return;
      const all = loadSessions();
      const encrypted = await encryptChatPayload(all, stored.token);
      const res = await uploadChatSessions(stored.token, encrypted);
      if (res.kind === "network") {
        setCloudError("上传失败：服务器无法连接");
        return;
      }
      if (res.kind === "timeout") {
        setCloudError("上传超时，请检查网络后重试");
        return;
      }
      if (res.kind === "error") {
        setCloudError(`上传失败：${res.error}`);
        return;
      }
      setPendingCloudOp(null);
      setCloudMeta(null);
      estimateChatStorage().then(setChatUsage);
    } catch (err: any) {
      setCloudError("加密失败：" + (err?.message || String(err)));
    } finally {
      setCloudBusy(false);
      setCloudBusyMsg(null);
    }
  };

  const handleConfirmCloudDownload = async () => {
    if (!pendingCloudRaw) return;
    setCloudBusy(true);
    setCloudBusyMsg("正在下载聊天记录，请勿关闭页面…");
    try {
      const stored = await loadStoredAccount();
      if (!stored) { setCloudError("登录已过期，请重新登录"); return; }
      const sessions = await decryptChatPayload(pendingCloudRaw, stored.token);
      await replaceAllSessions(sessions);
      setPendingCloudOp(null);
      setCloudMeta(null);
      setPendingCloudRaw(null);
      onSessionsChange();
      estimateChatStorage().then(setChatUsage);
    } catch (err: any) {
      setCloudError("解密失败：" + (err?.message || String(err)));
    } finally {
      setCloudBusy(false);
      setCloudBusyMsg(null);
    }
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
            {cloudError && (
              <p className="text-xs text-red-500 dark:text-red-400 mb-2 break-all">{cloudError}</p>
            )}
            {importError && (
              <p className="text-xs text-red-500 dark:text-red-400 mb-2 break-all">{importError}</p>
            )}
            <div className="flex gap-3 mb-2">
              <button
                onClick={handleCloudUpload}
                disabled={cloudBusy}
                className="flex-1 px-3 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <CloudUpload size={16} /> 上传记录
              </button>
              <button
                onClick={handleCloudDownload}
                disabled={cloudBusy}
                className="flex-1 px-3 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <CloudDownload size={16} /> 下载记录
              </button>
            </div>
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
          <StorageBar
            label="聊天记录储存"
            usage={chatUsage}
            quota={chatStorageQuota}
            warnMessage="聊天记录存储空间紧张，建议清理旧聊天记录后继续使用"
          />
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
                      onClick={(e) => handleExportMarkdown(e, session)}
                      className="p-1.5 text-gray-400 hover:text-purple-500 hover:bg-purple-50 dark:hover:bg-purple-500/20 rounded-md transition-colors"
                      title="导出 Markdown"
                    >
                      <FileText size={14} />
                    </button>
                    <button
                      onClick={(e) => handleExport(e, session)}
                      className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/20 rounded-md transition-colors"
                      title="导出 JSON"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      onClick={(e) => handleDeleteRequest(e, session.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors"
                      title={currentSessionId === session.id ? "删除当前聊天记录" : "删除"}
                    >
                      <Trash2 size={14} />
                    </button>
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

      {/* Cloud chat-sessions sync confirm dialog */}
      <ConfirmDialog
        isOpen={pendingCloudOp !== null}
        title={
          pendingCloudOp === "upload" ? "上传聊天记录" : "下载聊天记录"
        }
        destructive={pendingCloudOp === "download"}
        confirmText={
          pendingCloudOp === "upload"
            ? cloudMeta
              ? "覆盖云端存档"
              : "创建云端存档"
            : pendingCloudOp === "download"
              ? "替换本地记录"
              : "确定"
        }
        message={
          pendingCloudOp === "upload"
            ? (
              cloudMeta
                ? <>
                    云端存档最后更新于{" "}
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      {formatCloudTime(cloudMeta.updated_at)}
                    </span>
                    {cloudMeta.count > 0 && <>（{cloudMeta.count} 条记录）</>}
                    。上传将覆盖云端存档，是否继续？
                  </>
                : "云端暂无存档，将创建首个存档。是否继续？"
            )
            : pendingCloudOp === "download"
            ? (
              cloudMeta
                ? <>
                    云端存档最后更新于{" "}
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      {formatCloudTime(cloudMeta.updated_at)}
                    </span>
                    {cloudMeta.count > 0 && <>（{cloudMeta.count} 条记录）</>}
                    。下载将
                    <span className="font-semibold text-gray-900 dark:text-gray-100 mx-1">
                      覆盖当前所有本地聊天记录
                    </span>
                    ，是否继续？
                  </>
                : "下载将覆盖当前所有本地聊天记录，是否继续？"
            )
            : "云端暂无存档，请先上传聊天记录。"
        }
        onConfirm={
          pendingCloudOp === "upload"
            ? handleConfirmCloudUpload
            : pendingCloudOp === "download"
              ? handleConfirmCloudDownload
              : () => setPendingCloudOp(null)
        }
        onCancel={() => {
          setPendingCloudOp(null);
          setCloudMeta(null);
          setPendingCloudRaw(null);
        }}
      />

      <UserAccountModal isOpen={isAccountOpen} onClose={() => setIsAccountOpen(false)} />

      {/* Storage limit dialog — offer to expand instead of hard-blocking */}
      <ConfirmDialog
        isOpen={storageLimitDialog !== null}
        title="储存空间不足"
        message={
          storageLimitDialog
            ? `您的「${storageLimitDialog.label}」已用 ${(storageLimitDialog.usage / (1024 * 1024)).toFixed(1)} MB / 上限 ${(storageLimitDialog.quota / (1024 * 1024)).toFixed(0)} MB，无法继续增加。是否前往扩容？`
            : ""
        }
        confirmText="前往扩容"
        cancelText="取消"
        onConfirm={() => {
          setStorageLimitDialog(null);
          setIsAccountOpen(true);
        }}
        onCancel={() => setStorageLimitDialog(null)}
      />

      {cloudBusyMsg && <CloudBusyOverlay message={cloudBusyMsg} />}
    </>
  );
}
