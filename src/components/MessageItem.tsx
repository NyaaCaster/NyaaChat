import React, { useState } from "react";
import Markdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Message } from "../types";
import { motion } from "motion/react";
import { Copy, Check, Trash2, RefreshCw } from "lucide-react";

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
}

export const MessageItem = React.memo(function MessageItem({ message, userName, charName, onDelete, onRegenerate }: MessageItemProps) {
  const [copiedMsg, setCopiedMsg] = useState(false);
  const handleCopyMsg = async () => {
    const ok = await copyToClipboard(message.content);
    if (!ok) return;
    setCopiedMsg(true);
    setTimeout(() => setCopiedMsg(false), 2000);
  };
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  // Cache the normalized markdown so streaming siblings re-rendering doesn't
  // make THIS message re-parse its body. Reparsing is the dominant cost
  // during a long stream when every chunk causes a parent setMessages.
  const normalizedContent = React.useMemo(
    () => normalizeMarkdown(message.content || "..."),
    [message.content],
  );

  if (isSystem) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex justify-center my-6"
      >
        <div className="bg-gray-100 dark:bg-white/5 text-gray-500 dark:text-gray-400 text-xs px-4 py-1.5 rounded-full max-w-[80%] text-center border border-gray-200 dark:border-white/5 backdrop-blur-sm">
          <span className="font-semibold text-gray-700 dark:text-gray-300">
            System:{" "}
          </span>
          {message.content.length > 50
            ? message.content.substring(0, 50) + "..."
            : message.content}
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
      initial={{ opacity: 0, y: 15, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={`flex w-full my-4 ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[85%] sm:max-w-[80%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
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
            <Markdown
              rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
              components={{
                p: ({ children }) => <p>{renderTextWithQuotes(children)}</p>,
                li: ({ children }) => <li>{renderTextWithQuotes(children)}</li>,
                pre: ({ children }) => {
                  const code = React.Children.toArray(children).map(c =>
                    typeof c === "object" && "props" in c ? (c as any).props.children : c
                  ).join("");
                  return <CodeBlock>{code}</CodeBlock>;
                },
              }}
            >{normalizedContent}</Markdown>
          </div>
        </div>
      </div>
      <div className={`flex items-center gap-1 px-1 ${isUser ? "justify-end" : "justify-start"}`}>
        {!isUser && onRegenerate && (
          <button onClick={() => onRegenerate(message.id)} className="p-1 text-gray-400 hover:text-green-500 transition-colors rounded" title="重新生成">
            <RefreshCw size={13} />
          </button>
        )}
        <button onClick={handleCopyMsg} className="p-1 text-gray-400 hover:text-blue-500 transition-colors rounded" title="复制文本">
          {copiedMsg ? <Check size={13} /> : <Copy size={13} />}
        </button>
        {onDelete && (
          <button onClick={() => { if (window.confirm("确定要删除这条消息吗？")) onDelete(message.id); }} className="p-1 text-gray-400 hover:text-red-500 transition-colors rounded" title="删除消息">
            <Trash2 size={13} />
          </button>
        )}
      </div>
      </div>
    </motion.div>
  );
});
