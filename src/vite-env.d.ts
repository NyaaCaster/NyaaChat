// Injected by vite.config.ts at build time from VERSION.md (the single source
// of truth for the app version). See readAppVersion() in vite.config.ts.
declare const __APP_VERSION__: string;

// Display name of the fixed ComfyUI server (NyaaComfyUI). Injected by
// vite.config.ts from COMFYUI_FIXED_NAME in .env. This is a non-secret label
// only — the server's real URL never reaches the bundle (nginx proxies it).
declare const __COMFYUI_FIXED_NAME__: string;

// Display description (small text under the name) of the fixed ComfyUI server.
// Injected by vite.config.ts from COMFYUI_FIXED_DESC in .env. Non-secret.
declare const __COMFYUI_FIXED_DESC__: string;

// Vite's ?raw suffix inlines a file's text content as a string at build time.
// Used to render VERSION.md inside the version modal without a runtime fetch,
// keeping VERSION.md as the single source.
declare module "*.md?raw" {
  const content: string;
  export default content;
}
