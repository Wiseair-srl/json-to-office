import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { fontsRouter } from '../fonts';

// Hono's body-limit middleware reads Content-Length; tests must set it.
async function post(
  app: Hono,
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
) {
  const bodyStr = JSON.stringify(body);
  return app.request(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': String(Buffer.byteLength(bodyStr)),
      ...headers,
    },
    body: bodyStr,
  });
}

describe('/api/fonts routes', () => {
  let app: Hono;
  beforeEach(() => {
    app = new Hono();
    app.route('/', fontsRouter);
  });

  describe('/catalog', () => {
    it('returns safe + google arrays', async () => {
      const res = await app.request('/catalog');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { safe: unknown[]; google: unknown[] };
      expect(Array.isArray(body.safe)).toBe(true);
      expect(Array.isArray(body.google)).toBe(true);
    });

    it('emits an ETag header', async () => {
      const res = await app.request('/catalog');
      const etag = res.headers.get('ETag');
      expect(etag).toBeTruthy();
      expect(etag).toMatch(/^"[A-Za-z0-9+/=]+"$/);
    });

    it('returns 304 on If-None-Match with matching ETag', async () => {
      const first = await app.request('/catalog');
      const etag = first.headers.get('ETag')!;
      const second = await app.request('/catalog', {
        headers: { 'If-None-Match': etag },
      });
      expect(second.status).toBe(304);
      // ETag still echoed so caches can update their stored copy.
      expect(second.headers.get('ETag')).toBe(etag);
    });

    it('returns 200 when If-None-Match does not match', async () => {
      const res = await app.request('/catalog', {
        headers: { 'If-None-Match': '"stale-etag"' },
      });
      expect(res.status).toBe(200);
    });
  });

  describe('/materialize validation', () => {
    it('400 when family missing', async () => {
      const res = await post(app, '/materialize', { weights: [400] });
      expect(res.status).toBe(400);
    });

    it('400 when family exceeds 64 chars', async () => {
      const res = await post(app, '/materialize', {
        family: 'A'.repeat(65),
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/64/);
    });

    it('accepts exactly 64-char family (boundary)', async () => {
      const res = await post(app, '/materialize', {
        family: 'A'.repeat(64),
      });
      // May 502 because Google won't resolve 'AAAA...' but the validation
      // step should pass — assert it's NOT 400.
      expect(res.status).not.toBe(400);
    });

    it('413 when body exceeds 16 KB cap', async () => {
      const huge = 'x'.repeat(20 * 1024);
      const res = await post(app, '/materialize', {
        family: 'Inter',
        meta: huge,
      });
      expect(res.status).toBe(413);
    });

    it('400 when JSON body is malformed', async () => {
      const res = await app.request('/materialize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '5',
        },
        body: 'not-json',
      });
      expect(res.status).toBe(400);
    });
  });
});
