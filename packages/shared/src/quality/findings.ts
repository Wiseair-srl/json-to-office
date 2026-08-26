/**
 * Design-quality findings — the layer schema validation deliberately has no
 * opinion on (#216).
 *
 * A schema-valid document can still overflow its boxes, render on the wrong
 * canvas, or crowd forty lines onto one slide. The cores' quality collectors
 * describe those defects here, in the same path-addressed shape validation
 * errors use, so every surface (MCP, CLI, HTTP) can report design problems
 * beside structural ones without inventing its own envelope.
 *
 * Findings never block generation: `warning` means "this almost certainly
 * looks wrong rendered", `info` means "worth a look". The codes are API the
 * same way validation codes are — add freely, rename never.
 */

export type QualityFindingSeverity = 'warning' | 'info';

export interface QualityFinding {
  /** Stable machine code — one of `QUALITY_CODES`. */
  code: QualityCode;
  severity: QualityFindingSeverity;
  message: string;
  /** RFC 6901 JSON Pointer into the document, usable as a patch target. */
  path: string;
  /** What to do about it, in one sentence. */
  suggestion?: string;
  /** Measured values behind the verdict (estimates, thresholds, sums). */
  context?: Record<string, unknown>;
}

/**
 * `W_QUALITY_` prefixed so the codes land in the published `E_`/`W_`
 * vocabulary as-is: a consumer branching on the first two characters already
 * knows none of these ever blocks.
 */
export const QUALITY_CODES = {
  /** PPTX: no `slideWidth`/`slideHeight`; the renderer silently defaults to 4:3. */
  CANVAS_UNSPECIFIED: 'W_QUALITY_CANVAS_UNSPECIFIED',
  /** PPTX: canvas matches no common preset (16:9, 1:1, 4:5, 9:16). */
  CANVAS_NONSTANDARD: 'W_QUALITY_CANVAS_NONSTANDARD',
  /** PPTX: canvas is exactly the 4:3 legacy preset. */
  CANVAS_LEGACY: 'W_QUALITY_CANVAS_LEGACY',
  /** PPTX: estimated text height exceeds the declared box. */
  TEXT_OVERFLOW: 'W_QUALITY_TEXT_OVERFLOW',
  /** PPTX: text fits its box with almost no margin. */
  TEXT_TIGHT: 'W_QUALITY_TEXT_TIGHT',
  /** PPTX: far more body text on one slide than an audience can read. */
  SLIDE_DENSITY: 'W_QUALITY_SLIDE_DENSITY',
  /** PPTX: effective font size below the readable floor for projection. */
  FONT_SIZE_MIN: 'W_QUALITY_FONT_SIZE_MIN',
  /** DOCX: fixed column widths no built-in page setup can contain. */
  TABLE_WIDTH_OVERFLOW: 'W_QUALITY_TABLE_WIDTH_OVERFLOW',
  /** DOCX: heading level jumps down more than one step. */
  HEADING_SKIP: 'W_QUALITY_HEADING_SKIP',
} as const;

export type QualityCode = (typeof QUALITY_CODES)[keyof typeof QUALITY_CODES];
