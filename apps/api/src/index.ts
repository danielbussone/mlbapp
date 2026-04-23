import { config } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { closePool } from './db/pool.js';
import { registerChatRoute } from './routes/chat.js';
import { registerHealthRoute } from './routes/health.js';
import { registerPlayersRoutes } from './routes/players.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../../../.env') });

const port = Number(process.env.PORT) || 3001;

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

registerHealthRoute(app);
registerPlayersRoutes(app);
registerChatRoute(app);

app.addHook('onClose', async () => {
  await closePool();
});

try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
