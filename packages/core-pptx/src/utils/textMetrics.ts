/**
 * The width model: how many lines a run of text takes in a box.
 *
 * One estimator, shared by the quality rules (`pptx/text-fit`,
 * `pptx/action-title`) and the engine's bounded `fit` operation, so a title
 * the rules call two lines is the title the engine sizes for two lines.
 * Character-count based, and calibrated against rendered ground truth — see
 * the note on `DEFAULT_CHAR_WIDTH_FACTOR` in `quality/rules.ts`. Real text
 * metrics (#211) replace it in one place when they land.
 *
 * Text wraps at word boundaries, which is where the character-count model
 * used to go wrong: dividing the character count by the characters a line
 * holds assumes the last word on each line is cut at the margin, so it
 * under-counts the ragged edge — by a line, sometimes three, and worst where
 * a line holds fewest words, which is exactly a deck's display sizes. Against
 * 420 rendered measurements (#343, `evals-out/fit-calibration`) the character
 * model at 0.46 under-estimated 18.6% of boxes and the greedy word wrap 5.2%,
 * with no under-estimate worse than one line. A long word still breaks, as
 * the renderers break it.
 */

/** Average glyph advance as a fraction of the font size. */
export const DEFAULT_CHAR_WIDTH_FACTOR = 0.46;

/**
 * What the engine's bounded `fit` measures by when nothing names a face. The
 * rules' factor is the highest that keeps known-good templates unflagged, so
 * it sits at the optimistic end of the measured advances; a size the engine
 * *chooses* has to hold nearer the pessimistic end, since nothing downstream
 * catches a size that spills. Where a face is known, the table below is more
 * exact than this.
 */
export const FIT_CHAR_WIDTH_FACTOR = 0.48;

/**
 * Per face, because faces differ by more than any single value can absorb:
 * the measured p50 advance runs from 0.414 (Times New Roman) to 0.528
 * (Verdana), so a factor that holds DejaVu over-shrinks Calibri by a size or
 * two and one that suits Calibri lets DejaVu spill. Each value is the lowest
 * that leaves at most one or two of that face's 140 measurements
 * under-estimated, and never by more than a line
 * (`evals-out/fit-calibration-faces`: 1,680 rendered boxes over twelve faces,
 * seven sizes, five widths and four lengths). Arial and Helvetica stop at
 * 0.49 rather than the 0.50 that clears their last case: at 0.50 a 26-word
 * action title that LibreOffice sets on two lines at 22pt is called three,
 * and the engine refuses text that fits rather than shrinking it.
 */
const FIT_CHAR_WIDTH_FACTORS: Readonly<Record<string, number>> = {
  archivo: 0.48,
  arial: 0.49,
  calibri: 0.47,
  'dejavu sans': 0.56,
  georgia: 0.51,
  helvetica: 0.49,
  inter: 0.52,
  montserrat: 0.58,
  'playfair display': 0.52,
  'space grotesk': 0.55,
  'times new roman': 0.45,
  verdana: 0.58,
};

/**
 * An unmeasured face is measured as a wide one: 0.55 covers every face in the
 * corpus but the two widest, so the engine picks a size that holds rather
 * than one that spills on a face nobody here has rendered.
 */
const UNKNOWN_FACE_FACTOR = 0.55;

/**
 * Bold sets wider, by nothing at all in a face drawn for it (Space Grotesk
 * 1.00, Calibri 1.01) and by a seventh in one that thickens its stems
 * (Georgia 1.15, Verdana 1.15, DejaVu 1.14); the median of the twelve faces
 * is 1.07. Titles are the bold text on a slide and the text most likely to
 * be near its bounds, so the model takes the upper half of that spread.
 */
const BOLD_WIDTH_MULTIPLIER = 1.1;

/** The advance to size a named or unmeasured face by, for the fit engine. */
export function fitCharWidthFactor(fontFace?: string, bold = false): number {
  const base = fontFace
    ? FIT_CHAR_WIDTH_FACTORS[fontFace.trim().toLowerCase()] ??
      UNKNOWN_FACE_FACTOR
    : FIT_CHAR_WIDTH_FACTOR;
  return bold ? base * BOLD_WIDTH_MULTIPLIER : base;
}

/**
 * The pitch from one baseline to the next when nothing declares spacing.
 * Measured on the same corpus: 1.20 × the size at 11, 14, 18, 24, 28, 32 and
 * 40pt alike, with no spread worth a tier (p50 and p90 both 1.20). The old
 * tiering — 1.25 under 28pt, 1.15 above, 1.05 over 60 — had display sizes
 * set tighter than the renderer sets them, which is the half of the spill
 * the width model does not explain.
 */
export function defaultLineHeightPt(fontSize: number): number {
  return fontSize * 1.2;
}

/** Lines the text wraps to in `boxWidthPt` at `fontSizePt`; never below 1. */
export function estimateTextLines(
  text: string,
  boxWidthPt: number,
  fontSizePt: number,
  charWidthFactor = DEFAULT_CHAR_WIDTH_FACTOR
): number {
  const charsPerLine = Math.max(
    1,
    Math.floor(boxWidthPt / (fontSizePt * charWidthFactor))
  );
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    lines += wrappedLines(paragraph.trim(), charsPerLine);
  }
  return lines;
}

/** Greedy wrap: a word moves to the next line whole unless it is itself too long. */
function wrappedLines(paragraph: string, charsPerLine: number): number {
  if (paragraph === '') return 1;
  let lines = 1;
  let used = 0;
  for (const word of paragraph.split(/\s+/)) {
    if (word === '') continue;
    const needed = used === 0 ? word.length : used + 1 + word.length;
    if (needed <= charsPerLine) {
      used = needed;
      continue;
    }
    // A word wider than the box breaks across lines wherever it must; what
    // is left of it on the last line is what the next word measures against.
    lines += Math.max(1, Math.ceil(word.length / charsPerLine));
    used = word.length % charsPerLine || charsPerLine;
  }
  return lines;
}

export interface TextHeightEstimate {
  heightPt: number;
  lines: number;
}

export function estimateTextHeightPt(
  text: string,
  boxWidthPt: number,
  fontSizePt: number,
  lineSpacingPt: number,
  paraSpaceBeforePt = 0,
  paraSpaceAfterPt = 0,
  charWidthFactor = DEFAULT_CHAR_WIDTH_FACTOR
): TextHeightEstimate {
  const lines = estimateTextLines(
    text,
    boxWidthPt,
    fontSizePt,
    charWidthFactor
  );
  const paragraphs = text.split('\n').length;
  // Every line takes a line box, the first one included: text set on four
  // lines fills four pitches, not three plus a glyph. Measured ink height
  // came to 1.00 × lines × pitch across the corpus (p90 1.004), while the
  // old `size + (lines - 1) × pitch` fell short of the ink in 217 of 217
  // multi-line samples — a whole leading of optimism on every box.
  let heightPt = lines * lineSpacingPt;
  if (paragraphs > 1) {
    heightPt += (paragraphs - 1) * (paraSpaceBeforePt + paraSpaceAfterPt);
  }
  return { heightPt, lines };
}
