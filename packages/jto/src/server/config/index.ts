import dotenv from 'dotenv';

dotenv.config();

export type ApiAuthMode = 'auto' | 'required' | 'disabled';
export type OutboundSourceMode = 'development' | 'safe';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseAuthMode(
  value: string | undefined,
  nodeEnv: 'development' | 'production' | 'test'
): ApiAuthMode {
  if (value === 'auto' || value === 'required' || value === 'disabled') {
    return value;
  }
  // Public production APIs must opt out explicitly. Local playgrounds remain
  // zero-config; supplying a key there preserves the historical auto-enable.
  return nodeEnv === 'production' ? 'required' : 'auto';
}

function parseOutboundSourceMode(
  value: string | undefined,
  nodeEnv: 'development' | 'production' | 'test'
): OutboundSourceMode {
  if (value === 'development' || value === 'safe') return value;
  return nodeEnv === 'production' ? 'safe' : 'development';
}

function parseEnv(env: NodeJS.ProcessEnv) {
  const nodeEnv = (env.NODE_ENV || 'development') as
    | 'development'
    | 'production'
    | 'test';
  return {
    NODE_ENV: nodeEnv,
    PORT: positiveInteger(env.PORT, 3003),
    CORS_ORIGIN: env.CORS_ORIGIN || '*',
    API_KEY: env.API_KEY,
    API_KEY_HEADER: env.API_KEY_HEADER || 'x-api-key',
    API_AUTH_MODE: parseAuthMode(env.API_AUTH_MODE, nodeEnv),
    RATE_LIMIT_WINDOW_MS: positiveInteger(env.RATE_LIMIT_WINDOW_MS, 900_000),
    RATE_LIMIT_MAX: positiveInteger(
      env.RATE_LIMIT_MAX,
      nodeEnv === 'production' ? 100 : 1000
    ),
    TRUST_PROXY_HEADERS: env.TRUST_PROXY_HEADERS === 'true',
    MAX_FILE_SIZE: positiveInteger(env.MAX_FILE_SIZE, 10 * 1024 * 1024),
    MAX_REQUEST_BODY_SIZE: positiveInteger(
      env.MAX_REQUEST_BODY_SIZE,
      32 * 1024 * 1024
    ),
    MAX_CONCURRENT_REQUESTS: positiveInteger(
      env.MAX_CONCURRENT_REQUESTS,
      nodeEnv === 'production' ? 8 : 64
    ),
    OUTBOUND_SOURCE_MODE: parseOutboundSourceMode(
      env.OUTBOUND_SOURCE_MODE,
      nodeEnv
    ),
    OUTBOUND_HOST_ALLOWLIST: (env.OUTBOUND_HOST_ALLOWLIST || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
    UPLOAD_DIR: env.UPLOAD_DIR || 'uploads',
    LIBREOFFICE_PATH: env.LIBREOFFICE_PATH,
    LIBREOFFICE_TIMEOUT_MS: env.LIBREOFFICE_TIMEOUT_MS
      ? positiveInteger(env.LIBREOFFICE_TIMEOUT_MS, 30000)
      : 30000,
    LOG_LEVEL: (env.LOG_LEVEL || 'info') as 'error' | 'warn' | 'info' | 'debug',
    CACHE_ENABLED: env.CACHE_ENABLED !== 'false',
    CACHE_MAX_SIZE_MB: positiveInteger(env.CACHE_MAX_SIZE_MB, 100),
    CACHE_TTL_SECONDS: positiveInteger(env.CACHE_TTL_SECONDS, 3600),
    CACHE_MAX_ITEMS: positiveInteger(env.CACHE_MAX_ITEMS, 1000),
  };
}

const parsedEnv = parseEnv(process.env);

export const config = {
  ...parsedEnv,

  isDevelopment: parsedEnv.NODE_ENV === 'development',
  isProduction: parsedEnv.NODE_ENV === 'production',
  isTest: parsedEnv.NODE_ENV === 'test',

  features: {
    apiKey: parsedEnv.API_AUTH_MODE !== 'disabled',
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
    trustProxy: parsedEnv.TRUST_PROXY_HEADERS,
  },

  requestLimits: {
    maxBodySize: parsedEnv.MAX_REQUEST_BODY_SIZE,
    maxConcurrent: parsedEnv.MAX_CONCURRENT_REQUESTS,
    maxFileSize: parsedEnv.MAX_FILE_SIZE,
  },

  outboundSources: {
    mode: parsedEnv.OUTBOUND_SOURCE_MODE,
    allowedHosts: parsedEnv.OUTBOUND_HOST_ALLOWLIST,
  },

  cache: {
    enabled: parsedEnv.CACHE_ENABLED,
    maxSizeMB: parsedEnv.CACHE_MAX_SIZE_MB,
    ttlSeconds: parsedEnv.CACHE_TTL_SECONDS,
    maxItems: parsedEnv.CACHE_MAX_ITEMS,
  },
} as const;

export type ServerConfig = typeof config;
