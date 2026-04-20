import { describe, it, expect } from 'vitest';
import { scanFontLenses } from '../font-lens-scan';

describe('scanFontLenses', () => {
  it('finds a nested family string inside a font object', () => {
    const text = '{"props":{"font":{"family":"Inter"}}}';
    const lenses = scanFontLenses(text);
    expect(lenses).toHaveLength(1);
    expect(lenses[0].path).toEqual(['props', 'font', 'family']);
    expect(lenses[0].value).toBe('Inter');
    expect(text.slice(lenses[0].valueStart, lenses[0].valueEnd)).toBe(
      '"Inter"'
    );
  });

  it('finds theme.fonts.heading and theme.fonts.body', () => {
    const text = `{
      "fonts": { "heading": "Inter", "body": "Roboto" },
      "colors": { "primary": "#000" }
    }`;
    const lenses = scanFontLenses(text);
    const paths = lenses.map((l) => l.path);
    expect(paths).toContainEqual(['fonts', 'heading']);
    expect(paths).toContainEqual(['fonts', 'body']);
    expect(paths).toHaveLength(2);
  });

  it('does not lens heading/body outside a fonts parent', () => {
    // e.g. theme.styles.heading — not a font.
    const text = '{"styles":{"heading":{"color":"#000"}}}';
    expect(scanFontLenses(text)).toHaveLength(0);
  });

  it('scans through arrays using numeric indices', () => {
    const text = `{
      "slides": [
        { "components": [ { "props": { "font": { "family": "Inter" } } } ] }
      ]
    }`;
    const lenses = scanFontLenses(text);
    expect(lenses).toHaveLength(1);
    expect(lenses[0].path).toEqual([
      'slides',
      0,
      'components',
      0,
      'props',
      'font',
      'family',
    ]);
  });

  it('picks up PPTX chart *FontFace keys', () => {
    const text = `{"titleFontFace":"Inter","legendFontFace":"Roboto","dataLabelFontFace":"Arial"}`;
    const lenses = scanFontLenses(text);
    expect(lenses.map((l) => l.path[0])).toEqual([
      'titleFontFace',
      'legendFontFace',
      'dataLabelFontFace',
    ]);
  });

  it('picks up fontFace anywhere', () => {
    const text = '{"a":{"b":{"fontFace":"Arial"}}}';
    const lenses = scanFontLenses(text);
    expect(lenses).toHaveLength(1);
    expect(lenses[0].path).toEqual(['a', 'b', 'fontFace']);
  });

  it('skips non-string values on targeted keys', () => {
    // e.g. someone set "family" to a number by mistake — no lens.
    const text = '{"font":{"family":123}}';
    expect(scanFontLenses(text)).toHaveLength(0);
  });

  it('returns accurate start/end offsets for value quotes', () => {
    const text = '{"family":"Roboto Condensed"}';
    const [lens] = scanFontLenses(text);
    expect(text.slice(lens.valueStart, lens.valueEnd)).toBe(
      '"Roboto Condensed"'
    );
  });

  it('handles multiple siblings in the same object', () => {
    const text = `{
      "font": { "family": "Inter" },
      "altFont": { "family": "Roboto" }
    }`;
    const lenses = scanFontLenses(text);
    expect(lenses).toHaveLength(2);
    expect(lenses[0].value).toBe('Inter');
    expect(lenses[1].value).toBe('Roboto');
  });
});
