import { describe, expect, it } from 'vitest';
import { QUALITY_CODES } from '@json-to-office/quality';
import type { PdfFontInfo } from './pdf-fonts';
import type {
  PdfTextLine,
  PdfTextPage,
  PdfTextWord,
} from './pdf-text-geometry';
import {
  analyzeRenderedDocument,
  type RenderedTextEntry,
} from './rendered-analysis';

function word(text: string, x: number, y: number, w = 30, h = 12): PdfTextWord {
  return { text, xMin: x, yMin: y, xMax: x + w, yMax: y + h };
}
/** Words laid out on one line each unless grouped; lines grouped by row. */
function page(
  words: PdfTextWord[],
  size = { widthPt: 595, heightPt: 842 }
): PdfTextPage {
  const rows = new Map<number, number[]>();
  words.forEach((w, i) => rows.set(w.yMin, [...(rows.get(w.yMin) ?? []), i]));
  const lines: PdfTextLine[] = [...rows.entries()].map(([, indices]) => ({
    xMin: Math.min(...indices.map((i) => words[i].xMin)),
    yMin: Math.min(...indices.map((i) => words[i].yMin)),
    xMax: Math.max(...indices.map((i) => words[i].xMax)),
    yMax: Math.max(...indices.map((i) => words[i].yMax)),
    words: indices,
  }));
  return { ...size, words, lines };
}
function entry(
  path: string,
  text: string,
  role: RenderedTextEntry['role'] = 'body',
  extra: Partial<RenderedTextEntry> = {}
): RenderedTextEntry {
  return { path, text, role, ...extra };
}
const font = (baseName: string): PdfFontInfo => ({
  name: `AAAAAA+${baseName}`,
  baseName,
  type: 'TrueType',
  embedded: true,
});

function codes(findings: { code: string }[]): string[] {
  return findings.map((f) => f.code);
}

describe('analyzeRenderedDocument', () => {
  it('is silent on a clean page and reports the mapping summary', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [
        page([
          word('Client', 10, 10),
          word('report', 50, 10),
          word('Revenue', 10, 100),
          word('grew', 50, 100),
        ]),
      ],
      inventory: [
        entry('/c', 'Client report', 'chrome', { repeats: true }),
        entry('/p', 'Revenue grew'),
      ],
      fonts: [font('DMSans-Regular')],
      requestedFonts: [{ family: 'DM Sans', path: '/theme/fonts/body' }],
    });
    expect(result.findings).toEqual([]);
    expect(result.summary).toEqual({
      pages: 1,
      words: 4,
      inventory: { mapped: 2, ambiguous: 0, missing: 0, skipped: 0 },
      findings: { mapped: 0, ambiguous: 0, unmapped: 0 },
      fonts: { requested: 1, substituted: 0 },
    });
  });

  it('reports a word past the page edge at the paragraph that authored it', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [
        page([
          word('Revenue', 10, 100),
          word('unbreakablewordthatrunsoff', 560, 100, 120),
        ]),
      ],
      inventory: [entry('/p', 'Revenue unbreakablewordthatrunsoff')],
    });
    expect(codes(result.findings)).toEqual([QUALITY_CODES.RENDERED_CLIP]);
    const [clip] = result.findings;
    expect(clip.path).toBe('/p');
    expect(clip.certainty).toBe('rendered');
    expect(clip.context).toMatchObject({ mapping: 'mapped', page: 1 });
    expect(clip.evidence?.actual).toBe(85);
  });

  it('keeps a clipped word nobody authored as an unmapped finding at the root', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [page([word('stray', 590, 100, 40)])],
      inventory: [],
    });
    expect(result.findings[0]).toMatchObject({
      code: QUALITY_CODES.RENDERED_CLIP,
      path: '',
      context: { mapping: 'unmapped' },
    });
    expect(result.summary.findings.unmapped).toBe(1);
  });

  it('reports a paragraph whose tail never rendered as cut off, at its pointer', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [
        page([
          word('Revenue', 10, 700),
          word('grew', 50, 700),
          word('twelve', 90, 700),
          word('percent', 130, 700),
        ]),
      ],
      inventory: [
        entry('/p', 'Revenue grew twelve percent this year and margin held'),
      ],
    });
    expect(codes(result.findings)).toEqual([QUALITY_CODES.RENDERED_CLIP]);
    expect(result.findings[0]).toMatchObject({
      path: '/p',
      context: { mapping: 'mapped', kind: 'truncated', page: 1 },
    });
    expect(result.findings[0].evidence).toMatchObject({
      actual: 53,
      expected: 100,
      unit: '%',
    });
    expect(result.summary.inventory.missing).toBe(0);
  });

  it('reports a framed paragraph drawn taller than its declared box', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [
        page([
          word('Framed', 10, 100),
          word('text', 10, 114),
          word('spills', 10, 128),
          word('down', 10, 142),
        ]),
      ],
      inventory: [
        entry('/f', 'Framed text spills down', 'body', {
          box: { widthPt: 100, heightPt: 30 },
        }),
      ],
    });
    expect(codes(result.findings)).toEqual([QUALITY_CODES.RENDERED_SPILL]);
    expect(result.findings[0].evidence).toMatchObject({
      actual: 54,
      expected: 30,
      unit: 'pt',
    });
    expect(result.findings[0].evidence?.values).toEqual({ marginPt: -24 });
  });

  it('reports words from different lines drawn over each other, naming both authors', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [
        page([word('Title', 10, 100, 60, 20), word('label', 20, 108, 30, 10)]),
      ],
      inventory: [entry('/t', 'Title', 'heading'), entry('/l', 'label')],
    });
    expect(codes(result.findings)).toEqual([QUALITY_CODES.RENDERED_OVERLAP]);
    expect(result.findings[0]).toMatchObject({
      path: '/t',
      relatedPaths: ['/l'],
      context: { mapping: 'mapped' },
    });
  });

  it('reports each unmapped overlapping pair on a page', () => {
    const result = analyzeRenderedDocument({
      format: 'pptx',
      pages: [
        page([
          word('a', 10, 100, 40, 20),
          word('b', 20, 108, 30, 10),
          word('c', 300, 100, 40, 20),
          word('d', 310, 108, 30, 10),
        ]),
      ],
      inventory: [],
    });
    expect(codes(result.findings)).toEqual([
      QUALITY_CODES.RENDERED_OVERLAP,
      QUALITY_CODES.RENDERED_OVERLAP,
    ]);
    expect(result.summary.findings.unmapped).toBe(2);
  });

  it('does not call the words of one line an overlap', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [page([word('tight', 10, 100, 30), word('kerning', 38, 100, 30)])],
      inventory: [entry('/p', 'tight kerning')],
    });
    expect(result.findings).toEqual([]);
  });

  it('reports authored text the PDF never shows', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [page([word('Visible', 10, 100)])],
      inventory: [
        entry('/v', 'Visible'),
        entry('/gone', 'Entirely clipped paragraph'),
      ],
    });
    expect(codes(result.findings)).toEqual([
      QUALITY_CODES.RENDERED_TEXT_MISSING,
    ]);
    expect(result.findings[0].path).toBe('/gone');
    expect(result.summary.inventory.missing).toBe(1);
  });

  it('reports a requested family the PDF does not embed', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [page([word('Visible', 10, 100)])],
      inventory: [entry('/v', 'Visible')],
      fonts: [font('DejaVuSans')],
      requestedFonts: [
        { family: 'Inter', path: '/theme/fonts/body', declared: true },
        { family: 'inter' },
      ],
    });
    expect(codes(result.findings)).toEqual([
      QUALITY_CODES.RENDERED_FONT_SUBSTITUTED,
    ]);
    expect(result.findings[0]).toMatchObject({
      path: '/theme/fonts/body',
      category: 'brand',
      severity: 'warning',
      context: { mapping: 'mapped', declared: true },
    });
    expect(result.summary.fonts).toEqual({ requested: 2, substituted: 1 });
  });

  it('treats a missing host font as preview information, not a document defect', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [page([word('Visible', 10, 100)])],
      inventory: [entry('/v', 'Visible')],
      fonts: [font('Carlito')],
      requestedFonts: [{ family: 'Calibri' }],
    });
    expect(result.findings[0]).toMatchObject({
      code: QUALITY_CODES.RENDERED_FONT_SUBSTITUTED,
      severity: 'info',
      context: { mapping: 'unmapped', declared: false },
    });
  });

  it('stays quiet about fonts when the host could not inspect the PDF', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [page([word('Visible', 10, 100)])],
      inventory: [entry('/v', 'Visible')],
      requestedFonts: [{ family: 'Inter' }],
    });
    expect(result.findings).toEqual([]);
    expect(result.summary.fonts).toBeUndefined();
  });

  it('notes an empty page as information', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [page([word('Visible', 10, 100)]), page([])],
      inventory: [entry('/v', 'Visible')],
    });
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: QUALITY_CODES.RENDERED_EMPTY_PAGE,
        severity: 'info',
        context: { mapping: 'unmapped', page: 2 },
      }),
    ]);
  });

  it('reports a heading stranded above the footer at a page foot', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [
        page([
          word('Intro', 10, 100),
          word('Results', 10, 800),
          word('Page', 10, 830),
          word('1', 40, 830),
        ]),
        page([word('Body', 10, 60), word('Page', 10, 830), word('2', 40, 830)]),
      ],
      inventory: [
        entry('/f', 'Page {PAGE}', 'chrome', { repeats: true }),
        entry('/i', 'Intro'),
        entry('/h', 'Results', 'heading', { level: 2 }),
        entry('/b', 'Body'),
      ],
    });
    expect(codes(result.findings)).toEqual([
      QUALITY_CODES.RENDERED_HEADING_STRANDED,
    ]);
    expect(result.findings[0]).toMatchObject({
      path: '/h',
      context: { mapping: 'mapped', page: 1 },
    });
  });

  it('leaves a heading alone when body text follows it on the page', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [
        page([word('Results', 10, 700), word('Body', 10, 720)]),
        page([word('More', 10, 60)]),
      ],
      inventory: [
        entry('/h', 'Results', 'heading'),
        entry('/b', 'Body'),
        entry('/m', 'More'),
      ],
    });
    expect(result.findings).toEqual([]);
  });

  it('reports a paragraph that leaves one line alone across a page break', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [
        page([word('Revenue', 10, 800), word('grew', 50, 800)]),
        page([
          word('twelve', 10, 40),
          word('percent', 50, 40),
          word('this', 10, 54),
          word('year', 50, 54),
        ]),
      ],
      inventory: [entry('/p', 'Revenue grew twelve percent this year')],
    });
    expect(codes(result.findings)).toEqual([
      QUALITY_CODES.RENDERED_PARAGRAPH_SPLIT,
    ]);
    expect(result.findings[0]).toMatchObject({
      severity: 'info',
      context: { kind: 'orphan', page: 1, mapping: 'mapped' },
    });
    expect(result.findings[0].evidence?.values).toEqual({
      linesBefore: 1,
      linesAfter: 2,
    });
  });

  it('does not touch docx-only composition checks on a deck', () => {
    const result = analyzeRenderedDocument({
      format: 'pptx',
      pages: [
        page([word('Results', 10, 500)], { widthPt: 960, heightPt: 540 }),
        page([word('Body', 10, 60)], { widthPt: 960, heightPt: 540 }),
      ],
      inventory: [
        entry('/s0', 'Results', 'heading'),
        entry('/s1', 'Body', 'slide-text'),
      ],
    });
    expect(result.findings).toEqual([]);
  });
});
