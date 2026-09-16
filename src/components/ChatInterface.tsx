import React, { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { ApiSettings, Message, AppState, LogEntry, ChatSession } from "../types";
import { fetchChatCompletion, type ApiMessage, type LlmTool, type ToolExecutor } from "../lib/api";
import { generateImage } from "../lib/imageApi";
import { generateComfyImage, type ComfyProgress } from "../lib/comfyuiApi";
import { newId } from "../lib/id";
import { saveSession, loadSessions } from "../lib/sessionStorage";
import { setVariableAdapter } from "../lib/variables";
import type { MessagePatch } from "../lib/variables";
import { getScriptInitBusy } from "../plugins/scriptHost";
import { getActiveImageProvider, getActiveLlmProvider, imageProviderToApiSettings, providerToApiSettings } from "../lib/providers";
import { searchWeb, WebSearchError, WEB_SEARCH_FEATURE_ENABLED } from "../lib/searchApi";
import { searchKb } from "../lib/knowledgeApi";
import { fetchT2iAgentPrompt } from "../lib/t2iAgentApi";
import { loadStoredAccount, consumeComfyuiPack, type StoredAccount } from "../lib/sharedAccountApi";
import { callTool, listTools, mergeUserCity, filterAdvertised } from "../lib/mcpApi";
import { computeContextBudget } from "../lib/contextBudget";
import {
  type ExtractionState,
  runExtraction,
  parseExtraction,
  selectExtractionRange,
  estimateExtractionCost,
  RECOMPRESS_SYSTEM_PROMPT,
  selectBatchesToMerge,
} from "../lib/memoryExtraction";
import {
  ingestMemory,
  searchMemory,
  listMemoryBatches,
  recompressMemory,
} from "../lib/knowledgeApi";
import {
  applyPlaceholders,
  buildComfyPromptRequest,
  buildFixedComfyPromptRequest,
  buildFlagalacTraceDisplayScripts,
  buildVariableUpdateHiddenDisplayScripts,
  buildImagePrompt,
  buildKbSearchContext,
  buildMessageContent,
  buildRequestMessages,
  buildMemoryContext,
  buildSearchContext,
  collectLinkedKbIds,
  getActivatedKeywordRules,
  isFlagalacTraceCleanupEnabled,
  isFlagalacUnicodeEncodingEnabled,
} from "../lib/chatPipeline";
import { nextBatchSeq, findBoundaryIndex } from "../lib/memoryBoundary";
import { getEffectiveRegexScripts, subscribeRegexScripts } from "../lib/regex";
import { MessageItem } from "./MessageItem";
import { ChatHeader } from "./ChatHeader";
import { ChatComposer } from "./ChatComposer";
import MemoryDivider from "./MemoryDivider";
import { motion, AnimatePresence } from "motion/react";
import { useFullscreen } from "../hooks/useFullscreen";
import { UserAccountModal } from "./UserAccountModal";
import { ConfirmDialog } from "./ConfirmDialog";
import { useAttachments } from "../hooks/useAttachments";
import { useCoverObjectUrl } from "../hooks/useCoverObjectUrl";

/**
 * Map a thrown error from the API layer to a user-friendly Chinese message.
 * Recognizes HTTP status codes (via ApiHttpError.status), AbortController
 * timeouts, and the network-level browser strings that indicate a CORS or
 * DNS / TLS failure.
 */
/**
 * Format transient ComfyUI progress for the generating bubble. Returns e.g.
 * "排队 2 · 进度 60%". Empty parts are dropped; null/undefined yields a neutral
 * "生成中…".
 */
function formatComfyProgress(p: ComfyProgress | null | undefined): string {
  if (!p) return "生成中…";
  const parts: string[] = [];
  if (typeof p.queueRemaining === "number") parts.push(`排队 ${p.queueRemaining}`);
  if (typeof p.percent === "number") parts.push(`进度 ${p.percent}%`);
  return parts.length > 0 ? parts.join(" · ") : "生成中…";
}

function describeError(err: any): string {
  if (!err) return "未知错误";
  const status = err?.status;
  if (typeof status === "number") {
    if (status === 401) return "API Key 无效或已失效 (401)";
    if (status === 403) return "没有访问权限,请检查 Key 与模型 (403)";
    if (status === 404) return "接口或模型不存在,请检查 Base URL/模型名 (404)";
    if (status === 429) return "触发速率限制或额度不足 (429)";
    if (status >= 500) return `上游服务异常 (${status})，建议 API 恢复后重发`;
  }
  const msg = err?.message || String(err);
  if (/timeout|超时/i.test(msg)) return "请求超时,请检查网络或代理设置";
  if (/Failed to fetch|Load failed|NetworkError|ERR_/i.test(msg)) {
    return "网络请求失败,请检查 API URL、CORS 与网络连接";
  }
  return msg;
}

interface ChatInterfaceProps {
  settings: AppState;
  onOpenSettings: () => void;
  onOpenBypass: () => void;
  logs: LogEntry[];
  onAddLog: (log: Omit<LogEntry, "id" | "timestamp">) => void;
  onOpenConsole: () => void;
  onOpenUserRole: () => void;
  onOpenCharacterSelection: () => void;
  onOpenChatHistory: () => void;
  onSettingsChange: (next: AppState) => void;
  currentSession: ChatSession | null;
  onSessionChange: (session: ChatSession | null) => void;
}

/** Imperative handle exposed to App so siblings (e.g. BypassModal) can send
 *  a message as the user without owning the chat state. */
export interface ChatInterfaceHandle {
  sendUserMessage: (text: string) => void;
}

export const ChatInterface = forwardRef<ChatInterfaceHandle, ChatInterfaceProps>(function ChatInterface({
  settings,
  onOpenSettings,
  onOpenBypass,
  logs: _logs,
  onAddLog,
  onOpenConsole,
  onOpenUserRole,
  onOpenCharacterSelection,
  onOpenChatHistory,
  onSettingsChange,
  currentSession,
  onSessionChange,
}: ChatInterfaceProps, ref) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [imageGeneratingId, setImageGeneratingId] = useState<string | null>(null);
  // Transient ComfyUI progress for the bubble currently rendering (queue +
  // step %). Keyed by the generating message id; cleared when it finishes.
  const [comfyProgress, setComfyProgress] = useState<{ id: string; p: ComfyProgress } | null>(null);
  // t17: transient AnswererFlagalac tool-channel retry notice, rendered INSIDE
  // the bubble that is currently generating (the console log alone leaves the
  // bubble blank for the whole retry window — up to 92 s on the real device,
  // which reads as a freeze). Keyed by the turn's message id so a previous
  // turn's notice can never paint on a new bubble.
  //
  // Kept as two PRIMITIVES (not a `{id, text}` object) on purpose: MessageItem
  // is React.memo'd, and a freshly allocated object every render would bust the
  // memo. `undefined`/"" is the "no notice" value and a plain string identity is
  // stable across re-renders, so the memo skips exactly as before.
  //
  // This state is DISPLAY-ONLY: it is never written into `messages`, so it can
  // never reach the request body or the persisted chat (see the t17 probe
  // `check-flagalac-retry-bubble.mjs`, which compares request bodies frame by
  // frame and asserts the payload is byte-identical whether or not notices
  // fired).
  const [retryNoticeMsgId, setRetryNoticeMsgId] = useState<string | undefined>(undefined);
  const [retryNoticeText, setRetryNoticeText] = useState<string | undefined>(undefined);
  // P6: ComfyUI pack login gate + exhausted dialog
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [showExhaustedDialog, setShowExhaustedDialog] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  // OpenCode Go requires one stable request identifier per logical chat. Keep a
  // draft identifier before the first autosave, then persist it with the chat.
  const opencodeSessionIdRef = useRef<string | null>(currentSession?.opencodeSessionId ?? null);
  useEffect(() => {
    opencodeSessionIdRef.current = currentSession?.opencodeSessionId ?? null;
  }, [currentSession?.id, currentSession?.opencodeSessionId]);

  // Persistent memory extraction state.
  const [extractionState, setExtractionState] = useState<ExtractionState>({
    phase: { phase: "idle" },
    skippedAtMessageCount: null,
  });
  const extractionRef = useRef(extractionState);
  extractionRef.current = extractionState;
  /** Holds batchSeq + taggedMsg across the confirmExtraction → recompress → confirmRecompress chain. */
  const recompressMetaRef = useRef<{
    batchSeq: number;
    rangeLastMsgId: string;
    taggedMsg: Message;
  } | null>(null);
  const pendingSendRef = useRef<{ content: string; atts: ReturnType<typeof useAttachments>["attachments"]; baseMessages: Message[] } | null>(null);

  const { isSupported: isFullscreenSupported, isFullscreen, toggleFullscreen } =
    useFullscreen();
  const { attachments, addFiles, removeAt: removeAttachment, clear: clearAttachments } =
    useAttachments();

  const currentCharacter = settings.characters?.find(
    (c) => c.id === settings.currentCharacterId,
  );
  const currentUserRole = settings.userRoles?.find(
    (u) => u.id === settings.currentUserRoleId,
  );
  const charName = currentCharacter?.name || "AI助手";
  const userName = currentUserRole?.name || "user";
  // Active character cover (512×768) as an object URL, shared by every assistant
  // bubble's side/avatar decoration and cover viewer.
  const coverUrl = useCoverObjectUrl(currentCharacter?.id, !!currentCharacter?.coverImage);

  // Hot-path mirrors so the callbacks handed to every MessageItem can be
  // stabilized with empty deps. A plain (or messages-keyed) callback gets a
  // fresh identity on every keystroke / stream token, which busts React.memo on
  // all bubbles and forces the whole list — each running the full react-markdown
  // pipeline — to re-render. That is the input lag observed past ~100 floors.
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  // 变量写入的"本帧补丁覆盖层"（见下方变量层适配器）：React 的 setMessages 要到下一帧才
  // 反映到 messagesRef，而 MVU 会在**同一个 tick** 里连写两次。每次渲染后 React 状态已经
  // 包含此前排入的补丁，因此在这里清空（渲染一定在处理过这些更新之后）。
  const varPatchOverlayRef = useRef<Map<string, MessagePatch>>(new Map());
  varPatchOverlayRef.current.clear();
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  // Assigned right after sendChat is defined below; read (never captured) by the
  // stabilized handleRegenerate so it always calls the latest closure.
  const sendChatRef = useRef<
    ((content: string, atts: typeof attachments, baseMessages: Message[]) => Promise<void>) | null
  >(null);

  // ─── 变量层宿主适配器（SSOT §2.2 / D3① / §2.5）───────────────────────────
  //
  // 变量层自己不做持久化：读会话、写回全部经这里交回宿主。
  //
  // ⚠️ **必须注册在 ChatInterface，而不是 App** —— 权威的 live `messages` 在这里。
  // App 的 `currentSession.messages` 只是"上一次自动保存时的快照"，本组件只在
  // `currentSession?.id` 变化时才从 prop 同步 messages（见本文件末尾的 effect）。
  // 若拿 App 的快照去重建会话再写回，会把此刻刚生成的回复与楼层变量一起覆盖掉。
  const currentSessionRef = useRef(currentSession);
  currentSessionRef.current = currentSession;
  // 「草稿会话」——见下方适配器注释：选了角色、还没发过消息时 App 的 currentSession 是
  // null（只有开场白在 messages 里），而 MVU 的变量初始化**正发生在开场白楼层**。
  // 这里保留一个本次挂载内稳定的假 id 与角色元信息，供变量层读/写（写入时就地落盘）。
  const draftSessionIdRef = useRef<string | null>(null);
  const materializedIdRef = useRef<string | null>(null);
  const draftMetaRef = useRef<{ characterId: string; characterName: string }>({
    characterId: "",
    characterName: charName,
  });
  draftMetaRef.current = {
    characterId: settings.currentCharacterId ?? "",
    characterName: charName,
  };
  useEffect(() => {
    const draftId = () => (draftSessionIdRef.current ??= `draft-${newId()}`);
    // 把"意图补丁"应用到给定数组（不动补丁里没提到的字段）。
    const applyPatchesTo = (base: Message[], patches: MessagePatch[]): Message[] => {
        const byId = new Map(patches.map((p) => [p.id, p] as const));
        let changed = false;
        const merged = base.map((m) => {
          const p = byId.get(m.id);
          if (!p) return m;
          let next = m;
          if (p.content !== undefined && p.content !== m.content) next = { ...next, content: p.content };
          if (p.variables !== undefined && p.variables !== m.variables) {
            next = { ...next, variables: p.variables as Message["variables"] };
          }
          if (next !== m) changed = true;
          return next;
        });
        return changed ? merged : base;
      };
      // 同步镜像：React 的 `setMessages` 要到下一帧才反映到 `messagesRef`，而 MVU 会在**同一个
      // tick** 里连写两次（楼层变量 → chat 变量）。落盘若只读 `messagesRef` 就会丢掉前一次写入，
      // 所以这里叠加一份"本帧已应用的补丁"再落盘。下一帧渲染时由 render body 清空。
      const patchArrayOverlay = (base: Message[], overlay: Map<string, MessagePatch>): Message[] =>
        overlay.size ? applyPatchesTo(base, [...overlay.values()]) : base;
      // 会话级字段 + 显式落盘。不能只依赖本文件的自动保存 effect：它是 800ms 防抖**且没有
      // 用户消息就跳过**，而 MVU 正是在开场白楼层写变量（M3 的经典失败形态）。
      // ⚠️ 草稿态（还没发过消息、App 没有会话）必须**就地落盘成一个真会话**：否则开场白楼层
      // 上的变量初始化会被整体丢弃（真机 v11-1542 实测）。草稿落盘只允许发生一次 —— 同一帧内
      // 的多次写入必须落到同一个新会话 id 上，否则会各建一个会话。
      const persistLive = (merged: Message[], variables?: Record<string, unknown>) => {
        const live = currentSessionRef.current;
        if (!live) materializedIdRef.current ??= newId();
        const nextId = live?.id ?? materializedIdRef.current ?? newId();
        const nextVars = variables !== undefined ? variables : live?.variables;
        const next: ChatSession = {
          id: nextId,
          ...(opencodeSessionIdRef.current ? { opencodeSessionId: opencodeSessionIdRef.current } : {}),
          characterId: live?.characterId || draftMetaRef.current.characterId || "",
          characterName: live?.characterName || draftMetaRef.current.characterName || "",
          messages: merged,
          createdAt: live?.createdAt ?? Date.now(),
          ...(nextVars !== undefined ? { variables: nextVars } : {}),
        };
        onSessionChange(next);
        try {
          const w = window as unknown as { __nyaVarTrace?: unknown[] };
          w.__nyaVarTrace = (w.__nyaVarTrace || [])
            .concat([{ t: Date.now(), k: "persist", from: live?.id ?? null, to: nextId, len: merged.length, vars0: Array.isArray(merged[0]?.variables) }])
            .slice(-60);
        } catch {
          /* ignore */
        }
        void saveSession(next).catch((err) => {
          console.error("变量写入后保存会话失败", err);
        });
      };

    setVariableAdapter({
      // ⚠️ 有开场白但还没有落盘会话时，**不能**返回 null：真机实测（v11-1542）该状态下
      // MVU 的 initvar 读到空聊天直接退出，整个世界书的变量初始化都不会发生
      // （日志原文：写入 chat 作用域失败：当前没有打开的会话）。
      getCurrentSessionId: () =>
        currentSessionRef.current?.id ?? (messagesRef.current.length > 0 ? draftId() : null),
      getSession: (id) => {
        const live = currentSessionRef.current;
        if (live && live.id === id) return { ...live, messages: messagesRef.current };
        if (draftSessionIdRef.current === id) {
          return {
            id,
            characterId: draftMetaRef.current.characterId,
            characterName: draftMetaRef.current.characterName,
            messages: messagesRef.current,
            createdAt: Date.now(),
          };
        }
        return loadSessions().find((s) => s.id === id) ?? null;
      },
      // ── 意图补丁路径（首选，见 VariableAdapter.patchMessages 的注释）─────────────────
      // 只应用补丁里**显式出现**的字段，且应用到 React 给的最新 `prev` 上，因此不会被
      // "比 live state 旧的整会话快照"回滚（v12-1625 真机实证的变量丢失根因）。
      patchMessages: (patches) => {
        if (!patches.length) return;
        for (const p of patches) {
          varPatchOverlayRef.current.set(p.id, { ...(varPatchOverlayRef.current.get(p.id) ?? { id: p.id }), ...p });
        }
        setMessages((prev) => applyPatchesTo(prev, patches));
        persistLive(patchArrayOverlay(messagesRef.current, varPatchOverlayRef.current));
      },
      patchSession: (fields) => {
        if (fields.variables === undefined) return;
        persistLive(patchArrayOverlay(messagesRef.current, varPatchOverlayRef.current), fields.variables);
      },
      // ── 兼容路径（旧契约：整份会话快照）────────────────────────────────────────────
      // 只把**源里显式出现的字段**当意图：缺 `variables` 字段 ≠ 要清空变量。旧实现把
      // `undefined` 也当权威，会抹掉刚落地的变量（真机 v12-1625 的根因）。
      commitSession: (session) => {
        const seen = new Set<string>();
        const patches: MessagePatch[] = [];
        for (const src of session.messages) {
          if (seen.has(src.id)) continue;
          seen.add(src.id);
          const patch: MessagePatch = { id: src.id, content: src.content };
          if (Object.prototype.hasOwnProperty.call(src, "variables")) patch.variables = src.variables;
          patches.push(patch);
        }
        for (const p of patches) {
          varPatchOverlayRef.current.set(p.id, { ...(varPatchOverlayRef.current.get(p.id) ?? { id: p.id }), ...p });
        }
        setMessages((prev) => applyPatchesTo(prev, patches));
        persistLive(patchArrayOverlay(messagesRef.current, varPatchOverlayRef.current), session.variables);
      },
    });
    return () => setVariableAdapter(null);
  }, []);

  // Effective regex chain (global + this character), enabled-only. Held in state
  // so MessageItem's memo isn't busted by a fresh array identity every render:
  // the reference only changes when we recompute — on character switch, and
  // whenever the global scripts change (the 正则 manager saving) via the
  // subscription. The latter makes edits reflect on the visible chat immediately
  // instead of only on the next character switch / reload.
  const [regexScripts, setRegexScripts] = useState(() =>
    getEffectiveRegexScripts(currentCharacter),
  );
  useEffect(() => {
    const recompute = () => setRegexScripts(getEffectiveRegexScripts(currentCharacter));
    recompute();
    return subscribeRegexScripts(recompute);
  }, [currentCharacter]);

  // 临时诊断（真机排查"卡片正则被导入成什么样了"）：显示侧正则链每次重算时打一条清单，
  // 含**替换串长度** —— `[美化]变量完成-三明月喵` 在卡片里是 3624 字符的 ```html 片段，
  // 若这里显示 0，就是导入/存储链路丢了 replaceString。定位后删除。
  useEffect(() => {
    try {
      const digest = regexScripts.map((s) => ({
        n: s.scriptName,
        md: s.markdownOnly,
        po: s.promptOnly,
        dis: s.disabled,
        rep: typeof s.replaceString === "string" ? s.replaceString.length : -1,
        find: typeof s.findRegex === "string" ? s.findRegex.slice(0, 80) : null,
      }));
      // 同时挂到 window 上：`console.info` 在**页面极早期**可能早于 dev console 收集器，
      // 而 `__nyaScriptRunnerDiag()`（用户手动触发，通常晚得多）能稳定读到它。
      (window as unknown as { __nyaRegexChain?: unknown }).__nyaRegexChain = digest;
      console.info("[regex-chain] 显示侧正则链 " + JSON.stringify(digest));
    } catch {
      /* 诊断失败不影响渲染 */
    }
  }, [regexScripts]);

  // AnswererFlagalac traceCleanup (module SSOT §4.6) — display pipeline.
  //
  // These two built-in rules are NOT members of the user-visible regex chain:
  // they are never persisted, never appear in the 正则 manager (RegexModal) and
  // never enter the global/character regex store. They are only
  // APPENDED to the array handed to MessageItem for this render pass, so the
  // display pass escapes tags inside thought blocks while `message.content` stays
  // exactly what the model wrote (MessageItem's edit box reads the raw content;
  // `runOnEdit: false` keeps it that way). Appending at the end keeps the user's
  // own scripts first — they must keep seeing the original text.
  //
  // Gated by the P1 resolver (no target-id branching here): disabled or
  // `target === "none"` ⇒ the previous array reference is passed through
  // untouched, so MessageItem's memo and the rendered output are unchanged.
  const flagalacTraceScripts = React.useMemo(
    () =>
      isFlagalacTraceCleanupEnabled(settings.bypass?.answererFlagalac)
        ? buildFlagalacTraceDisplayScripts()
        : null,
    [settings.bypass?.answererFlagalac],
  );
  // 内置显示规则（与 flagalac 无关，**始终**追加在最后）：兜底隐藏 MVU 的
  // `<UpdateVariable>…</UpdateVariable>` 控制块。卡片自带美化正则时它先消费本规则无操作；
  // 没带的卡片（真机实测「变装女友」）否则会把块内 `<Analysis>`/`<JSONPatch>` 文本漏在气泡里。
  const mvuControlScripts = React.useMemo(() => buildVariableUpdateHiddenDisplayScripts(), []);
  const displayRegexScripts = React.useMemo(
    () => [
      ...regexScripts,
      ...(flagalacTraceScripts && flagalacTraceScripts.length ? flagalacTraceScripts : []),
      ...mvuControlScripts,
    ],
    [regexScripts, flagalacTraceScripts, mvuControlScripts],
  );

  // ─── MVU 状态栏占位符：宿主侧兜底（MVU技术性说明 §3.9 / §4.6）───────────────────
  //
  // 文档规定的收尾是：**确保消息正文尾部含 `<StatusPlaceHolderImpl/>`**（并删掉正文里的
  // `<status_current_variable>` 段），再由卡片的 markdownOnly 正则把它替换成 ```html 看板。
  // 这一步本该由 MVU bundle 的更新收尾完成；但在我们的仿真层里它的 message_received 监听器
  // 已被 abort（真机 v12-2000 实证：回复时刻零次 API 调用、回复楼层 hasPh:false），
  // 而用户手工在正文末尾补一个占位符，状态栏立刻出现（同一环境实证）。
  // 因此这里按文档**在宿主侧补上同一小步**，条件收窄且幂等：
  //   · 仅当显示正则链里确实存在以 `<StatusPlaceHolderImpl/>` 为 findRegex 的规则（卡片期待状态栏）；
  //   · 仅补**最后一条助手楼层**，且它确实带 MVU 变量（`stat_data`）、正文里还没有占位符；
  //   · 已有占位符 ⇒ 不追加（幂等，不会重复堆叠）。
  const statusPlaceholderExpected = React.useMemo(
    () =>
      displayRegexScripts.some(
        (s) => typeof s.findRegex === "string" && s.findRegex.includes("StatusPlaceHolderImpl"),
      ),
    [displayRegexScripts],
  );
  useEffect(() => {
    if (!statusPlaceholderExpected) return;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return;
    const slot = Array.isArray(lastAssistant.variables) ? lastAssistant.variables[0] : undefined;
    if (!slot || typeof slot !== "object" || !("stat_data" in (slot as Record<string, unknown>))) return;
    if (lastAssistant.content.includes("<StatusPlaceHolderImpl/>")) return;
    setMessages((prev) =>
      prev.map((m) =>
        m.id === lastAssistant.id && !m.content.includes("<StatusPlaceHolderImpl/>")
          ? { ...m, content: `${m.content.replace(/\s+$/, "")}\n\n<StatusPlaceHolderImpl/>` }
          : m,
      ),
    );
  }, [messages, statusPlaceholderExpected]);

  // AnswererFlagalac unicodeEncoding (D-28/D-27) — display-side gate (F-2).
  //
  // The stored text keeps the model's `\uXXXX` escapes on purpose, and MessageItem
  // decodes them for DISPLAY and COPY. That decode only makes sense while the
  // option is actually in effect: with it off, a literal `\uXXXX` in an ordinary
  // chat (pasted JSON / regex / code) must render and copy byte-for-byte. Resolved
  // here by the same P1 gate the send path uses, then handed down as a primitive
  // boolean so MessageItem's memo is not busted by a fresh identity.
  //
  // Trade-off (see MessageItem's prop doc): turning 阵地制作 off leaves an already
  // escape-encoded history showing literal `\uXXXX`. Chosen deliberately — 「未启用
  // 时零差异」 wins; re-enabling the option makes that history readable again.
  const flagalacDecodeEscapes = React.useMemo(
    () => isFlagalacUnicodeEncodingEnabled(settings.bypass?.answererFlagalac),
    [settings.bypass?.answererFlagalac],
  );

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const buildFirstMes = (character: typeof currentCharacter): Message[] => {
    if (!character?.firstMes?.trim()) return [];
    return [
      {
        id: newId(),
        role: "assistant",
        content: character.firstMes,
        timestamp: Date.now(),
      },
    ];
  };

  useEffect(() => {
    if (currentSession?.characterId === settings.currentCharacterId) return;
    setMessages(buildFirstMes(currentCharacter));
    // Intentionally only depends on the character/session IDs, not the whole
    // objects — editing a character or autosaving a session shouldn't reset chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.currentCharacterId, currentSession?.characterId]);

  /**
   * Single source of truth for "send a turn to the model". Used by both
   * normal user submits and regenerate. Caller passes the base messages
   * snapshot to use as history, so we sidestep the React batching pitfall
   * where `messages` in closure may not yet reflect just-applied setMessages.
   */
  const sendChat = async (
    content: string,
    atts: typeof attachments,
    baseMessages: Message[],
  ) => {
    if (isLoading) return;

    // Resolve the request shape from the active v2 provider rather than the
    // legacy `settings.api`. The provider's lastUsedModel takes precedence;
    // if not set yet (e.g. user has only enabled the provider but never
    // picked a model in the composer), providerToApiSettings falls back to
    // the first model in the provider's list. An empty model means no model
    // is configured at all and the user has to add one via 管理模型 first.
    const activeProvider = getActiveLlmProvider(settings);
    if (activeProvider?.kind === "opencode-go" && !opencodeSessionIdRef.current) {
      opencodeSessionIdRef.current = newId();
    }
    const activeApi: ApiSettings | null = activeProvider
      ? {
          ...providerToApiSettings(activeProvider, undefined, opencodeSessionIdRef.current ?? undefined),
          isStreaming: settings.isStreaming,
        }
      : null;

    // apiKey is exempt for Ollama-style local servers; baseUrl + model
    // remain required.
    const requiresKey = activeProvider?.kind !== "ollama";
    if (
      !activeApi ||
      !activeApi.baseUrl ||
      (requiresKey && !activeApi.apiKey)
    ) {
      onAddLog({
        direction: "error",
        content: "API configuration is missing",
      });
      onOpenSettings();
      return;
    }
    if (!activeApi.model) {
      onAddLog({
        direction: "error",
        content: "No model selected for the active provider",
      });
      onOpenSettings();
      return;
    }

    // ---- persistent memory extraction trigger --------------------------------
    // Check BEFORE creating the user message — if extraction is needed, the
    // user's turn must be deferred until extraction completes (or is skipped).

    if (
      settings.isMemoryEnabled &&
      currentSession?.id &&
      extractionRef.current.phase.phase === "idle"
    ) {
      // Reset skip if enough new messages have accumulated.
      const state = extractionRef.current;
      let skippedAt = state.skippedAtMessageCount;
      if (skippedAt != null && baseMessages.length - skippedAt >= 10) {
        skippedAt = null;
      }

      const activeModelEntry = activeProvider?.models.find(
        (m) => m.id === activeApi.model,
      );
      const budget = computeContextBudget({
        messages: baseMessages,
        modelId: activeApi.model,
        entry: activeModelEntry,
        settings,
      });

      if (budget.overThreshold && skippedAt == null) {
        const lastBoundaryIndex = findBoundaryIndex(baseMessages);
        const range = selectExtractionRange(baseMessages, lastBoundaryIndex);
        if (range) {
          const estimate = estimateExtractionCost(range.messages, budget);
          pendingSendRef.current = { content, atts, baseMessages };
          setExtractionState({
            phase: { phase: "prompting", range, estimate },
            skippedAtMessageCount: state.skippedAtMessageCount,
          });
          return; // Defer send — wait for user decision or extraction.
        }
      }

      // Update skip state if it changed.
      if (skippedAt !== state.skippedAtMessageCount) {
        setExtractionState({ phase: { phase: "idle" }, skippedAtMessageCount: skippedAt });
      }
    }

    const processedInput = applyPlaceholders(content, userName, charName);
    const messageContent = buildMessageContent(processedInput, atts);

    const newUserMessage: Message = {
      id: newId(),
      role: "user",
      content:
        typeof messageContent === "string" ? messageContent : processedInput,
      attachments: atts.length > 0 ? atts : undefined,
      timestamp: Date.now(),
    };
    const botMessageId = newId();

    setMessages((prev) => [
      ...prev,
      newUserMessage,
      { id: botMessageId, role: "assistant", content: "", timestamp: Date.now() },
    ]);
    setIsLoading(true);
    // t17: a new turn owns the bubble status line — never inherit the previous
    // turn's notice (belt-and-braces next to the msgId key and the isLoading
    // gate at the render site).
    setRetryNoticeMsgId(undefined);
    setRetryNoticeText(undefined);

    // Web search runs first when enabled. The chat AbortController is
    // created up-front so the user's Stop button cancels both phases (in
    // flight search OR in flight chat completion).
    abortControllerRef.current = new AbortController();
    let searchContext: ReturnType<typeof buildSearchContext> = null;
    if (WEB_SEARCH_FEATURE_ENABLED && settings.isWebSearchEnabled) {
      try {
        onAddLog({
          direction: "info",
          content: "Web search: querying SearXNG",
          meta: { query: processedInput },
        });
        const results = await searchWeb(
          processedInput,
          abortControllerRef.current.signal,
        );
        searchContext = buildSearchContext(processedInput, results);
        onAddLog({
          direction: "response",
          content: `Web search: got ${results.length} results`,
          meta: {
            engines: Array.from(new Set(results.map((r) => r.engine))),
            urls: results.map((r) => r.url),
          },
        });
      } catch (err: any) {
        // Silent degrade: keep the chat path going without search context.
        // If the abort came from the user, propagate it so chat doesn't
        // continue against the user's intent.
        if (err?.name === "AbortError" || abortControllerRef.current.signal.aborted) {
          setIsLoading(false);
          abortControllerRef.current = null;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === botMessageId
                ? { ...m, content: m.content + "\n\n**[已停止生成]**" }
                : m,
            ),
          );
          return;
        }
        const reason =
          err instanceof WebSearchError ? err.message : err?.message || String(err);
        onAddLog({
          direction: "error",
          content: "Web search failed; continuing without context",
          meta: { error: reason },
        });
      }
    }

    // KB search — runs after web search, before buildRequestMessages.
    // We pre-compute which world-info keyword rules would activate so we can
    // collect their linkedKbIds and fetch KB search results for injection into
    // the same turn's <search_context> block.
    let kbSearchContext: string | null = null;
    if (currentCharacter?.worldInfo) {
      try {
        const activatedRules = getActivatedKeywordRules(
          processedInput,
          currentCharacter.worldInfo,
        );
        const linkedKbIds = collectLinkedKbIds(activatedRules);
        if (linkedKbIds.length > 0) {
          const stored = await loadStoredAccount();
          if (stored) {
            onAddLog({
              direction: "info",
              content: `KB search: querying ${linkedKbIds.length} linked knowledge base(s)`,
              meta: { kbIds: linkedKbIds, query: processedInput },
            });
            const results = await Promise.all(
              linkedKbIds.map(async (kbId) => {
                try {
                  const res = await searchKb(stored.token, kbId, processedInput, 5);
                  if (res.kind === "ok") {
                    return { kbId, kbName: res.data.results[0]?.document_name ?? kbId, results: res.data.results };
                  }
                  if (res.kind === "error") {
                    onAddLog({
                      direction: "info",
                      content: `KB search: ${kbId} returned error (${res.error}), skipping`,
                    });
                  } else {
                    onAddLog({
                      direction: "info",
                      content: `KB search: ${kbId} unreachable, skipping`,
                    });
                  }
                } catch {
                  // per-kb failure is non-fatal
                }
                return null;
              }),
            );
            const valid = results.filter(
              (r): r is { kbId: string; kbName: string; results: NonNullable<typeof r>["results"] } => r !== null && r.results.length > 0,
            );
            if (valid.length > 0) {
              // Try to resolve KB names from the API responses. The first
              // chunk's document_name is a fallback; we really want the KB
              // name. For now we use the kbId as a label if we can't get
              // a better name (the search endpoint doesn't return kb name
              // directly, but we can infer from context).
              const grouped = valid.map((g) => ({
                kbName: g.kbName || g.kbId,
                results: g.results,
              }));
              kbSearchContext = buildKbSearchContext(processedInput, grouped);
              onAddLog({
                direction: "response",
                content: `KB search: got results from ${valid.length} knowledge base(s)`,
                meta: {
                  kbIds: valid.map((v) => v.kbId),
                  totalChunks: valid.reduce((s, v) => s + v.results.length, 0),
                },
              });
            }
          }
        }
      } catch (err: any) {
        // Silent degrade — chat runs without KB context on any error.
        if (err?.name === "AbortError" || abortControllerRef.current?.signal.aborted) {
          setIsLoading(false);
          abortControllerRef.current = null;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === botMessageId
                ? { ...m, content: m.content + "\n\n**[已停止生成]**" }
                : m,
            ),
          );
          return;
        }
        onAddLog({
          direction: "error",
          content: "KB search failed; continuing without KB context",
          meta: { error: err?.message || String(err) },
        });
      }
    }

    // Merge web-search and KB-search contexts into one block.
    // Both ride the same <search_context> volatile part in the latest user turn;
    // the protocol anchor treats all <search_context> content as reference-only.
    const mergedSearchContext = [searchContext, kbSearchContext]
      .filter(Boolean)
      .join("\n\n") || undefined;

    // Memory search — runs after KB search, before buildRequestMessages.
    // Only when the feature is enabled, the user is logged in, and this session
    // already has extracted batches (hasBoundary). Failure is non-fatal.
    let memoryContext: string | undefined;
    if (settings.isMemoryEnabled && currentSession?.id) {
      const boundaryIdx = findBoundaryIndex(baseMessages);
      if (boundaryIdx >= 0) {
        const stored2 = await loadStoredAccount();
        if (stored2) {
          try {
            const memResult = await searchMemory(stored2.token, currentSession.id, processedInput, 5);
            if (memResult.kind === "ok" && memResult.data.count > 0) {
              memoryContext = buildMemoryContext(memResult.data.results);
            } else if (memResult.kind === "error" || memResult.kind === "network") {
              onAddLog({
                direction: "info",
                content: `Memory search skipped: ${memResult.kind === "error" ? memResult.error : "unreachable"}`,
              });
            }
          } catch {
            // Non-fatal — memory is an enhancement, not a dependency.
          }
        }
      }
    }

    // Declared outside the try so the catch can report elapsed time too.
    let chatStartedAt = Date.now();
    try {
      // MCP tools assembly. Done BEFORE buildRequestMessages so we can
      // pass the advertised tool name list through and let the system
      // prompt inject ONLY the rules for tools actually being advertised
      // — irrelevant rules are pure noise when a tool isn't on the menu.
      // Listing tools per-turn (rather than caching) lets enable/disable
      // + service
      // health changes take effect immediately. Failure to fetch is
      // non-fatal and silently degrades to chat-without-tools.
      //
      // Capability gate: skip tools entirely when the active model has
      // been health-checked AND its inferred capabilities don't include
      // 'tools'. We DON'T skip when capabilities is undefined (model never
      // probed) — assume the user knows what they're doing rather than
      // block by default. This protects users from the "system prompt
      // talks about tool data the model can't actually invoke" footgun.
      let mcpToolUseOptions:
        | {
            tools: LlmTool[];
            executeTool: ToolExecutor;
            onToolEvent: (e: any) => void;
            onNotice?: (message: string) => void;
          }
        | undefined;
      let advertisedToolNames: string[] = [];
      const anyToolEnabled =
        settings.mcpToolsEnabled &&
        Object.values(settings.mcpToolsEnabled).some((v) => v !== false);
      const activeModelEntry = activeProvider?.models.find(
        (m) => m.id === activeApi.model,
      );
      const modelDeclaredCapabilities = activeModelEntry?.capabilities;
      const modelSupportsTools =
        // Never probed → trust the user, advertise tools.
        modelDeclaredCapabilities === undefined ||
        modelDeclaredCapabilities.includes("tools");
      if (settings.isMcpEnabled && anyToolEnabled && modelSupportsTools) {
        try {
          const allTools = filterAdvertised(
            await listTools(abortControllerRef.current.signal),
          );
          const enabledTools = allTools.filter(
            (t) => settings.mcpToolsEnabled[t.name] !== false,
          );
          if (enabledTools.length > 0) {
            advertisedToolNames = enabledTools.map((t) => t.name);
            const llmTools: LlmTool[] = enabledTools.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: t.inputSchema,
            }));
            const userCity = settings.mcpUserCity;
            const executor: ToolExecutor = async (name, args) => {
              const merged = mergeUserCity(name, args || {}, userCity);
              return await callTool(
                name,
                merged,
                abortControllerRef.current?.signal,
              );
            };
            mcpToolUseOptions = {
              tools: llmTools,
              executeTool: executor,
              onToolEvent: (e) => {
                onAddLog({
                  direction: e.result.ok ? "response" : "error",
                  content: `MCP tool ${e.name} (${e.result.ok ? "ok" : "fail"})`,
                  meta: {
                    round: e.round,
                    name: e.name,
                    args: e.args,
                    result: e.result,
                  },
                });
              },
              // D-29: surface the AnswererFlagalac tool-channel retries in the
              // console log so a silent retry is visible to the user.
              // t17: ALSO mirror the same text into the bubble's status line —
              // the console is not where the user is looking during a 92 s wait.
              onNotice: (message: string) => {
                onAddLog({ direction: "info", content: message });
                setRetryNoticeMsgId(botMessageId);
                setRetryNoticeText(message);
              },
            };
            onAddLog({
              direction: "info",
              content: `MCP tools advertised: ${enabledTools.map((t) => t.name).join(", ")}`,
            });
          }
        } catch (err: any) {
          if (err?.name === "AbortError" || abortControllerRef.current?.signal.aborted) {
            // User cancelled mid-listTools — bail out the same way the
            // web-search abort path does.
            setIsLoading(false);
            abortControllerRef.current = null;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === botMessageId
                  ? { ...m, content: m.content + "\n\n**[已停止生成]**" }
                  : m,
              ),
            );
            return;
          }
          onAddLog({
            direction: "error",
            content: "MCP listTools failed; chat will run without tools",
            meta: { error: err?.message || String(err) },
          });
        }
      } else if (settings.isMcpEnabled && anyToolEnabled && !modelSupportsTools) {
        // User opted into MCP but the active model was probed and lacks
        // 'tools'. Tell them once per turn so they can either probe the
        // model again, switch models, or close MCP — silent skipping
        // would leave them wondering why "now in 几点" gets a hallucinated
        // answer.
        onAddLog({
          direction: "info",
          content: `MCP tools skipped: model "${activeApi.model}" 未声明 tools 能力`,
          meta: {
            modelId: activeApi.model,
            capabilities: modelDeclaredCapabilities,
            hint: "在『管理模型』里给该模型重跑健康检查，或切换到支持工具调用的模型",
          },
        });
      }

      // The AnswererFlagalac tool channel does not need MCP tools, but it DOES
      // report retry progress through the same options object (D-29). Keep an
      // empty shell when no MCP tool is advertised so those notices still reach
      // the console log — `tools: []` leaves every request shape untouched
      // (api.ts only sends a `tools` field when the array is non-empty).
      if (!mcpToolUseOptions) {
        mcpToolUseOptions = {
          tools: [],
          executeTool: async () => ({ ok: false, message: "no tool advertised" }),
          onToolEvent: () => {},
          onNotice: (message: string) => {
            onAddLog({ direction: "info", content: message });
            // t17: same mirror as the MCP branch above (the AnswererFlagalac
            // tool channel reports its retries through this empty shell).
            setRetryNoticeMsgId(botMessageId);
            setRetryNoticeText(message);
          },
        };
      }

      const messagesForApi = buildRequestMessages({
        processedInput,
        messageContent,
        baseMessages,
        settings,
        currentCharacter,
        userName,
        charName,
        searchContext: mergedSearchContext,
        memoryContext,
        mcpAdvertisedToolNames: advertisedToolNames,
      });

      // Request-side entry: url / model / advertised tools only. The rendered
      // prompt ("renderedMessages" — system / bypass / world-info / history) is
      // deliberately NOT attached: it is the outgoing payload and must never be
      // readable from the GUI or from any browser-side inspection.
      onAddLog({
        direction: "request",
        content: "Sending chat completion request",
        meta: {
          url: activeApi.baseUrl,
          model: activeApi.model,
          tools: mcpToolUseOptions?.tools.map((t) => t.name) ?? [],
        },
      });

      // Reset to the moment we actually hand off to the network, so the
      // duration reflects the request itself, not the MCP/prompt assembly above.
      chatStartedAt = Date.now();
      let fullResponse = "";
      const usageResult = await fetchChatCompletion(
        messagesForApi,
        activeApi,
        (chunk) => {
          fullResponse += chunk;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === botMessageId ? { ...m, content: m.content + chunk } : m,
            ),
          );
          scrollToBottom();
        },
        abortControllerRef.current.signal,
        mcpToolUseOptions,
      );

      if (usageResult) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id === newUserMessage.id) {
              return { ...m, tokenCount: usageResult.prompt_tokens };
            }
            if (m.id === botMessageId) {
              return {
                ...m,
                tokenCount: usageResult.completion_tokens,
                model: activeApi.model,
              };
            }
            return m;
          }),
        );
      }

      onAddLog({
        direction: "response",
        content: "Received chat completion stream fully",
        meta: { response: fullResponse, usage: usageResult, durationMs: Date.now() - chatStartedAt },
      });
    } catch (error: any) {
      console.error(error);
      const isAbort = error?.name === "AbortError";
      const description = isAbort ? "请求已停止" : describeError(error);
      onAddLog({
        direction: "error",
        content: isAbort
          ? "Chat completion aborted by user"
          : "Failed during chat completion request",
        meta: {
          error: error?.message || String(error),
          status: error?.status,
          durationMs: Date.now() - chatStartedAt,
        },
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMessageId
            ? {
                ...m,
                content:
                  m.content +
                  (isAbort
                    ? `\n\n**[已停止生成]**`
                    : `\n\n**错误:** ${description}`),
              }
            : m,
        ),
      );
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
      // t17: the single reset point for the retry status line — reached on
      // success, on error AND on user abort (every abort return inside
      // sendChat still unwinds through this finally), so the status line can
      // never outlive the turn that produced it.
      setRetryNoticeMsgId(undefined);
      setRetryNoticeText(undefined);
    }
  };
  // Keep the ref pointing at the latest sendChat closure so stabilized callbacks
  // (handleRegenerate) invoke it without taking sendChat as a dependency.
  sendChatRef.current = sendChat;

  const handleSubmit = async () => {
    if (isLoading) {
      handleStop();
      return;
    }
    // Block send while extraction is active.
    if (extractionRef.current.phase.phase !== "idle") return;
    if (!input.trim() && attachments.length === 0) return;
    const content = input;
    const atts = attachments;
    setInput("");
    clearAttachments();
    await sendChat(content, atts, messages);
  };

  // ---- extraction handlers ---------------------------------------------------

  const confirmExtraction = async () => {
    const state = extractionRef.current;
    if (state.phase.phase !== "prompting") return;
    const { range, estimate: _estimate } = state.phase;

    const stored = await loadStoredAccount();
    if (!stored) {
      // token expired / logged out — silently abort and send normally
      setExtractionState({ phase: { phase: "idle" }, skippedAtMessageCount: null });
      const p = pendingSendRef.current;
      if (p) { pendingSendRef.current = null; await sendChat(p.content, p.atts, p.baseMessages); }
      return;
    }

    const activeProvider = getActiveLlmProvider(settings);
    if (activeProvider?.kind === "opencode-go" && !opencodeSessionIdRef.current) {
      opencodeSessionIdRef.current = newId();
    }
    const activeApi = activeProvider
      ? {
          ...providerToApiSettings(activeProvider, undefined, opencodeSessionIdRef.current ?? undefined),
          isStreaming: false,
        }
      : null;
    if (!activeApi) {
      setExtractionState({
        phase: { phase: "failed", range, stage: "extract", message: "未找到可用的 API 配置" },
        skippedAtMessageCount: null,
      });
      return;
    }

    const abort = new AbortController();
    setExtractionState({
      phase: { phase: "extracting", range, abort },
      skippedAtMessageCount: null,
    });

    try {
      const { text } = await runExtraction({
        api: activeApi,
        material: range.messages,
        userName,
        charName,
        signal: abort.signal,
      });

      // Parse before ingest — bad output must not be stored.
      const parsed = parseExtraction(text);

      setExtractionState({
        phase: { phase: "ingesting", range, extracted: parsed.content },
        skippedAtMessageCount: null,
      });

      // Tag the last message of the extracted range so the sending side
      // can cut history at that boundary via messagesAfterBoundary().
      const batchSeq = nextBatchSeq(pendingSendRef.current?.baseMessages ?? []);
      const rangeLastMsg = range.messages[range.messages.length - 1];
      const taggedMsg = { ...rangeLastMsg, memoryBatchSeq: batchSeq };
      recompressMetaRef.current = { batchSeq, rangeLastMsgId: rangeLastMsg.id, taggedMsg };

      const result = await ingestMemory(stored.token, {
        sessionId: currentSession!.id!,
        batchSeq,
        content: parsed.content,
      });

      if (result.kind === "error") {
        if (result.error === "memory_char_max_reached") {
          // Memory quota full — attempt recompress before giving up.
          const batchesResult = await listMemoryBatches(stored.token, currentSession!.id!);
          if (batchesResult.kind !== "ok") {
            setExtractionState({
              phase: { phase: "failed", range, stage: "ingest", message: "无法获取已有记忆批次" },
              skippedAtMessageCount: null,
            });
            return;
          }
          const candidates = selectBatchesToMerge(batchesResult.data.batches);
          if (candidates.length === 0) {
            // Only 1 batch — nothing to merge. Tell the user and discard.
            setExtractionState({
              phase: { phase: "failed", range, stage: "ingest",
                message: "记忆配额已满且仅有一个批次，无法合并压缩。请删除不再需要的历史对话以释放配额。" },
              skippedAtMessageCount: null,
            });
            return;
          }
          // Assemble the merged material for re-extraction.
          const mergedContent = candidates
            .map((b, i) => `──── 归档 ${i + 1} ────\n${b.content}`)
            .join("\n\n");
          const recompressMaterial: Message[] = [{
            id: "__recompress__",
            role: "user",
            content: `以下是 ${candidates.length} 份按时间先后排列的归档，请合并压缩：\n\n${mergedContent}`,
          }];
          const recompressEstimate = estimateExtractionCost(recompressMaterial, {
            usedTokens: null, contextWindow: 32000, source: "fallback" as const,
            ratio: null, overThreshold: false, thresholdPct: 70,
          });
          setExtractionState({
            phase: {
              phase: "recompressPrompting",
              range,
              extracted: parsed.content,
              batches: candidates,
              estimate: recompressEstimate,
            },
            skippedAtMessageCount: null,
          });
          return;
        }
        setExtractionState({
          phase: { phase: "failed", range, stage: "ingest", message: result.error },
          skippedAtMessageCount: null,
        });
        return;
      }

      // Success — tag the message in both pending baseMessages and UI state,
      // then resume the deferred send.
      setExtractionState({ phase: { phase: "idle" }, skippedAtMessageCount: null });

      // Update pending baseMessages so the resumed send uses the tagged snapshot.
      const p = pendingSendRef.current;
      if (p) {
        const updatedBase = p.baseMessages.map((m: Message) =>
          m.id === rangeLastMsg.id ? taggedMsg : m,
        );
        pendingSendRef.current = { ...p, baseMessages: updatedBase };
        setMessages((prev) =>
          prev.map((m) => (m.id === rangeLastMsg.id ? taggedMsg : m)),
        );
        pendingSendRef.current = null;
        await sendChat(p.content, p.atts, updatedBase);
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        // User cancelled — treat as skip.
        setExtractionState({
          phase: { phase: "idle" },
          skippedAtMessageCount: messages.length,
        });
        const p = pendingSendRef.current;
        if (p) { pendingSendRef.current = null; await sendChat(p.content, p.atts, p.baseMessages); }
        return;
      }
      setExtractionState({
        phase: { phase: "failed", range, stage: "extract", message: err?.message || String(err) },
        skippedAtMessageCount: null,
      });
    }
  };

  /** User confirmed the recompress prompt — run extraction with recompress prompt,
   *  call recompressMemory, then retry the original ingest. */
  const confirmRecompress = async () => {
    const state = extractionRef.current;
    if (state.phase.phase !== "recompressPrompting") return;
    const { range, extracted, batches } = state.phase;

    const stored = await loadStoredAccount();
    if (!stored) {
      setExtractionState({ phase: { phase: "idle" }, skippedAtMessageCount: null });
      const p = pendingSendRef.current;
      if (p) { pendingSendRef.current = null; await sendChat(p.content, p.atts, p.baseMessages); }
      return;
    }

    const activeProvider = getActiveLlmProvider(settings);
    if (!activeProvider) {
      setExtractionState({
        phase: { phase: "failed", range, stage: "recompress", message: "当前 Provider 未配置" },
        skippedAtMessageCount: null,
      });
      return;
    }
    const activeApi = providerToApiSettings(activeProvider);

    const abort = new AbortController();
    setExtractionState({
      phase: { phase: "recompressing", range, extracted, batches, abort },
      skippedAtMessageCount: null,
    });

    try {
      // Merge batch content into one recompress material message.
      const mergedContent = batches
        .map((b, i) => `──── 归档 ${i + 1} ────\n${b.content}`)
        .join("\n\n");
      const recompressMaterial: Message[] = [{
        id: "__recompress__",
        role: "user",
        content: `以下是 ${batches.length} 份按时间先后排列的归档，请合并压缩：\n\n${mergedContent}`,
      }];

      const { text } = await runExtraction({
        api: activeApi,
        material: recompressMaterial,
        userName,
        charName,
        signal: abort.signal,
        systemPrompt: RECOMPRESS_SYSTEM_PROMPT,
      });

      const parsed = parseExtraction(text);

      const replaceSeqs = batches.map((b) => b.batchSeq);
      const rcResult = await recompressMemory(stored.token, {
        sessionId: currentSession!.id!,
        replaceBatchSeqs: replaceSeqs,
        content: parsed.content,
      });

      if (rcResult.kind === "error") {
        if (rcResult.error === "still_over_quota") {
          setExtractionState({
            phase: { phase: "failed", range, stage: "recompress", message: "压缩后仍超出配额，请删除不再需要的历史对话" },
            skippedAtMessageCount: null,
          });
          return;
        }
        setExtractionState({
          phase: { phase: "failed", range, stage: "recompress", message: rcResult.error },
          skippedAtMessageCount: null,
        });
        return;
      }

      // Recompress succeeded — retry the original ingest with the same batchSeq.
      const meta = recompressMetaRef.current;
      if (!meta) {
        setExtractionState({
          phase: { phase: "failed", range, stage: "recompress", message: "内部错误：缺少批次元数据" },
          skippedAtMessageCount: null,
        });
        return;
      }
      const retryResult = await ingestMemory(stored.token, {
        sessionId: currentSession!.id!,
        batchSeq: meta.batchSeq,
        content: extracted,
      });

      if (retryResult.kind === "error") {
        setExtractionState({
          phase: { phase: "failed", range, stage: "ingest", message: retryResult.error },
          skippedAtMessageCount: null,
        });
        return;
      }

      // Success — tag and resume.
      recompressMetaRef.current = null;
      setExtractionState({ phase: { phase: "idle" }, skippedAtMessageCount: null });
      const p = pendingSendRef.current;
      if (p) {
        const updatedBase = p.baseMessages.map((m: Message) =>
          m.id === meta.rangeLastMsgId ? meta.taggedMsg : m,
        );
        pendingSendRef.current = { ...p, baseMessages: updatedBase };
        setMessages((prev) =>
          prev.map((m) => (m.id === meta.rangeLastMsgId ? meta.taggedMsg : m)),
        );
        pendingSendRef.current = null;
        await sendChat(p.content, p.atts, updatedBase);
      }
    } catch (err: any) {
      if (err?.name === "AbortError") {
        setExtractionState({ phase: { phase: "idle" }, skippedAtMessageCount: messages.length });
        const p = pendingSendRef.current;
        if (p) { pendingSendRef.current = null; await sendChat(p.content, p.atts, p.baseMessages); }
        return;
      }
      setExtractionState({
        phase: { phase: "failed", range, stage: "recompress", message: err?.message || String(err) },
        skippedAtMessageCount: null,
      });
    }
  };

  /** User cancelled the recompress prompt — discard this extraction. */
  const cancelRecompress = async () => {
    setExtractionState({
      phase: { phase: "idle" },
      skippedAtMessageCount: messages.length,
    });
    const p = pendingSendRef.current;
    if (p) { pendingSendRef.current = null; await sendChat(p.content, p.atts, p.baseMessages); }
  };

  const skipExtraction = async () => {
    setExtractionState({
      phase: { phase: "idle" },
      skippedAtMessageCount: messages.length,
    });
    const p = pendingSendRef.current;
    if (p) { pendingSendRef.current = null; await sendChat(p.content, p.atts, p.baseMessages); }
  };

  const disableMemoryAndSend = async () => {
    const next = { ...settings, isMemoryEnabled: false };
    onSettingsChange(next);
    setExtractionState({ phase: { phase: "idle" }, skippedAtMessageCount: null });
    const p = pendingSendRef.current;
    if (p) { pendingSendRef.current = null; await sendChat(p.content, p.atts, p.baseMessages); }
  };

  const cancelExtraction = () => {
    const state = extractionRef.current;
    if (state.phase.phase === "extracting") {
      state.phase.abort.abort();
    }
  };

  const retryExtraction = async () => {
    const state = extractionRef.current;
    if (state.phase.phase !== "failed") return;
    const { range, stage } = state.phase;

    if (stage === "extract" || stage === "recompress") {
      // Re-run extraction — restart from prompting.
      const estimate = estimateExtractionCost(
        range.messages,
        computeContextBudget({
          messages,
          modelId: getActiveLlmProvider(settings)?.lastUsedModel ?? "",
          entry: undefined,
          settings,
        }),
      );
      setExtractionState({
        phase: { phase: "prompting", range, estimate },
        skippedAtMessageCount: null,
      });
    } else {
      // stage === "ingest" — re-send the extracted text without re-running model.
      const stored = await loadStoredAccount();
      if (!stored) {
        setExtractionState({ phase: { phase: "idle" }, skippedAtMessageCount: null });
        const p = pendingSendRef.current;
        if (p) { pendingSendRef.current = null; await sendChat(p.content, p.atts, p.baseMessages); }
        return;
      }

      // The extracted text should be in the failed state, but P3 doesn't carry
      // it. For now, fall through to re-extract.
      setExtractionState({
        phase: { phase: "prompting", range, estimate: { inputTokens: 0, outputTokens: 0, totalTokens: 0, rough: true } },
        skippedAtMessageCount: null,
      });
    }
  };

  const skipFailedExtraction = async () => {
    setExtractionState({
      phase: { phase: "idle" },
      skippedAtMessageCount: messages.length,
    });
    const p = pendingSendRef.current;
    if (p) { pendingSendRef.current = null; await sendChat(p.content, p.atts, p.baseMessages); }
  };

  // Allow App (and thus sibling modals like BypassModal) to inject a message
  // as if the user had typed and sent it. Mirrors handleSubmit's guard +
  // baseMessages handoff so the injected turn behaves identically.
  useImperativeHandle(ref, () => ({
    sendUserMessage: (text: string) => {
      if (isLoadingRef.current) return;
      if (!text.trim()) return;
      // 卡片脚本初始化窗口内不发送：避免"脚本写变量"与"用户追加消息"交错。
      // （写回路径已改成只增不减、不会丢数据；这里只是把窗口期的不确定性再收窄，
      //  上限 5s，到点自动放行——见 plugins/js-slash-runner 的 INIT_BUSY_MAX_MS。）
      if (getScriptInitBusy()) return;
      void sendChatRef.current!(text, [], messagesRef.current);
    },
  }), []);


  // Auto-save current session when messages change. Debounced 800ms so the
  // stream-of-tokens path doesn't trigger a full JSON.stringify + setItem on
  // every chunk — long sessions could otherwise stall the main thread and
  // approach the localStorage quota much faster than necessary.
  useEffect(() => {
    if (messages.length === 0) return;
    const userMessages = messages.filter(m => m.role === "user");
    if (userMessages.length === 0) return;
    const timer = setTimeout(async () => {
      const session: ChatSession = {
        id: currentSession?.id ?? newId(),
        ...(opencodeSessionIdRef.current ? { opencodeSessionId: opencodeSessionIdRef.current } : {}),
        characterId: currentSession?.characterId ?? currentCharacter?.id ?? "default",
        characterName: currentSession?.characterName ?? charName,
        messages,
        createdAt: currentSession?.createdAt ?? Date.now(),
        // ⚠️ 这里是**逐字段重建**（不是 spread currentSession），因此任何新增的
        // 会话级字段都必须显式带上，否则第一次自动保存就把它丢掉。
        // `variables` = 变量层的 chat 作用域（SSOT §2.5 / D3①）。
        ...(currentSession?.variables ? { variables: currentSession.variables } : {}),
      };
      try {
        await saveSession(session);
        if (!currentSession || currentSession.id !== session.id) {
          onSessionChange(session);
        }
      } catch (err: any) {
        console.error("Auto-save failed", err);
        const isQuota =
          err?.name === "QuotaExceededError" || /quota/i.test(err?.message || "");
        let usedMb = "?";
        try {
          const est = await navigator.storage?.estimate?.();
          usedMb = est?.usage ? (est.usage / (1024 * 1024)).toFixed(1) : "?";
        } catch { /* keep "?" */ }
        setSaveError(
          isQuota
            ? `存储空间已满（${usedMb} MB），当前消息未能保存。请在「聊天记录」中删除部分历史，或在「角色选择」中删除不常用的角色后刷新页面。`
            : "消息保存失败：" + (err?.message || String(err)),
        );
      }
    }, 800);
    return () => clearTimeout(timer);
    // TODO(#23 audit): effect reads currentSession/currentCharacter via stale
    // closure. Plan: move auto-save to a useEffectEvent or refactor when
    // ChatInterface is split (audit task #20).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const clearChat = () => {
    opencodeSessionIdRef.current = null;
    onSessionChange(null);
    setMessages(buildFirstMes(currentCharacter));
  };

  const handleDeleteMessage = useCallback((id: string) => {
    setMessages((prev) => {
      const deletedIndex = prev.findIndex((m) => m.id === id);
      const seq = prev[deletedIndex]?.memoryBatchSeq;
      const next = prev.filter((m) => m.id !== id);
      // Transfer boundary marker to the previous message when the deleted one
      // held it — otherwise the cut point silently disappears and the full
      // history is sent on the next turn. If the deleted message is the first
      // one (index 0), the marker is dropped (nothing left above it to cut).
      if (seq !== undefined && deletedIndex > 0) {
        const targetIdx = deletedIndex - 1;
        const target = next[targetIdx];
        // Preserve an earlier marker if the previous message already has one.
        next[targetIdx] = { ...target, memoryBatchSeq: target.memoryBatchSeq ?? seq };
      }
      return next;
    });
  }, []);

  const handleEditMessage = useCallback((id: string, newContent: string) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, content: newContent } : m)));
  }, []);

  // P0: stabilized with empty deps — reads the hot-path refs so the callback
  // identity never changes across keystrokes / stream tokens, allowing
  // React.memo on every MessageItem to actually skip re-renders.
  const handleRegenerate = useCallback((id: string) => {
    const msgs = messagesRef.current;
    if (isLoadingRef.current) return;
    const idx = msgs.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const trimmed = msgs.slice(0, idx);
    const lastUser = [...trimmed].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const withoutLastUser = trimmed.filter((m) => m.id !== lastUser.id);
    setMessages(withoutLastUser);
    void sendChatRef.current!(lastUser.content, [], withoutLastUser);
  }, []);

  // Resolve image-gen readiness from the v2 active image provider. Two
  // families are supported:
  //   - OpenAI-compatible (qiny / openai-custom): needs apiKey + a model
  //   - ComfyUI (comfyui-fixed / comfyui-custom): needs a workflow (model);
  //     custom additionally needs a server URL. No apiKey required.
  const activeImageProvider = getActiveImageProvider(settings);
  const activeImageApi = activeImageProvider
    ? imageProviderToApiSettings(activeImageProvider)
    : null;
  const isComfyImage =
    activeImageProvider?.kind === "comfyui-fixed" ||
    activeImageProvider?.kind === "comfyui-custom";
  // P6: only the project's own NyaaComfyUI instance (comfyui-fixed) enters
  // the ComfyUI pack billing. User-custom ComfyUI servers are not billed.
  const isComfyPack = activeImageProvider?.kind === "comfyui-fixed";
  const isImageApiReady = (() => {
    if (!activeImageProvider || !activeImageProvider.enabled) return false;
    if (isComfyImage) {
      const hasWorkflow = !!(activeImageProvider.lastUsedModel || activeImageProvider.models[0]);
      const hasServer =
        activeImageProvider.kind === "comfyui-fixed" || !!activeImageProvider.baseUrl;
      return hasWorkflow && hasServer;
    }
    // OpenAI-compatible families.
    return !!activeImageApi?.apiKey && !!activeImageApi?.model;
  })();

  /**
   * P6: ComfyUI pack gate — verifies login + remaining credits.
   * Opens UserAccountModal or the exhausted ConfirmDialog as needed.
   * Returns the stored account on pass, or null if generation must abort.
   */
  async function checkComfyGate(): Promise<StoredAccount | null> {
    const account = await loadStoredAccount();
    if (!account) {
      setIsAccountOpen(true);
      return null;
    }
    if (account.profile.comfyuiPackRemaining <= 0) {
      setShowExhaustedDialog(true);
      return null;
    }
    return account;
  }

  /**
   * Run the image API for `prompt` and insert the resulting image as a new
   * assistant bubble immediately after `anchorId`. If `replaceImageId` is
   * given (regenerate path), the existing image bubble is replaced in place
   * instead so position and id stay stable.
   */
  const runImageGeneration = useCallback(
    async (prompt: string, anchorId: string, replaceImageId?: string) => {
      if (!isImageApiReady) {
        onAddLog({
          direction: "error",
          content: "Image API not configured",
        });
        return;
      }
      // Image gen and chat completion share the loading lock + abort controller
      // so the composer's stop button can cancel either, and the user can't
      // accidentally start a second request while one is in flight.
      if (isLoadingRef.current) return;

      const targetId = replaceImageId ?? newId();
      setImageGeneratingId(targetId);
      setIsLoading(true);

      // For first-time generation we add a placeholder bubble right away
      // so the user has something to look at while the request runs.
      if (!replaceImageId) {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === anchorId);
          const placeholder: Message = {
            id: targetId,
            role: "assistant",
            content: prompt,
            imagePrompt: prompt,
            imageUrl: undefined,
            timestamp: Date.now(),
          };
          if (idx === -1) return [...prev, placeholder];
          return [...prev.slice(0, idx + 1), placeholder, ...prev.slice(idx + 1)];
        });
      }

      const controller = new AbortController();
      abortControllerRef.current = controller;

      // Declared outside the try so the catch can report elapsed time too.
      let imageStartedAt = Date.now();
      try {
        if (!activeImageProvider || !activeImageApi) {
          throw new Error("Image provider not configured");
        }

        if (isComfyImage) {
          // ComfyUI path: workflow graph submitted to the same-origin proxy,
          // progress streamed over ws. The "model" is the workflow name.
          const workflowName =
            activeImageProvider.lastUsedModel ||
            activeImageProvider.models[0]?.id ||
            "ComfyUI";
          onAddLog({
            direction: "request",
            content: "Sending ComfyUI image generation request",
            meta: {
              provider: activeImageProvider.kind,
              workflow: workflowName,
              size: activeImageProvider.comfySize,
              artStyle: activeImageProvider.comfyArtStyle,
              prompt,
            },
          });
          imageStartedAt = Date.now();
          const url = await generateComfyImage({
            provider: activeImageProvider,
            prompt,
            onProgress: (p) => setComfyProgress({ id: targetId, p }),
            signal: controller.signal,
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === targetId
                ? {
                    ...m,
                    role: "assistant",
                    content: prompt,
                    imagePrompt: prompt,
                    imageUrl: url,
                    model: workflowName,
                    timestamp: m.timestamp ?? Date.now(),
                  }
                : m,
            ),
          );
          onAddLog({
            direction: "response",
            content: "Received ComfyUI image",
            meta: { workflow: workflowName, durationMs: Date.now() - imageStartedAt },
          });

          // P6: deduct 1 credit from the ComfyUI pack.
          // Only comfyui-fixed (NyaaComfyUI) enters pack billing;
          // comfyui-custom (user's own server) is not billed.
          // Fire-and-forget: the image is already delivered to the user,
          // so a deduction failure must not block the UX.
          if (activeImageProvider?.kind === "comfyui-fixed") {
            loadStoredAccount().then((acct) => {
              if (!acct) return; // shouldn't happen (gate passed), but safe
              consumeComfyuiPack(acct.token)
                .then((r) => {
                  if (r.kind === "error") {
                    onAddLog({
                      direction: "info",
                      content: "ComfyUI 图包消费失败",
                      meta: { error: r.error, status: r.status },
                    });
                  }
                  // "ok": remaining decremented successfully (no action needed)
                  // "network": server unreachable, silently ignored
                })
                .catch(() => { /* non-blocking: prevent unhandled rejection */ });
            });
          }
        } else {
          // OpenAI-compatible path.
          // Wire-level size strategy (kept in sync with imageApi.ts):
          //   默认           → field omitted (regardless of model)
          //   gpt-image-2 4K → "3840x2160" → fallback "2048x2048"
          //   其他模型 4K    → "3840x2160" → fallback omitted
          const isGptImage2 = /gpt-image-2/i.test(activeImageApi.model);
          const sizeWirePlan =
            activeImageApi.size === "4k"
              ? `3840x2160 → fallback ${isGptImage2 ? "2048x2048" : "(omitted)"}`
              : "(omitted)";
          onAddLog({
            direction: "request",
            content: "Sending image generation request",
            meta: {
              model: activeImageApi.model,
              sizeChoice: activeImageApi.size,
              sizeWire: sizeWirePlan,
              prompt,
            },
          });
          // Reset to the moment we actually hand off to the network.
          imageStartedAt = Date.now();
          const url = await generateImage(prompt, activeImageApi, controller.signal);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === targetId
                ? {
                    ...m,
                    role: "assistant",
                    content: prompt,
                    imagePrompt: prompt,
                    imageUrl: url,
                    model: activeImageApi.model,
                    timestamp: m.timestamp ?? Date.now(),
                  }
                : m,
            ),
          );
          onAddLog({
            direction: "response",
            content: "Received image",
            meta: { model: activeImageApi.model, url, durationMs: Date.now() - imageStartedAt },
          });
        }
      } catch (err: any) {
        const isAbort =
          err?.name === "AbortError" ||
          controller.signal.aborted ||
          /已取消|aborted/i.test(err?.message || "");
        const description = isAbort ? "请求已停止" : describeError(err);
        onAddLog({
          direction: isAbort ? "info" : "error",
          content: isAbort
            ? "Image generation aborted by user"
            : "Failed during image generation",
          meta: { error: description, status: err?.status, durationMs: Date.now() - imageStartedAt },
        });
        if (replaceImageId) {
          // Regenerate path: keep the existing image. On abort just dismiss
          // the spinner silently; on real failures surface the reason so the
          // user knows nothing changed.
          if (!isAbort) alert(`生图失败:${description}`);
        } else {
          // First-time path: convert the placeholder into a status line so
          // the bubble doesn't sit empty forever.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === targetId
                ? {
                    ...m,
                    imageUrl: undefined,
                    imagePrompt: undefined,
                    content: isAbort
                      ? "**[已停止生成图片]**"
                      : `**生图失败:** ${description}`,
                  }
                : m,
            ),
          );
        }
      } finally {
        setImageGeneratingId((cur) => (cur === targetId ? null : cur));
        setComfyProgress((cur) => (cur?.id === targetId ? null : cur));
        setIsLoading(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [isImageApiReady, activeImageApi, activeImageProvider, isComfyImage, onAddLog],
  );

  /**
   * Generate an English image prompt for the ComfyUI path by asking the active
   * chat LLM to rewrite the scene (the anima checkpoint is English-only). Falls
   * back to the terse builder when no chat model is configured.
   */
  const buildEnglishComfyPrompt = useCallback(
    async (msg: Message, signal?: AbortSignal): Promise<string> => {
      const llm = getActiveLlmProvider(settings);
      const modelId = llm?.lastUsedModel || llm?.models[0]?.id;
      if (!llm || !llm.enabled || !modelId) {
        throw new Error("未启用对话模型，无法生成英文提示词");
      }
      const { system, user } = buildComfyPromptRequest({
        targetMessage: msg,
        baseMessages: messagesRef.current,
        currentCharacter,
        settings,
        userName,
        charName,
      });
      const apiSettings: ApiSettings = {
        ...providerToApiSettings(llm, modelId),
        isStreaming: false,
      };
      const apiMessages: ApiMessage[] = [
        { role: "system", content: system },
        { role: "user", content: user },
      ];
      let text = "";
      await fetchChatCompletion(
        apiMessages,
        apiSettings,
        (chunk) => {
          text += chunk;
        },
        signal,
      );
      const out = text.trim();
      if (!out) throw new Error("英文提示词生成为空");
      return out;
    },
    [currentCharacter, settings, userName, charName],
  );

  /**
   * COMFYUI_FIXED (NyaaComfyUI) prompt builder — dual-path.
   *
   * When the deployer-paid T2I agent is enabled, assembles the structured
   * {system, user} pair (P2) and calls the ext-host agent endpoint (P1) —
   * no API key ever reaches the frontend.
   *
   * When disabled, falls back to the user's own chat LLM.
   * When any LLM path fails, the caller falls back to buildImagePrompt.
   */
  const buildFixedComfyPrompt = useCallback(
    async (msg: Message, signal?: AbortSignal): Promise<string> => {
      const { system, user } = buildFixedComfyPromptRequest({
        targetMessage: msg,
        baseMessages: messagesRef.current,
        currentCharacter,
        settings,
        userName,
        charName,
      });

      // ── Deployer-paid agent path (AGENT_ENABLE=true) ──
      if (__COMFYUI_FIXED_T2I_AGENT_ENABLE__) {
        return await fetchT2iAgentPrompt(system, user, signal);
      }

      // ── User's chat LLM path (AGENT_ENABLE=false) ──
      const llm = getActiveLlmProvider(settings);
      const modelId = llm?.lastUsedModel || llm?.models[0]?.id;
      if (!llm || !llm.enabled || !modelId) {
        throw new Error("未启用对话模型，无法生成英文提示词");
      }
      const apiSettings: ApiSettings = {
        ...providerToApiSettings(llm, modelId),
        isStreaming: false,
      };
      const apiMessages: ApiMessage[] = [
        { role: "system", content: system },
        { role: "user", content: user },
      ];
      let text = "";
      await fetchChatCompletion(
        apiMessages,
        apiSettings,
        (chunk) => { text += chunk; },
        signal,
      );
      const out = text.trim();
      if (!out) throw new Error("英文提示词生成为空");
      return out;
    },
    [currentCharacter, settings, userName, charName],
  );

  const handleGenerateImage = useCallback(
    async (id: string) => {
      if (isLoadingRef.current) return;
      const msg = messagesRef.current.find((m) => m.id === id);
      if (!msg) return;

      // ── COMFYUI_FIXED (NyaaComfyUI) ── scaffold, design pending ──────────
      if (isComfyPack) {
        const gate = await checkComfyGate();
        if (!gate) return;

        setImageGeneratingId(id);
        let prompt = "";
        try {
          prompt = (await buildFixedComfyPrompt(msg)).trim();
        } catch (err: any) {
          onAddLog({
            direction: "info",
            content: "ComfyUI (fixed) English-prompt LLM unavailable, falling back to terse builder",
            meta: { error: err?.message || String(err) },
          });
          prompt = buildImagePrompt({
            targetMessage: msg,
            baseMessages: messagesRef.current,
            currentCharacter,
            settings,
            userName,
            charName,
          }).trim();
        } finally {
          setImageGeneratingId((cur) => (cur === id ? null : cur));
        }
        if (!prompt) return;
        void runImageGeneration(prompt, id);
        return;
      }

      // ── comfyui-custom ── user's own ComfyUI server ───────────────────────
      if (isComfyImage) {
        setImageGeneratingId(id);
        let prompt = "";
        try {
          prompt = (await buildEnglishComfyPrompt(msg)).trim();
        } catch (err: any) {
          onAddLog({
            direction: "info",
            content: "ComfyUI (custom) English-prompt LLM unavailable, falling back to terse builder",
            meta: { error: err?.message || String(err) },
          });
          prompt = buildImagePrompt({
            targetMessage: msg,
            baseMessages: messagesRef.current,
            currentCharacter,
            settings,
            userName,
            charName,
          }).trim();
        } finally {
          setImageGeneratingId((cur) => (cur === id ? null : cur));
        }
        if (!prompt) return;
        void runImageGeneration(prompt, id);
        return;
      }

      // ── QinyAPI / OpenAI-compatible ───────────────────────────────────────
      const prompt = buildImagePrompt({
        targetMessage: msg,
        baseMessages: messagesRef.current,
        currentCharacter,
        settings,
        userName,
        charName,
      }).trim();
      if (!prompt) return;
      void runImageGeneration(prompt, id);
    },
    [
      runImageGeneration,
      currentCharacter,
      settings,
      userName,
      charName,
      isComfyImage,
      isComfyPack,
      buildEnglishComfyPrompt,
      buildFixedComfyPrompt,
      onAddLog,
    ],
  );

  const handleRegenerateImage = useCallback(
    async (id: string) => {
      const msg = messagesRef.current.find((m) => m.id === id);
      if (!msg || !msg.imageUrl) return;
      const prompt = (msg.imagePrompt || msg.content || "").trim();
      if (!prompt) return;

      // P6: gate check for ComfyUI regenerate — only NyaaComfyUI (comfyui-fixed)
      if (isComfyPack) {
        const gate = await checkComfyGate();
        if (!gate) return;
      }

      void runImageGeneration(prompt, id, id);
    },
    [runImageGeneration, isComfyPack],
  );

  // Load session when selected from history
  useEffect(() => {
    if (currentSession) {
      // 临时诊断：这次"从 prop 同步 messages"会不会把刚写入的楼层变量覆盖掉。
      try {
        const w = window as unknown as { __nyaVarTrace?: unknown[] };
        w.__nyaVarTrace = (w.__nyaVarTrace || [])
          .concat([
            {
              t: Date.now(),
              k: "syncFromProp",
              id: currentSession.id,
              len: currentSession.messages.length,
              vars0: Array.isArray(currentSession.messages[0]?.variables),
              withVars: currentSession.messages.filter((m) => Array.isArray(m.variables) && m.variables[0] && Object.keys(m.variables[0]).length > 0).length,
            },
          ])
          .slice(-60);
      } catch {
        /* ignore */
      }
      setMessages(currentSession.messages);
    }
    // Depending on the id alone is intentional: when the same session object
    // is passed back (e.g. after rename) we don't want to re-import messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSession?.id]);

  // Bypass indicator for the header flame. ClavisSalomonis used to drive this
  // via `bypass.enabled`; that module is retired, so the indicator now follows
  // the AnswererFlagalac target selection (any non-"none" target = active).
  const isBypassActive = settings.bypass.answererFlagalac.target !== "none";

  return (
    <div className="flex flex-col h-screen bg-[#FCFCFD] dark:bg-[#0A0A0A] text-gray-900 dark:text-gray-100 font-sans selection:bg-blue-500/30 selection:text-blue-900 dark:selection:text-blue-100 transition-colors duration-300">
      {/* Decorative background gradients */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden flex justify-center z-0">
        <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 w-[60%] h-[40%] bg-blue-500/5 dark:bg-blue-500/10 blur-[120px] rounded-full mix-blend-multiply dark:mix-blend-screen" />
      </div>

      {/* Top Toolbar */}
      <ChatHeader
        characters={settings.characters}
        currentCharacterId={settings.currentCharacterId}
        isBypassActive={isBypassActive}
        isFullscreenSupported={isFullscreenSupported}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onOpenConsole={onOpenConsole}
        onOpenBypass={onOpenBypass}
        onOpenSettings={onOpenSettings}
        onOpenCharacterSelection={onOpenCharacterSelection}
        onOpenUserRole={onOpenUserRole}
        onOpenChatHistory={onOpenChatHistory}
        onClearChat={clearChat}
        onUpdateCharacterRegex={(characterId, scripts) =>
          onSettingsChange({
            ...settings,
            characters: settings.characters.map((c) =>
              c.id === characterId ? { ...c, regexScripts: scripts } : c,
            ),
          })
        }
      />

      {/* Main Chat Area */}
      <main id="chat" className="flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth z-10 relative">
        {saveError && (
          <div className="mx-auto max-w-2xl mb-3 px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-400 text-xs flex items-start gap-2">
            <span className="shrink-0 mt-0.5">⚠</span>
            <span className="flex-1">{saveError}</span>
            <button
              className="shrink-0 text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 ml-1"
              onClick={() => setSaveError(null)}
            >
              ×
            </button>
          </div>
        )}
        {messages.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="min-h-full flex flex-col items-center justify-center text-center"
            >
              <div className="w-20 h-20 bg-white dark:bg-white/5 border border-gray-100 dark:border-white/10 shadow-elevation-1 rounded-3xl flex items-center justify-center mb-8 relative">
                <Sparkles
                  size={32}
                  className="text-blue-500 dark:text-blue-400"
                />
              </div>
              <h2
                className="text-2xl font-semibold mb-3 tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                欢迎使用 NyaaChat
              </h2>
              <p className="text-gray-500 dark:text-gray-400 max-w-[280px] sm:max-w-sm text-sm leading-relaxed">
                请先点击右上角设置图标配置 API Key 与模型。开启 Bypass
                后，您的请求将被应用学术性破除限制提示词架构。
              </p>
            </motion.div>
          ) : (
            <>
              <AnimatePresence initial={false}>
                {messages.flatMap((message, idx) => {
                  const nodes: React.ReactNode[] = [
                    <MessageItem
                      key={message.id}
                      message={message}
                      mesid={idx}
                      userName={currentUserRole?.name}
                      charName={currentCharacter?.name}
                      onDelete={handleDeleteMessage}
                      onRegenerate={handleRegenerate}
                      onEdit={handleEditMessage}
                      onGenerateImage={isImageApiReady ? handleGenerateImage : undefined}
                      onRegenerateImage={isImageApiReady ? handleRegenerateImage : undefined}
                      imageGenerating={imageGeneratingId === message.id}
                      imageProgressText={
                        comfyProgress?.id === message.id
                          ? formatComfyProgress(comfyProgress.p)
                          : undefined
                      }
                      busy={isLoading}
                      // t17: retry status line for THIS bubble only. A primitive
                      // (undefined / string) exactly like `imageProgressText`, so
                      // a bubble with no notice gets the same value it had before
                      // this feature and React.memo keeps skipping it; the
                      // generating bubble's value genuinely changes when a new
                      // notice arrives, which is what busts its memo and paints
                      // the line. The `isLoading` + msgId gate means a notice left
                      // over from a finished/aborted turn can never render (they
                      // are also cleared together in sendChat's finally, and reset
                      // at the start of every turn).
                      retryNoticeText={
                        isLoading && retryNoticeMsgId === message.id
                          ? retryNoticeText
                          : undefined
                      }
                      regexScripts={displayRegexScripts}
                      decodeFlagalacEscapes={flagalacDecodeEscapes}
                      coverUrl={coverUrl}
                      frontendRenderingEnabled={
                        settings.isFrontendRenderingEnabled &&
                        (settings.frontendRenderingDepth === 0 ||
                          messages.length - idx <= settings.frontendRenderingDepth)
                      }
                    />,
                  ];
                  if (message.memoryBatchSeq !== undefined) {
                    nodes.push(
                      <MemoryDivider key={`mb-${message.id}`} seq={message.memoryBatchSeq} />,
                    );
                  }
                  return nodes;
                })}
              </AnimatePresence>
              <div ref={messagesEndRef} className="h-6" />
            </>
          )}
      </main>

      {/* Input Area */}

      {/* Extraction progress bar — shown above the composer during active phases. */}
      {extractionState.phase.phase === "extracting" && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/5 border-t border-blue-200 dark:border-blue-500/10">
          <Loader2 size={14} className="animate-spin" />
          <span>正在整理早期对话记忆…</span>
          <button onClick={cancelExtraction} className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline">
            取消
          </button>
        </div>
      )}
      {extractionState.phase.phase === "ingesting" && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-500/5 border-t border-green-200 dark:border-green-500/10">
          <Loader2 size={14} className="animate-spin" />
          <span>正在保存记忆…</span>
        </div>
      )}
      {extractionState.phase.phase === "recompressing" && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-500/5 border-t border-purple-200 dark:border-purple-500/10">
          <Loader2 size={14} className="animate-spin" />
          <span>正在压缩已有记忆…</span>
          <button onClick={cancelExtraction} className="ml-auto text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline">
            取消
          </button>
        </div>
      )}
      {extractionState.phase.phase === "failed" && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/5 border-t border-red-200 dark:border-red-500/10">
          <span className="truncate">记忆提炼失败：{extractionState.phase.message}</span>
          <button onClick={retryExtraction} className="ml-auto text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">
            重试
          </button>
          <button onClick={skipFailedExtraction} className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 underline whitespace-nowrap">
            跳过本次
          </button>
        </div>
      )}

      <ChatComposer
        input={input}
        onInputChange={setInput}
        attachments={attachments}
        onAddFiles={addFiles}
        onRemoveAttachment={removeAttachment}
        onSubmit={handleSubmit}
        onStop={handleStop}
        isLoading={isLoading}
        extractionActive={extractionState.phase.phase !== "idle" && extractionState.phase.phase !== "failed"}
        settings={settings}
        onSettingsChange={onSettingsChange}
      />

      {/* P6: ComfyUI pack modals */}
      <UserAccountModal isOpen={isAccountOpen} onClose={() => setIsAccountOpen(false)} />

      <ConfirmDialog
        isOpen={showExhaustedDialog}
        title="NyaaComfyui图包 剩余次数不足"
        message="NyaaComfyui图包 剩余次数不足，是否要扩容？"
        confirmText="扩容"
        cancelText="取消"
        onConfirm={() => {
          setShowExhaustedDialog(false);
          setIsAccountOpen(true);
        }}
        onCancel={() => setShowExhaustedDialog(false)}
      />

      {/* Persistent memory extraction prompt */}
      {extractionState.phase.phase === "prompting" && (() => {
        const p = extractionState.phase as { phase: "prompting"; range: import("../lib/memoryExtraction").ExtractionRange; estimate: import("../lib/memoryExtraction").TokenEstimate };
        const { range, estimate } = p;
        const budget = computeContextBudget({
          messages,
          modelId: getActiveLlmProvider(settings)?.lastUsedModel ?? "",
          entry: undefined,
          settings,
        });
        const pct = budget.ratio != null ? Math.round(budget.ratio * 100) : "?";
        const windowLabel = budget.source === "fallback" ? `${budget.contextWindow.toLocaleString()}（估算）` : budget.contextWindow.toLocaleString();
        const activeProvider = getActiveLlmProvider(settings);
        const modelName = activeProvider
          ? providerToApiSettings(activeProvider).model
          : "当前模型";

        return (
          <ConfirmDialog
            isOpen={true}
            title="整理早期对话记忆"
            confirmText="开始提炼"
            cancelText="本次跳过"
            message={
              <div className="space-y-2 text-left">
                <p>当前对话已占用约 {budget.usedTokens?.toLocaleString() ?? "?"} / {windowLabel} tokens（{pct}%），接近模型上限。</p>
                <p>可以把最早的 {range.count} 条消息提炼成事实摘要存入记忆，之后模型按需回忆，早期逐字原文不再随每轮发送。</p>
                <ul className="list-disc list-inside space-y-1 text-gray-500 dark:text-gray-400">
                  <li>提炼使用你当前的对话模型「{modelName}」，消耗你自己的 API 额度</li>
                  <li>本次预计消耗约 {estimate.totalTokens} tokens（输入 {estimate.inputTokens} + 输出 {estimate.outputTokens}，为估算值）</li>
                  <li>提炼出的事实摘要以明文存储在服务器上（聊天记录本身仍为端到端加密）</li>
                </ul>
                <button
                  onClick={() => {
                    disableMemoryAndSend();
                  }}
                  className="text-xs text-gray-400 hover:text-red-500 underline pt-1"
                >
                  不再自动提炼
                </button>
              </div>
            }
            onConfirm={confirmExtraction}
            onCancel={skipExtraction}
          />
        );
      })()}

      {/* Persistent memory recompress prompt */}
      {extractionState.phase.phase === "recompressPrompting" && (() => {
        const p = extractionState.phase as {
          phase: "recompressPrompting";
          range: import("../lib/memoryExtraction").ExtractionRange;
          extracted: string;
          batches: import("../lib/knowledgeApi").MemoryBatch[];
          estimate: import("../lib/memoryExtraction").TokenEstimate;
        };
        const { batches, estimate } = p;
        return (
          <ConfirmDialog
            isOpen={true}
            title="记忆配额已满"
            confirmText="压缩并继续"
            cancelText="取消，丢弃本次提炼"
            message={
              <div className="space-y-2 text-left">
                <p>记忆配额已满，需要将已有的 {batches.length} 个批次合并压缩后才能存入本次结果。</p>
                <p>压缩会调用模型进行一次合并，预计消耗约 {estimate.totalTokens} tokens。</p>
                <p>如果压缩后仍超配额，本次提炼结果将被丢弃。</p>
              </div>
            }
            onConfirm={confirmRecompress}
            onCancel={cancelRecompress}
          />
        );
      })()}
    </div>
  );
});
