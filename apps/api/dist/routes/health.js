import { getOllamaHealth } from '../services/ollamaHealth.js';
const VERSION = '0.0.1';
export function registerHealthRoute(app) {
    app.get('/health', async () => ({
        ok: true,
        service: 'mlbapp-api',
        version: VERSION,
    }));
    /** Ollama reachability: `/api/tags` + `/api/ps` (loaded models, VRAM-ish fields) + this API process memory snapshot. */
    app.get('/health/ollama', async (_req, reply) => {
        const h = await getOllamaHealth();
        if (!h.ok) {
            reply.code(503);
        }
        return h;
    });
}
