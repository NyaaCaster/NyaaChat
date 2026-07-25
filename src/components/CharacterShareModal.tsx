// Share a private character to the shared library (phase 2).
//
// Opened from CharacterSelectionModal after the warning dialog is accepted AND
// the user is logged in (the caller guarantees a live session token). Collects
// the public-facing metadata the design specifies — source, intro (<=100 code
// points), tags — then uploads the character as an
// ST-format card json PLUS a re-encoded pure WebP cover.
//
// Cover anti-theft (SSOT §5.3): we never send the PNG card (which embeds the
// json in a tEXt chunk). The cover is always re-encoded through a canvas to a
// clean WebP — either from the character's stored cover blob, or a generated
// placeholder when it has none — so the image that lands on the server carries
// no character data.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CloudUpload, Loader2, Plus, X as XIcon, AlertTriangle } from "lucide-react";
import { BaseModal } from "./BaseModal";
import type { CharacterSettings } from "../types";
import { convertToSillyTavernCharacter } from "../lib/sillyTavernExport";
import { imageBlobToCoverWebp, makePlaceholderCoverWebp } from "../lib/pngCard";
import { loadCover } from "../lib/coverStorage";
import {
  type SharePayload,
  blobToBase64,
  shareCharacter,
  publishUpdate,
} from "../lib/sharedCharacterApi";
import { type ApiResult } from "../lib/sharedAccountApi";
import { fetchTags } from "../lib/sharedLibraryApi";

const INTRO_MAX = 100;
const TAG_MAX_LEN = 20;
const TAGS_MAX = 20;

// Price tiers from the design. 0 is the "free" / "not for sale" sentinel; -1 is
function messageFor(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  if (result.kind === "network") return "服务器无法连接，请稍后再试";
  if (result.kind === "timeout") return "连接超时，请检查网络后重试";
  switch (result.error) {
    case "unauthorized":
      return "登录已失效，请重新登录后再分享";
    case "forbidden":
      return "只有作者本人可以发布此角色的更新";
    case "invalid_source":
      return "请选择来源";
    case "invalid_intro":
      return "简介超出 100 字上限";
    case "invalid_tag":
      return "存在过长的标签（单个最多 20 字）";
    case "too_many_tags":
      return "标签数量超出上限";
    case "invalid_card":
      return "角色数据无效，无法分享";
    case "missing_cover":
    case "invalid_cover":
      return "封面处理失败，请重试";
    default:
      return "分享失败，请重试";
  }
}

/** Pre-fill values for editing an existing share (phase 5b publish update).
 *  Shared cards are always free since v1.5.1 (de-commercialization), so there
 *  are no pricing fields to carry. */
export interface SharePrefill {
  source: "original" | "reposted";
  intro: string;
  tags: string[];
}

interface CharacterShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  character: CharacterSettings | null;
  token: string;
  /** Display name of the logged-in user; shown as the (auto) author. */
  authorName: string;
  onShared?: (globalId: string) => void;
  /** "create" (default) publishes a new card via POST. "update" (phase 5b) edits
   *  an existing card: the form is pre-filled and submit does PUT /characters/:id. */
  mode?: "create" | "update";
  /** update mode: the global id being updated, and the original share metadata to
   *  pre-fill (source / intro / tags / prices). */
  globalId?: string;
  prefill?: SharePrefill | null;
  /** update mode: the cover blob resolved by the editor (pending crop / import /
   *  stored). Used directly so an unsaved edited cover is uploaded without first
   *  writing it to local IndexedDB. null means "removed" → placeholder. undefined
   *  (create mode) falls back to loading the character's stored cover. */
  coverBlob?: Blob | null;
  /** update mode: called after a successful PUT with the new server updatedAt and
   *  the final published source/intro (which the form may have changed), so the
   *  parent can re-sync the local card to exactly what was published. */
  onUpdated?: (
    globalId: string,
    updatedAt: number,
    published: { source: "original" | "reposted"; intro: string },
  ) => void;
}

export function CharacterShareModal({
  isOpen,
  onClose,
  character,
  token,
  authorName,
  onShared,
  mode = "create",
  globalId,
  prefill,
  coverBlob,
  onUpdated,
}: CharacterShareModalProps) {
  const [source, setSource] = useState<"original" | "reposted">("original");
  const [intro, setIntro] = useState("");
  const [tagDraft, setTagDraft] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const tagWrapRef = useRef<HTMLDivElement>(null);

  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset all fields whenever a fresh share is opened for a character. In update
  // mode, seed the form from the original share metadata (prefill) so the author
  // edits from the current published values rather than from scratch.
  useEffect(() => {
    if (!isOpen) return;
    if (mode === "update" && prefill) {
      setSource(prefill.source);
      setIntro(prefill.intro);
      setTagDraft("");
      setTags(prefill.tags);
    } else {
      setSource("original");
      setIntro("");
      setTagDraft("");
      setTags(character?.tags ?? []);
    }
    setError(null);
    setBusy(false);
    // Keyed on the character id (and mode/prefill identity) so reopening for a
    // different card / a fresh prefill re-seeds, but typing doesn't reset.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, character?.id, mode]);

  // Fetch server tag list once per modal open.
  useEffect(() => {
    if (!isOpen) return;
    fetchTags().then((r) => { if (r.kind === "ok") setAllTags(r.data.tags); });
  }, [isOpen]);

  // Close dropdown on outside click.
  useEffect(() => {
    if (!dropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (!tagWrapRef.current?.contains(e.target as Node)) setDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  // Cover preview: render the same re-encoded WebP we will upload, so the user
  // sees exactly what becomes the shared cover (their own cover, or placeholder).
  useEffect(() => {
    if (!isOpen || !character) {
      setCoverUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        // update mode: preview the editor-resolved cover (possibly an unsaved
        // crop/import); create mode: the character's stored cover.
        const blob =
          mode === "update"
            ? coverBlob ?? null
            : character.coverImage
              ? await loadCover(character.id)
              : null;
        const webp = blob
          ? await imageBlobToCoverWebp(blob)
          : await makePlaceholderCoverWebp(character.name);
        if (cancelled) return;
        objectUrl = URL.createObjectURL(webp);
        setCoverUrl(objectUrl);
      } catch {
        if (!cancelled) setCoverUrl(null);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Keyed on identity fields, not the character object reference, to avoid
    // re-encoding on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, character?.id, character?.coverImage, mode]);

  const introLen = useMemo(() => [...intro].length, [intro]);

  const addTag = (direct?: string) => {
    const t = (direct ?? tagDraft).trim();
    if (!t) return;
    if ([...t].length > TAG_MAX_LEN) {
      setError(`单个标签最多 ${TAG_MAX_LEN} 字`);
      return;
    }
    if (tags.includes(t)) {
      if (!direct) setTagDraft("");
      return;
    }
    if (tags.length >= TAGS_MAX) {
      setError(`标签最多 ${TAGS_MAX} 个`);
      return;
    }
    setTags([...tags, t]);
    if (!direct) setTagDraft("");
    setError(null);
  };

  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  const submit = async () => {
    if (busy || !character) return;
    setError(null);

    if (introLen > INTRO_MAX) {
      setError("简介超出 100 字上限");
      return;
    }

    setBusy(true);
    try {
      // ST-format card json (string). The backend reads the character name from it.
      const card = convertToSillyTavernCharacter(character);
      const cardJson = JSON.stringify(card);

      // Re-encode the cover to a clean WebP (no embedded json), or placeholder.
      // update mode uses the editor-resolved blob (which may be an unsaved crop /
      // import); create mode loads the character's stored cover.
      const blob =
        mode === "update"
          ? coverBlob ?? null
          : character.coverImage
            ? await loadCover(character.id)
            : null;
      const webp = blob
        ? await imageBlobToCoverWebp(blob)
        : await makePlaceholderCoverWebp(character.name);
      const coverBase64 = await blobToBase64(webp);

      const payload: SharePayload = {
        source,
        intro: intro.trim(),
        tags,
        cardJson,
        coverBase64,
      };
      // update mode publishes to the existing card (owner-checked PUT); create
      // mode posts a new one.
      if (mode === "update" && globalId) {
        const result = await publishUpdate(token, globalId, payload);
        setBusy(false);
        if (result.kind === "ok") {
          onUpdated?.(globalId, result.data.updatedAt, { source, intro: intro.trim() });
          onClose();
        } else {
          setError(messageFor(result));
        }
      } else {
        const result = await shareCharacter(token, payload);
        setBusy(false);
        if (result.kind === "ok") {
          onShared?.(result.data.globalId);
          onClose();
        } else {
          setError(messageFor(result));
        }
      }
    } catch (err: any) {
      setBusy(false);
      setError((mode === "update" ? "发布更新失败：" : "分享失败：") + (err?.message || String(err)));
    }
  };

  if (!isOpen || !character) return null;

  const modal = (
    <BaseModal
      isOpen={isOpen}
      onClose={busy ? () => {} : onClose}
      title={mode === "update" ? "发布更新" : "角色分享"}
      titleIcon={<CloudUpload size={16} className="text-blue-500" />}
      maxWidth="max-w-lg"
      footer={
        <div className="space-y-2">
          {error && (
            <div className="flex items-start gap-2 text-sm text-red-600 dark:text-red-400 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
              <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={busy}
              className="flex-1 px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 disabled:opacity-50 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all"
            >
              取消
            </button>
            <button
              onClick={submit}
              disabled={busy}
              className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
            >
              {busy && <Loader2 size={16} className="animate-spin" />}
              <CloudUpload size={16} /> {mode === "update" ? "确认更新" : "确认发布"}
            </button>
          </div>
        </div>
      }
    >
      <div className="p-4 sm:p-5 space-y-4">
        {/* identity preview */}
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10"
            style={{ width: 64, height: 96 }}
          >
            {coverUrl ? (
              <img src={coverUrl} alt={character.name} className="w-full h-full object-cover" draggable={false} />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-white/20">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              角色名
            </p>
            <h4 className="text-base font-medium text-gray-900 dark:text-gray-100 truncate">
              {character.name}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
              作者：{authorName}
            </p>
          </div>
        </div>

        {/* source */}
        <Field label="来源">
          <div className="flex gap-2">
            {(["original", "reposted"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSource(s)}
                className={chipCls(source === s)}
              >
                {s === "original" ? "原创" : "转载"}
              </button>
            ))}
          </div>
          <Hint>⚠转载角色卡请获得原作者许可。</Hint>
        </Field>

        {/* intro */}
        <Field label="简介">
          <textarea
            value={intro}
            onChange={(e) => setIntro(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow resize-none"
            placeholder="简单介绍角色内容"
          />
          <div className="flex items-center justify-between">
            <Hint>非角色卡内容，仅用于简单介绍角色内容。</Hint>
            <span
              className={`text-xs flex-shrink-0 ml-2 ${
                introLen > INTRO_MAX ? "text-red-500" : "text-gray-400 dark:text-gray-500"
              }`}
            >
              {introLen}/{INTRO_MAX}
            </span>
          </div>
        </Field>

        {/* tags */}
        <Field label="标签">
          <div className="relative" ref={tagWrapRef}>
            <div className="flex gap-2">
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onFocus={() => setDropdownOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); addTag(); }
                  if (e.key === "Escape") setDropdownOpen(false);
                }}
                maxLength={TAG_MAX_LEN}
                className="flex-1 px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                placeholder="输入或从列表选择标签"
              />
              <button
                onClick={() => addTag()}
                className="px-3 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center gap-1"
              >
                <Plus size={14} /> 添加
              </button>
            </div>
            {(() => {
              const items = allTags.filter(
                (t) => !tags.includes(t) && (tagDraft ? t.includes(tagDraft) : true),
              );
              return dropdownOpen && items.length > 0 ? (
                <ul className="absolute z-50 left-0 right-10 mt-1 max-h-44 overflow-y-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-white/10 rounded-xl shadow-lg py-1">
                  {items.map((t) => (
                    <li
                      key={t}
                      onMouseDown={(e) => { e.preventDefault(); addTag(t); }}
                      className="px-3 py-1.5 text-sm cursor-pointer select-none text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-700 dark:hover:text-blue-300"
                    >
                      {t}
                    </li>
                  ))}
                </ul>
              ) : null;
            })()}
          </div>
          <Hint>点击输入框展开标签列表快速选择，或手动输入后按 Enter / 点添加。</Hint>
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 pt-1">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 pl-2.5 pr-1 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-500/10 border border-blue-500/20 rounded-lg"
                >
                  {t}
                  <button
                    onClick={() => removeTag(t)}
                    className="p-0.5 text-blue-400 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors"
                    title="删除标签"
                  >
                    <XIcon size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </Field>

      </div>
    </BaseModal>
  );

  return createPortal(modal, document.body);
}

// --- small presentational helpers -----------------------------------------
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </label>
      {children}
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-relaxed text-gray-400 dark:text-gray-500">{children}</p>;
}

function chipCls(active: boolean): string {
  return `px-3 py-1.5 text-sm font-medium rounded-lg border transition-all ${
    active
      ? "bg-blue-600 border-transparent text-white"
      : "bg-transparent border-gray-200 dark:border-white/10 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/5"
  }`;
}
