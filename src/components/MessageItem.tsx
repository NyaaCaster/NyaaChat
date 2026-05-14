import React from "react";
import Markdown from "react-markdown";
import { Message } from "../types";
import { motion } from "motion/react";

interface MessageItemProps {
  message: Message;
  userName?: string;
  charName?: string;
}

export function MessageItem({ message, userName, charName }: MessageItemProps) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

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
      <div
        className={`max-w-[85%] sm:max-w-[80%] rounded-2xl px-5 py-4 bg-white dark:bg-[#111111] text-gray-900 dark:text-gray-100 shadow-elevation-1 ${
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
            <Markdown>{message.content || "..."}</Markdown>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
