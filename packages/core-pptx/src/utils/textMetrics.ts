/**
 * The width model: how many lines a run of text takes in a box.
 *
 * One estimator, shared by the quality rules (`pptx/text-fit`,
 * `pptx/action-title`) and the engine's bounded `fit` operation, so a title
 * the rules call two lines is the title the engine sizes for two lines.
 * Character-count based, and calibrated against rendered ground truth — see
 * the note on `DEFAULT_CHAR_WIDTH_FACTOR` in `quality/rules.ts`. Real text
 * metrics (#211) replace it in one place when they land.
 */

/** Average glyph advance as a fraction of the font size. */
export const DEFAULT_CHAR_WIDTH_FACTOR = 0.46;

export function defaultLineHeightPt(fontSize: number): number {
  if (fontSize >= 60) return fontSize * 1.05;
  if (fontSize >= 28) return fontSize * 1.15;
  return fontSize * 1.25;
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
    const measured = paragraph.trimEnd();
    lines +=
      measured === ''
        ? 1
        : Math.max(1, Math.ceil(measured.length / charsPerLine));
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
  let heightPt = fontSizePt + Math.max(0, lines - 1) * lineSpacingPt;
  if (paragraphs > 1) {
    heightPt += (paragraphs - 1) * (paraSpaceBeforePt + paraSpaceAfterPt);
  }
  return { heightPt, lines };
}
