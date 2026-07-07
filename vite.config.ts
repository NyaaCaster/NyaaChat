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
      // Non-secret display label for the fixed ComfyUI provider. The real
      // server URL is NOT injected here — it stays server-side via the nginx
      // /api/comfyui/fixed reverse proxy (envsubst), so it never lands in the
      // frontend bundle.
      __COMFYUI_FIXED_NAME__: JSON.stringify(env.COMFYUI_FIXED_NAME || 'NyaaComfyUI'),
      // Non-secret description shown under the fixed ComfyUI provider's name.
      __COMFYUI_FIXED_DESC__: JSON.stringify(env.COMFYUI_FIXED_DESC || ''),
      // Whether the deployer-paid T2I agent is enabled for comfyui-fixed.
      // true → ext-host agent, false → user's chat LLM (same as custom path).
      __COMFYUI_FIXED_T2I_AGENT_ENABLE__: JSON.stringify(
        env.COMFYUI_FIXED_T2I_AGENT_ENABLE === 'true'
      ),
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
        // Dev-mode mirror of nginx's /api/comfyui/fixed reverse proxy so the
        // fixed ComfyUI server is reachable under `npm run dev`. ws:true lets
        // the WebSocket progress channel (/ws) tunnel through. Only wired when
        // COMFYUI_FIXED_URL is set in .env.
        ...(env.COMFYUI_FIXED_URL
          ? {
              '/api/comfyui/fixed': {
                target: env.COMFYUI_FIXED_URL,
                changeOrigin: true,
                ws: true,
                rewrite: (p: string) => p.replace(/^\/api\/comfyui\/fixed/, ''),
                // Mirror nginx's server-side auth injection so `npm run dev`
                // also authenticates against the fixed ComfyUI server. The
                // token stays in the dev (node) process — never shipped to the
                // browser. Only sent when COMFYUI_FIXED_TOKEN is set.
                ...(env.COMFYUI_FIXED_TOKEN
                  ? { headers: { Authorization: `Bearer ${env.COMFYUI_FIXED_TOKEN}` } }
                  : {}),
              },
            }
          : {}),
      },
    },
  };
});
