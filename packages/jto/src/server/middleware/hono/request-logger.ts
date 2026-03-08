import { MiddlewareHandler } from 'hono';
import { logger } from '../../utils/logger';

/**
 * Request logger middleware for Hono
 * Logs incoming requests and their responses
 */
export const requestLoggerMiddleware: MiddlewareHandler = async (c, next) => {
  const startTime = Date.now();
  const requestId = c.get('requestId');

  // Log incoming request
  logger.info('Incoming request', {
    requestId,
    method: c.req.method,
    url: c.req.url,
    path: c.req.path,
    ip:
      c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
    userAgent: c.req.header('user-agent'),
  });

  try {
    // Process the request
    await next();

    // Log response
    const duration = Date.now() - startTime;
    const status = c.res.status;

    logger.info('Request completed', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      status,
      duration,
      responseTime: `${duration}ms`,
    });

    // Add response time header
    c.header('X-Response-Time', `${duration}ms`);
  } catch (error) {
    // Log error response
    const duration = Date.now() - startTime;

    logger.error('Request failed', {
      requestId,
      method: c.req.method,
      path: c.req.path,
      duration,
      error: error instanceof Error ? error.message : String(error),
    });

    // Re-throw the error
    throw error;
  }
};
