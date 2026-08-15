import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { concurrencyLimiter } from '../concurrency-limit';

describe('concurrencyLimiter', () => {
  it('rejects excess work and releases the slot afterwards', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const app = new Hono();
    app.use('*', concurrencyLimiter({ limit: 1 }));
    app.get('/work', async (c) => {
      await blocked;
      return c.text('ok');
    });

    const first = app.request('/work');
    await Promise.resolve();
    const rejected = await app.request('/work');
    expect(rejected.status).toBe(503);
    expect(rejected.headers.get('Retry-After')).toBe('1');

    release();
    expect((await first).status).toBe(200);
  });
});
