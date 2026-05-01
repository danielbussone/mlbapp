import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  /** Monorepo root (…/mlbapp) so we read the same `.env` as `apps/api` dotenv. */
  const repoRoot = resolve(__dirname, '..');
  const env = loadEnv(mode, repoRoot, '');
  const port = (env.PORT ?? '3001').trim() || '3001';
  const apiTarget = (env.VITE_API_PROXY_TARGET ?? `http://127.0.0.1:${port}`).trim();

  return {
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
