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
  MAX_RASTERIZE_FONTS,
  MAX_RASTERIZE_FONT_BYTES,
  type PptxRasterizer,
  type PptxBatchRasterizer,
  type RasterizeFontFace,
} from '@json-to-office/shared';
import {
  createLibreOfficePptxRasterizer,
  createLibreOfficePptxBatchRasterizer,
} from '@json-to-office/jto-cli';
import { config } from './config/index.js';
import { tbValidator, getValidated } from './lib/typebox-validator.js';
import {
  assertSafeOutboundSources,
  type OutboundSourcePolicy,
  UnsafeOutboundSourceError,
} from './security/outbound-source-policy.js';

/**
 * Strict standard-alphabet base64: whole quadruplets with correct padding,
 * nothing else. `Buffer.from(s, 'base64')` is lenient — it silently skips
 * whitespace, newlines, invalid characters, and everything up to (and
 * including) a `data:image/...;base64,` prefix — so an unconstrained string
 * decodes to garbage that gets written to disk and handed to LibreOffice.
 * Rejecting at the boundary turns that into a 400.
 *
 * Linear-time by construction: one unambiguous fixed-width repetition
 * followed by a fixed-width optional tail, so there is no backtracking
 * blowup on a multi-megabyte string.
 */
const BASE64_PATTERN =
  '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$';

/**
 * One font face the caller wants staged for this render's LibreOffice
 * launch. `data` is base64 of the raw font file (no `data:` prefix).
 */
const RasterizeFontFaceSchema = Type.Object(
  {
    family: Type.String({ minLength: 1, maxLength: 128 }),
    weight: Type.Integer({ minimum: 1, maximum: 1000 }),
    italic: Type.Boolean(),
    data: Type.String({
      minLength: 1,
      maxLength: 4 * 1024 * 1024,
      pattern: BASE64_PATTERN,
    }),
    format: Type.Optional(
      Type.Union([
        Type.Literal('ttf'),
        Type.Literal('otf'),
        Type.Literal('woff'),
        Type.Literal('woff2'),
      ])
    ),
  },
  { additionalProperties: false }
);
const FontsSchema = Type.Optional(
  Type.Array(RasterizeFontFaceSchema, { maxItems: MAX_RASTERIZE_FONTS })
);

/** Body for POST /rasterize: a single-slide pptx presentation + optional dpi. */
export const RasterizeRequestSchema = Type.Object(
  {
    presentation: Type.Object({}, { additionalProperties: true }),
    dpi: Type.Optional(
      Type.Number({ minimum: MIN_VISUAL_DPI, maximum: MAX_VISUAL_DPI })
    ),
    baseDir: Type.Optional(Type.String()),
    fonts: FontsSchema,
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
    // Request-level, shared by every slide, exactly like `baseDir`. NOT
    // inside the per-slide object above, whose `additionalProperties: false`
    // must keep rejecting per-slide fonts: a uniform slide shape is what
    // lets batch dedupe and the disk-cache key stay identical to the
    // single-slide path.
    fonts: FontsSchema,
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
 * Bound the decoded font payload. The per-face `maxLength` and
 * `MAX_RASTERIZE_FONTS` alone would admit far more than the body limit
 * allows, and staging writes every face to disk before soffice starts.
 */
function assertFontBudget(fonts: RasterizeFontFace[] | undefined): void {
  if (!fonts?.length) return;
  // base64 → bytes ≈ len × 3/4. A cheap upper bound; no decode needed.
  const bytes = fonts.reduce(
    (sum, f) => sum + Math.ceil(f.data.length * 0.75),
    0
  );
  if (bytes > MAX_RASTERIZE_FONT_BYTES) {
    throw new HTTPException(400, {
      message: 'Requested font payload is too large',
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

/**
 * Hard ceiling for the rasterize body limit, whatever an operator configures.
 * The schema's own worst case (MAX_RASTERIZE_FONTS × 4 MiB of base64 = 128
 * MiB) must never be reachable, and a body this large is already far past the
 * MAX_RASTERIZE_FONT_BYTES working budget.
 */
const MAX_RASTERIZE_BODY_CEILING = 64 * 1024 * 1024;

/**
 * Resolve the rasterize body limit. Precedence, most specific first:
 *
 *   1. an explicit `options.maxBodyBytes` from the mounting server,
 *   2. `MAX_RASTERIZE_BODY_SIZE` — the route's own operator knob, also read
 *      by the standalone render server for its outer limit,
 *   3. `config.requestLimits.maxBodySize` (`MAX_REQUEST_BODY_SIZE`), the
 *      process-wide configured ceiling,
 *
 * clamped to {@link MAX_RASTERIZE_BODY_CEILING}. Previously this was a
 * hardcoded 32 MiB, which silently discarded any configured value above it.
 * Resolved lazily (at route registration) so dotenv has certainly run.
 */
export function resolveMaxBodyBytes(explicit?: number): number {
  const fromEnv = Number.parseInt(
    process.env.MAX_RASTERIZE_BODY_SIZE ?? '',
    10
  );
  const configured =
    explicit ??
    (Number.isFinite(fromEnv) && fromEnv > 0
      ? fromEnv
      : config.requestLimits.maxBodySize);
  return Math.min(configured, MAX_RASTERIZE_BODY_CEILING);
}

export interface RasterizeRouteOptions {
  getRasterizer?: () => PptxRasterizer;
  getBatchRasterizer?: () => PptxBatchRasterizer;
  preMiddleware?: MiddlewareHandler[];
  sourcePolicy?: OutboundSourcePolicy;
  onError?: (error: unknown) => void;
  /**
   * Body-size limit for both rasterize routes. Defaults to the configured
   * server limit (see {@link resolveMaxBodyBytes}); always clamped to
   * {@link MAX_RASTERIZE_BODY_CEILING}.
   */
  maxBodyBytes?: number;
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
 * @param options.maxBodyBytes - body-size limit; defaults to the configured
 *   server limit rather than a hardcoded one (see {@link resolveMaxBodyBytes}).
 */
export function registerRasterizeRoute(
  router: Hono<any>,
  options: RasterizeRouteOptions = {}
): void {
  const getRasterizer = options.getRasterizer ?? getSharedRasterizer;
  const getBatchRasterizer =
    options.getBatchRasterizer ?? getSharedBatchRasterizer;

  // The body now also carries base64 font faces. The schema alone would admit
  // MAX_RASTERIZE_FONTS × 4 MiB = 128 MiB; this limit is what actually bounds
  // it, and it rejects with 413 BEFORE parsing, which is the order we want.
  // MAX_RASTERIZE_FONT_BYTES (8 MiB decoded ≈ 10.7 MiB base64) is the
  // intended working ceiling for fonts within that budget.
  const maxBodyBytes = resolveMaxBodyBytes(options.maxBodyBytes);

  const shared: MiddlewareHandler[] = [
    ...(options.preMiddleware ?? []),
    bodyLimit({
      maxSize: maxBodyBytes,
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
      const { presentation, dpi, baseDir, fonts } = getValidated<{
        presentation: unknown;
        dpi?: number;
        baseDir?: string;
        fonts?: RasterizeFontFace[];
      }>(c, 'json');
      const safeBaseDir = resolveSafeBaseDir(baseDir);

      const effectiveDpi = clampVisualDpi(dpi ?? DEFAULT_VISUAL_DPI);
      assertPixelBudget([{ presentation, dpi: effectiveDpi }]);
      assertFontBudget(fonts);

      const result = await guard(async () => {
        if (options.sourcePolicy) {
          // Scoped to `presentation` only. Font faces are inert base64 with
          // no URL-shaped keys, and walking multi-MB strings per request
          // would be pure cost.
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
          // Conditional so a fontless request reaches the engine with no
          // `fonts` key at all — an `undefined` would still be an absent
          // digest, but keeping the object identical to the pre-change shape
          // makes the cache-key equivalence obvious.
          ...(fonts?.length && { fonts }),
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
      const { slides, baseDir, fonts } = getValidated<{
        slides: Array<{ presentation: unknown; dpi?: number }>;
        baseDir?: string;
        fonts?: RasterizeFontFace[];
      }>(c, 'json');
      const safeBaseDir = resolveSafeBaseDir(baseDir);
      const effectiveSlides = slides.map((slide) => ({
        presentation: slide.presentation,
        dpi: clampVisualDpi(slide.dpi ?? DEFAULT_VISUAL_DPI),
      }));
      assertPixelBudget(effectiveSlides);
      assertFontBudget(fonts);

      const result = await guard(async () => {
        if (options.sourcePolicy) {
          // Scoped to each slide's `presentation` only — see /rasterize.
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
          ...(fonts?.length && { fonts }),
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
            ? { ok: false as const, error: slide.error, stage: slide.stage }
            : {
                ok: false as const,
                error: 'Slide rasterization failed',
                stage: slide.stage,
              };
        }),
      });
    }
  );
}
