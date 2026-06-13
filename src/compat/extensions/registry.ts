// Extension registry resolver.
//
// Reads public/extensions/registry.json (the operator's installed list + root
// switches), then fetches each root-enabled extension's manifest.json. Merges
// the current user's per-extension preferences from localStorage and computes
// the effective enabled state: rootEnabled && (userPref ?? defaultUserEnabled).
//
// Governance is git: operators edit registry.json and the extension dirs, then
// rebuild. There is no backend and no runtime install/update/delete.

import type {
  ExtensionManifest,
  ExtensionRegistry,
  RegistryEntry,
  ResolvedExtension,
} from "./types";

/** Base path under which bundled extensions live (served from public/). */
export const EXTENSIONS_BASE = "/extensions";

const PREFS_KEY = "nyaachat_ext_prefs";

/** Per-user enable/disable choices, keyed by extension id. Missing = use the
 *  extension's defaultUserEnabled. */
export type UserExtensionPrefs = Record<string, boolean>;

export function loadUserPrefs(): UserExtensionPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function saveUserPref(id: string, enabled: boolean): void {
  const prefs = loadUserPrefs();
  prefs[id] = enabled;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) {
    console.error("[compat] failed to persist extension prefs", err);
  }
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Read the registry. Returns an empty list (not an error) when the file is
 *  absent — a deploy with no extensions is valid. */
export async function fetchRegistry(): Promise<RegistryEntry[]> {
  const reg = await fetchJson<ExtensionRegistry>(`${EXTENSIONS_BASE}/registry.json`);
  if (!reg || !Array.isArray(reg.extensions)) return [];
  return reg.extensions;
}

/**
 * Resolve the full extension list: registry ∪ manifests ∪ user prefs, with
 * effective state computed. Root-disabled extensions are dropped entirely
 * (users never see them). Entries whose manifest fails to load are skipped
 * with a warning rather than breaking the whole list.
 */
export async function resolveExtensions(): Promise<ResolvedExtension[]> {
  const entries = await fetchRegistry();
  const prefs = loadUserPrefs();
  const out: ResolvedExtension[] = [];

  for (const entry of entries) {
    if (!entry || !entry.id) continue;
    if (!entry.rootEnabled) continue; // operator-disabled: invisible & not loaded

    const manifest = await fetchJson<ExtensionManifest>(
      `${EXTENSIONS_BASE}/${entry.id}/manifest.json`,
    );
    if (!manifest || !manifest.display_name) {
      console.warn(`[compat] extension "${entry.id}" manifest missing or invalid; skipped`);
      continue;
    }

    const defaultUserEnabled = entry.defaultUserEnabled !== false; // default true
    const userPref = Object.hasOwn(prefs, entry.id) ? prefs[entry.id] : undefined;
    const effective = entry.rootEnabled && (userPref ?? defaultUserEnabled);

    out.push({
      id: entry.id,
      manifest,
      rootEnabled: entry.rootEnabled,
      defaultUserEnabled,
      userPref,
      effective,
    });
  }

  return out;
}
