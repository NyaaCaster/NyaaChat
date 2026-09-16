/**
 * 宿主侧插件注册表（SSOT §2.3）。
 *
 * 职责只有两件：
 *  1. 汇总 `plugins/registry.ts`（唯一注册入口）暴露给宿主；
 *  2. **模块加载时**做一次结构校验，失败只 `console.error` / `console.warn`，
 *     **绝不 throw** —— 一个写坏的插件不应该让整站白屏。
 *
 * 校验项（SSOT §2.3 逐条）：
 *  · `meta.id` 唯一且匹配 `^[a-z0-9][a-z0-9-]*$`；
 *  · `meta.name` / `meta.version` 非空；`description` 建议非空（缺失时 UI 显示占位）；
 *  · 全仓 `backend[].capability` 唯一（防止一个能力名指向两条路径）；
 *  · `backend[].path` 必须以 `/api/ext-host/plugins/<meta.id>/` 开头
 *    （防止插件声明任意路径 —— 安全红线 §7.2）。
 */
import type { NyaaPlugin } from "./types";
import { plugins as registeredPlugins } from "../../plugins/registry";

/** 插件 id 的合法形状：kebab-case，首字符必须是字母或数字。 */
export const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/** 插件后端路径的强制前缀（与 nginx 的精确 location 前缀一致）。 */
export const PLUGIN_BACKEND_PATH_PREFIX = "/api/ext-host/plugins/";

export type PluginRegistryIssueKind = "id" | "meta" | "backend";

export interface PluginRegistryIssue {
  /** 出问题的插件 id；`meta` 完全缺失时为空字符串。 */
  pluginId: string;
  kind: PluginRegistryIssueKind;
  /** `error` 阻断该插件可用；`warning` 只是建议（例如 description 缺失）。 */
  severity: "error" | "warning";
  message: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** 纯函数式校验：不产生副作用，便于测试与复用。 */
export function validatePlugins(list: NyaaPlugin[]): PluginRegistryIssue[] {
  const issues: PluginRegistryIssue[] = [];
  const seenIds = new Set<string>();
  const capabilityOwners = new Map<string, string>();

  for (const plugin of list) {
    if (!isObject(plugin) || !isObject((plugin as NyaaPlugin).meta)) {
      issues.push({
        pluginId: "",
        kind: "meta",
        severity: "error",
        message: "插件对象或其 meta 不是对象，已跳过校验",
      });
      continue;
    }

    const meta = plugin.meta;
    const id = typeof meta.id === "string" ? meta.id : "";

    if (!id) {
      issues.push({
        pluginId: "",
        kind: "id",
        severity: "error",
        message: `插件 meta.id 缺失或不是字符串（name=${String(meta.name ?? "")}）`,
      });
    } else if (!PLUGIN_ID_PATTERN.test(id)) {
      issues.push({
        pluginId: id,
        kind: "id",
        severity: "error",
        message: `meta.id "${id}" 不匹配 ${PLUGIN_ID_PATTERN}（要求 kebab-case，首字符为字母或数字）`,
      });
    }

    if (id) {
      if (seenIds.has(id)) {
        issues.push({
          pluginId: id,
          kind: "id",
          severity: "error",
          message: `meta.id "${id}" 重复注册（id 必须全仓唯一，它同时是配置持久化键）`,
        });
      }
      seenIds.add(id);
    }

    if (typeof meta.name !== "string" || !meta.name.trim()) {
      issues.push({
        pluginId: id,
        kind: "meta",
        severity: "error",
        message: "meta.name 缺失或为空",
      });
    }
    if (typeof meta.version !== "string" || !meta.version.trim()) {
      issues.push({
        pluginId: id,
        kind: "meta",
        severity: "error",
        message: "meta.version 缺失或为空",
      });
    }
    if (typeof meta.description !== "string" || !meta.description.trim()) {
      issues.push({
        pluginId: id,
        kind: "meta",
        severity: "warning",
        message: "meta.description 缺失，插件列表与详情面板将显示占位文案",
      });
    }

    const backend = Array.isArray(plugin.backend) ? plugin.backend : [];
    for (const declaration of backend) {
      if (!isObject(declaration)) {
        issues.push({
          pluginId: id,
          kind: "backend",
          severity: "error",
          message: "backend[] 中存在非对象条目",
        });
        continue;
      }
      const capability =
        typeof declaration.capability === "string" ? declaration.capability : "";
      const path = typeof declaration.path === "string" ? declaration.path : "";

      if (!capability) {
        issues.push({
          pluginId: id,
          kind: "backend",
          severity: "error",
          message: "backend[] 条目的 capability 缺失或为空",
        });
      } else {
        const owner = capabilityOwners.get(capability);
        if (owner !== undefined) {
          issues.push({
            pluginId: id,
            kind: "backend",
            severity: "error",
            message: `backend capability "${capability}" 已被插件 "${owner}" 声明（能力名必须全仓唯一）`,
          });
        } else {
          capabilityOwners.set(capability, id);
        }
      }

      // 安全红线：路径前缀必须锁定在本插件自己的命名空间下。
      const requiredPrefix = `${PLUGIN_BACKEND_PATH_PREFIX}${id}/`;
      if (!path) {
        issues.push({
          pluginId: id,
          kind: "backend",
          severity: "error",
          message: `backend capability "${capability}" 的 path 缺失`,
        });
      } else if (!path.startsWith(requiredPrefix)) {
        issues.push({
          pluginId: id,
          kind: "backend",
          severity: "error",
          message: `backend path "${path}" 必须以 "${requiredPrefix}" 开头（防止插件声明任意路径）`,
        });
      }
    }
  }

  return issues;
}

/** 注册表快照（`plugins/registry.ts` 已按 order/name 排好序）。 */
export function getRegisteredPlugins(): NyaaPlugin[] {
  return registeredPlugins;
}

export function getPluginById(pluginId: string): NyaaPlugin | undefined {
  return registeredPlugins.find((plugin) => plugin?.meta?.id === pluginId);
}

// 模块加载时校验一次（SSOT §2.3）。失败不抛，避免整站白屏。
for (const issue of validatePlugins(registeredPlugins)) {
  const line = `[plugins] ${issue.kind}${issue.pluginId ? ` (${issue.pluginId})` : ""}: ${issue.message}`;
  if (issue.severity === "error") console.error(line);
  else console.warn(line);
}
