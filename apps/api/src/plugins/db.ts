import type { FastifyInstance } from 'fastify';
import { Pool, types } from 'pg';

function shouldUseSsl(connectionString: string, mode: 'auto' | 'disable' | 'require'): boolean {
  if (mode === 'disable') return false;
  if (mode === 'require') return true;

  try {
    const parsed = new URL(connectionString);
    const sslMode = parsed.searchParams.get('sslmode')?.toLowerCase();

    if (sslMode === 'disable') return false;
    if (sslMode && sslMode !== 'disable') return true;

    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return false;
    }

    if (host.endsWith('.railway.internal')) {
      return false;
    }

    return true;
  } catch {
    return !connectionString.includes('localhost');
  }
}

export async function dbPlugin(app: FastifyInstance): Promise<void> {
  // Parse int8 as number for game clock and money math.
  types.setTypeParser(20, (value: string) => Number(value));

  const useSsl = shouldUseSsl(app.env.DATABASE_URL, app.env.DB_SSL_MODE);

  const pool = new Pool({
    connectionString: app.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
    allowExitOnIdle: false,
    ssl: useSsl ? { rejectUnauthorized: false } : undefined
  });

  app.decorate('db', pool);

  app.addHook('onClose', async () => {
    await pool.end();
  });
}
