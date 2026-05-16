import React, { useState, useRef, useEffect, useCallback } from "react";
import { Sparkles } from "lucide-react";
import { Message, AppState, LogEntry, ChatSession } from "../types";
import { fetchChatCompletion } from "../lib/api";
import { newId } from "../lib/id";
import { saveSession } from "../lib/sessionStorage";
import {
  applyPlaceholders,
  buildMessageContent,
  buildRequestMessages,
} from "../lib/chatPipeline";
import { MessageItem } from "./MessageItem";
import { ChatHeader } from "./ChatHeader";
import { ChatComposer } from "./ChatComposer";
import { motion, AnimatePresence } from "motion/react";
import { useFullscreen } from "../hooks/useFullscreen";
import { useAttachments } from "../hooks/useAttachments";

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
  onOpenAppearance: () => void;
  currentSession: ChatSession | null;
  onSessionChange: (session: ChatSession | null) => void;
}

export function ChatInterface({
  settings,
  onOpenSettings,
  onOpenBypass,
  logs: _logs,
  onAddLog,
  onOpenConsole,
  onOpenUserRole,
  onOpenCharacterSelection,
  onOpenChatHistory,
  onOpenAppearance,
  currentSession,
  onSessionChange,
}: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  const { isSupported: isFullscreenSupported, isFullscreen, toggleFullscreen } =
    useFullscreen();
  const { attachments, addFiles, removeAt: removeAttachment, clear: clearAttachments } =
    useAttachments();

  const currentCharacter = settings.characters?.find(
    (c) => c.id === settings.currentCharacterId,
  );
  const charName = currentCharacter?.name || "AI助手";
  const userName = settings.userRole?.name || "user";

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
    if (!settings.api.baseUrl || !settings.api.apiKey) {
      onAddLog({
        direction: "error",
        content: "API configuration is missing",
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

    try {
      const messagesForApi = buildRequestMessages({
        processedInput,
        messageContent,
        baseMessages,
        settings,
        currentCharacter,
        userName,
        charName,
      });

      abortControllerRef.current = new AbortController();
      onAddLog({
        direction: "request",
        content: "Sending chat completion request",
        meta: {
          url: settings.api.baseUrl,
          model: settings.api.model,
          renderedMessages: messagesForApi,
        },
      });

      let fullResponse = "";
      const usageResult = await fetchChatCompletion(
        messagesForApi,
        settings.api,
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
                model: settings.api.model,
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
        characterId: currentCharacter?.id ?? "default",
        characterName: charName,
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
        onOpenAppearance={onOpenAppearance}
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
                    userName={settings.userRole?.name}
                    charName={currentCharacter?.name}
                    onDelete={handleDeleteMessage}
                    onRegenerate={handleRegenerate}
                    onEdit={handleEditMessage}
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
      />
    </div>
  );
}
