import React, { useState } from 'react';
import { Flame, X, Edit2, RotateCcw } from 'lucide-react';
import { AppState } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { wordCheckTemplates, WordCheckKey } from '../lib/WordCheckTemplates';
import { wordCountTemplates, WordCountKey } from '../lib/WordCountTemplates';
import { flagalacTargets } from '../lib/FlagalacTemplates';
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
  // RuleBreaker (WordCheck) — the editable texts live in
  // localSettings.bypass.opusChecks so they persist on 保存配置. Only the
  // mutually-exclusive "which editor is open" flag is transient local UI
  // state (null = none open).
  const [editingOpus, setEditingOpus] = useState<WordCheckKey | null>(null);
  // Per-entry reset is now independent: this holds WHICH entry has a pending
  // reset confirmation (null = none), replacing the old single shared button.
  const [pendingOpusReset, setPendingOpusReset] = useState<WordCheckKey | null>(null);
  // RosettaStone — each entry's enabled flag + editable text live in
  // localSettings.bypass[key] so they persist on 保存配置; only "which editor
  // is open" and "which entry's reset is pending" are transient UI state
  // (null = none).
  const [editingRosetta, setEditingRosetta] = useState<WordCountKey | null>(null);
  const [pendingRosettaReset, setPendingRosettaReset] = useState<WordCountKey | null>(null);

  const opusTexts = localSettings.bypass.opusChecks;
  // AnswererFlagalac — the selected target id lives in
  // localSettings.bypass.answererFlagalac so it persists on 保存配置. The
  // selectable entries themselves come from lib/FlagalacTemplates.ts (the
  // single source of truth); the read is normalised at every entry point
  // (App.tsx load + settingsBackup import), so an unknown id can't reach here.
  const flagalacTarget = localSettings.bypass.answererFlagalac.target;

  React.useEffect(() => {
    setLocalSettings(settings);
    setEditingOpus(null);
    setEditingRosetta(null);
  }, [settings, isOpen]);

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const handleOpusTextChange = (key: WordCheckKey, value: string) => {
    setLocalSettings(prev => ({
      ...prev,
      bypass: {
        ...prev.bypass,
        opusChecks: { ...prev.bypass.opusChecks, [key]: value },
      },
    }));
  };

  // Reset a SINGLE RuleBreaker entry back to its default text. The entry is
  // identified by `pendingOpusReset`; each row owns its own reset button.
  const handleOpusResetConfirm = () => {
    const key = pendingOpusReset;
    if (!key) return;
    setLocalSettings(prev => ({
      ...prev,
      bypass: {
        ...prev.bypass,
        opusChecks: { ...prev.bypass.opusChecks, [key]: wordCheckTemplates[key].content },
      },
    }));
    setPendingOpusReset(null);
  };

  // RosettaStone handlers — keyed by entry (wordCount / languageConstraint).
  const handleRosettaChange = (
    key: WordCountKey,
    field: 'enabled' | 'template',
    value: boolean | string,
  ) => {
    setLocalSettings(prev => ({
      ...prev,
      bypass: {
        ...prev.bypass,
        [key]: { ...prev.bypass[key], [field]: value },
      },
    }));
  };

  const handleRosettaResetConfirm = () => {
    const key = pendingRosettaReset;
    if (!key) return;
    setLocalSettings(prev => ({
      ...prev,
      bypass: {
        ...prev.bypass,
        [key]: { ...prev.bypass[key], template: wordCountTemplates[key].content },
      },
    }));
    setPendingRosettaReset(null);
  };

  // AnswererFlagalac — single-select. Only the chosen id is written back;
  // the entries (labels, order, future payloads) stay in FlagalacTemplates.ts.
  const handleFlagalacChange = (target: string) => {
    setLocalSettings(prev => ({
      ...prev,
      bypass: {
        ...prev.bypass,
        answererFlagalac: { ...prev.bypass.answererFlagalac, target },
      },
    }));
  };

  // Clicking a WordCheck button (not its edit icon) closes the modal and
  // sends the corresponding text as the user in the active chat. No-op when
  // the text is empty or no send handler is wired.
  const handleOpusSend = (key: WordCheckKey) => {
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
        closeOnBackdrop={false}
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
            {/* RosettaStone — first-party OUTPUT constraints (字数控制 +
                语言约束). Each entry: toggle + edit + 重置 (its own icon
                button, inline). */}
            <div className="space-y-6 p-5 sm:p-6 bg-red-50/50 dark:bg-red-500/5 rounded-2xl border border-red-100 dark:border-red-500/10">
              <h4 className="text-base font-semibold tracking-tight text-red-700 dark:text-red-400" style={{ fontFamily: 'var(--font-display)' }}>
                RosettaStone
              </h4>
              <div className="space-y-3">
                {(['wordCount', 'languageConstraint'] as WordCountKey[]).map((key) => (
                  <div key={key} className="flex flex-col bg-white/50 dark:bg-white/5 rounded-xl transition-colors">
                    <div className="flex items-center justify-between p-2.5">
                      <label className="flex items-center space-x-3 cursor-pointer group flex-1">
                        <div className="relative flex items-center justify-center w-5 h-5">
                          <input
                            type="checkbox"
                            checked={localSettings.bypass[key].enabled}
                            onChange={(e) => handleRosettaChange(key, 'enabled', e.target.checked)}
                            className="peer sr-only"
                          />
                          <div className="w-5 h-5 rounded-[6px] border-2 border-red-300 dark:border-red-500/50 peer-checked:bg-red-500 peer-checked:border-red-500 group-hover:border-red-400 transition-colors"></div>
                          <svg className="absolute w-3.5 h-3.5 text-white scale-0 peer-checked:scale-100 transition-transform pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{wordCountTemplates[key].label}</span>
                      </label>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => setPendingRosettaReset(key)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                          title="恢复默认"
                        >
                          <RotateCcw size={16} />
                        </button>
                        <button
                          onClick={() => setEditingRosetta(prev => (prev === key ? null : key))}
                          className={`p-1.5 rounded-lg transition-colors ${editingRosetta === key ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10'}`}
                          title="编辑提示词模板"
                        >
                          {editingRosetta === key ? <X size={16} /> : <Edit2 size={16} />}
                        </button>
                      </div>
                    </div>
                    <AnimatePresence>
                      {editingRosetta === key && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 border-t border-gray-100 dark:border-white/5 pt-2">
                            <textarea
                              value={localSettings.bypass[key].template}
                              onChange={(e) => handleRosettaChange(key, 'template', e.target.value)}
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
            {/* AnswererFlagalac — 审核绕过目标（单选）。条目清单、顺序与默认值
                全部来自 lib/FlagalacTemplates.ts（唯一事实来源）；本模块独立于
                其他模块，选中「无」即不生效。当前阶段只交付界面：选中项会被
                持久化，但绕过逻辑尚未接入 chatPipeline。 */}
            <div className="space-y-6 p-5 sm:p-6 bg-red-50/50 dark:bg-red-500/5 rounded-2xl border border-red-100 dark:border-red-500/10">
              <h4 className="text-base font-semibold tracking-tight text-red-700 dark:text-red-400" style={{ fontFamily: 'var(--font-display)' }}>
                AnswererFlagalac
              </h4>
              <div className="space-y-3" role="radiogroup" aria-label="AnswererFlagalac 绕过目标">
                {flagalacTargets.map((item) => {
                  const selected = flagalacTarget === item.id;
                  return (
                    <label
                      key={item.id}
                      className={`flex items-start gap-3 p-2.5 rounded-xl cursor-pointer transition-colors ${
                        selected
                          ? 'bg-red-500/10 dark:bg-red-500/15 ring-1 ring-red-300 dark:ring-red-500/40'
                          : 'bg-white/50 dark:bg-white/5 hover:bg-white dark:hover:bg-white/10'
                      }`}
                    >
                      <div className="relative flex items-center justify-center w-5 h-5 mt-0.5 shrink-0">
                        <input
                          type="radio"
                          name="answerer-flagalac"
                          value={item.id}
                          checked={selected}
                          onChange={() => handleFlagalacChange(item.id)}
                          className="peer sr-only"
                        />
                        <div className="w-5 h-5 rounded-full border-2 border-red-300 dark:border-red-500/50 peer-checked:border-red-500 peer-focus-visible:ring-2 peer-focus-visible:ring-red-500/50 transition-colors"></div>
                        <div className="absolute w-2.5 h-2.5 rounded-full bg-red-500 scale-0 peer-checked:scale-100 transition-transform pointer-events-none"></div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm ${selected ? 'font-semibold text-red-700 dark:text-red-300' : 'font-medium text-gray-700 dark:text-gray-300'}`}>
                          {item.label}
                        </div>
                        {item.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{item.description}</p>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 px-1 leading-relaxed">
                单选，同一时间只能启用一个绕过目标；选中「无」时本模块不生效。
                <br />
                当前版本仅提供界面，对应的绕过逻辑尚未接入。
              </p>
            </div>
            {/* RuleBreaker — Gemini31Check / Op1Check / Op2Check 文本编辑，无开关。 */}
            <div className="space-y-6 p-5 sm:p-6 bg-red-50/50 dark:bg-red-500/5 rounded-2xl border border-red-100 dark:border-red-500/10">
              <h4 className="text-base font-semibold tracking-tight text-red-700 dark:text-red-400" style={{ fontFamily: 'var(--font-display)' }}>
                RuleBreaker
              </h4>
              <div className="space-y-3">
                {([
                  { key: 'gemini31Check' as WordCheckKey, label: wordCheckTemplates.gemini31Check.label },
                  { key: 'op1Check' as WordCheckKey, label: wordCheckTemplates.op1Check.label },
                  { key: 'op2Check' as WordCheckKey, label: wordCheckTemplates.op2Check.label },
                ]).map((item) => (
                  <div key={item.key} className="flex items-center justify-between gap-1 p-2.5 bg-white/50 dark:bg-white/5 rounded-xl">
                    <button
                      onClick={() => handleOpusSend(item.key)}
                      className="flex-1 text-left text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                      title="发送此文本到当前对话"
                    >
                      {item.label}
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setPendingOpusReset(item.key)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors"
                        title="恢复默认文本"
                      >
                        <RotateCcw size={16} />
                      </button>
                      <button
                        onClick={() => setEditingOpus(prev => (prev === item.key ? null : item.key))}
                        className={`p-1.5 rounded-lg transition-colors ${editingOpus === item.key ? 'bg-red-100 text-red-600 dark:bg-red-500/20 dark:text-red-400' : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-white/10'}`}
                        title="编辑文本"
                      >
                        {editingOpus === item.key ? <X size={16} /> : <Edit2 size={16} />}
                      </button>
                    </div>
                  </div>
                ))}
                <p className="text-xs text-gray-500 dark:text-gray-400 px-1 leading-relaxed">
                  直接点击破甲词名称即可发送破甲词到当前对话，注意对应模型。
                  <br />
                  请到{' '}
                  <a
                    href="https://qm.qq.com/q/NRwmBbH322"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
                  >
                    QinyAPI交流③群
                  </a>{' '}
                  群文件获取破甲词，并严格依据破甲词压缩包内使用说明进行使用。
                </p>
                {/* 互斥编辑框：所有按钮共用此位置，editingOpus 决定显示哪一段。 */}
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
            </div>
          </section>
        </div>
      </BaseModal>

      <ConfirmDialog
        isOpen={!!pendingOpusReset}
        title="恢复默认文本"
        message={`确定要将 ${pendingOpusReset ? wordCheckTemplates[pendingOpusReset].label : ''} 恢复为默认文本吗？当前修改过的内容将被覆盖。`}
        destructive
        confirmText="恢复"
        onConfirm={handleOpusResetConfirm}
        onCancel={() => setPendingOpusReset(null)}
      />

      <ConfirmDialog
        isOpen={!!pendingRosettaReset}
        title="恢复默认模板"
        message={`确定要将 ${pendingRosettaReset ? wordCountTemplates[pendingRosettaReset].label : ''} 恢复为默认模板吗？当前自定义的内容将被覆盖。`}
        destructive
        confirmText="恢复"
        onConfirm={handleRosettaResetConfirm}
        onCancel={() => setPendingRosettaReset(null)}
      />
    </>
  );
}
