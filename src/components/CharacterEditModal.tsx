import React, { useState } from "react";
import { Save, Plus, Download, Edit2, Trash2, FileJson, Cat } from "lucide-react";
import { CharacterSettings, WorldInfoRule } from "../types";
import { newId } from "../lib/id";
import { convertToSillyTavernCharacter } from "../lib/sillyTavernExport";
import { BaseModal } from "./BaseModal";
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
  const [firstMes, setFirstMes] = useState("");
  const [worldInfo, setWorldInfo] = useState<WorldInfoRule[]>([]);
  const [isRuleModalOpen, setIsRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<WorldInfoRule | null>(null);
  const [isExportChooserOpen, setIsExportChooserOpen] = useState(false);

  React.useEffect(() => {
    if (initialCharacter) {
      setName(initialCharacter.name);
      setDescription(initialCharacter.description);
      setFirstMes(initialCharacter.firstMes || "");
      setWorldInfo(initialCharacter.worldInfo || []);
    } else {
      setName("");
      setDescription("");
      setFirstMes("");
      setWorldInfo([]);
    }
  }, [initialCharacter, isOpen]);

  const handleSave = () => {
    if (!name.trim()) return;

    onSave({
      id: initialCharacter?.id || newId(),
      name: name.trim(),
      description: description.trim(),
      firstMes: firstMes.trim() || undefined,
      worldInfo: worldInfo,
      // Preserve card data this modal has no editor for, so editing+saving a
      // character never silently strips its character-scoped regex (managed in
      // the 正则 panel) or its ST extension bindings / character variables.
      ...(initialCharacter?.regexScripts ? { regexScripts: initialCharacter.regexScripts } : {}),
      ...(initialCharacter?.extensions ? { extensions: initialCharacter.extensions } : {}),
    });

    onClose();
  };

  // Assemble the character from the current (possibly edited) modal state, plus
  // the card data this modal has no editor for (regex / extensions) carried from
  // initialCharacter. Shared by both export formats.
  const buildCurrentCharacter = (): CharacterSettings => ({
    id: initialCharacter?.id || newId(),
    name: name.trim(),
    description: description.trim(),
    firstMes: firstMes.trim() || undefined,
    worldInfo: worldInfo,
    ...(initialCharacter?.regexScripts ? { regexScripts: initialCharacter.regexScripts } : {}),
    ...(initialCharacter?.extensions ? { extensions: initialCharacter.extensions } : {}),
  });

  const downloadJson = (obj: unknown, filenamePrefix: string) => {
    const json = JSON.stringify(obj, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    const timestamp = `${now.getFullYear().toString().slice(-2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    const safeName = (name.trim() || "未命名").replace(/[\\/:*?"<>|]/g, "_");

    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenamePrefix}-${safeName}-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportNyaaChat = () => {
    // NyaaChat-native character card — a lossless round-trip of CharacterSettings,
    // deliberately NOT shaped like a SillyTavern card. Regex stays under our own
    // top-level `regexScripts` (not ST's `extensions.regex_scripts`); `extensions`
    // is an opaque passthrough of character-scoped variables / ST extension data
    // so a backup keeps them.
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
    };
    downloadJson(data, "NyaaChatChar");
    setIsExportChooserOpen(false);
  };

  const exportSillyTavern = () => {
    // SillyTavern chara_card_v3 — world info is reverse-migrated to at-depth
    // entries (see sillyTavernExport.ts). Lossy: hard/soft authority is dropped
    // (ST has no such concept), mirroring the importer's soft default.
    const card = convertToSillyTavernCharacter(buildCurrentCharacter());
    downloadJson(card, "SillyTavernChar");
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
    setWorldInfo((prev) => prev.filter((r) => r.id !== id));
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

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title={initialCharacter ? "编辑角色" : "创建角色"}
        maxWidth="max-w-lg"
        footer={
          <div className="flex gap-3">
            <button
              onClick={() => setIsExportChooserOpen(true)}
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
        }
      >
        <div className="p-4 sm:p-5">
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
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleEditRule(rule)}
                        className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-white dark:hover:bg-white/10 rounded-lg transition-all"
                        aria-label="编辑规则"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-white dark:hover:bg-white/10 rounded-lg transition-all"
                        aria-label="删除规则"
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
      </BaseModal>

      <WorldInfoRuleModal
        isOpen={isRuleModalOpen}
        onClose={() => setIsRuleModalOpen(false)}
        onSave={handleSaveRule}
        initialRule={editingRule}
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
                原生格式，完整保留规则约束强度、绑定正则与角色变量，可无损导回 NyaaChat。
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
                兼容 SillyTavern 角色卡（chara_card_v3），世界书按 ST 规则迁移。注意：约束强度（软/硬）无对应概念，导出时会丢弃。
              </p>
            </div>
          </button>
        </div>
      </BaseModal>
    </>
  );
}
