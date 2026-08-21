/**
 * Render a list counter the way Word renders it, for the cached value of a
 * cross-reference field.
 *
 * Only the formats whose glyph sequence is unambiguous are supported. Anything
 * else (bullets, CJK counting, `none`, an unknown string) returns undefined —
 * the caller then emits a field with no cached value rather than guessing a
 * number Word would disagree with on refresh.
 */

const ROMAN_NUMERALS: readonly (readonly [number, string])[] = [
  [1000, 'm'],
  [900, 'cm'],
  [500, 'd'],
  [400, 'cd'],
  [100, 'c'],
  [90, 'xc'],
  [50, 'l'],
  [40, 'xl'],
  [10, 'x'],
  [9, 'ix'],
  [5, 'v'],
  [4, 'iv'],
  [1, 'i'],
];

function toRoman(value: number): string {
  let remaining = value;
  let out = '';
  for (const [amount, glyph] of ROMAN_NUMERALS) {
    while (remaining >= amount) {
      out += glyph;
      remaining -= amount;
    }
  }
  return out;
}

/**
 * Word's letter sequence repeats the glyph rather than carrying: a, …, z, aa,
 * bb, …, zz, aaa. (`27` is "aa", not "ab".)
 */
function toLetters(value: number): string {
  const index = (value - 1) % 26;
  const repeats = Math.floor((value - 1) / 26) + 1;
  return String.fromCharCode(97 + index).repeat(repeats);
}

export function formatNumberForLevel(
  value: number,
  format?: string
): string | undefined {
  if (!Number.isFinite(value) || value < 1) return undefined;
  const n = Math.floor(value);

  switch (format) {
    case 'decimal':
      return String(n);
    case 'lowerLetter':
      return toLetters(n);
    case 'upperLetter':
      return toLetters(n).toUpperCase();
    case 'lowerRoman':
      return toRoman(n);
    case 'upperRoman':
      return toRoman(n).toUpperCase();
    default:
      return undefined;
  }
}
