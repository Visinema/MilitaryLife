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

try {
  await probeDatabase(app.db, app.env.DB_HEALTHCHECK_TIMEOUT_MS);
  await ensureCoreSchemaReady(app.db, env.DATABASE_URL, app.log);

  await app.listen({
    host: app.env.API_HOST,
    port: app.env.API_PORT
  });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
