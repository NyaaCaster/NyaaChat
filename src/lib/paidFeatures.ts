/**
 * 付费功能项目常量 — 与 shared-server/src/paid-features.json 保持同步。
 * 该文件是前端展示付费项目的 SSOT，用于扩容按钮文案和确认弹窗。
 *
 * 所有数值必须与 shared-server/src/paid-features.json 完全一致；
 * 服务端以该 JSON 文件为准（数据库默认值 / 扩容步进）。
 */

export interface PaidFeatureDef {
  key: string;
  label: string;
  initialFree: number;
  costPerExpansion: number;
  effectPerExpansion: number;
  displayUnit: string;
  displayStep?: string; // 人类可读的扩容效果，如 "12 MB"；缺省时用 effectPerExpansion + displayUnit
  hardCap?: number; // 可选硬上限
}

export const PAID_FEATURES: Record<string, PaidFeatureDef> = {
  sharedSlots: {
    key: "sharedSlots",
    label: "共享卡槽",
    initialFree: 10,
    costPerExpansion: 15,
    effectPerExpansion: 5,
    displayUnit: "个",
    hardCap: 200,
  },
  knowledgeBase: {
    key: "knowledgeBase",
    label: "知识库栈",
    initialFree: 3,
    costPerExpansion: 10,
    effectPerExpansion: 2,
    displayUnit: "个",
    hardCap: 50,
  },
  characterStorage: {
    key: "characterStorage",
    label: "角色卡储存",
    initialFree: 32 * 1024 * 1024, // 32 MB
    costPerExpansion: 5,
    effectPerExpansion: 12 * 1024 * 1024, // 12 MB
    displayUnit: "MB",
    displayStep: "12 MB",
  },
  chatStorage: {
    key: "chatStorage",
    label: "聊天记录储存",
    initialFree: 32 * 1024 * 1024, // 32 MB
    costPerExpansion: 5,
    effectPerExpansion: 12 * 1024 * 1024, // 12 MB
    displayUnit: "MB",
    displayStep: "12 MB",
  },
};

/** 将字节值格式化为人类可读的储存量字符串 (B / KB / MB)。 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
