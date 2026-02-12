import type { FastifyInstance } from 'fastify';
import { Pool, types } from 'pg';

export async function dbPlugin(app: FastifyInstance): Promise<void> {
  // Parse int8 as number for game clock and money math.
  types.setTypeParser(20, (value: string) => Number(value));

  const pool = new Pool({
    connectionString: app.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: false
  });

  app.decorate('db', pool);

  app.addHook('onClose', async () => {
    await pool.end();
  });
}
