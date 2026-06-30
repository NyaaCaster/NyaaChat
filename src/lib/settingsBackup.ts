import { AppState, ImageProvider, LlmProvider, ModelEntry } from "../types";
import { wordCheckTemplates } from "./WordCheckTemplates";
import { wordCountTemplates } from "./WordCountTemplates";
import { COMFYUI_FIXED_NAME, defaultComfyFields } from "./providers";

const EXPORT_KIND = "nyaachat_settings_export";
/** Bumped to 3 when the AppState gained MCP fields (`isMcpEnabled`,
 *  `mcpUserCity`, `mcpToolsEnabled`). v4 adds the native front-end renderer
 *  toggle/depth. v5 adds bypass sub-fields (opusChecks, wordCount,
 *  languageConstraint), isWebSearchEnabled / isStreaming validation, and
 *  ComfyUI image-provider field normalisation. Older files are still accepted
 *  and backfilled during import. */
const EXPORT_VERSION = 5;
const SUPPORTED_IMPORT_VERSIONS = new Set([2, 3, 4, 5]);

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

  if (s.isFrontendRenderingEnabled !== undefined && typeof s.isFrontendRenderingEnabled !== "boolean") {
    issues.push("isFrontendRenderingEnabled 必须是布尔");
  }
  if (s.frontendRenderingDepth !== undefined) {
    const depth = Number(s.frontendRenderingDepth);
    if (!Number.isFinite(depth) || depth < 0) {
      issues.push("frontendRenderingDepth 必须是不小于 0 的数字");
    }
  }
  if (
    s.sendMode !== undefined &&
    s.sendMode !== "enter" &&
    s.sendMode !== "ctrlEnter"
  ) {
    issues.push('sendMode 必须是 "enter" 或 "ctrlEnter"');
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

  // v5 fields: isWebSearchEnabled, isStreaming, bypass sub-fields (opusChecks,
  // wordCount, languageConstraint). Pre-v5 files may lack them entirely — we
  // accept and backfill below. v5+ files must carry valid shapes.
  if (obj._version >= 5) {
    if (s.isWebSearchEnabled !== undefined && typeof s.isWebSearchEnabled !== "boolean") {
      issues.push("isWebSearchEnabled 必须是布尔");
    }
    if (s.isStreaming !== undefined && typeof s.isStreaming !== "boolean") {
      issues.push("isStreaming 必须是布尔");
    }
    // bypass.opusChecks shape
    const bp = s.bypass as Record<string, unknown> | undefined;
    if (bp) {
      if (bp.opusChecks !== undefined) {
        if (!bp.opusChecks || typeof bp.opusChecks !== "object" || Array.isArray(bp.opusChecks)) {
          issues.push("bypass.opusChecks 必须是对象");
        }
      }
      // RosettaStone sub-objects
      const wc = bp.wordCount as Record<string, unknown> | undefined;
      if (wc) {
        if (wc.enabled !== undefined && typeof wc.enabled !== "boolean")
          issues.push("bypass.wordCount.enabled 必须是布尔");
        if (wc.template !== undefined && typeof wc.template !== "string")
          issues.push("bypass.wordCount.template 必须是字符串");
      }
      const lc = bp.languageConstraint as Record<string, unknown> | undefined;
      if (lc) {
        if (lc.enabled !== undefined && typeof lc.enabled !== "boolean")
          issues.push("bypass.languageConstraint.enabled 必须是布尔");
        if (lc.template !== undefined && typeof lc.template !== "string")
          issues.push("bypass.languageConstraint.template 必须是字符串");
      }
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

  // Backfill defaults so v2–v4 imports — and v5 imports that omit fields
  // — produce a complete AppState. Same defaults the schema migrator uses
  // when loading from localStorage; keeping them in sync is critical or
  // imported settings would behave differently from native ones.
  const filled: Record<string, unknown> = { ...s };
  if (typeof filled.isFrontendRenderingEnabled !== "boolean") {
    filled.isFrontendRenderingEnabled = true;
  }
  {
    const depth = Number(filled.frontendRenderingDepth);
    filled.frontendRenderingDepth = Number.isFinite(depth) && depth >= 0 ? Math.floor(depth) : 5;
  }
  if (filled.sendMode !== "enter" && filled.sendMode !== "ctrlEnter") {
    filled.sendMode = "ctrlEnter";
  }
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
    filled.mcpToolsEnabled = { get_current_time: false, get_weather: false, roll_coc: false, roll_dnd: false, web_search: false };
  } else if (!("web_search" in (filled.mcpToolsEnabled as Record<string, boolean>))) {
    // Backups written before web_search joined the tool list lack the key;
    // missing keys read as enabled, but this tool must default to OFF.
    filled.mcpToolsEnabled = {
      ...(filled.mcpToolsEnabled as Record<string, boolean>),
      web_search: false,
    };
  }

  // --- v5 backfills: bypass sub-fields, isWebSearchEnabled, isStreaming, ComfyUI ---

  // isWebSearchEnabled / isStreaming — pre-v5 files may lack them.
  if (typeof filled.isWebSearchEnabled !== "boolean") {
    filled.isWebSearchEnabled = false;
  }
  if (typeof filled.isStreaming !== "boolean") {
    filled.isStreaming = false;
  }

  // Bypass — ensure the object and all its sub-objects exist with defaults
  // matching App.tsx's DEFAULT_SETTINGS.bypass.
  if (!filled.bypass || typeof filled.bypass !== "object") {
    filled.bypass = {};
  }
  const bp = filled.bypass as Record<string, unknown>;

  // WordCheck (opusChecks)
  if (!bp.opusChecks || typeof bp.opusChecks !== "object" || Array.isArray(bp.opusChecks)) {
    bp.opusChecks = {
      gemini31Check: wordCheckTemplates.gemini31Check.content,
      opus48Check: wordCheckTemplates.opus48Check.content,
      opus47Check: wordCheckTemplates.opus47Check.content,
    };
  }

  // RosettaStone wordCount (default off)
  if (!bp.wordCount || typeof bp.wordCount !== "object") {
    bp.wordCount = { enabled: false, template: wordCountTemplates.wordCount.content };
  } else {
    const wc = bp.wordCount as Record<string, unknown>;
    if (typeof wc.enabled !== "boolean") wc.enabled = false;
    if (typeof wc.template !== "string" || !(wc.template as string).trim())
      wc.template = wordCountTemplates.wordCount.content;
  }

  // RosettaStone languageConstraint (default on)
  if (!bp.languageConstraint || typeof bp.languageConstraint !== "object") {
    bp.languageConstraint = { enabled: true, template: wordCountTemplates.languageConstraint.content };
  } else {
    const lc = bp.languageConstraint as Record<string, unknown>;
    if (typeof lc.enabled !== "boolean") lc.enabled = true;
    if (typeof lc.template !== "string" || !(lc.template as string).trim())
      lc.template = wordCountTemplates.languageConstraint.content;
  }

  // ComfyUI image-provider normalisation
  if (Array.isArray(filled.imageProviders)) {
    filled.imageProviders = normalizeImageProvidersForImport(
      filled.imageProviders as ImageProvider[],
    );
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
const VALID_IMAGE_KINDS = new Set([
  "qiny",
  "openai-custom",
  "comfyui-fixed",
  "comfyui-custom",
]);
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

/**
 * Normalize an imageProviders array for import. Mirrors App.tsx's
 * normalizeImageProviders but as a pure-function transform (no
 * cross-module coupling). Three guarantees:
 *   1. Legacy placeholder `kind: "comfyui"` → `"comfyui-fixed"` with comfy defaults.
 *   2. Any ComfyUI-kind provider missing comfy fields gets them backfilled.
 *   3. A `comfyui-fixed` entry always exists (created if absent).
 */
function normalizeImageProvidersForImport(list: ImageProvider[]): ImageProvider[] {
  const normalized = list.map((p) => {
    if ((p as any)?.kind === "comfyui") {
      const d = defaultComfyFields();
      return {
        ...p,
        kind: "comfyui-fixed",
        name: COMFYUI_FIXED_NAME,
        baseUrl: (p as any).baseUrl || "",
        ...d,
        enabled: !!p.enabled,
      } as ImageProvider;
    }
    if (p.kind === "comfyui-fixed" || p.kind === "comfyui-custom") {
      const d = defaultComfyFields();
      return {
        ...p,
        comfySize: p.comfySize ?? d.comfySize,
        comfyWorkflowId: p.comfyWorkflowId ?? d.comfyWorkflowId,
        comfyArtStyle: p.comfyArtStyle ?? d.comfyArtStyle,
        models: Array.isArray(p.models) && p.models.length > 0 ? p.models : d.models,
        lastUsedModel: p.lastUsedModel ?? d.lastUsedModel,
        name: p.kind === "comfyui-fixed" ? COMFYUI_FIXED_NAME : p.name,
      } as ImageProvider;
    }
    return p;
  });
  // Guarantee a fixed-ComfyUI entry exists.
  if (!normalized.some((p) => p.kind === "comfyui-fixed")) {
    const d = defaultComfyFields();
    normalized.push({
      id: "comfyui-fixed",
      kind: "comfyui-fixed",
      name: COMFYUI_FIXED_NAME,
      enabled: false,
      apiKey: "",
      baseUrl: "",
      models: d.models,
      lastUsedModel: d.lastUsedModel,
      ...d,
    } as ImageProvider);
  }
  return normalized;
}
