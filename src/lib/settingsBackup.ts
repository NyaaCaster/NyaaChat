import { AppState, ImageProvider, LlmProvider, ModelEntry } from "../types";
import { wordCheckTemplates } from "./WordCheckTemplates";
import { wordCountTemplates } from "./WordCountTemplates";
import { normalizeAnswererFlagalacState } from "./FlagalacTemplates";
import { requiredStreamingForTarget } from "./flagalacOptions";
import { loadCover, saveCover } from "./coverStorage";
import { COMFYUI_FIXED_NAME, createDefaultLlmProviders, defaultComfyFields } from "./providers";
import { MIN_THRESHOLD_PCT, MAX_THRESHOLD_PCT, DEFAULT_THRESHOLD_PCT } from "./contextBudget";

const EXPORT_KIND = "nyaachat_settings_export";
/** Bumped to 3 when the AppState gained MCP fields (`isMcpEnabled`,
 *  `mcpUserCity`, `mcpToolsEnabled`). v4 adds the native front-end renderer
 *  toggle/depth. v5 adds bypass sub-fields (opusChecks, wordCount,
 *  languageConstraint), isWebSearchEnabled / isStreaming validation, and
 *  ComfyUI image-provider field normalisation. v6 adds persistent-memory fields
 *  (isMemoryEnabled, memoryThresholdPct, modelContextOverrides). v7 adds the
 *  AnswererFlagalac single-select bypass target (`bypass.answererFlagalac`).
 *  v8 drops the retired ClavisSalomonis bypass fields (`bypass.enabled`,
 *  `templateName`, the seven template toggles, `customTemplates`) — imports
 *  carrying them have those keys stripped during backfill.
 *  v9 adds the AnswererFlagalac per-target sub-option switches
 *  (`bypass.answererFlagalac.perTarget`) + the streaming override flag; its
 *  validation and backfill go through the same
 *  `normalizeAnswererFlagalacState()` the localStorage load path uses.
 *  Older files are still accepted and backfilled during import.
 *
 *  ⚠️ **v9 仍是当前版本，且刻意不再上调**（2026-09-13）：此后对
 *  AnswererFlagalac 的改动都是**双向兼容的增删** ——
 *    · 载荷文本改为不可由用户改写（D-30）⇒ `perTarget[id].templates` 退休。
 *      它是**可选**字段：新代码忽略它（老存档照常导入），新导出不再写它，
 *      老版本读到"没有该键"也不会报错；
 *    · 目标一新增子选项 `unicodeEncoding`（D-31）⇒ 老存档缺该键时按
 *      `defaultEnabled` 落回（收敛规则③），老版本则把未知 id 静默丢弃。
 *  上调版本号只会**单方面**让老版本拒绝新存档（`SUPPORTED_IMPORT_VERSIONS`
 *  的上限），换不到任何校验收益 —— 保持 v9 才是兼容性最优解。 */
const EXPORT_VERSION = 9;
const SUPPORTED_IMPORT_VERSIONS = new Set([2, 3, 4, 5, 6, 7, 8, 9]);

export interface ExportPayload {
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
 * Strip the **retired-field set** from `perTarget[id]` on the export side.
 * 退休字段集合（**当前含 `templates`、`layer`；新增退休键时在此登记**）：
 *   · `templates`（D-30：载荷文本不可由用户改写 ⇒ 死数据）
 *   · `layer`（同一批 D-30 把选项声明里的 `layer` 整段删除）
 * It makes the statement "新导出不再写它" true for **every** export route — the
 * local download and the cloud upload both go through `buildExportPayload()`.
 *
 * Protection, not repair: the in-memory state is normally already normalized by
 * `normalizeAnswererFlagalacState()` (App.tsx load / settings import), which drops
 * both keys; neither was ever written by the product. A hand-edited localStorage
 * or any future writer must not be able to leak them into an archive.
 *
 * ⚠️ （t12 更正，2026-09-13；原句保留不删）上面那句 "**neither was ever written by
 * the product**" **对 `templates` 不成立**：`templates` **有过真实写入点** ——
 * verifier-data 的 `pG` **G8** 抓到的「本地下载路径泄漏」正是因此（`exportSettings()`
 * 当时自己内联拼 payload，绕过了本函数，于是把在内存里的 `templates` 写进了归档）。
 * 真正"从未被产品写入、只是声明层字段"的只有 **`layer`**（D-31 已连同类型一起删除）。
 * ⇒ 两者**可达性不同**：`layer` 属纯声明残留，`templates` 属**曾经可达、已收敛**；
 * 本函数对两者一视同仁地剥离，但不要再用"从未写入"去描述 `templates`。
 *
 * Export-only by design: the IMPORT side stays lenient (`validateImportPayload`
 * below accepts archives that still carry `templates`, it just ignores the value),
 * so old backups keep importing.
 */
function stripRetiredFlagalacTemplates(
  answererFlagalac: AppState["bypass"]["answererFlagalac"],
): AppState["bypass"]["answererFlagalac"] {
  const perTarget = answererFlagalac?.perTarget;
  if (!perTarget || typeof perTarget !== "object" || Array.isArray(perTarget)) {
    return answererFlagalac;
  }
  let changed = false;
  const next: typeof perTarget = {};
  for (const [id, entry] of Object.entries(perTarget)) {
    const raw = entry as Record<string, unknown> | null;
    if (raw && typeof raw === "object" && ("templates" in raw || "layer" in raw)) {
      const { templates: _retiredTemplates, layer: _retiredLayer, ...rest } = raw;
      next[id] = rest as (typeof perTarget)[string];
      changed = true;
    } else {
      next[id] = entry;
    }
  }
  return changed ? { ...answererFlagalac, perTarget: next } : answererFlagalac;
}

/**
 * Build the export payload object without triggering a download. Used by the
 * cloud-settings upload flow (SettingsModal) so the same stripping + timestamp
 * logic is shared with the local-download path.
 */
export function buildExportPayload(settings: AppState): ExportPayload {
  return {
    _kind: EXPORT_KIND,
    _version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    settings: {
      ...settings,
      bypass: {
        ...settings.bypass,
        answererFlagalac: stripRetiredFlagalacTemplates(settings.bypass?.answererFlagalac),
      },
      llmProviders: settings.llmProviders.map(stripLlmProvider),
      imageProviders: settings.imageProviders.map(stripImageProvider),
    },
  };
}

/** Convert a Blob to a pure base64 string (no data: prefix). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      // Strip "data:image/webp;base64," prefix.
      const comma = dataUrl.indexOf(",");
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Collect cover images from IndexedDB for every character whose `coverImage`
 * marker is truthy (COVER_MARKER). Characters whose blob is missing from
 * IndexedDB are silently skipped.
 *
 * Returns a map of characterId → pure base64 WebP (no data: prefix), ready for
 * upload to the cloud settings cover endpoint.
 */
export async function collectLocalCovers(settings: AppState): Promise<Record<string, string>> {
  const covers: Record<string, string> = {};
  for (const ch of settings.characters) {
    if (!ch.coverImage) continue; // COVER_MARKER is "idb" — truthy
    try {
      const blob = await loadCover(ch.id);
      if (!blob) continue;
      covers[ch.id] = await blobToBase64(blob);
    } catch {
      // IndexedDB read or base64 conversion failed — skip this character.
    }
  }
  return covers;
}

/**
 * Persist downloaded cover images into IndexedDB so they show up in the UI.
 * Each value is a pure base64 WebP string (no data: prefix). Entries that fail
 * to decode are silently skipped.
 */
export async function applyDownloadedCovers(covers: Record<string, string>): Promise<void> {
  for (const [characterId, b64] of Object.entries(covers)) {
    if (!b64 || typeof b64 !== "string") continue;
    try {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: "image/webp" });
      await saveCover(characterId, blob);
    } catch {
      // Bad base64 or IndexedDB write failed — skip this entry.
    }
  }
}

/**
 * Build the export payload, serialize it, and trigger a browser download.
 * Filename is `NyaaChatSetting-YYMMDDhhmmss.json` per spec.
 *
 * Caveat: the JSON contains API keys in plaintext. Caller must surface a
 * warning to the user — this helper trusts the explicit click.
 *
 * （t12：本块原是被夹在 `stripRetiredFlagalacTemplates` 文档之前的**悬空 JSDoc**
 *  —— 它在 HEAD 就已是悬空状态，V2 只是把新函数插在了它下面；现搬回本函数正上方。
 *  仅注释；措辞与内容未改，且因 `exportSettings()` 已收敛到 `buildExportPayload()`
 *  而重新准确。）
 */
export function exportSettings(settings: AppState): void {
  // 走同一个构造器（而不是本地再拼一份）：t10/pG 的 G8 实测发现旧写法绕过了
  // `buildExportPayload()` ⇒ 「本地下载」这条导出路径仍会把已退休的
  // `perTarget[*].templates` 写进归档。收敛到单一构造器后，两条导出路径
  // （本地下载 / 云端上传）的剔除逻辑不可能再分叉。
  const payload = buildExportPayload(settings);

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
    // The `bypass` CONTAINER must be a plain object, at every version. Arrays
    // satisfy a bare `typeof === "object"`, so `bypass: []` used to slip through
    // validation and then reach the backfill below, which spread it into the
    // imported state (SSOT 已知问题 #10). Report it instead of reshaping it
    // silently: a malformed container means the archive is not trustworthy, and
    // the message names the offending key so the user can fix the file.
    if (
      s.bypass !== undefined &&
      (s.bypass === null || typeof s.bypass !== "object" || Array.isArray(s.bypass))
    ) {
      issues.push("bypass 必须是对象");
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

  // v6 fields: persistent-memory switch + threshold + context overrides.
  // Pre-v6 files lack them entirely — accepted and backfilled below.
  if (obj._version >= 6) {
    if (s.isMemoryEnabled !== undefined && typeof s.isMemoryEnabled !== "boolean") {
      issues.push("isMemoryEnabled 必须是布尔");
    }
    if (
      s.memoryThresholdPct !== undefined &&
      (typeof s.memoryThresholdPct !== "number" ||
        !Number.isFinite(s.memoryThresholdPct) ||
        s.memoryThresholdPct < MIN_THRESHOLD_PCT ||
        s.memoryThresholdPct > MAX_THRESHOLD_PCT)
    ) {
      issues.push(`memoryThresholdPct 必须是 ${MIN_THRESHOLD_PCT}-${MAX_THRESHOLD_PCT} 的数字`);
    }
    if (
      s.modelContextOverrides !== undefined &&
      (typeof s.modelContextOverrides !== "object" ||
        s.modelContextOverrides === null ||
        Array.isArray(s.modelContextOverrides))
    ) {
      issues.push("modelContextOverrides 必须是对象");
    }
  }

  // v7 fields: AnswererFlagalac single-select bypass target. Pre-v7 archives
  // lack it entirely — accepted and backfilled below (to「无」).
  // v9 adds the per-target sub-option switches (`perTarget`) and the streaming
  // override flag. Pre-v9 archives lack those — accepted and backfilled below.
  // Only rejected values (wrong primitive types) are reported as issues.
  if (obj._version >= 7) {
    const bp = s.bypass as Record<string, unknown> | undefined;
    const af = bp?.answererFlagalac as Record<string, unknown> | undefined;
    if (af !== undefined) {
      if (!af || typeof af !== "object" || Array.isArray(af)) {
        issues.push("bypass.answererFlagalac 必须是对象");
      } else {
        if (af.target !== undefined && typeof af.target !== "string") {
          issues.push("bypass.answererFlagalac.target 必须是字符串");
        }
        // `streamingOverridden`（P3 落的流式覆盖标志）刻意**不做类型校验**：
        // 它不是本阶段的数据形状，非布尔值由回填时的归一化静默丢弃即可，
        // 不应因此拒绝整份备份。
        const pt = af.perTarget;
        if (pt !== undefined) {
          if (!pt || typeof pt !== "object" || Array.isArray(pt)) {
            issues.push("bypass.answererFlagalac.perTarget 必须是对象");
          } else {
            for (const [id, entry] of Object.entries(pt as Record<string, unknown>)) {
              if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
                issues.push(`bypass.answererFlagalac.perTarget.${id} 必须是对象`);
                continue;
              }
              const opts = (entry as Record<string, unknown>).options;
              if (
                opts !== undefined &&
                (!opts || typeof opts !== "object" || Array.isArray(opts))
              ) {
                issues.push(`bypass.answererFlagalac.perTarget.${id}.options 必须是对象`);
              }
              // `templates`（用户改过的载荷文本）已在 D-30 退休：新导出不再写它，
              // 读写两侧都忽略它。这里仍保留"若存在必须是对象"的**宽松**校验，
              // 只为让 v≤9 的老存档照常导入，而不是把它当成必需字段。
              const tpls = (entry as Record<string, unknown>).templates;
              if (
                tpls !== undefined &&
                (!tpls || typeof tpls !== "object" || Array.isArray(tpls))
              ) {
                issues.push(`bypass.answererFlagalac.perTarget.${id}.templates 必须是对象`);
              }
            }
          }
        }
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
  // matching App.tsx's DEFAULT_SETTINGS.bypass. Arrays are rejected here too:
  // `validateImportPayload()` already reports `bypass: []` as an issue, and this
  // guard keeps the fallback path (used when an older caller skips validation)
  // from spreading array indices into the imported object.
  if (!filled.bypass || typeof filled.bypass !== "object" || Array.isArray(filled.bypass)) {
    filled.bypass = {};
  }
  const bp = filled.bypass as Record<string, unknown>;

  // Retired ClavisSalomonis keys (v7 exports and older carry them). The module
  // — including its injection path — has been removed, so an imported archive
  // must not be able to reintroduce `bypass.enabled` and silently re-inject the
  // seven templates (the R1 defect: the only switch was inside a commented-out
  // block, so the state was unmanageable from the UI). Strip unconditionally;
  // `wordCountControl` is retired for the same "dead data" reason.
  for (const key of [
    "enabled",
    "templateName",
    "identityReset",
    "scenarioFramework",
    "aiSelfPersuasion",
    "roleplayInduction",
    "safetyStatement",
    "creativeGuidance",
    "disclaimer",
    "customTemplates",
    "wordCountControl",
  ]) {
    delete bp[key];
  }

  // WordCheck (opusChecks)
  if (!bp.opusChecks || typeof bp.opusChecks !== "object" || Array.isArray(bp.opusChecks)) {
    bp.opusChecks = {
      gemini31Check: wordCheckTemplates.gemini31Check.content,
      op1Check: wordCheckTemplates.op1Check.content,
      op2Check: wordCheckTemplates.op2Check.content,
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

  // AnswererFlagalac — converge to a currently-known target id AND to legal
  // per-target sub-option switches. Pre-v7 archives have no such field; pre-v9
  // archives have only `target`; either way an archive may carry a target or a
  // sub-option id that was retired from lib/FlagalacTemplates.ts. Convergence
  // rules (unknown target →「无」, unknown option id dropped, missing toggle →
  // template default) live in normalizeAnswererFlagalacState() so the import
  // path and the localStorage load path can never drift apart.
  const normalizedFlagalac = normalizeAnswererFlagalacState(bp.answererFlagalac);
  // P3 — `streamingOverridden` (the streaming auto-sync override flag) is a
  // plain boolean and nothing else. A hand-edited archive carrying a string /
  // number / null must neither reject the whole backup (the import validation
  // above deliberately skips this key) nor come back as a truthy flag, so any
  // non-boolean value is dropped here (= "never overridden"). The shared
  // normalizer already does this; the guard keeps the guarantee local to the
  // import/backfill path as well.
  if (typeof normalizedFlagalac.streamingOverridden !== "boolean") {
    delete normalizedFlagalac.streamingOverridden;
  }
  bp.answererFlagalac = normalizedFlagalac;

  // AnswererFlagalac — restore the target's **streaming requirement** too.
  //
  // Selecting a bypass target in the UI writes `isStreaming` to whatever the
  // target demands (`requiresStreaming`; e.g. gemini3.7flash's payload requires
  // streaming OFF — D-11), and `streamingOverridden` marks a user who changed the
  // toggle by hand afterwards (D-09/D-10: never restore an old value, never fight
  // the user).
  //
  // An imported archive is a restore of that whole decision, so replay the
  // requirement here as well — otherwise a restored config can be *active but
  // mis-configured* (target selected while streaming is on), which is precisely
  // the combination that produced the failures we chased on 2026-09-13. The
  // archive's own override flag still wins: only `streamingOverridden !== true`
  // is rewritten.
  const importedStreaming = requiredStreamingForTarget(normalizedFlagalac.target);
  if (importedStreaming !== undefined && normalizedFlagalac.streamingOverridden !== true) {
    filled.isStreaming = importedStreaming;
  }

  // ComfyUI image-provider normalisation
  if (Array.isArray(filled.imageProviders)) {
    filled.imageProviders = normalizeImageProvidersForImport(
      filled.imageProviders as ImageProvider[],
    );
  }

  // Built-in LLM provider presets — old archives predate newer built-ins
  // (e.g. opencode-go). Without backfilling, importers would permanently
  // miss presets that can't be added manually. Existing providers keep
  // their state and order; missing presets are inserted at canonical spots.
  if (Array.isArray(filled.llmProviders)) {
    filled.llmProviders = ensureBuiltinLlmProviders(
      filled.llmProviders as LlmProvider[],
    );
  }

  // --- v6 backfills: persistent memory ---
  // Old archives predate the feature; importing one must never silently turn
  // on plaintext server-side storage, so this defaults to false regardless.
  if (typeof filled.isMemoryEnabled !== "boolean") {
    filled.isMemoryEnabled = false;
  }
  {
    const pct = Number(filled.memoryThresholdPct);
    filled.memoryThresholdPct =
      Number.isFinite(pct) && pct >= MIN_THRESHOLD_PCT && pct <= MAX_THRESHOLD_PCT
        ? Math.floor(pct)
        : DEFAULT_THRESHOLD_PCT;
  }
  if (
    !filled.modelContextOverrides ||
    typeof filled.modelContextOverrides !== "object" ||
    Array.isArray(filled.modelContextOverrides)
  ) {
    filled.modelContextOverrides = {};
  }
  // memoryDisclosureAcceptedAt is deliberately NOT backfilled to a timestamp:
  // an imported archive must re-show the plaintext-storage disclosure.
  if (!Number.isFinite(filled.memoryDisclosureAcceptedAt)) {
    delete filled.memoryDisclosureAcceptedAt;
  }

  return { kind: "ok", settings: filled as unknown as AppState };
}

const VALID_LLM_KINDS = new Set([
  "qiny",
  "gemini",
  "anthropic",
  "openai",
  "deepseek",
  "opencode-go",
  "ollama",
  "custom",
]);

/**
 * Ensure every built-in LLM provider preset exists in an imported provider
 * list. Old archives predate newer built-ins (e.g. OpenCode Go); without
 * this they'd be permanently missing after import — built-ins can't be
 * added manually, they only come from the preset seeds. Existing providers
 * keep their exact objects (enabled / apiKey / models / order untouched);
 * each missing preset is created with defaults and inserted right after
 * its nearest earlier built-in in canonical preset order, so e.g.
 * opencode-go lands between deepseek and ollama on fresh imports.
 */
export function ensureBuiltinLlmProviders(list: LlmProvider[]): LlmProvider[] {
  const fresh = createDefaultLlmProviders();
  const missing = fresh.filter((fp) => !list.some((p) => p.kind === fp.kind));
  if (missing.length === 0) return list;

  const prevKindByKind = new Map<string, string | null>();
  fresh.forEach((fp, i) => {
    prevKindByKind.set(fp.kind, i === 0 ? null : fresh[i - 1].kind);
  });

  const out = [...list];
  for (const fp of missing) {
    const prevKind = prevKindByKind.get(fp.kind) ?? null;
    let insertAt = 0;
    if (prevKind) {
      const idx = out.findIndex((p) => p.kind === prevKind);
      if (idx >= 0) insertAt = idx + 1;
    }
    out.splice(insertAt, 0, fp);
  }
  return out;
}
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
