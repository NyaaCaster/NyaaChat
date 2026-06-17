import React, { useState, useRef } from "react";
import { Sparkles, Plus, Upload, Check, Edit2, Trash2, CloudUpload, Library } from "lucide-react";
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
import { useCoverObjectUrl } from "../hooks/useCoverObjectUrl";
import { BaseModal } from "./BaseModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { CharacterEditModal } from "./CharacterEditModal";
import { CharacterShareModal } from "./CharacterShareModal";
import { SharedLibraryModal } from "./SharedLibraryModal";
import { UserAccountModal } from "./UserAccountModal";

interface CharacterSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
}

export function CharacterSelectionModal({
  isOpen,
  onClose,
  settings,
  onSave,
}: CharacterSelectionModalProps) {
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingCharacter, setEditingCharacter] = useState<CharacterSettings | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  // Share flow: a character awaiting the warning dialog, the one being shared,
  // and a flag to surface the account modal when sharing while logged out.
  const [pendingShare, setPendingShare] = useState<CharacterSettings | null>(null);
  const [sharingCharacter, setSharingCharacter] = useState<CharacterSettings | null>(null);
  const [shareSession, setShareSession] = useState<{ token: string; username: string } | null>(null);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [isLibraryOpen, setIsLibraryOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSelectCharacter = (id: string) => {
    onSave({
      ...settings,
      currentCharacterId: id,
    });
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
    setEditingCharacter(character);
    setIsEditModalOpen(true);
  };

  const handleOpenCreate = () => {
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
  const handleShareConfirm = () => {
    const character = pendingShare;
    setPendingShare(null);
    if (!character) return;
    const stored = loadStoredAccount();
    if (!stored) {
      setIsAccountOpen(true);
      return;
    }
    setShareSession({ token: stored.token, username: stored.profile.username });
    setSharingCharacter(character);
  };

  const pendingDeleteCharacter = pendingDeleteId
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
                    <h4
                      className={`text-base font-medium mb-1 truncate ${
                        settings.currentCharacterId === character.id
                          ? "text-blue-700 dark:text-blue-400"
                          : "text-gray-900 dark:text-gray-100"
                      }`}
                    >
                      {character.name}
                    </h4>
                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                      {character.description}
                    </p>
                  </div>
                </div>

                <div className="absolute right-4 top-4 flex items-center gap-1">
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
            ? `确定要删除角色「${pendingDeleteCharacter.name}」吗？此操作不可撤销。`
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

      <UserAccountModal isOpen={isAccountOpen} onClose={() => setIsAccountOpen(false)} />

      <SharedLibraryModal isOpen={isLibraryOpen} onClose={() => setIsLibraryOpen(false)} />
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
