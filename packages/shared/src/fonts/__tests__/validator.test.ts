import { describe, it, expect } from 'vitest';
import { validateFontReferences } from '../validator';
import { SAFE_FONTS, isSafeFont } from '../../schemas/font-catalog';

describe('isSafeFont', () => {
  it('accepts every SAFE_FONTS entry', () => {
    for (const f of SAFE_FONTS) expect(isSafeFont(f)).toBe(true);
  });
  it('is case-insensitive', () => {
    expect(isSafeFont('arial')).toBe(true);
    expect(isSafeFont('TIMES NEW ROMAN')).toBe(true);
  });
  it('rejects unknown names', () => {
    expect(isSafeFont('Inter')).toBe(false);
    expect(isSafeFont('Roboto')).toBe(false);
  });
});

describe('validateFontReferences', () => {
  it('resolves safe fonts without warnings', () => {
    const r = validateFontReferences({
      referencedNames: ['Arial', 'Georgia', 'Courier New'],
    });
    expect(r.unresolved).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.resolved).toEqual(['Arial', 'Georgia', 'Courier New']);
  });

  it('resolves fonts registered via registeredEntries', () => {
    const r = validateFontReferences({
      referencedNames: ['Inter'],
      registeredEntries: [
        {
          id: 'Inter',
          family: 'Inter',
          sources: [{ kind: 'google', family: 'Inter' }],
        },
      ],
    });
    expect(r.unresolved).toEqual([]);
    expect(r.warnings).toEqual([]);
  });

  it('multiple registered entries all resolve', () => {
    const r = validateFontReferences({
      referencedNames: ['BrandPro', 'Inter'],
      registeredEntries: [
        {
          id: 'BrandPro',
          family: 'BrandPro',
          sources: [{ kind: 'file', path: './Brand.ttf' }],
        },
        {
          id: 'Inter',
          family: 'Inter',
          sources: [{ kind: 'google', family: 'Inter' }],
        },
      ],
    });
    expect(r.unresolved).toEqual([]);
  });

  it('flags unregistered non-safe fonts as unresolved', () => {
    const r = validateFontReferences({
      referencedNames: ['Inter', 'NotARealFont'],
    });
    expect(r.unresolved).toEqual(['Inter', 'NotARealFont']);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings[0].code).toBe('FONT_UNRESOLVED');
    expect(r.warnings[0].family).toBe('Inter');
  });

  it('registry lookup is case-insensitive on family and id', () => {
    const r = validateFontReferences({
      referencedNames: ['INTER'],
      registeredEntries: [
        {
          id: 'inter',
          family: 'Inter',
          sources: [{ kind: 'google', family: 'Inter' }],
        },
      ],
    });
    expect(r.unresolved).toEqual([]);
  });
});
