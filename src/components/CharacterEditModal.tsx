import React, { useState } from "react";
import { X, Save, Plus, Download, Edit2, Trash2 } from "lucide-react";
import { CharacterSettings, WorldInfoRule } from "../types";
import { motion, AnimatePresence } from "motion/react";
import { WorldInfoRuleModal } from "./WorldInfoRuleModal";

interface CharacterEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (character: CharacterSettings) => void;
  initialCharacter?: CharacterSettings | null;
}

export function CharacterEditModal({
  isOpen,
  onClose,
  onSave,
  initialCharacter,
}: CharacterEditModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [worldInfo, setWorldInfo] = useState<WorldInfoRule[]>([]);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<WorldInfoRule | null>(null);

  React.useEffect(() => {
    if (initialCharacter) {
      setName(initialCharacter.name);
      setDescription(initialCharacter.description);
      setWorldInfo(initialCharacter.worldInfo || []);
    } else {
      setName("");
      setDescription("");
      setWorldInfo([]);
    }
  }, [initialCharacter, isOpen]);

  const handleSave = () => {
    if (!name.trim()) return;

    onSave({
      id: initialCharacter?.id || Date.now().toString(),
      name: name.trim(),
      description: description.trim(),
      worldInfo: worldInfo,
    });

    onClose();
  };

  const handleExport = () => {
    const data = {
      name: name.trim(),
      description: description.trim(),
      worldInfo: worldInfo,
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    
    // Generate filename: NyaaChatChar-YYMMDDhhmmss.json
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear().toString().slice(-2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const filename = `NyaaChatChar-${timestamp}.json`;

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
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
    setWorldInfo(prev => prev.filter(r => r.id !== id));
  };

  const handleToggleRule = (id: string) => {
    setWorldInfo(prev => prev.map(r => r.id === id ? { ...r, enabled: !r.enabled } : r));
  };

  const handleSaveRule = (rule: WorldInfoRule) => {
    if (editingRule) {
      setWorldInfo(prev => prev.map(r => r.id === rule.id ? rule : r));
    } else {
      setWorldInfo(prev => [...prev, rule]);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 bg-black/50 backdrop-blur-md z-[60] transition-opacity"
          />
          <div className="fixed inset-0 flex items-center justify-center p-4 z-[60] pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-white/90 dark:bg-[#151515]/90 backdrop-blur-xl w-full max-w-lg rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.2)] border border-gray-200/50 dark:border-white/10 pointer-events-auto overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="flex items-center justify-between p-4 sm:p-5 border-b border-gray-100 dark:border-white/5">
                <h3
                  className="text-lg font-semibold tracking-tight"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {initialCharacter ? "编辑角色" : "创建角色"}
                </h3>
                <button
                  onClick={onClose}
                  className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-xl transition-all"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-4 sm:p-5 overflow-y-auto w-full flex-1">
                <div className="space-y-4">
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

                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-2 px-1">
                      <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                        规则条目 (World Info)
                      </label>
                    </div>
                    
                    <div className="space-y-2 mb-4">
                      {worldInfo.map((rule) => (
                        <div 
                          key={rule.id}
                          className="flex items-center justify-between p-3 bg-gray-50 dark:bg-white/[0.03] border border-gray-100 dark:border-white/5 rounded-xl group transition-all"
                        >
                          <div className="flex items-center gap-3 overflow-hidden">
                            <button
                              onClick={() => handleToggleRule(rule.id)}
                              className={`flex-shrink-0 w-8 h-4 rounded-full relative transition-colors ${
                                rule.enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'
                              }`}
                            >
                              <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${
                                rule.enabled ? 'translate-x-4.5' : 'translate-x-0.5'
                              }`} />
                            </button>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                                {rule.name}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className={`text-[10px] px-1 rounded ${
                                  rule.triggerType === 'permanent' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' : 'bg-green-100 dark:bg-green-900/30 text-green-600'
                                }`}>
                                  {rule.triggerType === 'permanent' ? '永久' : '关键字'}
                                </span>
                                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                                  {rule.position === 'system' ? '⚙系统' : '🤖角色'}
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleEditRule(rule)}
                              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-white dark:hover:bg-white/10 rounded-lg transition-all"
                            >
                              <Edit2 size={14} />
                            </button>
                            <button
                              onClick={() => handleDeleteRule(rule.id)}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-white dark:hover:bg-white/10 rounded-lg transition-all"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <button
                      onClick={handleAddRule}
                      className="w-full px-4 py-2 bg-transparent border border-gray-200 border-dashed dark:border-white/20 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
                    >
                      <Plus size={16} /> 添加规则
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-4 sm:p-5 border-t border-gray-100 dark:border-white/5 bg-gray-50/50 dark:bg-black/20 flex gap-3">
                <button
                  onClick={handleExport}
                  className="flex-shrink-0 px-4 py-2 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/10 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2"
                >
                  <Download size={16} /> 角色导出
                </button>
                <button
                  onClick={handleSave}
                  disabled={!name.trim()}
                  className="flex-1 px-4 py-2 bg-blue-600 border border-transparent disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-700 text-white text-sm font-medium rounded-xl transition-all flex items-center justify-center gap-2 hover:shadow-glow"
                >
                  <Save size={16} /> 保存角色
                </button>
              </div>
            </motion.div>
          </div>

          <WorldInfoRuleModal
            isOpen={isRuleModalOpen}
            onClose={() => setIsRuleModalOpen(false)}
            onSave={handleSaveRule}
            initialRule={editingRule}
          />
        </>
      )}
    </AnimatePresence>
  );
}
