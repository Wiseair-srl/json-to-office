import { MiddlewareHandler } from 'hono';
// import { HTTPException } from 'hono/http-exception';
import { logger } from '../../utils/logger';

/**
 * Error recovery middleware for Hono
 * Handles specific error types with appropriate recovery strategies
 */
export const errorRecoveryMiddleware: MiddlewareHandler = async (c, next) => {
  try {
    await next();
  } catch (err: any) {
    const requestId = c.get('requestId') || 'unknown';

    logger.error('Error recovery triggered', {
      error: err.message,
      name: err.name,
      path: c.req.path,
      method: c.req.method,
      requestId,
    });

    // Handle payload too large errors
    if (err.name === 'PayloadTooLargeError' || err.status === 413) {
      return c.json(
        {
          success: false,
          error: 'Payload too large',
          message: 'The request body exceeds the maximum allowed size',
          code: 'PAYLOAD_TOO_LARGE',
          requestId,
        },
        413
      );
    }

    // Handle JSON syntax errors
    if (
      (err.name === 'SyntaxError' && err.message.includes('JSON')) ||
      (err.status === 400 && err.message.includes('JSON'))
    ) {
      return c.json(
        {
          success: false,
          error: 'Invalid JSON',
          message: 'The request body contains invalid JSON',
          code: 'INVALID_JSON',
          requestId,
        },
        400
      );
    }

    // Handle timeout errors
    if (err.name === 'TimeoutError' || err.code === 'ETIMEDOUT') {
      return c.json(
        {
          success: false,
          error: 'Request timeout',
          message: 'The request took too long to process',
          code: 'TIMEOUT',
          requestId,
        },
        408
      );
    }

    // Re-throw the error to be handled by the global error handler
    throw err;
  }
};
