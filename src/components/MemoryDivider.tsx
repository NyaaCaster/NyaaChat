import React from "react";
import { motion } from "motion/react";
import { Archive } from "lucide-react";

interface MemoryDividerProps {
  /** Batch sequence number, shown so multiple batches are distinguishable. */
  seq: number;
}

/**
 * Horizontal rule marking where a memory batch was extracted. Everything above
 * the newest divider is no longer sent to the model — it lives only in the
 * server-side memory KB and comes back through retrieval. The bubbles above
 * stay visible on purpose: without them the user would scroll into a void.
 */
export default function MemoryDivider({ seq }: MemoryDividerProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex items-center gap-3 my-6 select-none"
      title="以上内容已归档为持久记忆，不再随每轮发送给模型，会在需要时被检索召回"
    >
      <div className="h-px flex-1 bg-gradient-to-r from-transparent to-amber-300/50 dark:to-amber-400/25" />
      <span className="flex items-center gap-1.5 text-[11px] text-amber-600/80 dark:text-amber-400/70 whitespace-nowrap">
        <Archive size={12} />
        记忆分界 #{seq}
      </span>
      <div className="h-px flex-1 bg-gradient-to-l from-transparent to-amber-300/50 dark:to-amber-400/25" />
    </motion.div>
  );
}
