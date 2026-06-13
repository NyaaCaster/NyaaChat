// Extension system types (decision B-revised: build-time bundled extensions).
//
// Extensions live in `public/extensions/<id>/` and ship inside the image. A
// repo-maintained `public/extensions/registry.json` is the manifest of what's
// installed and each extension's root (operator) switch — the browser can't
// list a directory, so the registry is the index the loader reads.
//
// This mirrors the relevant slice of SillyTavern's manifest contract
// (display_name / loading_order / requires / js / css / ...) so ST extensions
// drop in with their manifest.json mostly intact.

/** A SillyTavern-compatible extension manifest (the subset we honour). */
export interface ExtensionManifest {
  display_name: string;
  /** Lower loads first (ST semantics). Missing = treated as 100. */
  loading_order?: number;
  /** Module dependencies (subset-checked). Currently advisory only. */
  requires?: string[];
  optional?: string[];
  /** Entry script, relative to the extension dir. Injected as <script type=module>. */
  js?: string;
  /** Stylesheet, relative to the extension dir. Injected as <link rel=stylesheet>. */
  css?: string;
  author?: string;
  version?: string;
  homePage?: string;
}

/** One entry in registry.json — the operator-controlled metadata for an
 *  installed extension. Edited in the repo (git + rebuild = governance). */
export interface RegistryEntry {
  /** Directory name under public/extensions/. */
  id: string;
  /** Operator root switch. false = hidden from users and never loaded. */
  rootEnabled: boolean;
  /** Default per-user enabled state when a user hasn't chosen yet. */
  defaultUserEnabled?: boolean;
}

/** The registry.json shape. `version` lets us evolve the format later. */
export interface ExtensionRegistry {
  version?: number;
  extensions: RegistryEntry[];
}

/** A fully-resolved extension: registry entry + loaded manifest + effective
 *  state. Built at runtime by the registry loader. */
export interface ResolvedExtension {
  id: string;
  manifest: ExtensionManifest;
  rootEnabled: boolean;
  defaultUserEnabled: boolean;
  /** The current user's preference (localStorage), or undefined if unset. */
  userPref?: boolean;
  /** rootEnabled && (userPref ?? defaultUserEnabled). */
  effective: boolean;
}
