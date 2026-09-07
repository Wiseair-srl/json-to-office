import { describe, expect, it } from 'vitest';
import type { PdfTextPage, PdfTextWord } from './pdf-text-geometry';
import {
  assignInventory,
  authoredTextForMatch,
  findOccurrences,
  indexDocument,
  normalizeForMatch,
} from './rendered-text-match';

function word(text: string, x: number, y: number, w = 30, h = 12): PdfTextWord {
  return { text, xMin: x, yMin: y, xMax: x + w, yMax: y + h };
}
function page(words: PdfTextWord[]): PdfTextPage {
  return { widthPt: 595, heightPt: 842, words, lines: [] };
}

describe('normalizeForMatch / authoredTextForMatch', () => {
  it('folds ligatures, case and punctuation', () => {
    expect(normalizeForMatch('ﬁnance — Q4!')).toBe('financeq4');
  });
  it('strips markup the page never shows', () => {
    expect(
      authoredTextForMatch(
        'Revenue **grew** 12%.[^rev] See [the appendix](#app) — page {PAGE}'
      )
    ).toBe('Revenue grew 12%.  See the appendix — page  ');
  });
});

describe('findOccurrences', () => {
  it('matches across fragments and returns the union box', () => {
    const index = indexDocument([
      page([word('Reve', 10, 10), word('nue', 40, 10), word('grew', 80, 10)]),
    ]);
    const hits = findOccurrences(index, 'revenue');
    expect(hits).toHaveLength(1);
    expect(hits[0].parts).toEqual([
      { pageIndex: 0, words: [0, 1], xMin: 10, xMax: 70, yMin: 10, yMax: 22 },
    ]);
  });

  it('returns every occurrence of a repeated string, in reading order', () => {
    const index = indexDocument([
      page([word('Total', 10, 10), word('x', 50, 10)]),
      page([word('Total', 10, 40)]),
    ]);
    const hits = findOccurrences(index, 'total');
    expect(hits.map((h) => h.pageIndex)).toEqual([0, 1]);
  });

  it('follows a paragraph across a page break as one occurrence', () => {
    const index = indexDocument([
      page([word('Revenue', 10, 800), word('grew', 50, 800)]),
      page([word('twelve', 10, 40), word('percent', 50, 40)]),
    ]);
    const [hit] = findOccurrences(index, 'revenuegrewtwelvepercent');
    expect(hit.pageIndex).toBe(0);
    expect(hit.endPageIndex).toBe(1);
    expect(hit.parts.map((p) => [p.pageIndex, p.words])).toEqual([
      [0, [0, 1]],
      [1, [0, 1]],
    ]);
  });
});

describe('assignInventory', () => {
  const pages = [
    page([
      word('Client', 10, 10),
      word('report', 50, 10),
      word('Total', 10, 100),
      word('Body', 10, 200),
    ]),
    page([
      word('Client', 10, 10),
      word('report', 50, 10),
      word('Total', 10, 100),
    ]),
  ];

  it('claims duplicates in reading order and lets chrome claim every page', () => {
    const { matches } = assignInventory(pages, [
      { path: '/h', text: 'Client report', repeats: true },
      { path: '/t1', text: 'Total' },
      { path: '/b', text: 'Body' },
      { path: '/t2', text: 'Total' },
    ]);
    expect(
      matches.map((m) => [
        m.entry.path,
        m.status,
        m.occurrences.map((o) => o.pageIndex),
      ])
    ).toEqual([
      ['/h', 'mapped', [0, 1]],
      ['/t1', 'mapped', [0]],
      ['/b', 'mapped', [0]],
      ['/t2', 'mapped', [1]],
    ]);
  });

  it('matches a paragraph split across pages, with the footer in between', () => {
    const split = [
      page([
        word('Revenue', 10, 700),
        word('grew', 50, 700),
        word('Page', 10, 820),
        word('1', 40, 820),
      ]),
      page([
        word('Head', 10, 20),
        word('twelve', 10, 60),
        word('percent', 50, 60),
      ]),
    ];
    const { matches } = assignInventory(split, [
      { path: '/f', text: 'Page {PAGE}', repeats: true },
      { path: '/h', text: 'Head', repeats: true },
      { path: '/p', text: 'Revenue grew twelve percent' },
    ]);
    expect(matches[2].status).toBe('mapped');
    expect(matches[2].occurrences[0].endPageIndex).toBe(1);
  });

  it('maps a paragraph whose tail was cut off by its longest rendered prefix', () => {
    const cut = [
      page([
        word('Revenue', 10, 700),
        word('grew', 50, 700),
        word('twelve', 90, 700),
        word('percent', 130, 700),
      ]),
    ];
    const { matches } = assignInventory(cut, [
      {
        path: '/p',
        text: 'Revenue grew twelve percent this year and margin held',
      },
    ]);
    expect(matches[0].status).toBe('mapped');
    expect(matches[0].partial).toEqual({ matchedChars: 24, totalChars: 45 });
    expect(matches[0].occurrences[0].parts[0].words).toEqual([0, 1, 2, 3]);
  });

  it('reports text the PDF never shows as missing, and short needles as skipped', () => {
    const { matches } = assignInventory(pages, [
      { path: '/gone', text: 'Fully clipped sentence' },
      { path: '/short', text: 'A' },
    ]);
    expect(matches.map((m) => m.status)).toEqual(['missing', 'skipped']);
  });

  it('marks an entry ambiguous when every occurrence is already claimed', () => {
    const { matches } = assignInventory(pages, [
      { path: '/t1', text: 'Total' },
      { path: '/t2', text: 'Total' },
      { path: '/t3', text: 'Total' },
    ]);
    expect(matches.map((m) => m.status)).toEqual([
      'mapped',
      'mapped',
      'ambiguous',
    ]);
  });
});
