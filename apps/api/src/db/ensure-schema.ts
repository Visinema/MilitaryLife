import type { Pool, PoolClient } from 'pg';
import { runMigrations } from './run-migrations.js';

type Queryable = Pick<Pool, 'query'> | Pick<PoolClient, 'query'>;
type LoggerLike = {
  info: (payload: unknown, message?: string) => void;
  warn: (payload: unknown, message?: string) => void;
};

const CORE_TABLES = ['users', 'profiles', 'sessions', 'events', 'game_states', 'decision_logs'] as const;

async function getMissingCoreTables(db: Queryable): Promise<string[]> {
  const result = await db.query<{ table_name: string; regclass: string | null }>(
    `
      SELECT t.table_name, to_regclass('public.' || t.table_name) AS regclass
      FROM unnest($1::text[]) AS t(table_name)
    `,
    [CORE_TABLES]
  );

  return result.rows.filter((row) => row.regclass === null).map((row) => row.table_name);
}

export async function ensureCoreSchemaReady(
  db: Queryable,
  connectionString: string,
  logger: LoggerLike
): Promise<void> {
  const missingBefore = await getMissingCoreTables(db);
  if (missingBefore.length === 0) {
    return;
  }

  logger.warn({ missingTables: missingBefore }, 'core-schema-missing-running-migrations');
  await runMigrations(connectionString);

  const missingAfter = await getMissingCoreTables(db);
  if (missingAfter.length > 0) {
    throw new Error(`Database schema incomplete after migrations. Missing tables: ${missingAfter.join(', ')}`);
  }

  logger.info({ repairedTables: missingBefore }, 'core-schema-ready-after-migration');
}
