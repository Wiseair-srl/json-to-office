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

  it('follows a paragraph onto a page past the rotated axis title of the chart on it', () => {
    // Measured off the report matrix on Ubuntu's LibreOffice: the notes run
    // from one page onto the next, which opens above a chart. Read at the
    // top of that page, the axis title parted the two halves and the notes
    // read as cut off.
    const turned = [
      page([
        word('Revenue', 10, 700),
        word('grew', 50, 700),
        word('across', 90, 700),
      ]),
      page([
        word('Sales', 87, 300, 11, 30),
        word('(€m)', 87, 270, 11, 26),
        word('every', 10, 60),
        word('region', 50, 60),
      ]),
    ];
    const { matches } = assignInventory(turned, [
      { path: '/p', text: 'Revenue grew across every region' },
      { path: '/axis', text: 'Sales (€m)' },
    ]);
    expect(
      matches.map((m) => [
        m.status,
        m.partial,
        m.occurrences[0].pageIndex,
        m.occurrences[0].endPageIndex,
      ])
    ).toEqual([
      ['mapped', undefined, 0, 1],
      ['mapped', undefined, 1, 1],
    ]);
  });

  it('never runs upright text on into the rotated text the stream sets after it', () => {
    // The document's last upright words and a rotated title are neighbours
    // in the stream only. The paragraph's tail did not render.
    const pages = [
      page([
        word('Quarterly', 10, 700),
        word('revenue', 50, 700),
        word('grew', 90, 700),
        word('twelve', 300, 400, 11, 40),
        word('percent', 300, 350, 11, 45),
      ]),
    ];
    const { matches } = assignInventory(pages, [
      { path: '/p', text: 'Quarterly revenue grew twelve percent' },
    ]);
    expect([matches[0].status, matches[0].partial]).toEqual([
      'mapped',
      { matchedChars: 20, totalChars: 33 },
    ]);
  });

  it("never runs one page's rotated text on into the next page's", () => {
    const pages = [
      page([word('Sales', 300, 400, 11, 30)]),
      page([word('volumes', 300, 400, 11, 45)]),
    ];
    const { matches } = assignInventory(pages, [
      { path: '/axis', text: 'Sales volumes' },
    ]);
    expect(matches[0].status).toBe('missing');
  });

  it('keeps its place in the page after taking a rotated axis title', () => {
    // The second "Total" is a cell the inventory does not hold; the entry
    // after "Margin" is the third. Taking the axis title, which the stream
    // sets after every page, must not send reading back to the first free
    // "Total".
    const pages = [
      page([
        word('Total', 10, 100),
        word('Total', 10, 200),
        word('Margin', 10, 250),
        word('Total', 10, 300),
        word('Sales', 300, 300, 11, 30),
      ]),
    ];
    const { matches } = assignInventory(pages, [
      { path: '/a', text: 'Total' },
      { path: '/m', text: 'Margin' },
      { path: '/axis', text: 'Sales' },
      { path: '/b', text: 'Total' },
    ]);
    expect(matches.map((m) => m.occurrences[0].parts[0].words)).toEqual([
      [0],
      [2],
      [4],
      [3],
    ]);
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

describe('assignInventory on lines the reading order takes for a table', () => {
  // A memo header: label and value set on one line by a tab, line under
  // line. Two lines of two fragments read as a table, column by column.
  const memo = page([
    word('From', 72, 100, 28),
    word('Finance', 130, 100, 50),
    word('team', 185, 100, 30),
    word('Date', 72, 115, 25),
    word('September', 130, 115, 60),
    word('2026', 195, 115, 30),
  ]);

  it('finds each line in the rows as they lie, and leaves the reading order alone', () => {
    expect(readingOrder(memo.words).map((i) => memo.words[i].text)).toEqual([
      'From',
      'Date',
      'Finance',
      'team',
      'September',
      '2026',
    ]);
    const { matches } = assignInventory(
      [memo],
      [
        { path: '/from', text: '**From**\tFinance team' },
        { path: '/date', text: '**Date**\tSeptember 2026' },
      ]
    );
    expect(matches.map((m) => m.status)).toEqual(['mapped', 'mapped']);
    expect(matches[1].occurrences[0].parts[0].words).toEqual([3, 4, 5]);
  });

  it('still hands each cell of a real table its own occurrence', () => {
    const { matches } = assignInventory(
      [memo],
      [
        { path: '/a', text: 'From' },
        { path: '/b', text: 'Date' },
        { path: '/c', text: 'Finance team' },
        { path: '/d', text: 'September 2026' },
      ]
    );
    expect(matches.map((m) => m.status)).toEqual([
      'mapped',
      'mapped',
      'mapped',
      'mapped',
    ]);
  });

  it('never takes a line whose words another string already holds', () => {
    const { matches } = assignInventory(
      [memo],
      [
        { path: '/date-label', text: 'Date' },
        { path: '/line', text: 'Date September 2026' },
      ]
    );
    expect(matches.map((m) => m.status)).toEqual(['mapped', 'missing']);
  });
});

describe('assignInventory where the format knows the page and the box', () => {
  // A 16:9 slide; geometry below is measured off verification-set decks
  // whose every clip and spill finding turned out to be one of these.
  const slide = (words: PdfTextWord[]): PdfTextPage => ({
    widthPt: 960,
    heightPt: 540,
    words,
    lines: [],
  });

  it('never hands out a word another entry already holds', () => {
    // The title claims its whole line first, so the "Revenue" inside it is
    // taken; the tracker that says "Revenue" keeps the one it painted.
    const pages = [
      page([
        word('Q3', 10, 100),
        word('revenue', 50, 100),
        word('missed', 90, 100),
        word('Revenue', 10, 300),
      ]),
    ];
    const { matches } = assignInventory(pages, [
      { path: '/title', text: 'Q3 revenue missed' },
      { path: '/tracker', text: 'Revenue' },
    ]);
    expect(matches.map((m) => m.occurrences[0].parts[0].words)).toEqual([
      [0, 1, 2],
      [3],
    ]);
  });

  it('takes a tracker from its own box, not from the title under it that opens with the same word', () => {
    // Reading order takes the title's column before the tracker's, and the
    // tracker comes first in the deck, so order alone hands it the title's
    // first word — and the title, its start taken, reads as ambiguous.
    const pages = [
      slide([
        word('REVENUE', 882, 25, 42, 12),
        word('Revenue', 36, 49, 117, 31),
        word('missed', 160, 49, 97, 31),
        word('plan', 264, 49, 58, 31),
      ]),
    ];
    const { matches } = assignInventory(pages, [
      {
        path: '/children/0/children/0/props/slots/tracker',
        text: 'Revenue',
        page: 0,
        region: { xMin: 658, yMin: 24, xMax: 924, yMax: 46 },
      },
      {
        path: '/children/0/children/0/props/slots/title',
        text: 'Revenue missed plan',
        page: 0,
        region: { xMin: 36, yMin: 49, xMax: 924, yMax: 142 },
      },
    ]);
    expect(
      matches.map((m) => [m.status, m.occurrences[0].parts[0].words, m.partial])
    ).toEqual([
      ['mapped', [0], undefined],
      ['mapped', [1, 2, 3], undefined],
    ]);
  });

  it("looks for a slide's text on its own slide only", () => {
    // "13 pts" on one slide and "+1.3 pts" on another fold to the same
    // needle. Neither may take the other's words, and a delta whose slide
    // shows nothing is missing there — not mapped onto a slide it is not on.
    const pages = [
      slide([word('13', 492, 262, 36, 36), word('pts', 537, 262, 48, 36)]),
      slide([word('+1.3', 264, 303, 30, 15), word('pts', 298, 303, 20, 15)]),
      slide([word('Other', 36, 49)]),
    ];
    const { matches } = assignInventory(pages, [
      { path: '/value', text: '13 pts', page: 0 },
      { path: '/delta', text: '+1.3 pts', page: 1 },
      { path: '/gone', text: '+1.3 pts', page: 2 },
    ]);
    expect(
      matches.map((m) => [
        m.entry.path,
        m.status,
        m.occurrences.map((o) => o.pageIndex),
      ])
    ).toEqual([
      ['/value', 'mapped', [0]],
      ['/delta', 'mapped', [1]],
      ['/gone', 'missing', []],
    ]);
  });

  it('finds slide text that overflowed its box onto the figure under it', () => {
    // Measured off a stock deck filled past its box: the label hard-wraps
    // mid-word and its last lines land on the figure underneath, on the same
    // row. No stretch of the stream spells it, so it read as never rendered;
    // down its box's column, skipping the figure it covers, it is all there.
    const pages = [
      slide([
        word('strateg', 626, 293, 60, 26),
        word('y', 676, 315, 10, 26),
        word('+100%', 626, 331, 60, 25),
        word('ZQJTO', 626, 336, 60, 26),
        word('B9X', 651, 358, 35, 26),
      ]),
    ];
    const { matches } = assignInventory(pages, [
      {
        path: '/label',
        text: 'strategy ZQJTOB9X',
        page: 0,
        region: { xMin: 615.7, yMin: 289.7, xMax: 691.1, yMax: 317.1 },
      },
      {
        path: '/figure',
        text: '+100%',
        page: 0,
        region: { xMin: 615.7, yMin: 329, xMax: 691.1, yMax: 360 },
      },
    ]);
    expect(
      matches.map((m) => [
        m.entry.path,
        m.status,
        m.occurrences[0]?.parts[0].words,
      ])
    ).toEqual([
      ['/label', 'mapped', [0, 1, 3, 4]],
      ['/figure', 'mapped', [2]],
    ]);
  });

  it('holds the words of overflowed slide text against a later entry that spells them', () => {
    const pages = [
      slide([
        word('strateg', 626, 293, 60, 26),
        word('y', 676, 315, 10, 26),
        word('+100%', 626, 331, 60, 25),
        word('ZQJTO', 626, 336, 60, 26),
        word('B9X', 651, 358, 35, 26),
      ]),
    ];
    const { matches } = assignInventory(pages, [
      {
        path: '/label',
        text: 'strategy ZQJTOB9X',
        page: 0,
        region: { xMin: 615.7, yMin: 289.7, xMax: 691.1, yMax: 317.1 },
      },
      { path: '/other', text: 'ZQJTO B9X', page: 0 },
    ]);
    expect(
      matches.map((m) => [
        m.entry.path,
        m.status,
        m.occurrences[0]?.parts[0].words,
      ])
    ).toEqual([
      ['/label', 'mapped', [0, 1, 3, 4]],
      ['/other', 'ambiguous', [3, 4]],
    ]);
  });

  it("does not run a slide's text on into the next slide", () => {
    // The box's last words did not render; the next slide happens to open
    // with them. That is a clip on this slide, not the text in full.
    const pages = [
      slide([
        word('Revenue', 36, 49),
        word('grew', 70, 49),
        word('across', 104, 49),
        word('every', 138, 49),
        word('region', 172, 49),
      ]),
      slide([word('this', 36, 49), word('quarter', 70, 49)]),
    ];
    const { matches } = assignInventory(pages, [
      {
        path: '/p',
        text: 'Revenue grew across every region this quarter',
        page: 0,
      },
    ]);
    expect([
      matches[0].status,
      matches[0].partial,
      matches[0].occurrences[0].endPageIndex,
    ]).toEqual(['mapped', { matchedChars: 28, totalChars: 39 }, 0]);
  });

  it('never lands slide text on the same words in another box', () => {
    // Two boxes of one slide open with the same sentence. The first box's
    // words do not come out in order, so its own occurrence cannot be read;
    // the second box's words spell it, and taking them reported a spill of
    // the whole distance between the two boxes.
    const pages = [
      slide([
        word('Lorem', 534, 330, 28, 13),
        word('ipsum', 565, 330, 28, 13),
        word('dolor', 596, 330, 24, 13),
        word('sit', 623, 330, 12, 13),
      ]),
    ];
    const { matches } = assignInventory(pages, [
      {
        path: '/top',
        text: 'Lorem ipsum dolor sit',
        page: 0,
        region: { xMin: 531, yMin: 62, xMax: 684, yMax: 94 },
      },
    ]);
    expect([matches[0].status, matches[0].occurrences]).toEqual([
      'missing',
      [],
    ]);
  });

  it('does not spell a slide text out of words scattered down its column', () => {
    const pages = [
      slide([
        word('Revenue', 36, 100),
        word('Q1', 36, 120),
        word('Q2', 36, 140),
        word('Q3', 36, 160),
        word('growth', 36, 180),
      ]),
    ];
    const { matches } = assignInventory(pages, [
      {
        path: '/p',
        text: 'Revenue growth',
        page: 0,
        region: { xMin: 30, yMin: 95, xMax: 200, yMax: 115 },
      },
    ]);
    expect(matches[0].status).toBe('missing');
  });

  it('does not call a slide text cut off on the strength of a prefix another slide painted', () => {
    const pages = [
      slide([
        word('Revenue', 36, 49),
        word('grew', 70, 49),
        word('twelve', 104, 49),
        word('percent', 138, 49),
      ]),
      slide([word('Other', 36, 49)]),
    ];
    const { matches } = assignInventory(pages, [
      { path: '/p', text: 'Revenue grew twelve percent this year', page: 1 },
    ]);
    expect([matches[0].status, matches[0].partial]).toEqual([
      'missing',
      undefined,
    ]);
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

  // An accessibility audit's findings table, measured off a report in the
  // #409 verification set: the ID, issue and success-criterion cells of
  // rows S10 to S12. The journey and effort cells part from them at a wide
  // gap and take no part here. In S11 the issue cell's first line ends 1.8pt
  // short of the criterion cell, in a row whose spaces are 2.6, so poppler
  // ran the two cells into one fragment.
  const auditRows = [
    word('S10', 72.1, 660.95, 16.87, 10.6),
    word('Non-descriptive', 94.05, 660.95, 65.95, 10.6),
    word('link', 162.61, 660.95, 14.24, 10.6),
    word('text', 179.49, 660.95, 15.32, 10.6),
    word('("click', 197.42, 660.95, 24.99, 10.6),
    word('here")', 225.06, 660.95, 25.54, 10.6),
    word('throughout', 253.23, 660.95, 45.39, 10.6),
    word('2.4.4', 307.4, 660.95, 21.07, 10.6),
    word('Link', 331.12, 660.95, 17.4, 10.6),
    word('Purpose', 351.16, 660.95, 35.36, 10.6),
    word('(In', 389.17, 660.95, 11.07, 10.6),
    word('the', 94.05, 671.85, 13.18, 10.6),
    word('help', 109.84, 671.85, 17.96, 10.6),
    word('centre', 130.42, 671.85, 26.41, 10.6),
    word('Context)', 307.4, 671.85, 35.84, 10.6),
    word('S11', 72.1, 691.25, 16.87, 10.6),
    word('Custom', 94.05, 691.25, 32.7, 10.6),
    word('plan-selector', 129.38, 691.25, 54.33, 10.6),
    word('dropdown', 186.34, 691.25, 41.71, 10.6),
    word('is', 230.7, 691.25, 6.85, 10.6),
    word('not', 240.19, 691.25, 13.18, 10.6),
    word('operable', 256.02, 691.25, 36.91, 10.6),
    word('by', 295.58, 691.25, 10.04, 10.6),
    word('2.1.1', 307.4, 691.25, 21.07, 10.6),
    word('Keyboard', 331.12, 691.25, 40.65, 10.6),
    word('keyboard', 94.05, 702.15, 39.03, 10.6),
    word('S12', 72.1, 721.55, 16.87, 10.6),
    word('Pricing', 94.05, 721.55, 29.01, 10.6),
    word('tiers', 125.68, 721.55, 17.93, 10.6),
    word('are', 146.25, 721.55, 13.73, 10.6),
    word('shown', 162.59, 721.55, 27.47, 10.6),
    word('as', 192.67, 721.55, 10.04, 10.6),
    word('images', 205.35, 721.55, 30.59, 10.6),
    word('of', 238.58, 721.55, 7.93, 10.6),
    word('text', 249.12, 721.55, 15.31, 10.6),
    word('with', 267.05, 721.55, 16.87, 10.6),
    word('no', 286.57, 721.55, 10.57, 10.6),
    word('1.4.5', 307.4, 721.55, 21.07, 10.6),
    word('Images', 331.12, 721.55, 31.13, 10.6),
    word('of', 364.89, 721.55, 7.89, 10.6),
    word('Text', 375.43, 721.55, 18.47, 10.6),
    word('text', 94.05, 732.45, 15.28, 10.6),
    word('alternative', 111.98, 732.45, 43.75, 10.6),
  ];
  it('parts two cells run together at a gap narrower than a space, where the rows around them start a column', () => {
    // Read as one fragment, the S11 cells took "keyboard" into a column of
    // their own, and the row under them read it out after the criterion:
    // "operable by 2.1.1 Keyboard keyboard" (#471).
    const order = readingOrder(auditRows).map((i) => auditRows[i].text);
    expect(order[order.indexOf('by') + 1]).toBe('keyboard');
    expect(
      order.slice(order.indexOf('2.1.1'), order.indexOf('2.1.1') + 3)
    ).toEqual(['2.1.1', 'Keyboard', '1.4.5']);
    const { matches } = assignInventory(
      [page(auditRows)],
      [
        {
          path: '/issue',
          text: 'Custom plan-selector dropdown is not operable by keyboard',
        },
        { path: '/criterion', text: '2.1.1 Keyboard' },
      ]
    );
    expect(matches.map((m) => [m.status, m.partial])).toEqual([
      ['mapped', undefined],
      ['mapped', undefined],
    ]);
  });

  it('parts three cells run together, the ID cell among them', () => {
    // The next page of the same audit. M10's ID ends 3.51pt before its
    // issue, a hair under the third of a line a gap must pass to part two
    // cells, and the issue's first line ends 0.21pt before the criterion,
    // so all three cells came out as one fragment and the issue matched
    // only up to "can be" (#471).
    const rows = [
      word('M9', 72.1, 509.2, 13.19, 10.6),
      word('Error-summary', 94.05, 509.2, 63.29, 10.6),
      word('links', 159.98, 509.2, 18.99, 10.6),
      word('do', 181.61, 509.2, 10.54, 10.6),
      word('not', 194.8, 509.2, 13.17, 10.6),
      word('move', 210.62, 509.2, 23.23, 10.6),
      word('focus', 236.46, 509.2, 22.69, 10.6),
      word('to', 261.79, 509.2, 7.92, 10.6),
      word('the', 272.33, 509.2, 13.21, 10.6),
      word('2.4.3', 307.4, 509.2, 21.07, 10.6),
      word('Focus', 331.12, 509.2, 25.84, 10.6),
      word('Order', 359.6, 509.2, 24.26, 10.6),
      word('associated', 94.05, 520.1, 45.36, 10.6),
      word('field', 142.06, 520.1, 17.42, 10.6),
      word('M10', 72.1, 539.5, 18.44, 10.6),
      word('Notification', 94.05, 539.5, 46.94, 10.6),
      word('banner', 143.6, 539.5, 29.59, 10.6),
      word('auto-dismisses', 175.82, 539.5, 63.31, 10.6),
      word('before', 241.74, 539.5, 26.95, 10.6),
      word('it', 271.3, 539.5, 4.73, 10.6),
      word('can', 278.68, 539.5, 15.29, 10.6),
      word('be', 296.62, 539.5, 10.57, 10.6),
      word('2.2.1', 307.4, 539.5, 21.07, 10.6),
      word('Timing', 331.12, 539.5, 28.47, 10.6),
      word('Adjustable', 362.24, 539.5, 44.3, 10.6),
      word('read', 94.05, 550.4, 18.98, 10.6),
      word('by', 115.68, 550.4, 10.01, 10.6),
      word('a', 128.33, 550.4, 5.28, 10.6),
      word('screen', 136.22, 550.4, 28.52, 10.6),
      word('reader', 167.39, 550.4, 27.41, 10.6),
    ];
    expect(readingOrder(rows).map((i) => rows[i].text)).toEqual([
      'M9',
      'M10',
      'Error-summary',
      'links',
      'do',
      'not',
      'move',
      'focus',
      'to',
      'the',
      'associated',
      'field',
      'Notification',
      'banner',
      'auto-dismisses',
      'before',
      'it',
      'can',
      'be',
      'read',
      'by',
      'a',
      'screen',
      'reader',
      '2.4.3',
      'Focus',
      'Order',
      '2.2.1',
      'Timing',
      'Adjustable',
    ]);
    const { matches } = assignInventory(
      [page(rows)],
      [
        { path: '/id', text: 'M10' },
        {
          path: '/issue',
          text: 'Notification banner auto-dismisses before it can be read by a screen reader',
        },
        { path: '/criterion', text: '2.2.1 Timing Adjustable' },
      ]
    );
    expect(matches.map((m) => [m.status, m.partial])).toEqual([
      ['mapped', undefined],
      ['mapped', undefined],
      ['mapped', undefined],
    ]);
  });

  it('parts cells run together in the first row under a header a padding away', () => {
    // A capacity forecast's levers table. The header sits a cell padding
    // above the first row, too far for one block, so no column is open when
    // that row arrives; and its label is centred on the lines below, so the
    // row is the savings and risk cells alone, run together at a 2.19pt gap
    // among spaces of 2.61. The header and the rows under it set the risk
    // column's edge (#471).
    const levers = [
      word('Lever', 72.1, 408.51, 24, 10.04),
      word('Savings', 162.35, 408.51, 34.48, 10.04),
      word('/', 199.32, 408.51, 2.49, 10.04),
      word('capacity', 204.31, 408.51, 36, 10.04),
      word('relief', 242.8, 408.51, 21.53, 10.04),
      word('Risk', 342.85, 408.51, 19, 10.04),
      word('Adds', 162.35, 428.6, 21.63, 10.6),
      word('roughly', 186.58, 428.6, 31.17, 10.6),
      word('40%', 220.36, 428.6, 19.03, 10.6),
      word('headroom', 241.99, 428.6, 42.78, 10.6),
      word('immediately;', 287.4, 428.6, 53.26, 10.6),
      word('Locks', 342.85, 428.6, 24.79, 10.6),
      word('in', 370.29, 428.6, 7.38, 10.6),
      word('spend', 380.28, 428.6, 25.87, 10.6),
      word('ahead', 408.8, 428.6, 26.37, 10.6),
      word('of', 437.82, 428.6, 7.92, 10.6),
      word('the', 448.36, 428.6, 13.21, 10.6),
      word('Q4', 464.18, 428.6, 12.68, 10.6),
      word('Reserved', 72.1, 439.5, 40.62, 10.6),
      word('capacity', 115.33, 439.5, 34.83, 10.6),
      word('converts', 162.35, 439.5, 35.88, 10.6),
      word('on-demand', 200.83, 439.5, 48.06, 10.6),
      word('spend', 251.5, 439.5, 25.87, 10.6),
      word('to', 280.02, 439.5, 7.92, 10.6),
      word('a', 290.55, 439.5, 5.28, 10.6),
      word('one-year', 298.49, 439.5, 37.44, 10.6),
      word('architecture', 342.85, 439.5, 49.6, 10.6),
      word('review;', 395.06, 439.5, 30.07, 10.6),
      word('becomes', 427.78, 439.5, 38.53, 10.6),
      word('over-', 468.92, 439.5, 21.65, 10.6),
      word('purchase', 72.1, 450.4, 39.03, 10.6),
      word('committed', 162.35, 450.4, 43.77, 10.6),
      word('rate,', 208.77, 450.4, 18.97, 10.6),
      word('saving', 230.39, 450.4, 27.43, 10.6),
      word('about', 260.47, 450.4, 23.72, 10.6),
      word('28%', 286.84, 450.4, 18.99, 10.6),
      word('per', 308.47, 450.4, 13.71, 10.6),
      word('provisioned', 342.85, 450.4, 48.55, 10.6),
      word('if', 394.02, 450.4, 4.73, 10.6),
      word('downsampling', 401.4, 450.4, 60.69, 10.6),
      word('also', 464.71, 450.4, 17.42, 10.6),
      word('lands', 484.78, 450.4, 22.69, 10.6),
      word('as', 510.11, 450.4, 10, 10.6),
      word('unit.', 162.35, 461.3, 17.92, 10.6),
      word('planned.', 342.85, 461.3, 36.4, 10.6),
    ];
    const order = readingOrder(levers).map((i) => levers[i].text);
    expect(order[order.indexOf('immediately;') + 1]).toBe('converts');
    expect(order[order.indexOf('Q4') + 1]).toBe('architecture');
    const { matches } = assignInventory(
      [page(levers)],
      [
        { path: '/lever', text: 'Reserved capacity purchase' },
        {
          path: '/savings',
          text: 'Adds roughly 40% headroom immediately; converts on-demand spend to a one-year committed rate, saving about 28% per unit.',
        },
        {
          path: '/risk',
          text: 'Locks in spend ahead of the Q4 architecture review; becomes over-provisioned if downsampling also lands as planned.',
        },
      ]
    );
    expect(matches.map((m) => [m.status, m.partial])).toEqual([
      ['mapped', undefined],
      ['mapped', undefined],
      ['mapped', undefined],
    ]);
  });

  it('leaves a line of prose under a table whole where a word of it starts on a column edge', () => {
    // The paragraph opens right under the table, and "before" happens to
    // start where the table's second column does. Its spaces are all alike,
    // so no gap in it is a cell boundary; parted there, the line would be
    // read into the table's columns and its second half after "on schedule."
    const prose = [
      word('Owner', 72.1, 100, 27.72, 10.6),
      word('Platform', 153.94, 100, 36.96, 10.6),
      word('team', 193.54, 100, 18.48, 10.6),
      word('Due', 72.1, 110.9, 13.86, 10.6),
      word('Q3', 153.94, 110.9, 9.24, 10.6),
      word('The', 72.1, 121.8, 13.86, 10.6),
      word('renewal', 88.6, 121.8, 32.34, 10.6),
      word('closes', 123.58, 121.8, 27.72, 10.6),
      word('before', 153.94, 121.8, 27.72, 10.6),
      word('the', 184.3, 121.8, 13.86, 10.6),
      word('quarter', 200.8, 121.8, 32.34, 10.6),
      word('ends,', 235.78, 121.8, 23.1, 10.6),
      word('once', 261.52, 121.8, 18.48, 10.6),
      word('the', 282.64, 121.8, 13.86, 10.6),
      word('team', 299.14, 121.8, 18.48, 10.6),
      word('signs', 320.26, 121.8, 23.1, 10.6),
      word('off', 346, 121.8, 13.86, 10.6),
      word('on', 72.1, 132.7, 9.24, 10.6),
      word('schedule.', 83.98, 132.7, 41.58, 10.6),
    ];
    expect(readingOrder(prose).map((i) => prose[i].text)).toEqual([
      'Owner',
      'Due',
      'Platform',
      'team',
      'Q3',
      'The',
      'renewal',
      'closes',
      'before',
      'the',
      'quarter',
      'ends,',
      'once',
      'the',
      'team',
      'signs',
      'off',
      'on',
      'schedule.',
    ]);
  });

  it('leaves prose whole where a run-in head starts on the edge of a table the paragraph does not reach', () => {
    // A policy in the verification corpus sets its run-in heads in bold,
    // and the space before one comes out 0.23pt wider than the paragraph's
    // own: no word space, measured against the row. One such head started
    // 0.15pt off the edge of the table at the top of its page; here it
    // starts on the edge. The table's column does not come down to it,
    // though: "deleted", a line up, lies across the edge.
    const policy = [
      word('Class', 72.1, 100, 23.1, 10.6),
      word('Basis', 149.55, 100, 23.1, 10.6),
      word('Logs', 72.1, 110.9, 18.48, 10.6),
      word('Consent', 149.55, 110.9, 32.34, 10.6),
      word('Records', 72.1, 300, 32.34, 10.6),
      word('are', 107.08, 300, 13.86, 10.6),
      word('deleted', 123.58, 300, 32.34, 10.6),
      word('once', 158.56, 300, 18.48, 10.6),
      word('the', 179.68, 300, 13.86, 10.6),
      word('transaction', 196.18, 300, 50.82, 10.6),
      word('closes,', 249.64, 300, 32.34, 10.6),
      word('typically', 284.62, 300, 41.58, 10.6),
      word('within', 72.1, 310.9, 27.72, 10.6),
      word('two', 102.46, 310.9, 13.86, 10.6),
      word('years.', 118.96, 310.9, 27.72, 10.6),
      word('Resolution.', 149.55, 310.9, 49.39, 10.6),
      word('The', 201.58, 310.9, 13.86, 10.6),
      word('seven-year', 218.08, 310.9, 46.2, 10.6),
      word('period', 266.92, 310.9, 27.72, 10.6),
      word('governs.', 72.1, 321.8, 36.96, 10.6),
    ];
    expect(
      findOccurrences(
        indexDocument([page(policy)]),
        needleSegments(
          'Records are deleted once the transaction closes, typically within two years. **Resolution.** The seven-year period governs.'
        )
      )
    ).toHaveLength(1);
  });

  it('keeps the two lines of small print beside a display title apart', () => {
    // Measured off a stock deck: a 45pt title's word boxes span both lines
    // of the caption set beside it. Rowed with the title, the caption read a
    // word from each of its lines in turn.
    const beside = [
      word('Revenue', 34, 55, 190, 70),
      word('Streams', 240, 55, 188, 70),
      word('Lorem', 534, 70, 28, 13),
      word('ipsum', 565, 70, 28, 13),
      word('dolor', 596, 70, 24, 13),
      word('consectetur', 534, 84, 50, 13),
      word('elit.', 588, 84, 18, 13),
    ];
    expect(readingOrder(beside).map((i) => beside[i].text)).toEqual([
      'Revenue',
      'Streams',
      'Lorem',
      'ipsum',
      'dolor',
      'consectetur',
      'elit.',
    ]);
  });

  it('reads the cells under a line of prose cell by cell, not row by row', () => {
    // A grid of figures right under a paragraph, as a stock deck sets it: the
    // prose line spans all three cells, so one column is already open when
    // the cells arrive. Kept as that one column, every cell's second line was
    // read after its neighbours' first, and no two-line label matched.
    const grid = [
      word('Lorem', 51, 240, 60, 13),
      word('ipsum', 115, 240, 60, 13),
      word('dolor', 179, 240, 51, 13),
      word('76K', 51, 254, 43, 37),
      word('46K', 139, 254, 43, 37),
      word('56K', 228, 254, 43, 37),
      word('Marketing', 51, 291, 42, 13),
      word('Brand', 139, 291, 30, 13),
      word('Direct', 228, 291, 35, 13),
      word('spend', 51, 302, 25, 13),
      word('reach', 139, 302, 25, 13),
      word('sales', 228, 302, 28, 13),
    ];
    expect(readingOrder(grid)).toEqual([0, 1, 2, 3, 6, 9, 4, 7, 10, 5, 8, 11]);
    const index = indexDocument([page(grid)]);
    for (const text of [
      'Lorem ipsum dolor',
      '76K Marketing spend',
      'Brand reach',
      'Direct sales',
    ])
      expect(findOccurrences(index, needleSegments(text))).toHaveLength(1);
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

  it('keeps a short upright word that is taller than it is wide in its place', () => {
    // "it," in a report's body: three characters, 8.5pt wide and 12.8 tall,
    // so a ratio of 1.51. Taken for rotated text it left the page's stream
    // for the run after it and cut the paragraph it sat in (#471).
    const prose = [
      word('connector', 171, 707, 60, 12.8),
      word('stopped', 237, 723, 35, 12.8),
      word('with', 274, 723, 19, 12.8),
      word('it,', 295.8, 723, 8.5, 12.8),
      word('regardless', 306.7, 723, 44, 12.8),
    ];
    expect(readingOrder(prose).map((i) => prose[i].text)).toEqual([
      'connector',
      'stopped',
      'with',
      'it,',
      'regardless',
    ]);
  });

  it('keeps that word upright on a page the smaller text of a table fills', () => {
    // The page-wide size is the table's eight-point labels, which a line of
    // twelve-point prose towers over; what says the word is upright is the
    // line it stands in, not the page (#471).
    const labels = Array.from({ length: 24 }, (_, i) =>
      word(`label${i}`, 72 + (i % 4) * 90, 200 + Math.floor(i / 4) * 10, 40, 8)
    );
    const prose = [
      word('stopped', 237, 723, 35, 12.8),
      word('with', 274, 723, 19, 12.8),
      word('it,', 295.8, 723, 8.5, 12.8),
      word('regardless', 306.7, 723, 44, 12.8),
    ];
    const order = readingOrder([...labels, ...prose]).map(
      (i) => [...labels, ...prose][i].text
    );
    expect(order.slice(-4)).toEqual(['stopped', 'with', 'it,', 'regardless']);
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
      'after',
      '1:',
      'Item68',
      'contracted',
      'recommendation',
      '(€m)',
    ]);
  });

  it('reads a rotated title as one run after the page, never between the lines of a paragraph', () => {
    // A deck's takeaway beside a chart. Poppler emitted the chart's rotated
    // value-axis title between the takeaway's second and third lines; kept
    // in those slots, "held" and "steady." part and the takeaway reads as cut
    // off. "of" is wider than tall, so only poppler's line says it is rotated.
    const words = [
      word('Two', 666, 209, 31, 22),
      word('renewals', 701, 209, 66, 22),
      word('slipped', 771, 209, 52, 22),
      word('into', 666, 232, 29, 22),
      word('Q4;', 699, 232, 26, 22),
      word('demand', 729, 232, 60, 22),
      word('held', 793, 232, 31, 22),
      word('Cost', 52, 330, 11, 25),
      word('of', 52, 318, 11, 8),
      word('ownership', 52, 262, 11, 52),
      word('steady.', 666, 256, 52, 22),
    ];
    const line = (indices: number[]) => ({
      xMin: Math.min(...indices.map((i) => words[i].xMin)),
      yMin: Math.min(...indices.map((i) => words[i].yMin)),
      xMax: Math.max(...indices.map((i) => words[i].xMax)),
      yMax: Math.max(...indices.map((i) => words[i].yMax)),
      words: indices,
    });
    const lines = [
      line([0, 1, 2]),
      line([3, 4, 5, 6]),
      line([7, 8, 9]),
      line([10]),
    ];
    expect(readingOrder(words, lines)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 10, 7, 8, 9,
    ]);
    const index = indexDocument([
      { widthPt: 960, heightPt: 540, words, lines },
    ]);
    expect(
      findOccurrences(
        index,
        needleSegments('Two renewals slipped into Q4; demand held steady.')
      )
    ).toHaveLength(1);
    expect(
      findOccurrences(index, needleSegments('Cost of ownership'))
    ).toHaveLength(1);
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
