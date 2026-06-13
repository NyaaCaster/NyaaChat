// Injected by vite.config.ts at build time from VERSION.md (the single source
// of truth for the app version). See readAppVersion() in vite.config.ts.
declare const __APP_VERSION__: string;

// Vite's ?raw suffix inlines a file's text content as a string at build time.
// Used to render VERSION.md inside the version modal without a runtime fetch,
// keeping VERSION.md as the single source.
declare module "*.md?raw" {
  const content: string;
  export default content;
}
