import { describe, expect, it } from 'vitest';
import { ThemeConfigSchema as DocxThemeConfigSchema } from '@json-to-office/shared-docx';
import { SEMANTIC_COLOR_NAMES, STYLE_NAMES } from '@json-to-office/shared-pptx';
import {
  advancedKeys,
  colorTokens,
  contrastRatio,
  customStyleNames,
  deleteAt,
  definedColorKeys,
  ensureContainers,
  normalizeHex,
  parseTheme,
  resolveColor,
  serializeTheme,
  setAt,
  styleNames,
  twipsToUnit,
  unitToTwips,
} from '../model';

describe('theme model descriptors track the shared schemas', () => {
  it('docx colour tokens are exactly the schema keys, required flags included', () => {
    const tokens = colorTokens('docx');
    const schemaColors = (DocxThemeConfigSchema as any).properties.colors;
    expect(tokens.map((t) => t.key).sort()).toEqual(
      Object.keys(schemaColors.properties).sort()
    );
    const required = new Set<string>(schemaColors.required ?? []);
    for (const token of tokens) {
      expect(token.required).toBe(required.has(token.key));
      expect(token.group).not.toBe('Other');
    }
  });

  it('pptx colour tokens are the semantic names, with the five required ones', () => {
    const tokens = colorTokens('pptx');
    expect(tokens.map((t) => t.key).sort()).toEqual(
      [...SEMANTIC_COLOR_NAMES].sort()
    );
    expect(
      tokens
        .filter((t) => t.required)
        .map((t) => t.key)
        .sort()
    ).toEqual(['accent', 'background', 'primary', 'secondary', 'text']);
  });

  it('style names come from the schemas', () => {
    expect(styleNames('pptx')).toEqual([...STYLE_NAMES]);
    const docx = styleNames('docx');
    expect(docx.slice(0, 3)).toEqual(['normal', 'title', 'subtitle']);
    expect(docx).toContain('heading6');
    expect(docx).toContain('TOC6');
  });
});

describe('theme edits', () => {
  it('round-trips text and applies set/delete without mutating', () => {
    const parsed = parseTheme('{"name":"x","colors":{"primary":"#000000"}}');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const next = setAt(parsed.theme, ['colors', 'accent'], '#FF0000');
    expect(next).not.toBe(parsed.theme);
    expect(parsed.theme.colors).toEqual({ primary: '#000000' });
    expect(JSON.parse(serializeTheme(next)).colors).toEqual({
      primary: '#000000',
      accent: '#FF0000',
    });
    const removed = deleteAt(next, ['colors', 'accent']);
    expect(removed.colors).toEqual({ primary: '#000000' });
    expect(deleteAt(removed, ['colors', 'missing'])).toBe(removed);
    expect(deleteAt(removed, ['nowhere', 'missing'])).toBe(removed);
  });

  it('deletes an array entry only for a real index', () => {
    const theme = { fonts: { registry: ['a', 'b', 'c'] } };
    expect(deleteAt(theme, ['fonts', 'registry', 1])).toEqual({
      fonts: { registry: ['a', 'c'] },
    });
    // `splice` would coerce each of these and delete something: -1 the last
    // entry, NaN and 1.5 an entry near the front.
    for (const key of [-1, Number.NaN, 1.5, 3, '1']) {
      expect(deleteAt(theme, ['fonts', 'registry', key as number])).toBe(theme);
    }
  });

  it('rejects text that is not an object', () => {
    expect(parseTheme('[1]').ok).toBe(false);
    expect(parseTheme('{').ok).toBe(false);
  });

  it('scaffolds only the containers a format needs', () => {
    expect(Object.keys(ensureContainers({ name: 'x' }, 'docx')).sort()).toEqual(
      ['colors', 'fonts', 'name', 'page', 'styles']
    );
    expect(Object.keys(ensureContainers({ name: 'x' }, 'pptx')).sort()).toEqual(
      ['colors', 'defaults', 'fonts', 'name', 'styles']
    );
    const theme = { name: 'x', colors: { primary: '#000000' } };
    expect(ensureContainers(theme, 'docx').colors).toBe(theme.colors);
  });

  it('lists custom docx styles and advanced keys', () => {
    const theme = {
      name: 'x',
      styles: { normal: {}, callout: { bold: true } },
      componentDefaults: { table: {} },
      fontRegistry: [{ id: 'a' }],
      $schema: 'x',
    };
    expect(customStyleNames(theme, 'docx')).toEqual(['callout']);
    expect(advancedKeys(theme, 'docx').map((k) => k.key)).toEqual([
      'componentDefaults',
      'fontRegistry',
      '$schema',
    ]);
  });
});

describe('colours and units', () => {
  it('normalises hex spellings and resolves token references', () => {
    expect(normalizeHex('abc')).toBe('#AABBCC');
    expect(normalizeHex('#abcdef')).toBe('#ABCDEF');
    expect(normalizeHex('primary')).toBe('primary');
    const theme = {
      colors: {
        primary: '#112233',
        accent4: 'primary',
        loop: 'loop',
        bare: 'abcdef',
      },
    };
    expect(definedColorKeys(theme)).toEqual([
      'primary',
      'accent4',
      'loop',
      'bare',
    ]);
    expect(resolveColor(theme, 'accent4')).toBe('#112233');
    expect(resolveColor(theme, 'bare')).toBe('#abcdef');
    expect(resolveColor(theme, 'loop')).toBeNull();
    expect(resolveColor(theme, 'nope')).toBeNull();
  });

  it('computes WCAG contrast', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('nope', '#FFFFFF')).toBeNull();
  });

  it('converts twips both ways', () => {
    expect(twipsToUnit(1440, 'in')).toBe(1);
    expect(twipsToUnit(1440, 'pt')).toBe(72);
    expect(twipsToUnit(1440, 'cm')).toBe(2.54);
    expect(unitToTwips(1, 'in')).toBe(1440);
    expect(unitToTwips(2.54, 'cm')).toBe(1440);
    expect(unitToTwips(720, 'twips')).toBe(720);
  });
});
