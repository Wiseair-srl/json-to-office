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
import { RENDERED_QUALITY_RULES } from './rendered-rules';

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
      suppressed: 0,
      blocked: false,
      truncated: false,
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

  it('reports no font check when the PDF carries no fonts to check against', () => {
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [page([word('Visible', 10, 100)])],
      inventory: [entry('/v', 'Visible')],
      fonts: [],
      requestedFonts: [{ family: 'Inter', declared: true }],
    });
    expect(result.findings).toEqual([]);
    expect(result.summary.fonts).toBeUndefined();
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
        context: { mapping: 'unmapped', page: 2, kind: 'blank' },
      }),
    ]);
  });

  it('keeps a pptx slide with any word, chrome or not, out of the empty pages', () => {
    // A deck declares no chrome inventory: an image slide carrying only its
    // slide number is the legitimate case, so only a wordless slide counts.
    const result = analyzeRenderedDocument({
      format: 'pptx',
      pages: [
        page([word('Title', 10, 100)], { widthPt: 960, heightPt: 540 }),
        page([word('2', 900, 520)], { widthPt: 960, heightPt: 540 }),
        page([], { widthPt: 960, heightPt: 540 }),
      ],
      inventory: [entry('/t', 'Title', 'slide-text')],
    });
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: QUALITY_CODES.RENDERED_EMPTY_PAGE,
        context: { mapping: 'unmapped', page: 3, kind: 'blank' },
      }),
    ]);
  });

  it('notes a page that carries only its running head and footer as empty', () => {
    // The stray trailing page of a report: the section chrome repeats on it,
    // so the page has words, but none of them are body copy.
    const result = analyzeRenderedDocument({
      format: 'docx',
      pages: [
        page([
          word('Client', 10, 10),
          word('report', 50, 10),
          word('Visible', 10, 100),
          word('Page', 10, 830),
          word('1', 40, 830),
        ]),
        page([
          word('Client', 10, 10),
          word('report', 50, 10),
          word('Page', 10, 830),
          word('2', 40, 830),
        ]),
      ],
      inventory: [
        entry('/c', 'Client report', 'chrome', { repeats: true }),
        entry('/f', 'Page {PAGE}', 'chrome', { repeats: true }),
        entry('/v', 'Visible'),
      ],
    });
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: QUALITY_CODES.RENDERED_EMPTY_PAGE,
        severity: 'info',
        message: expect.stringMatching(/only its running head or footer/),
        context: { mapping: 'unmapped', page: 2, kind: 'chrome-only' },
      }),
    ]);
  });

  describe('page fill', () => {
    // A4 sampled into 281 rows (24 dpi); the running head sits at 10pt, the
    // footer at 830pt, so the body spans roughly rows 8–276.
    const chrome = [
      entry('/c', 'Client report', 'chrome', { repeats: true }),
      entry('/f', 'Page {PAGE}', 'chrome', { repeats: true }),
    ];
    const dressed = (bodyWords: PdfTextWord[]) =>
      page([
        word('Client', 10, 10),
        word('report', 50, 10),
        ...bodyWords,
        word('Page', 10, 830),
        word('1', 40, 830),
      ]);
    const ink = (inked: number[]) => ({ rows: 281, inked });
    const range = (from: number, to: number) =>
      Array.from({ length: to - from + 1 }, (_, i) => from + i);

    it('flags a middle page whose ink stops well above the footer, at its section', () => {
      const result = analyzeRenderedDocument({
        format: 'docx',
        pages: [
          {
            ...dressed([word('Cover', 10, 300)]),
            ink: ink([3, ...range(100, 110), 277]),
          },
          // Body ink from the header rule (row 5) down to row 60 of ~270 available.
          {
            ...dressed([word('Short', 10, 100)]),
            ink: ink([3, ...range(5, 60), 277]),
          },
          {
            ...dressed([word('End', 10, 100)]),
            ink: ink([3, ...range(5, 120), 277]),
          },
        ],
        inventory: [
          ...chrome,
          entry('/children/0/children/0/props/text', 'Cover'),
          entry('/children/1/children/0/props/text', 'Short'),
          entry('/children/2/children/0/props/text', 'End'),
        ],
      });
      expect(result.findings).toEqual([
        expect.objectContaining({
          code: QUALITY_CODES.RENDERED_PAGE_UNDERFILLED,
          severity: 'info',
          path: '/children/1',
          message: expect.stringMatching(/Page 2 .*19%/),
          context: {
            mapping: 'mapped',
            page: 2,
            fill: 0.19,
            kind: 'middle-page',
          },
        }),
      ]);
    });

    it('maps the page to a paragraph that starts on it and runs onto the next', () => {
      // The only body text on page 2 is the head of a paragraph whose tail
      // sits on page 3; the part left on page 2 still names the owner.
      const result = analyzeRenderedDocument({
        format: 'docx',
        pages: [
          { ...dressed([word('Cover', 10, 300)]), ink: ink([3, 100, 277]) },
          {
            ...dressed([word('Revenue', 10, 100), word('grew', 50, 100)]),
            ink: ink([3, ...range(30, 40), 277]),
          },
          {
            ...dressed([word('twelve', 10, 100), word('percent', 50, 100)]),
            ink: ink([3, ...range(30, 120), 277]),
          },
        ],
        inventory: [
          ...chrome,
          entry('/children/0/children/0/props/text', 'Cover'),
          entry(
            '/children/1/children/0/props/text',
            'Revenue grew twelve percent'
          ),
        ],
      });
      expect(
        result.findings.filter(
          (f) => f.code === QUALITY_CODES.RENDERED_PAGE_UNDERFILLED
        )
      ).toEqual([
        expect.objectContaining({
          path: '/children/1',
          context: expect.objectContaining({ mapping: 'mapped', page: 2 }),
        }),
      ]);
    });

    it('keeps a full page, the cover and the last page out of it', () => {
      const result = analyzeRenderedDocument({
        format: 'docx',
        pages: [
          { ...dressed([word('Title', 10, 420)]), ink: ink([3, 140, 277]) },
          {
            ...dressed([word('Full', 10, 100)]),
            ink: ink([3, ...range(5, 250), 277]),
          },
          {
            ...dressed([word('End', 10, 100)]),
            ink: ink([3, ...range(5, 95), 277]),
          },
        ],
        inventory: [
          ...chrome,
          entry('/children/0/children/0/props/text', 'Title'),
          entry('/children/1/children/0/props/text', 'Full'),
          entry('/children/2/children/0/props/text', 'End'),
        ],
      });
      expect(codes(result.findings)).toEqual([]);
    });

    it('reports a stub last page that holds only the tail of the document', () => {
      const result = analyzeRenderedDocument({
        format: 'docx',
        pages: [
          { ...dressed([word('Cover', 10, 300)]), ink: ink([3, 100, 277]) },
          {
            ...dressed([word('Full', 10, 100)]),
            ink: ink([3, ...range(5, 250), 277]),
          },
          {
            ...dressed([word('Notes', 10, 100)]),
            ink: ink([3, ...range(5, 20), 277]),
          },
        ],
        inventory: [
          ...chrome,
          entry('/children/1/children/0/props/text', 'Full'),
          entry('/children/2/children/0/props/text', 'Notes'),
        ],
      });
      expect(result.findings).toEqual([
        expect.objectContaining({
          code: QUALITY_CODES.RENDERED_PAGE_UNDERFILLED,
          path: '/children/2',
          message: expect.stringMatching(/Page 3, the last, is \d+% filled/),
          suggestion: expect.stringMatching(/pageBreak/),
          context: expect.objectContaining({ page: 3, kind: 'last-page' }),
        }),
      ]);
    });

    // #408: the notes on a stub last page are painted from source slots
    // authored in whatever section cited them, so the text that reaches the
    // page furthest down names a section near the front of the document —
    // useless to an author told to break a page. A last page belongs to the
    // section that closes the document.
    it('lands a stub last page on the closing section, not on the section its notes were cited in', () => {
      const result = analyzeRenderedDocument({
        format: 'docx',
        pages: [
          { ...dressed([word('Cover', 10, 300)]), ink: ink([3, 100, 277]) },
          {
            ...dressed([word('Full', 10, 100)]),
            ink: ink([3, ...range(5, 250), 277]),
          },
          {
            // The closing section's own heading, then the notes below it.
            ...dressed([word('Close', 10, 100), word('Notes', 10, 130)]),
            ink: ink([3, ...range(5, 20), 277]),
          },
        ],
        inventory: [
          ...chrome,
          entry('/children/1/children/0/props/text', 'Full'),
          entry('/children/4/children/0/props/slots/title', 'Close', 'heading'),
          // The notes list is the /sources context: its pointer is the slot
          // in section 1 that cited the source, not the closing section, and
          // it is the text furthest down the page.
          entry('/children/1/children/2/props/slots/source', 'Notes'),
        ],
      });
      expect(result.findings).toEqual([
        expect.objectContaining({
          code: QUALITY_CODES.RENDERED_PAGE_UNDERFILLED,
          path: '/children/4',
          context: expect.objectContaining({
            page: 3,
            kind: 'last-page',
            mapping: 'mapped',
          }),
        }),
      ]);
    });

    it('stays silent without an ink profile, and on a deck', () => {
      const short = dressed([word('Short', 10, 100)]);
      const docx = analyzeRenderedDocument({
        format: 'docx',
        pages: [short, short, short],
        inventory: [
          ...chrome,
          entry('/children/1/children/0/props/text', 'Short'),
        ],
      });
      expect(codes(docx.findings)).toEqual([]);
      const slide = {
        ...page([word('Title', 10, 40)], { widthPt: 960, heightPt: 540 }),
        ink: ink([20, 21]),
      };
      const pptx = analyzeRenderedDocument({
        format: 'pptx',
        pages: [slide, slide, slide],
        inventory: [entry('/t', 'Title', 'slide-text')],
      });
      expect(codes(pptx.findings)).toEqual([]);
    });
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
        // Words a space apart: at a wider gap two aligned lines read as
        // two table columns, and the paragraph would be read column-wise.
        page([
          word('twelve', 10, 40),
          word('percent', 43, 40),
          word('this', 10, 54),
          word('year', 43, 54),
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

  describe('a table broken across a page', () => {
    const table = (row: number, column: number, cell = true) =>
      `/children/0/children/0/props/columns/${column}/${cell ? `cells/${row}` : 'header'}`;
    const header = (column: number) => table(0, column, false);
    /** Two columns of header plus `rows` rows, as the inventory writes them. */
    const inventory = (rows: number) => [
      entry(header(0), 'Quarter', 'table-header'),
      entry(header(1), 'Revenue', 'table-header'),
      ...Array.from({ length: rows }, (_, row) => [
        entry(table(row, 0), `Quarter ${row + 1}`, 'table-cell'),
        entry(table(row, 1), `${row + 1}00`, 'table-cell'),
      ]).flat(),
    ];
    const row = (index: number, y: number) => [
      word('Quarter', 10, y),
      word(`${index + 1}`, 45, y, 8),
      word(`${index + 1}00`, 200, y),
    ];

    it('reports a header left alone at the foot of a page', () => {
      const result = analyzeRenderedDocument({
        format: 'docx',
        pages: [
          page([word('Quarter', 10, 800), word('Revenue', 200, 800)]),
          page([...row(0, 40), ...row(1, 60), ...row(2, 80)]),
        ],
        inventory: inventory(3),
      });
      expect(codes(result.findings)).toEqual([
        QUALITY_CODES.RENDERED_TABLE_SPLIT,
      ]);
      expect(result.findings[0]).toMatchObject({
        severity: 'info',
        path: header(0),
        context: { kind: 'header-alone', page: 1, mapping: 'mapped' },
      });
    });

    it('reports one row left alone above the break, at that row', () => {
      const result = analyzeRenderedDocument({
        format: 'docx',
        pages: [
          page([
            word('Quarter', 10, 780),
            word('Revenue', 200, 780),
            ...row(0, 800),
          ]),
          page([...row(1, 40), ...row(2, 60)]),
        ],
        inventory: inventory(3),
      });
      expect(codes(result.findings)).toEqual([
        QUALITY_CODES.RENDERED_TABLE_SPLIT,
      ]);
      expect(result.findings[0]).toMatchObject({
        path: table(0, 0),
        context: { kind: 'orphan-row', page: 1 },
      });
    });

    it('reports one row left alone below the break', () => {
      const result = analyzeRenderedDocument({
        format: 'docx',
        pages: [
          page([
            word('Quarter', 10, 760),
            word('Revenue', 200, 760),
            ...row(0, 780),
            ...row(1, 800),
          ]),
          page([...row(2, 40)]),
        ],
        inventory: inventory(3),
      });
      expect(codes(result.findings)).toEqual([
        QUALITY_CODES.RENDERED_TABLE_SPLIT,
      ]);
      expect(result.findings[0]).toMatchObject({
        path: table(2, 0),
        context: { kind: 'widow-row', page: 2 },
      });
    });

    it('says nothing about a table that breaks with rows on both sides', () => {
      const result = analyzeRenderedDocument({
        format: 'docx',
        pages: [
          page([
            word('Quarter', 10, 740),
            word('Revenue', 200, 740),
            ...row(0, 760),
            ...row(1, 780),
          ]),
          page([...row(2, 40), ...row(3, 60)]),
        ],
        inventory: inventory(4),
      });
      expect(result.findings).toEqual([]);
    });

    it('says nothing about a table that fits on one page', () => {
      const result = analyzeRenderedDocument({
        format: 'docx',
        pages: [
          page([
            word('Quarter', 10, 700),
            word('Revenue', 200, 700),
            ...row(0, 720),
            ...row(1, 740),
          ]),
        ],
        inventory: inventory(2),
      });
      expect(result.findings).toEqual([]);
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

describe('the rendered pass under a profile and policy', () => {
  const clippedPage = () =>
    page([
      word('Revenue', 10, 100),
      word('unbreakablewordthatrunsoff', 560, 100, 120),
      word('Alone', 10, 700),
    ]);
  const input = () => ({
    format: 'docx' as const,
    pages: [clippedPage(), page([])],
    inventory: [
      entry('/p', 'Revenue unbreakablewordthatrunsoff'),
      entry('/a', 'Alone'),
    ],
  });

  it('runs every rendered rule through the quality engine, format-filtered', () => {
    const docx = analyzeRenderedDocument(input());
    expect(docx.analysis.evaluatedRuleIds).toEqual(
      RENDERED_QUALITY_RULES.rules.map((rule) => rule.id)
    );
    const pptx = analyzeRenderedDocument({ ...input(), format: 'pptx' });
    expect(pptx.analysis.evaluatedRuleIds).not.toContain(
      'rendered/heading-stranded'
    );
    expect(pptx.analysis.evaluatedRuleIds).not.toContain(
      'rendered/paragraph-split'
    );
  });

  it('drops a suppressed finding and counts it', () => {
    const result = analyzeRenderedDocument(input(), {
      policy: {
        suppressions: [
          {
            code: QUALITY_CODES.RENDERED_EMPTY_PAGE,
            reason: 'the back cover is a full-page figure',
          },
        ],
      },
    });
    expect(codes(result.findings)).toEqual([QUALITY_CODES.RENDERED_CLIP]);
    expect(result.summary.suppressed).toBe(1);
    expect(result.summary.findings).toEqual({
      mapped: 1,
      ambiguous: 0,
      unmapped: 0,
    });
  });

  it('lets a profile disable a rule and override a severity, and stamps its id', () => {
    const result = analyzeRenderedDocument(input(), {
      profile: {
        id: 'client-report',
        formats: ['docx'],
        rules: {
          'rendered/empty-page': { severity: 'warning' },
          'rendered/clip': { enabled: false },
        },
      },
    });
    expect(result.findings).toEqual([
      expect.objectContaining({
        code: QUALITY_CODES.RENDERED_EMPTY_PAGE,
        severity: 'warning',
        profileId: 'client-report',
      }),
    ]);
    expect(result.summary.profileId).toBe('client-report');
    expect(result.analysis.evaluatedRuleIds).not.toContain('rendered/clip');
  });

  it('refuses a profile for another format', () => {
    expect(() =>
      analyzeRenderedDocument(input(), {
        profile: { id: 'deck', formats: ['pptx'] },
      })
    ).toThrow(/does not support format "docx"/);
  });

  it('marks findings blocking under a gate', () => {
    const result = analyzeRenderedDocument(input(), {
      policy: { gate: 'warning' },
    });
    const clip = result.findings.find(
      (f) => f.code === QUALITY_CODES.RENDERED_CLIP
    );
    const empty = result.findings.find(
      (f) => f.code === QUALITY_CODES.RENDERED_EMPTY_PAGE
    );
    expect(clip?.blocking).toBe(true);
    expect(empty?.blocking).toBe(false);
    expect(result.summary.blocked).toBe(true);
  });

  it('describes every rule for the design guide with a stable code', () => {
    const rules = RENDERED_QUALITY_RULES.rules;
    expect(new Set(rules.map((r) => r.code)).size).toBe(rules.length);
    for (const rule of rules) {
      expect(rule.id).toMatch(/^rendered\//);
      expect(rule.defaultCertainty).toBe('rendered');
      expect(rule.description).toMatch(/\S/);
      expect(rule.code).toMatch(/^W_QUALITY_RENDERED_/);
    }
  });
});
