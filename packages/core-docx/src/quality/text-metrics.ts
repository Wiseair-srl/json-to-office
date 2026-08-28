/**
 * A width model for authored runs, used only to answer "does this text fit".
 *
 * A single characters-per-point factor cannot do this job. Measured against the
 * shipped display headings (`pdftotext -bbox`), the implied factor ran 0.435
 * for mixed-case words and 0.694 for all-caps — a 39% spread that no single
 * constant survives, because caps and lowercase are simply different widths.
 *
 * These are the standard Helvetica advance widths in 1/1000 em. The grotesque
 * sans faces the stock templates use (DM Sans, Inter, Geist, Archivo) track
 * them closely enough that summing real characters lands within about 8% of the
 * rendered width, and it under-estimates more often than it over-estimates —
 * the safe direction for a rule that only speaks up on overflow.
 *
 * Validated against rendered geometry at authoring time:
 *
 *   "Vision,"      80pt  model 179.2pt  actual 182.7pt  −1.9%
 *   "Financial"    80pt  model 241.8pt  actual 246.8pt  −2.0%
 *   "Global"      107pt  model 251.6pt  actual 264.4pt  −4.8%
 *   "Performance"  80pt  model 362.2pt  actual 383.0pt  −5.4%
 *   "OUR"          76pt  model 168.9pt  actual 158.2pt  +6.8%
 */

const DEFAULT_ADVANCE = 556;

const ADVANCE: Readonly<Record<string, number>> = {
  ' ': 278,
  A: 667,
  B: 667,
  C: 722,
  D: 722,
  E: 667,
  F: 611,
  G: 778,
  H: 722,
  I: 278,
  J: 500,
  K: 667,
  L: 556,
  M: 833,
  N: 722,
  O: 778,
  P: 667,
  Q: 778,
  R: 722,
  S: 667,
  T: 611,
  U: 722,
  V: 667,
  W: 944,
  X: 667,
  Y: 667,
  Z: 611,
  a: 556,
  b: 556,
  c: 500,
  d: 556,
  e: 556,
  f: 278,
  g: 556,
  h: 556,
  i: 222,
  j: 222,
  k: 500,
  l: 222,
  m: 833,
  n: 556,
  o: 556,
  p: 556,
  q: 556,
  r: 333,
  s: 500,
  t: 278,
  u: 556,
  v: 500,
  w: 722,
  x: 500,
  y: 500,
  z: 500,
  '.': 278,
  ',': 278,
  ':': 278,
  ';': 278,
  '!': 278,
  '?': 556,
  "'": 191,
  '"': 355,
  '-': 333,
  '–': 556,
  '—': 1000,
  '&': 667,
  '%': 889,
  '(': 333,
  ')': 333,
  '/': 278,
  '@': 1015,
  '#': 556,
  '+': 584,
  '=': 584,
};

/**
 * Width of `text` in points at `fontSizePt`, with `trackingPt` of signed
 * letter-spacing applied per character (negative when the run is condensed).
 */
export function estimateTextWidthPt(
  text: string,
  fontSizePt: number,
  trackingPt = 0
): number {
  let units = 0;
  for (const character of text) {
    units += ADVANCE[character] ?? DEFAULT_ADVANCE;
  }
  const width = (units / 1000) * fontSizePt + text.length * trackingPt;
  return Math.max(0, width);
}

/**
 * Lines `text` needs when wrapped at `widthPt`, breaking on spaces. A word
 * wider than the line gets its own line here; the renderer would break it
 * mid-word, which `docx/text-fit` reports separately.
 */
export function estimateWrappedLines(
  text: string,
  widthPt: number,
  fontSizePt: number,
  trackingPt = 0
): number {
  if (widthPt <= 0) return 1;
  let lines = 0;
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines += 1;
      continue;
    }
    let current = '';
    let used = 0;
    for (const word of words) {
      const candidate = current === '' ? word : `${current} ${word}`;
      if (estimateTextWidthPt(candidate, fontSizePt, trackingPt) <= widthPt) {
        current = candidate;
      } else {
        if (current !== '') used += 1;
        current = word;
      }
    }
    lines += used + (current === '' ? 0 : 1);
  }
  return Math.max(1, lines);
}
