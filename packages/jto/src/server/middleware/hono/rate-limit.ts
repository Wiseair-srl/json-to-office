import { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

export interface RateLimitOptions {
  limit: number;
  window: number; // milliseconds
  keyGenerator?: (c: any) => string;
  namespace?: string | ((c: any) => string);
  maxEntries?: number;
  trustProxy?: boolean;
}

function clientAddress(c: any, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded =
      c.req.header('X-Real-IP') ||
      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  const incoming = c.env?.incoming || c.env?.req;
  return incoming?.socket?.remoteAddress || 'anonymous';
}

/**
 * Bounded, process-local rate limiting. Distributed deployments should put a
 * shared limiter at the edge too; this remains the last line of defence for a
 * single worker and never grows without bound.
 */
export const rateLimiter = (options: RateLimitOptions): MiddlewareHandler => {
  const { limit, window, keyGenerator } = options;
  const maxEntries = options.maxEntries ?? 10_000;
  const rateLimitStore = new Map<
    string,
    { count: number; resetTime: number }
  >();
  let lastCleanup = 0;

  return async (c, next) => {
    const clientKey = keyGenerator
      ? keyGenerator(c)
      : clientAddress(c, options.trustProxy === true);
    const namespace =
      typeof options.namespace === 'function'
        ? options.namespace(c)
        : options.namespace || `${c.req.method}:${c.req.path}`;
    const key = `${namespace}:${String(clientKey).slice(0, 256)}`;
    const now = Date.now();

    // Amortize cleanup; scanning an attacker-filled map on every request would
    // turn the protection itself into a CPU denial of service.
    if (now - lastCleanup >= Math.min(window, 60_000)) {
      for (const [storedKey, value] of rateLimitStore.entries()) {
        if (value.resetTime <= now) rateLimitStore.delete(storedKey);
      }
      lastCleanup = now;
    }

    const record = rateLimitStore.get(key);

    if (!record) {
      if (rateLimitStore.size >= maxEntries) {
        const oldestKey = rateLimitStore.keys().next().value as
          | string
          | undefined;
        if (oldestKey) rateLimitStore.delete(oldestKey);
      }
      rateLimitStore.set(key, {
        count: 1,
        resetTime: now + window,
      });
    } else if (record.resetTime <= now) {
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
