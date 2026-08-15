import type { MiddlewareHandler } from 'hono';

export interface ConcurrencyLimitOptions {
  limit: number;
  retryAfterSeconds?: number;
}

/**
 * Process-local admission control for expensive generation/rendering work.
 * It rejects excess work instead of queueing unbounded request bodies in RAM.
 */
export function concurrencyLimiter(
  options: ConcurrencyLimitOptions
): MiddlewareHandler {
  const limit = Math.max(1, Math.floor(options.limit));
  const retryAfterSeconds = options.retryAfterSeconds ?? 1;
  let active = 0;

  return async (c, next) => {
    c.header('X-Concurrency-Limit', String(limit));
    if (active >= limit) {
      c.header('Retry-After', String(retryAfterSeconds));
      return c.json(
        {
          success: false,
          error: 'Server is at capacity',
          code: 'CONCURRENCY_LIMIT_EXCEEDED',
        },
        503
      );
    }

    active += 1;
    c.header('X-Concurrency-Remaining', String(Math.max(0, limit - active)));
    try {
      await next();
    } finally {
      active -= 1;
    }
  };
}
