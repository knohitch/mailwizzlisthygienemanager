import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().min(1).optional(),
  APP_BASE_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_EMAIL: z.string().email().default('admin@example.com'),
  ADMIN_PASSWORD: z.string().optional(),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  APP_SESSION_SECRET: z.string().min(32).optional(),
  APP_ENCRYPTION_KEY: z.string().min(32).optional(),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ENABLE_MAILWIZZ_MUTATIONS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  ALLOW_INSECURE_MAILWIZZ_HTTP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  MAILWIZZ_API_URL: z.string().optional(),
  MAILWIZZ_API_KEY: z.string().optional(),
  MAILWIZZ_REPORTING_DB_URL: z.string().optional(),
  MAILWIZZ_REPORTING_DB_PREFIX: z.string().default('mw_'),
  MAILWIZZ_WEBHOOK_SECRET: z.string().optional(),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(500).max(60000).default(3000),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(5).default(1),
  ALLOWED_ADMIN_IPS: z.string().optional(),
  ALLOWED_ADMIN_CIDRS: z.string().optional(),
  BACKUP_DIR: z.string().optional(),
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) return cachedEnv;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

export function resetEnvCacheForTests(): void {
  cachedEnv = null;
}
