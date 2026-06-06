import React, { useRef, useState } from 'react';
import { Flame, X, Edit2, Download, Upload, RotateCcw } from 'lucide-react';
import { AppState } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { bypassTemplates } from '../lib/bypassTemplates';
import { opusCheckTemplates, OpusCheckKey } from '../lib/OpusCheckTemplates';
import { BaseModal } from './BaseModal';
import { ConfirmDialog } from './ConfirmDialog';

interface BypassModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
  /** Send a message as the user in the active chat. Used by the RuleBreaker
   *  OpusCheck buttons, which close the modal and inject their text. */
  onSendMessage?: (text: string) => void;
}

export function BypassModal({ isOpen, onClose, settings, onSave, onSendMessage }: BypassModalProps) {
  const [localSettings, setLocalSettings] = React.useState<AppState>(settings);
  const [editingTemplate, setEditingTemplate] = React.useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [pendingReset, setPendingReset] = useState(false);
  // RuleBreaker (OpusCheck) — the editable texts live in
  // localSettings.bypass.opusChecks so they persist on 保存配置. Only the
  // mutually-exclusive "which editor is open" flag is transient local UI
  // state (null = none open).
  const [editingOpus, setEditingOpus] = useState<OpusCheckKey | null>(null);
  const [pendingOpusReset, setPendingOpusReset] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const opusTexts = localSettings.bypass.opusChecks;

  React.useEffect(() => {
    setLocalSettings(settings);
    setEditingTemplate(null);
    setImportMessage(null);
    setEditingOpus(null);
  }, [settings, isOpen]);

  const handleBypassChange = (field: keyof AppState['bypass'], value: string | boolean) => {
    setLocalSettings(prev => ({
      ...prev,
      bypass: { ...prev.bypass, [field]: value }
    }));
  };

  const handleTemplateChange = (templateId: string, value: string) => {
    setLocalSettings(prev => ({
      ...prev,
      bypass: {
        ...prev.bypass,
        customTemplates: {
          ...prev.bypass.customTemplates,
          [templateId]: value
        }
      }
    }));
  };

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const handleExport = () => {
    const dataToExport = {
      templateName: localSettings.bypass.templateName || '默认模板',
      customTemplates: localSettings.bypass.customTemplates
    };
    const jsonString = JSON.stringify(dataToExport, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const a = document.createElement('a');
    a.href = url;
    a.download = `NyaaChatBypassTemplates-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);

        if (typeof parsed !== 'object' || !parsed.customTemplates) {
          throw new Error('Invalid format');
        }

        const requiredKeys = ['identityReset', 'scenarioFramework', 'aiSelfPersuasion', 'roleplayInduction', 'safetyStatement', 'creativeGuidance', 'disclaimer', 'wordCountControl'];
        for (const key of requiredKeys) {
          if (typeof parsed.customTemplates[key] !== 'string') {
            throw new Error(`Missing or invalid key: ${key}`);
          }
        }

        setLocalSettings(prev => ({
          ...prev,
          bypass: {
            ...prev.bypass,
            templateName: parsed.templateName || '导入模板',
            customTemplates: parsed.customTemplates
          }
        }));
        setImportMessage({ kind: 'success', text: '已导入模板' });
      } catch (error: any) {
        setImportMessage({ kind: 'error', text: '导入内容格式错误：' + (error?.message || '未知错误') });
        console.error('Import error:', error);
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };
    reader.readAsText(file);
  };

  const handleResetConfirm = () => {
    setLocalSettings(prev => ({
      ...prev,
      bypass: {
        ...prev.bypass,
        templateName: '默认模板',
        customTemplates: {
          identityReset: bypassTemplates.identityReset.content,
          scenarioFramework: bypassTemplates.scenarioFramework.content,
          aiSelfPersuasion: bypassTemplates.aiSelfPersuasion.content,
          roleplayInduction: bypassTemplates.roleplayInduction.content,
          safetyStatement: bypassTemplates.safetyStatement.content,
          creativeGuidance: bypassTemplates.creativeGuidance.content,
          disclaimer: bypassTemplates.disclaimer.content,
          wordCountControl: bypassTemplates.wordCountControl.content,
        }
      }
    }));
    setPendingReset(false);
  };

  const handleOpusTextChange = (key: OpusCheckKey, value: string) => {
    setLocalSettings(prev => ({
      ...prev,
      bypass: {
        ...prev.bypass,
        opusChecks: { ...prev.bypass.opusChecks, [key]: value },
      },
    }));
  };

  const handleOpusResetConfirm = () => {
    setLocalSettings(prev => ({
      ...prev,
      bypass: {
        ...prev.bypass,
        opusChecks: {
          opusCheck1: opusCheckTemplates.opusCheck1.content,
          opusCheck2: opusCheckTemplates.opusCheck2.content,
        },
      },
    }));
    setPendingOpusReset(false);
  };

  // Clicking an OpusCheck button (not its edit icon) closes the modal and
  // sends the corresponding text as the user in the active chat. No-op when
  // the text is empty or no send handler is wired.
  const handleOpusSend = (key: OpusCheckKey) => {
    const text = opusTexts[key];
    if (!text.trim() || !onSendMessage) return;
    onClose();
    onSendMessage(text);
  };

  return (
    <>
      <BaseModal
        isOpen={isOpen}
        onClose={onClose}
        title="绕过机制 (Bypass)"
        titleIcon={<Flame size={16} className="text-red-500" />}
        maxWidth="max-w-2xl"
        bodyClassName="bypass-scrollbar"
        footer={
          <div className="flex flex-col-reverse sm:flex-row justify-end sm:space-x-4">
            <button
              onClick={onClose}
              className="mt-3 sm:mt-0 px-6 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-xl transition-colors focus:ring-2 focus:ring-gray-300"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2.5 text-sm font-semibold text-white bg-red-600 rounded-xl hover:bg-red-700 hover:shadow-glow transition-all focus:ring-2 focus:ring-red-500 focus:ring-offset-2 dark:focus:ring-offset-[#111] active:translate-y-[1px]"
            >
              保存配置
            </button>
          </div>
        }
      >
        <div className="p-6 sm:p-8 space-y-6">
          <section className="space-y-4">
            {/* RuleBreaker — OpusCheck1 / OpusCheck2 文本编辑，无开关。 */}
            <div className="space-y-6 p-5 sm:p-6 bg-red-50/50 dark:bg-red-500/5 rounded-2xl border border-red-100 dark:border-red-500/10">
              <h4 className="text-base font-semibold tracking-tight text-red-700 dark:text-red-400" style={{ fontFamily: 'var(--font-display)' }}>
                RuleBreaker
              </h4>
              <div className="space-y-3">
                {([
                  { key: 'opusCheck1' as OpusCheckKey, label: opusCheckTemplates.opusCheck1.label },
                  { key: 'opusCheck2' as OpusCheckKey, label: opusCheckTemplates.opusCheck2.label },
                ]).map((item) => (
                  <div key={item.key} className="flex items-center justify-between p-2.5 bg-white/50 dark:bg-white/5 rounded-xl">
                    <button
                      onClick={() => handleOpusSend(item.key)}
                      disabled={!opusTexts[item.key].trim()}
                      className="flex-1 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:text-gray-700 dark:disabled:hover:text-gray-300"
                      title="发送此文本到当前对话"
                    >
                      {item.label}
                    </button>
                    <button
                      onClick={() => setEditingOpus(prev => (prev === item.key ? null : item.key))}
                      className={`p-1.5 rounded-lg transition-colors ${editingOpus === item.key ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10'}`}
                      title="编辑文本"
                    >
                      {editingOpus === item.key ? <X size={16} /> : <Edit2 size={16} />}
                    </button>
                  </div>
                ))}
                <p className="text-xs text-gray-500 dark:text-gray-400 px-1 leading-relaxed">
                  opusCheck1 用于 o4.8，如果无效，切换到 o4.7 使用 opusCheck2
                </p>
                {/* 互斥编辑框：两个按钮共用此位置，editingOpus 决定显示哪一段。 */}
                <AnimatePresence mode="wait">
                  {editingOpus && (
                    <motion.div
                      key={editingOpus}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <textarea
                        value={opusTexts[editingOpus]}
                        onChange={(e) => handleOpusTextChange(editingOpus, e.target.value)}
                        className="w-full h-48 px-3 py-2 text-xs font-mono bg-white dark:bg-[#111111] border border-gray-200 dark:border-white/10 rounded-lg text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-red-500 resize-none transition-colors"
                        placeholder="请输入文本..."
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <div className="flex justify-end">
                <button
                  onClick={() => setPendingOpusReset(true)}
                  className="px-3 py-2.5 text-gray-500 bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium"
                  title="恢复默认"
                >
                  <RotateCcw size={16} />
                  <span>重置</span>
                </button>
              </div>
            </div>
            <div className="space-y-6 p-5 sm:p-6 bg-red-50/50 dark:bg-red-500/5 rounded-2xl border border-red-100 dark:border-red-500/10">
              <div className="flex items-center justify-between gap-4">
                <h4 className="text-base font-semibold tracking-tight text-red-700 dark:text-red-400" style={{ fontFamily: 'var(--font-display)' }}>
                  ClavisSalomonis
                </h4>
                <label className="relative inline-flex items-center cursor-pointer shrink-0" aria-label="启用绕过机制">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={localSettings.bypass.enabled}
                    onChange={(e) => handleBypassChange('enabled', e.target.checked)}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-red-500/50 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-red-500"></div>
                </label>
              </div>
              <AnimatePresence>
                {localSettings.bypass.enabled && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-6">
                    <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-4">
                      <div className="w-full sm:flex-1">
                        <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">模板名称 (Template Name)</label>
                        <input
                          type="text"
                          value={localSettings.bypass.templateName || '默认模板'}
                          onChange={(e) => handleBypassChange('templateName', e.target.value)}
                          className="w-full px-3 py-2.5 border border-red-200 dark:border-red-500/20 rounded-xl text-sm focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all"
                        />
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={handleExport}
                          className="px-3 py-2.5 text-red-600 bg-red-100 dark:bg-red-500/20 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-500/30 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium"
                          title="导出配置"
                        >
                          <Download size={16} />
                          <span className="hidden sm:inline">导出</span>
                        </button>
                        <button
                          onClick={handleImportClick}
                          className="px-3 py-2.5 text-gray-700 bg-gray-200 dark:bg-white/10 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-white/20 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium"
                          title="导入配置"
                        >
                          <Upload size={16} />
                          <span className="hidden sm:inline">导入</span>
                        </button>
                        <input type="file" ref={fileInputRef} className="hidden" accept=".json" onChange={handleFileChange} />
                        <button
                          onClick={() => setPendingReset(true)}
                          className="px-3 py-2.5 text-gray-500 bg-white dark:bg-[#1A1A1A] border border-gray-200 dark:border-white/10 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl transition-colors flex items-center gap-2 text-sm font-medium"
                          title="恢复默认"
                        >
                          <RotateCcw size={16} />
                          <span className="hidden sm:inline">重置</span>
                        </button>
                      </div>
                    </div>

                    {importMessage && (
                      <p
                        className={`text-xs px-1 break-all ${
                          importMessage.kind === 'success'
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                        }`}
                      >
                        {importMessage.text}
                      </p>
                    )}

                    <div className="grid grid-cols-1 gap-x-4 gap-y-3 pt-2">
                      {[
                        { id: 'identityReset', label: 'Identity Reset (身份重置)' },
                        { id: 'scenarioFramework', label: 'Scenario Framework (情景框架)' },
                        { id: 'aiSelfPersuasion', label: 'AI Self-Persuasion (自我说服)' },
                        { id: 'roleplayInduction', label: 'Roleplay Induction (语境引导)' },
                        { id: 'safetyStatement', label: 'Safety Statement (安全伪装)' },
                        { id: 'creativeGuidance', label: 'Creative Guidance (创作引导)' },
                        { id: 'disclaimer', label: 'Disclaimer (免责声明)' },
                        { id: 'wordCountControl', label: 'Word Count (字数控制)' },
                      ].map((item) => (
                        <div key={item.id} className="flex flex-col bg-white/50 dark:bg-white/5 rounded-xl transition-colors">
                          <div className="flex items-center justify-between p-2.5">
                            <label className="flex items-center space-x-3 cursor-pointer group flex-1">
                              <div className="relative flex items-center justify-center w-5 h-5">
                                <input
                                  type="checkbox"
                                  checked={localSettings.bypass[item.id as keyof Omit<AppState['bypass'], 'enabled' | 'templateName' | 'customTemplates'>] as boolean}
                                  onChange={(e) => handleBypassChange(item.id as keyof AppState['bypass'], e.target.checked)}
                                  className="peer sr-only"
                                />
                                <div className="w-5 h-5 rounded-[6px] border-2 border-red-300 dark:border-red-500/50 peer-checked:bg-red-500 peer-checked:border-red-500 group-hover:border-red-400 transition-colors"></div>
                                <svg className="absolute w-3.5 h-3.5 text-white scale-0 peer-checked:scale-100 transition-transform pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{item.label}</span>
                            </label>
                            <button
                              onClick={() => setEditingTemplate(editingTemplate === item.id ? null : item.id)}
                              className={`p-1.5 rounded-lg transition-colors ${editingTemplate === item.id ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10'}`}
                              title="编辑提示词模板"
                            >
                              {editingTemplate === item.id ? <X size={16} /> : <Edit2 size={16} />}
                            </button>
                          </div>
                          <AnimatePresence>
                            {editingTemplate === item.id && (
                              <motion.div
                                initial={{ height: 0, opacity: 0 }}
                                animate={{ height: 'auto', opacity: 1 }}
                                exit={{ height: 0, opacity: 0 }}
                                className="overflow-hidden"
                              >
                                <div className="px-3 pb-3 border-t border-gray-100 dark:border-white/5 pt-2">
                                  <textarea
                                    value={localSettings.bypass.customTemplates?.[item.id as keyof typeof localSettings.bypass.customTemplates] || ''}
                                    onChange={(e) => handleTemplateChange(item.id, e.target.value)}
                                    className="w-full h-32 px-3 py-2 text-xs font-mono bg-white dark:bg-[#111111] border border-gray-200 dark:border-white/10 rounded-lg text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-red-500 resize-none transition-colors"
                                    placeholder="请输入提示词模板..."
                                  />
                                  <p className="text-[10px] text-gray-500 mt-1.5 flex justify-between">
                                    <span>支持变量: <code className="bg-gray-100 dark:bg-white/10 px-1 py-0.5 rounded text-red-600 dark:text-red-400">{`{{char}}`}</code>, <code className="bg-gray-100 dark:bg-white/10 px-1 py-0.5 rounded text-red-600 dark:text-red-400">{`{{user}}`}</code></span>
                                  </p>
                                </div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </section>
        </div>
      </BaseModal>

      <ConfirmDialog
        isOpen={pendingReset}
        title="恢复默认模板"
        message="确定要恢复默认的提示词模板吗？当前自定义的模板内容将被覆盖。"
        destructive
        confirmText="恢复"
        onConfirm={handleResetConfirm}
        onCancel={() => setPendingReset(false)}
      />

      <ConfirmDialog
        isOpen={pendingOpusReset}
        title="恢复默认文本"
        message="确定要将 OpusCheck1 / OpusCheck2 恢复为默认文本吗？当前修改过的内容将被覆盖。"
        destructive
        confirmText="恢复"
        onConfirm={handleOpusResetConfirm}
        onCancel={() => setPendingOpusReset(false)}
      />
    </>
  );
}
