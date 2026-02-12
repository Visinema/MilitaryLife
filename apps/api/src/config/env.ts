import { config } from 'dotenv';
import { z } from 'zod';

config();

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
  CORS_ORIGIN: z.string().default('http://localhost:3000')
});

export type EnvConfig = Omit<z.infer<typeof envSchema>, 'API_PORT'> & { API_PORT: number };

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const resolvedPort = parsed.data.PORT ?? parsed.data.API_PORT ?? 4000;

export const env: EnvConfig = {
  ...parsed.data,
  API_PORT: resolvedPort
};
