/**
 * Must be imported before any module that reads `process.env` at load time.
 * ES modules hoist imports but evaluate dependency modules in order; `index.ts`
 * imports this file first so repo-root `.env` is loaded before e.g. `ollama.ts`
 * snapshots `OLLAMA_MODEL`.
 *
 * Optional second file: set `MLBAPP_DOTENV` (shell or in `.env`) to a repo-root–relative
 * name such as `.env.remote`; it is loaded after `.env` with override so `DATABASE_URL`
 * and other keys can point at RDS while shared keys stay in `.env`.
 */
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');
config({ path: resolve(repoRoot, '.env') });
const overlay = process.env.MLBAPP_DOTENV?.trim();
if (overlay) {
  config({ path: resolve(repoRoot, overlay), override: true });
}
