import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

// Single source of truth for the app version: VERSION.md. The build parses the
// "## 当前版本：vX.Y.Z" heading and injects it as __APP_VERSION__ so the UI never
// hard-codes a version string (no double maintenance). Falls back to 0.0.0 if the
// file or heading is missing.
function readAppVersion(): string {
  try {
    const md = fs.readFileSync(path.resolve(__dirname, 'VERSION.md'), 'utf-8');
    const m = md.match(/##\s*当前版本[：:]\s*v?([0-9][0-9.]*)/);
    return m ? m[1] : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      __APP_VERSION__: JSON.stringify(readAppVersion()),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
      // Mirror nginx.conf so dev mode (vite on :3000) reaches the same
      // SearXNG endpoint that production reaches via the nginx reverse
      // proxy. Without this, /api/search would 404 in dev.
      proxy: {
        '/api/search': {
          target: 'http://j.hony-wen.com:1441',
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api\/search/, '/search'),
        },
      },
    },
  };
});
