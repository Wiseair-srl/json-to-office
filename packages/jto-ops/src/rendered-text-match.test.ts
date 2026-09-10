import { describe, expect, it } from 'vitest';
import type { PdfTextPage, PdfTextWord } from './pdf-text-geometry';
import {
  assignInventory,
  authoredTextForMatch,
  findOccurrences,
  indexDocument,
  needleSegments,
  normalizeForMatch,
  readingOrder,
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

  it('does not let chrome claim a body row that merely repeats its words once, inside the band', () => {
    // A three-page report whose running head reads "Report"; page 2 opens
    // with a body line that also says "Report", 100pt down — inside the
    // generous chrome band, but at a height no other page repeats.
    const three = [
      page([word('Report', 10, 10), word('Intro', 10, 300)]),
      page([
        word('Report', 10, 10),
        word('Report', 10, 100),
        word('summary', 50, 100),
        word('More', 10, 300),
      ]),
      page([word('Report', 10, 10), word('End', 10, 300)]),
    ];
    const { matches, chromeWords } = assignInventory(three, [
      { path: '/h', text: 'Report', repeats: true },
      { path: '/i', text: 'Intro' },
      { path: '/s', text: 'Report summary' },
      { path: '/m', text: 'More' },
      { path: '/e', text: 'End' },
    ]);
    expect(matches.map((m) => [m.entry.path, m.status])).toEqual([
      ['/h', 'mapped'],
      ['/i', 'mapped'],
      ['/s', 'mapped'],
      ['/m', 'mapped'],
      ['/e', 'mapped'],
    ]);
    expect(matches[0].occurrences.map((o) => o.pageIndex)).toEqual([0, 1, 2]);
    expect(chromeWords.has('1:1')).toBe(false);
    expect(chromeWords.has('1:0')).toBe(true);
  });

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

  it('leaves a numeric table row that flowed into the band in the body', () => {
    // The last rows of a table break into the bottom fifth of the page. The
    // label wraps beside them, so each numeric row sits on a row of its own
    // and reads as digits alone — but it is content, not the page number
    // painted below it. Geometry measured off a client report whose cost
    // table lost three cells this way.
    const flowed = [
      page([word('Intro', 72, 300), word('2', 300, 792, 6, 10.6)]),
      page([
        word('Additional', 72, 693.4, 42, 10.6),
        word('recruiting', 116, 693.4, 39, 10.6),
        word('0.45', 328, 698.85, 18, 10.6),
        word('2.2', 510, 698.85, 13, 10.6),
        word('capacity', 72, 704.3, 35, 10.6),
        word('3', 300, 792, 6, 10.6),
      ]),
    ];
    const { matches, chromeWords } = assignInventory(flowed, [
      { path: '/f', text: '{PAGE}', repeats: true },
      { path: '/i', text: 'Intro' },
      { path: '/l', text: 'Additional recruiting capacity' },
      { path: '/c', text: '0.45' },
    ]);
    expect(matches.map((m) => [m.entry.path, m.status])).toEqual([
      ['/f', 'skipped'],
      ['/i', 'mapped'],
      ['/l', 'mapped'],
      ['/c', 'mapped'],
    ]);
    // Only the two bare page numbers are chrome.
    expect([...chromeWords].sort()).toEqual(['0:1', '1:5']);
  });

  it('leaves a lone digit row the rest of the report never repeats in the body', () => {
    // A section opener's number sits alone under the running head, inside
    // the top band. Nothing at its height on any other page is a page
    // number, so it stays where it was written.
    const opener = [
      page([
        word('Report', 72, 33.8, 60, 9.7),
        word('01', 72, 70.4, 12, 9.7),
        word('Opening', 72, 107.7, 45, 9.7),
      ]),
      page([
        word('Report', 72, 33.8, 60, 9.7),
        word('Continued', 72, 107.7, 50, 9.7),
      ]),
    ];
    const { chromeWords } = assignInventory(opener, [
      { path: '/h', text: 'Report', repeats: true },
      { path: '/n', text: '018' },
      { path: '/o', text: 'Opening' },
      { path: '/c', text: 'Continued' },
    ]);
    expect(chromeWords.has('0:1')).toBe(false);
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

describe('readingOrder', () => {
  // Two cells of a table row, each wrapped over two lines, as poppler 24
  // lists them: line by line across the row.
  // The second cell is right-aligned, so its second line starts further
  // right than its first; the third row is the label's third line alone.
  const lineMajor = [
    word('Item72', 36, 275, 30),
    word('ownership', 69, 275, 45),
    word('Item91', 170, 275, 30),
    word('segment', 203, 275, 40),
    word('renewal', 36, 288, 40),
    word('segment', 79, 288, 40),
    word('margin', 205, 288, 45),
    word('tail', 36, 301, 25),
    // A heading a cell padding below the row is not the label's next line.
    word('Heading', 36, 325, 40),
  ];
  it('reads a wrapped table row cell by cell, whatever order poppler gave', () => {
    const order = readingOrder(lineMajor).map((i) => lineMajor[i].text);
    expect(order).toEqual([
      'Item72',
      'ownership',
      'renewal',
      'segment',
      'tail',
      'Item91',
      'segment',
      'margin',
      'Heading',
    ]);
    const index = indexDocument([page(lineMajor)]);
    expect(
      findOccurrences(
        index,
        needleSegments('Item72 ownership renewal segment tail')
      )
    ).toHaveLength(1);
    expect(
      findOccurrences(index, needleSegments('Item91 segment margin'))
    ).toHaveLength(1);
  });
  // Two cells poppler ran together: the padding between the columns is
  // 5pt on a 10.6pt line — under half a line — so the row comes out as one
  // fragment spanning both. Geometry measured off a client report whose
  // third column lost every cell to the second.
  const tightColumns = [
    // The wide cell's first line, reaching 419, then the narrow cell's.
    word('Depot', 135, 369, 40, 10.6),
    word('consolidation', 178, 369, 60, 10.6),
    word('for', 241, 369, 20, 10.6),
    word('overlap', 264, 369, 45, 10.6),
    word('depots;', 312, 369, 38, 10.6),
    word('dispatch', 353, 369, 66, 10.6),
    word('Go/no-go:', 424, 369, 42, 10.6),
    word('fund', 469, 369, 18, 10.6),
    // The next line of each cell; here the gap is 6pt and poppler split it.
    word('system', 135, 380, 30, 10.6),
    word('approved', 168, 380, 60, 10.6),
    word('by', 231, 380, 15, 10.6),
    word('the', 249, 380, 18, 10.6),
    word('steering', 270, 380, 40, 10.6),
    word('committee', 313, 380, 45, 10.6),
    word('and', 361, 380, 20, 10.6),
    word('budget', 384, 380, 34, 10.6),
    word('launch', 424, 380, 28, 10.6),
    word('dispatch', 455, 380, 35, 10.6),
    // Each cell's last line.
    word('committee.', 135, 391, 47, 10.6),
    word('migration', 424, 391, 39, 10.6),
  ];
  it('parts two cells poppler ran together at a gap the row cannot spare', () => {
    const order = readingOrder(tightColumns).map((i) => tightColumns[i].text);
    expect(order.slice(-5)).toEqual([
      'Go/no-go:',
      'fund',
      'launch',
      'dispatch',
      'migration',
    ]);
    const index = indexDocument([page(tightColumns)]);
    expect(
      findOccurrences(
        index,
        needleSegments('Go/no-go: fund launch dispatch migration')
      )
    ).toHaveLength(1);
    expect(
      findOccurrences(
        index,
        needleSegments(
          'Depot consolidation for overlap depots; dispatch system approved by the steering committee and budget committee.'
        )
      )
    ).toHaveLength(1);
  });

  it('parts a wrapped label from the value centred between its lines', () => {
    // One label column and one value column. The label wraps, the value is
    // centred against the wrap, and so every row here carries a single
    // fragment: the block is a block because the rows resolve into two
    // columns, not because any one row holds two cells.
    const centred = [
      word('Retention', 72, 123.8, 45, 10.6),
      word('programme', 120, 123.8, 50, 10.6),
      word('0.45', 400, 129.3, 18, 10.6),
      word('for', 72, 134.7, 12, 10.6),
      word('everyone', 87, 134.7, 40, 10.6),
    ];
    expect(readingOrder(centred).map((i) => centred[i].text)).toEqual([
      'Retention',
      'programme',
      'for',
      'everyone',
      '0.45',
    ]);
    const index = indexDocument([page(centred)]);
    expect(
      findOccurrences(index, needleSegments('Retention programme for everyone'))
    ).toHaveLength(1);
    expect(findOccurrences(index, needleSegments('0.45'))).toHaveLength(1);
  });

  it('leaves justified prose whole, however wide its spaces are stretched', () => {
    // Justification stretches every space of a line alike, so a stretched
    // line's widest space is still its own median: the rule that parts
    // cells at a gap the row cannot account for must not part a line of
    // prose. Line one is stretched to 4pt spaces on a 10.6pt line — past a
    // third of it, which is the floor — and line two is set at 2.6pt.
    const justified = [
      word('Revenue', 72, 100, 45, 10.6),
      word('grew', 121, 100, 25, 10.6),
      word('across', 150, 100, 35, 10.6),
      word('every', 189, 100, 30, 10.6),
      word('region', 72, 111, 35, 10.6),
      word('in', 109.6, 111, 12, 10.6),
      word('the', 124.2, 111, 18, 10.6),
      word('period.', 72, 122, 32, 10.6),
    ];
    expect(readingOrder(justified).map((i) => justified[i].text)).toEqual([
      'Revenue',
      'grew',
      'across',
      'every',
      'region',
      'in',
      'the',
      'period.',
    ]);
    expect(
      findOccurrences(
        indexDocument([page(justified)]),
        needleSegments('Revenue grew across every region in the period.')
      )
    ).toHaveLength(1);
  });

  it('keeps a rotated axis title in the order poppler gave it', () => {
    const axis = [
      word('Item68', 88, 534, 11, 38),
      word('contracted', 88, 470, 11, 60),
      word('recommendation', 99, 490, 11, 92),
      word('(€m)', 99, 460, 11, 26),
      word('after', 36, 600),
      // Narrow upright words stay upright.
      word('1:', 80, 600, 8, 13),
    ];
    expect(readingOrder(axis).map((i) => axis[i].text)).toEqual([
      'Item68',
      'contracted',
      'recommendation',
      '(€m)',
      'after',
      '1:',
    ]);
  });
  it('leaves prose and a one-line tabbed header as they lie', () => {
    const prose = [
      word('one', 72, 100),
      word('two', 105, 100),
      word('three', 72, 115),
      word('four', 105, 115),
    ];
    expect(readingOrder(prose).map((i) => prose[i].text)).toEqual([
      'one',
      'two',
      'three',
      'four',
    ]);
    const header = [
      word('Title', 72, 40),
      word('Tracker', 480, 40),
      word('Body', 72, 80),
    ];
    expect(readingOrder(header).map((i) => header[i].text)).toEqual([
      'Title',
      'Tracker',
      'Body',
    ]);
  });
});
