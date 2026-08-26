import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from '@json-to-office/shared';
import { collectPptxQualityFindings } from './preflight';

const CANVAS = { slideWidth: 13.333, slideHeight: 7.5 };

function deck(props: Record<string, unknown>, slides: unknown[]) {
  return { name: 'pptx', props, children: slides };
}

function codes(doc: unknown): string[] {
  return collectPptxQualityFindings(doc).map((finding) => finding.code);
}

describe('canvas', () => {
  it('warns when no canvas is declared — the renderer falls back to 4:3', () => {
    const findings = collectPptxQualityFindings(
      deck({ title: 'No canvas' }, [])
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: QUALITY_CODES.CANVAS_UNSPECIFIED,
      severity: 'warning',
      path: '/props',
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
    const legacy = collectPptxQualityFindings(
      deck({ slideWidth: 10, slideHeight: 7.5 }, [])
    );
    expect(legacy[0]).toMatchObject({
      code: QUALITY_CODES.CANVAS_LEGACY,
      severity: 'info',
    });

    const odd = collectPptxQualityFindings(
      deck({ slideWidth: 9, slideHeight: 5 }, [])
    );
    expect(odd[0]).toMatchObject({
      code: QUALITY_CODES.CANVAS_NONSTANDARD,
      severity: 'info',
    });
  });
});

describe('text overflow', () => {
  it('flags text that cannot fit its declared box, with the measurements', () => {
    const findings = collectPptxQualityFindings(
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
    const styled = collectPptxQualityFindings(
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

    const unstyled = collectPptxQualityFindings(
      deck(CANVAS, [{ name: 'slide', children: [{ name: 'text', props }] }])
    );
    expect(
      unstyled.filter((finding) => finding.code === QUALITY_CODES.TEXT_OVERFLOW)
    ).toEqual([]);
  });

  it('reports a fragile fit as TEXT_TIGHT info', () => {
    const findings = collectPptxQualityFindings(
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
    const findings = collectPptxQualityFindings(
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
    const findings = collectPptxQualityFindings(
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
    const findings = collectPptxQualityFindings(
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
    const findings = collectPptxQualityFindings(
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
    const findings = collectPptxQualityFindings(
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
    });
  });
});

describe('robustness', () => {
  it('answers nothing for non-pptx or malformed input, never throws', () => {
    expect(collectPptxQualityFindings(undefined)).toEqual([]);
    expect(collectPptxQualityFindings('not a document')).toEqual([]);
    expect(collectPptxQualityFindings({ name: 'docx' })).toEqual([]);
    expect(
      collectPptxQualityFindings({
        name: 'pptx',
        props: CANVAS,
        children: [null, 42, { name: 'slide', children: 'nope' }],
      })
    ).toEqual([]);
  });

  it('never produces error severity — quality cannot move the gate', () => {
    const findings = collectPptxQualityFindings(
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
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(['warning', 'info']).toContain(finding.severity);
    }
  });
});
