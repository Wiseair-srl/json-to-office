import { describe, it, expect } from 'vitest';
import {
  extractFontRegistries,
  synthesizedFamilyNames,
  facesFromRegistryEntry,
  googleFamiliesFor,
  buildGoogleCss2Href,
  parseGoogleCss,
  renderFontFaceCss,
  collectReferencedWeights,
  buildPreviewFontAssets,
  type PreviewFontFace,
} from '../preview-fonts';
import type { FontRegistryEntry } from '@json-to-office/shared';

const dataEntry = (weight = 400): FontRegistryEntry => ({
  id: 'brand',
  family: 'Brand Sans',
  sources: [{ kind: 'data', data: 'AAAA', weight }],
});

describe('extractFontRegistries', () => {
  it('reads props.fontRegistry from the document text', () => {
    const json = JSON.stringify({ props: { fontRegistry: [dataEntry()] } });
    expect(extractFontRegistries(json, undefined)).toHaveLength(1);
  });

  it('reads fontRegistry from custom themes', () => {
    const themes = { branded: { fontRegistry: [dataEntry()] } };
    expect(extractFontRegistries(undefined, themes)).toHaveLength(1);
  });

  it('lets the document win over a theme on the same family', () => {
    const json = JSON.stringify({
      props: {
        fontRegistry: [
          {
            id: 'brand',
            family: 'Brand Sans',
            sources: [{ kind: 'data', data: 'DOC' }],
          },
        ],
      },
    });
    const themes = {
      t: {
        fontRegistry: [
          {
            id: 'brand',
            family: 'Brand Sans',
            sources: [{ kind: 'data', data: 'THEME' }],
          },
        ],
      },
    };
    const out = extractFontRegistries(json, themes);
    expect(out).toHaveLength(1);
    expect((out[0].sources[0] as { data: string }).data).toBe('DOC');
  });

  it('returns empty for a mid-edit document that is not valid JSON', () => {
    expect(extractFontRegistries('{ "props": ', undefined)).toEqual([]);
  });

  it('returns empty when there is no registry at all', () => {
    expect(extractFontRegistries('{"props":{}}', {})).toEqual([]);
  });
});

describe('synthesizedFamilyNames', () => {
  it('keeps 400 and 700 on the canonical family (RIBBI)', () => {
    expect(synthesizedFamilyNames('Inter', 400, false)).toEqual([
      { family: 'Inter', cssWeight: 400, cssStyle: 'normal' },
    ]);
    expect(synthesizedFamilyNames('Inter', 700, false)).toEqual([
      { family: 'Inter', cssWeight: 700, cssStyle: 'normal' },
    ]);
  });

  it('adds a synthetic sub-family at 400/normal for other canonical weights', () => {
    // This is the whole point: core-docx emits "Inter Light" with no bold
    // toggle, and docx-preview only ever asks for bold|normal.
    expect(synthesizedFamilyNames('Inter', 300, false)).toEqual([
      { family: 'Inter', cssWeight: 300, cssStyle: 'normal' },
      { family: 'Inter Light', cssWeight: 400, cssStyle: 'normal' },
    ]);
  });

  it('folds italic into the synthetic name', () => {
    expect(synthesizedFamilyNames('Inter', 600, true)).toEqual([
      { family: 'Inter', cssWeight: 600, cssStyle: 'italic' },
      { family: 'Inter SemiBold Italic', cssWeight: 400, cssStyle: 'normal' },
    ]);
  });

  it('emits no synthetic name for a non-canonical weight', () => {
    // 450 has no WEIGHT_LABELS entry, so core falls back to the bold-only
    // heuristic and never produces a sub-family name.
    expect(synthesizedFamilyNames('Inter', 450, false)).toEqual([
      { family: 'Inter', cssWeight: 450, cssStyle: 'normal' },
    ]);
  });
});

describe('facesFromRegistryEntry', () => {
  it('wraps bare base64 as a data URL', () => {
    const [face] = facesFromRegistryEntry(dataEntry());
    expect(face.src).toBe('url("data:font/ttf;base64,AAAA")');
  });

  it('passes a data: URL through verbatim', () => {
    const [face] = facesFromRegistryEntry({
      id: 'b',
      family: 'B',
      sources: [{ kind: 'data', data: 'data:font/otf;base64,ZZZZ' }],
    });
    expect(face.src).toBe('url("data:font/otf;base64,ZZZZ")');
  });

  it('skips safe, file, and google sources', () => {
    expect(
      facesFromRegistryEntry({
        id: 'x',
        family: 'X',
        sources: [
          { kind: 'safe', family: 'Arial' },
          { kind: 'file', path: './x.ttf' },
          { kind: 'google', family: 'Inter' },
        ],
      })
    ).toEqual([]);
  });

  it('drops a url source outside the host allowlist', () => {
    expect(
      facesFromRegistryEntry({
        id: 'evil',
        family: 'Evil',
        sources: [{ kind: 'url', url: 'https://evil.example.com/f.ttf' }],
      })
    ).toEqual([]);
  });

  it('keeps an allowlisted url source', () => {
    const faces = facesFromRegistryEntry({
      id: 'ok',
      family: 'Ok',
      sources: [{ kind: 'url', url: 'https://cdn.jsdelivr.net/f.ttf' }],
    });
    expect(faces).toHaveLength(1);
    expect(faces[0].src).toContain('cdn.jsdelivr.net');
  });

  it('marks variable sources so synthetic rules can pin the axis', () => {
    const faces = facesFromRegistryEntry({
      id: 'v',
      family: 'V',
      sources: [
        {
          kind: 'variable',
          url: 'https://cdn.jsdelivr.net/v.ttf',
          weight: 300,
        },
      ],
    });
    expect(faces[0].variable).toBe(true);
  });
});

describe('googleFamiliesFor', () => {
  it('matches catalog families case-insensitively and skips safe fonts', () => {
    const out = googleFamiliesFor(
      new Set(['inter', 'Arial', 'Not A Real Font']),
      [],
      new Set()
    );
    expect(out.map((g) => g.family)).toEqual(['Inter']);
  });

  it('does not emit a Google family already backed by registry bytes', () => {
    const out = googleFamiliesFor(
      new Set(['Inter']),
      [{ id: 'i', family: 'Inter', sources: [{ kind: 'data', data: 'AA' }] }],
      new Set()
    );
    expect(out).toEqual([]);
  });

  it('narrows weights to those the document references, plus 400/700', () => {
    const out = googleFamiliesFor(new Set(['Inter']), [], new Set([300]));
    expect(out[0].weights).toContain(300);
    expect(out[0].weights).toContain(400);
    expect(out[0].weights).not.toContain(500);
  });
});

describe('buildGoogleCss2Href', () => {
  it('sorts weights ascending (the API 400s otherwise)', () => {
    expect(buildGoogleCss2Href('Inter', [700, 300, 400], false)).toBe(
      'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;700&display=swap'
    );
  });

  it('groups ital tuples roman-then-italic', () => {
    expect(buildGoogleCss2Href('Inter', [400, 700], true)).toContain(
      'ital,wght@0,400;0,700;1,400;1,700'
    );
  });

  it('encodes spaces in the family name', () => {
    expect(buildGoogleCss2Href('Space Grotesk', [400], false)).toContain(
      'family=Space%20Grotesk'
    );
  });
});

describe('parseGoogleCss', () => {
  const CSS = `
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 300;
  src: url(https://fonts.gstatic.com/s/inter/v1/a.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
@font-face {
  font-family: 'Inter';
  font-style: italic;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/inter/v1/b.woff2) format('woff2');
}`;

  it('extracts weight, style, src and unicode-range per block', () => {
    const faces = parseGoogleCss(CSS, 'Inter');
    expect(faces).toHaveLength(2);
    expect(faces[0]).toMatchObject({
      family: 'Inter',
      weight: 300,
      italic: false,
      unicodeRange: 'U+0000-00FF',
    });
    expect(faces[1]).toMatchObject({ weight: 700, italic: true });
  });

  it('ignores blocks without a src', () => {
    expect(parseGoogleCss('/* just a comment */', 'Inter')).toEqual([]);
  });
});

describe('renderFontFaceCss', () => {
  const face: PreviewFontFace = {
    family: 'Inter',
    weight: 300,
    italic: false,
    src: 'url("https://fonts.gstatic.com/a.woff2")',
  };

  it('emits both the canonical and synthetic rules', () => {
    const css = renderFontFaceCss([face]);
    expect(css).toContain('font-family:"Inter";');
    expect(css).toContain('font-weight:300;');
    expect(css).toContain('font-family:"Inter Light";');
    // The synthetic name must be plain 400 or docx-preview will not select it.
    expect(css).toMatch(/font-family:"Inter Light";[^}]*font-weight:400;/);
  });

  it('pins the wght axis only on the synthetic rule of a variable font', () => {
    const css = renderFontFaceCss([{ ...face, variable: true }]);
    const [canonical, synthetic] = css.split('\n');
    expect(canonical).not.toContain('font-variation-settings');
    expect(synthetic).toContain('font-variation-settings:"wght" 300;');
  });

  it('de-dupes identical rules', () => {
    const css = renderFontFaceCss([face, { ...face }]);
    expect(css.split('@font-face').length - 1).toBe(2); // canonical + synthetic
  });

  it('carries unicode-range through', () => {
    const css = renderFontFaceCss([{ ...face, unicodeRange: 'U+0-FF' }]);
    expect(css).toContain('unicode-range:U+0-FF;');
  });

  it('escapes quotes in a family name', () => {
    const css = renderFontFaceCss([{ ...face, family: 'He said "hi"' }]);
    expect(css).toContain('\\"hi\\"');
  });

  it('drops rules past the byte budget instead of inflating srcdoc', () => {
    const css = renderFontFaceCss([face], 10);
    expect(css).toBe('');
  });
});

describe('collectReferencedWeights', () => {
  it('finds numeric fontWeight at any depth', () => {
    expect(
      collectReferencedWeights({
        children: [
          { props: { font: { fontWeight: 300 } } },
          { props: { font: { fontWeight: 600 } } },
          { props: { font: { fontWeight: 'bold' } } },
        ],
      })
    ).toEqual(new Set([300, 600]));
  });
});

describe('buildPreviewFontAssets', () => {
  it('emits registry faces without touching the network', async () => {
    const json = JSON.stringify({
      name: 'docx',
      props: { fontRegistry: [dataEntry(300)] },
      children: [{ props: { font: { family: 'Brand Sans' } } }],
    });
    const failFetch = (() => {
      throw new Error('should not fetch');
    }) as unknown as typeof fetch;

    const { css, googleHrefs } = await buildPreviewFontAssets(
      json,
      {},
      {
        fetchImpl: failFetch,
      }
    );
    expect(css).toContain('font-family:"Brand Sans";');
    expect(css).toContain('font-family:"Brand Sans Light";');
    expect(googleHrefs).toEqual([]);
  });

  it('falls back to a stylesheet link when the Google fetch fails', async () => {
    const json = JSON.stringify({
      name: 'docx',
      props: {},
      children: [{ props: { font: { family: 'Inter' } } }],
    });
    const failFetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;

    const { googleHrefs } = await buildPreviewFontAssets(
      json,
      {},
      {
        fetchImpl: failFetch,
      }
    );
    expect(googleHrefs).toHaveLength(1);
    expect(googleHrefs[0]).toContain('family=Inter');
  });

  it('rewrites fetched Google CSS under synthetic names', async () => {
    const json = JSON.stringify({
      name: 'docx',
      props: {},
      children: [{ props: { font: { family: 'Inter', fontWeight: 300 } } }],
    });
    const okFetch = (async () => ({
      ok: true,
      status: 200,
      text: async () =>
        "@font-face{font-family:'Inter';font-style:normal;font-weight:300;src:url(https://fonts.gstatic.com/a.woff2) format('woff2');}",
    })) as unknown as typeof fetch;

    const { css, googleHrefs } = await buildPreviewFontAssets(
      json,
      {},
      {
        fetchImpl: okFetch,
      }
    );
    expect(googleHrefs).toEqual([]);
    expect(css).toContain('font-family:"Inter Light";');
  });

  it('returns empty assets for an unparseable document', async () => {
    const { css, googleHrefs } = await buildPreviewFontAssets('{oops', {});
    expect(css).toBe('');
    expect(googleHrefs).toEqual([]);
  });
});
