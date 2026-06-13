import React, { useState } from "react";
import { createPortal } from "react-dom";
import {
  Settings,
  PlusCircle,
  Sparkles,
  MessageSquare,
  Flame,
  Terminal,
  User,
  History,
  Maximize,
  Minimize,
  Puzzle,
  Regex,
} from "lucide-react";
import { motion } from "motion/react";
import type { CharacterSettings } from "../types";
import { VersionModal } from "./VersionModal";
import { ExtensionsModal } from "./ExtensionsModal";
import { RegexModal } from "./RegexModal";

interface ChatHeaderProps {
  characters: CharacterSettings[] | undefined;
  currentCharacterId: string;
  isBypassActive: boolean;
  isFullscreenSupported: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  onOpenConsole: () => void;
  onOpenBypass: () => void;
  onOpenSettings: () => void;
  onOpenCharacterSelection: () => void;
  onOpenUserRole: () => void;
  onOpenChatHistory: () => void;
  onClearChat: () => void;
}

/**
 * Sticky two-row toolbar. The top row carries app branding + global modals
 * (settings, appearance, console, bypass), the bottom row exposes chat-scoped
 * actions (active character, user persona, history, new chat).
 */
export function ChatHeader({
  characters,
  currentCharacterId,
  isBypassActive,
  isFullscreenSupported,
  isFullscreen,
  onToggleFullscreen,
  onOpenConsole,
  onOpenBypass,
  onOpenSettings,
  onOpenCharacterSelection,
  onOpenUserRole,
  onOpenChatHistory,
  onClearChat,
}: ChatHeaderProps) {
  const currentName =
    characters?.find((c) => c.id === currentCharacterId)?.name || "AI助手";
  const [isVersionOpen, setIsVersionOpen] = useState(false);
  const [isExtensionsOpen, setIsExtensionsOpen] = useState(false);
  const [isRegexOpen, setIsRegexOpen] = useState(false);

  return (
    <div data-app-header className="flex-shrink-0 bg-white/70 dark:bg-[#0A0A0A]/70 backdrop-blur-xl border-b border-gray-200/60 dark:border-white/5 sticky top-0 z-20 flex flex-col">
      <header className="px-4 sm:px-6 py-2.5 sm:py-3 flex items-center justify-between border-b border-gray-100 dark:border-white/5">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <MessageSquare size={16} className="text-white" />
          </div>
          <h1
            className="text-lg font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)" }}
          >
            <a href="https://github.com/NyaaCaster/NyaaChat" target="_blank" rel="noopener noreferrer">NyaaChat</a>
            <button
              type="button"
              onClick={() => setIsVersionOpen(true)}
              className="ml-1.5 align-baseline text-[11px] font-medium text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 transition-colors cursor-pointer"
              title="查看版本信息"
            >
              v{__APP_VERSION__}
            </button>
          </h1>
          {isBypassActive && (
            <motion.span
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]"></span>
              Bypass
            </motion.span>
          )}
        </div>
        <div className="flex items-center space-x-1">
          {isFullscreenSupported && (
            <button
              onClick={onToggleFullscreen}
              className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-all duration-200"
              title={isFullscreen ? "退出全屏" : "全屏模式"}
            >
              {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
          )}
          <button
            onClick={onOpenConsole}
            className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-all duration-200"
            title="控制台 (Console)"
          >
            <Terminal size={18} />
          </button>
          <button
            onClick={onOpenBypass}
            className={`p-2 rounded-lg transition-all duration-200 flex items-center justify-center ${
              isBypassActive
                ? "text-red-500 bg-red-500/10 hover:bg-red-500/20"
                : "text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-white/10"
            }`}
            title="绕过机制 (Bypass)"
          >
            <Flame
              size={18}
              className={isBypassActive ? "animate-pulse" : ""}
            />
          </button>
          <button
            onClick={() => setIsExtensionsOpen(true)}
            className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-all duration-200"
            title="扩展"
          >
            <Puzzle size={18} />
          </button>
          <button
            onClick={onOpenSettings}
            className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-all duration-200"
            title="设置"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-1.5 flex items-center justify-between bg-gray-50/50 dark:bg-[#111]/50 gap-1">
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenCharacterSelection}
            className="px-2 py-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-all duration-200"
            title="角色管理"
          >
            <Sparkles size={16} className="text-blue-500" />
            {currentName}
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onOpenUserRole}
            className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-all duration-200"
            title="用户角色"
          >
            <User size={16} />
          </button>
          <button
            onClick={() => setIsRegexOpen(true)}
            className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-all duration-200"
            title="正则"
          >
            <Regex size={16} />
          </button>
          <button
            onClick={onOpenChatHistory}
            className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-all duration-200"
            title="聊天记录"
          >
            <History size={16} />
          </button>
          <button
            onClick={onClearChat}
            className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-all duration-200"
            title="新的对话"
          >
            <PlusCircle size={16} />
          </button>
        </div>
      </div>

      {/* Portal to body: this header div has backdrop-blur (backdrop-filter),
          which would otherwise become the containing block for the modal's
          fixed positioning and pin it inside the header instead of the viewport. */}
      {createPortal(
        <VersionModal isOpen={isVersionOpen} onClose={() => setIsVersionOpen(false)} />,
        document.body,
      )}
      {createPortal(
        <ExtensionsModal isOpen={isExtensionsOpen} onClose={() => setIsExtensionsOpen(false)} />,
        document.body,
      )}
      {createPortal(
        <RegexModal isOpen={isRegexOpen} onClose={() => setIsRegexOpen(false)} />,
        document.body,
      )}
    </div>
  );
}
