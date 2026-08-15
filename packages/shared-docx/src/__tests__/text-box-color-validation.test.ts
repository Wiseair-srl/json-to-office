/**
 * Regression: text-box colours are consumed by resolveColor(), which accepts
 * "#RRGGBB" or a theme colour name and THROWS on anything else. `style.shading.fill`
 * used to be a bare Type.String(), so malformed colours passed validation and
 * blew up mid-render. It now shares HexColorSchema with the border colours.
 *
 * HexColorSchema's theme-colour-name branch (`[a-zA-Z][a-zA-Z0-9]*`) also matches
 * letter-leading bare hex such as "F0FDF4". Rather than enumerate theme colour
 * names in HexColorSchema (repo-wide, and it would reject values the table-cell
 * and chart paths already accept), resolveColor now resolves bare 6-digit hex —
 * so that shape validates and renders instead of validating and throwing.
 */

import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { TextBoxPropsSchema } from '../schemas/components/text-box';

const check = (props: unknown) => Value.Check(TextBoxPropsSchema, props);

describe('text-box colour validation', () => {
  describe('style.shading.fill', () => {
    it('accepts #RRGGBB hex', () => {
      expect(check({ style: { shading: { fill: '#F0FDF4' } } })).toBe(true);
    });

    it('accepts a theme colour name', () => {
      expect(check({ style: { shading: { fill: 'primary' } } })).toBe(true);
      expect(
        check({ style: { shading: { fill: 'backgroundSecondary' } } })
      ).toBe(true);
    });

    it('rejects values resolveColor would throw on', () => {
      // digit-leading bare hex
      expect(check({ style: { shading: { fill: '0F0FDF' } } })).toBe(false);
      // shorthand hex
      expect(check({ style: { shading: { fill: '#F0F' } } })).toBe(false);
      // non-hex digits
      expect(check({ style: { shading: { fill: '#GGGGGG' } } })).toBe(false);
      // CSS colour functions and multi-word names
      expect(
        check({ style: { shading: { fill: 'rgb(240, 253, 244)' } } })
      ).toBe(false);
      expect(check({ style: { shading: { fill: 'light green' } } })).toBe(
        false
      );
      expect(check({ style: { shading: { fill: '' } } })).toBe(false);
    });
  });

  describe('style.border.*.color', () => {
    const border = (color: string) => ({
      style: { border: { top: { style: 'solid', width: 1, color } } },
    });

    it('accepts #RRGGBB hex and theme colour names', () => {
      expect(check(border('#F0FDF4'))).toBe(true);
      expect(check(border('borderPrimary'))).toBe(true);
    });

    it('rejects values resolveColor would throw on', () => {
      expect(check(border('0F0FDF'))).toBe(false);
      expect(check(border('#F0F'))).toBe(false);
      expect(check(border('rgb(0,0,0)'))).toBe(false);
    });
  });
});
