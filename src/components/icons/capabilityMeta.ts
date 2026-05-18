import { Boxes, Brain, Eye, Globe, ListOrdered, Wrench } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ModelCapability } from "../../types";

/**
 * Visual / textual metadata for each model capability tag, shared by every
 * surface that surfaces inferred capabilities — model management modals,
 * the chat composer's model picker, etc. Keeping the table here means a
 * recolor or rename only happens once.
 *
 * Capabilities themselves are produced by `inferCapabilities()` from a
 * model id during health checks (see lib/modelHealth.ts).
 */
export const CAPABILITY_META: Record<
  ModelCapability,
  { Icon: LucideIcon; label: string; color: string }
> = {
  vision: { Icon: Eye, label: "视觉", color: "text-purple-500" },
  web: { Icon: Globe, label: "联网", color: "text-sky-500" },
  reasoning: { Icon: Brain, label: "推理", color: "text-violet-500" },
  tools: { Icon: Wrench, label: "工具调用", color: "text-amber-500" },
  rerank: { Icon: ListOrdered, label: "排序", color: "text-emerald-500" },
  embed: { Icon: Boxes, label: "嵌入", color: "text-rose-500" },
};
