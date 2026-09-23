/**
 * The width model against the cases the calibration corpus cannot pin: the
 * arithmetic of the wrap itself. The corpus (#343) fixes the constants —
 * the per-face advance, the 1.2 line pitch, the bold allowance — and these
 * fix what the wrap does with them.
 */

import { describe, expect, it } from 'vitest';
import {
  defaultLineHeightPt,
  estimateTextHeightPt,
  estimateTextLines,
  fitCharWidthFactor,
} from './textMetrics';

/**
 * A box whose width makes the arithmetic plain: ten characters to a line at
 * 10pt and the default advance, with half a character's slack so the floor
 * does not land on a rounding edge.
 */
const TEN_PER_LINE = 10.5 * 10 * 0.46;

describe('the wrap', () => {
  it('breaks at word boundaries rather than at the margin', () => {
    // Thirty characters, but no line holds more than "alpha beta" at a time.
    expect(estimateTextLines('alpha beta gamma delta', TEN_PER_LINE, 10)).toBe(
      3
    );
  });

  it('counts a word wider than the line only for the lines it breaks onto', () => {
    // Eleven characters where ten fit: two lines, not three.
    expect(estimateTextLines('abcdefghijk', TEN_PER_LINE, 10)).toBe(2);
    expect(estimateTextLines('abcdefghijklmnopqrstu', TEN_PER_LINE, 10)).toBe(
      3
    );
  });

  it('moves a whole word that fits a line of its own, and measures the next word against it', () => {
    // "alpha" fills five, "bravo" cannot follow it, and "cd" then joins it.
    expect(estimateTextLines('alpha bravo cd', TEN_PER_LINE, 10)).toBe(2);
  });

  it('gives an empty paragraph a line, and every newline its own', () => {
    expect(estimateTextLines('', TEN_PER_LINE, 10)).toBe(1);
    expect(estimateTextLines('one\n\ntwo', TEN_PER_LINE, 10)).toBe(3);
  });
});

describe('the height', () => {
  it('counts every line, the first one included', () => {
    const { heightPt, lines } = estimateTextHeightPt(
      'alpha beta gamma delta',
      TEN_PER_LINE,
      10,
      defaultLineHeightPt(10)
    );
    expect(lines).toBe(3);
    expect(heightPt).toBeCloseTo(3 * 12, 5);
  });

  it('takes the same pitch at every size', () => {
    expect(defaultLineHeightPt(11)).toBeCloseTo(13.2, 5);
    expect(defaultLineHeightPt(40)).toBeCloseTo(48, 5);
  });
});

describe('the fit factor', () => {
  it('measures a face by its own advance, an unknown one as a wide face', () => {
    expect(fitCharWidthFactor('Calibri')).toBeLessThan(
      fitCharWidthFactor('DejaVu Sans')
    );
    expect(fitCharWidthFactor('  dejavu sans  ')).toBe(
      fitCharWidthFactor('DejaVu Sans')
    );
    expect(fitCharWidthFactor('Nobody Has Rendered This')).toBeGreaterThan(
      fitCharWidthFactor('Arial')
    );
  });

  it('allows for bold setting wider', () => {
    expect(fitCharWidthFactor('Arial', true)).toBeGreaterThan(
      fitCharWidthFactor('Arial')
    );
  });
});
