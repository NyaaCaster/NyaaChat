import React, { useRef, useEffect } from 'react';
import { X, Terminal, Trash2 } from 'lucide-react';
import { LogEntry } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface ConsoleModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: LogEntry[];
  onClearLogs: () => void;
}

export function ConsoleModal({ isOpen, onClose, logs, onClearLogs }: ConsoleModalProps) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          
          <motion.div 
            initial={{ opacity: 0, scale: 0.98, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 10 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="relative w-full max-w-5xl h-[85vh] bg-[#0A0A0A] border border-gray-800 rounded-xl shadow-2xl flex flex-col font-mono text-gray-300"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 bg-[#111111] rounded-t-xl shrink-0">
              <div className="flex items-center gap-3">
                <Terminal size={18} className="text-gray-400" />
                <h2 className="text-sm font-semibold tracking-wider text-gray-200">Terminal Output Logs</h2>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={onClearLogs}
                  className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-gray-800 rounded transition-colors"
                  title="清空日志"
                >
                  <Trash2 size={16} />
                </button>
                <div className="w-px h-4 bg-gray-700 mx-1"></div>
                <button 
                  onClick={onClose} 
                  className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-gray-800 rounded transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Log Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs sm:text-sm selection:bg-blue-500/30 selection:text-white">
              {logs.length === 0 ? (
                <div className="text-gray-600 flex items-center justify-center h-full">
                  No logs generated yet.
                </div>
              ) : (
                logs.map(log => {
                  const date = new Date(log.timestamp);
                  const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}.${date.getMilliseconds().toString().padStart(3, '0')}`;
                  
                  let typeColor = 'text-gray-400';
                  let bgBadge = 'bg-gray-800/50 text-gray-300';
                  
                  if (log.direction === 'request') {
                    typeColor = 'text-blue-400';
                    bgBadge = 'bg-blue-900/30 text-blue-400 border border-blue-800/50';
                  } else if (log.direction === 'response') {
                    typeColor = 'text-emerald-400';
                    bgBadge = 'bg-emerald-900/30 text-emerald-400 border border-emerald-800/50';
                  } else if (log.direction === 'error') {
                    typeColor = 'text-red-400';
                    bgBadge = 'bg-red-900/30 text-red-400 border border-red-800/50';
                  }

                  return (
                    <div key={log.id} className="group border-l-2 border-transparent hover:border-gray-700 pl-3 py-1 transition-colors">
                      <div className="flex items-center gap-3 mb-1.5 opacity-80 flex-wrap">
                        <span className="text-gray-600 shrink-0">[{timeStr}]</span>
                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold tracking-wider uppercase ${bgBadge}`}>
                          {log.direction}
                        </span>
                        <span className="text-gray-300 font-medium">{log.content}</span>
                        {log.meta?.usage?.prompt_tokens !== undefined && (
                          <span className="text-[10px] mr-1 px-1.5 py-0.5 rounded bg-blue-900/20 text-blue-400 border border-blue-900/50">
                            IN: {log.meta.usage.prompt_tokens}
                          </span>
                        )}
                        {(() => {
                          const cached =
                            log.meta?.usage?.cache_read_input_tokens ??
                            log.meta?.usage?.prompt_tokens_details?.cached_tokens;
                          return cached !== undefined ? (
                            <span
                              className="text-[10px] mr-1 px-1.5 py-0.5 rounded bg-amber-900/20 text-amber-400 border border-amber-900/50"
                              title="Prompt cache hit (reused tokens, billed at discount)"
                            >
                              CACHED: {cached}
                            </span>
                          ) : null;
                        })()}
                        {log.meta?.usage?.cache_creation_input_tokens !== undefined && (
                          <span
                            className="text-[10px] mr-1 px-1.5 py-0.5 rounded bg-fuchsia-900/20 text-fuchsia-400 border border-fuchsia-900/50"
                            title="Tokens written to cache this turn (Anthropic cache_control)"
                          >
                            CACHE_NEW: {log.meta.usage.cache_creation_input_tokens}
                          </span>
                        )}
                        {log.meta?.usage?.completion_tokens !== undefined && (
                          <span className="text-[10px] mr-1 px-1.5 py-0.5 rounded bg-emerald-900/20 text-emerald-400 border border-emerald-900/50">
                            OUT: {log.meta.usage.completion_tokens}
                          </span>
                        )}
                        {log.meta?.usage?.total_tokens !== undefined && (
                          <span className="text-[10px] mr-1 px-1.5 py-0.5 rounded border border-gray-800 text-gray-400">
                            TOTAL: {log.meta.usage.total_tokens}
                          </span>
                        )}
                      </div>
                      
                      {log.meta && (
                        <div className="mt-2 pl-4 border-l border-gray-800">
                          <pre className="text-[11px] text-gray-400 overflow-x-auto whitespace-pre-wrap break-words bg-[#0F0F0F] p-3 rounded-md border border-gray-800/60 leading-relaxed">
                            {JSON.stringify(log.meta, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={endRef} />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
