import type { Pool } from 'pg';
import type { EnvConfig } from './config/env.js';
import type { SessionPrincipal } from './modules/auth/service.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Pool;
    env: EnvConfig;
  }

  interface FastifyRequest {
    auth: SessionPrincipal | null;
  }
}
