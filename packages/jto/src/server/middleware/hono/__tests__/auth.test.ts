import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createApiKeyAuthMiddleware } from '../auth';

function appWithAuth(
  options: Parameters<typeof createApiKeyAuthMiddleware>[0]
) {
  const app = new Hono();
  app.use('*', createApiKeyAuthMiddleware(options));
  app.get('/private', (c) => c.json({ ok: true }));
  return app;
}

describe('API key authentication', () => {
  it('fails closed when required auth has no configured key', async () => {
    const response = await appWithAuth({ mode: 'required' }).request(
      '/private'
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'AUTH_CONFIGURATION_ERROR',
    });
  });

  it('keeps zero-config local auto mode available', async () => {
    const response = await appWithAuth({ mode: 'auto' }).request('/private');
    expect(response.status).toBe(200);
  });

  it('accepts the configured header and rejects a wrong key', async () => {
    const app = appWithAuth({
      mode: 'required',
      apiKey: 'correct-secret',
      headerName: 'x-render-key',
    });
    const rejected = await app.request('/private', {
      headers: { 'x-render-key': 'wrong-secret' },
    });
    expect(rejected.status).toBe(401);

    const accepted = await app.request('/private', {
      headers: { 'x-render-key': 'correct-secret' },
    });
    expect(accepted.status).toBe(200);
  });

  it('supports a bearer credential and lets preflight through', async () => {
    const app = appWithAuth({
      mode: 'required',
      apiKey: 'secret',
    });
    expect(
      (
        await app.request('/private', {
          headers: { Authorization: 'Bearer secret' },
        })
      ).status
    ).toBe(200);
    expect(
      (await app.request('/private', { method: 'OPTIONS' })).status
    ).not.toBe(401);
  });
});
