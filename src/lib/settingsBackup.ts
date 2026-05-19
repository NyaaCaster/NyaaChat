import { AppState, ImageProvider, LlmProvider, ModelEntry } from "../types";

const EXPORT_KIND = "nyaachat_settings_export";
/** Bumped to 3 when the AppState gained MCP fields (`isMcpEnabled`,
 *  `mcpUserCity`, `mcpToolsEnabled`). v2 files are still accepted on
 *  import — missing MCP fields are filled with defaults during the
 *  import-side migration in {@link validateImportPayload}. */
const EXPORT_VERSION = 3;
const SUPPORTED_IMPORT_VERSIONS = new Set([2, 3]);

interface ExportPayload {
  _kind: typeof EXPORT_KIND;
  _version: number;
  exportedAt: string;
  settings: AppState;
}

/**
 * Strip per-machine probe results from a ModelEntry. capabilities,
 * contextWindow, maxOutput and health are populated by the health-test
 * flow; they're either heuristic-derived (re-derivable elsewhere) or
 * latency snapshots that would be misleading on a different network. The
 * canonical "this model is enabled" marker is the entry's id.
 */
function stripModelDecoration(m: ModelEntry): ModelEntry {
  const out: ModelEntry = { id: m.id };
  if (m.name) out.name = m.name;
  return out;
}

function stripLlmProvider(p: LlmProvider): LlmProvider {
  return { ...p, models: p.models.map(stripModelDecoration) };
}

function stripImageProvider(p: ImageProvider): ImageProvider {
  return { ...p, models: p.models.map(stripModelDecoration) };
}

/**
 * YYMMDDhhmmss in local time, used as the filename suffix.
 */
function formatTimestampForFilename(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    pad(d.getFullYear() % 100),
    pad(d.getMonth() + 1),
    pad(d.getDate()),
    pad(d.getHours()),
    pad(d.getMinutes()),
    pad(d.getSeconds()),
  ].join("");
}

/**
 * Build the export payload, serialize it, and trigger a browser download.
 * Filename is `NyaaChatSetting-YYMMDDhhmmss.json` per spec.
 *
 * Caveat: the JSON contains API keys in plaintext. Caller must surface a
 * warning to the user — this helper trusts the explicit click.
 */
export function exportSettings(settings: AppState): void {
  const payload: ExportPayload = {
    _kind: EXPORT_KIND,
    _version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      ...settings,
      llmProviders: settings.llmProviders.map(stripLlmProvider),
      imageProviders: settings.imageProviders.map(stripImageProvider),
    },
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `NyaaChatSetting-${formatTimestampForFilename(new Date())}.json`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Defer revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type ImportResult =
  | { kind: "ok"; settings: AppState }
  | { kind: "error"; error: string };

/**
 * Parse and validate an export file. Returns the embedded AppState on
 * success or a localized error message on failure. The caller is
 * responsible for confirming with the user before applying — this only
 * checks the shape.
 */
export function parseImportText(text: string): ImportResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e: any) {
    return { kind: "error", error: `JSON 解析失败:${e?.message || String(e)}` };
  }
  return validateImportPayload(raw);
}

function validateImportPayload(raw: unknown): ImportResult {
  if (!raw || typeof raw !== "object") {
    return { kind: "error", error: "文件内容不是 JSON 对象" };
  }
  const obj = raw as Record<string, unknown>;
  if (obj._kind !== EXPORT_KIND) {
    return {
      kind: "error",
      error: `文件格式标识不匹配,期望 ${EXPORT_KIND},实际 ${String(obj._kind)}`,
    };
  }
  if (typeof obj._version !== "number") {
    return { kind: "error", error: "缺少 _version 字段" };
  }
  if (!SUPPORTED_IMPORT_VERSIONS.has(obj._version)) {
    return {
      kind: "error",
      error: `不支持的导出版本 ${obj._version}(支持 ${[...SUPPORTED_IMPORT_VERSIONS].join("/")})`,
    };
  }
  if (!obj.settings || typeof obj.settings !== "object") {
    return { kind: "error", error: "缺少 settings 字段" };
  }
  const s = obj.settings as Record<string, unknown>;

  const issues: string[] = [];
  if (!Array.isArray(s.llmProviders)) issues.push("llmProviders 必须是数组");
  if (!Array.isArray(s.imageProviders)) issues.push("imageProviders 必须是数组");
  if (typeof s.currentLlmProviderId !== "string")
    issues.push("currentLlmProviderId 必须是字符串");
  if (typeof s.currentImageProviderId !== "string")
    issues.push("currentImageProviderId 必须是字符串");
  if (
    s.theme !== "light" &&
    s.theme !== "dark" &&
    s.theme !== "system"
  ) {
    issues.push("theme 必须是 light / dark / system 之一");
  }

  if (Array.isArray(s.llmProviders)) {
    s.llmProviders.forEach((p: unknown, i: number) => {
      const probs = validateLlmProviderShape(p);
      probs.forEach((m) => issues.push(`llmProviders[${i}]: ${m}`));
    });
  }
  if (Array.isArray(s.imageProviders)) {
    s.imageProviders.forEach((p: unknown, i: number) => {
      const probs = validateImageProviderShape(p);
      probs.forEach((m) => issues.push(`imageProviders[${i}]: ${m}`));
    });
  }

  // MCP fields. v2 files don't carry them; we let those slide and fill
  // defaults below. v3+ files must have valid shapes.
  if (obj._version >= 3) {
    if (s.isMcpEnabled !== undefined && typeof s.isMcpEnabled !== "boolean") {
      issues.push("isMcpEnabled 必须是布尔");
    }
    if (
      s.mcpUserCity !== undefined &&
      s.mcpUserCity !== null &&
      typeof s.mcpUserCity !== "string"
    ) {
      issues.push("mcpUserCity 必须是字符串或 null");
    }
    if (
      s.mcpToolsEnabled !== undefined &&
      (typeof s.mcpToolsEnabled !== "object" ||
        s.mcpToolsEnabled === null ||
        Array.isArray(s.mcpToolsEnabled))
    ) {
      issues.push("mcpToolsEnabled 必须是对象");
    }
  }

  if (issues.length > 0) {
    const shown = issues.slice(0, 5).join("; ");
    const more = issues.length > 5 ? ` (还有 ${issues.length - 5} 项)` : "";
    return {
      kind: "error",
      error: `内容校验失败:${shown}${more}`,
    };
  }

  // Backfill MCP defaults so v2 imports — and v3 imports that omit fields
  // — produce a complete AppState. Same defaults the schema migrator uses
  // when loading from localStorage; keeping them in sync is critical or
  // imported settings would behave differently from native ones.
  const filled: Record<string, unknown> = { ...s };
  if (typeof filled.isMcpEnabled !== "boolean") {
    filled.isMcpEnabled = true;
  }
  if (typeof filled.mcpUserCity !== "string" || !(filled.mcpUserCity as string).trim()) {
    filled.mcpUserCity = null;
  }
  if (
    !filled.mcpToolsEnabled ||
    typeof filled.mcpToolsEnabled !== "object" ||
    Array.isArray(filled.mcpToolsEnabled)
  ) {
    filled.mcpToolsEnabled = { get_current_time: true, get_weather: true, roll_coc: true, roll_dnd: true };
  }

  return { kind: "ok", settings: filled as unknown as AppState };
}

const VALID_LLM_KINDS = new Set([
  "qiny",
  "gemini",
  "anthropic",
  "openai",
  "deepseek",
  "ollama",
  "custom",
]);
const VALID_IMAGE_KINDS = new Set(["qiny", "comfyui"]);
const VALID_API_FORMATS = new Set(["openai", "anthropic"]);

function validateLlmProviderShape(p: unknown): string[] {
  const issues: string[] = [];
  if (!p || typeof p !== "object") {
    return ["不是对象"];
  }
  const o = p as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) issues.push("id 缺失");
  if (typeof o.kind !== "string" || !VALID_LLM_KINDS.has(o.kind))
    issues.push(`kind 非法 (${String(o.kind)})`);
  if (typeof o.name !== "string") issues.push("name 必须是字符串");
  if (typeof o.enabled !== "boolean") issues.push("enabled 必须是布尔");
  if (typeof o.apiKey !== "string") issues.push("apiKey 必须是字符串");
  if (typeof o.baseUrl !== "string") issues.push("baseUrl 必须是字符串");
  if (typeof o.apiFormat !== "string" || !VALID_API_FORMATS.has(o.apiFormat))
    issues.push(`apiFormat 非法 (${String(o.apiFormat)})`);
  if (!Array.isArray(o.models)) issues.push("models 必须是数组");
  else {
    o.models.forEach((m: unknown, i: number) => {
      if (!m || typeof m !== "object" || typeof (m as Record<string, unknown>).id !== "string") {
        issues.push(`models[${i}].id 缺失`);
      }
    });
  }
  return issues;
}

function validateImageProviderShape(p: unknown): string[] {
  const issues: string[] = [];
  if (!p || typeof p !== "object") {
    return ["不是对象"];
  }
  const o = p as Record<string, unknown>;
  if (typeof o.id !== "string" || !o.id) issues.push("id 缺失");
  if (typeof o.kind !== "string" || !VALID_IMAGE_KINDS.has(o.kind))
    issues.push(`kind 非法 (${String(o.kind)})`);
  if (typeof o.name !== "string") issues.push("name 必须是字符串");
  if (typeof o.enabled !== "boolean") issues.push("enabled 必须是布尔");
  if (typeof o.apiKey !== "string") issues.push("apiKey 必须是字符串");
  if (typeof o.baseUrl !== "string") issues.push("baseUrl 必须是字符串");
  if (!Array.isArray(o.models)) issues.push("models 必须是数组");
  else {
    o.models.forEach((m: unknown, i: number) => {
      if (!m || typeof m !== "object" || typeof (m as Record<string, unknown>).id !== "string") {
        issues.push(`models[${i}].id 缺失`);
      }
    });
  }
  return issues;
}
