import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url().optional(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('24h'),

  LOCK_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),

  /** Fill the in-memory stores with demo users, teams and work items at startup. */
  SEED_DEMO_DATA: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  /** Directory of the web app to serve; defaults to ../frontend next to the backend. */
  FRONTEND_DIR: z.string().optional(),
});

function loadConfig() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const formatted = result.error.format();
    console.error('❌ Invalid environment variables:', JSON.stringify(formatted, null, 2));
    throw new Error('Invalid environment configuration');
  }

  return Object.freeze(result.data);
}

export type Config = z.infer<typeof envSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

/** Reset config — only for tests */
export function resetConfig(): void {
  _config = null;
}

/**
 * Create a config from partial overrides — useful for tests.
 */
export function createTestConfig(overrides: Partial<Config> = {}): Config {
  const defaults: Config = {
    PORT: 3000,
    HOST: '0.0.0.0',
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: undefined,
    REDIS_HOST: 'localhost',
    REDIS_PORT: 6379,
    REDIS_PASSWORD: '',
    JWT_SECRET: 'test-secret-minimum-16-chars',
    JWT_EXPIRES_IN: '1h',
    LOCK_TIMEOUT_MINUTES: 30,
    SEED_DEMO_DATA: false,
    FRONTEND_DIR: undefined,
  };

  return Object.freeze({ ...defaults, ...overrides });
}
