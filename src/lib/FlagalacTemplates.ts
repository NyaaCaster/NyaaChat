/**
 * AnswererFlagalac 模块的条目配置 —— **审核绕过目标（单选）的唯一事实来源**。
 *
 * 与 lib/WordCheckTemplates.ts / lib/WordCountTemplates.ts 同构：本文件集中
 * 定义模块对外暴露的全部条目，其他代码一律不硬编码条目。BypassModal 只负责
 * 把这里的条目渲染成单选列表、把用户选中的 `id` 写进
 * `settings.bypass.answererFlagalac.target`；将来接入绕过逻辑时，chatPipeline
 * 按这个 `id` 取回对应条目即可。
 *
 * ── 维护方式：只改这一个文件，其余代码无需同步 ──────────────────────────
 * 1. **新增目标**：在 `flagalacTargets` 里追加一条 `{ id, label, ... }`。
 *    数组顺序 = 界面顺序，把新模型插到对应位置即可。
 * 2. **下线目标**：直接从数组里删除该条。存档/备份中残留的旧 id 会在读取时
 *    由 `resolveFlagalacTarget()` 收敛为「无」，不会留下“选不中任何条目”的
 *    僵死状态（见 App.tsx 的读取归一化与 lib/settingsBackup.ts 的导入回填）。
 * 3. **更新某个目标的绕过内容**：写进该条目的 `template`（当前为占位，逻辑
 *    接入后由 chatPipeline 读取）。
 *
 * ⚠️ `id` 一旦发布即等同持久化键，**不可再改**：它同时存在于用户的
 * localStorage 与导出的备份里，改名会让老存档静默回落到「无」。
 * ⚠️ `FLAGALAC_NONE_ID`（「无」）必须始终存在且**排在首位**：它既是默认值，
 * 也是所有未知/失效 id 的回落目标。
 */
export const FLAGALAC_NONE_ID = "none";

export interface FlagalacTarget {
  /** 持久化 id（写入 settings.bypass.answererFlagalac.target）。发布后不可更改。 */
  id: string;
  /** 单选条目的显示名称。 */
  label: string;
  /** 条目下方的一行补充说明（可选，保持简短）。 */
  description?: string;
  /**
   * 该目标对应的绕过载荷，**留待逻辑接入**：当前仅作占位，UI 不读取。
   * 接入后由 chatPipeline 按选中的 id 取此处内容注入。
   */
  template?: string;
}

/**
 * 单选条目清单。数组顺序即界面顺序；首项必须是「无」。
 * 新增 / 下线 / 调整目标只改这里。
 */
export const flagalacTargets: readonly FlagalacTarget[] = [
  {
    id: FLAGALAC_NONE_ID,
    label: "无",
    description: "不启用本模块，不注入任何绕过内容。",
  },
  {
    id: "gemini25pro31pro",
    label: "gemini2.5pro & 3.1pro",
    description: "对应 gemini2.5pro / 3.1pro 的拦截机制。",
    template: "",
  },
  {
    id: "gemini37flash",
    label: "gemini3.7flash",
    description: "对应 gemini3.7flash 的拦截机制。",
    template: "",
  },
];

/** 该 id 是否为当前配置里已知的目标。 */
export function isKnownFlagalacTarget(id: unknown): id is string {
  return typeof id === "string" && flagalacTargets.some((t) => t.id === id);
}

/**
 * 把任意来源的 id（存档、导入的备份、手改过的 localStorage）收敛为合法值：
 * 非字符串、空串、以及已下线/未知的 id 一律回落到「无」。这样界面永远不会
 * 出现“没有任何条目被选中”的状态。
 */
export function resolveFlagalacTarget(id: unknown): string {
  return isKnownFlagalacTarget(id) ? id : FLAGALAC_NONE_ID;
}

/** 按 id 取条目；未知 id 返回 undefined。逻辑接入后按此取绕过载荷。 */
export function getFlagalacTarget(id: string): FlagalacTarget | undefined {
  return flagalacTargets.find((t) => t.id === id);
}
