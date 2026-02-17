import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from './config/env.js';
import { dbPlugin } from './plugins/db.js';
import { cookiePlugin } from './plugins/cookie.js';
import { compressPlugin } from './plugins/compress.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { networkHeadersPlugin } from './plugins/network-headers.js';
import { authRoutes } from './modules/auth/routes.js';
import { profileRoutes } from './modules/profile/routes.js';
import { gameRoutes } from './modules/game/routes.js';
import { gameV5Routes } from './modules/game-v5/routes.js';
import { registerV5TickScheduler } from './modules/game-v5/service.js';
import { eventsRoutes } from './modules/events/routes.js';
import { metaRoutes } from './modules/meta/routes.js';
import { isServiceUnavailableError, toServiceUnavailableResponse } from './utils/errors.js';
import { probeDatabase } from './utils/db.js';

function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function assertCriticalV51Routes(app: FastifyInstance): void {
  const requiredRoutes = [
    { method: 'GET', url: '/api/v1/game/v5/expansion/state' },
    { method: 'POST', url: '/api/v1/game/v5/academy/batch/start' },
    { method: 'GET', url: '/api/v1/game/v5/academy/batch/current' },
    { method: 'POST', url: '/api/v1/game/v5/academy/batch/submit-day' },
    { method: 'POST', url: '/api/v1/game/v5/academy/batch/graduate' },
    { method: 'GET', url: '/api/v1/game/v5/recruitment/board' },
    { method: 'POST', url: '/api/v1/game/v5/recruitment/apply' }
  ] as const;

  for (const route of requiredRoutes) {
    if (!app.hasRoute(route)) {
      throw new Error(`Critical route missing: ${route.method} ${route.url}`);
    }
  }
}

export async function buildApp() {
  const app = Fastify({
    logger: true,
    trustProxy: true
  });

  app.decorate('env', env);
  app.decorateRequest('auth', null);

  const allowedOrigins = parseCorsOrigins(env.CORS_ORIGIN);

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }

      cb(null, false);
    },
    credentials: true,
    maxAge: 86_400
  });

  app.setErrorHandler((error, request, reply) => {
    const candidate = error as { statusCode?: number; details?: unknown; message?: string };

    if (candidate.statusCode === 400) {
      reply.code(400).send({ error: candidate.message ?? 'Validation failed', details: candidate.details ?? null });
      return;
    }

    if (isServiceUnavailableError(error)) {
      request.log.error({ err: error }, 'service-unavailable');
      reply.code(503).send(toServiceUnavailableResponse());
      return;
    }

    request.log.error({ err: error }, 'unhandled-error');
    reply.code(500).send({ error: 'Internal server error' });
  });

  await app.register(networkHeadersPlugin);
  await app.register(cookiePlugin);
  await app.register(compressPlugin);
  await app.register(rateLimitPlugin);
  // Register DB plugin directly on root instance so app.db is available during startup probes.
  await dbPlugin(app);

  await app.register(authRoutes, { prefix: '/api/v1/auth' });
  await app.register(profileRoutes, { prefix: '/api/v1/profile' });
  await app.register(gameRoutes, { prefix: '/api/v1/game' });
  await app.register(gameV5Routes, { prefix: '/api/v1/game/v5' });
  await app.register(eventsRoutes, { prefix: '/api/v1/events' });
  await app.register(metaRoutes, { prefix: '/api/v1/meta' });
  assertCriticalV51Routes(app);
  registerV5TickScheduler(app);

  let healthCache:
    | {
        statusCode: 200 | 503;
        payload: Record<string, unknown>;
        expiresAt: number;
      }
    | null = null;

  app.get('/api/v1/health', async (request, reply) => {
    const now = Date.now();
    if (healthCache && now < healthCache.expiresAt) {
      reply.code(healthCache.statusCode).send(healthCache.payload);
      return;
    }

    try {
      await probeDatabase(app.db, app.env.DB_HEALTHCHECK_TIMEOUT_MS);
      const payload = { ok: true, db: 'up', timestamp: Date.now() };
      healthCache = {
        statusCode: 200,
        payload,
        expiresAt: Date.now() + app.env.DB_HEALTHCHECK_INTERVAL_MS
      };

      reply.code(200).send(payload);
    } catch (error) {
      request.log.error({ err: error }, 'db-healthcheck-failed');
      const payload = {
        ok: false,
        db: 'down',
        error: 'Service temporarily unavailable',
        timestamp: Date.now()
      };
      healthCache = {
        statusCode: 503,
        payload,
        expiresAt: Date.now() + app.env.DB_HEALTHCHECK_INTERVAL_MS
      };

      reply.code(503).send(payload);
    }
  });

  return app;
}
