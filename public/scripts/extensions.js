// Shim for SillyTavern's public/scripts/extensions.js.
//
// The single most-imported ST module for extensions:
//   import { extension_settings, getContext, loadExtensionSettings } from
//     "../../../extensions.js";
// `extension_settings` MUST be the same stable object the host exposes — many
// extensions capture a reference and mutate it, then call saveSettingsDebounced.
// We pull it from getContext() once at eval (the host keeps a single instance).

import { ctx, warnOnce } from "./_compat-host.js";
import { saveMetadataDebounced as saveMetadataDebouncedFromRoot } from "../script.js";

export { saveMetadataDebouncedFromRoot as saveMetadataDebounced };

export const UNSET_VALUE = "__@@UNSET@@__";

/** The shared, stable extension settings object. Same identity as
 *  getContext().extension_settings, so reads/writes are seen by the host. */
export const extension_settings = ctx().extension_settings;

/** Re-export the host getContext so `import { getContext }` works from here too
 *  (extensions import it from either extensions.js or script.js). */
export function getContext() {
  return ctx();
}

/** ST loads per-extension settings UI here. NyaaChat has no settings drawer, so
 *  this is a no-op that resolves — extensions call it during init. */
export function loadExtensionSettings() {
  return Promise.resolve();
}

/** Render a handlebars template bundled with an extension. Not supported (no
 *  template pipeline); resolves to empty so callers don't crash on init. */
export function renderExtensionTemplateAsync(...args) {
  void args;
  warnOnce("renderExtensionTemplateAsync() is not implemented; returns ''");
  return Promise.resolve("");
}

export function renderExtensionTemplate(...args) {
  void args;
  warnOnce("renderExtensionTemplate() is not implemented; returns ''");
  return "";
}

/** Persist a field into a character's data.extensions. */
export function writeExtensionField(characterId, key, value) {
  const fn = ctx().writeExtensionField;
  if (typeof fn === "function") return fn(characterId, key, value);
  warnOnce("writeExtensionField() is not implemented in the NyaaChat compat layer");
  return Promise.resolve();
}

/** Module registries. ST populates these; we keep empty stable containers so
 *  extensions that read them (e.g. to check a dependency) get defined values. */
export const extensionNames = [];
export const extensionTypes = {};
export const modules = [];

/** ST exposes its server-extension fetch helper; unsupported here. */
export function doExtrasFetch(...args) {
  void args;
  warnOnce("doExtrasFetch() is not supported (no Extras backend)");
  return Promise.reject(new Error("Extras backend not available"));
}
