/**
 * jto-render-server — a single public endpoint that serves both rendering
 * back-ends used by json-to-office documents:
 *
 *   POST /rasterize  → pptx slide → PNG (LibreOffice + poppler, in-process)
 *   GET  /health     → liveness, reflecting the highcharts upstream's readiness
 *   everything else  → reverse-proxied to the co-located Highcharts Export
 *                      Server (chart rendering, Chromium)
 *
 * It is the front process of the combined Render image
 * (services/jto-render-server). Highcharts runs internally on :7801; this
 * server owns the public port and adds visual rasterization beside it, so one
 * Render instance backs both `services.highcharts` and `services.pptx`.
 *
 * /rasterize shares the validated handler (body-size limit, dpi clamp, rate
 * limit, error mapping) with the in-app route via rasterize-route.ts so the two
 * surfaces can't drift.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { registerRasterizeRoute } from './server/rasterize-route.js';
import { rateLimiter } from './server/middleware/hono/rate-limit.js';

const UPSTREAM = (
  process.env.HIGHCHARTS_UPSTREAM_URL || 'http://127.0.0.1:7801'
).replace(/\/$/, '');
const PORT = Number(process.env.PORT || 10000);
const PROXY_TIMEOUT_MS = Number(process.env.PROXY_TIMEOUT_MS || 30000);
const HEALTH_TIMEOUT_MS = 2000;

const app = new Hono();

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

// Liveness — reflects the highcharts upstream's readiness. The instance backs
// both /rasterize and /export; reporting 503 while highcharts is down/warming
// keeps Render from routing /export traffic to a half-up instance and surfaces
// a crash (the entrypoint restarts highcharts; health recovers when it's back).
app.get('/health', async (c) => {
  try {
    const res = await fetch(`${UPSTREAM}/health`, {
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    });
    if (res.ok) return c.text('ok');
    return c.json({ status: 'degraded', upstream: res.status }, 503);
  } catch {
    return c.json({ status: 'degraded', upstream: 'unreachable' }, 503);
  }
});

// pptx slide → PNG. Shared validated handler (body limit + dpi clamp + rate
// limit) — this is the public-facing surface, so it must be protected.
registerRasterizeRoute(app, {
  preMiddleware: [
    rateLimiter({
      limit: process.env.NODE_ENV === 'production' ? 30 : 1000,
      window: 15 * 60 * 1000,
    }),
  ],
  onError: (error) =>
    // eslint-disable-next-line no-console
    console.error(
      '[jto-render-server] rasterize failed:',
      error instanceof Error ? error.message : error
    ),
});

// Everything else → the Highcharts Export Server (chart `/export`, etc.).
app.all('*', async (c) => {
  const url = new URL(c.req.url);
  const target = `${UPSTREAM}${url.pathname}${url.search}`;
  const reqHeaders = new Headers(c.req.raw.headers);
  reqHeaders.delete('host');
  reqHeaders.delete('connection');
  reqHeaders.delete('content-length');

  const init: RequestInit = {
    method: c.req.method,
    headers: reqHeaders,
    signal: AbortSignal.timeout(PROXY_TIMEOUT_MS),
  };
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = await c.req.arrayBuffer();
  }

  let res: Response;
  try {
    res = await fetch(target, init);
  } catch (error) {
    return isTimeout(error)
      ? c.json(
          {
            error: `Highcharts upstream timed out after ${PROXY_TIMEOUT_MS}ms`,
          },
          504
        )
      : c.json(
          { error: `Highcharts upstream unreachable at ${UPSTREAM}` },
          502
        );
  }

  // Buffer the upstream response (chart PNGs are small) and hand the node
  // adapter a concrete body. Drop content-encoding/length — fetch already
  // decoded the body.
  const payload = await res.arrayBuffer();
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    if (
      key !== 'content-encoding' &&
      key !== 'content-length' &&
      key !== 'transfer-encoding'
    ) {
      headers[key] = value;
    }
  });
  return c.body(payload, res.status as StatusCode, headers);
});

serve({ fetch: app.fetch, port: PORT, hostname: '0.0.0.0' }, (info) => {
  // eslint-disable-next-line no-console
  console.log(
    `[jto-render-server] listening on :${info.port} — POST /rasterize (local), proxy → ${UPSTREAM}`
  );
});
