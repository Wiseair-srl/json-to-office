import { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

interface RateLimitOptions {
  limit: number;
  window: number; // milliseconds
  keyGenerator?: (c: any) => string;
}

// In-memory store for rate limiting (use Redis in production)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

/**
 * Rate limiting middleware for Hono
 */
export const rateLimiter = (options: RateLimitOptions): MiddlewareHandler => {
  const { limit, window, keyGenerator } = options;

  return async (c, next) => {
    const key = keyGenerator
      ? keyGenerator(c)
      : c.req.header('X-Forwarded-For') || 'anonymous';
    const now = Date.now();

    // Clean up expired entries
    for (const [k, v] of rateLimitStore.entries()) {
      if (v.resetTime < now) {
        rateLimitStore.delete(k);
      }
    }

    const record = rateLimitStore.get(key);

    if (!record) {
      // First request
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + window,
      });
    } else if (record.resetTime < now) {
      // Window expired, reset
      record.count = 1;
      record.resetTime = now + window;
    } else if (record.count >= limit) {
      // Rate limit exceeded
      const retryAfter = Math.ceil((record.resetTime - now) / 1000);

      c.header('X-RateLimit-Limit', String(limit));
      c.header('X-RateLimit-Remaining', '0');
      c.header('X-RateLimit-Reset', String(record.resetTime));
      c.header('Retry-After', String(retryAfter));

      throw new HTTPException(429, {
        message: 'Too many requests, please try again later',
      });
    } else {
      // Increment count
      record.count++;
    }

    // Add rate limit headers
    const currentRecord = rateLimitStore.get(key)!;
    c.header('X-RateLimit-Limit', String(limit));
    c.header(
      'X-RateLimit-Remaining',
      String(Math.max(0, limit - currentRecord.count))
    );
    c.header('X-RateLimit-Reset', String(currentRecord.resetTime));

    await next();
  };
};
