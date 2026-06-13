import React, { useState, useRef, useEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { Sparkles } from "lucide-react";
import { ApiSettings, Message, AppState, LogEntry, ChatSession } from "../types";
import { fetchChatCompletion, type LlmTool, type ToolExecutor } from "../lib/api";
import { generateImage } from "../lib/imageApi";
import { newId } from "../lib/id";
import { saveSession } from "../lib/sessionStorage";
import { getActiveImageProvider, getActiveLlmProvider, imageProviderToApiSettings, providerToApiSettings } from "../lib/providers";
import { searchWeb, WebSearchError, WEB_SEARCH_FEATURE_ENABLED } from "../lib/searchApi";
import { callTool, listTools, mergeUserCity, filterAdvertised } from "../lib/mcpApi";
import {
  applyPlaceholders,
  buildImagePrompt,
  buildMessageContent,
  buildRequestMessages,
  buildSearchContext,
} from "../lib/chatPipeline";
import { MessageItem } from "./MessageItem";
import { ChatHeader } from "./ChatHeader";
import { ChatComposer } from "./ChatComposer";
import { motion, AnimatePresence } from "motion/react";
import { useFullscreen } from "../hooks/useFullscreen";
import { useAttachments } from "../hooks/useAttachments";
import { syncChat, syncMeta, getEffectiveRegexScripts } from "../compat";

/**
 * Map a thrown error from the API layer to a user-friendly Chinese message.
 * Recognizes HTTP status codes (via ApiHttpError.status), AbortController
 * timeouts, and the network-level browser strings that indicate a CORS or
 * DNS / TLS failure.
 */
function describeError(err: any): string {
  if (!err) return "未知错误";
  const status = err?.status;
  if (typeof status === "number") {
    if (status === 401) return "API Key 无效或已失效 (401)";
    if (status === 403) return "没有访问权限,请检查 Key 与模型 (403)";
    if (status === 404) return "接口或模型不存在,请检查 Base URL/模型名 (404)";
    if (status === 429) return "触发速率限制或额度不足 (429)";
    if (status >= 500) return `上游服务错误 (${status}),请稍后重试`;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

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

  // Effective regex chain (global + this character), enabled-only. Memoized so
  // MessageItem's memo isn't busted every render by a fresh array identity.
  // Recomputed on character switch; global scripts are cached in the store, so
  // edits there take effect on the next character change or reload.
  const regexScripts = useMemo(
    () => getEffectiveRegexScripts(currentCharacter),
    [currentCharacter],
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

  // Compat layer: mirror the live chat into the module-level runtimeStore so
  // SillyTavern-compatible extensions and the front-end-card render pipeline
  // can read it synchronously. One-way only (React → store); the store never
  // writes back into React state. See src/compat/runtimeStore.ts.
  useEffect(() => {
    syncChat(messages);
  }, [messages]);

  // Mirror the active character / user identity into the compat runtime.
  // Keyed on the resolved ids/names so a character or role switch propagates
  // without re-running on every message change.
  useEffect(() => {
    const chid = currentCharacter
      ? (settings.characters?.findIndex((c) => c.id === currentCharacter.id) ?? null)
      : null;
    syncMeta({
      characterId: currentCharacter?.id ?? null,
      characterName: currentCharacter?.name ?? null,
      userName: currentUserRole?.name ?? null,
      chid: chid === -1 ? null : chid,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCharacter?.id, currentCharacter?.name, currentUserRole?.name]);

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
    setMessages(buildFirstMes(currentCharacter));
    // Intentionally only depends on the character ID, not the whole character
    // object — editing a character's content shouldn't reset the live chat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.currentCharacterId]);

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
    const activeApi: ApiSettings | null = activeProvider
      ? { ...providerToApiSettings(activeProvider), isStreaming: settings.isStreaming }
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

    const processedInput = applyPlaceholders(content, userName, charName);
    const messageContent = buildMessageContent(processedInput, atts);

    const newUserMessage: Message = {
      id: newId(),
      role: "user",
      content:
        typeof messageContent === "string" ? messageContent : processedInput,
      timestamp: Date.now(),
    };
    const botMessageId = newId();

    setMessages((prev) => [
      ...prev,
      newUserMessage,
      { id: botMessageId, role: "assistant", content: "", timestamp: Date.now() },
    ]);
    setIsLoading(true);

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
        | { tools: LlmTool[]; executeTool: ToolExecutor; onToolEvent: (e: any) => void }
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

      const messagesForApi = buildRequestMessages({
        processedInput,
        messageContent,
        baseMessages,
        settings,
        currentCharacter,
        userName,
        charName,
        searchContext: searchContext ?? undefined,
        mcpAdvertisedToolNames: advertisedToolNames,
      });

      onAddLog({
        direction: "request",
        content: "Sending chat completion request",
        meta: {
          url: activeApi.baseUrl,
          model: activeApi.model,
          renderedMessages: messagesForApi,
          tools: mcpToolUseOptions?.tools.map((t) => t.name) ?? [],
        },
      });

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
        meta: { response: fullResponse, usage: usageResult },
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
        meta: { error: error?.message || String(error), status: error?.status },
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
    }
  };

  const handleSubmit = async () => {
    if (isLoading) {
      handleStop();
      return;
    }
    if (!input.trim()) return;
    const content = input;
    const atts = attachments;
    setInput("");
    clearAttachments();
    await sendChat(content, atts, messages);
  };

  // Allow App (and thus sibling modals like BypassModal) to inject a message
  // as if the user had typed and sent it. Mirrors handleSubmit's guard +
  // baseMessages handoff so the injected turn behaves identically.
  useImperativeHandle(ref, () => ({
    sendUserMessage: (text: string) => {
      if (isLoading) return;
      if (!text.trim()) return;
      void sendChat(text, [], messages);
    },
  }), [isLoading, messages, settings]);


  // Auto-save current session when messages change. Debounced 800ms so the
  // stream-of-tokens path doesn't trigger a full JSON.stringify + setItem on
  // every chunk — long sessions could otherwise stall the main thread and
  // approach the localStorage quota much faster than necessary.
  useEffect(() => {
    if (messages.length === 0) return;
    const userMessages = messages.filter(m => m.role === "user");
    if (userMessages.length === 0) return;
    const timer = setTimeout(() => {
      const session: ChatSession = {
        id: currentSession?.id ?? newId(),
        characterId: currentSession?.characterId ?? currentCharacter?.id ?? "default",
        characterName: currentSession?.characterName ?? charName,
        messages,
        createdAt: currentSession?.createdAt ?? Date.now(),
      };
      try {
        saveSession(session);
        if (!currentSession || currentSession.id !== session.id) {
          onSessionChange(session);
        }
      } catch (err: any) {
        console.error("Auto-save failed", err);
      }
    }, 800);
    return () => clearTimeout(timer);
    // TODO(#23 audit): effect reads currentSession/currentCharacter via stale
    // closure. Plan: move auto-save to a useEffectEvent or refactor when
    // ChatInterface is split (audit task #20).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  const clearChat = () => {
    onSessionChange(null);
    setMessages(buildFirstMes(currentCharacter));
  };

  const handleDeleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const handleEditMessage = useCallback((id: string, newContent: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: newContent } : m)),
    );
  }, []);

  const handleRegenerate = (id: string) => {
    if (isLoading) return;
    const idx = messages.findIndex((m) => m.id === id);
    if (idx === -1) return;
    const trimmed = messages.slice(0, idx);
    const lastUser = [...trimmed].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const withoutLastUser = trimmed.filter((m) => m.id !== lastUser.id);
    setMessages(withoutLastUser);
    void sendChat(lastUser.content, [], withoutLastUser);
  };

  // Resolve image-gen state from the v2 active image provider rather than
  // the legacy single-endpoint settings.imageApi. The provider must be
  // enabled, of kind "qiny" (only working backend), have an apiKey, and
  // have at least one model entry — providerToApiSettings derives the
  // model id from lastUsedModel || models[0].
  const activeImageProvider = getActiveImageProvider(settings);
  const activeImageApi = activeImageProvider
    ? imageProviderToApiSettings(activeImageProvider)
    : null;
  const isImageApiReady =
    !!activeImageProvider &&
    activeImageProvider.enabled &&
    activeImageProvider.kind === "qiny" &&
    !!activeImageApi?.apiKey &&
    !!activeImageApi?.model;

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
      if (isLoading) return;

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

      try {
        // Wire-level size strategy (kept in sync with imageApi.ts):
        //   默认           → field omitted (regardless of model)
        //   gpt-image-2 4K → "3840x2160" → fallback "2048x2048"
        //   其他模型 4K    → "3840x2160" → fallback omitted
        if (!activeImageApi) {
          throw new Error("Image provider not configured");
        }
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
          meta: { model: activeImageApi.model, url },
        });
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
          meta: { error: description },
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
        setIsLoading(false);
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
      }
    },
    [isImageApiReady, isLoading, activeImageApi, onAddLog],
  );

  const handleGenerateImage = useCallback(
    (id: string) => {
      const msg = messages.find((m) => m.id === id);
      if (!msg) return;
      const prompt = buildImagePrompt({
        targetMessage: msg,
        baseMessages: messages,
        currentCharacter,
        settings,
        userName,
        charName,
      }).trim();
      if (!prompt) return;
      void runImageGeneration(prompt, id);
    },
    [messages, runImageGeneration, currentCharacter, settings, userName, charName],
  );

  const handleRegenerateImage = useCallback(
    (id: string) => {
      const msg = messages.find((m) => m.id === id);
      if (!msg || !msg.imageUrl) return;
      const prompt = (msg.imagePrompt || msg.content || "").trim();
      if (!prompt) return;
      void runImageGeneration(prompt, id, id);
    },
    [messages, runImageGeneration],
  );

  // Load session when selected from history
  useEffect(() => {
    if (currentSession) {
      setMessages(currentSession.messages);
    }
    // Depending on the id alone is intentional: when the same session object
    // is passed back (e.g. after rename) we don't want to re-import messages.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSession?.id]);

  const isBypassActive = settings.bypass.enabled;

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
      />

      {/* Main Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 scroll-smooth z-10 relative">
        <div className="max-w-3xl mx-auto flex flex-col h-full">
          {messages.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="flex-1 flex flex-col items-center justify-center text-center mt-10"
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
            <div className="flex flex-col flex-1 pb-4">
              <AnimatePresence initial={false}>
                {messages.map((message) => (
                  <MessageItem
                    key={message.id}
                    message={message}
                    userName={currentUserRole?.name}
                    charName={currentCharacter?.name}
                    onDelete={handleDeleteMessage}
                    onRegenerate={handleRegenerate}
                    onEdit={handleEditMessage}
                    onGenerateImage={isImageApiReady ? handleGenerateImage : undefined}
                    onRegenerateImage={isImageApiReady ? handleRegenerateImage : undefined}
                    imageGenerating={imageGeneratingId === message.id}
                    busy={isLoading}
                    regexScripts={regexScripts}
                  />
                ))}
              </AnimatePresence>
              <div ref={messagesEndRef} className="h-6" />
            </div>
          )}
        </div>
      </main>

      {/* Input Area */}
      <ChatComposer
        input={input}
        onInputChange={setInput}
        attachments={attachments}
        onAddFiles={addFiles}
        onRemoveAttachment={removeAttachment}
        onSubmit={handleSubmit}
        onStop={handleStop}
        isLoading={isLoading}
        settings={settings}
        onSettingsChange={onSettingsChange}
      />
    </div>
  );
});
