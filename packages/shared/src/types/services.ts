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
}

// ============================================================================
// PPTX rasterization service (used by the docx `visual` component)
// ============================================================================

export type PptxServiceHeaders = Record<string, string>;

export type PptxServiceHeadersResolver = (
  body: unknown
) => PptxServiceHeaders | Promise<PptxServiceHeaders>;

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
