import { describe, it, expect } from 'vitest';
import {
  parsePercentageStringToFraction,
  relativeLengthToTwips,
} from '../widthUtils';

describe('parsePercentageStringToFraction', () => {
  it('parses valid percentages', () => {
    expect(parsePercentageStringToFraction('50%')).toBe(0.5);
    expect(parsePercentageStringToFraction('0%')).toBe(0);
    expect(parsePercentageStringToFraction('100%')).toBe(1);
    expect(parsePercentageStringToFraction('33.33%')).toBeCloseTo(0.3333);
  });

  it('returns undefined for out-of-range', () => {
    expect(parsePercentageStringToFraction('150%')).toBeUndefined();
    expect(parsePercentageStringToFraction('-5%')).toBeUndefined();
  });

  it('returns undefined for invalid format', () => {
    expect(parsePercentageStringToFraction('abc')).toBeUndefined();
    expect(parsePercentageStringToFraction('50')).toBeUndefined();
    expect(parsePercentageStringToFraction('%50')).toBeUndefined();
    expect(parsePercentageStringToFraction('')).toBeUndefined();
  });
});

describe('relativeLengthToTwips', () => {
  const availableWidth = 10000; // twips

  it('converts number (points) via pointsToTwips', () => {
    // pointsToTwips multiplies by 20
    expect(relativeLengthToTwips(72, availableWidth)).toBe(1440); // 72 * 20
    expect(relativeLengthToTwips(0, availableWidth)).toBe(0);
  });

  it('converts percentage string to fraction of available width', () => {
    expect(relativeLengthToTwips('50%', availableWidth)).toBe(5000);
    expect(relativeLengthToTwips('100%', availableWidth)).toBe(10000);
    expect(relativeLengthToTwips('25%', availableWidth)).toBe(2500);
  });

  it('returns 0 for malformed string', () => {
    expect(relativeLengthToTwips('bad', availableWidth)).toBe(0);
  });
});
