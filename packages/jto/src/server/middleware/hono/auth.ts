import { MiddlewareHandler } from 'hono';
import { config } from '../../config';

/**
 * API Key authentication middleware for Hono
 */
export const apiKeyAuthMiddleware: MiddlewareHandler = async (c, next) => {
  // Skip auth if not configured
  if (!config.features.apiKey || !config.API_KEY) {
    return next();
  }

  const apiKey = c.req.header(config.API_KEY_HEADER);

  if (!apiKey) {
    return c.json(
      {
        success: false,
        error: 'API key required',
        code: 'UNAUTHORIZED',
      },
      401
    );
  }

  if (apiKey !== config.API_KEY) {
    return c.json(
      {
        success: false,
        error: 'Invalid API key',
        code: 'UNAUTHORIZED',
      },
      401
    );
  }

  await next();
};
