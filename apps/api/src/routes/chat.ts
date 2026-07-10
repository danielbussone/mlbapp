import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { chatRequestSchema } from '@mlbapp/shared';
import { runWithChatQueryLog } from '../db/chatQueryLogContext.js';
import { hasDatabaseUrl, getPool } from '../db/pool.js';
import type { ChatStreamLogger } from '../lib/chatStreamLog.js';
import { selectProvider, streamChatWithTools } from '../services/chat/index.js';

function sseWrite(
  res: NodeJS.WritableStream & { write: (chunk: string) => boolean },
  event: string,
  data: unknown
) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export function registerChatRoute(app: FastifyInstance) {
  app.post(
    '/chat',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = chatRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        reply.code(400).send({ error: 'Invalid body', details: parsed.error.flatten() });
        return;
      }
      const { message, active_player_id, active_season } = parsed.data;

      reply.hijack();
      const res = reply.raw;
      const sseHeaders = {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      } as const;

      const write = (event: string, data: unknown) => sseWrite(res, event, data);

      try {
        if (!hasDatabaseUrl()) {
          res.writeHead(503, sseHeaders);
          write('error', {
            message:
              'DATABASE_URL is not set. Chat with grounded stats requires Postgres (see .env.example).',
          });
          write('done', {});
          return;
        }

        res.writeHead(200, sseHeaders);
        const pool = getPool();
        const provider = selectProvider();
        await runWithChatQueryLog(req.log as ChatStreamLogger, async () =>
          streamChatWithTools(provider, pool, message, write, req.log as ChatStreamLogger, {
            traceId: req.id,
            active_player_id: active_player_id ?? undefined,
            active_season: active_season ?? undefined,
          })
        );
        write('done', {});
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        app.log.error({ err: e }, 'chat stream failed');
        if (!res.headersSent) {
          res.writeHead(500, sseHeaders);
        }
        write('error', { message: msg });
        write('done', {});
      } finally {
        res.end();
      }
    }
  );
}
