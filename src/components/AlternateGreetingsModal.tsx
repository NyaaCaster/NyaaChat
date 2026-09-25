import React, { useState, useEffect } from "react";
import { Plus, Trash2, ArrowUp, ArrowDown, MessagesSquare } from "lucide-react";
import { BaseModal } from "./BaseModal";

interface AlternateGreetingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  greetings: string[];
  onSave: (greetings: string[]) => void;
}

export function AlternateGreetingsModal({
  isOpen,
  onClose,
  greetings,
  onSave,
}: AlternateGreetingsModalProps) {
  const [list, setList] = useState<string[]>([]);

  useEffect(() => {
    if (isOpen) {
      setList(greetings ? [...greetings] : []);
    }
  }, [isOpen, greetings]);

  const handleAdd = () => {
    setList([...list, ""]);
  };

  const handleUpdate = (index: number, val: string) => {
    const next = [...list];
    next[index] = val;
    setList(next);
  };

  const handleDelete = (index: number) => {
    setList(list.filter((_, i) => i !== index));
  };

  const handleMoveUp = (index: number) => {
    if (index === 0) return;
    const next = [...list];
    const temp = next[index - 1];
    next[index - 1] = next[index];
    next[index] = temp;
    setList(next);
  };

  const handleMoveDown = (index: number) => {
    if (index === list.length - 1) return;
    const next = [...list];
    const temp = next[index + 1];
    next[index + 1] = next[index];
    next[index] = temp;
    setList(next);
  };

  const handleSave = () => {
    // 过滤掉纯空白的项
    const cleaned = list.map((s) => s.trim()).filter(Boolean);
    onSave(cleaned);
    onClose();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="其他开场 (Alternate Greetings)"
      titleIcon={<MessagesSquare size={18} className="text-blue-500" />}
      maxWidth="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <button
            type="button"
            onClick={handleAdd}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-200 dark:border-white/10 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors flex items-center gap-1.5 text-gray-700 dark:text-gray-300"
          >
            <Plus size={14} /> 添加开场白
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-white/5 rounded-xl transition-colors"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition-colors shadow-sm"
            >
              保存修改
            </button>
          </div>
        </div>
      }
    >
      <div className="space-y-4 py-1">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          配置角色的备用开场白，在新建会话时可通过开场消息底部的翻页器自由切换。
        </p>
        {list.length === 0 ? (
          <div className="text-center py-8 px-4 border border-dashed border-gray-200 dark:border-white/10 rounded-xl">
            <MessagesSquare size={36} className="mx-auto mb-2 text-gray-400 dark:text-gray-600 opacity-60" />
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">暂无额外开场白</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              点击下方或左侧的“添加开场白”为角色添加多个不同的起始剧情。
            </p>
          </div>
        ) : (
          list.map((item, index) => (
            <div
              key={index}
              className="p-3 bg-gray-50 dark:bg-white/[0.02] border border-gray-200 dark:border-white/10 rounded-xl space-y-2"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                  开场白 #{index + 1}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleMoveUp(index)}
                    disabled={index === 0}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="上移"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveDown(index)}
                    disabled={index === list.length - 1}
                    className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    title="下移"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(index)}
                    className="p-1 text-red-400 hover:text-red-600 transition-colors ml-1"
                    title="删除"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <textarea
                value={item}
                onChange={(e) => handleUpdate(index, e.target.value)}
                placeholder={`输入开场白 #${index + 1} 的内容...`}
                rows={3}
                className="w-full px-3 py-2 text-sm bg-white dark:bg-black/20 border border-gray-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow resize-none"
              />
            </div>
          ))
        )}
      </div>
    </BaseModal>
  );
}
