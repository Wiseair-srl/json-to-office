import { Hono } from 'hono';
import { Type } from '@sinclair/typebox';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { getContainer } from '../container/index.js';
import {
  LooseDocumentGenerationRequestSchema,
  LooseDocumentValidationRequestSchema,
  LooseDocumentDiffRequestSchema,
} from '../schemas/loose.js';
import { tbValidator, getValidated } from '../lib/typebox-validator.js';
import { logger } from '../utils/logger.js';
import { rateLimiter } from '../middleware/hono/rate-limit.js';
import { AppEnv } from '../types/hono.js';
import {
  type FormatAdapter,
  PluginRegistry,
  createLibreOfficePptxRasterizer,
} from '@json-to-office/jto-cli';
import type { PptxRasterizer } from '@json-to-office/shared';
import {
  LibreOfficeBinaryNotFoundError,
  LibreOfficeConversionError,
  LibreOfficeOutputNotFoundError,
  LibreOfficeTimeoutError,
} from '../services/libreoffice-converter.js';

/**
 * Request body for POST /rasterize: a single-slide pptx presentation plus an
 * optional DPI. `presentation` is validated loosely (the pptx engine performs
 * deep validation when it builds the slide).
 */
const RasterizeRequestSchema = Type.Object(
  {
    presentation: Type.Object({}, { additionalProperties: true }),
    dpi: Type.Optional(Type.Number({ minimum: 36, maximum: 600 })),
  },
  { additionalProperties: false }
);

// One rasterizer per process — shares the on-disk content-addressed cache.
let sharedRasterizer: PptxRasterizer | undefined;
function getRasterizer(): PptxRasterizer {
  if (!sharedRasterizer) {
    sharedRasterizer = createLibreOfficePptxRasterizer();
  }
  return sharedRasterizer;
}

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

        // Drop `fonts.strict` from untrusted client input: a toggle that
        // throws on unresolved refs is only meaningful for programmatic
        // callers. Honouring it from an HTTP client would turn any
        // non-safe font reference into a predictable 500 — DoS-adjacent
        // and no useful UX behind it. Advisory only. Build a fresh
        // object rather than mutating the validated request payload.
        let sanitizedFonts: Record<string, unknown> | undefined;
        const rawFonts = (
          options as { fonts?: Record<string, unknown> } | undefined
        )?.fonts;
        if (rawFonts && 'strict' in rawFonts) {
          sanitizedFonts = { ...rawFonts };
          delete sanitizedFonts.strict;
        } else if (rawFonts) {
          sanitizedFonts = rawFonts;
        }

        const result = await generatorService.generate({
          jsonDefinition,
          customThemes,
          options: {
            ...options,
            ...(sanitizedFonts !== undefined && { fonts: sanitizedFonts }),
            bypassCache,
          },
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

  // POST /diff (DOCX only)
  //
  // Compare two document definitions into a tracked-change redline: returns
  // the renderable redline JSON plus a summary. The client previews and
  // downloads the redline through the normal generate/preview pipeline.
  if (adapter.name === 'docx') {
    router.post(
      '/diff',
      bodyLimit({
        // Two full documents per request — same cap rationale as
        // /preview/libreoffice-from-json, doubled.
        maxSize: 32 * 1024 * 1024,
        onError: () => {
          throw new HTTPException(413, { message: 'Request body too large' });
        },
      }),
      rateLimiter({
        limit: process.env.NODE_ENV === 'production' ? 30 : 1000,
        window: 15 * 60 * 1000,
        keyGenerator: (c) =>
          c.req.header('X-Real-IP') ||
          c.req.header('X-Forwarded-For')?.split(',').pop()?.trim() ||
          'anonymous',
      }),
      contentTypeMw,
      tbValidator(LooseDocumentDiffRequestSchema),
      async (c) => {
        const { oldDefinition, newDefinition, options } = getValidated<{
          oldDefinition: string | object;
          newDefinition: string | object;
          options?: { author?: string; date?: string };
        }>(c, 'json');
        const requestId = c.get('requestId');

        const parseDef = (label: string, def: string | object): object => {
          if (typeof def !== 'string') return def;
          try {
            return JSON.parse(def);
          } catch {
            throw new HTTPException(400, {
              message: `${label} document is not valid JSON`,
            });
          }
        };

        try {
          const oldDoc = parseDef('Old', oldDefinition);
          const newDoc = parseDef('New', newDefinition);

          // The adapter's validateDocument is a no-op stub; use the real
          // TypeBox document validation from shared-docx (same as the CLI)
          const sharedDocx = await import('@json-to-office/shared-docx');
          for (const [label, doc] of [
            ['Old', oldDoc],
            ['New', newDoc],
          ] as const) {
            const result = sharedDocx.validate.jsonDocument(
              JSON.stringify(doc)
            );
            if (!result.valid) {
              return c.json(
                {
                  success: false,
                  error: `${label} document failed validation`,
                  errors: (result.errors || []).slice(0, 20),
                  meta: { timestamp: new Date().toISOString(), requestId },
                },
                400
              );
            }
          }

          // Validate and canonicalize the revision date (invalid values
          // would fail RevisionSchema and OOXML ST_DateTime downstream)
          const revisionDate = options?.date
            ? new Date(options.date)
            : new Date();
          if (isNaN(revisionDate.getTime())) {
            throw new HTTPException(400, {
              message: `Invalid date: "${options?.date}" (expected ISO 8601)`,
            });
          }

          const { diffDocuments } = sharedDocx;
          const { document, summary } = diffDocuments(
            oldDoc as Parameters<typeof diffDocuments>[0],
            newDoc as Parameters<typeof diffDocuments>[1],
            {
              author: options?.author || 'playground',
              date: revisionDate.toISOString(),
            }
          );

          return c.json({
            success: true,
            data: { document, summary },
            meta: { timestamp: new Date().toISOString(), requestId },
          });
        } catch (error) {
          if (error instanceof HTTPException) throw error;
          logger.error('Document diff failed', { error, requestId });
          if (
            error instanceof Error &&
            error.message.includes('top-level component')
          ) {
            throw new HTTPException(400, { message: error.message });
          }
          throw new HTTPException(500, {
            message: 'Internal server error during document diff',
          });
        }
      }
    );
  }

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

  // POST /preview/libreoffice-from-json
  //
  // Generate the document server-side and convert to PDF in one step so
  // resolved fonts flow straight into the LibreOffice font-staging pipeline.
  // The client sends the JSON doc instead of re-uploading the generated file.
  router.post(
    '/preview/libreoffice-from-json',
    bodyLimit({
      // Doc JSON + custom themes. 16 MB accommodates real-world docs that
      // inline base64 image assets (logos, screenshots, chart images); the
      // earlier 2 MB cap rejected legitimate payloads with 413.
      maxSize: 16 * 1024 * 1024,
      onError: () => {
        throw new HTTPException(413, { message: 'Request body too large' });
      },
    }),
    rateLimiter({
      limit: process.env.NODE_ENV === 'production' ? 20 : 1000,
      window: 15 * 60 * 1000,
      keyGenerator: (c) =>
        c.req.header('X-Real-IP') ||
        c.req.header('X-Forwarded-For')?.split(',').pop()?.trim() ||
        'anonymous',
    }),
    contentTypeMw,
    tbValidator(LooseDocumentGenerationRequestSchema),
    async (c) => {
      const requestId = c.get('requestId');
      const generatorService = getContainer().get('generatorService');
      const libreOfficeService = getContainer().get(
        'libreOfficeConverterService'
      );
      const { jsonDefinition, customThemes } = getValidated<{
        jsonDefinition: any;
        customThemes?: Record<string, any>;
      }>(c, 'json');

      try {
        const generated = await generatorService.generate({
          jsonDefinition,
          customThemes,
          options: { bypassCache: true },
        });

        const pdfBuffer = await libreOfficeService.convertToPdf(
          generated.buffer,
          generated.filename,
          generated.resolvedFonts
        );

        const pdfName = generated.filename.replace(/\.[^.]+$/i, '') + '.pdf';
        c.header('Content-Type', 'application/pdf');
        c.header('Content-Disposition', `inline; filename="${pdfName}"`);
        c.header('Content-Length', String(pdfBuffer.length));
        return c.body(pdfBuffer);
      } catch (error) {
        logger.error('LibreOffice (JSON) preview failed', {
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
      const { invalidateAllCaches } = await import('@json-to-office/jto-cli');
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

  // POST /rasterize — render a single-slide pptx presentation to a PNG.
  // Backs the docx `visual` component when it is configured with
  // `services.pptx.serverUrl` instead of an in-process renderer.
  router.post(
    '/rasterize',
    rateLimiter({
      limit: process.env.NODE_ENV === 'production' ? 10 : 1000,
      window: 15 * 60 * 1000,
      keyGenerator: (c) =>
        c.req.header('X-Real-IP') ||
        c.req.header('X-Forwarded-For')?.split(',').pop()?.trim() ||
        'anonymous',
    }),
    bodyLimit({
      maxSize: 32 * 1024 * 1024,
      onError: () => {
        throw new HTTPException(413, { message: 'Request body too large' });
      },
    }),
    contentTypeMw,
    tbValidator(RasterizeRequestSchema),
    async (c) => {
      const { presentation, dpi } = getValidated<{
        presentation: unknown;
        dpi?: number;
      }>(c, 'json');
      const requestId = c.get('requestId');

      try {
        const result = await getRasterizer()({
          presentation,
          dpi: dpi ?? 200,
        });
        return c.json(result);
      } catch (error) {
        logger.error('Visual rasterization failed', { error, requestId });
        if (error instanceof Error) {
          const msg = error.message.toLowerCase();
          // Missing soffice/pdftoppm → the service can't fulfil the request.
          if (
            msg.includes('not found') ||
            msg.includes('rasterization needs')
          ) {
            throw new HTTPException(503, { message: error.message });
          }
          if (msg.includes('invalid') || msg.includes('validation')) {
            throw new HTTPException(400, { message: error.message });
          }
        }
        if (error instanceof HTTPException) throw error;
        throw new HTTPException(500, {
          message: 'Internal server error during rasterization',
        });
      }
    }
  );

  return router;
}
