import React, { useState, useEffect } from "react";
import { Globe, Key, Clock, Shield, User, Repeat } from "lucide-react";
import { WorldInfoRule } from "../types";
import { motion } from "motion/react";
import { BaseModal } from "./BaseModal";

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
  const [hard, setHard] = useState(false);
  const [allowRecursion, setAllowRecursion] = useState(false);
  const [content, setContent] = useState("");

  useEffect(() => {
    if (initialRule) {
      setName(initialRule.name);
      setTriggerType(initialRule.triggerType);
      setKeywords(initialRule.keywords || "");
      setPosition(initialRule.position);
      setHard(initialRule.hard === true);
      setAllowRecursion(initialRule.allowRecursion === true);
      setContent(initialRule.content);
    } else {
      setName("");
      setTriggerType("permanent");
      setKeywords("");
      setPosition("system");
      setHard(false);
      setAllowRecursion(false);
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
      hard,
      // Recursion is meaningful only for keyword entries; permanent entries are
      // always active and never participate in the chain.
      allowRecursion: triggerType === "keywords" ? allowRecursion : undefined,
      content: content.trim(),
      enabled: initialRule ? initialRule.enabled : true,
    });
    onClose();
  };

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={initialRule ? "编辑规则条目" : "添加规则条目"}
      titleIcon={<Globe size={16} className="text-blue-600 dark:text-blue-400" />}
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
            onClick={handleSave}
            disabled={!name.trim() || !content.trim()}
            className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-blue-500/20"
          >
            确认保存
          </button>
        </div>
      }
    >
      <div className="p-6 space-y-5">
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
              <button
                type="button"
                onClick={() => setAllowRecursion((v) => !v)}
                className={`mt-3 w-full flex items-center justify-between gap-3 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                  allowRecursion
                    ? "border-green-500 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 ring-1 ring-green-500"
                    : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
                }`}
              >
                <span className="flex items-center gap-2">
                  <Repeat size={16} /> 允许其他条目激活
                </span>
                <span
                  className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                    allowRecursion ? "bg-green-500" : "bg-gray-300 dark:bg-white/20"
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      allowRecursion ? "translate-x-4" : "translate-x-0.5"
                    }`}
                  />
                </span>
              </button>
              <p className="text-[10px] text-gray-500 mt-1.5 px-1 italic">
                开启后，本条目可被其他已激活条目的内容触发，其内容也会参与触发下游条目（递归激活）。默认关闭，仅响应用户输入。
              </p>
            </motion.div>
          )}
        </div>

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

        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1">
            约束强度
          </label>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setHard(false)}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                !hard
                  ? "border-blue-500 bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500"
                  : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
              }`}
            >
              🌿 软设定
            </button>
            <button
              type="button"
              onClick={() => setHard(true)}
              className={`flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border text-sm font-medium transition-all ${
                hard
                  ? "border-red-500 bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 ring-1 ring-red-500"
                  : "border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 text-gray-600 dark:text-gray-400 hover:border-gray-300"
              }`}
            >
              🛡️ 硬约束
            </button>
          </div>
          <p className="text-[10px] text-gray-500 mt-1.5 px-1 italic">
            软设定：与用户最新发言冲突时让位（外貌 / 背景 / 口癖等）。硬约束：冲突时优先（世界观铁律 / 安全边界）。
          </p>
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2 px-1 flex justify-between">
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
    </BaseModal>
  );
}
