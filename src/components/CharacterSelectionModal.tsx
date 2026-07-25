import React, { useState, useRef, useEffect } from "react";
import { Sparkles, Plus, Upload, Check, Edit2, Trash2, CloudUpload, Library, RefreshCw, Wallet } from "lucide-react";
import { AppState, CharacterSettings } from "../types";
import {
  isSillyTavernFormat,
  convertSillyTavernCharacter,
  convertNativeCard,
  extractCharaJson,
} from "../lib/sillyTavernImport";
import { imageBlobToCoverWebp } from "../lib/pngCard";
import { saveCover, deleteCover, COVER_MARKER } from "../lib/coverStorage";
import { loadStoredAccount } from "../lib/sharedAccountApi";
import { fetchVersions, fetchCharacterCard, fetchCoverBlob } from "../lib/sharedLibraryApi";
import { useCoverObjectUrl } from "../hooks/useCoverObjectUrl";
import { estimateCharacterStorage, DEFAULT_CHARACTER_STORAGE_QUOTA } from "../lib/storageEstimate";
import { BaseModal } from "./BaseModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { CharacterEditModal } from "./CharacterEditModal";
import { CharacterShareModal, type SharePrefill } from "./CharacterShareModal";
import { SharedLibraryModal } from "./SharedLibraryModal";
import { UserAccountModal } from "./UserAccountModal";
import { StorageBar } from "./StorageBar";

interface CharacterSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
  onSelectCharacter?: (id: string) => void;
}

export function CharacterSelectionModal({
  isOpen,
  onClose,
  settings,
  onSave,
  onSelectCharacter,
}: CharacterSelectionModalProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<CharacterSettings | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // Storage limit dialog: when user is at/over quota, offer to expand instead of hard-blocking.
  const [storageLimitDialog, setStorageLimitDialog] = useState<{
    label: string;
    usage: number;
    quota: number;
  } | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Share flow: a character awaiting the warning dialog, the one being shared,
  // and a flag to surface the account modal when sharing while logged out.
  const [pendingShare, setPendingShare] = useState<CharacterSettings | null>(null);
  const [sharingCharacter, setSharingCharacter] = useState<CharacterSettings | null>(null);
  const [shareSession, setShareSession] = useState<{ token: string; username: string } | null>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  // phase 5b: account whose login decides which shared cards show 编辑 (account
  // === card.owner). Refreshed on open so logging in/out is reflected.
  const [account, setAccount] = useState<string | null>(null);
  const [storedToken, setStoredToken] = useState<string>("");
  const [storedUsername, setStoredUsername] = useState<string>("");
  const [charStorageQuota, setCharStorageQuota] = useState<number>(DEFAULT_CHARACTER_STORAGE_QUOTA);
  const [slotMax, setSlotMax] = useState(10);
  // phase 5b: editing one's own shared card. editMode flags the editor into
  // shared-author mode; the publish-update flow then carries the edited card +
  // cover blob into the share 界面 pre-filled with the server's share metadata.
  const [editMode, setEditMode] = useState<"local" | "shared-author">("local");
  const [updatePublish, setUpdatePublish] = useState<{
    character: CharacterSettings;
    coverBlob: Blob | null;
    globalId: string;
    prefill: SharePrefill;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- phase 5: shared-card update detection -------------------------------
  // For locally-held shared cards, on open we ask the server (one batch call)
  // for each card's current updated_at. A card whose server version is newer
  // than the local `version` gets an "update available" badge; a card absent
  // from the response has been deleted (no badge — surfaced only on 更新 click).
  const [updateStatus, setUpdateStatus] = useState<Record<string, "update">>({});
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const flash = (kind: "ok" | "err", text: string) => {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 3000);
  };

  const [charUsage, setCharUsage] = useState<number>(0);
  const refreshCharUsage = () => {
    estimateCharacterStorage(settings.characters || []).then(setCharUsage);
  };

  useEffect(() => {
    if (!isOpen) return;
    setNotice(null);
    refreshCharUsage();
    (async () => {
    const stored = await loadStoredAccount();
    setAccount(stored?.profile.account ?? null);
    setStoredToken(stored?.token ?? "");
    setStoredUsername(stored?.profile.username ?? "");
    setCharStorageQuota(stored?.profile.charStorageMax ?? DEFAULT_CHARACTER_STORAGE_QUOTA);
    setSlotMax(stored?.profile.slotMax ?? 10);
    })();
    const sharedCards = (settings.characters || []).filter((c) => c.shared && c.globalId);
    if (!sharedCards.length) {
      setUpdateStatus({});
      return;
    }
    let cancelled = false;
    void fetchVersions(sharedCards.map((c) => c.globalId as string)).then((res) => {
      if (cancelled || res.kind !== "ok") return;
      const status: Record<string, "update"> = {};
      for (const c of sharedCards) {
        const info = res.data.versions[c.globalId as string];
        // Absent = deleted (no badge); present & newer = update available.
        if (info != null && info.updatedAt > (c.version ?? 0)) {
          status[c.globalId as string] = "update";
        }
      }
      setUpdateStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen, settings.characters]);

  const handleSelectCharacter = (id: string) => {
    if (onSelectCharacter) {
      onSelectCharacter(id);
    } else {
      onSave({
        ...settings,
        currentCharacterId: id,
      });
    }
    onClose();
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(`文件过大（${(file.size / 1024 / 1024).toFixed(2)} MB），上限 5 MB`);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    // Capacity guard — if import would exceed quota, offer expansion instead of hard-blocking.
    const used = await estimateCharacterStorage(settings.characters || []);
    const estAfter = used + file.size * 2; // ×2 for JSON + cover WebP
    if (estAfter > charStorageQuota * 0.95) {
      setStorageLimitDialog({
        label: "角色卡储存",
        usage: used,
        quota: charStorageQuota,
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    try {
      if (!file.name.toLowerCase().endsWith(".png")) {
        throw new Error("仅支持 PNG 角色卡");
      }

      // Card data rides in the PNG's `chara` tEXt chunk; dispatch on the parsed
      // object's shape (ST card vs. our native card).
      const raw = await extractCharaJson(file);
      const newCharacter: CharacterSettings = isSillyTavernFormat(raw)
        ? convertSillyTavernCharacter(raw)
        : convertNativeCard(raw);

      // The PNG's visible pixels ARE the cover — re-encode them to a 512×768
      // WebP and store under the new character id. Failure to decode the cover
      // is non-fatal: the character still imports, just without a cover.
      try {
        const coverWebp = await imageBlobToCoverWebp(file);
        await saveCover(newCharacter.id, coverWebp);
        newCharacter.coverImage = COVER_MARKER;
      } catch {
        // leave coverImage unset
      }

      onSave({
        ...settings,
        characters: [...(settings.characters || []), newCharacter],
      });
      setImportError(null);
    } catch (err: any) {
      setImportError("角色卡导入失败：" + (err?.message || String(err)));
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleCreateCharacter = (character: CharacterSettings) => {
    if (editingCharacter) {
      onSave({
        ...settings,
        characters: settings.characters.map((c) =>
          c.id === character.id ? character : c
        ),
      });
    } else {
      onSave({
        ...settings,
        characters: [...(settings.characters || []), character],
      });
    }
    setEditingCharacter(null);
  };

  const handleDeleteRequest = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (settings.characters.length <= 1) return;
    setPendingDeleteId(id);
  };

  const handleDeleteConfirm = () => {
    if (!pendingDeleteId) return;
    // Drop the character's cover blob from IndexedDB (fire-and-forget; a leftover
    // blob would just be orphaned, never resurfaced).
    void deleteCover(pendingDeleteId);
    const newCharacters = settings.characters.filter((c) => c.id !== pendingDeleteId);
    let nextCurrentId = settings.currentCharacterId;
    if (settings.currentCharacterId === pendingDeleteId) {
      nextCurrentId = newCharacters[0].id;
    }
    onSave({
      ...settings,
      characters: newCharacters,
      currentCharacterId: nextCurrentId,
    });
    setPendingDeleteId(null);
  };

  const handleOpenEdit = (e: React.MouseEvent, character: CharacterSettings) => {
    e.stopPropagation();
    setEditMode("local");
    setEditingCharacter(character);
    setIsEditModalOpen(true);
  };

  const handleOpenCreate = () => {
    setEditMode("local");
    setEditingCharacter(null);
    setIsEditModalOpen(true);
  };

  // --- share flow ----------------------------------------------------------
  // Step 1: clicking 分享 opens a warning dialog (responsibility notice).
  const handleShareRequest = (e: React.MouseEvent, character: CharacterSettings) => {
    e.stopPropagation();
    setPendingShare(character);
  };

  // Step 2: accepting the warning. If logged out, open the account modal to
  // guide login; only a live session proceeds to the share界面.
  const handleShareConfirm = async () => {
    const character = pendingShare;
    setPendingShare(null);
    if (!character) return;
    const stored = await loadStoredAccount();
    if (!stored) {
      setIsAccountOpen(true);
      return;
    }
    setShareSession({ token: stored.token, username: stored.profile.username });
    setSharingCharacter(character);
  };

  // --- shared-library acquisition (phase 4) --------------------------------
  // Use: the acquired card is added as a shared-type character AND becomes the
  // active one, which starts a fresh conversation (ChatInterface resets messages
  // on currentCharacterId change). Close the whole stack so the user lands in it.
  const handleUseShared = (localChar: CharacterSettings) => {
    onSave({
      ...settings,
      characters: [...(settings.characters || []), localChar],
      currentCharacterId: localChar.id,
    });
    setIsLibraryOpen(false);
    onClose();
  };

  // Buyout: the card was converted to a fully-private character; just add it to
  // the list (no conversation switch, no slot occupation). Keep the library open.
  // --- phase 5: update a held shared card to the server's latest json ------
  // Pull the freshest card (read-only, no download count). Preserve the LOCAL id
  // (conversations bind to it — changing it would orphan the chat) and the cover
  // slot, re-stamp the shared metadata + version, and refresh the cover blob.
  const handleUpdateShared = async (e: React.MouseEvent, character: CharacterSettings) => {
    e.stopPropagation();
    if (!character.globalId || updatingId) return;
    setUpdatingId(character.id);
    try {
      const res = await fetchCharacterCard(character.globalId);
      if (res.kind !== "ok") {
        if (res.kind === "error" && res.status === 404) {
          flash("err", "该角色已从共享角色库删除，无法更新。");
        } else {
          flash("err", "更新失败，请稍后再试。");
        }
        return;
      }
      const card = res.data.card;
      const parsed = JSON.parse(card.cardJson);
      const fresh = convertSillyTavernCharacter(parsed);
      // Keep the same local id so the bound conversation survives the update.
      fresh.id = character.id;
      fresh.shared = true;
      fresh.globalId = card.globalId;
      fresh.owner = card.owner; // backfill owner for author recognition
      fresh.author = card.author;
      fresh.source = card.source;
      fresh.intro = card.intro;
      fresh.version = card.updatedAt;
      // Refresh the cover into the SAME IndexedDB id; on failure leave it coverless.
      try {
        const blob = await fetchCoverBlob(card.globalId);
        if (blob) {
          await saveCover(fresh.id, blob);
          fresh.coverImage = COVER_MARKER;
        } else {
          fresh.coverImage = undefined;
        }
      } catch {
        fresh.coverImage = undefined;
      }
      onSave({
        ...settings,
        characters: settings.characters.map((c) => (c.id === character.id ? fresh : c)),
      });
      setUpdateStatus((prev) => {
        const next = { ...prev };
        delete next[card.globalId];
        return next;
      });
      flash("ok", `「${fresh.name}」已更新到最新版本。`);
    } catch (err: any) {
      flash("err", "更新失败：" + (err?.message || String(err)));
    } finally {
      setUpdatingId(null);
    }
  };

  // --- phase 5b: author editing their own shared card ----------------------
  // Click 编辑 on an owned shared card: pull the latest server card (for its
  // share metadata — tags/prices aren't stored locally) and open the editor in
  // shared-author mode. The prefill is stashed so 发布更新 can pre-fill the share
  // 界面 with the current published source/intro/tags/prices.
  const sharePrefillRef = useRef<SharePrefill | null>(null);

  const handleEditShared = async (e: React.MouseEvent, character: CharacterSettings) => {
    e.stopPropagation();
    if (!character.globalId || updatingId) return;
    setUpdatingId(character.id);
    try {
      const res = await fetchCharacterCard(character.globalId);
      if (res.kind !== "ok") {
        if (res.kind === "error" && res.status === 404) {
          flash("err", "该角色已从共享角色库删除，无法编辑。");
        } else if (res.kind === "error" && res.status === 403) {
          flash("err", "只有作者本人可以编辑此角色。");
        } else {
          flash("err", "无法加载角色信息，请稍后再试。");
        }
        return;
      }
      const card = res.data.card;
      sharePrefillRef.current = {
        source: card.source,
        intro: card.intro,
        tags: card.tags,
      };
      // Edit from the locally-held card (its id binds the conversation); the
      // editor only revises name/desc/firstMes/worldInfo/cover. Open in
      // shared-author mode (保存→发布更新, 导出→导入).
      setEditMode("shared-author");
      setEditingCharacter(character);
      setIsEditModalOpen(true);
    } catch (err: any) {
      flash("err", "无法加载角色信息：" + (err?.message || String(err)));
    } finally {
      setUpdatingId(null);
    }
  };

  // 发布更新 from the editor: carry the edited character + resolved cover into the
  // share 界面, pre-filled with the stashed share metadata, to PUT the update.
  const handlePublishUpdate = (character: CharacterSettings, coverBlob: Blob | null) => {
    if (!character.globalId || !sharePrefillRef.current) return;
    setIsEditModalOpen(false);
    setUpdatePublish({
      character,
      coverBlob,
      globalId: character.globalId,
      prefill: sharePrefillRef.current,
    });
  };

  // Successful PUT: re-sync the local card to exactly what was just published
  // (the editor already produced the edited character; stamp the new server
  // version + persist the cover into the SAME IndexedDB id, keeping the local
  // id so the bound conversation survives). Clear any stale update badge.
  const handleUpdatePublished = async (
    globalId: string,
    updatedAt: number,
    published: { source: "original" | "reposted"; intro: string },
  ) => {
    const pending = updatePublish;
    setUpdatePublish(null);
    if (!pending) return;
    // Re-sync the local card to exactly what was published: the edited card +
    // the new server version + the share界面's final source/intro (which the
    // author may have changed there, not in the editor).
    const fresh: CharacterSettings = {
      ...pending.character,
      version: updatedAt,
      source: published.source,
      intro: published.intro,
    };
    try {
      if (pending.coverBlob) {
        await saveCover(fresh.id, pending.coverBlob);
        fresh.coverImage = COVER_MARKER;
      } else {
        await deleteCover(fresh.id);
        fresh.coverImage = undefined;
      }
    } catch {
      // a cover persistence failure is non-fatal; the card still updates
    }
    onSave({
      ...settings,
      characters: settings.characters.map((c) => (c.id === fresh.id ? fresh : c)),
    });
    setUpdateStatus((prev) => {
      const next = { ...prev };
      delete next[globalId];
      return next;
    });
    flash("ok", `「${fresh.name}」的更新已发布。`);
  };

  const sharedCount = (settings.characters || []).filter((c) => c.shared).length;  const pendingDeleteCharacter = pendingDeleteId
    ? settings.characters.find((c) => c.id === pendingDeleteId)
    : null;

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="角色选择"
        titleIcon={<Sparkles size={16} className="text-blue-600 dark:text-blue-400" />}
        titleAction={
          <button
            onClick={() => setIsLibraryOpen(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 rounded-xl transition-all"
            title="共享角色库"
          >
            <Library size={15} /> 共享角色库
          </button>
        }
        maxWidth="max-w-lg"
        footer={
          <>
            <input
              type="file"
              accept=".png"
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
                <Upload size={16} /> 导入角色
              </button>
              <button
                onClick={handleOpenCreate}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
              >
                <Plus size={16} /> 创建角色
              </button>
            </div>
          </>
        }
      >
        <div className="p-4 sm:p-5 min-h-[200px]">
          <StorageBar
            label="角色卡储存"
            usage={charUsage}
            quota={charStorageQuota}
            warnMessage="角色卡存储空间紧张，建议删除不常用的角色后继续使用"
          />

          {/* Shared card slot usage bar */}
          <div className="mb-3 px-1">
            <div className="flex items-center justify-between text-[11px] text-gray-400 dark:text-gray-500 mb-1">
              <span className="flex items-center gap-1">
                <Wallet size={12} />
                共享卡槽占用
              </span>
              <span>{sharedCount} / {slotMax} 个</span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-200 dark:bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  slotMax > 0 && sharedCount >= slotMax ? "bg-amber-500" : "bg-blue-500"
                }`}
                style={{ width: `${slotMax > 0 ? Math.max(2, Math.min(100, (sharedCount / slotMax) * 100)) : 0}%` }}
              />
            </div>
          </div>

          {notice && (
            <div
              className={`mb-3 px-3 py-2 text-sm rounded-lg ${
                notice.kind === "ok"
                  ? "bg-green-50 dark:bg-green-500/10 text-green-700 dark:text-green-400"
                  : "bg-red-50 dark:bg-red-500/10 text-red-700 dark:text-red-400"
              }`}
            >
              {notice.text}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3">
            {(settings.characters || []).map((character) => (
              <div
                key={character.id}
                onClick={() => handleSelectCharacter(character.id)}
                className={`flex items-start text-left p-4 rounded-xl border cursor-pointer transition-all duration-200 group relative ${
                  settings.currentCharacterId === character.id
                    ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500 shadow-sm"
                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20 hover:bg-gray-50 dark:hover:bg-white/10"
                }`}
              >
                <div className="flex-1 min-w-0 pr-16 flex items-start gap-3">
                  <CharacterThumb character={character} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h4
                        className={`text-base font-medium truncate ${
                          settings.currentCharacterId === character.id
                            ? "text-blue-700 dark:text-blue-400"
                            : "text-gray-900 dark:text-gray-100"
                        }`}
                      >
                        {character.name}
                      </h4>
                      {character.shared && (
                        <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-semibold rounded-md bg-purple-600/90 text-white">
                          共享
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                      {character.description}
                    </p>
                  </div>
                </div>

                <div className="absolute right-4 top-4 flex items-center gap-1">
                  {character.shared ? (
                    <>
                      {/* Shared card: update + delete (no share/export — the
                          design is read-only). The original uploader, when logged
                          in (account === owner), additionally gets 编辑/发布更新. */}
                      <button
                        onClick={(e) => handleUpdateShared(e, character)}
                        disabled={updatingId === character.id}
                        className="relative p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/20 rounded-md transition-colors disabled:opacity-50"
                        title="更新到服务器最新版本"
                      >
                        <RefreshCw size={14} className={updatingId === character.id ? "animate-spin" : ""} />
                        {character.globalId && updateStatus[character.globalId] === "update" && (
                          <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-500 ring-1 ring-white dark:ring-gray-900" />
                        )}
                      </button>
                      {account && character.owner === account && (
                        <button
                          onClick={(e) => handleEditShared(e, character)}
                          disabled={updatingId === character.id}
                          className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/20 rounded-md transition-colors disabled:opacity-50"
                          title="编辑并发布更新（作者本人）"
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                      {settings.currentCharacterId !== character.id && settings.characters.length > 1 && (
                        <button
                          onClick={(e) => handleDeleteRequest(e, character.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors"
                          title="从本地删除（共享卡槽占用 -1）"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        onClick={(e) => handleShareRequest(e, character)}
                        className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/20 rounded-md transition-colors"
                        title="分享角色"
                      >
                        <CloudUpload size={14} />
                      </button>
                      <button
                        onClick={(e) => handleOpenEdit(e, character)}
                        className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/20 rounded-md transition-colors"
                        title="编辑角色"
                      >
                        <Edit2 size={14} />
                      </button>
                      {settings.currentCharacterId !== character.id && settings.characters.length > 1 && (
                        <button
                          onClick={(e) => handleDeleteRequest(e, character.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/20 rounded-md transition-colors"
                          title="删除角色"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </>
                  )}
                </div>

                {settings.currentCharacterId === character.id && (
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
        title="删除角色"
        message={
          pendingDeleteCharacter
            ? pendingDeleteCharacter.shared
              ? `确定要从本地删除共享角色「${pendingDeleteCharacter.name}」吗？删除后账号共享卡槽占用 -1，此操作不可撤销。`
              : `确定要删除角色「${pendingDeleteCharacter.name}」吗？此操作不可撤销。`
            : "确定要删除该角色吗？此操作不可撤销。"
        }
        destructive
        confirmText="删除"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setPendingDeleteId(null)}
      />

      <CharacterEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={handleCreateCharacter}
        initialCharacter={editingCharacter}
        mode={editMode}
        onPublishUpdate={handlePublishUpdate}
      />

      {/* Share: warning dialog -> (login guide if logged out) -> share界面 */}
      <ConfirmDialog
        isOpen={pendingShare !== null}
        title="分享角色"
        message={
          <>
            您将为自己公开分享的角色承担所有责任，请三思而后行。
            <br />
            ⚠请勿转载分享「类脑」和「旅途」作者发布的角色卡。
          </>
        }
        confirmText="同意"
        cancelText="拒绝"
        onConfirm={handleShareConfirm}
        onCancel={() => setPendingShare(null)}
      />

      <CharacterShareModal
        isOpen={sharingCharacter !== null && shareSession !== null}
        onClose={() => setSharingCharacter(null)}
        character={sharingCharacter}
        token={shareSession?.token ?? ""}
        authorName={shareSession?.username ?? ""}
      />

      {/* Publish-update: author's edited card -> share界面 (pre-filled, PUT). */}
      <CharacterShareModal
        isOpen={updatePublish !== null}
        onClose={() => setUpdatePublish(null)}
        character={updatePublish?.character ?? null}
        token={storedToken}
        authorName={storedUsername}
        mode="update"
        globalId={updatePublish?.globalId}
        prefill={updatePublish?.prefill ?? null}
        coverBlob={updatePublish?.coverBlob ?? null}
        onUpdated={handleUpdatePublished}
      />

      <SharedLibraryModal
        isOpen={isLibraryOpen}
        onClose={() => setIsLibraryOpen(false)}
        sharedCount={sharedCount}
        onUse={handleUseShared}
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
    </>
  );
}

/** 25%-scale (128×192) cover thumbnail for a character list entry. Loads the
 *  cover blob from IndexedDB; shows a neutral placeholder when there is none. */
function CharacterThumb({ character }: { character: CharacterSettings }) {
  const url = useCoverObjectUrl(character.id, !!character.coverImage);
  return (
    <div
      className="flex-shrink-0 rounded-lg overflow-hidden bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10"
      style={{ width: 64, height: 96 }}
    >
      {url ? (
        <img src={url} alt={character.name} className="w-full h-full object-cover" draggable={false} />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-gray-300 dark:text-white/20">
          <Sparkles size={20} />
        </div>
      )}
    </div>
  );
}
