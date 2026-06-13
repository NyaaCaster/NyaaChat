import React, { useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Message } from "../types";
import { motion } from "motion/react";
import { Copy, Check, Trash2, RefreshCw, Pencil, X as XIcon, ImagePlus, Download, Loader2 } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { ImageViewerModal } from "./ImageViewerModal";
import { downloadImage } from "../lib/imageApi";
import { applyPlaceholders } from "../lib/chatPipeline";
import { getRegexedString, regex_placement, FrontendCard, splitFrontendContent } from "../compat";
import type { RegexScript } from "../types";

// rehype-sanitize schema: GitHub-flavored default + className passthrough so
// our prose/markdown-body styles still apply. Anything not in the allowlist
// (script, iframe, on*, javascript: URLs) is dropped.
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": [...(defaultSchema.attributes?.["*"] || []), "className"],
  },
};

// navigator.clipboard requires a secure context (HTTPS or localhost). When the
// app is served from a plain-HTTP IP/host, the modern API is unavailable, so
// we fall back to a hidden-textarea + execCommand path that still works there.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.left = "-9999px";
    ta.setAttribute("readonly", "");
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    const ok = await copyToClipboard(children);
    if (!ok) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 p-1.5 rounded-md bg-white/10 hover:bg-white/20 text-gray-400 hover:text-gray-100 transition-colors"
        title="复制代码"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      <pre><code>{children}</code></pre>
    </div>
  );
}

function normalizeMarkdown(text: string): string {
  return text
    .replace(/(\S)\n(#{1,6} )/g, '$1\n\n$2')
    .replace(/(\S)\n(> )/g, '$1\n\n$2')
    .replace(/(\S)\n([-*+] )/g, '$1\n\n$2')
    // Split inline "> " separators into real blockquote lines
    .replace(/(`[^`]*)` > /g, '$1`\n> ');
}

const QUOTE_RE = /("[^"]*?"|'[^']*?'|“[^”]*?”|‘[^’]*?’|「[^」]*?」|『[^』]*?』|【[^】]*?】|《[^》]*?》)/g;

function highlightQuotes(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  QUOTE_RE.lastIndex = 0;
  while ((match = QUOTE_RE.exec(text)) !== null) {
    if (match.index > last) result.push(text.slice(last, match.index));
    result.push(<span key={match.index} className="quote-highlight">{match[0]}</span>);
    last = match.index + match[0].length;
  }
  if (last < text.length) result.push(text.slice(last));
  return result;
}

function renderTextWithQuotes(children: React.ReactNode): React.ReactNode {
  if (typeof children === "string") return highlightQuotes(children);
  if (Array.isArray(children)) return children.map((c, i) =>
    typeof c === "string" ? <React.Fragment key={i}>{highlightQuotes(c)}</React.Fragment> : c
  );
  return children;
}

interface MessageItemProps {
  message: Message;
  userName?: string;
  charName?: string;
  onDelete?: (id: string) => void;
  onRegenerate?: (id: string) => void;
  onEdit?: (id: string, newContent: string) => void;
  /** Show the "generate image" button on this bubble. Hidden when undefined. */
  onGenerateImage?: (id: string) => void;
  /** Re-runs image generation for an image-message bubble. */
  onRegenerateImage?: (id: string) => void;
  /** True while THIS bubble is awaiting the image API response. */
  imageGenerating?: boolean;
  /** True while ANY chat / image request is in flight. Disables generate &
   *  regenerate buttons across all bubbles so clicks don't get silently
   *  dropped by the parent's loading guard. */
  busy?: boolean;
  /** Effective regex scripts (global + character), pre-filtered to enabled.
   *  Applied on the DISPLAY pipeline (isMarkdown) before rendering. The parent
   *  memoizes the array so passing it doesn't break MessageItem's memo. */
  regexScripts?: RegexScript[];
  /** Floor number = index in the rendered message list. Passed by the parent
   *  (authoritative, always defined) rather than read from message.mesid, which
   *  the store assigns to its own copy and isn't echoed back into React state.
   *  Used for the data-mesid attribute and the FrontendCard iframe id. */
  mesid?: number;
  /** Controls NyaaChat's native JS-Slash-Runner-style iframe renderer. */
  frontendRenderingEnabled?: boolean;
}

export const MessageItem = React.memo(function MessageItem({
  message,
  userName,
  charName,
  onDelete,
  onRegenerate,
  onEdit,
  onGenerateImage,
  onRegenerateImage,
  imageGenerating,
  busy,
  regexScripts,
  mesid,
  frontendRenderingEnabled = true,
}: MessageItemProps) {
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [viewerOpen, setViewerOpen] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  // Resolve {{user}} / {{char}} for display. Fallbacks mirror the send path
  // (ChatInterface) so a placeholder renders the same name that would be sent.
  const resolvedUser = userName || "user";
  const resolvedChar = charName || "AI助手";

  // Refresh the editing buffer when the underlying message changes from
  // outside (e.g. streaming finished after a regenerate). Only resync while
  // not actively editing — otherwise the user's in-flight changes would
  // get clobbered.
  useEffect(() => {
    if (!editing) setEditValue(message.content);
  }, [message.content, editing]);

  // Auto-focus the textarea when entering edit mode.
  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.setSelectionRange(editRef.current.value.length, editRef.current.value.length);
    }
  }, [editing]);

  const handleCopyMsg = async () => {
    // Copy what the user sees (placeholders resolved), not the raw source.
    const ok = await copyToClipboard(
      applyPlaceholders(message.content, resolvedUser, resolvedChar),
    );
    if (!ok) return;
    setCopiedMsg(true);
    setTimeout(() => setCopiedMsg(false), 2000);
  };

  const handleStartEdit = () => {
    setEditValue(message.content);
    setEditing(true);
  };

  const handleSaveEdit = () => {
    const trimmed = editValue;
    if (trimmed === message.content) {
      setEditing(false);
      return;
    }
    onEdit?.(message.id, trimmed);
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditValue(message.content);
    setEditing(false);
  };

  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  // Run the display-regex pass once; reuse it for both front-end-card
  // detection and markdown rendering. Regex sees the raw source (capture groups
  // operate on the original text, before name substitution).
  const regexedContent = React.useMemo(() => {
    const raw = message.content || "...";
    const placement =
      message.role === "user" ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
    return regexScripts && regexScripts.length
      ? getRegexedString(raw, placement, regexScripts, { isMarkdown: true })
      : raw;
  }, [message.content, message.role, regexScripts]);

  // Front-end card: render fenced HTML card blocks in iframes, while preserving
  // surrounding prose as normal Markdown. Only assistant/non-edit bubbles are
  // candidates — user input and the edit textarea always stay plain. Image
  // bubbles are never cards.
  const frontendParts = React.useMemo(() => {
    if (!frontendRenderingEnabled || message.imageUrl || message.role === "user") return null;
    return splitFrontendContent(regexedContent);
  }, [frontendRenderingEnabled, regexedContent, message.imageUrl, message.role]);

  // Markdown view (when not a card). Placeholders then normalize.
  const normalizedContent = React.useMemo(
    () => normalizeMarkdown(applyPlaceholders(regexedContent, resolvedUser, resolvedChar)),
    [regexedContent, resolvedUser, resolvedChar],
  );

  if (isSystem) {
    const systemText = applyPlaceholders(message.content, resolvedUser, resolvedChar);
    return (
      <motion.div
        data-mesid={mesid}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-center my-6"
      >
        <div className="bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 text-xs px-4 py-1.5 rounded-full max-w-[80%] text-center border border-gray-200 dark:border-white/5 backdrop-blur-sm">
          <span className="font-semibold text-gray-700 dark:text-gray-300">
            System:{" "}
          </span>
          {systemText.length > 50
            ? systemText.substring(0, 50) + "..."
            : systemText}
        </div>
      </motion.div>
    );
  }

  const formatTime = (ts?: number) => {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const timeStr = formatTime(message.timestamp);

  return (
    <motion.div
      data-mesid={mesid}
      initial={{ opacity: 0, y: 15, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={`flex w-full my-4 ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[92%] sm:max-w-[80%] min-w-0 flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`w-full rounded-2xl px-5 py-4 bg-white dark:bg-[#111111] text-gray-900 dark:text-gray-100 shadow-elevation-1 ${
          isUser
            ? "rounded-tr-sm self-end border border-blue-500"
            : "rounded-tl-sm border border-gray-100 dark:border-white/5"
        }`}
      >
        <div
          className={`mb-2 space-y-1 ${isUser ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"}`}
        >
          {isUser ? (
            <div className="flex flex-col items-start gap-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider">
                {userName || "You"}
              </div>
              {(timeStr || message.tokenCount !== undefined) && (
                <div className="flex items-center gap-2">
                  {timeStr && (
                    <span className="text-[10px] opacity-70">{timeStr}</span>
                  )}
                  {message.tokenCount !== undefined && (
                    <span className="text-[10px] opacity-70 border border-blue-200 dark:border-blue-800 rounded px-1">
                      {message.tokenCount} tokens
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-start gap-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                <span style={{ fontFamily: "var(--font-display)" }}>
                  {charName || "Assistant"}
                </span>
              </div>
              {(timeStr || message.tokenCount !== undefined) && (
                <div className="flex items-center gap-2">
                  {timeStr && (
                    <span className="text-[10px] opacity-70">{timeStr}</span>
                  )}
                  {message.tokenCount !== undefined && (
                    <span className="text-[10px] opacity-70 border border-gray-200 dark:border-gray-700 rounded px-1">
                      {message.tokenCount} tokens
                    </span>
                  )}
                  {message.model && (
                    <span className="text-[10px] opacity-70 border border-gray-200 dark:border-gray-700 rounded px-1">
                      {message.model}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        <div
          className={`prose prose-sm md:prose-base max-w-none prose-p:leading-relaxed prose-pre:bg-gray-900 prose-pre:text-gray-100 dark:prose-invert ${isUser ? "prose-a:text-blue-600 dark:prose-a:text-blue-400" : ""}`}
        >
          <div
            className="markdown-body"
            style={{ fontFamily: "var(--font-sans)" }}
          >
            {message.imageUrl ? (
              <ImageBubbleBody
                src={message.imageUrl}
                generating={!!imageGenerating}
                onOpen={() => setViewerOpen(true)}
              />
            ) : editing ? (
              <div className="flex flex-col gap-2">
                <textarea
                  ref={editRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      handleSaveEdit();
                    } else if (e.key === "Escape") {
                      e.preventDefault();
                      handleCancelEdit();
                    }
                  }}
                  rows={Math.min(20, Math.max(4, editValue.split("\n").length + 1))}
                  className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow resize-y"
                />
                <div className="flex items-center justify-end gap-2 text-xs">
                  <span className="text-gray-400 dark:text-gray-500 mr-auto">Ctrl/⌘ + Enter 保存，Esc 取消</span>
                  <button
                    onClick={handleCancelEdit}
                    className="px-3 py-1 text-gray-600 dark:text-gray-300 bg-gray-100 hover:bg-gray-200 dark:bg-white/5 dark:hover:bg-white/10 rounded-md transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSaveEdit}
                    className="px-3 py-1 text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                  >
                    保存
                  </button>
                </div>
              </div>
            ) : frontendParts ? (
              <>
                {frontendParts.map((part, partIndex) =>
                  part.type === "card" ? (
                    <FrontendCard
                      key={`card-${part.index}`}
                      html={part.html}
                      mesid={mesid}
                      index={part.index}
                    />
                  ) : part.content.trim() ? (
                    <Markdown
                      key={`md-${partIndex}`}
                      rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
                      components={{
                        p: ({ children }) => <p>{renderTextWithQuotes(children)}</p>,
                        li: ({ children }) => <li>{renderTextWithQuotes(children)}</li>,
                        a: ({ children, ...props }) => (
                          <a {...props} target="_blank" rel="noopener noreferrer">
                            {children}
                          </a>
                        ),
                        pre: ({ children }) => {
                          const code = React.Children.toArray(children).map(c =>
                            typeof c === "object" && "props" in c ? (c as any).props.children : c
                          ).join("");
                          return <CodeBlock>{code}</CodeBlock>;
                        },
                      }}
                    >{normalizeMarkdown(applyPlaceholders(part.content, resolvedUser, resolvedChar))}</Markdown>
                  ) : null,
                )}
              </>
            ) : (
              <Markdown
                rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
                components={{
                  p: ({ children }) => <p>{renderTextWithQuotes(children)}</p>,
                  li: ({ children }) => <li>{renderTextWithQuotes(children)}</li>,
                  // Force any link inside chat content (LLM-rendered or user-
                  // pasted) to open in a new tab. rel guards against tabnabbing
                  // and stops the new page from leaking referrer info.
                  a: ({ children, ...props }) => (
                    <a {...props} target="_blank" rel="noopener noreferrer">
                      {children}
                    </a>
                  ),
                  pre: ({ children }) => {
                    const code = React.Children.toArray(children).map(c =>
                      typeof c === "object" && "props" in c ? (c as any).props.children : c
                    ).join("");
                    return <CodeBlock>{code}</CodeBlock>;
                  },
                }}
              >{normalizedContent}</Markdown>
            )}
          </div>
        </div>
      </div>
      <div className={`flex items-center gap-1 px-1 ${isUser ? "justify-end" : "justify-start"}`}>
        {message.imageUrl ? (
          <>
            {onRegenerateImage && (
              <button
                onClick={() => onRegenerateImage(message.id)}
                disabled={busy || imageGenerating}
                className="p-1 text-gray-400 hover:text-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded"
                title={busy && !imageGenerating ? "其他请求进行中" : "重新生成"}
              >
                {imageGenerating ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
              </button>
            )}
            <button
              onClick={() => void downloadImage(message.imageUrl!, `NyaaChat-${message.id}`)}
              className="p-1 text-gray-400 hover:text-blue-500 transition-colors rounded"
              title="下载图片"
            >
              <Download size={13} />
            </button>
            {onDelete && (
              <button
                onClick={() => setConfirmDelete(true)}
                className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded"
                title="删除消息"
              >
                <Trash2 size={13} />
              </button>
            )}
          </>
        ) : (
          <>
            {!editing && !isUser && onRegenerate && (
              <button
                onClick={() => onRegenerate(message.id)}
                disabled={busy}
                className="p-1 text-gray-400 hover:text-green-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded"
                title={busy ? "其他请求进行中" : "重新生成"}
              >
                <RefreshCw size={13} />
              </button>
            )}
            {!editing && onEdit && (
              <button onClick={handleStartEdit} className="p-1 text-gray-400 hover:text-amber-500 transition-colors rounded" title="编辑消息">
                <Pencil size={13} />
              </button>
            )}
            {!editing && onGenerateImage && (
              <button
                onClick={() => onGenerateImage(message.id)}
                disabled={busy || imageGenerating}
                className="p-1 text-gray-400 hover:text-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors rounded"
                title={busy && !imageGenerating ? "其他请求进行中" : "基于此消息生成图片"}
              >
                {imageGenerating ? <Loader2 size={13} className="animate-spin" /> : <ImagePlus size={13} />}
              </button>
            )}
            {!editing && (
              <button onClick={handleCopyMsg} className="p-1 text-gray-400 hover:text-blue-500 transition-colors rounded" title="复制文本">
                {copiedMsg ? <Check size={13} /> : <Copy size={13} />}
              </button>
            )}
            {!editing && onDelete && (
              <button onClick={() => setConfirmDelete(true)} className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded" title="删除消息">
                <Trash2 size={13} />
              </button>
            )}
            {editing && (
              <button onClick={handleCancelEdit} className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded" title="取消编辑">
                <XIcon size={13} />
              </button>
            )}
          </>
        )}
      </div>
      </div>
      {message.imageUrl && (
        <ImageViewerModal
          isOpen={viewerOpen}
          onClose={() => setViewerOpen(false)}
          src={message.imageUrl}
          filename={`NyaaChat-${message.id}`}
        />
      )}
      {onDelete && (
        <ConfirmDialog
          isOpen={confirmDelete}
          title="删除消息"
          message="确定要删除这条消息吗？此操作不可撤销。"
          destructive
          confirmText="删除"
          onConfirm={() => {
            setConfirmDelete(false);
            onDelete(message.id);
          }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </motion.div>
  );
});

function ImageBubbleBody({
  src,
  generating,
  onOpen,
}: {
  src: string;
  generating: boolean;
  onOpen: () => void;
}) {
  const [loaded, setLoaded] = React.useState(false);
  return (
    <div className="not-prose relative">
      <button
        type="button"
        onClick={onOpen}
        className="block group relative overflow-hidden rounded-xl bg-gray-100 dark:bg-white/5 border border-gray-200/50 dark:border-white/10 max-w-full"
        title="点击查看大图"
      >
        <img
          src={src}
          alt="生成图片"
          onLoad={() => setLoaded(true)}
          className={`block max-w-full max-h-[60vh] object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          draggable={false}
        />
        {!loaded && (
          <div className="absolute inset-0 flex items-center justify-center min-h-32 min-w-48 text-gray-400 dark:text-gray-500">
            <Loader2 size={20} className="animate-spin" />
          </div>
        )}
      </button>
      {generating && (
        <div className="absolute inset-0 rounded-xl bg-black/30 backdrop-blur-[1px] flex items-center justify-center text-white text-xs gap-2">
          <Loader2 size={16} className="animate-spin" />
          重新生成中…
        </div>
      )}
    </div>
  );
}
