import { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { logger } from '../../utils/logger';
import { config } from '../../config';

/**
 * Global error handler for Hono
 */
export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = c.get('requestId') || 'unknown';

  // Handle Hono HTTPException
  if (err instanceof HTTPException) {
    return c.json(
      {
        success: false,
        error: err.message,
        code: err.status >= 500 ? 'INTERNAL_ERROR' : 'CLIENT_ERROR',
        requestId,
      },
      err.status
    );
  }

  // Log unexpected errors
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    requestId,
    path: c.req.path,
    method: c.req.method,
  });

  // Handle validation errors (TypeBox format)
  if (err.name === 'ValidationError' && 'errors' in err) {
    return c.json(
      {
        success: false,
        error: 'Validation failed',
        errors: (err as any).errors,
        code: 'VALIDATION_ERROR',
        requestId,
      },
      400
    );
  }

  // Default error response
  return c.json(
    {
      success: false,
      error: config.isDevelopment ? err.message : 'Internal server error',
      code: 'INTERNAL_ERROR',
      requestId,
    },
    500
  );
};
