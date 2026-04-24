import { describe, it, expect } from 'vitest';
import { applyFontWeight } from './fontAliasContext';

describe('applyFontWeight', () => {
  describe('without a family name (bold heuristic only)', () => {
    it('coerces weight ≥600 to bold=true', () => {
      expect(applyFontWeight({ fontWeight: 600 })).toEqual({
        bold: true,
        italic: undefined,
      });
      expect(applyFontWeight({ fontWeight: 900 })).toEqual({
        bold: true,
        italic: undefined,
      });
    });

    it('coerces weight <600 to bold=false', () => {
      expect(applyFontWeight({ fontWeight: 100 })).toEqual({
        bold: false,
        italic: undefined,
      });
      expect(applyFontWeight({ fontWeight: 500 })).toEqual({
        bold: false,
        italic: undefined,
      });
    });

    it('treats bold=true as weight 700 when no fontWeight given', () => {
      expect(applyFontWeight({ bold: true })).toEqual({
        bold: true,
        italic: undefined,
      });
    });
  });

  describe('with a family name (synthesised sub-family)', () => {
    it('RIBBI weights keep the canonical family and native toggles', () => {
      expect(
        applyFontWeight({ family: 'Inter', fontWeight: 400, italic: false })
      ).toEqual({ fontFace: 'Inter', bold: false, italic: false });
      expect(
        applyFontWeight({ family: 'Inter', fontWeight: 700, italic: true })
      ).toEqual({ fontFace: 'Inter', bold: true, italic: true });
    });

    it('non-RIBBI weights rewrite the family and clear toggles', () => {
      expect(
        applyFontWeight({ family: 'Inter', fontWeight: 300, italic: false })
      ).toEqual({ fontFace: 'Inter Light', bold: false, italic: false });
      expect(
        applyFontWeight({ family: 'Inter', fontWeight: 500, italic: true })
      ).toEqual({
        fontFace: 'Inter Medium Italic',
        bold: false,
        italic: false,
      });
    });

    it('bold=true with no explicit weight maps to Bold (RIBBI)', () => {
      expect(
        applyFontWeight({ family: 'Inter', bold: true, italic: false })
      ).toEqual({ fontFace: 'Inter', bold: true, italic: false });
    });
  });
});
