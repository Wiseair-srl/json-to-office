import { describe, expect, it } from 'vitest';
import { normalizeUnicodeText } from '../unicode';

describe('unicode utils', () => {
  it('normalizes decomposed accented characters to NFC', () => {
    const decomposed = 'Cafe\u0301 e\u0301lite';
    const normalized = normalizeUnicodeText(decomposed);

    expect(normalized).toBe('Café élite');
    expect(normalized).toBe(normalized.normalize('NFC'));
  });

  it('returns an empty string for nullish input', () => {
    expect(normalizeUnicodeText(undefined)).toBe('');
    expect(normalizeUnicodeText(null)).toBe('');
  });
});
