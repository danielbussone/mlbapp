/**
 * Must be imported before any module that reads `process.env` at load time.
 * ES modules hoist imports but evaluate dependency modules in order; `index.ts`
 * imports this file first so repo-root `.env` is loaded before e.g. `ollama.ts`
 * snapshots `OLLAMA_MODEL`.
 */
import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });
