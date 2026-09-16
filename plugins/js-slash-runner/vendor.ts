/**
 * 自托管 vendor 的路径与 importmap 装配（SSOT §5.2 / §5.3）。
 *
 * importmap **由 vendor 清单生成**（不是手写几个 URL）：MVU 的产物不自包含，
 * `mvu/bundle.js` 有 51 个、`mvu_zod.js` 有 5 个静态远程 ESM import（t1 实测），
 * 少映射一个就会在真下发 CSP / 离线时整链失败。
 */
export const SCRIPT_HOST_VENDOR_BASE = "/vendor/script-host";
export const SCRIPT_HOST_MANIFEST_URL = `${SCRIPT_HOST_VENDOR_BASE}/manifest.json`;

/** 清单不可用时的最小回退（只保顶层两条；清单缺失属于异常，会 warn）。 */
const FALLBACK_MAP: Record<string, string> = {
  "https://testingcf.jsdelivr.net/gh/MagicalAstrogy/MagVarUpdate/artifact/bundle.js":
    `${SCRIPT_HOST_VENDOR_BASE}/mvu/bundle.js`,
  "https://testingcf.jsdelivr.net/gh/StageDog/tavern_resource/dist/util/mvu_zod.js":
    `${SCRIPT_HOST_VENDOR_BASE}/mvu/mvu_zod.js`,
};

let cachedImportMap: Record<string, string> | null = null;

interface VendorManifestEntry {
  url?: unknown;
  path?: unknown;
}

/** 读取并缓存 importmap 的 `imports` 表（同源 fetch；清单由 t14 的更新脚本生成）。 */
export async function loadVendorImportMap(
  manifestUrl: string = SCRIPT_HOST_MANIFEST_URL,
): Promise<Record<string, string>> {
  if (cachedImportMap) return cachedImportMap;
  try {
    const response = await fetch(manifestUrl, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const parsed = (await response.json()) as { entries?: VendorManifestEntry[] };
    const imports: Record<string, string> = {};
    for (const entry of parsed.entries ?? []) {
      if (typeof entry?.url === "string" && typeof entry?.path === "string") {
        imports[entry.url] = entry.path;
      }
    }
    if (Object.keys(imports).length === 0) throw new Error("清单为空");
    cachedImportMap = imports;
    return imports;
  } catch (err) {
    console.warn(
      "[js-slash-runner] 读取 vendor 清单失败，退化为只映射顶层两条（离线/CDN 依赖会回来）",
      err,
    );
    cachedImportMap = { ...FALLBACK_MAP };
    return cachedImportMap;
  }
}

/** 单测/探针用：清空 importmap 缓存。 */
export function resetVendorImportMapCacheForTests(): void {
  cachedImportMap = null;
}
