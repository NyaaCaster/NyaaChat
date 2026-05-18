import React, { useEffect, useRef, useState } from "react";
import {
  FileText,
  Globe,
  Image as ImageIcon,
  ImagePlus,
  MessageSquare,
  Paperclip,
  Send,
  Square,
  X as XIcon,
} from "lucide-react";
import type { Attachment } from "../lib/chatPipeline";
import { AppState, LlmProvider, ImageProvider } from "../types";
import {
  getActiveImageProvider,
  getActiveLlmProvider,
} from "../lib/providers";
import { LlmProviderIcon, ImageProviderIcon } from "./icons/providerIcons";

interface ChatComposerProps {
  input: string;
  onInputChange: (value: string) => void;
  attachments: Attachment[];
  onAddFiles: (files: FileList | File[]) => void | Promise<void>;
  onRemoveAttachment: (index: number) => void;
  onSubmit: () => void;
  onStop: () => void;
  isLoading: boolean;
  settings: AppState;
  onSettingsChange: (next: AppState) => void;
}

/**
 * Message composer with action toolbar (attachments / web search / image
 * model card / chat model card) above the input.
 *
 * The model cards are the canonical way to switch the active LLM / image
 * provider + model — picking from a card writes back to
 * `currentLlmProviderId` / `currentImageProviderId` and updates the chosen
 * provider's `lastUsedModel`. The chat path (ChatInterface.sendChat) reads
 * those fields when assembling the request.
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
  settings,
  onSettingsChange,
}: ChatComposerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const llmCardRef = useRef<HTMLDivElement>(null);
  const imageCardRef = useRef<HTMLDivElement>(null);
  const [openPicker, setOpenPicker] = useState<"llm" | "image" | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // Auto-fade hint banner. Used for the placeholder web-search toast and
  // any future composer-level notifications. Single concurrent message —
  // a new hint replaces the previous and resets the timer.
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 2500);
    return () => clearTimeout(t);
  }, [hint]);

  // Close any open picker on outside click.
  useEffect(() => {
    if (!openPicker) return;
    const handle = (e: MouseEvent) => {
      const target = e.target as Node;
      if (llmCardRef.current?.contains(target)) return;
      if (imageCardRef.current?.contains(target)) return;
      setOpenPicker(null);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openPicker]);

  const handlePaste = async (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      await onAddFiles(files);
    }
  };

  // ----- Derived state for the model cards -----
  const llmPickerProviders = settings.llmProviders.filter(
    (p) => p.enabled && p.models.length > 0,
  );
  const imagePickerProviders = settings.imageProviders.filter(
    (p) => p.enabled && p.models.length > 0,
  );
  // The image card is hidden entirely when no image provider is enabled,
  // matching the "至少一个 image provider 启用后才显示" requirement.
  const showImageCard = settings.imageProviders.some((p) => p.enabled);

  const activeLlm = getActiveLlmProvider(settings);
  const activeLlmModelId =
    activeLlm?.lastUsedModel || activeLlm?.models[0]?.id || null;
  const activeImage = getActiveImageProvider(settings);
  const activeImageModelId =
    activeImage?.lastUsedModel || activeImage?.models[0]?.id || null;

  // ----- Handlers for the model cards -----
  const handleSelectLlmModel = (providerId: string, modelId: string) => {
    onSettingsChange({
      ...settings,
      currentLlmProviderId: providerId,
      llmProviders: settings.llmProviders.map((p) =>
        p.id === providerId ? { ...p, lastUsedModel: modelId } : p,
      ),
    });
    setOpenPicker(null);
  };

  const handleSelectImageModel = (providerId: string, modelId: string) => {
    onSettingsChange({
      ...settings,
      currentImageProviderId: providerId,
      imageProviders: settings.imageProviders.map((p) =>
        p.id === providerId ? { ...p, lastUsedModel: modelId } : p,
      ),
    });
    setOpenPicker(null);
  };

  const handleToggleWebSearch = () => {
    const next = !settings.isWebSearchEnabled;
    onSettingsChange({ ...settings, isWebSearchEnabled: next });
    setHint(
      next
        ? "联网搜索已开启 · 后续消息将注入实时检索结果"
        : "联网搜索已关闭",
    );
  };

  const isWebSearchOn = !!settings.isWebSearchEnabled;

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

        {/* Hint banner */}
        {hint && (
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-gray-900/90 dark:bg-white/90 text-white dark:text-gray-900 text-xs font-medium shadow-elevation-2 pointer-events-none z-30">
            {hint}
          </div>
        )}

        {/* Attachment chip strip */}
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

        {/* Toolbar row */}
        <div className="flex items-center gap-2 mb-2 px-1 flex-wrap">
          <ToolbarIconButton
            onClick={() => fileInputRef.current?.click()}
            title="添加附件"
            aria-label="添加附件"
          >
            <Paperclip size={16} />
          </ToolbarIconButton>
          <ToolbarIconButton
            onClick={handleToggleWebSearch}
            title={isWebSearchOn ? "关闭联网搜索" : "开启联网搜索"}
            aria-label={isWebSearchOn ? "关闭联网搜索" : "开启联网搜索"}
            active={isWebSearchOn}
          >
            <Globe size={16} />
          </ToolbarIconButton>

          <span className="flex-1" />

          {showImageCard && (
            <ModelCard
              ref={imageCardRef}
              icon={
                activeImage ? (
                  <ImageProviderIcon kind={activeImage.kind} size={14} />
                ) : (
                  <ImagePlus size={14} className="text-gray-400" />
                )
              }
              fallbackIcon={<ImagePlus size={14} className="text-gray-400" />}
              hasSelection={!!activeImageModelId}
              label={activeImageModelId || "选择画图模型"}
              isOpen={openPicker === "image"}
              onClick={() =>
                setOpenPicker((cur) => (cur === "image" ? null : "image"))
              }
              accentClass="text-purple-600 dark:text-purple-400"
              dropdown={
                <ProviderPicker
                  providers={imagePickerProviders}
                  emptyHint="未启用任何生图模型供应商,先去『设置 → 生图模型设置』启用"
                  activeProviderId={settings.currentImageProviderId}
                  activeModelId={activeImageModelId}
                  onSelect={handleSelectImageModel}
                  variant="image"
                />
              }
            />
          )}

          <ModelCard
            ref={llmCardRef}
            icon={
              activeLlm ? (
                <LlmProviderIcon kind={activeLlm.kind} size={14} />
              ) : (
                <MessageSquare size={14} className="text-gray-400" />
              )
            }
            fallbackIcon={<MessageSquare size={14} className="text-gray-400" />}
            hasSelection={!!activeLlmModelId}
            label={activeLlmModelId || "选择聊天模型"}
            isOpen={openPicker === "llm"}
            onClick={() =>
              setOpenPicker((cur) => (cur === "llm" ? null : "llm"))
            }
            accentClass="text-blue-600 dark:text-blue-400"
            dropdown={
              <ProviderPicker
                providers={llmPickerProviders}
                emptyHint="未启用任何对话模型供应商,先去『设置 → 对话模型设置』启用"
                activeProviderId={settings.currentLlmProviderId}
                activeModelId={activeLlmModelId}
                onSelect={handleSelectLlmModel}
                variant="llm"
              />
            }
          />
        </div>

        {/* Input form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isLoading) onStop();
            else onSubmit();
          }}
          className="relative flex items-end shadow-elevation-2 rounded-2xl border border-gray-200/50 dark:border-white/10 bg-white/90 dark:bg-[#111111]/90 backdrop-blur-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/50 transition-all duration-300"
        >
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
            className="flex-1 max-h-60 min-h-[60px] py-4 pl-4 pr-14 bg-transparent outline-none resize-none text-sm placeholder-gray-400 dark:placeholder-gray-600 focus:placeholder-transparent transition-all"
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

// ---------------------------------------------------------------------------
// Toolbar icon button (paperclip, globe)
// ---------------------------------------------------------------------------

interface ToolbarIconButtonProps {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  "aria-label": string;
}

function ToolbarIconButton({
  children,
  onClick,
  title,
  active = false,
  "aria-label": ariaLabel,
}: ToolbarIconButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      className={`p-2 rounded-lg transition-all flex-shrink-0 ${
        active
          ? "bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/40"
          : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Model card — anchored card whose dropdown opens upward
// ---------------------------------------------------------------------------

interface ModelCardProps {
  icon: React.ReactNode;
  fallbackIcon: React.ReactNode;
  hasSelection: boolean;
  label: string;
  isOpen: boolean;
  onClick: () => void;
  dropdown: React.ReactNode;
  accentClass: string;
}

const ModelCard = React.forwardRef<HTMLDivElement, ModelCardProps>(
  function ModelCard(
    { icon, fallbackIcon, hasSelection, label, isOpen, onClick, dropdown, accentClass },
    ref,
  ) {
    return (
      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={onClick}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-all max-w-[180px] ${
            isOpen
              ? "border-blue-400 bg-blue-50 dark:bg-blue-500/10"
              : hasSelection
                ? `border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 ${accentClass} hover:border-gray-300 dark:hover:border-white/20`
                : "border-dashed border-gray-300 dark:border-white/15 bg-transparent text-gray-500 dark:text-gray-400 hover:border-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          }`}
        >
          <span className="w-4 h-4 flex items-center justify-center flex-shrink-0">
            {hasSelection ? icon : fallbackIcon}
          </span>
          <span className="truncate font-mono">{label}</span>
        </button>
        {isOpen && (
          <div className="absolute bottom-full right-0 mb-2 w-72 max-h-80 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1A1A1A] shadow-elevation-3 z-30">
            {dropdown}
          </div>
        )}
      </div>
    );
  },
);

// ---------------------------------------------------------------------------
// Provider-grouped model picker (used inside both cards' dropdowns)
// ---------------------------------------------------------------------------

interface ProviderPickerProps<P> {
  providers: P[];
  emptyHint: string;
  activeProviderId: string;
  activeModelId: string | null;
  onSelect: (providerId: string, modelId: string) => void;
  variant: "llm" | "image";
}

function ProviderPicker<P extends LlmProvider | ImageProvider>({
  providers,
  emptyHint,
  activeProviderId,
  activeModelId,
  onSelect,
  variant,
}: ProviderPickerProps<P>) {
  if (providers.length === 0) {
    return (
      <div className="px-4 py-6 text-xs text-center text-gray-500 dark:text-gray-400">
        {emptyHint}
      </div>
    );
  }
  return (
    <div className="py-1">
      {providers.map((p) => (
        <div key={p.id}>
          <div className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-black/20">
            <span className="w-4 h-4 inline-flex items-center justify-center flex-shrink-0">
              {variant === "llm" ? (
                <LlmProviderIcon kind={(p as LlmProvider).kind} size={14} />
              ) : (
                <ImageProviderIcon kind={(p as ImageProvider).kind} size={14} />
              )}
            </span>
            <span className="flex-1 truncate normal-case font-medium text-gray-700 dark:text-gray-300">
              {p.name}
            </span>
          </div>
          <ul className="py-0.5">
            {p.models.map((m) => {
              const isActive =
                activeProviderId === p.id && activeModelId === m.id;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(p.id, m.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs font-mono flex items-center gap-2 transition-colors ${
                      isActive
                        ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                        : "text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5"
                    }`}
                  >
                    <span className="truncate flex-1">{m.id}</span>
                    {isActive && (
                      <span className="text-[10px] font-sans flex-shrink-0">
                        当前
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
