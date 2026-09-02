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

/**
 * May this server load the plugins it finds on its own disk?
 *
 * Loading a plugin means importing and running code the server found by
 * walking the filesystem, so it is the operator's call, made once at boot for
 * the image's own filesystem. Production refuses by default; the hosted
 * playgrounds set `PLUGIN_AUTOLOAD=true`, without which a disk plugin was
 * listed in the rail, switchable, and then absent from every schema and
 * build — `weather` completed locally and came back "Unknown component" on
 * the deployment. Development says yes, as it always has.
 *
 * This governs the startup preload, and it is what the rail reads to decide
 * whether a disk plugin gets a live switch. Whether a *request* may provoke
 * the same work is the narrower question `requestTriggeredPluginLoadAllowed`
 * answers.
 *
 * Read live rather than off the frozen `config` below: both gates are
 * exercised by tests that flip `NODE_ENV` after this module is imported.
 */
export function pluginAutoloadEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const explicit = env.PLUGIN_AUTOLOAD?.trim();
  if (explicit) return explicit === 'true' || explicit === '1';
  return normalizeNodeEnv(env.NODE_ENV || 'development') !== 'production';
}

/**
 * May an incoming request make the server walk its disk and import what it
 * finds there?
 *
 * Only where that disk is the developer's own. A hardened deployment loads
 * its plugins once, at boot, from an image its operator built, and nothing a
 * caller sends should be able to start that scan again — so both request-time
 * paths, on-demand schema generation and a keyless
 * `POST /discovery/load-plugins`, stop here. `PLUGIN_AUTOLOAD` does not open
 * them: it authorizes the preload, not the caller, and a deployment that
 * opted in has every plugin registered before the first request arrives.
 *
 * Locally the loop is the point: write a plugin, reload the page, use it,
 * without restarting the server.
 */
export function requestTriggeredPluginLoadAllowed(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return (
    pluginAutoloadEnabled(env) &&
    normalizeNodeEnv(env.NODE_ENV || 'development') !== 'production'
  );
}

/**
 * Only the two explicitly local environments keep permissive defaults. Every
 * other value — `staging`, `prod`, a typo — gets production-grade hardening, so
 * a mislabelled deployment cannot silently disable auth, rate limits, or the
 * outbound-source (SSRF) checks.
 */
function normalizeNodeEnv(
  value: string | undefined
): 'development' | 'production' | 'test' {
  return value === 'development' || value === 'test' ? value : 'production';
}

function parseEnv(env: NodeJS.ProcessEnv) {
  const nodeEnv = normalizeNodeEnv(env.NODE_ENV || 'development');
  return {
    NODE_ENV: nodeEnv,
    // No PORT here: the listener is opened by the dev server from the CLI
    // config (`-p` > `server.port` > `PORT` env > format default), so a second
    // copy of it in this module would be silently ignored.
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
