import React, { useEffect, useState } from "react";
import { Book, Check, Loader2, Plus } from "lucide-react";
import { BaseModal } from "./BaseModal";
import type { KnowledgeBase } from "../lib/knowledgeApi";

interface KnowledgeBaseSelectModalProps {
  isOpen: boolean;
  onClose: () => void;
  kbList: KnowledgeBase[];
  initialSelectedIds: string[];
  onConfirm: (selectedIds: string[]) => void;
  /** Called when the user clicks "创建知识库" in the empty state. */
  onCreateNew: () => void;
}

function formatTokenCount(charTotal: number): string {
  if (charTotal < 1000) return `${charTotal} 字符`;
  if (charTotal < 10000) return `${(charTotal / 1000).toFixed(1)}k 字符`;
  return `${(charTotal / 1000).toFixed(0)}k 字符`;
}

export function KnowledgeBaseSelectModal({
  isOpen,
  onClose,
  kbList,
  initialSelectedIds,
  onConfirm,
  onCreateNew,
}: KnowledgeBaseSelectModalProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen) {
      setSelected(new Set(initialSelectedIds));
    }
  }, [isOpen, initialSelectedIds]);

  const toggleKb = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleConfirm = () => {
    onConfirm(Array.from(selected));
    onClose();
  };

  const handleCreateNew = () => {
    onClose();
    onCreateNew();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="关联知识库"
      titleIcon={<Book size={16} className="text-blue-600 dark:text-blue-400" />}
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
            onClick={handleConfirm}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-blue-500/20 flex items-center justify-center gap-2"
          >
            <Check size={14} />
            确定关联{selected.size > 0 ? `（已选 ${selected.size} 个）` : ""}
          </button>
        </div>
      }
    >
      <div className="p-4 sm:p-5 min-h-[200px]">
        {kbList.length === 0 ? (
          /* Empty state — no KBs at all */
          <div className="py-10 text-center text-sm text-gray-400 dark:text-gray-500 border-2 border-dashed border-gray-200 dark:border-white/10 rounded-xl space-y-4">
            <Book size={32} className="mx-auto text-gray-300 dark:text-white/20" />
            <p>暂无知识库，请先创建一个</p>
            <button
              onClick={handleCreateNew}
              className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all inline-flex items-center gap-2 hover:shadow-glow"
            >
              <Plus size={14} />
              创建知识库
            </button>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 px-1">
              选择要关联到此规则条目的知识库（可多选）
            </p>
            <div className="grid grid-cols-1 gap-3">
              {kbList.map((kb) => {
                const isSelected = selected.has(kb.id);
                return (
                  <button
                    key={kb.id}
                    type="button"
                    onClick={() => toggleKb(kb.id)}
                    className={`flex items-start text-left p-4 rounded-xl border transition-all duration-200 group ${
                      isSelected
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 ring-1 ring-blue-500"
                        : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 hover:border-gray-300 dark:hover:border-white/20"
                    }`}
                  >
                    {/* checkbox */}
                    <div
                      className={`mt-0.5 w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mr-3 transition-colors ${
                        isSelected
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "border-gray-300 dark:border-white/30"
                      }`}
                    >
                      {isSelected && <Check size={12} strokeWidth={3} />}
                    </div>

                    {/* content */}
                    <div className="flex-1 min-w-0">
                      <h4 className="text-sm font-medium text-gray-900 dark:text-gray-100 mb-0.5">
                        {kb.name}
                      </h4>
                      {kb.description && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-2 mb-1.5">
                          {kb.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 text-[10px] text-gray-400 dark:text-gray-500">
                        <span className="flex items-center gap-1">
                          <Book size={10} />
                          {formatTokenCount(kb.charTotal)}
                        </span>
                        <span>·</span>
                        <span>{kb.documentCount} 个文档</span>
                        <span>·</span>
                        <span>{kb.chunkCount} 个分块</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </BaseModal>
  );
}
