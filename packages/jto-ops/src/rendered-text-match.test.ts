import { describe, expect, it } from 'vitest';
import type { PdfTextPage, PdfTextWord } from './pdf-text-geometry';
import {
  assignInventory,
  authoredTextForMatch,
  findOccurrences,
  indexDocument,
  needleSegments,
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
  it('strips markup the page never shows and cuts the needle at fields', () => {
    expect(
      needleSegments(
        'Revenue **grew** 12%.[^rev] See [the appendix](#app) — page {PAGE}'
      )
    ).toEqual(['revenuegrew12', 'seetheappendixpage']);
    expect(needleSegments('Figure {SEQ:figure}: Revenue by [@region]')).toEqual(
      ['figure', 'revenueby']
    );
    expect(authoredTextForMatch('a *b* [c](d)')).toBe('a b c');
  });
});

describe('findOccurrences', () => {
  it('matches across fragments and returns the union box', () => {
    const index = indexDocument([
      page([word('Reve', 10, 10), word('nue', 40, 10), word('grew', 80, 10)]),
    ]);
    const hits = findOccurrences(index, ['revenue']);
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
    const hits = findOccurrences(index, ['total']);
    expect(hits.map((h) => h.pageIndex)).toEqual([0, 1]);
  });

  it('follows a paragraph across a page break as one occurrence', () => {
    const index = indexDocument([
      page([word('Revenue', 10, 800), word('grew', 50, 800)]),
      page([word('twelve', 10, 40), word('percent', 50, 40)]),
    ]);
    const [hit] = findOccurrences(index, ['revenuegrewtwelvepercent']);
    expect(hit.pageIndex).toBe(0);
    expect(hit.endPageIndex).toBe(1);
    expect(hit.parts.map((p) => [p.pageIndex, p.words])).toEqual([
      [0, [0, 1]],
      [1, [0, 1]],
    ]);
  });
});

describe('findOccurrences on boundaries and fields', () => {
  it('never matches inside a word', () => {
    const index = indexDocument([
      page([word('homepage', 10, 10), word('pages', 60, 10)]),
    ]);
    expect(findOccurrences(index, ['page'])).toEqual([]);
  });

  it('bridges a rendered field value between two segments', () => {
    const index = indexDocument([
      page([
        word('Figure', 10, 10),
        word('1:', 50, 10),
        word('Revenue', 70, 10),
        word('by', 120, 10),
        word('region', 140, 10),
      ]),
    ]);
    const hits = findOccurrences(index, ['figure', 'revenuebyregion']);
    expect(hits).toHaveLength(1);
    expect(hits[0].parts[0].words).toEqual([0, 1, 2, 3, 4]);
    expect(findOccurrences(index, ['figure', 'nowhere'])).toEqual([]);
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

  it('claims a bare page number in the band even when the footer is only a field', () => {
    const split = [
      page([
        word('Revenue', 10, 500),
        word('grew', 50, 500),
        word('2', 300, 820),
      ]),
      page([
        word('twelve', 10, 300),
        word('percent', 50, 300),
        word('3', 300, 820),
      ]),
    ];
    const { matches, chromeWords } = assignInventory(split, [
      { path: '/f', text: '{PAGE}', repeats: true },
      { path: '/p', text: 'Revenue grew twelve percent' },
    ]);
    expect(matches[0].status).toBe('skipped');
    expect(matches[1].status).toBe('mapped');
    expect(matches[1].partial).toBeUndefined();
    expect([...chromeWords]).toEqual(['0:2', '1:2']);
  });

  it('keeps chrome out of the body: a footer word never claims a body row', () => {
    const pagesWithBody = [
      page([
        word('See', 10, 400),
        word('the', 30, 400),
        word('next', 50, 400),
        word('page', 80, 400),
        word('Page', 10, 820),
        word('1', 40, 820),
      ]),
    ];
    const { matches } = assignInventory(pagesWithBody, [
      { path: '/f', text: 'Page {PAGE}', repeats: true },
      { path: '/p', text: 'See the next page' },
    ]);
    expect(matches[0].occurrences.map((o) => o.parts[0].words)).toEqual([[4]]);
    expect(matches[1].status).toBe('mapped');
    expect(matches[1].partial).toBeUndefined();
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

  it('lets a contents entry claim the contents line so the heading keeps its own', () => {
    const pages = [
      page([
        word('Contents', 10, 40),
        word('Alpha', 10, 60),
        word('section', 50, 60),
        word('Alpha', 10, 200),
        word('section', 50, 200),
      ]),
    ];
    const { matches } = assignInventory(pages, [
      { path: '/toc', text: 'Alpha section', optional: true },
      { path: '/h', text: 'Alpha section' },
    ]);
    expect(
      matches.map((m) => [m.status, m.occurrences[0]?.parts[0].yMin])
    ).toEqual([
      ['mapped', 60],
      ['mapped', 200],
    ]);
  });

  it('skips an optional entry the page lacks instead of calling it missing', () => {
    const { matches } = assignInventory(
      [page([word('Other', 10, 40)])],
      [
        { path: '/toc', text: 'Collected elsewhere', optional: true },
        { path: '/p', text: 'Really absent text' },
      ]
    );
    expect(matches.map((m) => m.status)).toEqual(['skipped', 'missing']);
  });

  it('matches a contents line that the field prefixed with a heading number', () => {
    const pages = [
      page([
        word('1.2', 10, 60),
        word('Alpha', 40, 60),
        word('section', 80, 60),
        word('Alpha', 10, 200),
        word('section', 50, 200),
      ]),
    ];
    const { matches } = assignInventory(pages, [
      { path: '/toc', text: 'Alpha section', optional: true },
      { path: '/h', text: 'Alpha section' },
    ]);
    expect(matches.map((m) => m.occurrences[0]?.parts[0].yMin)).toEqual([
      60, 200,
    ]);
  });

  it('hands a lone occurrence to the authored entry, releasing the optional claim', () => {
    const { matches } = assignInventory(
      [page([word('Alpha', 10, 200), word('section', 50, 200)])],
      [
        { path: '/toc', text: 'Alpha section', optional: true },
        { path: '/h', text: 'Alpha section' },
      ]
    );
    expect(matches.map((m) => m.status)).toEqual(['skipped', 'mapped']);
    expect(matches[1].occurrences[0].parts[0].yMin).toBe(200);
  });
});
