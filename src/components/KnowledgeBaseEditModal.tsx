import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  X,
  Trash2,
  Upload,
  FileText,
  Loader2,
} from "lucide-react";
import { BaseModal } from "./BaseModal";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  getKb,
  updateKb,
  listDocuments,
  uploadDocuments,
  deleteDocument,
  type KnowledgeBase,
  type KnowledgeDocument,
} from "../lib/knowledgeApi";

interface KnowledgeBaseEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  token: string;
  kb: KnowledgeBase;
  onUpdated: (kb: KnowledgeBase) => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTokenCount(charTotal: number): string {
  if (charTotal < 1000) return `${charTotal} 字符`;
  if (charTotal < 10000) return `${(charTotal / 1000).toFixed(1)}k 字符`;
  return `${(charTotal / 1000).toFixed(0)}k 字符`;
}

function extLabel(ext: string): { text: string; color: string } {
  switch (ext) {
    case ".txt":
      return { text: "TXT", color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" };
    case ".md":
      return { text: "MD", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" };
    case ".pdf":
      return { text: "PDF", color: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" };
    default:
      return { text: ext.slice(1).toUpperCase(), color: "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300" };
  }
}

export function KnowledgeBaseEditModal({
  isOpen,
  onClose,
  token,
  kb: initialKb,
  onUpdated,
}: KnowledgeBaseEditModalProps) {
  const [kb, setKb] = useState<KnowledgeBase>(initialKb);
  const [docs, setDocs] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(initialKb.name);
  const [uploading, setUploading] = useState(false);
  const [pendingDeleteDoc, setPendingDeleteDoc] = useState<KnowledgeDocument | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const flash = (kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 3000);
  };

  // load KB detail + documents on open
  useEffect(() => {
    if (!isOpen) return;
    setKb(initialKb);
    setNameDraft(initialKb.name);
    setNotice(null);
    (async () => {
      setLoading(true);
      const [kbRes, docRes] = await Promise.all([
        getKb(token, initialKb.id),
        listDocuments(token, initialKb.id),
      ]);
      setLoading(false);
      if (kbRes.kind === "ok") {
        setKb(kbRes.data.kb);
        setNameDraft(kbRes.data.kb.name);
      }
      if (docRes.kind === "ok") {
        setDocs(docRes.data.items);
      }
    })();
  }, [isOpen, token, initialKb.id]);

  // rename
  const saveName = useCallback(async () => {
    const v = nameDraft.trim();
    if (!v || v === kb.name) {
      setRenaming(false);
      setNameDraft(kb.name);
      return;
    }
    const res = await updateKb(token, kb.id, { name: v });
    if (res.kind === "ok") {
      setKb(res.data.kb);
      onUpdated(res.data.kb);
      flash("ok", "名称已更新");
    } else {
      flash("err", res.kind === "network" ? "服务器无法连接" : "改名失败");
    }
    setRenaming(false);
  }, [token, kb, nameDraft, onUpdated]);

  // upload
  const handleUpload = useCallback(async () => {
    fileInputRef.current?.click();
  }, []);

  const handleFiles = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setUploading(true);
      const allowedExts = [".txt", ".md", ".pdf"];
      const items = await Promise.all(
        Array.from(files).map(async (file) => {
          // Read as base64 (FileReader for large files, btoa for small)
          const buffer = await file.arrayBuffer();
          const bytes = new Uint8Array(buffer);
          // Use a chunked approach for base64 encoding to avoid stack overflow on large files
          let base64 = "";
          const chunkSize = 8192;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const chunk = bytes.subarray(i, i + chunkSize);
            base64 += String.fromCharCode(...chunk);
          }
          base64 = btoa(base64);
          return { filename: file.name, data: base64 };
        }),
      );

      // Filter unsupported files (client-side check, though server also validates)
      const valid = items.filter((item) => {
        const ext = "." + (item.filename.split(".").pop()?.toLowerCase() ?? "");
        return allowedExts.includes(ext);
      });
      if (valid.length === 0) {
        flash("err", `不支持的文件格式（支持: ${allowedExts.join(", ")}）`);
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      const res = await uploadDocuments(token, kb.id, valid);
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";

      if (res.kind === "ok") {
        const failed = res.data.results.filter((r) => !r.ok);
        const okCount = res.data.results.filter((r) => r.ok).length;
        if (okCount > 0) flash("ok", `${okCount} 个文档上传成功`);
        if (failed.length > 0) {
          flash("err", failed.map((r) => `${r.filename}: ${r.error}`).join("; "));
        }
        // Refresh
        const [kbRes, docRes] = await Promise.all([
          getKb(token, kb.id),
          listDocuments(token, kb.id),
        ]);
        if (kbRes.kind === "ok") {
          setKb(kbRes.data.kb);
          onUpdated(kbRes.data.kb);
        }
        if (docRes.kind === "ok") setDocs(docRes.data.items);
      } else {
        flash(
          "err",
          res.kind === "network"
            ? "服务器无法连接"
            : res.error || "上传失败",
        );
      }
    },
    [token, kb.id, onUpdated],
  );

  // delete document
  const handleDeleteDoc = useCallback(async () => {
    if (!pendingDeleteDoc) return;
    const doc = pendingDeleteDoc;
    setPendingDeleteDoc(null);
    const res = await deleteDocument(token, doc.id);
    if (res.kind === "ok") {
      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      // Refresh KB to update charTotal
      const kbRes = await getKb(token, kb.id);
      if (kbRes.kind === "ok") {
        setKb(kbRes.data.kb);
        onUpdated(kbRes.data.kb);
      }
      flash("ok", `文档「${doc.name}」已删除`);
    } else {
      flash("err", res.kind === "network" ? "服务器无法连接" : "删除失败");
    }
  }, [token, kb.id, pendingDeleteDoc, onUpdated]);

  const inputCls =
    "px-2 py-1 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow";

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title={
          renaming ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                className={inputCls}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") {
                    setRenaming(false);
                    setNameDraft(kb.name);
                  }
                }}
                autoFocus
                data-autofocus
              />
              <button
                onClick={saveName}
                className="p-1 text-green-500 hover:text-green-600 transition-colors"
                title="确认"
              >
                <Check size={16} />
              </button>
              <button
                onClick={() => {
                  setRenaming(false);
                  setNameDraft(kb.name);
                }}
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
                title="取消"
              >
                <X size={16} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setRenaming(true)}
              className="hover:text-blue-500 transition-colors cursor-pointer"
              title="点击改名"
            >
              {kb.name}
            </button>
          )
        }
        titleIcon={<FileText size={16} className="text-blue-600 dark:text-blue-400" />}
        maxWidth="max-w-lg"
        footer={
          <>
            <input
              type="file"
              accept=".txt,.md,.pdf"
              multiple
              className="hidden"
              ref={fileInputRef}
              onChange={handleFiles}
            />
            <button
              onClick={handleUpload}
              disabled={uploading}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 hover:shadow-glow"
            >
              {uploading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Upload size={16} />
              )}
              {uploading ? "上传中..." : "上传文档"}
            </button>
          </>
        }
      >
        <div className="p-4 sm:p-5 min-h-[200px]">
          {notice && (
            <div
              className={`mb-3 text-sm rounded-xl px-3 py-2 border ${
                notice.kind === "ok"
                  ? "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20"
                  : "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20"
              }`}
            >
              {notice.text}
            </div>
          )}

          {/* token count */}
          <div className="mb-4 px-1">
            <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 mb-1">
              <span>知识库字符数</span>
              <span>{formatTokenCount(kb.charTotal)}</span>
            </div>
          </div>

          {/* doc count */}
          <div className="mb-4 px-1">
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {docs.length} 个文档
            </p>
          </div>

          <div className="border-t border-gray-100 dark:border-white/5 pt-3">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={24} className="animate-spin text-gray-400" />
              </div>
            ) : docs.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400 dark:text-gray-500 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-xl">
                暂无文档，请点击下方按钮上传
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {docs.map((doc) => {
                  const ext = extLabel(doc.ext);
                  return (
                    <div
                      key={doc.id}
                      className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 group"
                    >
                      <span
                        className={`flex-shrink-0 px-2 py-0.5 text-[10px] font-semibold rounded-md ${ext.color}`}
                      >
                        {ext.text}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                          {doc.name}
                        </p>
                        <p className="text-[11px] text-gray-400 dark:text-gray-500">
                          {formatSize(doc.sizeBytes)} · {doc.chunkCount} 个分块
                        </p>
                      </div>
                      <button
                        onClick={() => setPendingDeleteDoc(doc)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                        title="删除文档"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </BaseModal>

      <ConfirmDialog
        isOpen={pendingDeleteDoc !== null}
        title="删除文档"
        message={
          pendingDeleteDoc
            ? `确定要删除文档「${pendingDeleteDoc.name}」吗？此操作不可恢复，文档的所有分块和向量数据将被永久清除。`
            : ""
        }
        destructive
        confirmText="删除"
        onConfirm={handleDeleteDoc}
        onCancel={() => setPendingDeleteDoc(null)}
      />
    </>
  );
}
