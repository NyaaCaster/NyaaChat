import React, { useCallback, useEffect, useState } from "react";
import { Book, Plus, Settings, Edit2, Trash2, Loader2, AlertTriangle, IdCard } from "lucide-react";
import { BaseModal } from "./BaseModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { UserAccountModal } from "./UserAccountModal";
import { EmbeddingConfigModal } from "./EmbeddingConfigModal";
import { KnowledgeBaseEditModal } from "./KnowledgeBaseEditModal";
import {
  listKb,
  createKb,
  deleteKb,
  getEmbeddingConfig,
  expandKb,
  type KnowledgeBase,
} from "../lib/knowledgeApi";
import {
  loadStoredAccount,
  saveStoredAccount,
  fetchProfile,
  type StoredAccount,
} from "../lib/sharedAccountApi";

interface KnowledgeBaseModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const KB_COST = 5;
const KB_HARD_LIMIT = 50;

function formatTokenCount(charTotal: number): string {
  if (charTotal < 1000) return `${charTotal} 字符`;
  if (charTotal < 10000) return `${(charTotal / 1000).toFixed(1)}k 字符`;
  return `${(charTotal / 1000).toFixed(0)}k 字符`;
}

export function KnowledgeBaseModal({ isOpen, onClose }: KnowledgeBaseModalProps) {
  // session
  const [session, setSession] = useState<StoredAccount | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);

  // data
  const [kbs, setKbs] = useState<KnowledgeBase[]>([]);
  const [kbMax, setKbMax] = useState(3);
  const [catfood, setCatfood] = useState(0);
  const [embedConfigured, setEmbedConfigured] = useState(true);
  const [loading, setLoading] = useState(false);

  // sub-modals
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isEmbeddingOpen, setIsEmbeddingOpen] = useState(false);
  const [editingKb, setEditingKb] = useState<KnowledgeBase | null>(null);
  const [pendingDeleteKb, setPendingDeleteKb] = useState<KnowledgeBase | null>(null);
  const [expanding, setExpanding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [autoOpenedConfig, setAutoOpenedConfig] = useState(false);

  // ui
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [expandPrompt, setExpandPrompt] = useState(false);

  const flash = (kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 3000);
  };

  const token = session?.token ?? "";

  // load everything on open
  const loadData = useCallback(async () => {
    const stored = await loadStoredAccount();
    if (!stored) {
      setSession(null);
      setHydrated(true);
      return;
    }
    setSession(stored);
    setHydrated(true);

    // Fetch live profile to get current kbMax / catfood from server
    // (may have changed since the IDB-cached login, e.g. migration 5→3).
    const profileRes = await fetchProfile(stored.token);
    if (profileRes.kind === "ok") {
      setCatfood(profileRes.data.profile.catfood ?? 0);
      setKbMax(profileRes.data.profile.kbMax ?? 3);
    } else {
      setCatfood(stored.profile.catfood ?? 0);
      setKbMax(stored.profile.kbMax ?? 3);
    }

    setLoading(true);
    const [kbRes, cfgRes] = await Promise.all([
      listKb(stored.token),
      getEmbeddingConfig(stored.token),
    ]);
    setLoading(false);

    if (kbRes.kind === "ok") setKbs(kbRes.data.items);
    if (cfgRes.kind === "ok") {
      const configured = cfgRes.data.configured;
      setEmbedConfigured(configured);
      if (!configured && !autoOpenedConfig) {
        setAutoOpenedConfig(true);
        // small delay so the main modal renders first
        setTimeout(() => setIsEmbeddingOpen(true), 200);
      }
    }
  }, [autoOpenedConfig]);

  useEffect(() => {
    if (!isOpen) {
      setHydrated(false);
      setAutoOpenedConfig(false);
      setExpandPrompt(false);
      return;
    }
    loadData();
  }, [isOpen, loadData]);

  // re-validate session when account modal closes
  useEffect(() => {
    if (isAccountOpen || !isOpen) return;
    (async () => {
      const stored = await loadStoredAccount();
      if (stored && (!session || stored.token !== session.token)) {
        setSession(stored);
        setCatfood(stored.profile.catfood ?? 0);
        setKbMax(stored.profile.kbMax ?? 3);
        // re-load data with new token
        const [kbRes, cfgRes] = await Promise.all([
          listKb(stored.token),
          getEmbeddingConfig(stored.token),
        ]);
        if (kbRes.kind === "ok") setKbs(kbRes.data.items);
        if (cfgRes.kind === "ok") {
          const configured = cfgRes.data.configured;
          setEmbedConfigured(configured);
          if (!configured && !autoOpenedConfig) {
            setAutoOpenedConfig(true);
            setTimeout(() => setIsEmbeddingOpen(true), 200);
          }
        }
      }
    })();
  }, [isAccountOpen, isOpen, session, autoOpenedConfig]);

  // create KB
  const handleCreate = useCallback(async () => {
    if (creating) return;
    // P7: client-side pre-check before hitting the API
    if (kbs.length >= kbMax) {
      if (kbMax >= KB_HARD_LIMIT) {
        flash("err", `知识库数量已达最大值（${KB_HARD_LIMIT}）`);
      } else {
        setExpandPrompt(true);
      }
      return;
    }
    setCreating(true);
    const res = await createKb(token, { name: "未命名知识库", description: "" });
    setCreating(false);

    if (res.kind === "ok") {
      setKbs((prev) => [res.data.kb, ...prev]);
      flash("ok", "知识库已创建");
      // auto-open edit
      setEditingKb(res.data.kb);
    } else if (res.kind === "error" && res.error === "kb_max_reached") {
      setExpandPrompt(true);
    } else {
      flash("err", res.kind === "network" ? "服务器无法连接" : "创建失败");
    }
  }, [token, creating]);

  // delete KB
  const handleDeleteConfirm = useCallback(async () => {
    if (!pendingDeleteKb) return;
    const kb = pendingDeleteKb;
    setPendingDeleteKb(null);
    const res = await deleteKb(token, kb.id);
    if (res.kind === "ok") {
      setKbs((prev) => prev.filter((k) => k.id !== kb.id));
      flash("ok", `知识库「${kb.name}」已删除`);
    } else {
      flash("err", res.kind === "network" ? "服务器无法连接" : "删除失败");
    }
  }, [token, pendingDeleteKb]);

  // expand
  const handleExpand = useCallback(async () => {
    if (expanding || kbMax >= KB_HARD_LIMIT) return;
    if (catfood < KB_COST) {
      flash("err", "猫粮余额不足");
      return;
    }
    setExpanding(true);
    setExpandPrompt(false);
    const res = await expandKb(token);
    setExpanding(false);
    if (res.kind === "ok") {
      const profile = res.data.profile;
      setKbMax(profile.kbMax);
      setCatfood(profile.catfood);
      if (session) {
        const next = { token: session.token, profile };
        setSession(next);
        await saveStoredAccount(next);
      }
      flash("ok", `已扩容 +1，扣除 ${KB_COST} 猫粮`);
    } else {
      flash(
        "err",
        res.kind === "network"
          ? "服务器无法连接"
          : res.error === "insufficient"
            ? "猫粮余额不足"
            : res.error || "扩容失败",
      );
    }
  }, [expanding, kbMax, catfood, token, session]);

  const handleEmbeddingSaved = useCallback(() => {
    setEmbedConfigured(true);
    // Refresh KB list in case something changed
    if (token) {
      listKb(token).then((res) => {
        if (res.kind === "ok") setKbs(res.data.items);
      });
    }
  }, [token]);

  const handleKbUpdated = useCallback((updated: KnowledgeBase) => {
    setKbs((prev) => prev.map((k) => (k.id === updated.id ? updated : k)));
  }, []);

  const inputCls =
    "w-full px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow";

  // --- render: login gate ---
  const renderBody = () => {
    if (!hydrated) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      );
    }

    if (!session) {
      return (
        <div className="p-4 sm:p-5 space-y-4">
          <div className="text-center py-8 space-y-4">
            <IdCard size={40} className="mx-auto text-gray-300 dark:text-white/20" />
            <p className="text-sm text-gray-500 dark:text-gray-400">
              请先登录以使用知识库功能
            </p>
            <button
              onClick={() => setIsAccountOpen(true)}
              disabled={loggingIn}
              className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center gap-2 mx-auto hover:shadow-glow disabled:opacity-50"
            >
              {loggingIn && <Loader2 size={16} className="animate-spin" />}
              去登录
            </button>
          </div>
        </div>
      );
    }

    if (loading) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={24} className="animate-spin text-gray-400" />
        </div>
      );
    }

    const atLimit = kbs.length >= kbMax;
    const pct = kbMax > 0 ? Math.min(100, (kbs.length / kbMax) * 100) : 0;

    return (
      <div className="p-4 sm:p-5 min-h-[200px]">
        {/* notice */}
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

        {/* storage bar — custom for KB count (not bytes) */}
        <div className="mb-3 px-1">
          <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 mb-1">
            <span className="flex items-center gap-1">
              <Book size={12} />
              知识库用量
            </span>
            <span>
              {kbs.length} / {kbMax} 个{atLimit ? "（已达上限）" : ""}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                pct >= 80 ? "bg-amber-500" : "bg-blue-500"
              }`}
              style={{ width: `${Math.max(pct, 2)}%` }}
            />
          </div>
          {atLimit && (
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[11px] text-amber-600 dark:text-amber-400">
                ⚠ 知识库数量已达上限
              </p>
              <button
                onClick={handleExpand}
                disabled={expanding || kbMax >= KB_HARD_LIMIT}
                className="text-[11px] font-medium text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors disabled:opacity-50"
              >
                {expanding ? (
                  <Loader2 size={12} className="animate-spin inline" />
                ) : kbMax >= KB_HARD_LIMIT ? (
                  "已达最大上限"
                ) : (
                  `扩容 +1（${KB_COST} 猫粮）`
                )}
              </button>
            </div>
          )}
        </div>

        {/* expand prompt dialog (inline) */}
        {expandPrompt && (
          <div className="mb-3 flex items-start gap-2 text-sm text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span className="flex-1">
              知识库数量已达上限（{kbMax}个）
              {kbMax >= KB_HARD_LIMIT
                ? "，已达最大值（50）"
                : `，是否扩容？（${KB_COST} 猫粮 / +1）`}
            </span>
            {kbMax < KB_HARD_LIMIT && (
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => setExpandPrompt(false)}
                  className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                >
                  取消
                </button>
                <button
                  onClick={handleExpand}
                  disabled={expanding}
                  className="text-xs font-medium text-amber-700 dark:text-amber-300 hover:text-amber-800 dark:hover:text-amber-200 disabled:opacity-50"
                >
                  {expanding ? "扩容中..." : "前往扩容"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* KB card grid */}
        {kbs.length === 0 ? (
          <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-xl">
            暂无知识库，点击下方按钮创建
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {kbs.map((kb) => (
              <div
                key={kb.id}
                className="flex items-start text-left p-4 rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20 transition-all duration-200 group relative"
              >
                <div className="flex-1 min-w-0 pr-20">
                  <h4 className="text-base font-medium text-gray-900 dark:text-gray-100 mb-1">
                    {kb.name}
                  </h4>
                  {kb.description && (
                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2 mb-2">
                      {kb.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 text-[11px] text-gray-400 dark:text-gray-500">
                    <span>{formatTokenCount(kb.charTotal)}</span>
                    <span>·</span>
                    <span>{kb.documentCount} 个文档</span>
                    <span>·</span>
                    <span>{kb.chunkCount} 个分块</span>
                  </div>
                </div>

                <div className="absolute right-4 top-4 flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingKb(kb);
                    }}
                    className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/20 rounded-md transition-colors"
                    title="编辑知识库"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPendingDeleteKb(kb);
                    }}
                    className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors"
                    title="删除知识库"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="知识库管理"
        titleIcon={<Book size={16} className="text-blue-600 dark:text-blue-400" />}
        titleAction={
          session && (
            <button
              onClick={() => setIsEmbeddingOpen(true)}
              className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-all"
              title="嵌入模型配置"
            >
              <Settings size={16} />
            </button>
          )
        }
        maxWidth="max-w-lg"
        footer={
          session && (
            <button
              onClick={handleCreate}
              disabled={creating}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 hover:shadow-glow"
            >
              {creating ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Plus size={16} />
              )}
              新建知识库
            </button>
          )
        }
      >
        {renderBody()}
      </BaseModal>

      {/* sub-modals */}
      <UserAccountModal
        isOpen={isAccountOpen}
        onClose={() => setIsAccountOpen(false)}
      />

      {session && (
        <EmbeddingConfigModal
          isOpen={isEmbeddingOpen}
          onClose={() => setIsEmbeddingOpen(false)}
          token={token}
          onSaved={handleEmbeddingSaved}
        />
      )}

      {session && editingKb && (
        <KnowledgeBaseEditModal
          isOpen={editingKb !== null}
          onClose={() => setEditingKb(null)}
          token={token}
          kb={editingKb}
          onUpdated={handleKbUpdated}
        />
      )}

      <ConfirmDialog
        isOpen={pendingDeleteKb !== null}
        title="删除知识库"
        message={
          pendingDeleteKb
            ? `确定要删除知识库「${pendingDeleteKb.name}」吗？删除后所有文档和向量数据将永久丢失，此操作不可撤销。`
            : ""
        }
        destructive
        confirmText="删除"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDeleteKb(null)}
      />
    </>
  );
}
