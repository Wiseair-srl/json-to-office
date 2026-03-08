import dotenv from 'dotenv';

dotenv.config();

function parseEnv(env: NodeJS.ProcessEnv) {
  return {
    NODE_ENV: (env.NODE_ENV || 'development') as 'development' | 'production' | 'test',
    PORT: parseInt(env.PORT || '3003', 10),
    CORS_ORIGIN: env.CORS_ORIGIN || '*',
    API_KEY: env.API_KEY,
    API_KEY_HEADER: env.API_KEY_HEADER || 'x-api-key',
    RATE_LIMIT_WINDOW_MS: parseInt(env.RATE_LIMIT_WINDOW_MS || '900000', 10),
    RATE_LIMIT_MAX: parseInt(env.RATE_LIMIT_MAX || '100', 10),
    MAX_FILE_SIZE: parseInt(env.MAX_FILE_SIZE || '10485760', 10),
    UPLOAD_DIR: env.UPLOAD_DIR || 'uploads',
    LIBREOFFICE_PATH: env.LIBREOFFICE_PATH,
    LIBREOFFICE_TIMEOUT_MS: env.LIBREOFFICE_TIMEOUT_MS
      ? parseInt(env.LIBREOFFICE_TIMEOUT_MS, 10)
      : 30000,
    LOG_LEVEL: (env.LOG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'debug',
    CACHE_ENABLED: env.CACHE_ENABLED !== 'false',
    CACHE_MAX_SIZE_MB: parseInt(env.CACHE_MAX_SIZE_MB || '100', 10),
    CACHE_TTL_SECONDS: parseInt(env.CACHE_TTL_SECONDS || '3600', 10),
    CACHE_MAX_ITEMS: parseInt(env.CACHE_MAX_ITEMS || '1000', 10),
  };
}

const parsedEnv = parseEnv(process.env);

export const config = {
  ...parsedEnv,

  isDevelopment: parsedEnv.NODE_ENV === 'development',
  isProduction: parsedEnv.NODE_ENV === 'production',
  isTest: parsedEnv.NODE_ENV === 'test',

  features: {
    apiKey: Boolean(parsedEnv.API_KEY),
    cache: parsedEnv.CACHE_ENABLED,
  },

  cors: {
    origin:
      parsedEnv.CORS_ORIGIN === '*'
        ? parsedEnv.CORS_ORIGIN
        : parsedEnv.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
  },

  rateLimit: {
    windowMs: parsedEnv.RATE_LIMIT_WINDOW_MS,
    max: parsedEnv.RATE_LIMIT_MAX,
  },

  cache: {
    enabled: parsedEnv.CACHE_ENABLED,
    maxSizeMB: parsedEnv.CACHE_MAX_SIZE_MB,
    ttlSeconds: parsedEnv.CACHE_TTL_SECONDS,
    maxItems: parsedEnv.CACHE_MAX_ITEMS,
  },
} as const;

export type ServerConfig = typeof config;
