import { describe, expect, it } from 'vitest';
import { collectDocxTextInventory } from './text-inventory';

describe('collectDocxTextInventory', () => {
  it('lists every painted string in reading order with its role and pointer', () => {
    const entries = collectDocxTextInventory([
      { name: 'heading', props: { text: 'Results', level: 2 } },
      { name: 'paragraph', props: { text: 'Revenue grew.' } },
      { name: 'list', props: { items: ['One', { text: 'Two', level: 1 }] } },
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'Metric' },
              cells: [{ content: 'Revenue' }, { content: 'Margin' }],
            },
            {
              header: { content: 'FY26' },
              cells: [
                { content: '12' },
                { content: { name: 'paragraph', props: { text: 'n/a' } } },
              ],
            },
          ],
        },
      },
      { name: 'statistic', props: { number: '42%', description: 'share' } },
      { name: 'image', props: { src: 'a.png', caption: 'Figure 1' } },
    ]);
    expect(entries.map((e) => [e.order, e.role, e.path, e.text])).toEqual([
      [0, 'heading', '/children/0/props/text', 'Results'],
      [1, 'body', '/children/1/props/text', 'Revenue grew.'],
      [2, 'list-item', '/children/2/props/items/0', 'One'],
      [3, 'list-item', '/children/2/props/items/1/text', 'Two'],
      [
        4,
        'table-header',
        '/children/3/props/columns/0/header/content',
        'Metric',
      ],
      [5, 'table-header', '/children/3/props/columns/1/header/content', 'FY26'],
      [
        6,
        'table-cell',
        '/children/3/props/columns/0/cells/0/content',
        'Revenue',
      ],
      [7, 'table-cell', '/children/3/props/columns/1/cells/0/content', '12'],
      [
        8,
        'table-cell',
        '/children/3/props/columns/0/cells/1/content',
        'Margin',
      ],
      [
        9,
        'body',
        '/children/3/props/columns/1/cells/1/content/props/text',
        'n/a',
      ],
      [10, 'statistic', '/children/4/props/number', '42%'],
      [11, 'statistic', '/children/4/props/description', 'share'],
      [12, 'caption', '/children/5/props/caption', 'Figure 1'],
    ]);
    expect(entries[0].level).toBe(2);
  });

  it('skips disabled subtrees, empty strings and strings the page never shows', () => {
    const entries = collectDocxTextInventory([
      { name: 'paragraph', props: { text: '  ' } },
      { name: 'paragraph', enabled: false, props: { text: 'hidden' } },
      { name: 'image', props: { src: 'logo.png', alt: 'Logo' } },
      { name: 'paragraph', props: { text: 'shown', color: '#FF0000' } },
    ]);
    expect(entries.map((e) => e.text)).toEqual(['shown']);
  });

  it('marks section header and footer text as repeating chrome, headings included', () => {
    const entries = collectDocxTextInventory([
      {
        name: 'section',
        props: {
          header: [
            { name: 'heading', props: { text: 'Client report', level: 3 } },
          ],
          footer: [{ name: 'paragraph', props: { text: 'Page {PAGE}' } }],
        },
        children: [{ name: 'paragraph', props: { text: 'Body' } }],
      },
    ]);
    // A heading in a running header repeats on every page; calling it a
    // heading would read as one stranded at the foot of each of them.
    expect(entries[0].level).toBeUndefined();
    expect(entries.map((e) => [e.role, e.path, e.repeats ?? false])).toEqual([
      ['chrome', '/children/0/props/header/0/props/text', true],
      ['chrome', '/children/0/props/footer/0/props/text', true],
      ['body', '/children/0/children/0/props/text', false],
    ]);
  });

  it('treats a table in a running footer as chrome, cells and all', () => {
    const entries = collectDocxTextInventory([
      {
        name: 'section',
        props: {
          footer: [
            {
              name: 'table',
              props: {
                columns: [
                  { cells: [{ content: 'Confidential' }] },
                  {
                    cells: [
                      {
                        content: {
                          name: 'heading',
                          props: { text: 'Page {PAGE}', level: 4 },
                        },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        },
        children: [{ name: 'paragraph', props: { text: 'Body' } }],
      },
    ]);
    expect(entries.map((e) => [e.role, e.repeats ?? false, e.text])).toEqual([
      ['chrome', true, 'Confidential'],
      ['chrome', true, 'Page {PAGE}'],
      ['body', false, 'Body'],
    ]);
  });

  it('carries the declared width of a framed paragraph in points, never its height', () => {
    const [entry] = collectDocxTextInventory([
      {
        name: 'paragraph',
        props: {
          text: 'Framed',
          floating: {
            width: 2880,
            height: 1440,
            horizontalPosition: { offset: 720 },
            verticalPosition: { offset: 1440 },
          },
        },
      },
    ]);
    expect(entry.frame).toEqual({ widthPt: 144 });
  });

  it('inventories a contents field as optional entries where it renders, headings in range only', () => {
    const entries = collectDocxTextInventory([
      { name: 'toc', props: { title: 'Contents', depth: { to: 2 } } },
      { name: 'heading', props: { text: 'Alpha', level: 1 } },
      { name: 'heading', props: { text: 'Beta', level: 2 } },
      { name: 'heading', props: { text: 'Gamma', level: 3 } },
    ]);
    expect(
      entries.map((e) => [e.order, e.role, e.text, e.path, e.optional ?? false])
    ).toEqual([
      [0, 'toc-entry', 'Contents', '/children/0/props/title', false],
      [1, 'toc-entry', 'Alpha', '/children/0', true],
      [2, 'toc-entry', 'Beta', '/children/0', true],
      [3, 'heading', 'Alpha', '/children/1/props/text', false],
      [4, 'heading', 'Beta', '/children/2/props/text', false],
      [5, 'heading', 'Gamma', '/children/3/props/text', false],
    ]);
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
  });

  it('restricts a contents field inside a section to that section unless told otherwise', () => {
    const doc = (scope?: string) => [
      {
        name: 'section',
        props: {},
        children: [
          { name: 'toc', props: { ...(scope && { scope }) } },
          { name: 'heading', props: { text: 'Inside', level: 1 } },
        ],
      },
      {
        name: 'section',
        props: {},
        children: [{ name: 'heading', props: { text: 'Outside', level: 1 } }],
      },
    ];
    const tocEntries = (scope?: string) =>
      collectDocxTextInventory(doc(scope))
        .filter((e) => e.role === 'toc-entry')
        .map((e) => e.text);
    expect(tocEntries()).toEqual(['Inside']);
    expect(tocEntries('section')).toEqual(['Inside']);
    expect(tocEntries('document')).toEqual(['Inside', 'Outside']);
  });

  it('inventories the title and axis titles a native chart draws, not its labels', () => {
    const entries = collectDocxTextInventory([
      {
        name: 'chart',
        props: {
          type: 'bar',
          title: 'Revenue by quarter',
          valAxisTitle: 'EUR m',
          data: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [1, 2] }],
          caption: 'Figure 1',
        },
      },
    ]);
    expect(entries.map((e) => [e.text, e.path, e.role])).toEqual([
      ['Revenue by quarter', '/children/0/props/title', 'caption'],
      ['EUR m', '/children/0/props/valAxisTitle', 'caption'],
      ['Figure 1', '/children/0/props/caption', 'caption'],
    ]);
  });

  it('leaves out a hidden chart title and the axis titles of a chart without axes', () => {
    const entries = collectDocxTextInventory([
      {
        name: 'chart',
        props: {
          type: 'pie',
          title: 'Share',
          showTitle: false,
          valAxisTitle: 'Never drawn',
          data: [{ name: 'S', labels: ['a'], values: [1] }],
        },
      },
    ]);
    expect(entries).toEqual([]);
  });

  it('includes style-mapped paragraphs among a contents field entries whatever their level', () => {
    const entries = collectDocxTextInventory([
      {
        name: 'toc',
        props: {
          depth: { to: 1 },
          styles: [{ styleId: 'boxTitle', level: 2 }],
        },
      },
      {
        name: 'paragraph',
        props: { text: 'Key finding', themeStyle: 'boxTitle' },
      },
      { name: 'paragraph', props: { text: 'Plain body', themeStyle: 'body' } },
      { name: 'heading', props: { text: 'Deep', level: 3 } },
    ]);
    expect(
      entries.filter((e) => e.role === 'toc-entry').map((e) => e.text)
    ).toEqual(['Key finding']);
  });

  it('never collects a heading inside a table cell into a contents field', () => {
    const entries = collectDocxTextInventory([
      { name: 'toc', props: {} },
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'H' },
              cells: [
                {
                  content: {
                    name: 'heading',
                    props: { text: 'Cell heading', level: 1 },
                  },
                },
              ],
            },
          ],
        },
      },
    ]);
    expect(entries.filter((e) => e.role === 'toc-entry')).toEqual([]);
  });
});
