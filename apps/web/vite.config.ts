import react from '@vitejs/plugin-react';
import { config as dotenvConfig } from 'dotenv';
import { defineConfig } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Monorepo root (…/mlbapp) — same as `apps/api` `loadEnv.ts`. */
const repoRoot = resolve(__dirname, '../..');
dotenvConfig({ path: resolve(repoRoot, '.env') });
const overlay = process.env.MLBAPP_DOTENV?.trim();
if (overlay) {
  dotenvConfig({ path: resolve(repoRoot, overlay), override: true });
}

export default defineConfig(() => {
  const port = (process.env.PORT ?? '3001').trim() || '3001';
  const apiTarget = (process.env.VITE_API_PROXY_TARGET ?? `http://127.0.0.1:${port}`).trim();

  return {
    envDir: repoRoot,
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  };
});
