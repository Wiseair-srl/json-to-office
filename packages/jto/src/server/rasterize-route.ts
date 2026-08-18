/**
 * Shared POST /rasterize route — one validated handler mounted on BOTH the
 * playground format router and the standalone jto-render-server, so the public
 * and in-app rasterize surfaces can't drift in validation, limits, or error
 * mapping. Renders a single-slide pptx presentation to a PNG.
 */

import type { Hono, MiddlewareHandler } from 'hono';
import { Type } from '@sinclair/typebox';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import {
  clampVisualDpi,
  DEFAULT_VISUAL_DPI,
  MIN_VISUAL_DPI,
  MAX_VISUAL_DPI,
  type PptxRasterizer,
} from '@json-to-office/shared';
import { createLibreOfficePptxRasterizer } from '@json-to-office/jto-cli';
import { tbValidator, getValidated } from './lib/typebox-validator.js';
import {
  assertSafeOutboundSources,
  type OutboundSourcePolicy,
  UnsafeOutboundSourceError,
} from './security/outbound-source-policy.js';

/** Body for POST /rasterize: a single-slide pptx presentation + optional dpi. */
export const RasterizeRequestSchema = Type.Object(
  {
    presentation: Type.Object({}, { additionalProperties: true }),
    dpi: Type.Optional(
      Type.Number({ minimum: MIN_VISUAL_DPI, maximum: MAX_VISUAL_DPI })
    ),
    baseDir: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);

// One rasterizer per process — shares the on-disk content-addressed cache
// across every /rasterize surface in the process.
let sharedRasterizer: PptxRasterizer | undefined;
export function getSharedRasterizer(): PptxRasterizer {
  if (!sharedRasterizer) {
    sharedRasterizer = createLibreOfficePptxRasterizer();
  }
  return sharedRasterizer;
}

const jsonOnly: MiddlewareHandler = async (c, next) => {
  const contentType = c.req.header('content-type');
  if (!contentType || !contentType.includes('application/json')) {
    throw new HTTPException(400, {
      message: 'Content-Type must be application/json',
    });
  }
  await next();
};

/**
 * Register `POST /rasterize` on a Hono router with body-size limit, content-type
 * + schema validation (dpi clamped to [MIN,MAX]_VISUAL_DPI), the shared
 * rasterizer, and structured 400/413/503/500 error mapping.
 *
 * @param preMiddleware - extra middleware (e.g. a rate limiter) run first.
 */
export function registerRasterizeRoute(
  router: Hono<any>,
  options: {
    getRasterizer?: () => PptxRasterizer;
    preMiddleware?: MiddlewareHandler[];
    sourcePolicy?: OutboundSourcePolicy;
    onError?: (error: unknown) => void;
  } = {}
): void {
  const getRasterizer = options.getRasterizer ?? getSharedRasterizer;

  router.post(
    '/rasterize',
    ...(options.preMiddleware ?? []),
    bodyLimit({
      maxSize: 32 * 1024 * 1024,
      onError: () => {
        throw new HTTPException(413, { message: 'Request body too large' });
      },
    }),
    jsonOnly,
    tbValidator(RasterizeRequestSchema),
    async (c) => {
      const { presentation, dpi, baseDir } = getValidated<{
        presentation: unknown;
        dpi?: number;
        baseDir?: string;
      }>(c, 'json');

      try {
        if (options.sourcePolicy) {
          assertSafeOutboundSources(
            presentation,
            options.sourcePolicy,
            'presentation'
          );
        }
        const result = await getRasterizer()({
          presentation,
          dpi: clampVisualDpi(dpi ?? DEFAULT_VISUAL_DPI),
          baseDir,
        });
        return c.json(result);
      } catch (error) {
        options.onError?.(error);
        if (error instanceof HTTPException) throw error;
        if (error instanceof UnsafeOutboundSourceError) {
          throw new HTTPException(400, { message: error.message });
        }
        const msg =
          error instanceof Error ? error.message.toLowerCase() : String(error);
        if (msg.includes('not found') || msg.includes('rasterization needs')) {
          throw new HTTPException(503, { message: (error as Error).message });
        }
        if (msg.includes('invalid') || msg.includes('validation')) {
          throw new HTTPException(400, { message: (error as Error).message });
        }
        throw new HTTPException(500, {
          message: 'Internal server error during rasterization',
        });
      }
    }
  );
}
