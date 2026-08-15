/** Public front server for the chart exporter and pptx rasterizer. */

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { StatusCode } from 'hono/utils/http-status';
import type { PptxRasterizer } from '@json-to-office/shared';
import { registerRasterizeRoute } from './server/rasterize-route.js';
import { rateLimiter } from './server/middleware/hono/rate-limit.js';
import { concurrencyLimiter } from './server/middleware/hono/concurrency-limit.js';
import {
  createApiKeyAuthMiddleware,
  type ApiKeyAuthOptions,
} from './server/middleware/hono/auth.js';
import {
  assertSafeRendererPayload,
  type OutboundSourcePolicy,
  UnsafeOutboundSourceError,
} from './server/security/outbound-source-policy.js';

const DEFAULT_UPSTREAM = 'http://127.0.0.1:7801';
const DEFAULT_PORT = 10_000;
const DEFAULT_PROXY_TIMEOUT_MS = 30_000;
const DEFAULT_HEALTH_TIMEOUT_MS = 2_000;
const DEFAULT_EXPORT_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_RASTERIZE_BODY_BYTES = 32 * 1024 * 1024;
const DEFAULT_RESPONSE_BYTES = 24 * 1024 * 1024;
const MAX_CHART_DIMENSION = 4_096;
const MAX_CHART_PIXELS = 16_000_000;

type FetchImplementation = typeof fetch;

export interface RenderServerOptions {
  upstreamUrl?: string;
  proxyTimeoutMs?: number;
  healthTimeoutMs?: number;
  maxExportBodyBytes?: number;
  maxRasterizeBodyBytes?: number;
  maxResponseBytes?: number;
  maxConcurrent?: number;
  exportRateLimit?: number;
  rasterizeRateLimit?: number;
  rateLimitWindowMs?: number;
  trustProxyHeaders?: boolean;
  auth?: ApiKeyAuthOptions;
  sourcePolicy?: OutboundSourcePolicy;
  fetch?: FetchImplementation;
  getRasterizer?: () => PptxRasterizer;
}

class UpstreamResponseTooLargeError extends Error {}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function envAuthOptions(): ApiKeyAuthOptions {
  const production = process.env.NODE_ENV === 'production';
  const requestedMode = process.env.RENDER_AUTH_MODE;
  const mode =
    requestedMode === 'auto' ||
    requestedMode === 'required' ||
    requestedMode === 'disabled'
      ? requestedMode
      : production
        ? 'required'
        : 'auto';
  return {
    mode,
    apiKey: process.env.RENDER_API_KEY || process.env.API_KEY,
    headerName: process.env.RENDER_API_KEY_HEADER || 'x-api-key',
  };
}

function envSourcePolicy(): OutboundSourcePolicy {
  const requestedMode = process.env.OUTBOUND_SOURCE_MODE;
  const mode =
    requestedMode === 'safe' || requestedMode === 'development'
      ? requestedMode
      : process.env.NODE_ENV === 'production'
        ? 'safe'
        : 'development';
  return {
    mode,
    allowedHosts: (process.env.OUTBOUND_HOST_ALLOWLIST || '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateExportRequest(
  value: unknown
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) {
    throw new HTTPException(400, { message: 'Export body must be an object' });
  }
  const allowedKeys = new Set(['infile', 'type', 'b64', 'scale', 'resources']);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) {
    throw new HTTPException(400, {
      message: `Unsupported export field: ${unknown[0]}`,
    });
  }
  if (!isRecord(value.infile)) {
    throw new HTTPException(400, {
      message: 'Export infile must be a chart options object',
    });
  }
  if (value.type !== 'png' || value.b64 !== true) {
    throw new HTTPException(400, {
      message: 'Only base64 PNG exports are allowed',
    });
  }

  const scale = value.scale === undefined ? 1 : value.scale;
  if (
    typeof scale !== 'number' ||
    !Number.isFinite(scale) ||
    scale <= 0 ||
    scale > 4
  ) {
    throw new HTTPException(400, { message: 'scale must be between 0 and 4' });
  }

  const chart = isRecord(value.infile.chart) ? value.infile.chart : undefined;
  const width = chart?.width === undefined ? 600 : chart.width;
  const height = chart?.height === undefined ? 400 : chart.height;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > MAX_CHART_DIMENSION ||
    height > MAX_CHART_DIMENSION ||
    width * height * scale * scale > MAX_CHART_PIXELS
  ) {
    throw new HTTPException(400, {
      message: 'Requested chart dimensions are too large',
    });
  }
}

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

async function readLimitedBody(
  response: Response,
  maxBytes: number
): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel();
    throw new UpstreamResponseTooLargeError();
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UpstreamResponseTooLargeError();
    }
    chunks.push(value);
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function createRenderServerApp(options: RenderServerOptions = {}): Hono {
  const production = process.env.NODE_ENV === 'production';
  const upstream = (
    options.upstreamUrl ||
    process.env.HIGHCHARTS_UPSTREAM_URL ||
    DEFAULT_UPSTREAM
  ).replace(/\/$/, '');
  const proxyTimeoutMs =
    options.proxyTimeoutMs ??
    positiveInteger(process.env.PROXY_TIMEOUT_MS, DEFAULT_PROXY_TIMEOUT_MS);
  const healthTimeoutMs =
    options.healthTimeoutMs ??
    positiveInteger(process.env.HEALTH_TIMEOUT_MS, DEFAULT_HEALTH_TIMEOUT_MS);
  const maxExportBodyBytes =
    options.maxExportBodyBytes ??
    positiveInteger(
      process.env.MAX_EXPORT_BODY_SIZE,
      DEFAULT_EXPORT_BODY_BYTES
    );
  const maxRasterizeBodyBytes =
    options.maxRasterizeBodyBytes ??
    positiveInteger(
      process.env.MAX_RASTERIZE_BODY_SIZE,
      DEFAULT_RASTERIZE_BODY_BYTES
    );
  const maxResponseBytes =
    options.maxResponseBytes ??
    positiveInteger(
      process.env.MAX_RENDER_RESPONSE_SIZE,
      DEFAULT_RESPONSE_BYTES
    );
  const maxConcurrent =
    options.maxConcurrent ??
    positiveInteger(process.env.MAX_CONCURRENT_RENDERS, production ? 4 : 16);
  const windowMs =
    options.rateLimitWindowMs ??
    positiveInteger(process.env.RENDER_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);
  const fetchImpl = options.fetch ?? fetch;
  const sourcePolicy = options.sourcePolicy ?? envSourcePolicy();
  const trustProxyHeaders =
    options.trustProxyHeaders ?? process.env.TRUST_PROXY_HEADERS === 'true';

  const app = new Hono();
  const auth = createApiKeyAuthMiddleware(options.auth ?? envAuthOptions());
  const capacity = concurrencyLimiter({ limit: maxConcurrent });

  app.use('*', secureHeaders());

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ success: false, error: error.message }, error.status);
    }
    return c.json({ success: false, error: 'Internal server error' }, 500);
  });

  app.get('/health', async (c) => {
    try {
      const response = await fetchImpl(`${upstream}/health`, {
        signal: AbortSignal.timeout(healthTimeoutMs),
      });
      if (response.ok) return c.text('ok');
      return c.json({ status: 'degraded', upstream: response.status }, 503);
    } catch {
      return c.json({ status: 'degraded', upstream: 'unreachable' }, 503);
    }
  });

  registerRasterizeRoute(app, {
    getRasterizer: options.getRasterizer,
    preMiddleware: [
      auth,
      rateLimiter({
        limit:
          options.rasterizeRateLimit ??
          positiveInteger(
            process.env.RASTERIZE_RATE_LIMIT,
            production ? 30 : 1000
          ),
        window: windowMs,
        namespace: 'rasterize',
        trustProxy: trustProxyHeaders,
      }),
      capacity,
      bodyLimit({
        maxSize: maxRasterizeBodyBytes,
        onError: () => {
          throw new HTTPException(413, { message: 'Request body too large' });
        },
      }),
    ],
    sourcePolicy,
  });

  app.post(
    '/export',
    auth,
    rateLimiter({
      limit:
        options.exportRateLimit ??
        positiveInteger(process.env.EXPORT_RATE_LIMIT, production ? 60 : 1000),
      window: windowMs,
      namespace: 'export',
      trustProxy: trustProxyHeaders,
    }),
    capacity,
    bodyLimit({
      maxSize: maxExportBodyBytes,
      onError: () => {
        throw new HTTPException(413, { message: 'Request body too large' });
      },
    }),
    async (c) => {
      const contentType = c.req.header('content-type');
      if (!contentType?.toLowerCase().includes('application/json')) {
        throw new HTTPException(415, {
          message: 'Content-Type must be application/json',
        });
      }

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        throw new HTTPException(400, { message: 'Invalid JSON body' });
      }
      validateExportRequest(body);
      try {
        assertSafeRendererPayload(body, sourcePolicy);
      } catch (error) {
        if (error instanceof UnsafeOutboundSourceError) {
          throw new HTTPException(400, { message: error.message });
        }
        throw error;
      }

      let response: Response;
      try {
        response = await fetchImpl(`${upstream}/export`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/plain, image/png, application/json',
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(proxyTimeoutMs),
        });
      } catch (error) {
        return isTimeout(error)
          ? c.json(
              {
                error: `Highcharts upstream timed out after ${proxyTimeoutMs}ms`,
              },
              504
            )
          : c.json({ error: 'Highcharts upstream unreachable' }, 502);
      }

      let payload: Uint8Array;
      try {
        payload = await readLimitedBody(response, maxResponseBytes);
      } catch (error) {
        if (error instanceof UpstreamResponseTooLargeError) {
          return c.json({ error: 'Highcharts response too large' }, 502);
        }
        if (isTimeout(error)) {
          return c.json(
            {
              error: `Highcharts upstream timed out after ${proxyTimeoutMs}ms`,
            },
            504
          );
        }
        return c.json({ error: 'Failed to read Highcharts response' }, 502);
      }

      const headers: Record<string, string> = {};
      for (const name of [
        'content-type',
        'content-disposition',
        'cache-control',
      ]) {
        const value = response.headers.get(name);
        if (value) headers[name] = value;
      }
      return c.body(payload, response.status as StatusCode, headers);
    }
  );

  for (const route of ['/export', '/rasterize']) {
    app.all(route, (c) => {
      c.header('Allow', 'POST');
      return c.json({ success: false, error: 'Method not allowed' }, 405);
    });
  }
  app.notFound((c) => c.json({ success: false, error: 'Not found' }, 404));

  return app;
}

function isMainModule(): boolean {
  if (!process.argv[1]) return false;
  try {
    return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const port = positiveInteger(process.env.PORT, DEFAULT_PORT);
  const app = createRenderServerApp();
  void import('@hono/node-server').then(({ serve }) => {
    serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, (info) => {
      // eslint-disable-next-line no-console
      console.log(`[jto-render-server] listening on :${info.port}`);
    });
  });
}
