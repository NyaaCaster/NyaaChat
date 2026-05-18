import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
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
