import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';
import { logger as honoLogger } from 'hono/logger';
import { timing } from 'hono/timing';
import { config } from './config/index.js';
import { getApiInfo } from './config/api-info.js';
import type { FormatAdapter } from '../format-adapter.js';

import { healthRouter } from './routes/health.js';
import { createFormatRouter } from './routes/format.js';
import { discoveryRouter } from './routes/discovery.js';

import { requestIdMiddleware } from './middleware/hono/request-id.js';
import { apiKeyAuthMiddleware } from './middleware/hono/auth.js';
import { errorHandler } from './middleware/hono/error-handler.js';
import { performanceMiddleware } from './middleware/hono/performance.js';
import { securityMiddleware } from './middleware/hono/security.js';
import { monitoringMiddleware } from './middleware/hono/monitoring.js';
import { errorRecoveryMiddleware } from './middleware/hono/error-recovery.js';
import { requestLoggerMiddleware } from './middleware/hono/request-logger.js';

import { AppEnv } from './types/hono.js';
import { Container } from './container/index.js';

export function createAPIApp(adapter: FormatAdapter) {
  // Initialize DI container with the adapter
  Container.initialize(adapter);

  const honoApp = new Hono<AppEnv>();

  // Built-in middleware
  honoApp.use('*', compress());
  honoApp.use('*', timing());
  honoApp.use('*', honoLogger());

  // CORS
  honoApp.use(
    '*',
    cors({
      origin: config.cors.origin,
      credentials: config.cors.credentials,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type', 'Authorization', config.API_KEY_HEADER],
      exposeHeaders: ['X-Request-Id', 'X-File-Id'],
      maxAge: 86400,
    })
  );

  honoApp.use('*', secureHeaders());

  // Custom middleware
  honoApp.use('*', requestIdMiddleware);
  honoApp.use('*', errorRecoveryMiddleware);
  honoApp.use('*', monitoringMiddleware);
  honoApp.use('*', requestLoggerMiddleware);
  honoApp.use('*', performanceMiddleware);
  honoApp.use('*', securityMiddleware);

  // API key auth (if enabled)
  if (config.features.apiKey) {
    honoApp.use('/api/*', apiKeyAuthMiddleware);
  }

  // Mount routes
  honoApp.route('/health', healthRouter);

  // Format-specific routes at /api/{format}/*
  const formatRouter = createFormatRouter(adapter);
  honoApp.route(`/api/${adapter.name}`, formatRouter);

  // Also mount at /api/documents or /api/presentations for backward compat
  const legacyPath = adapter.name === 'docx' ? '/api/documents' : '/api/presentations';
  honoApp.route(legacyPath, formatRouter);

  // Discovery routes
  honoApp.route('/api/discovery', discoveryRouter);

  // Root endpoint
  honoApp.get('/', async (c) => {
    const apiInfo = await getApiInfo();
    return c.json(apiInfo);
  });

  honoApp.get('/api', async (c) => {
    const apiInfo = await getApiInfo();
    return c.json(apiInfo);
  });

  // 404 handler
  honoApp.notFound((c) => {
    return c.json(
      {
        success: false,
        error: 'Not found',
        path: c.req.path,
        method: c.req.method,
        requestId: c.get('requestId'),
      },
      404
    );
  });

  honoApp.onError(errorHandler);

  return honoApp;
}
