import { Hono } from 'hono';
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
  PluginDiscoveryService,
} from '@json-to-office/jto-cli';
import { dirname } from 'node:path';
import { registerRasterizeRoute } from '../rasterize-route.js';
import { config } from '../config/index.js';
import {
  assertSafeOutboundSources,
  UnsafeOutboundSourceError,
} from '../security/outbound-source-policy.js';
import {
  LibreOfficeBinaryNotFoundError,
  LibreOfficeConversionError,
  LibreOfficeOutputNotFoundError,
  LibreOfficeTimeoutError,
} from '../services/libreoffice-converter.js';
import { inlineTemplateMedia } from '../services/template-media-inliner.js';

/**
 * Re-throw as a 400 when the failure is the document's fault, not the server's.
 *
 * Two kinds qualify. A backend refusing a feature, or the compiler meeting a
 * component it does not lower, both carry a code and a message naming what was
 * missing and where — matched on the code rather than the text, because these
 * cross a dynamic-import boundary where `instanceof` is unreliable and because
 * the wording is not an API. Everything else is matched on the message, which
 * is older and less precise but covers validation failures that predate codes.
 *
 * Returns normally when the error is not a client error, leaving the caller to
 * decide what its own 500 says.
 */
function throwIfClientError(error: unknown): void {
  const code = (error as { code?: unknown } | undefined)?.code;
  if (
    code === 'UNSUPPORTED_RENDERER_FEATURE' ||
    code === 'UNCOMPILED_COMPONENT' ||
    // An id nobody registered is the caller naming a backend that does not
    // exist. The message already lists the ones that do.
    code === 'UNKNOWN_RENDERER'
  ) {
    throw new HTTPException(400, { message: (error as Error).message });
  }
  if (!(error instanceof Error)) return;
  const message = error.message.toLowerCase();
  if (
    message.includes('invalid') ||
    message.includes('validation') ||
    message.includes('missing required') ||
    message.includes('unknown component')
  ) {
    throw new HTTPException(400, { message: error.message });
  }
}

export function createFormatRouter(adapter: FormatAdapter) {
  const router = new Hono<AppEnv>();
  const assertRequestSources = (value: unknown, path: string) => {
    try {
      assertSafeOutboundSources(value, config.outboundSources, path);
    } catch (error) {
      if (error instanceof UnsafeOutboundSourceError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  };

  // Map a discovered-document name to its directory so relative asset paths
  // resolve against the document's own location (#142). Only names are
  // accepted from clients; unknown names fall back to cwd-relative resolution.
  const resolveSourceBaseDir = async (
    options: unknown
  ): Promise<string | undefined> => {
    const sourceName = (options as { sourceName?: unknown } | undefined)
      ?.sourceName;
    if (typeof sourceName !== 'string' || sourceName.length === 0) {
      return undefined;
    }
    try {
      const discovery = new PluginDiscoveryService({
        maxDepth: 10,
        includeNodeModules: false,
        verbose: false,
      });
      const documents = await discovery.discoverDocuments(
        adapter.name as 'docx' | 'pptx'
      );
      const match = documents.find((doc) => doc.name === sourceName);
      return match ? dirname(match.path) : undefined;
    } catch {
      // Discovery is best-effort here; generation proceeds cwd-relative.
      return undefined;
    }
  };

  // In safe mode, relative media of a server-discovered document is inlined
  // as data URLs so bundled templates pass source validation and survive the
  // trip to the remote rasterizer. Development mode keeps filesystem
  // resolution (and the path-keyed visual cache) untouched.
  const inlineDiscoveredMedia = async (
    jsonDefinition: unknown,
    baseDir: string | undefined
  ): Promise<unknown> => {
    if (
      baseDir === undefined ||
      config.outboundSources.mode === 'development'
    ) {
      return jsonDefinition;
    }
    return inlineTemplateMedia(jsonDefinition, baseDir, {
      maxFileBytes: config.requestLimits.maxFileSize,
      maxTotalBytes: config.requestLimits.maxBodySize,
    });
  };

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
      trustProxy: config.rateLimit.trustProxy,
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
        // Resolve the trusted sourceName -> baseDir mapping first so bundled
        // template media can be inlined as data URLs before safe-mode source
        // validation (which rejects relative paths from HTTP clients).
        const baseDir = await resolveSourceBaseDir(options);
        const effectiveDefinition = await inlineDiscoveredMedia(
          jsonDefinition,
          baseDir
        );

        assertRequestSources(effectiveDefinition, 'jsonDefinition');
        assertRequestSources(customThemes, 'customThemes');
        assertRequestSources(options, 'options');

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

        // `baseDir` selects the directory local media paths resolve against —
        // never accept it from the HTTP client. Only the server-side
        // sourceName mapping above may set it.
        const clientOptions = { ...(options as Record<string, unknown>) };
        delete clientOptions.baseDir;

        const result = await generatorService.generate({
          jsonDefinition: effectiveDefinition,
          customThemes,
          options: {
            ...clientOptions,
            ...(sanitizedFonts !== undefined && { fonts: sanitizedFonts }),
            ...(baseDir !== undefined && { baseDir }),
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

        throwIfClientError(error);
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
        trustProxy: config.rateLimit.trustProxy,
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

          // Use the canonical shared-docx validator (same as the CLI).
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
    bodyLimit({
      // Multipart framing adds a small amount around the configured file cap.
      maxSize: config.requestLimits.maxFileSize + 64 * 1024,
      onError: () => {
        throw new HTTPException(413, { message: 'Request body too large' });
      },
    }),
    rateLimiter({
      limit: process.env.NODE_ENV === 'production' ? 20 : 1000,
      window: 15 * 60 * 1000,
      trustProxy: config.rateLimit.trustProxy,
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
        if ((file as File).size > config.requestLimits.maxFileSize) {
          throw new HTTPException(413, {
            message: `File exceeds ${config.requestLimits.maxFileSize} bytes`,
          });
        }

        const expectedExtension = `.${adapter.name}`;
        const originalName =
          (file as File).name || `preview${expectedExtension}`;
        if (!originalName.toLowerCase().endsWith(expectedExtension)) {
          throw new HTTPException(400, {
            message: `Expected a ${adapter.name.toUpperCase()} file`,
          });
        }

        const arrayBuffer = await (file as File).arrayBuffer();
        const inputBuffer = Buffer.from(arrayBuffer);
        if (
          inputBuffer.length < 4 ||
          inputBuffer[0] !== 0x50 ||
          inputBuffer[1] !== 0x4b
        ) {
          throw new HTTPException(400, {
            message: `Invalid ${adapter.name.toUpperCase()} file`,
          });
        }
        const pdfBuffer = await libreOfficeService.convertToPdf(
          inputBuffer,
          originalName
        );

        const pdfName =
          originalName
            .replace(/\.[^.]+$/i, '')
            .replace(/[^a-zA-Z0-9._-]/g, '_') + '.pdf';
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
      trustProxy: config.rateLimit.trustProxy,
    }),
    contentTypeMw,
    tbValidator(LooseDocumentGenerationRequestSchema),
    async (c) => {
      const requestId = c.get('requestId');
      const generatorService = getContainer().get('generatorService');
      const libreOfficeService = getContainer().get(
        'libreOfficeConverterService'
      );
      const { jsonDefinition, customThemes, options } = getValidated<{
        jsonDefinition: any;
        customThemes?: Record<string, any>;
        options?: { sourceName?: string; renderer?: string };
      }>(c, 'json');

      try {
        // Same server-side sourceName -> baseDir mapping as /generate, so
        // previews resolve relative asset paths the way downloads do (#142).
        const baseDir = await resolveSourceBaseDir(options);
        const effectiveDefinition = await inlineDiscoveredMedia(
          jsonDefinition,
          baseDir
        );

        assertRequestSources(effectiveDefinition, 'jsonDefinition');
        assertRequestSources(customThemes, 'customThemes');
        assertRequestSources(options, 'options');

        const generated = await generatorService.generate({
          jsonDefinition: effectiveDefinition,
          customThemes,
          options: {
            bypassCache: true,
            ...(baseDir !== undefined && { baseDir }),
            // The preview has to come from the backend the caller picked.
            // Regenerating with the default made the picker lie: the PDF on
            // screen and the bytes on download came from different renderers,
            // and a capability refusal was invisible until you downloaded
            // (#255).
            ...(options?.renderer !== undefined && {
              renderer: options.renderer,
            }),
          },
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
        // Generation runs inside this route now, so the same document faults
        // the download reports — an unknown backend, a feature it cannot
        // express — have to reach the previewer with the same status.
        throwIfClientError(error);
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
      const { jsonDefinition, customThemes, options } = getValidated<{
        jsonDefinition: any;
        customThemes?: Record<string, any>;
        options?: { sourceName?: string };
      }>(c, 'json');
      const requestId = c.get('requestId');

      try {
        // Same prologue as /generate: inline a discovered document's bundled
        // media before safe-mode source validation, otherwise templates that
        // reference relative media paths 400 here while rendering fine there.
        const baseDir = await resolveSourceBaseDir(options);
        const effectiveDefinition = await inlineDiscoveredMedia(
          jsonDefinition,
          baseDir
        );

        assertRequestSources(effectiveDefinition, 'jsonDefinition');
        assertRequestSources(customThemes, 'customThemes');

        let config: unknown;
        try {
          config =
            typeof effectiveDefinition === 'string'
              ? JSON.parse(effectiveDefinition)
              : effectiveDefinition;
        } catch {
          throw new HTTPException(400, {
            message: 'jsonDefinition is not valid JSON',
          });
        }

        // If plugins are loaded, use plugin-aware generator to resolve custom components
        const registry = PluginRegistry.getInstance();
        if (registry.hasPlugins()) {
          const plugins = registry.getPlugins();
          const generatorResult = await adapter.createGenerator(plugins, {
            customThemes,
            baseDir,
          });

          // Expansion-only path: resolves custom components to the standard
          // tree without fonts/layout/rendering (#155) — the old deprecated
          // wrapper ran a full generation, LibreOffice rasterization included.
          if (generatorResult.getStandardDefinition) {
            const standardComponents =
              await generatorResult.getStandardDefinition(config);
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
        throwIfClientError(error);
        throw new HTTPException(500, {
          message: 'Failed to get standard components definition',
        });
      }
    }
  );

  // GET /renderers — the backends this format registers, defaults first.
  router.get('/renderers', async (c) => {
    try {
      const ids = await adapter.rendererIds();
      return c.json({
        success: true,
        data: { ids, default: ids[0] ?? null },
        meta: { timestamp: new Date().toISOString() },
      });
    } catch (error) {
      logger.error('Failed to list renderers', { error });
      throw new HTTPException(500, { message: 'Failed to list renderers' });
    }
  });

  // GET /cache-stats
  router.get('/cache-stats', async (c) => {
    try {
      const cacheService = getContainer().get('cacheService');
      const stats = cacheService.getStats();
      // Rasterizer cache observability (#156): the disk cache and the batch
      // dedupe are where `visual` caching lives. There is no component render
      // cache to report any more — compiling a document to an IR is cheap and
      // holds no cross-document state.
      const rasterizer = await (async () => {
        try {
          const cli = await import('@json-to-office/jto-cli');
          const engine = await cli.getRasterizerCacheStats?.();
          if (!engine) return null;
          const prepass = (await adapter.getVisualPrepassStats?.()) ?? null;
          return { ...engine, ...(prepass ? { prepass } : {}) };
        } catch {
          return null;
        }
      })();
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
          ...(rasterizer ? { rasterizer } : {}),
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

  // DELETE /cache
  router.delete('/cache', async (c) => {
    try {
      const cacheService = getContainer().get('cacheService');
      cacheService.clear();
      const cli = await import('@json-to-office/jto-cli');
      cli.invalidateAllCaches();
      // "Clear all caches" means all of them: the rasterizer's PNG disk cache
      // used to survive this call (#156).
      await adapter.clearComponentCache?.();
      await cli.clearRasterizerCache?.();
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
  // `services.pptx.serverUrl`. Shares the validated handler + limits with the
  // standalone jto-render-server (see rasterize-route.ts).
  registerRasterizeRoute(router, {
    preMiddleware: [
      rateLimiter({
        limit: process.env.NODE_ENV === 'production' ? 10 : 1000,
        window: 15 * 60 * 1000,
        // One bucket for /rasterize AND /rasterize/batch — without a shared
        // namespace the default per-path key would double the budget.
        namespace: 'rasterize',
        trustProxy: config.rateLimit.trustProxy,
      }),
    ],
    sourcePolicy: config.outboundSources,
    onError: (error) => logger.error('Visual rasterization failed', { error }),
  });

  return router;
}
