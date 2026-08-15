import { describe, expect, it, vi } from 'vitest';
import { createRenderServerApp } from '../render-server';

const exportBody = {
  infile: { chart: { width: 800, height: 600 } },
  type: 'png',
  b64: true,
};

function post(
  app: ReturnType<typeof createRenderServerApp>,
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  const encoded = JSON.stringify(body);
  return app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(encoded)),
      ...headers,
    },
    body: encoded,
  });
}

describe('standalone render server', () => {
  it('keeps health public while protected routes require authentication', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    const app = createRenderServerApp({
      fetch: fetchMock as typeof fetch,
      auth: { mode: 'required', apiKey: 'secret' },
      sourcePolicy: { mode: 'safe', allowedHosts: [] },
    });

    expect((await app.request('/health')).status).toBe(200);
    const unauthorized = await post(app, '/export', exportBody);
    expect(unauthorized.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails closed when production-style required auth is misconfigured', async () => {
    const fetchMock = vi.fn();
    const app = createRenderServerApp({
      fetch: fetchMock as typeof fetch,
      auth: { mode: 'required' },
      sourcePolicy: { mode: 'safe', allowedHosts: [] },
    });
    expect((await post(app, '/export', exportBody)).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('proxies only the strict base64 PNG protocol and strips credentials', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('aW1hZ2U=', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Set-Cookie': 'upstream=secret',
          },
        })
    );
    const app = createRenderServerApp({
      fetch: fetchMock as typeof fetch,
      auth: { mode: 'required', apiKey: 'secret' },
      sourcePolicy: { mode: 'safe', allowedHosts: [] },
    });
    const response = await post(app, '/export', exportBody, {
      'x-api-key': 'secret',
      Cookie: 'session=secret',
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('aW1hZ2U=');
    const [, init] = (
      fetchMock.mock.calls as unknown as [RequestInfo | URL, RequestInit][]
    )[0];
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'text/plain, image/png, application/json',
    });
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it('rejects unknown routes, methods, fields, and oversized chart work', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    const app = createRenderServerApp({
      fetch: fetchMock as typeof fetch,
      auth: { mode: 'disabled' },
      sourcePolicy: { mode: 'safe', allowedHosts: [] },
    });
    expect((await app.request('/admin')).status).toBe(404);
    expect((await app.request('/export')).status).toBe(405);
    expect(
      (
        await post(app, '/export', {
          ...exportBody,
          callback: 'process.exit()',
        })
      ).status
    ).toBe(400);
    expect(
      (
        await post(app, '/export', {
          ...exportBody,
          infile: { chart: { width: 10_000, height: 10_000 } },
        })
      ).status
    ).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('caps dimensions declared under infile.exporting, not just infile.chart', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    const app = createRenderServerApp({
      fetch: fetchMock as typeof fetch,
      auth: { mode: 'disabled' },
      sourcePolicy: { mode: 'safe', allowedHosts: [] },
    });

    // Highcharts ranks exporting.sourceWidth/sourceHeight above chart.*, so
    // these would previously validate against the 600x400 defaults.
    for (const infile of [
      { exporting: { sourceWidth: 20_000, sourceHeight: 20_000 } },
      { chart: { width: 100, height: 100 }, exporting: { sourceWidth: 9_000 } },
      { chart: { width: 4_000, height: 4_000 }, exporting: { scale: 4 } },
      { exporting: { scale: 99 } },
    ]) {
      expect(
        (await post(app, '/export', { ...exportBody, infile })).status
      ).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();

    // A nested block within budget still proxies.
    expect(
      (
        await post(app, '/export', {
          ...exportBody,
          infile: {
            exporting: { sourceWidth: 800, sourceHeight: 600, scale: 2 },
          },
        })
      ).status
    ).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('enforces request, response, and per-route rate limits', async () => {
    const fetchMock = vi.fn(async () => new Response('x'.repeat(32)));
    const requestLimited = createRenderServerApp({
      fetch: fetchMock as typeof fetch,
      auth: { mode: 'disabled' },
      sourcePolicy: { mode: 'safe', allowedHosts: [] },
      maxExportBodyBytes: 32,
    });
    expect((await post(requestLimited, '/export', exportBody)).status).toBe(
      413
    );

    const responseLimited = createRenderServerApp({
      fetch: fetchMock as typeof fetch,
      auth: { mode: 'disabled' },
      sourcePolicy: { mode: 'safe', allowedHosts: [] },
      maxResponseBytes: 8,
      exportRateLimit: 1,
    });
    expect((await post(responseLimited, '/export', exportBody)).status).toBe(
      502
    );
    expect((await post(responseLimited, '/export', exportBody)).status).toBe(
      429
    );
  });

  it('rejects renderer SSRF inputs before contacting the upstream', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    const app = createRenderServerApp({
      fetch: fetchMock as typeof fetch,
      auth: { mode: 'disabled' },
      sourcePolicy: { mode: 'safe', allowedHosts: [] },
    });
    const response = await post(app, '/export', {
      ...exportBody,
      infile: {
        ...exportBody.infile,
        series: [{ marker: { symbol: 'url(http://127.0.0.1/secret)' } }],
      },
    });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('protects rasterize with the same auth and source policy', async () => {
    const rasterizer = vi.fn(async () => ({
      base64DataUri: 'data:image/png;base64,AA==',
      width: 1,
      height: 1,
    }));
    const app = createRenderServerApp({
      auth: { mode: 'required', apiKey: 'secret' },
      sourcePolicy: { mode: 'safe', allowedHosts: [] },
      getRasterizer: () => rasterizer,
    });
    const body = {
      presentation: {
        name: 'pptx',
        children: [{ name: 'image', props: { path: '/etc/passwd' } }],
      },
    };
    expect((await post(app, '/rasterize', body)).status).toBe(401);
    expect(
      (
        await post(app, '/rasterize', body, {
          'x-api-key': 'secret',
        })
      ).status
    ).toBe(400);
    expect(rasterizer).not.toHaveBeenCalled();
  });
});
