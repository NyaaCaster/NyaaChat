import React, { useState, useRef, useEffect } from "react";
import {
  Send,
  Square,
  Settings,
  Check,
  Download,
  PlusCircle,
  Sparkles,
  MessageSquare,
  Flame,
  Terminal,
  User,
  History,
  Paperclip,
  Palette,
  X as XIcon,
  FileText,
  Image as ImageIcon,
} from "lucide-react";
import { Message, AppState, LogEntry } from "../types";
import { fetchChatCompletion } from "../lib/api";
import { injectBypassPrompts } from "../lib/bypassTemplates";
import { MessageItem } from "./MessageItem";
import { motion, AnimatePresence } from "motion/react";
import { saveSession, loadSessions } from "./ChatHistoryModal";
import { ChatSession } from "../types";

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
  logs,
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
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  type Attachment = { name: string; type: "image" | "text"; data: string; mimeType: string };
  const [attachments, setAttachments] = useState<Attachment[]>([]);

  const processFile = async (file: File): Promise<Attachment | null> => {
    const isImage = file.type.startsWith("image/");
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const result = e.target?.result as string;
        if (isImage) {
          // base64 data URL
          resolve({ name: file.name, type: "image", data: result.split(",")[1], mimeType: file.type });
        } else {
          resolve({ name: file.name, type: "text", data: result, mimeType: file.type });
        }
      };
      reader.onerror = () => resolve(null);
      if (isImage) reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
  };

  const handleAttachFiles = async (files: FileList | File[]) => {
    const arr = Array.from(files);
    const processed = await Promise.all(arr.map(processFile));
    setAttachments(prev => [...prev, ...processed.filter(Boolean) as Attachment[]]);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      await handleAttachFiles(files);
    }
  };

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
    return [{
      id: Date.now().toString(),
      role: "assistant",
      content: character.firstMes,
      timestamp: Date.now(),
    }];
  };

  useEffect(() => {
    setMessages(buildFirstMes(currentCharacter));
  }, [settings.currentCharacterId]);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isLoading) {
      handleStop();
      return;
    }
    if (!input.trim()) return;

    if (!settings.api.baseUrl || !settings.api.apiKey) {
      onAddLog({
        direction: "error",
        content: "API configuration is missing",
      });
      onOpenSettings();
      return;
    }

    const processedInput = input
      .replace(/\{\{user\}\}/g, userName)
      .replace(/\{\{char\}\}/g, charName);

    // Build content with attachments
    let messageContent: any = processedInput;
    if (attachments.length > 0) {
      const parts: any[] = [{ type: "text", text: processedInput }];
      for (const att of attachments) {
        if (att.type === "image") {
          parts.push({ type: "image_url", image_url: { url: `data:${att.mimeType};base64,${att.data}` } });
        } else {
          parts.push({ type: "text", text: `\n\n[附件: ${att.name}]\n${att.data}` });
        }
      }
      messageContent = parts;
    }

    const newUserMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: typeof messageContent === "string" ? messageContent : processedInput,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, newUserMessage]);
    setInput("");
    setAttachments([]);
    setIsLoading(true);

    const botMessageId = (Date.now() + 1).toString();
    setMessages((prev) => [
      ...prev,
      {
        id: botMessageId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      },
    ]);

    // Keyword matching helper
    const checkKeywords = (text: string, keywordsStr?: string): boolean => {
      if (!keywordsStr) return false;
      const keywords = keywordsStr
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k.length > 0);
      if (keywords.length === 0) return false;
      const lowerText = text.toLowerCase();
      return keywords.some((keyword) => lowerText.includes(keyword));
    };

    try {
      const history = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
      // Append current user message with full attachment content
      history.push({ role: "user", content: messageContent });

      // World Info logic
      const activeRules = (currentCharacter?.worldInfo || []).filter((rule) => {
        if (!rule.enabled) return false;
        if (rule.triggerType === "permanent") return true;
        return checkKeywords(processedInput, rule.keywords);
      });
      // Stable blocks (permanent) before volatile ones (keyword-triggered) so
      // the keyword-triggered set, which can change turn-to-turn, sits at the
      // tail of the system segment and breaks as little prefix as possible.
      activeRules.sort(
        (a, b) =>
          Number(a.triggerType !== "permanent") -
          Number(b.triggerType !== "permanent"),
      );

      // Collect all system-level content up-front. Order is fixed so the
      // request prefix stays byte-identical across turns (prompt cache hit).
      const systemMessages: { role: string; content: string }[] = [];
      if (settings.userRole?.profile) {
        systemMessages.push({
          role: "system",
          content: `[User Persona: ${settings.userRole.profile.replace(/\{\{user\}\}/g, userName).replace(/\{\{char\}\}/g, charName)}]`,
        });
      }
      if (currentCharacter?.description) {
        systemMessages.push({
          role: "system",
          content: `[Assistant Persona: ${currentCharacter.description.replace(/\{\{user\}\}/g, userName).replace(/\{\{char\}\}/g, charName)}]`,
        });
      }
      // World Info goes into the system block (not into the history mid-stream)
      // so triggering a keyword rule does not invalidate the cached history prefix.
      for (const rule of activeRules) {
        const tag = rule.position === "assistant" ? "Assistant Note" : "World Info";
        systemMessages.push({
          role: "system",
          content: `[${tag}] ${rule.content
            .replace(/\{\{user\}\}/g, userName)
            .replace(/\{\{char\}\}/g, charName)}`,
        });
      }

      const messagesForApi = injectBypassPrompts(
        [...systemMessages, ...history],
        settings,
        charName,
        userName,
      );

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
              return { ...m, tokenCount: usageResult.completion_tokens, model: settings.api.model };
            }
            return m;
          }),
        );
      }

      onAddLog({
        direction: "response",
        content: "Received chat completion stream fully",
        meta: {
          response: fullResponse,
          usage: usageResult,
        },
      });
    } catch (error: any) {
      console.error(error);
      const errMsg = error.name === "AbortError" ? "请求已终止" : error.message;
      onAddLog({
        direction: "error",
        content:
          error.name === "AbortError"
            ? "Chat completion aborted by user"
            : "Failed during chat completion request",
        meta: { error: errMsg },
      });
      setMessages((prev) =>
        prev.map((m) =>
          m.id === botMessageId
            ? {
                ...m,
                content:
                  m.content +
                  (error.name === "AbortError"
                    ? `\n\n**[已停止生成]**`
                    : `\n\n**Error:** ${errMsg}`),
              }
            : m,
        ),
      );
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  // Auto-save current session when messages change
  useEffect(() => {
    if (messages.length === 0) return;
    const userMessages = messages.filter(m => m.role === "user");
    if (userMessages.length === 0) return;
    const session: ChatSession = {
      id: currentSession?.id ?? Date.now().toString(),
      characterId: currentCharacter?.id ?? "default",
      characterName: charName,
      messages,
      createdAt: currentSession?.createdAt ?? Date.now(),
    };
    saveSession(session);
    if (!currentSession || currentSession.id !== session.id) {
      onSessionChange(session);
    }
  }, [messages]);

  const clearChat = () => {
    onSessionChange(null);
    setMessages(buildFirstMes(currentCharacter));
  };

  const handleDeleteMessage = (id: string) => {
    setMessages(prev => prev.filter(m => m.id !== id));
  };

  const handleRegenerate = (id: string) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === id);
      if (idx === -1) return prev;
      const trimmed = prev.slice(0, idx);
      const lastUser = [...trimmed].reverse().find(m => m.role === "user");
      if (!lastUser) return trimmed;
      const withoutLastUser = trimmed.filter(m => m.id !== lastUser.id);
      setTimeout(() => handleSubmitWithContent(lastUser.content), 0);
      return withoutLastUser;
    });
  };

  const handleSubmitWithContent = async (content: string) => {
    if (isLoading) return;
    if (!settings.api.baseUrl || !settings.api.apiKey) { onOpenSettings(); return; }

    const processedInput = content
      .replace(/\{\{user\}\}/g, userName)
      .replace(/\{\{char\}\}/g, charName);

    const newUserMessage: Message = { id: Date.now().toString(), role: "user", content: processedInput, timestamp: Date.now() };
    setMessages(prev => [...prev, newUserMessage]);
    setIsLoading(true);
    const botMessageId = (Date.now() + 1).toString();
    setMessages(prev => [...prev, { id: botMessageId, role: "assistant", content: "", timestamp: Date.now() }]);

    const checkKeywords = (text: string, keywordsStr?: string): boolean => {
      if (!keywordsStr) return false;
      const keywords = keywordsStr.split(",").map(k => k.trim().toLowerCase()).filter(k => k.length > 0);
      return keywords.some(k => text.toLowerCase().includes(k));
    };

    try {
      const history = messages.concat(newUserMessage).filter(m => m.role !== "system").map(m => ({ role: m.role, content: m.content }));
      const activeRules = (currentCharacter?.worldInfo || []).filter(rule => {
        if (!rule.enabled) return false;
        if (rule.triggerType === "permanent") return true;
        return checkKeywords(processedInput, rule.keywords);
      });
      activeRules.sort((a, b) => Number(a.triggerType !== "permanent") - Number(b.triggerType !== "permanent"));
      const systemMessages: { role: string; content: string }[] = [];
      if (settings.userRole?.profile) {
        systemMessages.push({ role: "system", content: `[User Persona: ${settings.userRole.profile.replace(/\{\{user\}\}/g, userName).replace(/\{\{char\}\}/g, charName)}]` });
      }
      if (currentCharacter?.description) {
        systemMessages.push({ role: "system", content: `[Assistant Persona: ${currentCharacter.description.replace(/\{\{user\}\}/g, userName).replace(/\{\{char\}\}/g, charName)}]` });
      }
      for (const rule of activeRules) {
        const tag = rule.position === "assistant" ? "Assistant Note" : "World Info";
        systemMessages.push({ role: "system", content: `[${tag}] ${rule.content.replace(/\{\{user\}\}/g, userName).replace(/\{\{char\}\}/g, charName)}` });
      }
      const messagesForApi = injectBypassPrompts([...systemMessages, ...history], settings, charName, userName);
      abortControllerRef.current = new AbortController();
      let fullResponse = "";
      const usageResult = await fetchChatCompletion(messagesForApi, settings.api, chunk => {
        fullResponse += chunk;
        setMessages(prev => prev.map(m => m.id === botMessageId ? { ...m, content: m.content + chunk } : m));
        scrollToBottom();
      }, abortControllerRef.current.signal);
      if (usageResult) {
        setMessages(prev => prev.map(m => {
          if (m.id === newUserMessage.id) return { ...m, tokenCount: usageResult.prompt_tokens };
          if (m.id === botMessageId) return { ...m, tokenCount: usageResult.completion_tokens, model: settings.api.model };
          return m;
        }));
      }
    } catch (error: any) {
      const errMsg = error.name === "AbortError" ? "请求已终止" : error.message;
      setMessages(prev => prev.map(m => m.id === botMessageId ? { ...m, content: m.content + (error.name === "AbortError" ? `\n\n**[已停止生成]**` : `\n\n**Error:** ${errMsg}`) } : m));
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  // Load session when selected from history
  useEffect(() => {
    if (currentSession) {
      setMessages(currentSession.messages);
    }
  }, [currentSession?.id]);

  const isBypassActive = settings.bypass.enabled;

  return (
    <div className="flex flex-col h-screen bg-[#FCFCFD] dark:bg-[#0A0A0A] text-gray-900 dark:text-gray-100 font-sans selection:bg-blue-500/30 selection:text-blue-900 dark:selection:text-blue-100 transition-colors duration-300">
      {/* Decorative background gradients */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden flex justify-center z-0">
        <div className="absolute -top-[20%] left-1/2 -translate-x-1/2 w-[60%] h-[40%] bg-blue-500/5 dark:bg-blue-500/10 blur-[120px] rounded-full mix-blend-multiply dark:mix-blend-screen" />
      </div>

      {/* Top Toolbar */}
      <div className="flex-shrink-0 bg-white/70 dark:bg-[#0A0A0A]/70 backdrop-blur-xl border-b border-gray-200/60 dark:border-white/5 sticky top-0 z-20 flex flex-col">
        {/* System Menu */}
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
            <button
              onClick={onOpenAppearance}
              className="p-2 text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-white/10 rounded-lg transition-all duration-200"
              title="外观设置"
            >
              <Palette size={18} />
            </button>
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
              title="学术研究 (Bypass)"
            >
              <Flame
                size={18}
                className={isBypassActive ? "animate-pulse" : ""}
              />
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

        {/* Function Menu */}
        <div className="px-4 sm:px-6 py-1.5 flex items-center justify-between bg-gray-50/50 dark:bg-[#111]/50 gap-1">
          <div className="flex items-center gap-1">
            <button
              onClick={onOpenCharacterSelection}
              className="px-2 py-1 flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-all duration-200"
              title="角色管理"
            >
              <Sparkles size={16} className="text-blue-500" />
              {settings.characters?.find(
                (c) => c.id === settings.currentCharacterId,
              )?.name || "AI助手"}
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
              onClick={onOpenChatHistory}
              className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-all duration-200"
              title="聊天记录"
            >
              <History size={16} />
            </button>
            <button
              onClick={clearChat}
              className="p-1.5 text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 hover:bg-gray-200 dark:hover:bg-white/10 rounded-md transition-all duration-200"
              title="新的对话"
            >
              <PlusCircle size={16} />
            </button>
          </div>
        </div>
      </div>

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
                  />
                ))}
              </AnimatePresence>
              <div ref={messagesEndRef} className="h-6" />
            </div>
          )}
        </div>
      </main>

      {/* Input Area */}
      <footer className="flex-shrink-0 bg-transparent p-4 sm:px-6 sm:pb-6 z-20">
        <div className="max-w-3xl mx-auto relative">
          <input
            type="file"
            multiple
            className="hidden"
            ref={attachmentInputRef}
            onChange={e => e.target.files && handleAttachFiles(e.target.files)}
          />
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2 px-1">
              {attachments.map((att, i) => (
                <div key={i} className="flex items-center gap-1.5 px-2 py-1 bg-white dark:bg-white/10 border border-gray-200 dark:border-white/10 rounded-lg text-xs text-gray-700 dark:text-gray-300">
                  {att.type === "image" ? <ImageIcon size={12} className="text-blue-500" /> : <FileText size={12} className="text-gray-400" />}
                  <span className="max-w-[120px] truncate">{att.name}</span>
                  <button onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))} className="text-gray-400 hover:text-red-500 transition-colors">
                    <XIcon size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <form
            onSubmit={handleSubmit}
            className="relative flex items-end shadow-elevation-2 rounded-2xl border border-gray-200/50 dark:border-white/10 bg-white/90 dark:bg-[#111111]/90 backdrop-blur-xl overflow-hidden focus-within:ring-2 focus-within:ring-blue-500/50 transition-all duration-300"
          >
            <button
              type="button"
              onClick={() => attachmentInputRef.current?.click()}
              className="absolute left-2 bottom-2 p-2.5 rounded-xl text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/10 transition-all"
              title="添加附件"
            >
              <Paperclip size={18} />
            </button>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  handleSubmit(e);
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
                  handleStop();
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
                <Square
                  size={18}
                  fill="currentColor"
                  className="relative z-10"
                />
              ) : (
                <Send
                  size={18}
                  className="relative z-10 translate-x-[-1px] translate-y-[1px]"
                />
              )}
            </button>
          </form>
          <div className="text-center mt-3">
            <p className="text-[11px] text-gray-400 dark:text-gray-500 font-medium tracking-wide">
              内容由自定义 LLM 服务提供。生成内容仅供参考。
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
