import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getContainer } from '../container/index.js';
import {
  LooseDocumentGenerationRequestSchema,
  LooseDocumentValidationRequestSchema,
} from '../schemas/loose.js';
import { tbValidator, getValidated } from '../lib/typebox-validator.js';
import { logger } from '../utils/logger.js';
import { rateLimiter } from '../middleware/hono/rate-limit.js';
import { AppEnv } from '../types/hono.js';
import type { FormatAdapter } from '../../format-adapter.js';
import { PluginRegistry } from '../../services/plugin-registry.js';
import {
  LibreOfficeBinaryNotFoundError,
  LibreOfficeConversionError,
  LibreOfficeOutputNotFoundError,
  LibreOfficeTimeoutError,
} from '../services/libreoffice-converter.js';

export function createFormatRouter(adapter: FormatAdapter) {
  const router = new Hono<AppEnv>();

  const contentTypeMw = async (c: any, next: () => Promise<void>) => {
    const contentType = c.req.header('content-type');
    if (!contentType || !contentType.includes('application/json')) {
      throw new HTTPException(400, {
        message: 'Content-Type must be application/json',
      });
    }
    await next();
  };

  // POST /generate
  router.post(
    '/generate',
    rateLimiter({
      limit: process.env.NODE_ENV === 'production' ? 10 : 1000,
      window: 15 * 60 * 1000,
      keyGenerator: (c) =>
        c.req.header('X-Real-IP') ||
        c.req.header('X-Forwarded-For')?.split(',').pop()?.trim() ||
        'anonymous',
    }),
    contentTypeMw,
    tbValidator(LooseDocumentGenerationRequestSchema),
    async (c) => {
      const generatorService = getContainer().get('generatorService');
      const { jsonDefinition, customThemes, options } = getValidated<{
        jsonDefinition: any;
        customThemes?: Record<string, any>;
        options?: { bypassCache?: boolean; returnUrl?: boolean };
      }>(c, 'json');
      const requestId = c.get('requestId');

      try {
        const bypassCache =
          c.req.header('X-Bypass-Cache') === 'true' ||
          c.req.query('bypass-cache') === 'true' ||
          options?.bypassCache === true;

        const result = await generatorService.generate({
          jsonDefinition,
          customThemes,
          options: { ...options, bypassCache },
        });

        const cacheService = getContainer().get('cacheService');
        const cacheStats = cacheService.getStats();

        const contentType =
          adapter.name === 'pptx'
            ? 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

        return c.json({
          success: true,
          data: {
            document: result.buffer.toString('base64'),
            filename: result.filename,
            fileId: result.fileId || null,
            contentType,
          },
          cache: {
            status: result.cached ? 'HIT' : 'MISS',
            hitRate: `${(cacheStats.hitRate * 100).toFixed(1)}%`,
          },
          warnings: result.warnings || [],
          meta: { timestamp: new Date().toISOString(), requestId },
        });
      } catch (error) {
        logger.error(`${adapter.label} generation failed`, {
          error,
          requestId,
        });

        if (error instanceof Error) {
          const msg = error.message.toLowerCase();
          if (
            msg.includes('invalid') ||
            msg.includes('validation') ||
            msg.includes('missing required') ||
            msg.includes('unknown component')
          ) {
            throw new HTTPException(400, { message: error.message });
          }
        }
        if (error instanceof HTTPException) throw error;
        throw new HTTPException(500, {
          message: `Internal server error during ${adapter.label} generation`,
        });
      }
    }
  );

  // POST /validate
  router.post(
    '/validate',
    contentTypeMw,
    tbValidator(LooseDocumentValidationRequestSchema),
    async (c) => {
      const generatorService = getContainer().get('generatorService');
      const { jsonDefinition } = getValidated<{ jsonDefinition: any }>(
        c,
        'json'
      );
      const requestId = c.get('requestId');

      try {
        const result = await generatorService.validate(jsonDefinition);
        return c.json({
          success: result.valid,
          data: result,
          meta: { timestamp: new Date().toISOString(), requestId },
        });
      } catch (error) {
        logger.error('Validation failed', { error, requestId });
        throw error;
      }
    }
  );

  // POST /preview/libreoffice
  router.post(
    '/preview/libreoffice',
    rateLimiter({
      limit: process.env.NODE_ENV === 'production' ? 20 : 1000,
      window: 15 * 60 * 1000,
      keyGenerator: (c) =>
        c.req.header('X-Real-IP') ||
        c.req.header('X-Forwarded-For')?.split(',').pop()?.trim() ||
        'anonymous',
    }),
    async (c) => {
      const requestId = c.get('requestId');
      const libreOfficeService = getContainer().get(
        'libreOfficeConverterService'
      );

      try {
        const body = await c.req.parseBody();
        const file = body.file;

        if (!file || typeof file === 'string') {
          throw new HTTPException(400, {
            message: `No ${adapter.name.toUpperCase()} file provided`,
          });
        }
        if ((file as File).size === 0) {
          throw new HTTPException(400, {
            message: `${adapter.name.toUpperCase()} file is empty`,
          });
        }

        const arrayBuffer = await (file as File).arrayBuffer();
        const inputBuffer = Buffer.from(arrayBuffer);
        const pdfBuffer = await libreOfficeService.convertToPdf(
          inputBuffer,
          (file as File).name
        );

        const pdfName =
          ((file as File).name || 'preview').replace(/\.[^.]+$/i, '') + '.pdf';
        c.header('Content-Type', 'application/pdf');
        c.header('Content-Disposition', `inline; filename="${pdfName}"`);
        c.header('Content-Length', String(pdfBuffer.length));

        return c.body(pdfBuffer);
      } catch (error) {
        logger.error('LibreOffice preview conversion failed', {
          error,
          requestId,
        });
        if (error instanceof HTTPException) throw error;
        if (error instanceof LibreOfficeBinaryNotFoundError) {
          throw new HTTPException(503, {
            message:
              'LibreOffice is not available. Install LibreOffice or set LIBREOFFICE_PATH.',
          });
        }
        if (
          error instanceof LibreOfficeTimeoutError ||
          error instanceof LibreOfficeConversionError ||
          error instanceof LibreOfficeOutputNotFoundError
        ) {
          throw new HTTPException(500, {
            message: 'LibreOffice preview conversion failed.',
          });
        }
        throw new HTTPException(500, {
          message: 'Internal server error during preview conversion',
        });
      }
    }
  );

  // POST /standard-components
  router.post(
    '/standard-components',
    contentTypeMw,
    tbValidator(LooseDocumentGenerationRequestSchema),
    async (c) => {
      const { jsonDefinition, customThemes } = getValidated<{
        jsonDefinition: any;
        customThemes?: Record<string, any>;
      }>(c, 'json');
      const requestId = c.get('requestId');

      try {
        const config =
          typeof jsonDefinition === 'string'
            ? JSON.parse(jsonDefinition)
            : jsonDefinition;

        // If plugins are loaded, use plugin-aware generator to resolve custom components
        const registry = PluginRegistry.getInstance();
        if (registry.hasPlugins()) {
          const plugins = registry.getPlugins();
          const generatorResult = await adapter.createGenerator(plugins, {
            theme: customThemes ? Object.values(customThemes)[0] : undefined,
          });

          if (generatorResult.getStandardComponentsDefinition) {
            const standardComponents =
              await generatorResult.getStandardComponentsDefinition(config);
            return c.json({
              success: true,
              data: standardComponents,
              meta: { timestamp: new Date().toISOString(), requestId },
            });
          }
        }

        // No plugins — config is already standard components
        return c.json({
          success: true,
          data: config,
          meta: { timestamp: new Date().toISOString(), requestId },
        });
      } catch (error) {
        logger.error('Failed to get standard components definition', {
          error,
          requestId,
        });
        if (error instanceof HTTPException) throw error;
        throw new HTTPException(500, {
          message: 'Failed to get standard components definition',
        });
      }
    }
  );

  // GET /cache-stats
  router.get('/cache-stats', async (c) => {
    try {
      const cacheService = getContainer().get('cacheService');
      const stats = cacheService.getStats();
      const components = (await adapter.getComponentCacheStats?.()) ?? null;
      return c.json({
        success: true,
        data: {
          document: {
            hits: stats.hits,
            misses: stats.misses,
            hitRate: stats.hitRate,
            size: stats.size,
            itemCount: stats.itemCount,
            enabled: stats.enabled,
          },
          ...(components ? { components } : {}),
        },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (error) {
      logger.error('Failed to get cache statistics', { error });
      throw new HTTPException(500, {
        message: 'Failed to get cache statistics',
      });
    }
  });

  // GET /cache-analytics
  router.get('/cache-analytics', async (c) => {
    try {
      const analytics = await adapter.getComponentCacheAnalytics?.();
      if (!analytics) {
        return c.json({
          success: true,
          data: null,
          meta: { timestamp: new Date().toISOString() },
        });
      }
      return c.json({
        success: true,
        data: analytics,
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (error) {
      logger.error('Failed to get cache analytics', { error });
      throw new HTTPException(500, {
        message: 'Failed to get cache analytics',
      });
    }
  });

  // DELETE /cache
  router.delete('/cache', async (c) => {
    try {
      const cacheService = getContainer().get('cacheService');
      cacheService.clear();
      const { invalidateAllCaches } = await import(
        '../../services/cache-events.js'
      );
      invalidateAllCaches();
      return c.json({
        success: true,
        data: { message: 'Cache cleared successfully' },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (error) {
      logger.error('Failed to clear cache', { error });
      throw new HTTPException(500, { message: 'Failed to clear cache' });
    }
  });

  return router;
}
