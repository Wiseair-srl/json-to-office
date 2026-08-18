/**
 * Shared POST /rasterize + /rasterize/batch routes — validated handlers
 * mounted on BOTH the playground format router and the standalone
 * jto-render-server, so the public and in-app rasterize surfaces can't drift
 * in validation, limits, or error mapping.
 *
 * /rasterize renders one single-slide pptx presentation to a PNG.
 * /rasterize/batch (#153) renders many independent single-slide presentations
 * in one request — one LibreOffice launch instead of one per visual — and
 * returns index-aligned per-slide results (200 with item errors rather than
 * all-or-nothing).
 */

import path from 'node:path';
import type { Hono, MiddlewareHandler } from 'hono';
import { Type } from '@sinclair/typebox';
import { bodyLimit } from 'hono/body-limit';
import { HTTPException } from 'hono/http-exception';
import {
  clampVisualDpi,
  DEFAULT_VISUAL_DPI,
  MIN_VISUAL_DPI,
  MAX_VISUAL_DPI,
  MAX_RASTERIZE_BATCH_SLIDES,
  type PptxRasterizer,
  type PptxBatchRasterizer,
} from '@json-to-office/shared';
import {
  createLibreOfficePptxRasterizer,
  createLibreOfficePptxBatchRasterizer,
} from '@json-to-office/jto-cli';
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

/** Body for POST /rasterize/batch: independent slides + shared baseDir. */
export const RasterizeBatchRequestSchema = Type.Object(
  {
    slides: Type.Array(
      Type.Object(
        {
          presentation: Type.Object({}, { additionalProperties: true }),
          dpi: Type.Optional(
            Type.Number({ minimum: MIN_VISUAL_DPI, maximum: MAX_VISUAL_DPI })
          ),
        },
        { additionalProperties: false }
      ),
      { minItems: 1, maxItems: MAX_RASTERIZE_BATCH_SLIDES }
    ),
    baseDir: Type.Optional(Type.String()),
  },
  { additionalProperties: false }
);

// One rasterizer per process — shares the on-disk content-addressed cache
// across every /rasterize surface in the process. Single and batch factories
// use the same default cache directory, so the two routes share hits too.
let sharedRasterizer: PptxRasterizer | undefined;
export function getSharedRasterizer(): PptxRasterizer {
  if (!sharedRasterizer) {
    sharedRasterizer = createLibreOfficePptxRasterizer();
  }
  return sharedRasterizer;
}

let sharedBatchRasterizer: PptxBatchRasterizer | undefined;
export function getSharedBatchRasterizer(): PptxBatchRasterizer {
  if (!sharedBatchRasterizer) {
    sharedBatchRasterizer = createLibreOfficePptxBatchRasterizer();
  }
  return sharedBatchRasterizer;
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

// Raster size budget. Slide dimensions are author-controlled inches and the
// schema does not bound them, so an oversized canvas × dpi could demand an
// enormous bitmap; with batching that multiplies by slide count. Budgets are
// estimated up front from the declared slide size (default pptx 16:9 when
// absent) — same philosophy as the /export pixel budget.
const DEFAULT_SLIDE_WIDTH_IN = 13.34;
const DEFAULT_SLIDE_HEIGHT_IN = 7.5;
const MAX_SLIDE_PIXELS = 64_000_000;
const MAX_BATCH_PIXELS = 256_000_000;

function estimateSlidePixels(presentation: unknown, dpi: number): number {
  const props = (presentation as { props?: Record<string, unknown> } | null)
    ?.props;
  const dim = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : fallback;
  const widthIn = dim(props?.slideWidth, DEFAULT_SLIDE_WIDTH_IN);
  const heightIn = dim(props?.slideHeight, DEFAULT_SLIDE_HEIGHT_IN);
  return widthIn * dpi * (heightIn * dpi);
}

function assertPixelBudget(
  slides: Array<{ presentation: unknown; dpi: number }>
): void {
  let total = 0;
  for (const slide of slides) {
    const pixels = estimateSlidePixels(slide.presentation, slide.dpi);
    if (pixels > MAX_SLIDE_PIXELS) {
      throw new HTTPException(400, {
        message: 'Requested slide dimensions are too large',
      });
    }
    total += pixels;
  }
  if (total > MAX_BATCH_PIXELS) {
    throw new HTTPException(400, {
      message: 'Requested batch raster size is too large',
    });
  }
}

/**
 * `baseDir` selects the directory local media paths resolve against. An
 * unrestricted value would let any HTTP caller point the rasterizer at
 * arbitrary server directories and exfiltrate readable files as rendered
 * pixels, so it must stay inside the server's own working tree. Callers
 * rendering documents that live elsewhere should run the server from that
 * tree (or use an in-process rasterizer).
 */
function resolveSafeBaseDir(baseDir: string | undefined): string | undefined {
  if (baseDir === undefined) return undefined;
  const resolved = path.resolve(baseDir);
  const cwd = process.cwd();
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
    throw new HTTPException(400, {
      message: 'baseDir must be inside the server working directory',
    });
  }
  return resolved;
}

/** Map rasterization failures onto stable 400/503/500 responses. */
function toHttpException(error: unknown): HTTPException {
  if (error instanceof HTTPException) return error;
  if (error instanceof UnsafeOutboundSourceError) {
    return new HTTPException(400, { message: error.message });
  }
  const msg =
    error instanceof Error ? error.message.toLowerCase() : String(error);
  if (msg.includes('not found') || msg.includes('rasterization needs')) {
    return new HTTPException(503, { message: (error as Error).message });
  }
  if (msg.includes('invalid') || msg.includes('validation')) {
    return new HTTPException(400, { message: (error as Error).message });
  }
  return new HTTPException(500, {
    message: 'Internal server error during rasterization',
  });
}

export interface RasterizeRouteOptions {
  getRasterizer?: () => PptxRasterizer;
  getBatchRasterizer?: () => PptxBatchRasterizer;
  preMiddleware?: MiddlewareHandler[];
  sourcePolicy?: OutboundSourcePolicy;
  onError?: (error: unknown) => void;
}

/**
 * Register `POST /rasterize` and `POST /rasterize/batch` on a Hono router
 * with body-size limits, content-type + schema validation (dpi clamped to
 * [MIN,MAX]_VISUAL_DPI, batch capped at MAX_RASTERIZE_BATCH_SLIDES), the
 * shared rasterizers, and structured 400/413/503/500 error mapping. Both
 * routes share `preMiddleware` instances (e.g. one rate limiter), so a batch
 * and its per-visual fallback draw from the same budget.
 *
 * @param options.preMiddleware - extra middleware (e.g. a rate limiter) run first.
 */
export function registerRasterizeRoute(
  router: Hono<any>,
  options: RasterizeRouteOptions = {}
): void {
  const getRasterizer = options.getRasterizer ?? getSharedRasterizer;
  const getBatchRasterizer =
    options.getBatchRasterizer ?? getSharedBatchRasterizer;

  const shared: MiddlewareHandler[] = [
    ...(options.preMiddleware ?? []),
    bodyLimit({
      maxSize: 32 * 1024 * 1024,
      onError: () => {
        throw new HTTPException(413, { message: 'Request body too large' });
      },
    }),
    jsonOnly,
  ];

  const guard = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      options.onError?.(error);
      throw toHttpException(error);
    }
  };

  router.post(
    '/rasterize',
    ...shared,
    tbValidator(RasterizeRequestSchema),
    async (c) => {
      const { presentation, dpi, baseDir } = getValidated<{
        presentation: unknown;
        dpi?: number;
        baseDir?: string;
      }>(c, 'json');
      const safeBaseDir = resolveSafeBaseDir(baseDir);

      const effectiveDpi = clampVisualDpi(dpi ?? DEFAULT_VISUAL_DPI);
      assertPixelBudget([{ presentation, dpi: effectiveDpi }]);

      const result = await guard(async () => {
        if (options.sourcePolicy) {
          assertSafeOutboundSources(
            presentation,
            options.sourcePolicy,
            'presentation'
          );
        }
        return getRasterizer()({
          presentation,
          dpi: effectiveDpi,
          baseDir: safeBaseDir,
        });
      });
      return c.json(result);
    }
  );

  router.post(
    '/rasterize/batch',
    ...shared,
    tbValidator(RasterizeBatchRequestSchema),
    async (c) => {
      const { slides, baseDir } = getValidated<{
        slides: Array<{ presentation: unknown; dpi?: number }>;
        baseDir?: string;
      }>(c, 'json');
      const safeBaseDir = resolveSafeBaseDir(baseDir);
      const effectiveSlides = slides.map((slide) => ({
        presentation: slide.presentation,
        dpi: clampVisualDpi(slide.dpi ?? DEFAULT_VISUAL_DPI),
      }));
      assertPixelBudget(effectiveSlides);

      const result = await guard(async () => {
        if (options.sourcePolicy) {
          slides.forEach((slide, index) =>
            assertSafeOutboundSources(
              slide.presentation,
              options.sourcePolicy!,
              `slides[${index}].presentation`
            )
          );
        }
        return getBatchRasterizer()({
          slides: effectiveSlides,
          baseDir: safeBaseDir,
        });
      });

      // Per-slide errors from `build` are caused by the slide's own JSON and
      // are the caller's actionable feedback; `convert`/`rasterize` failures
      // carry raw tool output (host paths, temp dirs), which the single route
      // never exposes — log them, return a generic message (C2 parity with
      // /rasterize's 500 mapping).
      return c.json({
        results: result.results.map((slide) => {
          if (slide.ok) return slide;
          options.onError?.(new Error(slide.error));
          return slide.stage === 'build'
            ? { ok: false as const, error: slide.error }
            : { ok: false as const, error: 'Slide rasterization failed' };
        }),
      });
    }
  );
}
