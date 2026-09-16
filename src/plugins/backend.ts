/**
 * `callBackend` 客户端（SSOT §2.2 / §2.7 / §7.3）。
 *
 * 能力名 → 声明路径的唯一映射点：插件**只能**调用自己在 `backend[]` 里声明过的
 * 能力，且路径必须落在 `/api/ext-host/plugins/<pluginId>/` 前缀下。查表失败即抛
 * —— 这是安全红线 §7.3 的运行时兜底（注册表校验只在开发期 `console.error`，
 * 生产构建里不能依赖它拦住调用）。
 *
 * 浏览器侧只与同源路径打交道（`/api/ext-host/...`），真实上游由 ext-host 边车
 * 用 `process.env` 决定，请求体无法改写上游地址 / 模型 / 鉴权（SSOT §2.7）。
 */
import type { PluginBackendDeclaration } from "./types";
import { PLUGIN_BACKEND_PATH_PREFIX, getPluginById } from "./registry";

/** 查表：插件声明的能力 → 声明（未声明返回 undefined）。 */
export function getPluginBackendDeclaration(
  pluginId: string,
  capability: string,
): PluginBackendDeclaration | undefined {
  const plugin = getPluginById(pluginId);
  if (!plugin || !Array.isArray(plugin.backend)) return undefined;
  return plugin.backend.find((entry) => entry?.capability === capability);
}

function buildRequestUrl(
  path: string,
  method: "POST" | "GET",
  payload: unknown,
): string {
  if (method !== "GET" || payload === undefined || payload === null) return path;
  if (typeof payload !== "object" || Array.isArray(payload)) return path;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    query.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

async function describeFailure(response: Response): Promise<string> {
  const status = `${response.status} ${response.statusText}`.trim();
  try {
    const text = await response.text();
    if (!text) return status;
    try {
      const parsed = JSON.parse(text) as unknown;
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const message =
          typeof record.error === "string"
            ? record.error
            : typeof record.message === "string"
              ? record.message
              : undefined;
        if (message) return `${status} — ${message}`;
      }
      return `${status} — ${text.slice(0, 300)}`;
    } catch {
      return `${status} — ${text.slice(0, 300)}`;
    }
  } catch {
    return status;
  }
}

/**
 * 调用插件声明的后端能力。`T` 由调用方按声明的能力给出：JSON 响应直接解析，
 * 音频等二进制响应返回 `Blob`（`T = Blob`）。
 */
export async function callPluginBackend<T = unknown>(
  pluginId: string,
  capability: string,
  payload?: unknown,
): Promise<T> {
  const declaration = getPluginBackendDeclaration(pluginId, capability);
  if (!declaration) {
    throw new Error(
      `[plugins] 插件 "${pluginId}" 未在 backend[] 中声明能力 "${capability}"，调用被拒绝`,
    );
  }

  const requiredPrefix = `${PLUGIN_BACKEND_PATH_PREFIX}${pluginId}/`;
  if (!declaration.path.startsWith(requiredPrefix)) {
    throw new Error(
      `[plugins] 插件 "${pluginId}" 的能力 "${capability}" 声明的 path 越界（必须以 "${requiredPrefix}" 开头），调用被拒绝`,
    );
  }

  const method = declaration.method;
  const init: RequestInit = {
    method,
    headers:
      method === "POST" ? { "Content-Type": "application/json" } : undefined,
    body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
  };

  const response = await fetch(
    buildRequestUrl(declaration.path, method, payload),
    init,
  );

  if (!response.ok) {
    throw new Error(
      `[plugins] ${pluginId}/${capability} 调用失败：${await describeFailure(response)}`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (/\bjson\b/i.test(contentType)) return (await response.json()) as T;
  if (contentType.startsWith("text/")) return (await response.text()) as unknown as T;
  return (await response.blob()) as unknown as T;
}
