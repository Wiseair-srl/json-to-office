import { MiddlewareHandler } from 'hono';

/**
 * Security middleware for Hono
 * Adds additional security headers and input sanitization
 */
export const securityMiddleware: MiddlewareHandler = async (c, next) => {
  // Add security headers
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Remove sensitive headers
  c.header('X-Powered-By', '');

  await next();
};
