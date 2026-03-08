import { MiddlewareHandler } from 'hono';
import { randomUUID } from 'crypto';

/**
 * Request ID middleware for Hono
 * Generates a unique ID for each request for tracing
 */
export const requestIdMiddleware: MiddlewareHandler = async (c, next) => {
  const requestId = c.req.header('X-Request-Id') || randomUUID();

  // Set request ID in context
  c.set('requestId', requestId);

  // Add to response headers
  c.header('X-Request-Id', requestId);

  await next();
};
