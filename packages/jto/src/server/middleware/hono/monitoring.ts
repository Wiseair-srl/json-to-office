import { MiddlewareHandler } from 'hono';
import { logger } from '../../utils/logger';

/**
 * Monitoring middleware for Hono
 * Logs requests and tracks metrics
 */
export const monitoringMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const method = c.req.method;
  const path = c.req.path;
  const requestId = c.get('requestId') || 'unknown';

  // Log request
  logger.info('Incoming request', {
    method,
    path,
    requestId,
    userAgent: c.req.header('User-Agent'),
    ip:
      c.req.header('X-Forwarded-For') || c.req.header('X-Real-IP') || 'unknown',
  });

  await next();

  // Log response
  const duration = Date.now() - start;
  const status = c.res.status;

  logger.info('Request completed', {
    method,
    path,
    status,
    duration,
    requestId,
  });

  // Track metrics (could be sent to monitoring service)
  // TODO: Implement actual metrics tracking when monitoring service is configured
  // Example: await metricsService.recordRequest({ method, path, status, duration });
};
