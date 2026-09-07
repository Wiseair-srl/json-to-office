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
});
