import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from '@json-to-office/quality';
import { preparePptxQualityDocument } from './facts';
import { analyzePptxQuality } from './preflight';

const CANVAS = { slideWidth: 13.333, slideHeight: 7.5 };

function deck(props: Record<string, unknown>, slides: unknown[]) {
  return { name: 'pptx', props, children: slides };
}

function pptxDiagnostics(input: unknown) {
  return analyzePptxQuality(input).diagnostics;
}

function codes(doc: unknown): string[] {
  return pptxDiagnostics(doc).map((finding) => finding.code);
}

describe('canvas', () => {
  it('warns when no canvas is declared — the renderer falls back to 4:3', () => {
    const findings = pptxDiagnostics(deck({ title: 'No canvas' }, []));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.CANVAS_UNSPECIFIED,
      severity: 'warning',
      path: '/props',
    });
  });

  it('names the missing dimension on a partial canvas', () => {
    expect(pptxDiagnostics(deck({ slideWidth: 13.333 }, []))[0]).toMatchObject({
      message: expect.stringContaining('props.slideHeight missing'),
      context: { missing: ['props.slideHeight'] },
    });
    expect(pptxDiagnostics(deck({ slideHeight: 7.5 }, []))[0]).toMatchObject({
      message: expect.stringContaining('props.slideWidth missing'),
      context: { missing: ['props.slideWidth'] },
    });
  });

  it('accepts every common preset silently', () => {
    for (const [w, h] of [
      [13.333, 7.5],
      [10, 5.625],
      [7.5, 7.5],
      [7.5, 9.375],
      [4.5, 8],
    ]) {
      expect(codes(deck({ slideWidth: w, slideHeight: h }, []))).toEqual([]);
    }
  });

  it('flags 4:3 legacy and unknown sizes as info, not warning', () => {
    const legacy = pptxDiagnostics(
      deck({ slideWidth: 10, slideHeight: 7.5 }, [])
    );
    expect(legacy[0]).toMatchObject({
      code: QUALITY_CODES.CANVAS_LEGACY,
      severity: 'info',
    });

    const odd = pptxDiagnostics(deck({ slideWidth: 9, slideHeight: 5 }, []));
    expect(odd[0]).toMatchObject({
      code: QUALITY_CODES.CANVAS_NONSTANDARD,
      severity: 'info',
    });
  });
});

describe('text overflow', () => {
  it('flags text that cannot fit its declared box, with the measurements', () => {
    const findings = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: {
                text: 'word '.repeat(80).trim(),
                fontSize: 18,
                x: 1,
                y: 1,
                w: 2,
                h: 1,
              },
            },
          ],
        },
      ])
    );
    const overflow = findings.find(
      (finding) => finding.code === QUALITY_CODES.TEXT_OVERFLOW
    );
    expect(overflow).toMatchObject({
      severity: 'warning',
      path: '/children/0/children/0',
    });
    expect(overflow?.context).toMatchObject({ availablePt: 72 });
    expect(overflow?.context?.estimatedTextPt as number).toBeGreaterThan(72);

    // 400 chars in a 144×72pt box: no readable size fits, so no fix — the
    // text or the box has to change, and that stays the author's call.
    expect(overflow?.fixes).toBeUndefined();
  });

  it('attaches a fontSize fix when a readable size fits the box', () => {
    const findings = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: {
                text: 'word '.repeat(24).trim(),
                fontSize: 30,
                x: 1,
                y: 1,
                w: 4,
                h: 1.4,
              },
            },
          ],
        },
      ])
    );
    const overflow = findings.find(
      (finding) => finding.code === QUALITY_CODES.TEXT_OVERFLOW
    );
    expect(overflow).toBeDefined();
    const fix = overflow?.fixes?.[0];
    expect(fix).toMatchObject({
      op: 'add',
      path: '/children/0/children/0/props/fontSize',
    });
    const value = fix?.value as number;
    expect(value).toBeLessThan(30);
    expect(value).toBeGreaterThanOrEqual(7);
  });

  it('offers a fix for a fixed-height grid box', () => {
    const findings = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: {
                text: 'word '.repeat(24).trim(),
                fontSize: 30,
                grid: { column: 0, row: 0, columnSpan: 4, rowSpan: 2 },
              },
            },
          ],
        },
      ])
    );
    const overflow = findings.find(
      (finding) => finding.code === QUALITY_CODES.TEXT_OVERFLOW
    );
    expect(overflow).toBeDefined();
    expect(overflow?.fixes?.[0]).toMatchObject({
      path: '/children/0/children/0/props/fontSize',
    });
  });

  it('does not diagnose an auto-growing box with no height source', () => {
    const findings = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: {
                text: 'word '.repeat(120).trim(),
                fontSize: 18,
                x: 1,
                y: 1,
                w: 3,
              },
            },
          ],
        },
      ])
    );
    expect(
      findings.find((finding) => finding.code === QUALITY_CODES.TEXT_OVERFLOW)
    ).toBeUndefined();
  });

  it('does not offer a fix below the active profile or policy font floor', () => {
    const input = deck(CANVAS, [
      {
        name: 'slide',
        children: [
          {
            name: 'text',
            props: {
              text: 'word '.repeat(28).trim(),
              fontSize: 30,
              x: 1,
              y: 1,
              w: 4,
              h: 1.4,
            },
          },
        ],
      },
    ]);
    const analyses = [
      analyzePptxQuality(input, {
        profile: { id: 'executive-presentation', formats: ['pptx'] },
      }),
      analyzePptxQuality(input, {
        policy: {
          rules: {
            'pptx/minimum-font-size': {
              parameters: { minimumFontPt: 14 },
            },
          },
        },
      }),
    ];
    for (const analysis of analyses) {
      const overflow = analysis.diagnostics.find(
        (finding) => finding.code === QUALITY_CODES.TEXT_OVERFLOW
      );
      expect(overflow).toBeDefined();
      expect(overflow?.fixes).toBeUndefined();
    }
  });

  it('records effective alignment and rotation for rendered measurements', () => {
    const prepared = preparePptxQualityDocument(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: {
                text: 'Rotated middle text',
                x: 1,
                y: 1,
                w: 3,
                h: 1,
                valign: 'middle',
                rotate: 300,
              },
            },
          ],
        },
      ]) as any
    );
    const fact = prepared.facts.find((entry) => entry.kind === 'pptx/text');
    expect(fact).toMatchObject({
      verticalAlign: 'middle',
      rotationDeg: 300,
      autoFit: false,
    });
  });

  it('resolves style-table font sizes: styled text overflows a box its default size would fit', () => {
    // `title` is 36pt in every built-in theme. The same text at the 18pt
    // theme default fits this box; resolved through the style table it wraps
    // and overflows by more than a full line.
    const props = {
      text: 'A quarterly business review title that wraps across several lines',
      x: 1,
      y: 1,
      w: 4,
      h: 1.2,
    };
    const styled = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [{ name: 'text', props: { ...props, style: 'title' } }],
        },
      ])
    );
    expect(styled.map((finding) => finding.code)).toContain(
      QUALITY_CODES.TEXT_OVERFLOW
    );

    const unstyled = pptxDiagnostics(
      deck(CANVAS, [{ name: 'slide', children: [{ name: 'text', props }] }])
    );
    expect(
      unstyled.filter((finding) => finding.code === QUALITY_CODES.TEXT_OVERFLOW)
    ).toEqual([]);
  });

  it('reports a fragile fit as TEXT_TIGHT info', () => {
    const findings = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              // One 18pt line in a 22pt box: fits, with 4pt to spare.
              props: { text: 'Hello', fontSize: 18, x: 1, y: 1, w: 5, h: 0.31 },
            },
          ],
        },
      ])
    );
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.TEXT_TIGHT,
      severity: 'info',
    });
  });

  it('resolves grid-positioned boxes through the renderer grid math', () => {
    const findings = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: {
                text: 'word '.repeat(120).trim(),
                fontSize: 18,
                grid: { column: 0, row: 0, columnSpan: 3, rowSpan: 1 },
              },
            },
          ],
        },
      ])
    );
    expect(findings.map((finding) => finding.code)).toContain(
      QUALITY_CODES.TEXT_OVERFLOW
    );
  });

  it('skips runs-based text and boxless text rather than guessing', () => {
    const findings = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: {
                text: 'irrelevant',
                runs: [{ text: 'a'.repeat(500) }],
                x: 1,
                y: 1,
                w: 1,
                h: 0.2,
              },
            },
            {
              name: 'text',
              props: { text: 'no box declared, renderer autosizes' },
            },
          ],
        },
      ])
    );
    expect(
      findings.filter((finding) => finding.code === QUALITY_CODES.TEXT_OVERFLOW)
    ).toEqual([]);
  });
});

describe('legibility', () => {
  it('warns on an overcrowded slide, pointing at the slide', () => {
    const findings = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [
            { name: 'text', props: { text: 'word '.repeat(140).trim() } },
          ],
        },
      ])
    );
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.SLIDE_DENSITY,
      severity: 'warning',
      path: '/children/0',
    });
  });

  it('does not count title and subtitle toward density', () => {
    const findings = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: { text: 'word '.repeat(140).trim(), style: 'title' },
            },
          ],
        },
      ])
    );
    expect(findings).toEqual([]);
  });

  it('warns on an unreadable font size', () => {
    const findings = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          children: [{ name: 'text', props: { text: 'tiny', fontSize: 6 } }],
        },
      ])
    );
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.FONT_SIZE_MIN,
      severity: 'warning',
      path: '/children/0/children/0/props',
      fixes: [
        { op: 'add', path: '/children/0/children/0/props/fontSize', value: 7 },
      ],
    });
  });
});

describe('renderer normalization parity', () => {
  it('ignores disabled slides and disabled component subtrees', () => {
    const findings = pptxDiagnostics(
      deck(CANVAS, [
        {
          name: 'slide',
          enabled: false,
          children: [{ name: 'text', props: { text: 'tiny', fontSize: 5 } }],
        },
        {
          name: 'slide',
          children: [
            {
              name: 'shape',
              enabled: false,
              props: {},
              children: [
                { name: 'text', props: { text: 'tiny', fontSize: 5 } },
              ],
            },
          ],
        },
      ])
    );
    expect(findings).toEqual([]);
  });

  it('sees presentation componentDefaults and template objects', () => {
    const findings = pptxDiagnostics(
      deck(
        {
          ...CANVAS,
          componentDefaults: { text: { fontSize: 6 } },
          templates: [
            {
              name: 'branded',
              objects: [{ name: 'text', props: { text: 'Template label' } }],
            },
          ],
        },
        [
          {
            name: 'slide',
            props: { template: 'branded' },
            children: [{ name: 'text', props: { text: 'Slide label' } }],
          },
        ]
      )
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: QUALITY_CODES.FONT_SIZE_MIN,
          path: '/props/templates/0/objects/0/props',
        }),
        expect.objectContaining({
          code: QUALITY_CODES.FONT_SIZE_MIN,
          path: '/children/0/children/0/props',
        }),
      ])
    );
  });

  it('analyzes shared template objects once but counts them on every slide', () => {
    const findings = pptxDiagnostics(
      deck(
        {
          ...CANVAS,
          templates: [
            {
              name: 'shared',
              objects: [
                {
                  name: 'text',
                  props: {
                    text: 'word '.repeat(150).trim(),
                    fontSize: 6,
                  },
                },
              ],
            },
          ],
        },
        [
          { name: 'slide', props: { template: 'shared' } },
          { name: 'slide', props: { template: 'shared' } },
        ]
      )
    );

    expect(
      findings.filter(
        (finding) =>
          finding.code === QUALITY_CODES.FONT_SIZE_MIN &&
          finding.path === '/props/templates/0/objects/0/props'
      )
    ).toHaveLength(1);
    expect(
      findings
        .filter((finding) => finding.code === QUALITY_CODES.SLIDE_DENSITY)
        .map((finding) => finding.path)
    ).toEqual(['/children/0', '/children/1']);
  });

  it('uses the renderer placeholder merge precedence', () => {
    const findings = pptxDiagnostics(
      deck(
        {
          ...CANVAS,
          templates: [
            {
              name: 'branded',
              placeholders: [
                {
                  name: 'body',
                  x: 1,
                  y: 1,
                  w: 4,
                  h: 1,
                  defaults: { name: 'text', props: { fontSize: 6 } },
                },
              ],
            },
          ],
        },
        [
          {
            name: 'slide',
            props: {
              template: 'branded',
              placeholders: {
                body: { name: 'text', props: { text: 'Placeholder body' } },
              },
            },
          },
        ]
      )
    );
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: QUALITY_CODES.FONT_SIZE_MIN,
          path: '/children/0/props/placeholders/body/props',
        }),
      ])
    );
  });

  it('does not invent named styles missing from an inline theme', () => {
    const inlineTheme = {
      name: 'self-contained',
      colors: {
        primary: '000000',
        secondary: '111111',
        accent: '222222',
        background: 'FFFFFF',
        text: '000000',
      },
      fonts: { heading: 'Arial', body: 'Arial' },
      defaults: { fontSize: 18, fontColor: '000000' },
      styles: { title: { fontSize: 36 } },
    };
    const findings = pptxDiagnostics(
      deck({ ...CANVAS, theme: inlineTheme }, [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: {
                text: 'A quarterly business review title that wraps across several lines',
                style: 'heading1',
                x: 1,
                y: 1,
                w: 4,
                h: 1.2,
              },
            },
          ],
        },
      ])
    );
    expect(findings).toEqual([]);
  });
});

describe('shipped profiles', () => {
  // 10pt clears the 7pt default floor but not the executive profile's 14pt.
  const small = deck(CANVAS, [
    {
      name: 'slide',
      children: [{ name: 'text', props: { text: 'fine print', fontSize: 10 } }],
    },
  ]);

  it('applies a shipped profile named by id alone', () => {
    expect(codes(small)).toEqual([]);
    const analysis = analyzePptxQuality(small, {
      profile: { id: 'executive-presentation', formats: ['pptx'] },
    });
    expect(analysis.profileId).toBe('executive-presentation');
    expect(analysis.diagnostics.map((finding) => finding.code)).toEqual([
      QUALITY_CODES.FONT_SIZE_MIN,
    ]);
  });

  it("merges the caller's rules over the registered ones", () => {
    const dense = deck(CANVAS, [
      {
        name: 'slide',
        children: [
          { name: 'text', props: { text: 'word '.repeat(80).trim() } },
          { name: 'text', props: { text: 'fine print', fontSize: 10 } },
        ],
      },
    ]);
    const analysis = analyzePptxQuality(dense, {
      profile: {
        id: 'executive-presentation',
        formats: ['pptx'],
        rules: {
          'pptx/minimum-font-size': { parameters: { minimumFontPt: 8 } },
        },
      },
    });
    // Overridden font floor stays silent; the profile's 70-word density holds.
    expect(analysis.diagnostics.map((finding) => finding.code)).toEqual([
      QUALITY_CODES.SLIDE_DENSITY,
    ]);
  });

  it('leaves an unregistered profile exactly as the caller wrote it', () => {
    const analysis = analyzePptxQuality(small, {
      profile: {
        id: 'house-style',
        formats: ['pptx'],
        rules: {
          'pptx/minimum-font-size': { parameters: { minimumFontPt: 12 } },
        },
      },
    });
    expect(analysis.diagnostics.map((finding) => finding.code)).toEqual([
      QUALITY_CODES.FONT_SIZE_MIN,
    ]);
  });
});

describe('preparation failures', () => {
  const broken = { name: 'pptx', props: { ...CANVAS, templates: 'nope' } };

  it('records the failure rather than reporting a clean deck', () => {
    const analysis = analyzePptxQuality(broken);
    expect(analysis.diagnostics).toEqual([]);
    expect(analysis.ruleErrors).toEqual([
      { ruleId: 'quality/prepare', message: expect.any(String) },
    ]);
    expect(analysis.blocked).toBe(false);
  });

  it('fails closed when a gate is active', () => {
    expect(
      analyzePptxQuality(broken, { policy: { gate: 'warning' } }).blocked
    ).toBe(true);
    expect(
      analyzePptxQuality(broken, { policy: { gate: 'none' } }).blocked
    ).toBe(false);
  });

  it('rethrows when the policy asks for it', () => {
    expect(() =>
      analyzePptxQuality(broken, { policy: { onRuleError: 'throw' } })
    ).toThrow();
  });
});

describe('robustness', () => {
  it('answers nothing for non-pptx or malformed input, never throws', () => {
    expect(pptxDiagnostics(undefined)).toEqual([]);
    expect(pptxDiagnostics('not a document')).toEqual([]);
    expect(pptxDiagnostics({ name: 'docx' })).toEqual([]);
    expect(
      pptxDiagnostics({
        name: 'pptx',
        props: CANVAS,
        children: [null, 42, { name: 'slide', children: 'nope' }],
      })
    ).toEqual([]);
  });

  it('keeps the default policy non-blocking', () => {
    const analysis = analyzePptxQuality(
      deck({}, [
        {
          name: 'slide',
          children: [
            {
              name: 'text',
              props: {
                text: 'word '.repeat(200).trim(),
                fontSize: 5,
                x: 0,
                y: 0,
                w: 1,
                h: 0.2,
              },
            },
          ],
        },
      ])
    );
    expect(analysis.blocked).toBe(false);
    expect(analysis.diagnostics.length).toBeGreaterThan(0);
    for (const finding of analysis.diagnostics) {
      expect(['warning', 'info']).toContain(finding.severity);
    }
  });

  it('does not hide policy/profile contract errors', () => {
    expect(() =>
      analyzePptxQuality(deck(CANVAS, []), {
        profile: { id: 'reports-only', formats: ['docx'] },
      })
    ).toThrow('does not support format');
  });
});
