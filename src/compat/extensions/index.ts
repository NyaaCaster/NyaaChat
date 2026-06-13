// Extension system barrel (decision B-revised: build-time bundled extensions).
export { loadEnabledExtensions, isExtensionLoaded } from "./loader";
export {
  resolveExtensions,
  fetchRegistry,
  loadUserPrefs,
  saveUserPref,
  EXTENSIONS_BASE,
} from "./registry";
export {
  ensureExtensionSettingsHost,
  attachExtensionSettingsHost,
  parkExtensionSettingsHost,
} from "./settingsHost";
export type { UserExtensionPrefs } from "./registry";
export type {
  ExtensionManifest,
  RegistryEntry,
  ExtensionRegistry,
  ResolvedExtension,
} from "./types";
