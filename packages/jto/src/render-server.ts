/**
 * jto-render-server — a single public endpoint that serves both rendering
 * back-ends used by json-to-office documents:
 *
 *   POST /rasterize  → pptx slide → PNG (LibreOffice + poppler, in-process)
 *   everything else  → reverse-proxied to the co-located Highcharts Export
 *                      Server (chart rendering, Chromium)
 *
 * It is the front process of the combined Render image
 * (services/jto-render-server). Highcharts runs internally on :7801; this
 * server owns the public port and adds visual rasterization beside it, so one
 * Render instance backs both `services.highcharts` and `services.pptx`.
 */

import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';
import { createLibreOfficePptxRasterizer } from '@json-to-office/jto-cli';

const UPSTREAM = (
  process.env.HIGHCHARTS_UPSTREAM_URL || 'http://127.0.0.1:7801'
).replace(/\/$/, '');
const PORT = Number(process.env.PORT || 10000);

const rasterize = createLibreOfficePptxRasterizer();
const app = new Hono();

// Liveness — Render's health check hits this. Returns OK as soon as the front
// server is up; the highcharts upstream warms independently.
app.get('/health', (c) => c.text('ok'));

// pptx slide → PNG. Mirrors the contract of POST /api/pptx/rasterize.
app.post('/rasterize', async (c) => {
  let body: { presentation?: unknown; dpi?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  const { presentation, dpi } = body ?? {};
  if (!presentation || typeof presentation !== 'object') {
    return c.json(
      { error: 'presentation (a pptx component definition) is required' },
      400
    );
  }
  try {
    const result = await rasterize({
      presentation,
      dpi: typeof dpi === 'number' ? dpi : 200,
    });
    return c.json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const status = /not found|rasterization needs/i.test(msg) ? 503 : 500;
    return c.json({ error: msg }, status);
  }
});

// Everything else → the Highcharts Export Server (chart `/export`, etc.).
app.all('*', async (c) => {
  const url = new URL(c.req.url);
  const target = `${UPSTREAM}${url.pathname}${url.search}`;
  const reqHeaders = new Headers(c.req.raw.headers);
  reqHeaders.delete('host');
  reqHeaders.delete('connection');
  reqHeaders.delete('content-length');

  const init: RequestInit = { method: c.req.method, headers: reqHeaders };
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = await c.req.arrayBuffer();
  }

  let res: Response;
  try {
    res = await fetch(target, init);
  } catch {
    return c.json(
      { error: `Highcharts upstream unreachable at ${UPSTREAM}` },
      502
    );
  }
  // Buffer the upstream response (chart PNGs are small) so we hand the node
  // adapter a concrete body. Drop content-encoding/length — fetch already
  // decoded the body. Return via the Hono context so the node-server adapter
  // sees its internal response state (a hand-built Response logs a warning).
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
