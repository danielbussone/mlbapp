import './loadEnv.js';
import cors from '@fastify/cors';
import Fastify from 'fastify';
import { closePool } from './db/pool.js';
import { registerChatRoute } from './routes/chat.js';
import { registerHealthRoute } from './routes/health.js';
import { registerPlayersRoutes } from './routes/players.js';
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
    app.log.info({ port, cwd: process.cwd() }, 'mlbapp-api listening (Vite /api proxy targets this port; cwd should be apps/api in the repo you are editing)');
}
catch (err) {
    app.log.error(err);
    process.exit(1);
}
