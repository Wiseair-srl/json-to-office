import { describe, it, expect } from 'vitest';
import { userFontEntries } from '../generator.js';

describe('userFontEntries', () => {
  const inter = {
    family: 'Inter',
    weight: 400,
    italic: false,
    format: 'ttf' as const,
    data: 'AAAA',
  };
  const interBold = {
    family: 'Inter',
    weight: 700,
    italic: false,
    format: 'ttf' as const,
    data: 'BBBB',
  };
  const branded = {
    family: 'BrandPro',
    weight: 400,
    italic: false,
    format: 'otf' as const,
    data: 'CCCC',
  };

  it('returns empty when no uploads are provided', () => {
    const out = userFontEntries(undefined, new Set(['Inter']));
    expect(out).toEqual([]);
  });

  it('emits one entry per referenced family with a kind:"data" source', () => {
    const out = userFontEntries([inter], new Set(['Inter']));
    expect(out).toHaveLength(1);
    expect(out[0].family).toBe('Inter');
    expect(out[0].sources).toHaveLength(1);
    expect(out[0].sources[0]).toMatchObject({
      kind: 'data',
      weight: 400,
      italic: false,
    });
    // Data URL packs the base64 back onto the payload.
    expect((out[0].sources[0] as any).data).toBe('data:font/ttf;base64,AAAA');
  });

  it('skips families the doc never references', () => {
    const out = userFontEntries([inter, branded], new Set(['Inter']));
    expect(out).toHaveLength(1);
    expect(out[0].family).toBe('Inter');
  });

  it('coalesces multiple variants of the same family into one entry', () => {
    const out = userFontEntries([inter, interBold], new Set(['Inter']));
    expect(out).toHaveLength(1);
    expect(out[0].sources).toHaveLength(2);
    const weights = out[0].sources.map((s) => (s as any).weight).sort();
    expect(weights).toEqual([400, 700]);
  });

  it('matches family references case-insensitively', () => {
    const out = userFontEntries([inter], new Set(['inter']));
    expect(out).toHaveLength(1);
  });
});
