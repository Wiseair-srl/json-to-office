/**
 * Service configuration types for external integrations (e.g. Highcharts export server)
 */

// ============================================================================
// Visual rasterization policy — single source of truth for DPI bounds shared
// by the visual schema, the in-process rasterizer, the flatten transform, and
// both HTTP /rasterize surfaces. Keep these in sync in one place.
// ============================================================================

/** Default raster resolution when a `visual` does not specify one. */
export const DEFAULT_VISUAL_DPI = 200;
/** Minimum accepted raster resolution. */
export const MIN_VISUAL_DPI = 36;
/** Maximum accepted raster resolution (bounds bitmap size / DoS surface). */
export const MAX_VISUAL_DPI = 600;

/** Clamp an arbitrary dpi to [MIN_VISUAL_DPI, MAX_VISUAL_DPI]; non-finite → default. */
export function clampVisualDpi(dpi: unknown): number {
  if (typeof dpi !== 'number' || !Number.isFinite(dpi))
    return DEFAULT_VISUAL_DPI;
  return Math.min(MAX_VISUAL_DPI, Math.max(MIN_VISUAL_DPI, Math.round(dpi)));
}

export type HighchartsHeaders = Record<string, string>;

export type HighchartsHeadersResolver = (
  body: unknown
) => HighchartsHeaders | Promise<HighchartsHeaders>;

export interface HighchartsServiceConfig {
  serverUrl?: string;
  headers?: HighchartsHeaders | HighchartsHeadersResolver;
  /**
   * Allow an export server outside this machine and its private networks.
   * A chart is posted whole — every series, label and title — so a remote
   * server is a decision, not a default: without this, generation refuses a
   * public URL; with it, every generation says which URL received the data.
   */
  allowRemote?: boolean;
}

// ============================================================================
// PPTX rasterization service (used by the docx `visual` component)
// ============================================================================

export type PptxServiceHeaders = Record<string, string>;

export type PptxServiceHeadersResolver = (
  body: unknown
) => PptxServiceHeaders | Promise<PptxServiceHeaders>;

/** Max font faces accepted in one rasterize request. */
export const MAX_RASTERIZE_FONTS = 32;
/** Max total DECODED font bytes accepted in one rasterize request. */
export const MAX_RASTERIZE_FONT_BYTES = 8 * 1024 * 1024;

/**
 * One font face shipped alongside a rasterize request so the rasterizer's
 * out-of-process LibreOffice can render the slide with the document's real
 * fonts instead of a system fallback.
 *
 * `data` is base64 of the raw font file — NO `data:` URI prefix — so the
 * request stays plain serializable JSON.
 *
 * `family` is the CATALOG family (`ResolvedFont.family`, e.g. "Inter"), not
 * the synthesized sub-family the presentation references. The receiving
 * stager applies `synthesizeFamilyName` + `rewriteFontFamilyName` itself,
 * exactly as it does for the PDF-preview path; pre-synthesizing here would
 * double-apply the suffix ("Inter Light Light").
 */
export interface RasterizeFontFace {
  family: string;
  weight: number;
  italic: boolean;
  /** Base64-encoded font file bytes (no `data:` prefix). */
  data: string;
  format?: 'ttf' | 'otf' | 'woff' | 'woff2';
}

/**
 * Request handed to a pptx rasterizer: a single-slide pptx presentation
 * component definition plus the target resolution.
 */
export interface PptxRasterizeRequest {
  /** A pptx presentation component definition ({ name: 'pptx', ... }) with one slide */
  presentation: unknown;
  /** Target raster resolution in dots-per-inch */
  dpi: number;
  /**
   * Directory that relative asset paths inside the presentation resolve
   * against — the originating document's own directory. Absent → the
   * rasterizer's cwd, the legacy behavior (#142).
   */
  baseDir?: string;
  /**
   * Font faces to stage for the rasterizer's LibreOffice launch. Absent →
   * system fonts only, which is what every non-font-aware caller (and every
   * pre-Area-6 client) sends.
   */
  fonts?: RasterizeFontFace[];
}

/**
 * Result returned by a pptx rasterizer.
 */
export interface PptxRasterizeResult {
  /** Rendered PNG as a base64 data URI (data:image/png;base64,...) */
  base64DataUri: string;
  /** Natural pixel width of the rendered image */
  width: number;
  /** Natural pixel height of the rendered image */
  height: number;
}

/**
 * In-process rasterizer callback. Implementations build the .pptx from the
 * presentation JSON and rasterize it to a PNG (e.g. via LibreOffice + poppler).
 */
export type PptxRasterizer = (
  request: PptxRasterizeRequest
) => Promise<PptxRasterizeResult>;

// ============================================================================
// Batch rasterization (#153) — one request rasterizes many independent slides.
//
// Each slide is a complete single-slide presentation (the exact shape a
// single {@link PptxRasterizeRequest} carries), NOT a slide fragment of one
// merged deck. This keeps slides independent — each may use its own canvas
// size, theme, and dpi, so callers never need to group visuals — and lets
// implementations key per-slide caches identically to the single-slide path.
// ============================================================================

/**
 * Maximum slides accepted in one batch request. Shared by the HTTP surface
 * (request validation) and clients (chunk size) so the two cannot drift.
 * Bounds per-request work and response size the same way rate limits bound
 * request counts.
 */
export const MAX_RASTERIZE_BATCH_SLIDES = 32;

/** One slide in a batch: a single-slide presentation plus its resolution. */
export interface PptxRasterizeBatchSlide {
  /** A pptx presentation component definition ({ name: 'pptx', ... }) with one slide */
  presentation: unknown;
  /** Target raster resolution in dots-per-inch (absent → service default) */
  dpi?: number;
}

/** Request handed to a batch pptx rasterizer. */
export interface PptxRasterizeBatchRequest {
  /** Slides to rasterize; results come back index-aligned with this array. */
  slides: PptxRasterizeBatchSlide[];
  /** Base directory for relative asset paths, shared by every slide (#142). */
  baseDir?: string;
  /**
   * Font faces staged for the batch's LibreOffice launch, shared by every
   * slide exactly like `baseDir`. Deliberately REQUEST-level and never
   * per-slide: {@link PptxRasterizeBatchSlide} stays `{presentation, dpi}` so
   * batch-internal dedupe and the per-slide disk-cache key stay uniform with
   * the single-slide path.
   */
  fonts?: RasterizeFontFace[];
}

/**
 * Pipeline stage a slide failed in. `build` failures are caused by the
 * slide's own JSON (safe to surface verbatim to callers); `convert` and
 * `rasterize` failures are environment/tooling errors whose raw messages may
 * carry host paths — HTTP surfaces sanitize those.
 */
export type PptxRasterizeFailureStage = 'build' | 'convert' | 'rasterize';

/**
 * Per-slide outcome. A batch response is 200-with-item-errors rather than
 * all-or-nothing: one bad visual must not discard its siblings' pixels.
 */
export type PptxRasterizeBatchSlideResult =
  | ({ ok: true } & PptxRasterizeResult)
  | { ok: false; error: string; stage?: PptxRasterizeFailureStage };

/** Result returned by a batch pptx rasterizer. */
export interface PptxRasterizeBatchResult {
  /** Index-aligned with the request's `slides` (same length, same order). */
  results: PptxRasterizeBatchSlideResult[];
}

/**
 * In-process batch rasterizer callback. Batch-level failures (missing
 * binaries, bad request) throw; per-slide failures land in `results`.
 */
export type PptxBatchRasterizer = (
  request: PptxRasterizeBatchRequest
) => Promise<PptxRasterizeBatchResult>;

/**
 * Configuration for the pptx rasterization service backing `visual` components.
 *
 * Mirrors {@link HighchartsServiceConfig}: the published packages depend on this
 * interface, never on a binary. A host injects either an in-process `render`
 * callback or an HTTP `serverUrl`.
 */
export interface PptxServiceConfig {
  /**
   * In-process rasterizer. Takes precedence over `serverUrl` when provided.
   * Ideal for tests (no binaries) and single-process hosts.
   */
  render?: PptxRasterizer;
  /**
   * In-process batch rasterizer. When provided, the docx renderer coalesces a
   * document's visuals into batch calls (#153) instead of one `render` call
   * per visual. Like `render`, takes precedence over `serverUrl`.
   */
  renderBatch?: PptxBatchRasterizer;
  /**
   * HTTP rasterization service URL. The service receives
   * `{ presentation, dpi }` and returns a {@link PptxRasterizeResult}.
   */
  serverUrl?: string;
  /** Optional headers (or async resolver) for the HTTP service. */
  headers?: PptxServiceHeaders | PptxServiceHeadersResolver;
  /** Default DPI applied when a `visual` does not specify one. */
  dpi?: number;
}

export interface ServicesConfig {
  highcharts?: HighchartsServiceConfig;
  pptx?: PptxServiceConfig;
}
