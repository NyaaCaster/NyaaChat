import React, { useState, useEffect, useRef } from "react";
import Markdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { PluggableList } from "unified";
import { Message } from "../types";
import { motion } from "motion/react";
import { Copy, Check, Trash2, RefreshCw, Pencil, X as XIcon, ImagePlus, Download, Loader2, FileText, Image as ImageIcon } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import { ImageViewerModal } from "./ImageViewerModal";
import { CoverViewerModal } from "./CoverViewerModal";
import { downloadImage } from "../lib/imageApi";
import { applyPlaceholders, getMacroIdentity, syncMacroIdentity } from "../lib/chatPipeline";
import {
  decodeFlagalacUnicodeEscapes,
  encodeFlagalacUnicodeEscapes,
} from "../lib/flagalacUnicode";
import { getRegexedString, regex_placement } from "../lib/regex";
import { setDefaultEnvProvider } from "../lib/regex/macros";
import { FrontendCard, splitFrontendContent } from "../lib/frontendCard";
import type { RegexScript } from "../types";

// ---------------------------------------------------------------------------
// 正则宏的默认 env 注册（宿主侧接线；宏引擎见 src/lib/regex/macros.ts）
//
// 正则脚本的 find / replace 两侧都允许写宏，{{user}} / {{char}} / <USER> / <BOT>
// 需要一个"当前用户 / 当前角色"来源。该来源原由扩展兼容层的安装器注册，随兼容层
// 一并摘除后无人注册 ⇒ 这些宏会保留字面量。这里补上宿主侧注册：
//   · **模块加载时注册一次**（幂等：模块只求值一次，重复导入不会重复挂载）；
//   · provider 每次被调用都通过 `getMacroIdentity()` 读 chatPipeline 的模块级状态，
//     因此拿到的是**实时值而不是渲染快照**（切换用户 / 角色立即生效）；
//   · 本组件渲染期只调用 `syncMacroIdentity(prop, prop)` 把最新值推进去 —— 不改
//     React 状态、不触发重渲染、值没变时直接返回；
//   · 取值语义对齐摘除前的默认宏 env（HEAD `src/compat/index.ts`：
//     `{ user: m.userName ?? "user", char: m.characterName ?? "" }`，其中
//     `m.characterName = currentCharacter?.name ?? null`，故**无角色时 char 为 ""**）：
//     用户名缺失回落到 "user"，角色名缺失为空串 —— **不**用界面展示兜底 "AI助手"
//     （那是 resolvedChar 的展示标签，写进宏语义会与 HEAD 不符）。
//     唯一不可达差异：用户名被显式设成空串时 `||` 给 "user"、HEAD 的 `??` 给 ""
//     （syncMacroIdentity 已把 undefined/null/"" 折叠为空串，无实际观测影响）；
//   · 聊天源（{{lastMessage}} 系）由 chatPipeline 注册，两个注册点各占一个槽位。
// ---------------------------------------------------------------------------

setDefaultEnvProvider(() => {
  const identity = getMacroIdentity();
  return { user: identity.user || "user", char: identity.char };
});

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

const markdownRemarkPlugins: PluggableList = [remarkMath];
const markdownRehypePlugins: PluggableList = [rehypeRaw, rehypeKatex, [rehypeSanitize, sanitizeSchema]];

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

// ─── AnswererFlagalac · 编辑通道（t9 / Q-08 方案 b）──────────────────────────
//
// 落库文本保持模型原文的转义形态（D-27/D-28：下一轮请求把历史原样发出去，读得懂的
// 过滤器会毁掉整个机制）。但编辑框直接显示 `\u5982\u6b64` 没法用，于是编辑通道做
// "显示明文 / 存回转义"：
//   · 进入编辑或重置缓冲 → `toFlagalacEditDisplay`（解码 = 用户所见）；
//   · 保存 → `fromFlagalacEditDisplay`（重新转义后再交给 onEdit）。
// 两者都以 `src/lib/flagalacUnicode.ts` 为**唯一来源**，本组件不自带格式字面量。
//
// 门控（`enabled` = 父级下发的 `decodeFlagalacEscapes`，见 ChatInterface 的
// `isFlagalacUnicodeEncodingEnabled`）为 false 时两个函数都是恒等：模块关闭 /
// 阵地制作关闭时，编辑与保存对文本逐字节不改写（零差异）。
//
// ⚠️ 两条**语义等价变化**（用户拍板接受的代价，复核时不要当成字符损坏）：
//   ① ASCII 转义折叠：`\u0041` → `A`（编码器只转义非 ASCII，所以"解码→重新编码"
//      会把落库文本里本就存在的 ASCII 转义折成真 ASCII；文本语义不变）；
//   ② 十六进制转小写：`\u{1F600}` → `\u{1f600}`（编码器用 `toString(16)`）。
//   外加一条体积变化：重新编码是**全量**转义（只要含非 ASCII 就整条改写），编辑
//   保存后该条 stored 文本会明显变长 —— 语义不变，模型照读。
// 不变量（t14 判据；⚠️ **公式适用域已按 t14 报告的 H4 更正**，规范见 SSOT §8.5 规范三）：
//   · **通用形态**：`decode(encode(x)) === decode(x)` —— 即"编码不改变『解码所见』"。
//     （⚠️ 本注释原文在这里写的是 `=== x`，**那只对明文域成立**；含完整 `\uXXXX` 字面量的输入是反例。）
//   · **明文域**（不含完整 `\uXXXX` 字面量）：`decode(encode(x)) === x`。
//   · **编辑器稳定**：`decode(encode(decode(s))) === decode(s)` 且再套一轮不变。
//   · **两方向互逆**（F16）**只在「规范形态域」成立**（非 ASCII 全转义 + 十六进制小写 + 无冗余 ASCII 转义）；
//     非规范输入（`\u0041`、明文/转义混排等）**不互逆** ⇒ 此时要求是「**往返稳定 + 无字符损坏**」。
//   · **不要**拿 `encode(decode(x)) === x` 当幂等判据 —— 它只对"已是转义形态"的输入成立。

/** 存储形态（转义原文）→ 编辑框显示形态（明文）。未启用时恒等。 */
export function toFlagalacEditDisplay(stored: string, enabled: boolean): string {
  return enabled ? decodeFlagalacUnicodeEscapes(stored) : stored;
}

/** 编辑框显示形态（明文）→ 交给 onEdit 的**存储形态**（重新转义）。未启用时恒等。 */
export function fromFlagalacEditDisplay(display: string, enabled: boolean): string {
  return enabled ? encodeFlagalacUnicodeEscapes(display) : display;
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
  /** Optional live progress text (ComfyUI queue + step %) shown over the
   *  placeholder while THIS bubble renders. Undefined for the OpenAI path. */
  imageProgressText?: string;
  /** t17: transient AnswererFlagalac tool-channel retry notice for THIS bubble
   *  (e.g. "[answerer-flagalac] 第 2/4 次尝试未产出正文（判为失败），正在重试…" or
   *  the terminal "已停止重试"). Rendered in the EMPTY body while the retry
   *  window is open — the console log alone leaves the bubble blank for up to
   *  92 s, which reads as a freeze.
   *
   *  Display-only and never persisted: the parent keeps it in separate React
   *  state (NOT in `message.content` / `messages`), so it cannot reach the
   *  request body or the saved chat. The parent also keys it to the turn's
   *  message id and clears it in sendChat's `finally`, so it cannot paint on
   *  another bubble or survive the turn.
   *
   *  PRIMITIVE on purpose (undefined = no notice, string = notice): the value
   *  is referentially stable when nothing changed, so React.memo keeps skipping
   *  every other bubble; when a notice arrives the string genuinely differs and
   *  the memo correctly re-renders this one. */
  retryNoticeText?: string;
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
   *  Feeds the "#N" badge and the FrontendCard iframe id. */
  mesid?: number;
  /** Controls NyaaChat's native front-end card iframe renderer. */
  frontendRenderingEnabled?: boolean;
  /** AnswererFlagalac `unicodeEncoding` is in effect for this chat (F-2).
   *  Only then may the stored text's `\uXXXX` escapes be decoded for display and
   *  copy — with the option off the stored text must render byte-for-byte
   *  unchanged, exactly as before this module existed. The parent resolves it
   *  from `isFlagalacUnicodeEncodingEnabled(settings.bypass?.answererFlagalac)`
   *  and passes a primitive boolean, so MessageItem's memo is not busted.
   *
   *  Known trade-off (deliberate, t2/F-1 + t1/F-2): gating means history that was
   *  ALREADY stored in escape form while 阵地制作 was on shows as literal `\uXXXX`
   *  after the user switches the option off (the stored bytes are the model's
   *  original text and are never rewritten). We accept that in exchange for the
   *  hard requirement 「未启用时零差异」: an ordinary chat that never enabled the
   *  option must render/copy unchanged (`\u0041` in pasted JSON stays `\u0041`).
   *  Mitigation for a reader who switched it off: re-enable 阵地制作 for that
   *  target and the same history is readable again (nothing was lost).
   *  TODO(t12): register this as a known limitation in the SSOT / 阶段交接.
   *
   *  The same flag also drives the EDIT path (t9, Q-08 方案 b): the textarea shows
   *  the decoded 明文 and a save re-encodes it before handing it to `onEdit`, so the
   *  stored value stays in escape form (the next request's history keeps the
   *  cross-turn protection). With the flag off both paths are no-ops. */
  decodeFlagalacEscapes?: boolean;
  /** Object URL of the active character's cover (512×768). When present and the
   *  bubble is a character (assistant) text bubble, it shows as a feathered
   *  side image on PC and a feathered top-right avatar on mobile, and opens the
   *  cover viewer on click. */
  coverUrl?: string | null;
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
  imageProgressText,
  retryNoticeText,
  busy,
  regexScripts,
  mesid,
  frontendRenderingEnabled = true,
  decodeFlagalacEscapes = false,
  coverUrl,
}: MessageItemProps) {
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(message.content);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [coverViewerOpen, setCoverViewerOpen] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);
  // ─── t24：编辑会话的**门控快照** ─────────────────────────────────────────
  //
  // F-B（t14 反例）：保存时读**当前** prop 的话，"打开编辑（阵地制作 ON）→ 把选项
  // 关掉 → 保存"会让 `editStored` 退化为恒等，把含非 ASCII 的**明文**写进
  // `message.content`（随后经 buildRequestMessages 原样出站，D-27 跨轮防护失效）。
  // 修法：在 `handleStartEdit` 把当轮门控快照进 ref，显示与保存共用这一颗 ——
  // "编辑→保存"因此始终闭合在同一个语义域内。用 ref（不是 state）是为了让
  // 保存发生在同一次事件里也能读到刚写入的值（state 要等下一次渲染）。
  const editGateRef = useRef(decodeFlagalacEscapes);

  // Resolve {{user}} / {{char}} for display. Fallbacks mirror the send path
  // (ChatInterface) so a placeholder renders the same name that would be sent.
  const resolvedUser = userName || "user";
  const resolvedChar = charName || "AI助手";
  // Role flags are read by the edit channel (t24/F-A role split) as well as by the
  // render/button sections below, so they are resolved once, early, and reused.
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  // 正则宏上下文（注册见本文件顶部的 setDefaultEnvProvider 块）：把**实时身份**推进
  // chatPipeline 的模块级状态，使正则脚本 find / replace 里的 {{user}} / {{char}}
  // （及 <USER> / <BOT>）在**显示通道**也解析成真实名字；提示词通道的同一份身份由
  // chatPipeline 在组装请求时推进。
  // 传原始 prop（undefined 视为空）而不是上面的 resolvedUser / resolvedChar 展示兜底值，
  // 以免把展示用兜底写进宏语义。渲染期写入是幂等的：值没变时 sync 直接返回。
  syncMacroIdentity(userName, charName);

  // ─── AnswererFlagalac · 编辑通道（t9 / Q-08 方案 b；语义与代价见文件顶部的
  // `toFlagalacEditDisplay` 注释块）────────────────────────────────────────
  //
  // 编辑缓冲一律是**显示形态（明文）**；转义只发生在保存那一刻。
  //
  // 门控一律取**编辑会话快照** `editGateRef.current`（t24 / F-B），不再直接读当前
  // prop —— 否则编辑期间翻转选项会改变保存语义。未进入编辑时快照无意义，但 save
  // 只可能在编辑会话内发生。
  //
  // F-A（t14 反例）：**用户自己的消息**不进转义通道。D-28 的契约是"界面显示 / 编辑 /
  // 落盘仍是用户原文"，出站那一份才由 chatPipeline 编码。所以保存时按 role 分流：
  //   · role === "user"     → 直接落用户编辑后的**原文**（保持 D-28）；
  //   · role !== "user"     → 写回转义形态（保住助手历史的跨轮防护）。
  // 分流用 `isUser`（下面 `message.role === "user"` 的那颗布尔），与渲染/按钮同源。
  const editDisplay = (stored: string) =>
    toFlagalacEditDisplay(stored, decodeFlagalacEscapes);
  const editStored = (display: string) =>
    fromFlagalacEditDisplay(display, editGateRef.current);

  // Refresh the editing buffer when the underlying message changes from
  // outside (e.g. streaming finished after a regenerate). Only resync while
  // not actively editing — otherwise the user's in-flight changes would
  // get clobbered. t9: the buffer holds the DISPLAY form (明文) when the
  // unicodeEncoding gate is on, so an option flip must re-sync it too.
  useEffect(() => {
    if (!editing) {
      setEditValue(
        toFlagalacEditDisplay(message.content, decodeFlagalacEscapes),
      );
    }
  }, [message.content, editing, decodeFlagalacEscapes]);

  // Auto-focus the textarea when entering edit mode.
  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.setSelectionRange(editRef.current.value.length, editRef.current.value.length);
    }
  }, [editing]);

  const handleCopyMsg = async () => {
    // Copy what the user sees: placeholders resolved AND, when AnswererFlagalac's
    // unicodeEncoding option is in effect, the model's `\uXXXX` escapes decoded
    // (the stored text keeps them deliberately — see decodeFlagalacUnicodeEscapes).
    // F-2: the decode is GATED — with the option off the copied text is the stored
    // text byte-for-byte.
    const ok = await copyToClipboard(
      applyPlaceholders(
        (decodeFlagalacEscapes ? decodeFlagalacUnicodeEscapes(message.content) : message.content),
        resolvedUser,
        resolvedChar,
      ),
    );
    if (!ok) return;
    setCopiedMsg(true);
    setTimeout(() => setCopiedMsg(false), 2000);
  };

  const handleStartEdit = () => {
    // t24/F-B: snapshot the gate for this edit session BEFORE anything else, so
    // display and save share one semantic domain even if the option is toggled
    // while the textarea is open.
    editGateRef.current = decodeFlagalacEscapes;
    // 显示形态（明文）进缓冲 —— 与渲染 / 复制看到的一致。
    setEditValue(toFlagalacEditDisplay(message.content, editGateRef.current));
    setEditing(true);
  };

  const handleSaveEdit = () => {
    // t24/F-A: role split. A USER message stays the user's literal text (SSOT
    // D-28: 界面显示/编辑/落盘仍是用户原文 — only the OUTBOUND copy is encoded
    // by chatPipeline). Any other role goes back to escape form so the model's
    // history keeps the cross-turn protection (D-27).
    // t24/F-B: the escape decision uses `editGateRef.current` (snapshot taken in
    // handleStartEdit), never the live prop, so flipping the option mid-edit
    // cannot degrade this into "write plaintext into a persisted field".
    const stored = isUser ? editValue : editStored(editValue);
    if (stored === message.content) {
      setEditing(false);
      return;
    }
    onEdit?.(message.id, stored);
    setEditing(false);
  };

  const handleCancelEdit = () => {
    setEditValue(editDisplay(message.content));
    setEditing(false);
  };

  // Run the display-regex pass once; reuse it for both front-end-card
  // detection and markdown rendering. Regex sees the raw source (capture groups
  // operate on the original text, before name substitution).
  //
  // AnswererFlagalac (unicodeEncoding, plan A): the STORED text keeps the
  // model's `\uXXXX` escapes on purpose — it is what the next request sends as
  // history, and an upstream filter that can read it defeats the option. The
  // decode therefore happens here, for display only (and for copy above).
  //
  // F-2: gated by the parent's `decodeFlagalacEscapes` (resolved from
  // `isFlagalacUnicodeEncodingEnabled`). With the option off this is a no-op —
  // a literal `\uXXXX` in an ordinary chat (JSON, regex, code) renders unchanged.
  const regexedContent = React.useMemo(() => {
    const raw =
      (decodeFlagalacEscapes ? decodeFlagalacUnicodeEscapes(message.content) : message.content) ||
      "...";
    const placement =
      message.role === "user" ? regex_placement.USER_INPUT : regex_placement.AI_OUTPUT;
    return regexScripts && regexScripts.length
      ? getRegexedString(raw, placement, regexScripts, { isMarkdown: true })
      : raw;
  }, [message.content, message.role, regexScripts, decodeFlagalacEscapes]);

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
  const hasUserAttachments = isUser && (message.attachments?.length ?? 0) > 0;

  // Character cover decoration: only on assistant TEXT bubbles (not user, not
  // system — those return early above — not image bubbles, not while editing).
  const showCover = !isUser && !message.imageUrl && !editing && !!coverUrl;

  return (
    <motion.div
      initial={{ opacity: 0, y: 15, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className={`flex w-full max-w-3xl lg:max-w-[60rem] mx-auto my-4 ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div className={`max-w-[100%] min-w-0 flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`relative w-full overflow-hidden rounded-2xl px-5 py-4 bg-white dark:bg-[#111111] text-gray-900 dark:text-gray-100 shadow-elevation-1 ${
          isUser
            ? "rounded-tr-sm self-end border border-blue-500"
            : "rounded-tl-sm border border-gray-100 dark:border-white/5"
        } ${showCover ? "cover-host" : ""}`}
      >
        {/* PC: portrait cover pinned to the bubble's top-right corner. Width
            fills its reserved column (w-48); height is the 2:3 aspect of the
            512×768 cover (aspect-[2/3]) and is CAPPED there — top-anchored, so a
            very tall bubble does NOT stretch/over-crop the cover (it stays 192×
            288 at the top). A short bubble clips it via the bubble's
            overflow-hidden, showing the top/face (spec: chatbox-pc2). Visibility
            via the app-private `.cover-side` class (index.css), not Tailwind
            `hidden lg:block`: the cover must not be clobbered by any stylesheet
            injected into the main document, and an app-private class plus
            `!important` is the one form no injected CSS can target.
            The bubble's `cover-host` reserves the right column so prose never
            overlaps the cover. */}
        {showCover && (
          <button
            type="button"
            onClick={() => setCoverViewerOpen(true)}
            className="cover-side absolute top-0 right-0 w-48 aspect-[2/3] cover-side-mask"
            title="查看角色封面"
          >
            <img
              src={coverUrl!}
              alt="角色封面"
              className="absolute inset-0 w-full h-full object-cover object-top"
              draggable={false}
            />
          </button>
        )}
        {/* Mobile portrait: a LARGE cover flush to the bubble's top-right
            corner. Uses float (not absolute) so the message text reflows AROUND
            it — the header sits to its left and the body is pushed BELOW it (via
            clear-right on the prose). Negative margins cancel the bubble padding
            so it bleeds to the corner; the bubble's rounded overflow-hidden clips
            it. Feathered on its left/bottom edges. Hidden on lg+ where the side
            strip takes over. */}
        {showCover && (
          <button
            type="button"
            onClick={() => setCoverViewerOpen(true)}
            className="cover-avatar float-right -mt-4 -mr-5 mb-2 ml-3 w-[44%] max-w-[210px] aspect-[5/4] cover-avatar-mask"
            title="查看角色封面"
          >
            <img src={coverUrl!} alt="角色封面" className="w-full h-full object-cover object-top" draggable={false} />
          </button>
        )}
        <div
          className={`mb-2 space-y-1 ${isUser ? "text-blue-600 dark:text-blue-400" : "text-gray-500 dark:text-gray-400"}`}
        >
          {isUser ? (
            <div className="flex flex-col items-start gap-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider">
                {userName || "You"}
              </div>
              {(timeStr || message.tokenCount !== undefined || mesid !== undefined) && (
                <div className="flex items-center gap-2">
                  {mesid !== undefined && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">#{mesid}</span>
                  )}
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
              {(timeStr || message.tokenCount !== undefined || mesid !== undefined) && (
                <div className="meta-row flex flex-col lg:flex-row lg:items-center gap-1 lg:gap-2">
                  <div className="flex items-center gap-2">
                    {mesid !== undefined && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400">#{mesid}</span>
                    )}
                    {timeStr && (
                      <span className="text-[10px] opacity-70">{timeStr}</span>
                    )}
                  </div>
                  {(message.tokenCount !== undefined || message.model) && (
                    <div className="flex items-center gap-2">
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
          )}
        </div>
        <div
          className={`prose prose-sm md:prose-base max-w-none prose-p:leading-relaxed prose-pre:bg-gray-900 prose-pre:text-gray-100 dark:prose-invert ${showCover ? "lg:clear-none clear-right" : ""} ${isUser ? "prose-a:text-blue-600 dark:prose-a:text-blue-400" : ""}`}
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
            ) : imageGenerating ? (
              <div className="flex items-center gap-2 py-6 px-2 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 size={16} className="animate-spin text-purple-500" />
                <span>正在生成图片…</span>
                {imageProgressText && (
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {imageProgressText}
                  </span>
                )}
              </div>
            ) : retryNoticeText && !message.content.trim() ? (
              // t17: AnswererFlagalac tool-channel retry window. The retry loop
              // buffers every attempt, so the body is genuinely empty here and
              // the user would otherwise stare at a blank bubble for up to 92 s.
              // Same structure/classes as the "正在生成图片…" row above — no new
              // visual vocabulary, no new colour.
              //
              // Deliberately nested inside the markdown body container (NOT as a
              // sibling of the prose div) so it appears where the text would
              // have been: with no content yet the prose wrapper has no margins
              // of its own, so the row sits higher up (directly under the header)
              // exactly like the image row does — i.e. visible without scrolling.
              //
              // Once real text exists the body renders normally instead (the
              // notice is suppressed, not stacked) — the F-4 terminal notice
              // "已停止重试" accompanies the flushed last-attempt text and is
              // still delivered to the console log.
              <div className="flex items-center gap-2 py-6 px-2 text-sm text-gray-500 dark:text-gray-400">
                <Loader2 size={16} className="animate-spin text-purple-500" />
                <span>{retryNoticeText}</span>
              </div>
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
                      remarkPlugins={markdownRemarkPlugins}
                      rehypePlugins={markdownRehypePlugins}
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
                remarkPlugins={markdownRemarkPlugins}
                rehypePlugins={markdownRehypePlugins}
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
            {hasUserAttachments && !editing && (
              <UserAttachmentList attachments={message.attachments!} />
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
      {showCover && coverUrl && (
        <CoverViewerModal
          isOpen={coverViewerOpen}
          onClose={() => setCoverViewerOpen(false)}
          src={coverUrl}
          alt={charName}
        />
      )}
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

function UserAttachmentList({
  attachments,
}: {
  attachments: NonNullable<Message["attachments"]>;
}) {
  return (
    <div className="not-prose mt-3 space-y-2">
      <div className="flex flex-wrap gap-2">
        {attachments.map((att, i) => (
          <div
            key={`${att.name}-${i}`}
            className="flex items-center gap-1.5 px-2 py-1 bg-white/70 dark:bg-white/10 border border-gray-200 dark:border-white/10 rounded-lg text-xs text-gray-700 dark:text-gray-300"
          >
            {att.type === "image" ? (
              <ImageIcon size={12} className="text-blue-500" />
            ) : (
              <FileText size={12} className="text-gray-400" />
            )}
            <span className="max-w-[140px] truncate">{att.name}</span>
          </div>
        ))}
      </div>
      {attachments.some((att) => att.type === "image") && (
        <div className="grid gap-2 sm:grid-cols-2">
          {attachments.map((att, i) =>
            att.type === "image" ? (
              <img
                key={`${att.name}-preview-${i}`}
                src={`data:${att.mimeType};base64,${att.data}`}
                alt={att.name}
                className="max-h-80 max-w-full rounded-xl border border-gray-200/70 dark:border-white/10 bg-gray-100 dark:bg-white/5 object-contain"
                draggable={false}
              />
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}

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
    <div className="not-prose">
      <div className="relative">
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
      <p className="mt-1.5 text-[11px] italic text-gray-400 dark:text-gray-500 max-w-full">
        如果生成图片与情景不符，是提示词生成未通过LLM的违禁内容审查。
      </p>
    </div>
  );
}
