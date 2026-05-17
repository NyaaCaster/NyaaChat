import React from 'react';
import { Plug, List, Loader2, ChevronDown, Check, Wrench, Eye, Image as ImageIcon } from 'lucide-react';
import { AppState, ApiProvider, ImageApiProvider, ImageSize } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { ConnectionStatus } from '../App';
import { PROVIDER_ORDER, PROVIDER_LABELS, PROVIDER_PRESETS } from '../lib/providers';
import { BaseModal } from './BaseModal';
import OpenAI from '@lobehub/icons/es/OpenAI';
import Anthropic from '@lobehub/icons/es/Anthropic';
import Gemini from '@lobehub/icons/es/Gemini';
import DeepSeek from '@lobehub/icons/es/DeepSeek';
import ComfyUI from '@lobehub/icons/es/ComfyUI';

const PROVIDER_ICONS: Record<ApiProvider, React.ReactNode> = {
  custom: <Wrench size={18} className="text-gray-500 dark:text-gray-400" />,
  openai: <OpenAI size={18} />,
  anthropic: <Anthropic size={18} color="#D97757" />,
  gemini: <Gemini.Color size={18} />,
  deepseek: <DeepSeek.Color size={18} />,
};

// QinyAPI doesn't have an official lobehub icon, so we render a small inline
// SVG mark. Keeping it co-located with the modal avoids a new asset file for
// a single use site.
const QinyIcon = ({ size = 18 }: { size?: number }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="qiny-gradient" x1="0" y1="0" x2="24" y2="24" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#7C3AED" />
        <stop offset="1" stopColor="#06B6D4" />
      </linearGradient>
    </defs>
    <rect x="2" y="2" width="20" height="20" rx="5" fill="url(#qiny-gradient)" />
    <path
      d="M8 9.5a3.5 3.5 0 1 1 5.6 2.8L15.5 15M9 16h2"
      stroke="#fff"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const IMAGE_PROVIDER_ORDER: ImageApiProvider[] = ['qiny', 'comfyui'];
const IMAGE_PROVIDER_LABELS: Record<ImageApiProvider, string> = {
  qiny: 'QinyAPI',
  comfyui: 'ComfyUI',
};
const IMAGE_PROVIDER_ICONS: Record<ImageApiProvider, React.ReactNode> = {
  qiny: <QinyIcon size={18} />,
  comfyui: <ComfyUI.Color size={18} />,
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
  imageConnectionStatus: ConnectionStatus;
  imageConnectionError: string | null;
  availableImageModels: string[];
  onImageConnect: (overrideImageApi?: AppState['imageApi']) => Promise<boolean>;
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

// Press-and-hold to reveal an API key in plain text. `pointerdown`/`pointerup`
// covers mouse + touch + pen with a single listener pair, and `pointerleave`
// re-hides the key if the user drags off the icon while still pressing.
function ApiKeyInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
}) {
  const [revealed, setRevealed] = React.useState(false);
  return (
    <div className="relative">
      <input
        type={revealed ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-4 py-3 pr-12 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 font-mono"
      />
      <button
        type="button"
        aria-label="按住显示 API Key"
        title="按住显示"
        onPointerDown={(e) => {
          e.preventDefault();
          setRevealed(true);
        }}
        onPointerUp={() => setRevealed(false)}
        onPointerLeave={() => setRevealed(false)}
        onPointerCancel={() => setRevealed(false)}
        className={`absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors select-none touch-none ${
          revealed
            ? 'text-blue-600 dark:text-blue-400 bg-blue-500/10'
            : 'text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5'
        }`}
      >
        <Eye size={16} />
      </button>
    </div>
  );
}

export function SettingsModal({
  isOpen,
  onClose,
  settings,
  onSave,
  connectionStatus,
  connectionError,
  availableModels,
  onConnect,
  imageConnectionStatus,
  imageConnectionError,
  availableImageModels,
  onImageConnect,
}: SettingsModalProps) {
  const [localSettings, setLocalSettings] = React.useState<AppState>(settings);
  const [isModelListOpen, setIsModelListOpen] = React.useState(false);
  const [isProviderListOpen, setIsProviderListOpen] = React.useState(false);
  const [isImageProviderListOpen, setIsImageProviderListOpen] = React.useState(false);
  const [isImageModelListOpen, setIsImageModelListOpen] = React.useState(false);
  const modelListRef = React.useRef<HTMLDivElement>(null);
  const providerListRef = React.useRef<HTMLDivElement>(null);
  const imageProviderListRef = React.useRef<HTMLDivElement>(null);
  const imageModelListRef = React.useRef<HTMLDivElement>(null);

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

  React.useEffect(() => {
    if (!isImageProviderListOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (imageProviderListRef.current && !imageProviderListRef.current.contains(e.target as Node)) {
        setIsImageProviderListOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isImageProviderListOpen]);

  React.useEffect(() => {
    if (!isImageModelListOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (imageModelListRef.current && !imageModelListRef.current.contains(e.target as Node)) {
        setIsImageModelListOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [isImageModelListOpen]);

  const handleApiChange = (field: keyof AppState['api'], value: string | boolean) => {
    setLocalSettings(prev => ({
      ...prev,
      api: { ...prev.api, [field]: value }
    }));
  };

  const handleImageApiChange = <K extends keyof AppState['imageApi']>(
    field: K,
    value: AppState['imageApi'][K],
  ) => {
    setLocalSettings(prev => ({
      ...prev,
      imageApi: { ...prev.imageApi, [field]: value },
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

  const handleImageConnectClick = async () => {
    onSave(localSettings);
    await onImageConnect(localSettings.imageApi);
  };

  const handleSelectModel = (modelId: string) => {
    handleApiChange('model', modelId);
    setIsModelListOpen(false);
  };

  const handleSelectImageModel = (modelId: string) => {
    handleImageApiChange('model', modelId);
    setIsImageModelListOpen(false);
  };

  const statusMeta = STATUS_META[connectionStatus];
  const isConnecting = connectionStatus === 'connecting';
  const provider: ApiProvider = localSettings.api.apiProvider || 'custom';
  const isCustom = provider === 'custom';

  const imageProvider: ImageApiProvider = localSettings.imageApi.provider;
  const imageStatusMeta = STATUS_META[imageConnectionStatus];
  const isImageConnecting = imageConnectionStatus === 'connecting';
  // Per spec: 4K size option appears only when the selected model name
  // includes "gpt-image-2". Servers ignore the field if unsupported, so we
  // hide rather than gate to keep the UI uncluttered for other models.
  const showImageSizeOption = /gpt-image-2/i.test(localSettings.imageApi.model);

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="设置"
      maxWidth="max-w-2xl"
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
            className="px-6 py-2.5 text-sm font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 hover:shadow-glow transition-all focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-[#111] active:translate-y-[1px]"
          >
            保存配置
          </button>
        </div>
      }
    >
      <div className="p-6 sm:p-8 space-y-8">
        <section className="space-y-5">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200 pb-2 border-b border-gray-100 dark:border-white/5">
            <Plug size={16} className="text-blue-500" />
            LLM 端点设置
          </h4>
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
            <ApiKeyInput
              value={localSettings.api.apiKey}
              onChange={(v) => handleApiChange('apiKey', v)}
              placeholder="sk-..."
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
        </section>

        <section className="space-y-5">
          <div className="flex items-center justify-between gap-3 pb-2 border-b border-gray-100 dark:border-white/5">
            <h4 className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-200">
              <ImageIcon size={16} className="text-purple-500" />
              生图 API 端点设置
            </h4>
            <label
              className="inline-flex items-center gap-2 cursor-pointer select-none"
              title="开启后聊天气泡上会出现生图按钮"
            >
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {localSettings.imageApi.enabled ? '已启用' : '已关闭'}
              </span>
              <div className="relative inline-flex items-center">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={localSettings.imageApi.enabled}
                  onChange={(e) => handleImageApiChange('enabled', e.target.checked)}
                />
                <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"></div>
              </div>
            </label>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">API 来源</label>
            <div className="relative" ref={imageProviderListRef}>
              <button
                type="button"
                onClick={() => setIsImageProviderListOpen((v) => !v)}
                className="w-full flex items-center gap-3 px-4 py-3 pr-10 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all text-left"
              >
                <span className="inline-flex w-5 h-5 items-center justify-center shrink-0">
                  {IMAGE_PROVIDER_ICONS[imageProvider]}
                </span>
                <span className="flex-1 truncate">{IMAGE_PROVIDER_LABELS[imageProvider]}</span>
              </button>
              <ChevronDown size={16} className={`absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400 transition-transform ${isImageProviderListOpen ? 'rotate-180' : ''}`} />

              <AnimatePresence>
                {isImageProviderListOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.15 }}
                    className="absolute z-10 top-full left-0 right-0 mt-2 overflow-hidden rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1A1A1A] shadow-elevation-3"
                  >
                    <ul className="py-1">
                      {IMAGE_PROVIDER_ORDER.map((p) => {
                        const active = p === imageProvider;
                        return (
                          <li key={p}>
                            <button
                              type="button"
                              onClick={() => {
                                handleImageApiChange('provider', p);
                                setIsImageProviderListOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-3 transition-colors ${
                                active
                                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                                  : 'text-gray-800 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/5'
                              }`}
                            >
                              <span className="inline-flex w-5 h-5 items-center justify-center shrink-0">
                                {IMAGE_PROVIDER_ICONS[p]}
                              </span>
                              <span className="flex-1 truncate">{IMAGE_PROVIDER_LABELS[p]}</span>
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

          {imageProvider === 'comfyui' && (
            <div className="rounded-xl border border-dashed border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] py-10 text-center text-sm text-gray-500 dark:text-gray-400">
              尽情期待
            </div>
          )}

          {imageProvider === 'qiny' && (
            <>
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">API Key</label>
                  <a
                    href="https://openai.chatnewai.com/register?aff=btB0"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors"
                  >
                    获取 API Key
                  </a>
                </div>
                <ApiKeyInput
                  value={localSettings.imageApi.apiKey}
                  onChange={(v) => handleImageApiChange('apiKey', v)}
                  placeholder="sk-..."
                />
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={handleImageConnectClick}
                  disabled={isImageConnecting || !localSettings.imageApi.apiKey}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white transition-all"
                >
                  {isImageConnecting ? <Loader2 size={16} className="animate-spin" /> : <Plug size={16} />}
                  连接
                </button>
                <div
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium ${imageStatusMeta.bg} ${imageStatusMeta.text}`}
                  title={imageConnectionError || imageStatusMeta.label}
                >
                  <span className={`w-2 h-2 rounded-full ${imageStatusMeta.dot} ${isImageConnecting ? 'animate-pulse' : ''}`}></span>
                  {imageStatusMeta.label}
                </div>
              </div>
              {imageConnectionError && imageConnectionStatus === 'disconnected' && (
                <p className="text-[11px] text-red-500 dark:text-red-400 -mt-3 break-all">
                  {imageConnectionError}
                </p>
              )}

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">模型名称 (Model)</label>
                <div className="relative flex items-stretch gap-2" ref={imageModelListRef}>
                  <input
                    type="text"
                    value={localSettings.imageApi.model}
                    onChange={(e) => handleImageApiChange('model', e.target.value)}
                    placeholder="gpt-image-2"
                    className="flex-1 min-w-0 px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setIsImageModelListOpen((v) => !v)}
                    disabled={availableImageModels.length === 0}
                    className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#1A1A1A] text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-white/20 hover:text-gray-900 dark:hover:text-gray-100 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    title={availableImageModels.length === 0 ? '请先点击「连接」获取模型列表' : '从模型列表中选择'}
                  >
                    <List size={16} />
                    <ChevronDown size={14} className={`transition-transform ${isImageModelListOpen ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {isImageModelListOpen && availableImageModels.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute z-10 bottom-full right-0 mb-2 w-full sm:w-80 max-h-72 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1A1A1A] shadow-elevation-3"
                      >
                        <div className="px-3 py-2 border-b border-gray-100 dark:border-white/5 text-[11px] text-gray-500 dark:text-gray-400">
                          共 {availableImageModels.length} 个模型
                        </div>
                        <ul className="py-1">
                          {availableImageModels.map((m) => {
                            const active = m === localSettings.imageApi.model;
                            return (
                              <li key={m}>
                                <button
                                  type="button"
                                  onClick={() => handleSelectImageModel(m)}
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

              {showImageSizeOption && (
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">尺寸参数</label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: 'default' as ImageSize, label: '默认' },
                      { value: '4k' as ImageSize, label: '4K' },
                    ]).map((opt) => {
                      const active = localSettings.imageApi.size === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleImageApiChange('size', opt.value)}
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
                    4K 仅 gpt-image-2 等支持 3840×2160 的模型可用；其他模型会自动忽略此参数。
                  </p>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </BaseModal>
  );
}
