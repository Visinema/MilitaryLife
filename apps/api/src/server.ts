import { buildApp } from './app.js';
import { env } from './config/env.js';
import { ensureCoreSchemaReady } from './db/ensure-schema.js';
import { runMigrations } from './db/run-migrations.js';
import { probeDatabase } from './utils/db.js';

if (env.AUTO_MIGRATE_ON_BOOT) {
  try {
    await runMigrations(env.DATABASE_URL);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Auto migration failed on boot.', error);
    if (env.AUTO_MIGRATE_STRICT) {
      process.exit(1);
    }
  }
}

const app = await buildApp();

async function ensureDatabaseReady(): Promise<void> {
  await probeDatabase(app.db, app.env.DB_HEALTHCHECK_TIMEOUT_MS);
  await ensureCoreSchemaReady(app.db, env.DATABASE_URL, app.log);
}

async function retryDatabaseReadyInBackground(): Promise<void> {
  const retryMs = 10_000;

  while (true) {
    try {
      await ensureDatabaseReady();
      app.log.info('database-ready-after-startup-retry');
      return;
    } catch (error) {
      app.log.warn({ err: error, retryMs }, 'database-not-ready-retrying');
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
}

try {
  await ensureDatabaseReady();

  await app.listen({
    host: app.env.API_HOST,
    port: app.env.API_PORT
  });
} catch (err) {
  app.log.error(err);
  if (env.STARTUP_DB_CHECK_STRICT) {
    process.exit(1);
  }

  await app.listen({
    host: app.env.API_HOST,
    port: app.env.API_PORT
  });

  void retryDatabaseReadyInBackground();
}
