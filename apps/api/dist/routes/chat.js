import { chatRequestSchema } from '@mlbapp/shared';
import { hasDatabaseUrl, getPool } from '../db/pool.js';
import { streamOllamaChatWithTools } from '../services/ollama.js';
function sseWrite(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}
export function registerChatRoute(app) {
    app.post('/chat', async (req, reply) => {
        const parsed = chatRequestSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
            reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
            return;
        }
        const { message } = parsed.data;
        reply.hijack();
        const res = reply.raw;
        const sseHeaders = {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        };
        const write = (event, data) => sseWrite(res, event, data);
        try {
            if (!hasDatabaseUrl()) {
                res.writeHead(503, sseHeaders);
                write('error', {
                    message: 'DATABASE_URL is not set. Chat with grounded stats requires Postgres (see .env.example).',
                });
                write('done', {});
                return;
            }
            res.writeHead(200, sseHeaders);
            const pool = getPool();
            await streamOllamaChatWithTools(pool, message, write);
            write('done', {});
        }
        catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            app.log.error({ err: e }, 'chat stream failed');
            if (!res.headersSent) {
                res.writeHead(500, sseHeaders);
            }
            write('error', { message: msg });
            write('done', {});
        }
        finally {
            res.end();
        }
    });
}
