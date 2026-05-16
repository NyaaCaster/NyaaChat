import React, { useState, useEffect } from "react";
import { X, Sparkles, Globe, Key, Clock, Shield, User } from "lucide-react";
import { WorldInfoRule } from "../types";
import { motion, AnimatePresence } from "motion/react";

interface WorldInfoRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rule: WorldInfoRule) => void;
  initialRule?: WorldInfoRule | null;
}

export function WorldInfoRuleModal({
  isOpen,
  onClose,
  onSave,
  initialRule,
}: WorldInfoRuleModalProps) {
  const [name, setName] = useState("");
  const [triggerType, setTriggerType] = useState<"permanent" | "keywords">("permanent");
  const [keywords, setKeywords] = useState("");
  const [position, setPosition] = useState<"system" | "assistant">("system");
  const [content, setContent] = useState("");

  useEffect(() => {
    if (initialRule) {
      setName(initialRule.name);
      setTriggerType(initialRule.triggerType);
      setKeywords(initialRule.keywords || "");
      setPosition(initialRule.position);
      setContent(initialRule.content);
    } else {
      setName("");
      setTriggerType("permanent");
      setKeywords("");
      setPosition("system");
      setContent("");
    }
  }, [initialRule, isOpen]);

  const handleSave = () => {
    if (!name.trim() || !content.trim()) return;

    onSave({
      id: initialRule?.id || Date.now().toString(),
      name: name.trim(),
      triggerType,
      keywords: triggerType === "keywords" ? keywords.trim() : undefined,
      position,
      content: content.trim(),
      enabled: initialRule ? initialRule.enabled : true,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="relative w-full max-w-lg bg-white dark:bg-[#121212] rounded-3xl shadow-2xl overflow-hidden border border-gray-200 dark:border-white/10"
        >
          {/* Header */}
          <div className="p-6 border-b border-gray-100 dark:border-white/5 flex items-center justify-between bg-gray-50/50 dark:bg-white/[0.02]">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center text-blue-500">
                <Globe size={20} />
              </div>
              <div>
                <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white" style={{ fontFamily: "var(--font-display)" }}>
                  {initialRule ? "编辑规则条目" : "添加规则条目"}
                </h3>
                <p className="text-xs text-gray-500">配置角色特定的世界观与反应逻辑</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full transition-colors text-gray-400"
            >
              <X size={20} />
            </button>
          </div>

          <div className="p-6 space-y-5 max-h-[70vh] overflow-y-auto">
            {/* Entry Name */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1">
                条目名称
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：地理环境、性格补完..."
                className="w-full px-4 py-3 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all outline-none"
              />
            </div>

            {/* Trigger Type */}
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
                  <input
                    type="text"
                    value={keywords}
                    onChange={(e) => setKeywords(e.target.value)}
                    placeholder="输入触发关键字..."
                    className="w-full px-4 py-3 bg-gray-50 dark:bg-white/[0.03] border border-gray-200 dark:border-white/10 rounded-2xl text-sm focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-1.5 px-1 italic">
                    用英文逗号分割关键字，如：猫娘, catgirl, 猫猫......
                  </p>
                </motion.div>
              )}
            </div>

            {/* Position */}
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

            {/* Content */}
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1 flex justify-between">
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
          </div>

          {/* Footer */}
          <div className="p-6 bg-gray-50/50 dark:bg-white/[0.02] border-t border-gray-100 dark:border-white/5 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-3 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 text-gray-700 dark:text-white rounded-2xl text-sm font-medium hover:bg-gray-50 dark:hover:bg-white/10 transition-all"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || !content.trim()}
              className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl text-sm font-medium transition-all shadow-lg shadow-blue-500/20"
            >
              确认保存
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
