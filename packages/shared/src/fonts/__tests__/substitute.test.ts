import { describe, it, expect } from 'vitest';
import {
  applyFontSubstitution,
  buildDefaultSubstitutionMap,
  defaultSubstituteFor,
  applyExportMode,
} from '../substitute';
import { collectFontNamesFromDocx } from '../collect';
import { POPULAR_GOOGLE_FONTS } from '../catalog/popular-google';

describe('applyFontSubstitution', () => {
  it('rewrites font.family on runs', () => {
    const doc = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'x',
            font: { family: 'Playfair Display', fontWeight: 500 },
          },
        },
      ],
    };
    const out = applyFontSubstitution(doc, { 'Playfair Display': 'Georgia' });
    expect(out.substitutions).toEqual([
      { from: 'Playfair Display', to: 'Georgia' },
    ]);
    const p = (
      out.doc.children as Array<{ props: { font: { family: string } } }>
    )[0];
    expect(p.props.font.family).toBe('Georgia');
  });

  it('rewrites theme.fonts.heading and theme.fonts.body strings', () => {
    const doc = {
      props: {
        theme: {
          fonts: {
            heading: 'Playfair Display',
            body: 'Inter',
            mono: 'JetBrains Mono',
          },
        },
      },
    };
    const out = applyFontSubstitution(doc, {
      'Playfair Display': 'Georgia',
      Inter: 'Calibri',
      'JetBrains Mono': 'Consolas',
    });
    expect(out.doc.props.theme.fonts).toEqual({
      heading: 'Georgia',
      body: 'Calibri',
      mono: 'Consolas',
    });
    // collectFontNames on output yields only safe fonts.
    const remaining = collectFontNamesFromDocx(out.doc);
    expect([...remaining]).toEqual(
      expect.arrayContaining(['Georgia', 'Calibri', 'Consolas'])
    );
    expect([...remaining]).not.toContain('Playfair Display');
  });

  it('leaves safe fonts untouched', () => {
    const doc = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'paragraph',
          props: { text: 'x', font: { family: 'Arial' } },
        },
      ],
    };
    const out = applyFontSubstitution(doc, { Arial: 'Georgia' });
    expect(out.substitutions).toEqual([]);
    expect(
      (out.doc.children as Array<{ props: { font: { family: string } } }>)[0]
        .props.font.family
    ).toBe('Arial');
  });

  it('leaves unmapped non-safe fonts untouched', () => {
    const doc = {
      name: 'docx',
      props: {},
      children: [
        {
          name: 'paragraph',
          props: { text: 'x', font: { family: 'WildFont' } },
        },
      ],
    };
    const out = applyFontSubstitution(doc, {});
    expect(out.substitutions).toEqual([]);
    expect(
      (out.doc.children as Array<{ props: { font: { family: string } } }>)[0]
        .props.font.family
    ).toBe('WildFont');
  });

  it('is case-insensitive on mapping keys', () => {
    const doc = {
      name: 'docx',
      props: { font: { family: 'inter' } },
      children: [],
    };
    const out = applyFontSubstitution(doc, { Inter: 'Calibri' });
    expect(out.doc.props.font.family).toBe('Calibri');
  });
});

describe('defaultSubstituteFor', () => {
  it('maps Playfair Display → Georgia (explicit + serif category)', () => {
    expect(defaultSubstituteFor('Playfair Display')).toBe('Georgia');
  });
  it('maps Inter → Calibri (explicit)', () => {
    expect(defaultSubstituteFor('Inter')).toBe('Calibri');
  });
  it('maps JetBrains Mono → Consolas (explicit)', () => {
    expect(defaultSubstituteFor('JetBrains Mono')).toBe('Consolas');
  });
  it('falls back to Calibri for unknown fonts', () => {
    expect(defaultSubstituteFor('SomeBrandNewFont')).toBe('Calibri');
  });
  it('returns a non-Calibri fallback for every catalog family', () => {
    // Guards against a silent category/fallback mismatch: if a catalog
    // category string stops matching CATEGORY_FALLBACK keys, serif/mono
    // families would silently resolve to Calibri. Every curated family
    // should map to a category-appropriate safe font, not the default.
    const nonExplicit = POPULAR_GOOGLE_FONTS.filter(
      (f) =>
        f.category === 'serif' ||
        f.category === 'mono' ||
        f.category === 'display'
    );
    for (const f of nonExplicit) {
      const result = defaultSubstituteFor(f.family);
      if (f.category === 'mono') {
        expect(result, `${f.family} (mono)`).toBe('Consolas');
      } else {
        expect(result, `${f.family} (${f.category})`).not.toBe('Calibri');
      }
    }
  });
});

describe('buildDefaultSubstitutionMap', () => {
  it('covers every non-safe reference and omits safe ones', () => {
    const map = buildDefaultSubstitutionMap([
      'Arial',
      'Playfair Display',
      'Inter',
      'Calibri',
    ]);
    expect(Object.keys(map).sort()).toEqual(['Inter', 'Playfair Display']);
    expect(map['Playfair Display']).toBe('Georgia');
    expect(map.Inter).toBe('Calibri');
  });
});

describe('applyExportMode', () => {
  const doc = {
    name: 'docx',
    props: { theme: { fonts: { heading: 'Playfair Display' } } },
    children: [
      {
        name: 'paragraph',
        props: { text: 'x', font: { family: 'Inter', fontWeight: 500 } },
      },
    ],
  };
  const theme = { fonts: { body: 'Inter' } };

  it("mode 'custom' keeps refs and emits one warning", () => {
    const out = applyExportMode({ doc, theme, fonts: { mode: 'custom' } });
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].code).toBe('FONT_MODE_CUSTOM');
    expect(out.doc).toBe(doc);
  });

  it("mode 'substitute' rewrites doc + theme and lists swaps", () => {
    const out = applyExportMode({
      doc,
      theme,
      fonts: { mode: 'substitute' },
    });
    const names = [
      ...collectFontNamesFromDocx(out.doc),
      ...collectFontNamesFromDocx(out.theme),
    ];
    expect(names).not.toContain('Inter');
    expect(names).not.toContain('Playfair Display');
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0].code).toBe('FONT_MODE_SUBSTITUTED');
    expect(out.warnings[0].message).toContain('Inter → Calibri');
    expect(out.warnings[0].message).toContain('Playfair Display → Georgia');
  });

  it("mode 'substitute' honours user overrides", () => {
    const out = applyExportMode({
      doc,
      theme,
      fonts: { mode: 'substitute', substitution: { Inter: 'Verdana' } },
    });
    expect(out.warnings[0].message).toContain('Inter → Verdana');
    // Playfair Display still falls to default Georgia.
    expect(out.warnings[0].message).toContain('Playfair Display → Georgia');
  });
});
