import Fastify from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import { dbPlugin } from './plugins/db.js';
import { cookiePlugin } from './plugins/cookie.js';
import { compressPlugin } from './plugins/compress.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { authRoutes } from './modules/auth/routes.js';
import { profileRoutes } from './modules/profile/routes.js';
import { gameRoutes } from './modules/game/routes.js';
import { eventsRoutes } from './modules/events/routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: true
  });

  app.decorate('env', env);
  app.decorateRequest('auth', null);

  await app.register(cors, {
    origin: env.CORS_ORIGIN,
    credentials: true
  });

  await app.register(cookiePlugin);
  await app.register(compressPlugin);
  await app.register(rateLimitPlugin);
  await app.register(dbPlugin);

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(profileRoutes, { prefix: '/api/v1/profile' });
  await app.register(gameRoutes, { prefix: '/api/v1/game' });
  await app.register(eventsRoutes, { prefix: '/api/v1/events' });

  app.get('/api/v1/health', async () => ({
    ok: true,
    timestamp: Date.now()
  }));

  return app;
}
