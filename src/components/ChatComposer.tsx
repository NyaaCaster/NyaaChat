import React, { useRef } from "react";
import { Send, Square, Paperclip, FileText, Image as ImageIcon, X as XIcon } from "lucide-react";
import type { Attachment } from "../lib/chatPipeline";

interface ChatComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  attachments: Attachment[];
  onAddFiles: (files: FileList | File[]) => void | Promise<void>;
  onRemoveAttachment: (index: number) => void;
  onSubmit: () => void;
  onStop: () => void;
  isLoading: boolean;
}

/**
 * Message composer with attachment chip strip, paste-to-attach, Ctrl/⌘+Enter
 * to send. Stop button replaces Send while a request is in flight.
 */
export function ChatComposer({
  input,
  onInputChange,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  onSubmit,
  onStop,
  isLoading,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePaste = async (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      await onAddFiles(files);
    }
  };

  return (
    <footer className="flex-shrink-0 bg-transparent p-4 sm:px-6 sm:pb-6 z-20">
      <div className="max-w-3xl mx-auto relative">
        <input
          type="file"
          multiple
          className="hidden"
          ref={fileInputRef}
          onChange={(e) => e.target.files && onAddFiles(e.target.files)}
        />
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 px-1">
            {attachments.map((att, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 rounded-lg text-xs text-gray-700 dark:text-gray-300"
              >
                {att.type === "image" ? (
                  <ImageIcon size={12} className="text-blue-500" />
                ) : (
                  <FileText size={12} className="text-gray-400" />
                )}
                <span className="max-w-[120px] truncate">{att.name}</span>
                <button
                  onClick={() => onRemoveAttachment(i)}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                  aria-label={`移除附件 ${att.name}`}
                >
                  <XIcon size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isLoading) onStop();
            else onSubmit();
          }}
          className="relative flex items-end shadow-elevation-2 rounded-2xl border border-gray-200/50 dark:border-white/10 bg-white/90 dark:bg-[#111111]/90 backdrop-blur-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/50 transition-all duration-300"
        >
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="absolute left-2 bottom-2 p-2.5 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-all"
            title="添加附件"
          >
            <Paperclip size={18} />
          </button>
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (isLoading) onStop();
                else onSubmit();
              }
            }}
            placeholder="发送消息... (Ctrl + Enter 发送)"
            className="flex-1 max-h-60 min-h-[60px] py-4 pl-12 pr-14 bg-transparent outline-none resize-none text-sm placeholder-gray-400 dark:placeholder-gray-600 focus:placeholder-transparent transition-all"
            rows={1}
          />
          <button
            onClick={(e) => {
              if (isLoading) {
                e.preventDefault();
                onStop();
              }
            }}
            type={isLoading ? "button" : "submit"}
            disabled={!input.trim() && !isLoading}
            className={`absolute right-2 bottom-2 p-2.5 rounded-xl text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center overflow-hidden ${
              isLoading
                ? "bg-red-500 hover:bg-red-600 shadow-glow shadow-red-500/50"
                : "bg-blue-600 hover:bg-blue-700 hover:shadow-glow"
            }`}
          >
            {isLoading && (
              <div className="absolute inset-0 border-2 border-t-white/80 border-white/20 rounded-xl animate-spin"></div>
            )}
            {isLoading ? (
              <Square size={18} fill="currentColor" className="relative z-10" />
            ) : (
              <Send size={18} className="relative z-10 translate-x-[-1px] translate-y-[1px]" />
            )}
          </button>
        </form>
        <div className="text-center mt-3">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">
            内容由 LLM 服务提供。生成内容仅供参考。
          </p>
        </div>
      </div>
    </footer>
  );
}
