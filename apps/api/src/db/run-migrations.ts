import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function resolveMigrationsDir(): Promise<string> {
  const candidates = [
    join(__dirname, 'migrations'),
    join(__dirname, '../migrations'),
    join(__dirname, '../../src/db/migrations'),
    join(process.cwd(), 'apps/api/src/db/migrations'),
    join(process.cwd(), 'apps/api/dist/db/migrations'),
    join(process.cwd(), 'src/db/migrations')
  ];

  for (const dir of candidates) {
    try {
      await access(dir);
      const files = await readdir(dir);
      if (files.some((name) => name.endsWith('.sql'))) {
        return dir;
      }
    } catch {
      // Try next candidate.
    }
  }

  throw new Error(`Migration directory not found. Tried: ${candidates.join(', ')}`);
}

export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({
    connectionString,
    max: 1
  });

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(941407290101)');

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const migrationsDir = await resolveMigrationsDir();
    // eslint-disable-next-line no-console
    console.info(`[migrations] using directory: ${migrationsDir}`);
    const files = (await readdir(migrationsDir))
      .filter((name) => name.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b));

    const applied: string[] = [];
    const skipped: string[] = [];

    for (const filename of files) {
      const already = await client.query<{ filename: string }>(
        'SELECT filename FROM schema_migrations WHERE filename = $1',
        [filename]
      );

      if ((already.rowCount ?? 0) > 0) {
        skipped.push(filename);
        continue;
      }

      const sql = await readFile(join(migrationsDir, filename), 'utf8');
      await client.query('BEGIN');
      try {
        // eslint-disable-next-line no-console
        console.info(`[migrations] applying ${filename}`);
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        applied.push(filename);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration failed for ${filename}: ${(error as Error).message}`);
      }
    }

    // eslint-disable-next-line no-console
    console.info(
      `[migrations] done. applied=${applied.length} skipped=${skipped.length} total=${files.length}`
    );
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(941407290101)');
    } catch {
      // Ignore unlock errors on shutdown.
    }
    client.release();
    await pool.end();
  }
}
