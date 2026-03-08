import { MiddlewareHandler } from 'hono';

/**
 * Performance monitoring middleware for Hono
 * Tracks request duration and adds performance headers
 */
export const performanceMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();

  await next();

  const duration = Date.now() - start;

  // Add performance headers
  c.header('X-Response-Time', `${duration}ms`);
  c.header('X-Process-Time', `${duration}`);

  // Log slow requests
  if (duration > 1000) {
    console.warn(
      `Slow request detected: ${c.req.method} ${c.req.path} - ${duration}ms`
    );
  }
};
