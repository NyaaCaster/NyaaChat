/**
 * `plugins` 字段归一化（SSOT §2.8.3 / §2.8.4）。
 *
 * **三处入口共用同一个函数**：localStorage 加载（`App.tsx` 的 migrateV11ToV12 +
 * 加载路径）、本地导入、云端下载；**外加出口** —— `buildExportPayload()` 在写归档
 * 前也要过一次，保证"已下线插件"既不进活跃状态、也不残留在新导出的存档里
 * （出口防御，Protection not repair）。
 *
 * 规则（SSOT §2.8.3 逐条）：
 *  · `raw` 非对象 ⇒ `{}`；
 *  · **只保留 `plugins/registry.ts` 中已知的 id**（未知 id 一律丢弃）；
 *  · `enabled` 非 boolean ⇒ false（缺失 ⇒ false，即默认全部停用）；
 *  · `config` 非对象 ⇒ `{}`；随后以插件 `defaults` 做深合并（用户值优先）。
 */
import type { NyaaPlugin, PluginStateMap } from "./types";
import { getRegisteredPlugins } from "./registry";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * 深合并两份配置：`patch` 覆盖 `base`，纯对象递归合并，其余（标量 / 数组 / null）
 * 一律整体替换。返回新对象，不改动入参。
 */
export function deepMergeConfig(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const existing = out[key];
    out[key] =
      isPlainObject(value) && isPlainObject(existing)
        ? deepMergeConfig(existing, value)
        : value;
  }
  return out;
}

/** 以插件 `defaults` 为底、用户配置为上的深合并（用户值优先）。 */
export function mergePluginDefaults(
  plugin: NyaaPlugin,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const defaults = isPlainObject(plugin.defaults) ? plugin.defaults : {};
  if (Object.keys(defaults).length === 0) return { ...config };
  return deepMergeConfig(defaults, config);
}

/** 把任意来源的 `plugins` 原始值收敛成合法的 `PluginStateMap`。 */
export function normalizePluginStates(raw: unknown): PluginStateMap {
  const out: PluginStateMap = {};
  if (!isPlainObject(raw)) return out;

  // 按注册表顺序遍历（而非 raw 的键顺序）：输出键序稳定，且天然丢弃未知 id。
  for (const plugin of getRegisteredPlugins()) {
    const pluginId = plugin?.meta?.id;
    if (!pluginId) continue;
    if (!Object.prototype.hasOwnProperty.call(raw, pluginId)) continue;

    const entry = raw[pluginId];
    const source = isPlainObject(entry) ? entry : {};
    const config = isPlainObject(source.config) ? source.config : {};

    out[pluginId] = {
      enabled: typeof source.enabled === "boolean" ? source.enabled : false,
      config: mergePluginDefaults(plugin, config),
    };
  }

  return out;
}

/**
 * 归一化「用户自定义插件排序」（`AppState.pluginOrder`，2026-09-15 追加）。
 *
 * 语义：**纯 UI 层偏好** —— 只决定扩展 modal 列表的显示顺序，不影响任何插件逻辑
 * （启用状态、配置、装饰器、后端调用都与它无关）。
 *
 * 规则与 `normalizePluginStates` 同源（"插件集合的唯一权威是代码"）：
 *  · 非数组 ⇒ `[]`；元素非字符串 ⇒ 丢弃；
 *  · **只保留注册表中已知的 id**，且**去重**（保留首次出现的位置）；
 *  · 数组里没列到的已注册插件，由调用方按注册表顺序追加到末尾（因此新增插件
 *    天然出现在队尾，不会因为用户旧排序而"丢失"）。
 */
export function normalizePluginOrder(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set(
    getRegisteredPlugins()
      .map((plugin) => plugin?.meta?.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    if (!known.has(item) || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}
