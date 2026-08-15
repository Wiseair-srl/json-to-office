import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { rateLimiter } from '../rate-limit';

describe('rateLimiter', () => {
  it('does not trust spoofable forwarding headers by default', async () => {
    const app = new Hono();
    app.use('*', rateLimiter({ limit: 1, window: 60_000 }));
    app.get('/work', (c) => c.text('ok'));

    expect(
      (await app.request('/work', { headers: { 'X-Real-IP': '1.1.1.1' } }))
        .status
    ).toBe(200);
    expect(
      (await app.request('/work', { headers: { 'X-Real-IP': '2.2.2.2' } }))
        .status
    ).toBe(429);
  });

  it('uses the first forwarded address only when explicitly trusted', async () => {
    const app = new Hono();
    app.use('*', rateLimiter({ limit: 1, window: 60_000, trustProxy: true }));
    app.get('/work', (c) => c.text('ok'));

    expect(
      (
        await app.request('/work', {
          headers: { 'X-Forwarded-For': '1.1.1.1, 10.0.0.1' },
        })
      ).status
    ).toBe(200);
    expect(
      (
        await app.request('/work', {
          headers: { 'X-Forwarded-For': '2.2.2.2, 10.0.0.1' },
        })
      ).status
    ).toBe(200);
  });
});
