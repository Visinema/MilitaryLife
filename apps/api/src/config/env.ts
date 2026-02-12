import { config } from 'dotenv';
import { z } from 'zod';

config();

type RawEnv = Record<string, string | undefined>;

function cleanValue(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isRailwayRuntime(raw: RawEnv): boolean {
  return Boolean(
    cleanValue(raw.RAILWAY_PROJECT_ID) ||
      cleanValue(raw.RAILWAY_SERVICE_ID) ||
      cleanValue(raw.RAILWAY_ENVIRONMENT_ID)
  );
}

function parseHostFromConnectionString(connectionString: string): string | null {
  try {
    const parsed = new URL(connectionString);
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isLoopbackConnectionString(connectionString: string): boolean {
  const host = parseHostFromConnectionString(connectionString);
  return host ? isLoopbackHost(host) : false;
}

function buildDatabaseUrlFromPgParts(raw: RawEnv): string | undefined {
  const host = cleanValue(raw.PGHOST);
  const port = cleanValue(raw.PGPORT);
  const database = cleanValue(raw.PGDATABASE);
  const user = cleanValue(raw.PGUSER);
  const password = cleanValue(raw.PGPASSWORD);

  if (!host || !port || !database || !user || !password) {
    return undefined;
  }

  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
}

function resolveDatabaseUrl(raw: RawEnv): string | undefined {
  const candidates = [
    cleanValue(raw.DATABASE_URL),
    cleanValue(raw.DATABASE_PRIVATE_URL),
    cleanValue(raw.DATABASE_PUBLIC_URL),
    cleanValue(raw.POSTGRES_URL),
    cleanValue(raw.POSTGRESQL_URL),
    cleanValue(raw.PG_URL),
    buildDatabaseUrlFromPgParts(raw)
  ].filter((value): value is string => Boolean(value));

  if (candidates.length === 0) {
    return undefined;
  }

  if (isRailwayRuntime(raw)) {
    const nonLoopback = candidates.find((value) => !isLoopbackConnectionString(value));
    if (nonLoopback) {
      return nonLoopback;
    }
  }

  return candidates[0];
}

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().optional(),
  API_HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16),
  COOKIE_SECRET: z.string().min(16),
  SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  PAUSE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(180).default(30),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  AUTO_MIGRATE_ON_BOOT: booleanFromEnv.default(true),
  AUTO_MIGRATE_STRICT: booleanFromEnv.default(true),
  DB_HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().min(250).max(20_000).default(5000),
  DB_HEALTHCHECK_INTERVAL_MS: z.coerce.number().int().min(500).max(60_000).default(5000)
});

export type EnvConfig = Omit<z.infer<typeof envSchema>, 'API_PORT'> & { API_PORT: number };

const rawEnv = process.env as RawEnv;
const resolvedDatabaseUrl = resolveDatabaseUrl(rawEnv);

const parsed = envSchema.safeParse({
  ...process.env,
  DATABASE_URL: resolvedDatabaseUrl
});

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (isRailwayRuntime(rawEnv) && isLoopbackConnectionString(parsed.data.DATABASE_URL)) {
  // eslint-disable-next-line no-console
  console.error(
    'Invalid DATABASE_URL for Railway runtime. Configure a non-local database URL via DATABASE_PRIVATE_URL or DATABASE_URL.'
  );
  process.exit(1);
}

const resolvedPort = parsed.data.PORT ?? parsed.data.API_PORT ?? 4000;

export const env: EnvConfig = {
  ...parsed.data,
  API_PORT: resolvedPort
};
