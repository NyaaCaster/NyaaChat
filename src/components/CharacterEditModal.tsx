import React, { useState, useCallback } from "react";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  restrictToParentElement,
  restrictToVerticalAxis,
} from "@dnd-kit/modifiers";
import { Save, Plus, Download, Upload, Edit2, Trash2, FileJson, Cat, ImagePlus, X, CloudUpload, Book, GripVertical } from "lucide-react";
import { CharacterSettings, WorldInfoRule } from "../types";
import { newId } from "../lib/id";
import { convertToSillyTavernCharacter } from "../lib/sillyTavernExport";
import {
  isSillyTavernFormat,
  convertSillyTavernCharacter,
  convertNativeCard,
  extractCharaJson,
} from "../lib/sillyTavernImport";
import { exportCharacterPng, imageBlobToCoverWebp } from "../lib/pngCard";
import { loadCover, saveCover, deleteCover, COVER_MARKER } from "../lib/coverStorage";
import { BaseModal } from "./BaseModal";
import { DeleteConfirmDialog } from "./DeleteConfirmDialog";
import { WorldInfoRuleModal } from "./WorldInfoRuleModal";
import { KnowledgeBaseModal } from "./KnowledgeBaseModal";
import { ImageCropModal } from "./ImageCropModal";

interface CharacterEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (character: CharacterSettings) => void;
  initialCharacter?: CharacterSettings | null;
  /** Editing mode. "local" (default) is the normal private-card editor:
   *  保存角色 writes back to settings, 角色导出 exports a PNG. "shared-author" is
   *  the author editing their own shared card (phase 5b): 保存角色 becomes
   *  发布更新 (hands the edited card to the share flow via onPublishUpdate instead
   *  of writing local), and 角色导出 becomes 角色导入 (edit by importing a PNG). */
  mode?: "local" | "shared-author";
  /** shared-author only: called with the edited character + its resolved cover
   *  blob (pending crop, stored cover, or null if removed) when 发布更新 is
   *  clicked. The parent opens the share 界面 pre-filled to publish the update. */
  onPublishUpdate?: (character: CharacterSettings, coverBlob: Blob | null) => void;
}

export function CharacterEditModal({
  isOpen,
  onClose,
  onSave,
  initialCharacter,
  mode = "local",
  onPublishUpdate,
}: CharacterEditModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [firstMes, setFirstMes] = useState("");
  const [worldInfo, setWorldInfo] = useState<WorldInfoRule[]>([]);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<WorldInfoRule | null>(null);
  const [pendingDeleteRuleId, setPendingDeleteRuleId] = useState<string | null>(null);
  const [isExportChooserOpen, setIsExportChooserOpen] = useState(false);
  const [isKbManagerOpen, setIsKbManagerOpen] = useState(false);

  // Cover image. `cardId` is fixed for the lifetime of this open editor so a
  // brand-new character can key its cover blob before it has been saved into
  // settings (the same id is used as the saved character id). The cropped blob
  // is held in memory and only committed to IndexedDB on save, so cancelling a
  // new character leaves no orphan blob behind.
  const cardIdRef = React.useRef<string>(newId());
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const coverBlobRef = React.useRef<Blob | null>(null);
  const [coverRemoved, setCoverRemoved] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  // Latest preview object URL, tracked so we can revoke it on replace/unmount.
  const previewUrlRef = React.useRef<string | null>(null);

  const setPreview = (url: string | null) => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url;
    setCoverUrl(url);
  };

  React.useEffect(() => {
    if (!isOpen) return;
    // Reset cover working state on every open.
    coverBlobRef.current = null;
    setCoverRemoved(false);
    setImportError(null);
    setPreview(null);
    if (initialCharacter) {
      setName(initialCharacter.name);
      setDescription(initialCharacter.description);
      setFirstMes(initialCharacter.firstMes || "");
      setWorldInfo(initialCharacter.worldInfo || []);
      cardIdRef.current = initialCharacter.id;
      // Load an existing cover from IndexedDB for preview.
      if (initialCharacter.coverImage) {
        const id = initialCharacter.id;
        loadCover(id).then((blob) => {
          // Guard against a stale resolve after the editor was reopened on a
          // different character.
          if (blob && cardIdRef.current === id && !coverBlobRef.current) {
            setPreview(URL.createObjectURL(blob));
          }
        });
      }
    } else {
      setName("");
      setDescription("");
      setFirstMes("");
      setWorldInfo([]);
      cardIdRef.current = newId();
    }
  }, [initialCharacter, isOpen]);

  // Revoke the preview object URL on unmount.
  React.useEffect(
    () => () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

  const handlePickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    setCropSrc(URL.createObjectURL(file));
  };

  const handleCropped = (blob: Blob) => {
    coverBlobRef.current = blob;
    setCoverRemoved(false);
    setPreview(URL.createObjectURL(blob));
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleCropCancel = () => {
    if (cropSrc) URL.revokeObjectURL(cropSrc);
    setCropSrc(null);
  };

  const handleRemoveCover = () => {
    coverBlobRef.current = null;
    setCoverRemoved(true);
    setPreview(null);
  };

  /** Commit the pending cover decision to IndexedDB and return the marker to
   *  store on the character. Awaited by handleSave before persisting settings. */
  const commitCover = async (id: string): Promise<string | undefined> => {
    if (coverBlobRef.current) {
      await saveCover(id, coverBlobRef.current);
      return COVER_MARKER;
    }
    if (coverRemoved) {
      await deleteCover(id);
      return undefined;
    }
    return initialCharacter?.coverImage;
  };

  const handleSave = async () => {
    if (!name.trim()) return;

    const id = initialCharacter?.id || cardIdRef.current;
    // Cover persistence is non-fatal — a failure here should never silently
    // discard character edits (worldInfo, linkedKbIds, etc.).
    // commitCover returns the IndexedDB marker string (COVER_MARKER), not the
    // blob itself — the blob lives in IndexedDB, the card only stores the marker.
    let coverImage: string | undefined;
    try {
      coverImage = await commitCover(id);
    } catch {
      // commitCover failed; proceed without a cover update.
    }

    onSave({
      id,
      name: name.trim(),
      description: description.trim(),
      firstMes: firstMes.trim() || undefined,
      worldInfo: worldInfo,
      ...(coverImage ? { coverImage } : {}),
      // Preserve card data this modal has no editor for, so editing+saving a
      // character never silently strips its character-scoped regex (managed in
      // the 正则 panel), ST extension bindings / character variables, or the
      // shared-system metadata groundwork.
      ...(initialCharacter?.regexScripts ? { regexScripts: initialCharacter.regexScripts } : {}),
      ...(initialCharacter?.extensions ? { extensions: initialCharacter.extensions } : {}),
      ...(initialCharacter?.version !== undefined ? { version: initialCharacter.version } : {}),
      ...(initialCharacter?.globalId ? { globalId: initialCharacter.globalId } : {}),
      ...(initialCharacter?.author ? { author: initialCharacter.author } : {}),
      ...(initialCharacter?.source ? { source: initialCharacter.source } : {}),
      ...(initialCharacter?.intro ? { intro: initialCharacter.intro } : {}),
      ...(initialCharacter?.shared ? { shared: initialCharacter.shared } : {}),
      ...(initialCharacter?.owner ? { owner: initialCharacter.owner } : {}),
    });

    onClose();
  };

  // Assemble the character from the current (possibly edited) modal state, plus
  // the card data this modal has no editor for (regex / extensions / shared
  // metadata) carried from initialCharacter. Shared by both export formats.
  const buildCurrentCharacter = useCallback((): CharacterSettings => ({
    id: initialCharacter?.id || cardIdRef.current,
    name: name.trim(),
    description: description.trim(),
    firstMes: firstMes.trim() || undefined,
    worldInfo: worldInfo,
    ...(coverBlobRef.current || (!coverRemoved && initialCharacter?.coverImage)
      ? { coverImage: COVER_MARKER }
      : {}),
    ...(initialCharacter?.regexScripts ? { regexScripts: initialCharacter.regexScripts } : {}),
    ...(initialCharacter?.extensions ? { extensions: initialCharacter.extensions } : {}),
    ...(initialCharacter?.version !== undefined ? { version: initialCharacter.version } : {}),
    ...(initialCharacter?.globalId ? { globalId: initialCharacter.globalId } : {}),
    ...(initialCharacter?.author ? { author: initialCharacter.author } : {}),
    ...(initialCharacter?.source ? { source: initialCharacter.source } : {}),
    ...(initialCharacter?.intro ? { intro: initialCharacter.intro } : {}),
    ...(initialCharacter?.shared ? { shared: initialCharacter.shared } : {}),
    ...(initialCharacter?.owner ? { owner: initialCharacter.owner } : {}),
  }), [initialCharacter, name, description, firstMes, worldInfo, coverRemoved]);

  /** Resolve the cover blob to use as the export PNG's pixel carrier: the
   *  pending (just-cropped) blob if any, else the one already in IndexedDB,
   *  else null (the encoder falls back to a built-in placeholder). */
  const resolveCoverBlob = async (id: string): Promise<Blob | null> => {
    if (coverBlobRef.current) return coverBlobRef.current;
    if (coverRemoved) return null;
    if (initialCharacter?.coverImage) return await loadCover(id);
    return null;
  };

  // --- phase 5b: author editing their own shared card ----------------------
  // 发布更新: hand the edited character + its resolved cover to the parent, which
  // opens the share 界面 pre-filled to publish the update. We do NOT write to
  // local settings here — the parent re-syncs the local card after a successful
  // publish (so a cancelled publish leaves the local card untouched).
  const handlePublishUpdate = async () => {
    if (!name.trim()) return;
    const c = buildCurrentCharacter();
    const cover = await resolveCoverBlob(c.id);
    onPublishUpdate?.(c, cover);
  };

  // 角色导入: edit-by-import. Replace the current editor fields from a PNG card
  // (same parsing as the selection modal's import), so the author can swap in a
  // revised card before publishing. The shared metadata + id are preserved (we
  // only pull name/description/firstMes/worldInfo + cover from the import).
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleImportForEdit = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (importInputRef.current) importInputRef.current.value = "";
    if (!file) return;
    setImportError(null);
    try {
      if (!file.name.toLowerCase().endsWith(".png")) {
        throw new Error("仅支持 PNG 角色卡");
      }
      const raw = await extractCharaJson(file);
      const imported: CharacterSettings = isSillyTavernFormat(raw)
        ? convertSillyTavernCharacter(raw)
        : convertNativeCard(raw);
      // Pull the editable fields into the form; keep id + shared metadata as-is.
      setName(imported.name);
      setDescription(imported.description);
      setFirstMes(imported.firstMes || "");
      setWorldInfo(imported.worldInfo || []);
      // Use the imported PNG's pixels as the new cover (re-encoded to 512×768).
      try {
        const coverWebp = await imageBlobToCoverWebp(file);
        coverBlobRef.current = coverWebp;
        setCoverRemoved(false);
        setPreview(URL.createObjectURL(coverWebp));
      } catch {
        // keep the existing cover on decode failure
      }
    } catch (err: any) {
      setImportError("角色卡导入失败：" + (err?.message || String(err)));
    }
  };

  const downloadPng = (blob: Blob, filenamePrefix: string) => {
    const url = URL.createObjectURL(blob);
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const timestamp = `${now.getFullYear().toString().slice(-2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeName = (name.trim() || "未命名").replace(/[\\/:*?"<>|]/g, "_");
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenamePrefix}-${safeName}-${timestamp}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportNyaaChat = async () => {
    // NyaaChat-native character card embedded in a PNG (tEXt `chara`). The JSON
    // is a lossless round-trip of CharacterSettings, deliberately NOT shaped
    // like a SillyTavern card: regex stays under our own top-level
    // `regexScripts`; `extensions` is an opaque passthrough. The cover image
    // (or a placeholder) is the PNG's visible pixels — never written into JSON.
    const c = buildCurrentCharacter();
    const data = {
      format: "nyaachat-character",
      version: 1,
      name: c.name,
      description: c.description,
      ...(c.firstMes ? { firstMes: c.firstMes } : {}),
      worldInfo: c.worldInfo ?? [],
      ...(c.regexScripts && c.regexScripts.length ? { regexScripts: c.regexScripts } : {}),
      ...(c.extensions && Object.keys(c.extensions).length ? { extensions: c.extensions } : {}),
      ...(c.author ? { author: c.author } : {}),
      ...(c.source ? { source: c.source } : {}),
      ...(c.intro ? { intro: c.intro } : {}),
    };
    const cover = await resolveCoverBlob(c.id);
    const png = await exportCharacterPng(data, cover);
    downloadPng(png, "NyaaChatChar");
    setIsExportChooserOpen(false);
  };

  const exportSillyTavern = async () => {
    // SillyTavern chara_card_v3 embedded in a PNG (tEXt `chara`) — the canonical
    // ST card form. World info is reverse-migrated to at-depth entries (see
    // sillyTavernExport.ts). Lossy: hard/soft authority is dropped (ST has no
    // such concept), mirroring the importer's soft default.
    const c = buildCurrentCharacter();
    const card = convertToSillyTavernCharacter(c);
    const cover = await resolveCoverBlob(c.id);
    const png = await exportCharacterPng(card, cover);
    downloadPng(png, "SillyTavernChar");
    setIsExportChooserOpen(false);
  };

  const handleAddRule = () => {
    setEditingRule(null);
    setIsRuleModalOpen(true);
  };

  const handleEditRule = (rule: WorldInfoRule) => {
    setEditingRule(rule);
    setIsRuleModalOpen(true);
  };

  const handleDeleteRule = (id: string) => {
    setPendingDeleteRuleId(id);
  };

  const handleConfirmDeleteRule = () => {
    if (!pendingDeleteRuleId) return;
    setWorldInfo((prev) => prev.filter((r) => r.id !== pendingDeleteRuleId));
    setPendingDeleteRuleId(null);
  };

  const handleToggleRule = (id: string) => {
    setWorldInfo((prev) => prev.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)));
  };

  const handleSaveRule = (rule: WorldInfoRule) => {
    if (editingRule) {
      setWorldInfo((prev) => prev.map((r) => (r.id === rule.id ? rule : r)));
    } else {
      setWorldInfo((prev) => [...prev, rule]);
    }
  };

  // Drag-to-reorder of world-info entries. Only the list order changes — the
  // entry objects are untouched, and the new array order is what gets saved
  // verbatim (handleSave) and feeds prompt assembly (chatPipeline renders
  // rules in saved array order), so "UI top = prompt earlier" holds by
  // construction without touching the pipeline.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleRuleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = worldInfo.findIndex((r) => r.id === active.id);
    const newIdx = worldInfo.findIndex((r) => r.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    setWorldInfo((prev) => arrayMove(prev, oldIdx, newIdx));
  };

  /** Persist the character (without closing the modal). Used before opening
   *  login or KB manager from within WorldInfoRuleModal, so rule edits aren't
   *  lost. Uses buildCurrentCharacter which assembles the full character from
   *  current editor state. */
  const persistCharacter = useCallback(() => {
    if (!name.trim()) return;
    onSave(buildCurrentCharacter());
  }, [name, onSave, buildCurrentCharacter]);

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title={mode === "shared-author" ? "编辑共享角色" : initialCharacter ? "编辑角色" : "创建角色"}
        maxWidth="max-w-lg"
        closeOnBackdrop={false}
        footer={
          <div className="space-y-2">
            {mode === "shared-author" && importError && (
              <p className="text-xs text-red-500 dark:text-red-400 break-all">{importError}</p>
            )}
            <div className="flex gap-3">
              {mode === "shared-author" ? (
                <button
                  onClick={() => importInputRef.current?.click()}
                  className="flex-shrink-0 px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
                  title="以导入角色卡的方式替换当前内容"
                >
                  <Upload size={16} /> 角色导入
                </button>
              ) : (
                <button
                  onClick={() => setIsExportChooserOpen(true)}
                  className="flex-shrink-0 px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Download size={16} /> 角色导出
                </button>
              )}
              {mode === "shared-author" ? (
                <button
                  onClick={handlePublishUpdate}
                  disabled={!name.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 border border-transparent disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
                >
                  <CloudUpload size={16} /> 发布更新
                </button>
              ) : (
                <button
                  onClick={handleSave}
                  disabled={!name.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 border border-transparent disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
                >
                  <Save size={16} /> 保存角色
                </button>
              )}
            </div>
          </div>
        }
      >
        <div className="p-4 sm:p-5">
          <input
            type="file"
            accept=".png"
            className="hidden"
            ref={importInputRef}
            onChange={handleImportForEdit}
          />
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                角色封面 (Cover)
              </label>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                ref={fileInputRef}
                onChange={handlePickFile}
              />
              <div className="flex justify-center">
                {coverUrl ? (
                  // 50% of the 512×768 source = 256×384 preview.
                  <div className="relative group" style={{ width: 256, height: 384 }}>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="block w-full h-full rounded-xl overflow-hidden border border-gray-200 dark:border-white/10"
                      title="点击更换封面"
                    >
                      <img src={coverUrl} alt="角色封面" className="w-full h-full object-cover" draggable={false} />
                    </button>
                    <button
                      type="button"
                      onClick={handleRemoveCover}
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/50 hover:bg-black/70 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      title="移除封面"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 dark:border-white/15 text-gray-400 dark:text-gray-500 hover:border-blue-400 hover:text-blue-500 dark:hover:border-blue-500 transition-colors"
                    style={{ width: 256, height: 384 }}
                    title="添加封面图"
                  >
                    <ImagePlus size={32} />
                    <span className="text-xs">添加封面图</span>
                    <span className="text-[10px] opacity-70">512 × 768</span>
                  </button>
                )}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                角色名 (Character Name)
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. 猫娘"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                角色概述 (Character Description)
              </label>
              <textarea
                className="w-full px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow resize-none min-h-[120px]"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="描述角色的核心设定、说话方式等..."
              />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">
                第一条消息 (First Message)
              </label>
              <textarea
                className="w-full px-3 py-2 text-sm bg-transparent border border-gray-200 dark:border-white/10 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow resize-none min-h-[80px]"
                value={firstMes}
                onChange={(e) => setFirstMes(e.target.value)}
                placeholder="对话开始时角色自动发送的第一条消息（可选）..."
              />
            </div>

            <div className="pt-2">
              <div className="flex items-center justify-between mb-2 px-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  规则条目 (World Info)
                </label>
              </div>

              {worldInfo.length > 0 && (
                <p className="text-[10px] text-gray-400 dark:text-gray-500 mb-2">
                  拖拽左侧把手调整条目顺序：越靠上，提示词中的逻辑位置越靠前（保存后生效）
                </p>
              )}
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleRuleDragEnd}
                modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              >
                <SortableContext
                  items={worldInfo.map((r) => r.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2 mb-4">
                    {worldInfo.map((rule) => (
                      <SortableWorldInfoRow
                        key={rule.id}
                        rule={rule}
                        onToggle={() => handleToggleRule(rule.id)}
                        onEdit={() => handleEditRule(rule)}
                        onDelete={() => handleDeleteRule(rule.id)}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              <button
                onClick={handleAddRule}
                className="w-full px-4 py-2 bg-transparent border border-gray-200 border-dashed dark:border-white/20 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
              >
                <Plus size={16} /> 添加规则
              </button>
            </div>
          </div>
        </div>
      </BaseModal>

      <WorldInfoRuleModal
        isOpen={isRuleModalOpen}
        onClose={() => setIsRuleModalOpen(false)}
        onSave={handleSaveRule}
        initialRule={editingRule}
        onPersistCharacter={persistCharacter}
        onOpenKnowledgeBase={() => setIsKbManagerOpen(true)}
      />

      <DeleteConfirmDialog
        isOpen={pendingDeleteRuleId !== null}
        onConfirm={handleConfirmDeleteRule}
        onCancel={() => setPendingDeleteRuleId(null)}
      />

      <ImageCropModal
        isOpen={cropSrc !== null}
        src={cropSrc}
        onCancel={handleCropCancel}
        onCrop={handleCropped}
      />

      <KnowledgeBaseModal
        isOpen={isKbManagerOpen}
        onClose={() => setIsKbManagerOpen(false)}
      />

      <BaseModal
        isOpen={isExportChooserOpen}
        onClose={() => setIsExportChooserOpen(false)}
        title="选择导出格式"
        titleIcon={<Download size={16} className="text-blue-500" />}
        maxWidth="max-w-md"
      >
        <div className="p-4 sm:p-5 space-y-3">
          <button
            onClick={exportNyaaChat}
            className="w-full text-left p-4 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 rounded-xl transition-all flex items-start gap-3 group"
          >
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
              <Cat size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">NyaaChat 格式</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                导出为 PNG 角色卡（封面即图片），完整保留规则约束强度、绑定正则与角色变量，可无损导回 NyaaChat。
              </p>
            </div>
          </button>

          <button
            onClick={exportSillyTavern}
            className="w-full text-left p-4 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 hover:border-blue-500 dark:hover:border-blue-500 hover:bg-blue-50/50 dark:hover:bg-blue-900/10 rounded-xl transition-all flex items-start gap-3 group"
          >
            <div className="flex-shrink-0 w-9 h-9 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-500">
              <FileJson size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">SillyTavern 格式</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                导出为 PNG 角色卡（chara_card_v3），可被 SillyTavern 直接导入，世界书按 ST 规则迁移。注意：约束强度（软/硬）无对应概念，导出时会丢弃。
              </p>
            </div>
          </button>
        </div>
      </BaseModal>
    </>
  );
}

// ---------------------------------------------------------------------------
// World-info rule row (drag-sortable). Ordering is the source of truth for
// prompt assembly: chatPipeline renders rules in the saved array order, so a
// drag here becomes "earlier in the list = earlier in the prompt" (within the
// fixed global prompt structure — permanent entries live in the static prefix,
// keyword entries in <session_rules>, hard/soft sectioned — which this drag
// must not and does not re-arrange).
// ---------------------------------------------------------------------------

interface SortableWorldInfoRowProps {
  rule: WorldInfoRule;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function SortableWorldInfoRow({
  rule,
  onToggle,
  onEdit,
  onDelete,
}: SortableWorldInfoRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: rule.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/5 rounded-xl group transition-all"
    >
      <div className="flex items-center gap-3 overflow-hidden">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="p-1 cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 touch-none flex-shrink-0"
          aria-label={`拖动调整 ${rule.name} 的顺序`}
        >
          <GripVertical size={14} />
        </button>
        <button
          onClick={onToggle}
          className={`flex-shrink-0 w-8 h-4 rounded-full relative transition-colors ${
            rule.enabled ? "bg-blue-500" : "bg-gray-300 dark:bg-gray-600"
          }`}
          aria-label={rule.enabled ? "禁用规则" : "启用规则"}
        >
          <div
            className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
              rule.enabled ? "translate-x-4.5" : "translate-x-0.5"
            }`}
          />
        </button>
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
            {rule.name}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={`text-[10px] px-1 rounded ${
                rule.triggerType === "permanent"
                  ? "bg-blue-100 dark:bg-blue-900/30 text-blue-600"
                  : "bg-green-100 dark:bg-green-900/30 text-green-600"
              }`}
            >
              {rule.triggerType === "permanent" ? "永久" : "关键字"}
            </span>
            <span className="text-[10px] text-gray-500 dark:text-gray-400">
              {rule.position === "system" ? "⚙系统" : "🤖角色"}
            </span>
            {rule.hard && (
              <span className="text-[10px] px-1 rounded bg-red-100 dark:bg-red-900/30 text-red-600">
                硬约束
              </span>
            )}
            {rule.linkedKbIds && rule.linkedKbIds.length > 0 && (
              <span className="text-[10px] px-1 rounded bg-purple-100 dark:bg-purple-900/30 text-purple-600 flex items-center gap-0.5">
                <Book size={10} />
                {rule.linkedKbIds.length}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={onEdit}
          className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-white dark:hover:bg-white/10 rounded-lg transition-all"
          aria-label="编辑规则"
        >
          <Edit2 size={14} />
        </button>
        <button
          onClick={onDelete}
          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-white dark:hover:bg-white/10 rounded-lg transition-all"
          aria-label="删除规则"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}
