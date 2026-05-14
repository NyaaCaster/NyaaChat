import React from 'react';
import { X } from 'lucide-react';
import { AppState } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppState;
  onSave: (settings: AppState) => void;
}

export function SettingsModal({ isOpen, onClose, settings, onSave }: SettingsModalProps) {
  const [localSettings, setLocalSettings] = React.useState<AppState>(settings);

  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings, isOpen]);

  const handleApiChange = (field: keyof AppState['api'], value: string | boolean) => {
    setLocalSettings(prev => ({
      ...prev,
      api: { ...prev.api, [field]: value }
    }));
  };

  const handleThemeChange = (theme: AppState['theme']) => {
    setLocalSettings(prev => ({ ...prev, theme }));
  };

  const handleSave = () => {
    onSave(localSettings);
    onClose();
  };

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

            <div className="space-y-10">
              {/* General Settings */}
              <section className="space-y-4 border-b border-gray-100 dark:border-white/10 pb-8">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-blue-500 rounded-full"></span> 外观设置
                </h3>
                <div className="flex gap-4 sm:gap-6 pl-3">
                  {['light', 'dark', 'system'].map((themeName) => (
                    <label key={themeName} className="flex items-center space-x-2.5 cursor-pointer group">
                      <div className="relative flex items-center justify-center w-5 h-5">
                        <input
                          type="radio"
                          name="theme"
                          checked={localSettings.theme === themeName}
                          onChange={() => handleThemeChange(themeName as any)}
                          className="peer sr-only"
                        />
                        <div className="w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 peer-checked:border-blue-500 group-hover:border-blue-400 dark:group-hover:border-blue-400 transition-colors"></div>
                        <div className="absolute w-2.5 h-2.5 rounded-full bg-blue-500 scale-0 peer-checked:scale-100 transition-transform"></div>
                      </div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">
                        {themeName === 'light' ? '浅色' : themeName === 'dark' ? '深色' : '跟随系统'} ({themeName})
                      </span>
                    </label>
                  ))}
                </div>
              </section>

              {/* API Settings */}
              <section className="space-y-4 border-b border-gray-100 dark:border-white/10 pb-8">
                <h3 className="text-lg font-medium text-gray-900 dark:text-gray-100 flex items-center gap-2">
                  <span className="w-1.5 h-6 bg-blue-500 rounded-full"></span> LLM 端点配置
                </h3>
                
                <div className="space-y-5 pl-3">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">API Base URL</label>
                    <input
                      type="text"
                      value={localSettings.api.baseUrl}
                      onChange={(e) => handleApiChange('baseUrl', e.target.value)}
                      placeholder="https://api.openai.com/v1"
                      className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600"
                    />
                  </div>

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

                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-2">模型名称 (Model)</label>
                    <input
                      type="text"
                      value={localSettings.api.model}
                      onChange={(e) => handleApiChange('model', e.target.value)}
                      placeholder="gpt-3.5-turbo"
                      className="w-full px-4 py-3 border border-gray-200 dark:border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent bg-gray-50 dark:bg-[#1A1A1A] text-gray-900 dark:text-gray-100 outline-none transition-all placeholder:text-gray-400 dark:placeholder:text-gray-600 font-mono"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-2">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-gray-900 dark:text-gray-100">流式输出 (Streaming)</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">以 stream:true 模式进行 API 请求，实时接收片段</span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={localSettings.api.isStreaming || false}
                        onChange={(e) => handleApiChange('isStreaming', e.target.checked)}
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-500/50 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-500"></div>
                    </label>
                  </div>
                </div>
              </section>
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
