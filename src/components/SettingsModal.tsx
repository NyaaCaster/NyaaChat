import React from 'react';
import { X, Plug, List, Loader2, ChevronDown, Check, Wrench } from 'lucide-react';
import { AppState, ApiProvider } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ConnectionStatus } from '../App';
import { PROVIDER_ORDER, PROVIDER_LABELS, PROVIDER_PRESETS } from '../lib/providers';
import OpenAI from '@lobehub/icons/es/OpenAI';
import Anthropic from '@lobehub/icons/es/Anthropic';
import Gemini from '@lobehub/icons/es/Gemini';
import DeepSeek from '@lobehub/icons/es/DeepSeek';

const PROVIDER_ICONS: Record<ApiProvider, React.ReactNode> = {
  custom: <Wrench size={18} className="text-gray-500 dark:text-gray-400" />,
  openai: <OpenAI size={18} />,
  anthropic: <Anthropic size={18} color="#D97757" />,
  gemini: <Gemini.Color size={18} />,
  deepseek: <DeepSeek.Color size={18} />,
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
  connectionStatus: ConnectionStatus;
  connectionError: string | null;
  availableModels: string[];
  onConnect: (overrideApi?: AppState['api']) => Promise<boolean>;
}

const STATUS_META: Record<ConnectionStatus, { label: string; dot: string; text: string; bg: string }> = {
  disconnected: {
    label: '未连接',
    dot: 'bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/10 border-red-500/20',
  },
  connecting: {
    label: '连接中…',
    dot: 'bg-yellow-400',
    text: 'text-yellow-700 dark:text-yellow-400',
    bg: 'bg-yellow-500/10 border-yellow-500/20',
  },
  connected: {
    label: '已连接',
    dot: 'bg-green-500',
    text: 'text-green-700 dark:text-green-400',
    bg: 'bg-green-500/10 border-green-500/20',
  },
};

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
  connectionStatus,
  connectionError,
  availableModels,
  onConnect,
}: SettingsModalProps) {
  const [localSettings, setLocalSettings] = React.useState<AppState>(settings);
  const [isModelListOpen, setIsModelListOpen] = React.useState(false);
  const [isProviderListOpen, setIsProviderListOpen] = React.useState(false);
  const modelListRef = React.useRef<HTMLDivElement>(null);
  const providerListRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings, isOpen]);

  // Close the model list popover on outside click
  React.useEffect(() => {
    if (!isModelListOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modelListRef.current && !modelListRef.current.contains(e.target as Node)) {
        setIsModelListOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isModelListOpen]);

  // Close the provider list popover on outside click
  React.useEffect(() => {
    if (!isProviderListOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (providerListRef.current && !providerListRef.current.contains(e.target as Node)) {
        setIsProviderListOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isProviderListOpen]);

  const handleApiChange = (field: keyof AppState['api'], value: string | boolean) => {
    setLocalSettings(prev => ({
      ...prev,
      api: { ...prev.api, [field]: value }
    }));
  };

  const handleProviderChange = (provider: ApiProvider) => {
    setLocalSettings(prev => {
      if (provider === 'custom') {
        return { ...prev, api: { ...prev.api, apiProvider: 'custom' } };
      }
      const preset = PROVIDER_PRESETS[provider];
      return {
        ...prev,
        api: {
          ...prev.api,
          apiProvider: provider,
          baseUrl: preset.baseUrl,
          apiFormat: preset.apiFormat,
          // Replace the model if the previous value isn't useful for the new provider
          model: prev.api.model && prev.api.apiProvider === provider ? prev.api.model : preset.defaultModel,
        },
      };
    });
  };

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

  const handleConnectClick = async () => {
    // Persist current local edits so a future auto-connect uses what the user just typed
    onSave(localSettings);
    await onConnect(localSettings.api);
  };

  const handleSelectModel = (modelId: string) => {
    handleApiChange('model', modelId);
    setIsModelListOpen(false);
  };

  const statusMeta = STATUS_META[connectionStatus];
  const isConnecting = connectionStatus === 'connecting';
  const provider: ApiProvider = localSettings.api.apiProvider || 'custom';
  const isCustom = provider === 'custom';

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-2xl bg-white dark:bg-[#111111] dark:border dark:border-white/10 rounded-2xl shadow-elevation-3 p-6 sm:p-8 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between mb-8 pb-4 border-b border-gray-100 dark:border-white/10">
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100" style={{ fontFamily: 'var(--font-display)' }}>
                设置
              </h2>
              <button
                onClick={onClose}
                className="p-2 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors rounded-full hover:bg-gray-100 dark:hover:bg-white/5"
              >
                <X size={20} />
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">API 供应商</label>
                  <label
                    className="inline-flex items-center gap-2 cursor-pointer select-none"
                    title="以 stream:true 模式进行 API 请求，实时接收片段"
                  >
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">流式输出</span>
                    <div className="relative inline-flex items-center">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={localSettings.api.isStreaming || false}
                        onChange={(e) => handleApiChange('isStreaming', e.target.checked)}
                      />
                      <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"></div>
                    </div>
                  </label>
                </div>
                <div className="relative" ref={providerListRef}>
                  <button
                    type="button"
                    onClick={() => setIsProviderListOpen((v) => !v)}
                    className="w-full flex items-center gap-3 px-4 py-3 pr-10 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all text-left"
                  >
                    <span className="inline-flex w-5 h-5 items-center justify-center shrink-0">
                      {PROVIDER_ICONS[provider]}
                    </span>
                    <span className="flex-1 truncate">{PROVIDER_LABELS[provider]}</span>
                  </button>
                  <ChevronDown size={16} className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 transition-transform ${isProviderListOpen ? 'rotate-180' : ''}`} />

                  <AnimatePresence>
                    {isProviderListOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-10 top-full left-0 right-0 mt-2 overflow-hidden rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1A1A1A] shadow-elevation-3"
                      >
                        <ul className="py-1">
                          {PROVIDER_ORDER.map((p) => {
                            const active = p === provider;
                            return (
                              <li key={p}>
                                <button
                                  type="button"
                                  onClick={() => {
                                    handleProviderChange(p);
                                    setIsProviderListOpen(false);
                                  }}
                                  className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors ${
                                    active
                                      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                      : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5'
                                  }`}
                                >
                                  <span className="inline-flex w-5 h-5 items-center justify-center shrink-0">
                                    {PROVIDER_ICONS[p]}
                                  </span>
                                  <span className="flex-1 truncate">{PROVIDER_LABELS[p]}</span>
                                  {active && <Check size={14} strokeWidth={3} />}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
                {!isCustom && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                    使用 {PROVIDER_LABELS[provider]} 官方接入；只需要填写 API Key。
                  </p>
                )}
              </div>

              {isCustom && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">API 兼容模式</label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: 'openai', label: 'OpenAI' },
                      { value: 'anthropic', label: 'Anthropic' },
                    ] as const).map((opt) => {
                      const active = (localSettings.api.apiFormat || 'openai') === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleApiChange('apiFormat', opt.value)}
                          className={`px-4 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                            active
                              ? 'border-blue-500 bg-blue-500/10 dark:bg-blue-500/15 ring-1 ring-blue-500 text-blue-600 dark:text-blue-400'
                              : 'border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 hover:border-gray-300 dark:hover:border-white/20'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-2">
                    OpenAI 模式适用于 OpenAI 及大多数兼容代理；Anthropic 模式直连 Claude 官方 API。
                  </p>
                </div>
              )}

              {isCustom && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">API Base URL</label>
                  <input
                    type="text"
                    value={localSettings.api.baseUrl}
                    onChange={(e) => handleApiChange('baseUrl', e.target.value)}
                    placeholder={(localSettings.api.apiFormat || 'openai') === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'}
                    className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600"
                  />
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">API Key</label>
                <input
                  type="password"
                  value={localSettings.api.apiKey}
                  onChange={(e) => handleApiChange('apiKey', e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 font-mono"
                />
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={handleConnectClick}
                  disabled={isConnecting || !localSettings.api.baseUrl || !localSettings.api.apiKey}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-all"
                >
                  {isConnecting ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
                  连接
                </button>
                <div
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${statusMeta.bg} ${statusMeta.text}`}
                  title={connectionError || statusMeta.label}
                >
                  <span className={`w-2 h-2 rounded-full ${statusMeta.dot} ${isConnecting ? 'animate-pulse' : ''}`}></span>
                  {statusMeta.label}
                </div>
                <label
                  className="inline-flex items-center gap-2 cursor-pointer select-none ml-auto"
                  title="访问页面时自动连接上一次成功配置的 LLM 端点"
                >
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">自动连接</span>
                  <div className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={localSettings.api.autoConnect || false}
                      onChange={(e) => handleApiChange('autoConnect', e.target.checked)}
                    />
                    <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"></div>
                  </div>
                </label>
              </div>
              {connectionError && connectionStatus === 'disconnected' && (
                <p className="text-[11px] text-red-500 dark:text-red-400 -mt-3 break-all">
                  {connectionError}
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">模型名称 (Model)</label>
                <div className="relative flex items-stretch gap-2" ref={modelListRef}>
                  <input
                    type="text"
                    value={localSettings.api.model}
                    onChange={(e) => handleApiChange('model', e.target.value)}
                    placeholder={(localSettings.api.apiFormat || 'openai') === 'anthropic' ? 'claude-3-5-sonnet-latest' : 'gpt-3.5-turbo'}
                    className="flex-1 min-w-0 px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setIsModelListOpen((v) => !v)}
                    disabled={availableModels.length === 0}
                    className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-white/20 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    title={availableModels.length === 0 ? '请先点击「连接」获取模型列表' : '从模型列表中选择'}
                  >
                    <List size={16} />
                    <ChevronDown size={14} className={`transition-transform ${isModelListOpen ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {isModelListOpen && availableModels.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-10 bottom-full right-0 mb-2 w-full sm:w-80 max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1A1A1A] shadow-elevation-3"
                      >
                        <div className="px-3 py-2 border-b border-gray-100 dark:border-white/5 text-[11px] text-gray-500 dark:text-gray-400">
                          共 {availableModels.length} 个模型
                        </div>
                        <ul className="py-1">
                          {availableModels.map((m) => {
                            const active = m === localSettings.api.model;
                            return (
                              <li key={m}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectModel(m)}
                                  className={`w-full text-left px-3 py-2 text-sm font-mono flex items-center justify-between gap-2 transition-colors ${
                                    active
                                      ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                      : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5'
                                  }`}
                                >
                                  <span className="truncate">{m}</span>
                                  {active && <Check size={14} strokeWidth={3} />}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            <div className="mt-10 flex flex-col-reverse sm:flex-row justify-end sm:space-x-4">
              <button
                onClick={onClose}
                className="mt-3 sm:mt-0 px-6 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-xl transition-colors focus:ring-2 focus:ring-gray-300"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 hover:shadow-glow transition-all focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-[#111] active:translate-y-[1px]"
              >
                保存配置
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
