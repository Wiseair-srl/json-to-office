/**
 * `font.size` accepts display type, not just body copy.
 *
 * OOXML stores font size in `w:sz` as half-points (`ST_HpsMeasure`), which has
 * no 72pt ceiling — Word's own UI goes to 1638pt. An earlier 72pt cap rejected
 * legitimate display sizes (cover numerals, chapter headings, pull quotes) that
 * Word renders correctly and that this library emits without clamping.
 *
 * `TextFormattingPropertiesSchema` is spread into three places, so all three
 * must accept the same range:
 *   - `FontDefinitionSchema`      (font.ts)  — component `props.font`
 *   - `StylePropertiesSchema`     (theme.ts) — `theme.styles.*`
 *   - `TocStylePropertiesSchema`  (theme.ts) — `theme.styles.TOC1..6`
 */
import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import type { TSchema } from '@sinclair/typebox';
import { FontDefinitionSchema } from '../schemas/font';
import { StyleDefinitionsSchema } from '../schemas/theme';

/**
 * Errors reported against `size` anywhere in the value. Scoped to the size path
 * so a fixture missing unrelated required fields can't mask (or fake) a result.
 */
function sizeErrors(schema: TSchema, value: unknown): string[] {
  return [...Value.Errors(schema, value)]
    .filter((e) => e.path.endsWith('/size'))
    .map((e) => `${e.path}: ${e.message}`);
}

const DISPLAY_SIZE = 163; // the PSCL report's chapter numeral

describe('font.size range', () => {
  describe('accepts display type above the old 72pt cap', () => {
    it('on a component font (FontDefinitionSchema)', () => {
      expect(
        sizeErrors(FontDefinitionSchema, {
          family: 'Arial',
          size: DISPLAY_SIZE,
        })
      ).toEqual([]);
    });

    it('on a theme style (StylePropertiesSchema)', () => {
      expect(
        sizeErrors(StyleDefinitionsSchema, {
          heading1: { font: 'heading', size: DISPLAY_SIZE },
        })
      ).toEqual([]);
    });

    it('on a TOC style (TocStylePropertiesSchema)', () => {
      expect(
        sizeErrors(StyleDefinitionsSchema, {
          TOC1: { font: 'body', size: DISPLAY_SIZE },
        })
      ).toEqual([]);
    });
  });

  describe('bounds', () => {
    it('accepts the format maximum of 1638pt', () => {
      expect(
        sizeErrors(FontDefinitionSchema, { family: 'Arial', size: 1638 })
      ).toEqual([]);
    });

    it('still rejects a size beyond what Word accepts', () => {
      expect(
        sizeErrors(FontDefinitionSchema, { family: 'Arial', size: 1639 })
      ).not.toEqual([]);
    });

    it('still rejects an implausibly small size', () => {
      expect(
        sizeErrors(FontDefinitionSchema, { family: 'Arial', size: 0 })
      ).not.toEqual([]);
    });
  });
});
