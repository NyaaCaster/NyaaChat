import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  FileText,
  Globe,
  Image as ImageIcon,
  ImagePlus,
  MapPin,
  MessageSquare,
  Paperclip,
  Plug,
  Send,
  Square,
  X as XIcon,
} from "lucide-react";
import type { Attachment } from "../lib/chatPipeline";
import { AppState, LlmProvider, ImageProvider, ModelCapability, ModelHealth } from "../types";
import {
  getActiveImageProvider,
  getActiveLlmProvider,
} from "../lib/providers";
import { LlmProviderIcon, ImageProviderIcon } from "./icons/providerIcons";
import { CAPABILITY_META } from "./icons/capabilityMeta";
import { ToggleSwitch } from "./SettingsFormBits";
import { listTools, ping, filterAdvertised, type McpHealth, type McpTool } from "../lib/mcpApi";
import { WEB_SEARCH_FEATURE_ENABLED } from "../lib/searchApi";

// MCP geo settings is a small leaf modal; lazy-load it like the rest so it
// doesn't bloat the initial composer chunk.
const McpGeoModal = lazy(() =>
  import("./McpGeoModal").then((m) => ({ default: m.McpGeoModal })),
);

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
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const llmCardRef = useRef<HTMLDivElement>(null);
  const imageCardRef = useRef<HTMLDivElement>(null);
  const mcpCardRef = useRef<HTMLDivElement>(null);
  const [openPicker, setOpenPicker] = useState<"llm" | "image" | "mcp" | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  // MCP runtime state. Health and tools are not persisted — they are probed
  // from the MCP server on mount and again whenever the user opens the
  // picker, so the indicator dot is always grounded in fresh data rather
  // than a cached snapshot.
  const [mcpHealth, setMcpHealth] = useState<McpHealth | null>(null);
  const [mcpTools, setMcpTools] = useState<McpTool[]>([]);
  const [isMcpRefreshing, setIsMcpRefreshing] = useState(false);
  const [isGeoModalOpen, setIsGeoModalOpen] = useState(false);

  const refreshMcp = useCallback(async () => {
    setIsMcpRefreshing(true);
    try {
      const health = await ping();
      setMcpHealth(health);
      if (health.ok) {
        try {
          const tools = await listTools();
          setMcpTools(filterAdvertised(tools));
        } catch {
          setMcpTools([]);
        }
      } else {
        setMcpTools([]);
      }
    } finally {
      setIsMcpRefreshing(false);
    }
  }, []);

  // Probe once on mount so the indicator is meaningful before the user
  // opens the picker.
  useEffect(() => {
    void refreshMcp();
  }, [refreshMcp]);

  // Re-probe each time the picker opens so the user sees current state on
  // every open (covers MCP server bouncing while the page stays loaded).
  useEffect(() => {
    if (openPicker === "mcp") void refreshMcp();
  }, [openPicker, refreshMcp]);

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
      if (mcpCardRef.current?.contains(target)) return;
      setOpenPicker(null);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [openPicker]);

  // Auto-grow the textarea: it starts at a single line and expands one line
  // at a time as the user types / wraps. The ceiling is computed from the
  // viewport so the growing composer never pushes its top edge past the
  // bottom of the top toolbar — once that ceiling is hit the textarea scrolls
  // internally (with the project's blue scrollbar) instead of growing further.
  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    // Reset to auto first so scrollHeight reflects the true content height.
    el.style.height = "auto";
    const header = document.querySelector<HTMLElement>("[data-app-header]");
    const footer = el.closest("footer");
    const headerH = header?.offsetHeight ?? 0;
    // Everything in the composer footer that isn't the textarea itself
    // (toolbar row, attachment chips, disclaimer, paddings).
    const otherH = footer ? footer.offsetHeight - el.offsetHeight : 0;
    const MARGIN = 32; // breathing room kept above the composer
    const FLOOR = 44; // never collapse below one comfortable line
    const maxH = window.innerHeight - headerH - otherH - MARGIN;
    const next = Math.max(FLOOR, Math.min(el.scrollHeight, maxH));
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > next ? "auto" : "hidden";
  }, []);

  // Recompute on content change and whenever the attachment strip toggles
  // (it changes the footer's non-textarea height, shifting the ceiling).
  useLayoutEffect(() => {
    resizeTextarea();
  }, [input, attachments.length, resizeTextarea]);

  // When a newline is inserted programmatically (the various "newline" key
  // combos below), the controlled value updates but the browser would drop the
  // caret to the end. Stash the intended caret offset and restore it after the
  // commit so typing continues exactly where the user was.
  const pendingCaretRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaretRef.current == null) return;
    const el = textareaRef.current;
    const pos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    if (el) {
      el.focus();
      try {
        el.selectionStart = el.selectionEnd = pos;
      } catch {
        /* setSelectionRange can throw if the element isn't yet selectable */
      }
    }
  }, [input]);

  // Insert a newline at the current caret / selection and queue the caret to
  // land just after it. Used by the send-key combos that should break a line
  // instead of sending.
  const insertNewlineAtCursor = useCallback(() => {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? input.length;
    const end = el?.selectionEnd ?? input.length;
    const next = input.slice(0, start) + "\n" + input.slice(end);
    pendingCaretRef.current = start + 1;
    onInputChange(next);
  }, [input, onInputChange]);

  // The ceiling depends on viewport height, so track window resizes too.
  useEffect(() => {
    window.addEventListener("resize", resizeTextarea);
    return () => window.removeEventListener("resize", resizeTextarea);
  }, [resizeTextarea]);

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

  const handleToggleMcpTool = (toolName: string, next: boolean) => {
    onSettingsChange({
      ...settings,
      mcpToolsEnabled: { ...settings.mcpToolsEnabled, [toolName]: next },
    });
  };

  const handleSetMcpUserCity = (city: string | null) => {
    onSettingsChange({ ...settings, mcpUserCity: city });
  };

  const isWebSearchOn = !!settings.isWebSearchEnabled;

  return (
    // id="send_form": ST DOM-compat anchor. ST extensions (JS-Slash-Runner)
    // locate the message input form by `#send_form` and prepend their own
    // quick-reply bar (`#qr--bar`) into it, and attach a MutationObserver to
    // `$('#send_form')[0]` — which throws if the element is absent. The node JSR
    // injects is outside React's render tree, so React's diff leaves it alone
    // (same escape-hatch boundary as `.mes_text` in P3).
    <footer id="send_form" className="flex-shrink-0 bg-transparent p-4 sm:px-6 sm:pb-6 z-20">
      <div className="max-w-3xl lg:max-w-[60rem] mx-auto relative">
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

        {/* Toolbar row. Made `relative` so the MCP popover (which is wider
            than the icon button anchoring it) can position itself against
            the full toolbar width — left-anchored to the toolbar's leading
            edge — and use `max-w-full` to never overflow the viewport on
            narrow screens. The model picker cards keep their own
            self-anchored relative wrappers, so they're unaffected. */}
        <div className="flex items-center gap-2 mb-2 px-1 flex-wrap relative">
          <ToolbarIconButton
            onClick={() => fileInputRef.current?.click()}
            title="添加附件"
            aria-label="添加附件"
          >
            <Paperclip size={16} />
          </ToolbarIconButton>
          {WEB_SEARCH_FEATURE_ENABLED && (
            <ToolbarIconButton
              onClick={handleToggleWebSearch}
              title={isWebSearchOn ? "关闭联网搜索" : "开启联网搜索"}
              aria-label={isWebSearchOn ? "关闭联网搜索" : "开启联网搜索"}
              active={isWebSearchOn}
            >
              <Globe size={16} />
            </ToolbarIconButton>
          )}

          {/* MCP tools entry — pure popover anchor; per-tool toggles + the
              health indicator + the geo settings button all live inside the
              floating card below. The wrapper deliberately omits `relative`
              so McpToolsCard anchors to the toolbar row, not to this 32-px
              icon button — that's how its `left-0` lines up with the
              toolbar's leading edge and `max-w-full` clamps it to the
              viewport width on phones. */}
          <div ref={mcpCardRef}>
            <ToolbarIconButton
              onClick={() =>
                setOpenPicker((cur) => (cur === "mcp" ? null : "mcp"))
              }
              title="MCP 工具"
              aria-label="MCP 工具"
              active={openPicker === "mcp"}
            >
              <Plug size={16} />
            </ToolbarIconButton>
            {openPicker === "mcp" && (
              <McpToolsCard
                health={mcpHealth}
                tools={mcpTools}
                isRefreshing={isMcpRefreshing}
                toolsEnabled={settings.mcpToolsEnabled}
                currentCity={settings.mcpUserCity}
                onToggleTool={handleToggleMcpTool}
                onOpenGeoModal={() => {
                  setIsGeoModalOpen(true);
                  setOpenPicker(null);
                }}
              />
            )}
          </div>

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
            ref={textareaRef}
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              // `mod` is Ctrl on Windows/Linux and ⌘ on macOS, so both
              // keyboard layouts get the same shortcut behavior.
              const mod = e.ctrlKey || e.metaKey;
              const submit = () => {
                e.preventDefault();
                if (isLoading) onStop();
                else onSubmit();
              };

              if (settings.sendMode === "enter") {
                // Enter sends; Ctrl/⌘+Enter and Shift+Enter newline.
                if (e.key === "Enter") {
                  // Don't send mid-IME-composition (Chinese/Japanese input).
                  if (e.nativeEvent.isComposing) return;
                  if (e.shiftKey && !mod) return; // native newline
                  if (mod) {
                    e.preventDefault();
                    insertNewlineAtCursor();
                    return;
                  }
                  submit();
                  return;
                }
                return;
              }

              // Default mode: Ctrl/⌘+Enter sends; a bare Enter newlines natively.
              if (e.key === "Enter" && mod) {
                if (e.nativeEvent.isComposing) return;
                submit();
              }
            }}
            placeholder={
              settings.sendMode === "enter"
                ? "发送消息... (Enter 发送)"
                : "发送消息... (Ctrl + Enter 发送)"
            }
            className="flex-1 py-3 pl-4 pr-12 bg-transparent outline-none resize-none text-sm leading-6 placeholder-gray-400 dark:placeholder-gray-600 focus:placeholder-transparent transition-all"
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
            className={`absolute right-2 bottom-2 p-2 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 flex items-center justify-center overflow-hidden ${
              isLoading
                ? "bg-red-500 hover:bg-red-600 shadow-glow shadow-red-500/50"
                : "bg-blue-600 hover:bg-blue-700 hover:shadow-glow"
            }`}
          >
            {isLoading && (
              <div className="absolute inset-0 border-2 border-t-white/80 border-white/20 rounded-lg animate-spin"></div>
            )}
            {isLoading ? (
              <Square size={16} fill="currentColor" className="relative z-10" />
            ) : (
              <Send size={16} className="relative z-10 translate-x-[-1px] translate-y-[1px]" />
            )}
          </button>
        </form>
        <div className="text-center mt-3">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">
            内容由 LLM 服务提供。生成内容仅供参考。
          </p>
        </div>
      </div>

      {isGeoModalOpen && (
        <Suspense fallback={null}>
          <McpGeoModal
            isOpen={isGeoModalOpen}
            onClose={() => setIsGeoModalOpen(false)}
            currentCity={settings.mcpUserCity}
            onChange={handleSetMcpUserCity}
          />
        </Suspense>
      )}
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
      // No `relative` here on purpose — the popover below anchors to the
      // toolbar row (which IS relative) so it spans toolbar width on
      // narrow screens and never overflows the viewport. Anchoring to the
      // 32-px button wrapper would force `right-0 + w-72` to extend 288px
      // leftward, which clips off-screen the moment the wrapping toolbar
      // pushes a card to the second row at left edge. The ref still
      // captures the wrapper (and its descendant popover) for outside-
      // click detection — that uses DOM containment, not layout.
      <div ref={ref}>
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
          <div className="absolute bottom-full right-0 mb-2 w-72 max-w-full max-h-80 overflow-y-auto rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1A1A1A] shadow-elevation-3 z-30">
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
                    {variant === "llm" && <HealthDot health={m.health} />}
                    <span className="flex-1 min-w-0 flex items-center gap-1.5">
                      <span className="truncate">{m.id}</span>
                      {isActive && (
                        <span className="text-[10px] font-sans flex-shrink-0">
                          当前
                        </span>
                      )}
                    </span>
                    <ReadOnlyCapabilityIcons capabilities={m.capabilities} />
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

// ---------------------------------------------------------------------------
// Health indicator dot — inherits from the provider's health-test results.
// gray = never tested, red = last test failed, green = last test passed.
// We don't probe here; the source of truth is whatever the user ran in the
// 设置 → 模型供应商 → 健康测试 flow, which writes back to ModelEntry.health.
// ---------------------------------------------------------------------------

function HealthDot({ health }: { health?: ModelHealth }) {
  let cls: string;
  let title: string;
  if (!health) {
    cls = "bg-gray-300 dark:bg-gray-600";
    title = "未进行健康测试";
  } else if (health.ok) {
    cls = "bg-emerald-500";
    title =
      health.latencyMs != null ? `连接正常 · ${health.latencyMs}ms` : "连接正常";
  } else {
    cls = "bg-red-500";
    title = `连接失败${health.error ? "：" + health.error : ""}`;
  }
  return (
    <span
      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cls}`}
      title={title}
      aria-label={title}
    />
  );
}

// ---------------------------------------------------------------------------
// Read-only capability badges shown beside each model id in the picker.
// Distinct from LlmProvidersModal's CapabilityIcons (which is interactive
// with tap-to-show tooltips) — here we're inside a parent <button>, so we
// MUST stay non-interactive (nested buttons are invalid HTML). Hover
// tooltip via `title` is enough; mobile users still see the colored
// glyph and can recognize the legend from the management modal.
// ---------------------------------------------------------------------------

function ReadOnlyCapabilityIcons({
  capabilities,
}: {
  capabilities?: ModelCapability[];
}) {
  if (!capabilities || capabilities.length === 0) return null;
  return (
    <span className="inline-flex items-center gap-0.5 flex-shrink-0">
      {capabilities.map((cap) => {
        const meta = CAPABILITY_META[cap];
        const Icon = meta.Icon;
        return (
          <span
            key={cap}
            className={`inline-flex items-center justify-center ${meta.color}`}
            title={meta.label}
            aria-label={meta.label}
          >
            <Icon size={11} />
          </span>
        );
      })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// MCP tools card — popover anchored under the toolbar Wrench button. Shows
// the upstream service health, a geo-settings shortcut, and a per-tool
// toggle list. Per-tool flags live in `settings.mcpToolsEnabled` so the
// user's choices survive across reloads (default-on for unknown keys).
// ---------------------------------------------------------------------------

interface McpToolsCardProps {
  health: McpHealth | null;
  tools: McpTool[];
  isRefreshing: boolean;
  toolsEnabled: Record<string, boolean>;
  currentCity: string | null;
  onToggleTool: (toolName: string, next: boolean) => void;
  onOpenGeoModal: () => void;
}

function McpToolsCard({
  health,
  tools,
  isRefreshing,
  toolsEnabled,
  currentCity,
  onToggleTool,
  onOpenGeoModal,
}: McpToolsCardProps) {
  const isHealthy = health?.ok === true;
  // Health is "unknown" only on the very first probe in flight; once a probe
  // resolves the status is either healthy or unhealthy.
  const isProbing = !health && isRefreshing;

  const dotColor = isProbing
    ? "bg-gray-300 dark:bg-gray-600"
    : isHealthy
      ? "bg-emerald-500"
      : "bg-red-500";

  const statusTitle = isProbing
    ? "正在探测 MCP 服务"
    : isHealthy
      ? `连接正常${health.latencyMs != null ? ` · ${health.latencyMs}ms` : ""}`
      : `连接异常：${health?.error || "未知错误"}`;

  return (
    <div className="absolute bottom-full left-0 mb-2 w-80 max-w-full rounded-xl border border-gray-200 dark:border-white/10 bg-white dark:bg-[#1A1A1A] shadow-elevation-3 z-30 overflow-hidden">
      {/* Service header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-white/5 bg-gray-50/70 dark:bg-black/20">
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor} ${
            isProbing ? "animate-pulse" : ""
          }`}
          title={statusTitle}
          aria-label={statusTitle}
        />
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex-1 truncate">
          NyaaChat-MCP
        </span>
        {isRefreshing && (
          <span className="text-[10px] text-gray-500 dark:text-gray-400">
            探测中…
          </span>
        )}
      </div>

      {/* Geo settings entry */}
      <button
        type="button"
        onClick={onOpenGeoModal}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100 dark:border-white/5 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <MapPin size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <span className="text-xs font-medium text-gray-800 dark:text-gray-200">
            地理信息
          </span>
        </span>
        <span className="text-[11px] text-gray-500 dark:text-gray-400 truncate max-w-[140px]">
          {currentCity ?? "未设置"}
        </span>
      </button>

      {/* Tools list. Hidden when MCP is unreachable so the user can't toggle
          flags that won't take effect anyway. */}
      {isHealthy ? (
        tools.length === 0 ? (
          <div className="px-4 py-6 text-xs text-center text-gray-500 dark:text-gray-400">
            {isRefreshing ? "正在加载工具列表…" : "未发现可用工具"}
          </div>
        ) : (
          <ul className="py-1">
            {tools.map((tool) => {
              const enabled = toolsEnabled[tool.name] !== false;
              return (
                <li
                  key={tool.name}
                  className="flex items-center justify-between gap-3 px-3 py-2 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                      {tool.title}
                    </div>
                    <div
                      className="text-[11px] text-gray-500 dark:text-gray-400 truncate"
                      title={tool.description}
                    >
                      {tool.name}
                    </div>
                  </div>
                  <ToggleSwitch
                    checked={enabled}
                    onChange={(next) => onToggleTool(tool.name, next)}
                    label={enabled ? "已启用" : "已禁用"}
                  />
                </li>
              );
            })}
          </ul>
        )
      ) : (
        <div className="px-4 py-6 text-[11px] text-center text-gray-500 dark:text-gray-400">
          MCP 服务暂不可用
          {health?.error ? (
            <div className="mt-1 text-gray-400 dark:text-gray-500 truncate">
              {health.error}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
