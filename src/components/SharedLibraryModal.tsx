// Browse the shared-character library (phase 3) — read-only.
//
// Opened from CharacterSelectionModal's title bar (共享角色库 entry). Lists all
// published shared characters with text search, sort (update / downloads /
// likes / dislikes, toggling asc/desc), an exact tag filter, and a clickable
// author-name filter — per the design's library spec.
//
// Deliberately browse-only this phase: the entries render their full public
// info (cover, name, author, source, update time, intro, prices, counts) but
// carry NO action buttons. 使用 / 买断 land in phase 4, 编辑 / 删除 in phase 5.
//
// Layout: PC = left sidebar (search + sort + tag list) + a 3-up grid; mobile =
// a top bar (search + sort + a 标签 button opening a secondary single-select
// sheet) + a single column. The cover is fetched lazily by same-origin URL; the
// stored cover is json-free, so showing it carries no design-theft risk.

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Library,
  Search,
  X as XIcon,
  Tag as TagIcon,
  Download,
  ThumbsUp,
  ThumbsDown,
  ArrowDown,
  ArrowUp,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { BaseModal } from "./BaseModal";
import { CatCanIcon } from "./icons/CatCanIcon";
import {
  type SharedCharacterSummary,
  type LibrarySort,
  type LibraryOrder,
  fetchLibrary,
  fetchTags,
  coverUrl,
} from "../lib/sharedLibraryApi";

const SEARCH_DEBOUNCE_MS = 400;
const ALL_TAGS = "__all__"; // sentinel for the default "全部" selection

const SORTS: Array<{ key: LibrarySort; label: string }> = [
  { key: "updated", label: "更新时间" },
  { key: "downloads", label: "下载数" },
  { key: "likes", label: "好评数" },
  { key: "dislikes", label: "差评数" },
];

function formatUpdatedAt(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getFullYear() % 100)}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

interface SharedLibraryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SharedLibraryModal({ isOpen, onClose }: SharedLibraryModalProps) {
  const [items, setItems] = useState<SharedCharacterSummary[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Search: `q` is the raw input, `debouncedQ` drives the fetch.
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tag, setTag] = useState(ALL_TAGS);
  const [author, setAuthor] = useState("");
  const [sort, setSort] = useState<LibrarySort>("updated");
  const [order, setOrder] = useState<LibraryOrder>("desc");

  const [tagSheetOpen, setTagSheetOpen] = useState(false); // mobile tag picker

  // Reset everything to defaults whenever the library is freshly opened.
  useEffect(() => {
    if (!isOpen) return;
    setQ("");
    setDebouncedQ("");
    setTag(ALL_TAGS);
    setAuthor("");
    setSort("updated");
    setOrder("desc");
    setTagSheetOpen(false);
    setError(null);
  }, [isOpen]);

  // Debounce the search box (400ms), per the design's "no 10s cooldown, just
  // debounce + indexed LIKE".
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [q]);

  // Load the tag list once per open (independent of filters).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    (async () => {
      const result = await fetchTags();
      if (cancelled) return;
      if (result.kind === "ok") setAllTags(result.data.tags);
      else setAllTags([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Load the listing whenever a filter / sort changes.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      const result = await fetchLibrary({
        q: debouncedQ || undefined,
        tag: tag === ALL_TAGS ? undefined : tag,
        author: author || undefined,
        sort,
        order,
      });
      if (cancelled) return;
      setLoading(false);
      if (result.kind === "ok") {
        setItems(result.data.characters);
      } else {
        setItems([]);
        setError(
          result.kind === "network"
            ? "服务器无法连接，请稍后再试"
            : "加载共享角色库失败，请重试",
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, debouncedQ, tag, author, sort, order]);

  const handleSort = (key: LibrarySort) => {
    if (key === sort) {
      setOrder((o) => (o === "desc" ? "asc" : "desc"));
    } else {
      setSort(key);
      setOrder("desc");
    }
  };

  const clickAuthor = (name: string) => {
    setAuthor(name);
  };

  // A filter is "narrowing" when the user has typed a search or picked an author
  // (a tag pick is reflected in the tag UI itself); show a 取消 to clear those.
  const hasNarrowing = debouncedQ !== "" || author !== "";
  const clearNarrowing = () => {
    setQ("");
    setDebouncedQ("");
    setAuthor("");
  };

  const pickTag = (t: string) => {
    setTag(t);
    setTagSheetOpen(false);
  };

  if (!isOpen) return null;

  const searchBox = (
    <div className="relative">
      <Search
        size={15}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
      />
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜索作者 / 角色名 / 简介 / 标签"
        className="w-full pl-9 pr-8 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
      />
      {q && (
        <button
          onClick={() => setQ("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded"
          title="清空搜索"
        >
          <XIcon size={14} />
        </button>
      )}
    </div>
  );

  const sortButtons = (
    <div className="flex flex-wrap gap-1.5">
      {SORTS.map((s) => {
        const active = s.key === sort;
        return (
          <button
            key={s.key}
            onClick={() => handleSort(s.key)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all ${
              active
                ? "bg-blue-600 border-transparent text-white"
                : "bg-transparent border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
            }`}
          >
            {s.label}
            {active && (order === "desc" ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
          </button>
        );
      })}
    </div>
  );

  const tagList = (
    <div className="flex flex-col gap-1">
      <TagPill label="全部" active={tag === ALL_TAGS} onClick={() => setTag(ALL_TAGS)} />
      {allTags.map((t) => (
        <TagPill key={t} label={t} active={tag === t} onClick={() => setTag(t)} />
      ))}
    </div>
  );

  const modal = (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="共享角色库"
      titleIcon={<Library size={16} className="text-blue-500" />}
      maxWidth="max-w-4xl"
    >
      <div className="lib-layout min-h-[420px]">
        {/* PC sidebar. Display is driven by the app-private .lib-sidebar class
            (index.css), not Tailwind's hidden/md:flex — an injected extension
            Tailwind build clobbers those utilities in the main document. */}
        <aside className="lib-sidebar flex-col w-56 flex-shrink-0 border-r border-gray-100 dark:border-white/5 p-4 gap-4 overflow-y-auto">
          {searchBox}
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              排序
            </p>
            {sortButtons}
          </div>
          <div className="space-y-1.5 min-h-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              标签
            </p>
            {tagList}
          </div>
        </aside>

        {/* Mobile top bar — see .lib-topbar in index.css for the same reason. */}
        <div className="lib-topbar p-4 pb-0 space-y-3">
          {searchBox}
          <div className="flex items-center gap-2 flex-wrap">
            {sortButtons}
            <button
              onClick={() => setTagSheetOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5 transition-all"
            >
              <TagIcon size={12} />
              {tag === ALL_TAGS ? "标签" : tag}
            </button>
          </div>
        </div>

        {/* Listing */}
        <section className="flex-1 min-w-0 p-4 overflow-y-auto">
          {(hasNarrowing || tag !== ALL_TAGS) && (
            <div className="flex items-center gap-2 mb-3 text-xs text-gray-500 dark:text-gray-400">
              {author && (
                <span className="inline-flex items-center gap-1">
                  作者：<span className="font-medium text-gray-700 dark:text-gray-200">{author}</span>
                </span>
              )}
              {tag !== ALL_TAGS && (
                <span className="inline-flex items-center gap-1">
                  标签：<span className="font-medium text-gray-700 dark:text-gray-200">{tag}</span>
                </span>
              )}
              {hasNarrowing && (
                <button
                  onClick={clearNarrowing}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors"
                >
                  <XIcon size={11} /> 取消
                </button>
              )}
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20 text-gray-400">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
              <AlertTriangle size={22} className="text-red-500" />
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="flex items-center justify-center py-20 text-sm text-gray-400 dark:text-gray-500">
              没有符合条件的共享角色
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {items.map((item) => (
                <LibraryCard key={item.globalId} item={item} onAuthorClick={clickAuthor} />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Mobile tag picker sheet */}
      {tagSheetOpen && (
        <BaseModal
          isOpen={tagSheetOpen}
          onClose={() => setTagSheetOpen(false)}
          title="选择标签"
          titleIcon={<TagIcon size={16} className="text-blue-500" />}
          maxWidth="max-w-xs"
        >
          <div className="p-4 flex flex-col gap-1 max-h-[60vh] overflow-y-auto">
            <TagPill label="全部" active={tag === ALL_TAGS} onClick={() => pickTag(ALL_TAGS)} />
            {allTags.map((t) => (
              <TagPill key={t} label={t} active={tag === t} onClick={() => pickTag(t)} />
            ))}
          </div>
        </BaseModal>
      )}
    </BaseModal>
  );

  return createPortal(modal, document.body);
}

// --- presentational helpers ------------------------------------------------
function TagPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-left px-2.5 py-1.5 text-sm rounded-lg border transition-all truncate ${
        active
          ? "bg-blue-600 border-transparent text-white"
          : "bg-transparent border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
      }`}
    >
      {label}
    </button>
  );
}

function PriceTag({ label, value, free }: { label: string; value: number; free?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-gray-400 dark:text-gray-500">{label}</span>
      {free ? (
        <span className="font-medium text-green-600 dark:text-green-400">免费</span>
      ) : (
        <span className="inline-flex items-center gap-0.5 font-medium text-gray-700 dark:text-gray-200">
          <CatCanIcon size={12} />
          {value}
        </span>
      )}
    </span>
  );
}

function LibraryCard({
  item,
  onAuthorClick,
}: {
  item: SharedCharacterSummary;
  onAuthorClick: (author: string) => void;
}) {
  const [coverError, setCoverError] = useState(false);
  return (
    <div className="flex flex-col rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 overflow-hidden">
      {/* cover */}
      <div className="relative w-full bg-gray-100 dark:bg-white/5" style={{ aspectRatio: "2 / 3" }}>
        {coverError ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-300 dark:text-white/20">
            <Library size={28} />
          </div>
        ) : (
          <img
            src={coverUrl(item.globalId)}
            alt={item.name}
            loading="lazy"
            draggable={false}
            onError={() => setCoverError(true)}
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        <span
          className={`absolute top-2 left-2 px-1.5 py-0.5 text-[10px] font-medium rounded-md ${
            item.source === "original"
              ? "bg-blue-600/90 text-white"
              : "bg-amber-500/90 text-white"
          }`}
        >
          {item.source === "original" ? "原创" : "转载"}
        </span>
      </div>

      {/* body */}
      <div className="flex flex-col gap-1.5 p-3 min-w-0">
        <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
          {item.name}
        </h4>
        <button
          onClick={() => onAuthorClick(item.author)}
          className="self-start text-xs text-blue-600 dark:text-blue-400 hover:underline truncate max-w-full"
          title={`筛选作者：${item.author}`}
        >
          @{item.author}
        </button>
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          {formatUpdatedAt(item.updatedAt)}
        </p>
        {item.intro && (
          <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 break-words">
            {item.intro}
          </p>
        )}

        {item.tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {item.tags.slice(0, 4).map((t) => (
              <span
                key={t}
                className="px-1.5 py-0.5 text-[10px] text-blue-700 dark:text-blue-300 bg-blue-500/10 rounded"
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs pt-1">
          <PriceTag label="使用" value={item.usePrice} free={item.usePrice === 0} />
          {item.buyoutPrice > 0 && <PriceTag label="买断" value={item.buyoutPrice} />}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-gray-400 dark:text-gray-500 pt-0.5">
          <span className="inline-flex items-center gap-0.5" title="下载数">
            <Download size={12} /> {item.downloads}
          </span>
          <span className="inline-flex items-center gap-0.5" title="好评数">
            <ThumbsUp size={12} /> {item.likes}
          </span>
          <span className="inline-flex items-center gap-0.5" title="差评数">
            <ThumbsDown size={12} /> {item.dislikes}
          </span>
        </div>
      </div>
    </div>
  );
}
