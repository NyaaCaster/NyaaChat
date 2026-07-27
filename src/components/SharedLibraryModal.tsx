// Browse the shared-character library (phase 3) — read-only.
//
// Opened from CharacterSelectionModal's title bar (共享角色库 entry). Lists all
// published shared characters with text search, sort (update / downloads /
// likes / dislikes, toggling asc/desc), an exact tag filter, and a clickable
// author-name filter — per the design's library spec.
//
// Deliberately browse-first: entries render their full public info (cover,
// name, author, source, update time, intro, prices, counts) plus use / buyout /
// rate actions. A logged-in user additionally sees 编辑 / 删除 buttons on the
// cover top-right of cards they authored (owner === their account) — edit reuses
// the share 界面 (update mode) to revise source / intro / tags; delete removes
// the card from the server after a confirm.
//
// Layout: PC = left sidebar (search + sort + tag list) + a 3-up grid; mobile =
// a top bar (search + sort + a 标签 button opening a secondary single-select
// sheet) + a single column. The cover is fetched lazily by same-origin URL; the
// stored cover is json-free, so showing it carries no design-theft risk.

import React, { useEffect, useRef, useState } from "react";
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
  CloudDownload,
  Pencil,
  Trash2,
} from "lucide-react";
import { BaseModal } from "./BaseModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { CharacterShareModal, type SharePrefill } from "./CharacterShareModal";
import { UserAccountModal } from "./UserAccountModal";
import type { CharacterSettings } from "../types";
import { convertSillyTavernCharacter } from "../lib/sillyTavernImport";
import { saveCover, COVER_MARKER } from "../lib/coverStorage";
import {
  type SharedCharacterSummary,
  type LibrarySort,
  type LibraryOrder,
  fetchLibrary,
  fetchTags,
  coverUrl,
  acquireCharacter,
  rateCharacter,
  fetchMyRatings,
  fetchCoverBlob,
  fetchCharacterCard,
} from "../lib/sharedLibraryApi";
import { deleteSharedCharacter } from "../lib/sharedCharacterApi";
import {
  type AccountProfile,
  loadStoredAccount,
  saveStoredAccount,
  clearStoredAccount,
} from "../lib/sharedAccountApi";

const SEARCH_DEBOUNCE_MS = 400;
const ALL_TAGS = "__all__"; // sentinel for the default "全部" selection
const DEFAULT_SLOT_MAX = 10; // when logged out, the design's initial slot ceiling

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
  /** Current count of locally-held shared cards, for the slot-cap check. */
  sharedCount: number;
  /** Use a shared card: caller adds it (shared type) + starts a new conversation. */
  onUse: (localChar: CharacterSettings) => void;
  /** Buy out a card: caller adds it as a fully-private card (no slot). */
}

export function SharedLibraryModal({
  isOpen,
  onClose,
  sharedCount,
  onUse,
}: SharedLibraryModalProps) {
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

  // --- phase 4: session, ratings, acquisition --------------------------------
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [storedToken, setStoredToken] = useState<string>("");
  const [myRatings, setMyRatings] = useState<Record<string, number>>({});
  const [actingId, setActingId] = useState<string | null>(null); // card mid-action
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Login guide rendered by the library itself: as the last sibling in the
  // library's body-root portal it sits on top, where an account modal owned by a
  // parent (rendered inline in the app tree) would be stuck underneath.
  const [loginOpen, setLoginOpen] = useState(false);
  // P7: expand prompt when slot / KB cap is reached
  const [slotFullOpen, setSlotFullOpen] = useState(false);

  // --- phase 5b (in library): author editing / deleting own cards ------------
  // The logged-in account; a card whose owner === this may show 编辑 / 删除.
  const [account, setAccount] = useState<string | null>(null);
  // Edit: the share 界面 (update mode) seeded with the fetched card + metadata.
  const [edit, setEdit] = useState<{
    character: CharacterSettings;
    globalId: string;
    prefill: SharePrefill;
    coverBlob: Blob | null;
  } | null>(null);
  // Delete: the card pending a confirm, and whether a delete request is in flight.
  const [pendingDelete, setPendingDelete] = useState<SharedCharacterSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const slotMax = profile?.slotMax ?? DEFAULT_SLOT_MAX;

  // Ratings load is async; a stale response (e.g. issued on open) must not
  // clobber a newer optimistic update from a rating click. A monotonic seq
  // invalidates any in-flight load whenever ratings change for another reason.
  const ratingSeq = useRef(0);
  const loadMyRatings = (tokenStr: string) => {
    const seq = ++ratingSeq.current;
    void fetchMyRatings(tokenStr).then((r) => {
      if (seq !== ratingSeq.current) return; // superseded — ignore
      setMyRatings(r.kind === "ok" ? r.data.ratings : {});
    });
  };

  const flash = (kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 3000);
  };

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
    setNotice(null);
    setActingId(null);
    setEdit(null);
    setPendingDelete(null);
    setDeleteBusy(false);
  }, [isOpen]);

  // Re-read the stored session for profile/balance. Does NOT load ratings (that
  // is guarded separately) so a handler calling this can't trigger a stale
  // ratings overwrite.
  const syncSession = async () => {
    const stored = await loadStoredAccount();
    setProfile(stored?.profile ?? null);
    setAccount(stored?.profile?.account ?? null);
    return stored;
  };

  useEffect(() => {
    if (!isOpen) {
      setProfile(null);
      setAccount(null);
      setMyRatings({});
      ratingSeq.current++; // drop any in-flight ratings load
      return;
    }
    (async () => {
    const stored = await loadStoredAccount();
    setProfile(stored?.profile ?? null);
    setAccount(stored?.profile?.account ?? null);
    setStoredToken(stored?.token ?? "");
    if (stored) {
      loadMyRatings(stored.token);
    } else {
      setMyRatings({});
      ratingSeq.current++;
    }
    })();
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

  // --- phase 4 handlers ------------------------------------------------------

  /** Reflect a priced settlement's new balance into state + persisted login. */
  /** Build a local CharacterSettings from an acquired ST card, attaching the
   *  cover (fetched from the server) into IndexedDB. `shared` marks a use card. */
  const buildLocalCharacter = async (
    card: { globalId: string; owner: string; name: string; author: string; source: "original" | "reposted"; intro: string; tags?: string[]; cardJson: string; updatedAt: number },
  ): Promise<CharacterSettings> => {
    const parsed = JSON.parse(card.cardJson);
    const local = convertSillyTavernCharacter(parsed);
    local.shared = true;
    local.globalId = card.globalId;
    local.owner = card.owner;
    local.author = card.author;
    local.source = card.source;
    local.intro = card.intro;
    local.version = card.updatedAt;
    if (card.tags?.length) local.tags = card.tags;
    try {
      const blob = await fetchCoverBlob(card.globalId);
      if (blob) {
        await saveCover(local.id, blob);
        local.coverImage = COVER_MARKER;
      }
    } catch {
      // coverless is fine — the card still imports
    }
    return local;
  };

  const acquireMessage = (err: string): string => {
    switch (err) {
      case "unauthorized":
        return "请先登录后再操作";
      case "not_found":
        return "角色不存在或已被删除";
      case "card_key_unavailable":
        return "当前浏览器不支持安全随机数，无法安全下发角色卡";
      case "decrypt_failed":
        return "角色卡安全下发解密失败，请刷新后重试";
      default:
        return "操作失败，请重试";
    }
  };

  /** Run a free acquisition (always "use" mode). */
  const doAcquire = async (item: SharedCharacterSummary) => {
    setActingId(item.globalId);
    try {
      const tok = (await loadStoredAccount())?.token ?? null;
      const result = await acquireCharacter(tok, item.globalId);
      if (result.kind !== "ok") {
        const msg = result.kind === "network" ? "服务器无法连接，请稍后再试"
          : result.kind === "timeout" ? "连接超时，请检查网络后重试"
          : acquireMessage(result.error);
        flash("err", msg);
        return;
      }
      const local = await buildLocalCharacter(result.data.card);
      // Optimistically bump the download counter shown on the card.
      setItems((prev) =>
        prev.map((it) => (it.globalId === item.globalId ? { ...it, downloads: it.downloads + 1 } : it)),
      );
      onUse(local);
    } catch (e: any) {
      flash("err", "操作失败：" + (e?.message || String(e)));
    } finally {
      setActingId(null);
    }
  };

  const startUse = async (item: SharedCharacterSummary) => {
    if (sharedCount >= slotMax) {
      setSlotFullOpen(true);
      return;
    }
    void doAcquire(item);
  };

  const rate = async (item: SharedCharacterSummary, value: 1 | -1) => {
    // Only needs the token — must NOT call syncSession here: its async ratings
    // refetch can land after this rating and clobber the optimistic update.
    const stored = await loadStoredAccount();
    if (!stored) {
      setLoginOpen(true);
      return;
    }
    const current = myRatings[item.globalId] ?? 0;
    const target: 1 | -1 | 0 = current === value ? 0 : value; // re-click clears, opposite switches
    const result = await rateCharacter(stored.token, item.globalId, target);
    if (result.kind !== "ok") {
      if (result.kind === "error" && result.error === "unauthorized") {
        // Stale / expired token — drop it and guide a fresh login.
        await clearStoredAccount();
        setProfile(null);
        setLoginOpen(true);
        return;
      }
      flash("err", result.kind === "network" ? "服务器无法连接，请稍后再试" : "评价失败，请重试");
      return;
    }
    setMyRatings((prev) => {
      const next = { ...prev };
      if (target === 0) delete next[item.globalId];
      else next[item.globalId] = target;
      return next;
    });
    ratingSeq.current++; // this optimistic state supersedes any in-flight load
    setItems((prev) =>
      prev.map((it) =>
        it.globalId === item.globalId
          ? { ...it, likes: result.data.likes, dislikes: result.data.dislikes }
          : it,
      ),
    );
  };

  // --- phase 5b (in library): author edit / delete ---------------------------

  /** Click 编辑 on an owned card: pull the latest full card (for its card json +
   *  the share metadata that the listing doesn't carry — tags aren't in summary
   *  but actually are; prices are) and open the share 界面 in update mode. The
   *  user revises source / intro / tags there; the card data + cover are carried
   *  through unchanged. */
  const startEdit = async (item: SharedCharacterSummary) => {
    const stored = await syncSession();
    if (!stored) {
      setLoginOpen(true);
      return;
    }
    setActingId(item.globalId);
    try {
      const res = await fetchCharacterCard(item.globalId);
      if (res.kind !== "ok") {
        if (res.kind === "error" && res.status === 404) {
          flash("err", "该角色已从共享角色库删除");
          setItems((prev) => prev.filter((it) => it.globalId !== item.globalId));
        } else {
          flash("err", res.kind === "network" ? "服务器无法连接，请稍后再试" : "无法加载角色信息，请重试");
        }
        return;
      }
      const card = res.data.card;
      // Build a local character from the card json (only for re-uploading the
      // same card data); the editor here only revises publish metadata.
      const character = convertSillyTavernCharacter(JSON.parse(card.cardJson));
      const coverBlob = await fetchCoverBlob(item.globalId);
      setEdit({
        character,
        globalId: item.globalId,
        prefill: {
          source: card.source,
          intro: card.intro,
          tags: card.tags,
        },
        coverBlob,
      });
    } catch (e: any) {
      flash("err", "无法加载角色信息：" + (e?.message || String(e)));
    } finally {
      setActingId(null);
    }
  };

  /** A successful PUT from the edit share界面: re-sync the listing row to the new
   *  metadata + updatedAt so the card reflects the edit without a full reload. */
  const onEditPublished = (
    globalId: string,
    updatedAt: number,
    published: { source: "original" | "reposted"; intro: string },
  ) => {
    setItems((prev) =>
      prev.map((it) =>
        it.globalId === globalId
          ? { ...it, source: published.source, intro: published.intro, updatedAt }
          : it,
      ),
    );
    setEdit(null);
    flash("ok", "发布信息已更新");
  };

  /** Confirm delete: remove the card from the server, then drop it from the list. */
  const confirmDelete = async () => {
    if (!pendingDelete || deleteBusy) return;
    const stored = await loadStoredAccount();
    if (!stored) {
      setPendingDelete(null);
      setLoginOpen(true);
      return;
    }
    setDeleteBusy(true);
    const gid = pendingDelete.globalId;
    const name = pendingDelete.name;
    const result = await deleteSharedCharacter(stored.token, gid);
    setDeleteBusy(false);
    if (result.kind !== "ok") {
      if (result.kind === "error" && result.status === 404) {
        // Already gone — treat as success: drop it from the list.
        setItems((prev) => prev.filter((it) => it.globalId !== gid));
        setPendingDelete(null);
        flash("ok", `「${name}」已删除`);
        return;
      }
      if (result.kind === "error" && result.error === "unauthorized") {
        await clearStoredAccount();
        setProfile(null);
        setAccount(null);
        setPendingDelete(null);
        setLoginOpen(true);
        return;
      }
      flash(
        "err",
        result.kind === "network"
          ? "服务器无法连接，请稍后再试"
          : result.kind === "error" && result.error === "forbidden"
            ? "只有作者本人可以删除此角色"
            : "删除失败，请重试",
      );
      return;
    }
    setItems((prev) => prev.filter((it) => it.globalId !== gid));
    setPendingDelete(null);
    flash("ok", `「${name}」已从共享角色库删除`);
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
          {notice && (
            <div
              className={`text-sm rounded-xl px-3 py-2 mb-3 border ${
                notice.kind === "ok"
                  ? "text-green-600 dark:text-green-400 bg-green-500/10 border-green-500/20"
                  : "text-red-600 dark:text-red-400 bg-red-500/10 border-red-500/20"
              }`}
            >
              {notice.text}
            </div>
          )}
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
                <LibraryCard
                  key={item.globalId}
                  item={item}
                  onAuthorClick={clickAuthor}
                  myValue={myRatings[item.globalId] ?? 0}
                  acting={actingId === item.globalId}
                  isOwner={!!account && item.owner === account}
                  onUse={() => startUse(item)}
                  onRate={(v) => void rate(item, v)}
                  onEdit={() => void startEdit(item)}
                  onDelete={() => setPendingDelete(item)}
                />
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
      {/* Login guide (logged-out use / buyout / rating). Owned here so it stacks
          above the library; refresh the session display when it closes. */}
      <UserAccountModal
        isOpen={loginOpen}
        onClose={() => {
          setLoginOpen(false);
          void syncSession().then((stored) => {
            if (stored) loadMyRatings(stored.token);
          });
        }}
      />

      {/* P7: slot-full expand prompt — "前往扩容" opens the account panel */}
      <ConfirmDialog
        isOpen={slotFullOpen}
        title="共享卡槽已满"
        message={
          <span>
            当前共享卡槽已达上限（{slotMax} 个），无法继续获取共享角色。
            <br />
            请清理不再使用的共享角色，或前往扩容（15 猫粮 / +5 卡槽）。
          </span>
        }
        confirmText="前往扩容"
        cancelText="取消"
        onConfirm={() => {
          setSlotFullOpen(false);
          setLoginOpen(true);
        }}
        onCancel={() => setSlotFullOpen(false)}
      />

      {/* Author edit (own card): share 界面 in update mode, pre-filled. Carries the
          fetched card data + cover unchanged; the author revises source/intro/tags. */}
      {edit && (
        <CharacterShareModal
          isOpen={!!edit}
          onClose={() => setEdit(null)}
          character={edit.character}
          token={storedToken}
          authorName={profile?.username ?? edit.character.author ?? ""}
          mode="update"
          globalId={edit.globalId}
          prefill={edit.prefill}
          coverBlob={edit.coverBlob}
          onUpdated={onEditPublished}
        />
      )}

      {/* Delete confirm (own card). Destructive; second confirmation per design. */}
      <ConfirmDialog
        isOpen={!!pendingDelete}
        title="删除共享角色"
        destructive
        confirmText={deleteBusy ? "删除中…" : "确认删除"}
        message={
          <>
            确定要从共享角色库中删除
            <span className="font-medium text-gray-900 dark:text-gray-100">
              「{pendingDelete?.name}」
            </span>
            吗？删除后该角色将无法被浏览或使用，且<span className="font-medium">无法恢复</span>。
            已持有此角色的用户将无法再获取更新。
          </>
        }
        onConfirm={() => void confirmDelete()}
        onCancel={() => { if (!deleteBusy) setPendingDelete(null); }}
      />
    </BaseModal>
  );

  return createPortal(modal, document.body);
}

// --- presentational helpers ------------------------------------------------
/**
 * One row in the tag filter list (PC sidebar + mobile 选择标签 sheet).
 *
 * shrink-0 matters: the pill is a flex item in a column list whose mobile sheet
 * is height-capped (max-h-[60vh]), and `truncate` sets overflow:hidden, which
 * zeroes the item's automatic minimum size. Without shrink-0 the rows compress
 * below their line height once the tags outgrow the cap — clipping the label
 * vertically instead of letting the container scroll.
 */
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
      className={`shrink-0 text-left px-2.5 py-1.5 text-sm leading-5 rounded-lg border transition-all truncate ${
        active
          ? "bg-blue-600 border-transparent text-white"
          : "bg-transparent border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
      }`}
    >
      {label}
    </button>
  );
}

function LibraryCard({
  item,
  onAuthorClick,
  myValue,
  acting,
  isOwner,
  onUse,
  onRate,
  onEdit,
  onDelete,
}: {
  item: SharedCharacterSummary;
  onAuthorClick: (author: string) => void;
  myValue: number; // 1 | -1 | 0
  acting: boolean;
  isOwner: boolean;
  onUse: () => void;
  onRate: (value: 1 | -1) => void;
  onEdit: () => void;
  onDelete: () => void;
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
        {/* Author-only edit / delete, top-right of the cover. Edit revises the
            publish info (source/intro/tags); delete removes the card (confirmed). */}
        {isOwner && (
          <div className="absolute top-2 right-2 flex items-center gap-1">
            <button
              onClick={onEdit}
              disabled={acting}
              title="编辑发布信息"
              className="p-1.5 rounded-md bg-black/45 text-white hover:bg-black/65 backdrop-blur-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {acting ? <Loader2 size={13} className="animate-spin" /> : <Pencil size={13} />}
            </button>
            <button
              onClick={onDelete}
              disabled={acting}
              title="删除共享角色"
              className="p-1.5 rounded-md bg-black/45 text-white hover:bg-red-600/90 backdrop-blur-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Trash2 size={13} />
            </button>
          </div>
        )}
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

        {/* actions: use / buyout + rate */}
        <div className="flex items-center gap-1.5 pt-1.5 mt-0.5 border-t border-gray-100 dark:border-white/5">
          <button
            onClick={onUse}
            disabled={acting}
            title="使用"
            className="flex-1 inline-flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed text-white bg-green-600 hover:bg-green-700"
          >
            {acting ? <Loader2 size={12} className="animate-spin" /> : <CloudDownload size={12} />}
            使用
          </button>
          <button
            onClick={() => onRate(1)}
            title="好评"
            className={`p-1.5 rounded-lg border transition-all ${
              myValue === 1
                ? "border-transparent bg-green-500/15 text-green-600 dark:text-green-400"
                : "border-gray-200 dark:border-white/10 text-gray-400 hover:text-green-500 hover:bg-green-500/10"
            }`}
          >
            <ThumbsUp size={13} />
          </button>
          <button
            onClick={() => onRate(-1)}
            title="差评"
            className={`p-1.5 rounded-lg border transition-all ${
              myValue === -1
                ? "border-transparent bg-red-500/15 text-red-600 dark:text-red-400"
                : "border-gray-200 dark:border-white/10 text-gray-400 hover:text-red-500 hover:bg-red-500/10"
            }`}
          >
            <ThumbsDown size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}
