/**
 * The size policy, stated as numbers rather than as judgement.
 *
 * A preview exists to be looked at, and "looked at" for an agent means the
 * bytes enter a model context. Forty pages at 300 DPI is roughly forty
 * megabytes of PNG and several times that as base64 — a response no client
 * should be asked to hold and no context window can absorb. So the ceiling is
 * declared here, checked twice, and reported in the refusal.
 *
 * Checked twice because each check catches what the other cannot. The estimate
 * runs BEFORE any LibreOffice process starts, so an obviously oversized
 * request is refused in milliseconds instead of after a minute of rendering.
 * The measurement runs after, because a page of dense photography is nothing
 * like a page of body text and only the real bytes settle it.
 */

/** Rendering resolution when the caller does not say. A4 at 150 DPI is ~1754px tall — legible without being wasteful. */
export const PREVIEW_DEFAULT_DPI = 150;
/** Below this, glyphs stop being readable and the preview answers nothing. */
export const PREVIEW_MIN_DPI = 36;
/** Above this the extra pixels buy detail no preview needs; generate the file instead. */
export const PREVIEW_MAX_DPI = 600;

/** Hard cap on pages per call, whatever the output mode. Preview is a look, not an export. */
export const MAX_PREVIEW_PAGES = 50;

/** Most image blocks one result may carry, regardless of how small they are. */
export const MAX_INLINE_IMAGE_PAGES = 10;
/** Ceiling for a single inlined page. */
export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;
/** Ceiling for every inlined page in one result, summed. */
export const MAX_TOTAL_INLINE_BYTES = 8 * 1024 * 1024;

/** A4 (8.27in x 11.69in). A 16:9 slide is 100in², close enough for an estimate. */
export const PREVIEW_PAGE_AREA_IN2 = 96.7;
/**
 * Bytes per pixel used by the pre-flight estimate.
 *
 * Measured PNG density for a text page runs ~0.045 B/px at 300 DPI and ~0.12
 * at 96; an image-heavy page runs several times higher. The constant sits at
 * the pessimistic end on purpose — over-estimating costs a caller a fallback
 * to paths, under-estimating costs them a response their client cannot hold.
 */
export const ESTIMATED_PNG_BYTES_PER_PIXEL = 0.12;

/** How the caller wants pages delivered. */
export type PreviewOutputMode = 'auto' | 'images' | 'path';

/** Which ceiling a payload broke. */
export type BudgetOverrun = 'pageCount' | 'imageBytes' | 'totalBytes';

export interface InlineBudget {
  fits: boolean;
  /** Estimated (pre-render) or measured (post-render) total. */
  bytes: number;
  estimated: boolean;
  pageCount: number;
  exceeded: BudgetOverrun[];
  limits: {
    maxInlineImagePages: number;
    maxInlineImageBytes: number;
    maxTotalInlineBytes: number;
  };
}

const LIMITS = {
  maxInlineImagePages: MAX_INLINE_IMAGE_PAGES,
  maxInlineImageBytes: MAX_INLINE_IMAGE_BYTES,
  maxTotalInlineBytes: MAX_TOTAL_INLINE_BYTES,
} as const;

/** Bytes one rendered page is expected to weigh at `dpi`. */
export function estimatePageBytes(dpi: number): number {
  return Math.round(
    PREVIEW_PAGE_AREA_IN2 * dpi * dpi * ESTIMATED_PNG_BYTES_PER_PIXEL
  );
}

/** Pre-flight verdict, from page count and DPI alone. */
export function estimatedInlineBudget(
  pageCount: number,
  dpi: number
): InlineBudget {
  const perPage = estimatePageBytes(dpi);
  const bytes = perPage * pageCount;
  const exceeded: BudgetOverrun[] = [];
  if (pageCount > MAX_INLINE_IMAGE_PAGES) exceeded.push('pageCount');
  if (perPage > MAX_INLINE_IMAGE_BYTES) exceeded.push('imageBytes');
  if (bytes > MAX_TOTAL_INLINE_BYTES) exceeded.push('totalBytes');
  return {
    fits: exceeded.length === 0,
    bytes,
    estimated: true,
    pageCount,
    exceeded,
    limits: { ...LIMITS },
  };
}

/** Post-render verdict, from the PNGs actually produced. */
export function measuredInlineBudget(
  pageBytes: readonly number[]
): InlineBudget {
  const bytes = pageBytes.reduce((total, size) => total + size, 0);
  const exceeded: BudgetOverrun[] = [];
  if (pageBytes.length > MAX_INLINE_IMAGE_PAGES) exceeded.push('pageCount');
  if (pageBytes.some((size) => size > MAX_INLINE_IMAGE_BYTES)) {
    exceeded.push('imageBytes');
  }
  if (bytes > MAX_TOTAL_INLINE_BYTES) exceeded.push('totalBytes');
  return {
    fits: exceeded.length === 0,
    bytes,
    estimated: false,
    pageCount: pageBytes.length,
    exceeded,
    limits: { ...LIMITS },
  };
}

/** One sentence naming every ceiling the payload broke, with the numbers. */
export function describeBudget(budget: InlineBudget): string {
  const size = budget.estimated
    ? `about ${formatBytes(budget.bytes)} (estimated)`
    : formatBytes(budget.bytes);
  const clauses = budget.exceeded.map((overrun) => {
    switch (overrun) {
      case 'pageCount':
        return `${budget.pageCount} pages exceeds the ${budget.limits.maxInlineImagePages}-image limit`;
      case 'imageBytes':
        return `a page exceeds the ${formatBytes(budget.limits.maxInlineImageBytes)} per-image limit`;
      case 'totalBytes':
        return `${size} exceeds the ${formatBytes(budget.limits.maxTotalInlineBytes)} total limit`;
    }
  });
  return `Inline images would be ${size} across ${budget.pageCount} page${
    budget.pageCount === 1 ? '' : 's'
  }: ${clauses.join('; ')}.`;
}

/** What to tell an agent that asked for more than it can be given. */
export function budgetSuggestion(dpi: number): string {
  const affordable = Math.max(
    1,
    Math.min(
      MAX_INLINE_IMAGE_PAGES,
      Math.floor(MAX_TOTAL_INLINE_BYTES / estimatePageBytes(dpi))
    )
  );
  return `Use outputMode "path" to have every page written to disk instead, or ask for at most ${affordable} page${
    affordable === 1 ? '' : 's'
  } at ${dpi} DPI, or lower the DPI.`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
