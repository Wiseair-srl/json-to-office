/**
 * Diagnostic codes only `jto_preview` can raise.
 *
 * They live beside the tool rather than in `lib/errors.ts` because they
 * describe this pipeline's vocabulary — a page selection, an inline budget, a
 * LibreOffice stage — and nothing else in the server can produce them. The
 * shared codes (`E_DEPENDENCY_MISSING`, `E_CANCELLED`, `E_INTERNAL`) still come
 * from `ERROR_CODES`; these extend that set rather than fork it.
 *
 * Same contract as `ERROR_CODES`: agents branch on them, so add freely, rename
 * never.
 */
export const PREVIEW_ERROR_CODES = {
  /** `pages` is malformed, or selects pages the document does not have. */
  INVALID_PAGE_SPEC: 'E_INVALID_PAGE_SPEC',
  /** Inline images were demanded for a payload over the client-safe budget. */
  TOO_LARGE: 'E_PREVIEW_TOO_LARGE',
  /** A render stage (build, convert, rasterize) failed on this document. */
  RENDER_FAILED: 'E_PREVIEW_RENDER_FAILED',
  /** The PDF produced no readable page count — nothing to select from. */
  PAGE_COUNT_UNAVAILABLE: 'E_PREVIEW_PAGE_COUNT_UNAVAILABLE',
} as const;

export type PreviewErrorCode =
  (typeof PREVIEW_ERROR_CODES)[keyof typeof PREVIEW_ERROR_CODES];

/** Where a preview run failed, reported alongside `E_PREVIEW_RENDER_FAILED`. */
export type PreviewStage = 'build' | 'convert' | 'rasterize';
