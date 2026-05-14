import React, { useState, useRef } from "react";
import { Sparkles, X, Plus, Upload, Check, Edit2, Trash2 } from "lucide-react";
import { AppState, CharacterSettings } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { CharacterEditModal } from "./CharacterEditModal";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSelectCharacter = (id: string) => {
    onSave({
      ...settings,
      currentCharacterId: id,
    });
    onClose();
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);

        // Validation for character format
        if (!parsed || typeof parsed !== "object")
          throw new Error("Invalid JSON object");
        if (!parsed.name || typeof parsed.name !== "string")
          throw new Error('Missing or invalid "name"');
        if (!parsed.description || typeof parsed.description !== "string")
          throw new Error('Missing or invalid "description"');

        const newCharacter: CharacterSettings = {
          id: Date.now().toString(),
          name: parsed.name,
          description: parsed.description,
          worldInfo: Array.isArray(parsed.worldInfo) ? parsed.worldInfo : [],
        };

        onSave({
          ...settings,
          characters: [...(settings.characters || []), newCharacter],
        });
      } catch (err: any) {
        alert("角色配置内容格式错误: " + err.message);
      }

      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };
    reader.readAsText(file);
  };

  const handleCreateCharacter = (character: CharacterSettings) => {
    if (editingCharacter) {
      // Update existing
      onSave({
        ...settings,
        characters: settings.characters.map((c) =>
          c.id === character.id ? character : c
        ),
      });
    } else {
      // Add new
      onSave({
        ...settings,
        characters: [...(settings.characters || []), character],
      });
    }
    setEditingCharacter(null);
  };

  const handleDeleteCharacter = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (settings.characters.length <= 1) {
      return;
    }

    const newCharacters = settings.characters.filter((c) => c.id !== id);
    let nextCurrentId = settings.currentCharacterId;

    if (settings.currentCharacterId === id) {
      nextCurrentId = newCharacters[0].id;
    }

    onSave({
      ...settings,
      characters: newCharacters,
      currentCharacterId: nextCurrentId,
    });
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

  return (
    <>
      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 transition-opacity"
            />
            <div className="fixed inset-0 flex items-center justify-center p-4 z-50 pointer-events-none">
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 10 }}
                className="bg-white/90 dark:bg-[#111111]/90 backdrop-blur-xl w-full max-w-lg rounded-2xl shadow-elevation-3 border border-gray-200/50 dark:border-white/10 pointer-events-auto overflow-hidden flex flex-col max-h-[90vh]"
              >
                <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-100 dark:border-white/5">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                      <Sparkles
                        size={16}
                        className="text-blue-600 dark:text-blue-400"
                      />
                    </div>
                    <h3
                      className="text-lg font-semibold tracking-tight"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      角色选择
                    </h3>
                  </div>
                  <button
                    onClick={onClose}
                    className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-all"
                  >
                    <X size={18} />
                  </button>
                </div>

                <div className="p-4 sm:p-5 overflow-y-auto w-full flex-1 min-h-[200px]">
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
                        <div className="flex-1 min-w-0 pr-12">
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
                        
                        <div className="absolute right-4 top-4 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => handleOpenEdit(e, character)}
                            className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/20 rounded-md transition-colors"
                            title="编辑角色"
                          >
                            <Edit2 size={14} />
                          </button>
                          {settings.currentCharacterId !== character.id && (
                            <button
                              onClick={(e) => handleDeleteCharacter(e, character.id)}
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

                <div className="p-4 sm:p-5 border-t border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-black/20 flex gap-3">
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleImport}
                  />
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
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>

      <CharacterEditModal
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={handleCreateCharacter}
        initialCharacter={editingCharacter}
      />
    </>
  );
}
