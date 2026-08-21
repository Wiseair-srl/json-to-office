import { describe, it, expect } from 'vitest';
import { formatNumberForLevel } from '../numberFormatting';

describe('formatNumberForLevel', () => {
  it('renders decimals', () => {
    expect(formatNumberForLevel(1, 'decimal')).toBe('1');
    expect(formatNumberForLevel(42, 'decimal')).toBe('42');
  });

  it('repeats the letter past z, as Word does', () => {
    expect(formatNumberForLevel(1, 'lowerLetter')).toBe('a');
    expect(formatNumberForLevel(26, 'lowerLetter')).toBe('z');
    expect(formatNumberForLevel(27, 'lowerLetter')).toBe('aa');
    expect(formatNumberForLevel(53, 'lowerLetter')).toBe('aaa');
    expect(formatNumberForLevel(28, 'upperLetter')).toBe('BB');
  });

  it('renders roman numerals in both cases', () => {
    const cases: [number, string][] = [
      [1, 'i'],
      [4, 'iv'],
      [9, 'ix'],
      [14, 'xiv'],
      [40, 'xl'],
      [90, 'xc'],
      [400, 'cd'],
      [900, 'cm'],
      [1990, 'mcmxc'],
    ];
    for (const [value, expected] of cases) {
      expect(formatNumberForLevel(value, 'lowerRoman')).toBe(expected);
      expect(formatNumberForLevel(value, 'upperRoman')).toBe(
        expected.toUpperCase()
      );
    }
  });

  it('returns undefined for formats with no unambiguous glyph sequence', () => {
    expect(formatNumberForLevel(1, 'bullet')).toBeUndefined();
    expect(formatNumberForLevel(1, 'none')).toBeUndefined();
    expect(formatNumberForLevel(1, 'chineseCounting')).toBeUndefined();
    expect(formatNumberForLevel(1, undefined)).toBeUndefined();
  });

  it('returns undefined below the first counter value', () => {
    expect(formatNumberForLevel(0, 'decimal')).toBeUndefined();
    expect(formatNumberForLevel(-1, 'lowerLetter')).toBeUndefined();
  });
});
