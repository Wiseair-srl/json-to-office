import { describe, expect, it } from 'vitest';
import { familyRendered, parsePdfFonts } from './pdf-fonts';

// Captured verbatim from `pdffonts` (poppler 26.07) over LibreOffice output.
const CAPTURED = `name                                 type              encoding         emb sub uni object ID
------------------------------------ ----------------- ---------------- --- --- --- ---------
BAAAAA+DMSans-Regular                TrueType          WinAnsi          yes yes yes   3150  0
CAAAAA+DMSansLight-Regular           TrueType          WinAnsi          yes yes yes   3140  0
DAAAAA+OpenSymbol                    TrueType          WinAnsi          yes yes yes    953  0
Helvetica                            Type 1            WinAnsi          no  no  no      12  0
`;

describe('parsePdfFonts', () => {
  it('reads every row, stripping the subset tag into baseName', () => {
    const fonts = parsePdfFonts(CAPTURED);
    expect(fonts.map((f) => f.baseName)).toEqual([
      'DMSans-Regular',
      'DMSansLight-Regular',
      'OpenSymbol',
      'Helvetica',
    ]);
    expect(fonts[0]).toEqual({
      name: 'BAAAAA+DMSans-Regular',
      baseName: 'DMSans-Regular',
      type: 'TrueType',
      embedded: true,
    });
    expect(fonts[3].embedded).toBe(false);
    expect(fonts[3].type).toBe('Type 1');
  });

  it('returns nothing for an empty or header-only listing', () => {
    expect(parsePdfFonts('')).toEqual([]);
    expect(parsePdfFonts(CAPTURED.split('\n').slice(0, 2).join('\n'))).toEqual(
      []
    );
  });
});

describe('familyRendered', () => {
  const fonts = parsePdfFonts(CAPTURED);

  it('matches a family against its styled PDF faces, spaces folded', () => {
    expect(familyRendered('DM Sans', fonts)).toBe(true);
    expect(familyRendered('dm-sans', fonts)).toBe(true);
  });

  it('reports a family that never reached the PDF', () => {
    expect(familyRendered('Inter', fonts)).toBe(false);
    expect(familyRendered('Space Grotesk', fonts)).toBe(false);
  });

  it('never blames an empty family name', () => {
    expect(familyRendered('', fonts)).toBe(true);
  });
});
