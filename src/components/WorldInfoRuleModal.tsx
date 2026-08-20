import React, { useState, useEffect, useCallback } from "react";
import { Globe, Key, Clock, Shield, User, Repeat, Plus, X as XIcon, Book, Link, Loader2, AlertCircle } from "lucide-react";
import { WorldInfoRule } from "../types";
import { motion } from "motion/react";
import { BaseModal } from "./BaseModal";
import { KnowledgeBaseSelectModal } from "./KnowledgeBaseSelectModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { UserAccountModal } from "./UserAccountModal";
import {
  listKb,
  getKb,
  type KnowledgeBase,
} from "../lib/knowledgeApi";
import {
  loadStoredAccount,
  type StoredAccount,
} from "../lib/sharedAccountApi";

interface WorldInfoRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rule: WorldInfoRule) => void;
  initialRule?: WorldInfoRule | null;
  /** 持久化当前角色（不关闭 Modal），用于未登录/引导创建 KB 前保存。 */
  onPersistCharacter?: () => void;
  /** 打开知识库管理界面（由 CharacterEditModal 管理 isKbManagerOpen）。 */
  onOpenKnowledgeBase?: () => void;
}

type KbStatus = "ok" | "not_found" | "network_error";

export function WorldInfoRuleModal({
  isOpen,
  onClose,
  onSave,
  initialRule,
  onPersistCharacter,
  onOpenKnowledgeBase,
}: WorldInfoRuleModalProps) {
  // --- existing rule fields ---
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<"permanent" | "keywords">("permanent");
  const [keywordDraft, setKeywordDraft] = useState("");
  const [keywords, setKeywords] = useState<string[]>([]);
  const [position, setPosition] = useState<"system" | "assistant">("system");
  const [hard, setHard] = useState(false);
  const [allowRecursion, setAllowRecursion] = useState(false);
  const [content, setContent] = useState("");

  // --- KB linkage state ---
  const [session, setSession] = useState<StoredAccount | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [kbMap, setKbMap] = useState<Map<string, KnowledgeBase>>(new Map());
  const [kbValidation, setKbValidation] = useState<Map<string, KbStatus>>(new Map());
  const [linkedKbIds, setLinkedKbIds] = useState<string[]>([]);
  const [loadingKbs, setLoadingKbs] = useState(false);
  // Offline-safe KB name cache: populated from initialRule on load and from
  // kbMap on save, so names survive page refreshes & network blips.
  const [kbNameCache, setKbNameCache] = useState<Record<string, { name: string; charTotal: number }>>({});

  // --- sub-modals ---
  const [isKbSelectOpen, setIsKbSelectOpen] = useState(false);
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);
  const [staleConfirmOpen, setStaleConfirmOpen] = useState(false);

  // --- reset form on open / rule change ---
  useEffect(() => {
    if (!isOpen) {
      setHydrated(false);
      return;
    }
    if (initialRule) {
      setName(initialRule.name);
      setTriggerType(initialRule.triggerType);
      setKeywordDraft("");
      setKeywords((initialRule.keywords || "").split(",").map((kw) => kw.trim()).filter(Boolean));
      setPosition(initialRule.position);
      setHard(initialRule.hard === true);
      setAllowRecursion(initialRule.allowRecursion === true);
      setContent(initialRule.content);
      setLinkedKbIds(initialRule.linkedKbIds ?? []);
      setKbNameCache(initialRule._linkedKbCache ?? {});
    } else {
      setName("");
      setTriggerType("permanent");
      setKeywordDraft("");
      setKeywords([]);
      setPosition("system");
      setHard(false);
      setAllowRecursion(false);
      setContent("");
      setLinkedKbIds([]);
      setKbNameCache({});
    }
    // Don't reset kbMap / kbValidation here — keep the previously loaded
    // cache so KB names stay resolved while Effect 2 refreshes. If Effect 2
    // fails, the stale-but-usable cache is better than yellow tags + UUIDs.
    setLoadingKbs(false);
    setHydrated(false);
  }, [initialRule, isOpen]);

  // --- hydrate session + KB data on open ---
  // Name display is handled by the offline-safe _linkedKbCache (populated when
  // the user selected KBs in the picker). This effect runs in the background to
  // validate each linked KB's current status. It never downgrades a name that
  // the cache already provides.
  useEffect(() => {
    if (!isOpen || hydrated) return;
    let cancelled = false;
    (async () => {
      const stored = await loadStoredAccount();
      if (cancelled) return;

      const ids = initialRule?.linkedKbIds ?? [];
      const token = stored?.token ?? "";

      if (!stored || !token) {
        setSession(null);
        setHydrated(true);
        return;
      }

      setSession(stored);
      setHydrated(true);

      // Pre-seed validation from cache: if we have a cached name the KB was
      // valid at save time, so start with "ok" and only downgrade on API error.
      const cache = initialRule?._linkedKbCache ?? {};
      const map = new Map<string, KnowledgeBase>();
      const validation = new Map<string, KbStatus>();
      for (const id of ids) {
        const cached = cache[id];
        validation.set(id, cached ? "ok" : "network_error");
        if (cached) {
          map.set(id, { id, name: cached.name, charTotal: cached.charTotal } as KnowledgeBase);
        }
      }
      if (map.size > 0) setKbMap(map);
      if (ids.length > 0) setKbValidation(new Map(validation));

      // Background refresh: verify each linked KB is still accessible.
      for (const id of ids) {
        if (cancelled) return;
        const single = await getKb(token, id);
        if (cancelled) return;
        if (single.kind === "ok") {
          validation.set(id, "ok");
          map.set(id, single.data.kb);
        } else if (single.kind === "error" && single.status === 404) {
          validation.set(id, "not_found");
        } else {
          // Keep existing status — don't downgrade from "ok" on transient errors.
          if (!validation.has(id)) validation.set(id, "network_error");
        }
      }
      if (map.size > 0) setKbMap(new Map(map));
      setKbValidation(new Map(validation));
      setLoadingKbs(false);
    })();
    return () => { cancelled = true; };
  }, [isOpen, hydrated, initialRule]);

  // --- re-hydrate after login modal closes ---
  useEffect(() => {
    if (isLoginModalOpen || !isOpen) return;
    (async () => {
      const stored = await loadStoredAccount();
      if (stored && (!session || stored.token !== session.token)) {
        setSession(stored);
        setHydrated(false); // trigger re-load of KB data
      }
    })();
  }, [isLoginModalOpen, isOpen, session]);

  const token = session?.token ?? "";

  // --- keyword helpers (unchanged) ---
  const addKeyword = () => {
    const keyword = keywordDraft.trim();
    if (!keyword) return;
    if (keywords.includes(keyword)) {
      setKeywordDraft("");
      return;
    }
    setKeywords((prev) => [...prev, keyword]);
    setKeywordDraft("");
  };

  // Add button: if the input contains English commas, split it into multiple
  // trigger words (each comma-separated part becomes its own trigger word).
  // Otherwise behave exactly like addKeyword (a single trigger word).
  const handleAddKeywords = () => {
    const trimmed = keywordDraft.trim();
    if (!trimmed) return;
    const parts = trimmed.split(",").map((kw) => kw.trim()).filter(Boolean);
    setKeywords((prev) => {
      const next = [...prev];
      for (const kw of parts) {
        if (kw && !next.includes(kw)) next.push(kw);
      }
      return next;
    });
    setKeywordDraft("");
  };

  const removeKeyword = (keyword: string) => {
    setKeywords(keywords.filter((kw) => kw !== keyword));
  };

  // --- build rule object (shared by handleSave and login gate) ---
  const buildRule = useCallback((): WorldInfoRule => ({
    id: initialRule?.id || Date.now().toString(),
    name: name.trim(),
    triggerType,
    keywords: triggerType === "keywords" ? keywords.join(",") : undefined,
    position,
    hard,
    allowRecursion: triggerType === "keywords" ? allowRecursion : undefined,
    content: content.trim(),
    enabled: initialRule ? initialRule.enabled : true,
    linkedKbIds: linkedKbIds.length > 0 ? linkedKbIds : undefined,
    _linkedKbCache: Object.keys(kbNameCache).length > 0 ? kbNameCache : undefined,
  }), [initialRule, name, triggerType, keywords, position, hard, allowRecursion, content, linkedKbIds, kbNameCache]);

  // --- save handler with stale-KB blocking ---
  const handleSave = () => {
    if (!name.trim() || !content.trim()) return;

    // Check for definitely-deleted KBs (404 — block save)
    const staleIds = Array.from(kbValidation.entries())
      .filter(([, status]) => status === "not_found")
      .map(([id]) => id);

    if (staleIds.length > 0) {
      setStaleConfirmOpen(true);
      return;
    }

    onSave(buildRule());
    onClose();
  };

  // --- stale KB cleanup ---
  const handleClearStale = () => {
    const staleIds = new Set(
      Array.from(kbValidation.entries())
        .filter(([, s]) => s === "not_found")
        .map(([id]) => id)
    );
    setLinkedKbIds((prev) => prev.filter((id) => !staleIds.has(id)));
    setKbValidation((prev) => {
      const next = new Map(prev);
      for (const id of staleIds) next.delete(id);
      return next;
    });
    setStaleConfirmOpen(false);
    // Proceed with save after cleanup
    const rule = buildRule();
    // Rebuild without stale IDs (already filtered from linkedKbIds)
    const cleanRule: WorldInfoRule = {
      ...rule,
      linkedKbIds: linkedKbIds.filter((id) => !staleIds.has(id)).length > 0
        ? linkedKbIds.filter((id) => !staleIds.has(id))
        : undefined,
    };
    onSave(cleanRule);
    onClose();
  };

  // --- open KB selector (with login gate) ---
  const handleOpenKbSelect = () => {
    if (!session) {
      // Save rule entry + persist character before showing login
      const rule = buildRule();
      onSave(rule);
      onPersistCharacter?.();
      setIsLoginModalOpen(true);
      return;
    }
    // Refresh KB list before opening selector (in case of changes)
    setLoadingKbs(true);
    listKb(token).then((res) => {
      setLoadingKbs(false);
      if (res.kind === "ok") {
        const map = new Map<string, KnowledgeBase>();
        for (const kb of res.data.items) map.set(kb.id, kb);
        setKbMap(map);
        // Also bump hydration so we don't stale-cache
        setHydrated(true);
      }
      setIsKbSelectOpen(true);
    });
  };

  // --- KB select confirm ---
  const handleKbSelectConfirm = (selectedIds: string[]) => {
    setLinkedKbIds(selectedIds);
    // Persist KB names into the offline-safe cache so names survive page
    // refreshes even when the hydration API call hasn't completed yet.
    const cache: Record<string, { name: string; charTotal: number }> = {};
    for (const id of selectedIds) {
      const kb = kbMap.get(id);
      if (kb) cache[id] = { name: kb.name, charTotal: kb.charTotal };
    }
    setKbNameCache(cache);
    // Incrementally validate new selections
    const validation = new Map(kbValidation);
    for (const id of selectedIds) {
      if (!validation.has(id)) {
        validation.set(id, kbMap.has(id) ? "ok" : "network_error");
      }
    }
    // Remove validations for deselected IDs
    for (const id of Array.from(validation.keys())) {
      if (!selectedIds.includes(id)) validation.delete(id);
    }
    setKbValidation(validation);
  };

  // --- remove single linked KB ---
  const removeLinkedKb = (id: string) => {
    setLinkedKbIds((prev) => prev.filter((x) => x !== id));
    setKbValidation((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  };

  // --- resolve display info for a KB id ---
  const resolveKbInfo = (id: string): { name: string; tokenStr: string } => {
    // 1) Offline-safe cache (written on save, survives page refresh).
    const cached = kbNameCache[id];
    if (cached) {
      const chars = cached.charTotal;
      const tokenStr = chars < 1000 ? `${chars} 字符` : chars < 10000 ? `${(chars / 1000).toFixed(1)}k` : `${(chars / 1000).toFixed(0)}k`;
      return { name: cached.name, tokenStr };
    }
    // 2) Live kbMap (from hydration or KB selector).
    const kb = kbMap.get(id);
    if (kb) {
      const chars = kb.charTotal;
      const tokenStr = chars < 1000 ? `${chars} 字符` : chars < 10000 ? `${(chars / 1000).toFixed(1)}k` : `${(chars / 1000).toFixed(0)}k`;
      return { name: kb.name, tokenStr };
    }
    // 3) Fallback: show truncated id.
    return { name: id.length > 12 ? `${id.slice(0, 10)}…` : id, tokenStr: "" };
  };

  // --- UI helpers ---
  const inputCls =
    "w-full px-4 py-3 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none";

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title={initialRule ? "编辑规则条目" : "添加规则条目"}
        titleIcon={<Globe size={16} className="text-blue-600 dark:text-blue-400" />}
        maxWidth="max-w-lg"
        footer={
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-white rounded-xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-white/10 transition-all"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || !content.trim()}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-blue-500/20"
            >
              确认保存
            </button>
          </div>
        }
      >
        <div className="p-6 space-y-5">
          {/* --- Name --- */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1">
              条目名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：地理环境、性格补完..."
              className={inputCls}
            />
          </div>

          {/* --- Trigger type --- */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1 text-center sm:text-left">
              触发方式
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setTriggerType("permanent")}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                  triggerType === "permanent"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500"
                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                }`}
              >
                <Clock size={16} /> 🔵 永久
              </button>
              <button
                type="button"
                onClick={() => setTriggerType("keywords")}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                  triggerType === "keywords"
                    ? "border-green-500 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500"
                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                }`}
              >
                <Key size={16} /> 🟢 关键词
              </button>
            </div>

            {triggerType === "keywords" && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                className="mt-3 overflow-hidden"
              >
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={keywordDraft}
                    onChange={(e) => setKeywordDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addKeyword();
                      }
                    }}
                    placeholder="输入单个触发词"
                    className="flex-1 min-w-0 px-4 py-3 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleAddKeywords}
                    className="px-4 py-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-2xl transition-all flex items-center gap-1"
                  >
                    <Plus size={14} /> 添加
                  </button>
                </div>
                <p className="text-[10px] text-gray-500 mt-1.5 px-1 italic">
                  输入一个触发词后按 Enter 或点击添加；每个触发词会单独显示在下方。
                </p>
                {keywords.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {keywords.map((keyword) => (
                      <span
                        key={keyword}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 text-xs font-medium text-green-700 dark:text-green-300 bg-green-500/10 border border-green-500/20 rounded-lg"
                      >
                        {keyword}
                        <button
                          type="button"
                          onClick={() => removeKeyword(keyword)}
                          className="p-0.5 text-green-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                          title="删除触发词"
                        >
                          <XIcon size={12} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => setAllowRecursion((v) => !v)}
                  className={`mt-3 w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                    allowRecursion
                      ? "border-green-500 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500"
                      : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Repeat size={16} /> 允许其他条目激活
                  </span>
                  <span
                    className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                      allowRecursion ? "bg-green-500" : "bg-gray-300 dark:bg-white/20"
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        allowRecursion ? "translate-x-4" : "translate-x-0.5"
                      }`}
                    />
                  </span>
                </button>
                <p className="text-[10px] text-gray-500 mt-1.5 px-1 italic">
                  开启后，本条目可被其他已激活条目的内容触发，其内容也会参与触发下游条目（递归激活）。默认关闭，仅响应用户输入。
                </p>
              </motion.div>
            )}
          </div>

          {/* --- Insert position --- */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1">
              插入位置
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setPosition("system")}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                  position === "system"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500"
                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                }`}
              >
                <Shield size={16} /> ⚙系统
              </button>
              <button
                type="button"
                onClick={() => setPosition("assistant")}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                  position === "assistant"
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500"
                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                }`}
              >
                <User size={16} /> 🤖角色
              </button>
            </div>
          </div>

          {/* --- Hard/Soft --- */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1">
              约束强度
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setHard(false)}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                  !hard
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500"
                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                }`}
              >
                🌿 软设定
              </button>
              <button
                type="button"
                onClick={() => setHard(true)}
                className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                  hard
                    ? "border-red-500 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-500"
                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                }`}
              >
                🛡️ 硬约束
              </button>
            </div>
            <p className="text-[10px] text-gray-500 mt-1.5 px-1 italic">
              软设定：与用户最新发言冲突时让位（外貌 / 背景 / 口癖等）。硬约束：冲突时优先（世界观铁律 / 安全边界）。
            </p>
          </div>

          {/* --- Rule content --- */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1 flex justify-between">
              <span>规则内容</span>
              <span className="text-[10px] lowercase normal-case">支持 Markdown 格式</span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="在此输入当规则触发时需要注入的内容..."
              className="w-full h-32 px-4 py-3 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none resize-none font-sans"
            />
          </div>

          {/* ====== Knowledge Base Linkage ====== */}
          <div>
            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1 flex items-center gap-1.5">
              <Book size={12} />
              关联知识库
              {loadingKbs && <Loader2 size={12} className="animate-spin text-gray-400" />}
            </label>

            {/* Linked KB tags */}
            {linkedKbIds.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {linkedKbIds.map((id) => {
                  const status = kbValidation.get(id) ?? "network_error";
                  const info = resolveKbInfo(id);
                  const isStale = status === "not_found";
                  const isNetworkErr = status === "network_error";
                  return (
                    <span
                      key={id}
                      className={`inline-flex items-center gap-1 pl-2.5 pr-1 py-1 text-xs font-medium rounded-lg border transition-colors ${
                        isStale
                          ? "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20"
                          : isNetworkErr
                            ? "text-amber-600 dark:text-amber-400 bg-amber-500/10 border-amber-500/20"
                            : "text-blue-600 dark:text-blue-400 bg-blue-500/10 border-blue-500/20"
                      }`}
                      title={
                        isStale
                          ? "此知识库已被删除"
                          : isNetworkErr
                            ? "无法验证此知识库状态"
                            : `${info.name} · ${info.tokenStr}`
                      }
                    >
                      <Book size={11} />
                      <span>{info.name}</span>
                      {isStale && (
                        <span className="text-[10px] opacity-70 ml-0.5">（已删除）</span>
                      )}
                      {isNetworkErr && (
                        <AlertCircle size={11} className="opacity-60" />
                      )}
                      <button
                        type="button"
                        onClick={() => removeLinkedKb(id)}
                        className={`p-0.5 rounded transition-colors ${
                          isStale
                            ? "text-red-400 hover:text-red-600 hover:bg-red-500/20"
                            : "text-blue-400 hover:text-red-500 hover:bg-red-500/10"
                        }`}
                        title="取消关联"
                      >
                        <XIcon size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            ) : (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-2 px-1 italic">
                暂无关联知识库
              </p>
            )}

            {/* Link KB button */}
            <button
              type="button"
              onClick={handleOpenKbSelect}
              disabled={loadingKbs}
              className="w-full px-4 py-2 bg-transparent border border-gray-200 border-dashed dark:border-white/20 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loadingKbs ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Link size={14} />
              )}
              关联知识库
            </button>
          </div>
        </div>
      </BaseModal>

      {/* Sub-modal: KB multi-select */}
      {session && (
        <KnowledgeBaseSelectModal
          isOpen={isKbSelectOpen}
          onClose={() => setIsKbSelectOpen(false)}
          kbList={Array.from(kbMap.values())}
          initialSelectedIds={linkedKbIds}
          onConfirm={handleKbSelectConfirm}
          onCreateNew={() => {
            // Save rule + persist character, then open KB manager
            const rule = buildRule();
            onSave(rule);
            onPersistCharacter?.();
            onOpenKnowledgeBase?.();
          }}
        />
      )}

      {/* Sub-modal: login */}
      <UserAccountModal
        isOpen={isLoginModalOpen}
        onClose={() => setIsLoginModalOpen(false)}
      />

      {/* Sub-modal: stale KB cleanup confirmation */}
      <ConfirmDialog
        isOpen={staleConfirmOpen}
        title="失效的知识库关联"
        message={
          <div className="space-y-2">
            <p>以下知识库已被删除，关联已失效：</p>
            <ul className="list-disc list-inside text-sm text-red-600 dark:text-red-400 space-y-0.5">
              {Array.from(kbValidation.entries())
                .filter(([, s]) => s === "not_found")
                .map(([id]) => {
                  const info = resolveKbInfo(id);
                  return <li key={id}>{info.name}</li>;
                })}
            </ul>
            <p className="text-sm mt-2">
              是否自动移除失效关联后保存？选择"取消"可返回手动处理。
            </p>
          </div>
        }
        confirmText="移除并保存"
        cancelText="返回修改"
        destructive
        onConfirm={handleClearStale}
        onCancel={() => setStaleConfirmOpen(false)}
      />
    </>
  );
}
