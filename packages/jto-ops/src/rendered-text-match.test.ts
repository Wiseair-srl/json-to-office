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
