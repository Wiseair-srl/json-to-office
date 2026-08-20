import { describe, it, expect } from 'vitest';
import { diffDocuments, type JsonNode } from '../document-diff';

function doc(
  children: JsonNode[],
  props: Record<string, unknown> = {}
): JsonNode {
  return { name: 'docx', props: { theme: 'minimal', ...props }, children };
}

function para(text: string, extra: Record<string, unknown> = {}): JsonNode {
  return { name: 'paragraph', props: { text, ...extra } };
}

describe('diffDocuments', () => {
  it('rejects non-docx roots', () => {
    expect(() => diffDocuments({ name: 'pptx' } as any, doc([]))).toThrow(
      /top-level component must be "docx"/
    );
  });

  it('sets trackRevisions on the output root', () => {
    const { document } = diffDocuments(doc([]), doc([]));
    expect(document.props?.trackRevisions).toBe(true);
  });

  it('identical documents produce no tracked changes', () => {
    const a = doc([para('hello'), para('world')]);
    const { document, summary } = diffDocuments(
      a,
      JSON.parse(JSON.stringify(a))
    );
    expect(summary.tracked).toEqual({ modified: 0, inserted: 0, deleted: 0 });
    expect(summary.untracked).toEqual([]);
    expect(summary.unchangedBlocks).toBe(2);
    expect(document.children).toHaveLength(2);
    expect(document.children?.[0].props?.revision).toBeUndefined();
  });

  it('modified paragraph gets word-level revision segments', () => {
    const { document, summary } = diffDocuments(
      doc([para('The fee is 10% of revenue.')]),
      doc([para('The fee is 12% of revenue.')])
    );
    expect(summary.tracked.modified).toBe(1);
    const revision = document.children?.[0].props?.revision as any;
    expect(revision.segments).toEqual([
      { type: 'equal', text: 'The fee is ' },
      { type: 'delete', text: '10%' },
      { type: 'insert', text: '12%' },
      { type: 'equal', text: ' of revenue.' },
    ]);
    // text prop holds the new text
    expect(document.children?.[0].props?.text).toBe(
      'The fee is 12% of revenue.'
    );
  });

  it('strips markdown before diffing (segments render literally)', () => {
    const { document } = diffDocuments(
      doc([para('grew **30%** fast')]),
      doc([para('grew **32%** fast')])
    );
    const revision = document.children?.[0].props?.revision as any;
    const allText = revision.segments.map((s: any) => s.text).join('');
    expect(allText).not.toContain('**');
  });

  it('markdown in a modified block is reported as flattened', () => {
    const { summary } = diffDocuments(
      doc([para('grew **30%** fast')]),
      doc([para('grew **32%** fast')])
    );
    expect(summary.untracked.some((u) => u.detail.includes('flattened'))).toBe(
      true
    );
  });

  it('plain-text modification reports no flattening', () => {
    const { summary } = diffDocuments(
      doc([para('grew 30% fast')]),
      doc([para('grew 32% fast')])
    );
    expect(summary.untracked).toEqual([]);
  });

  it('inserted paragraph becomes a fully tracked insertion', () => {
    const { document, summary } = diffDocuments(
      doc([para('one')]),
      doc([para('one'), para('two')])
    );
    expect(summary.tracked.inserted).toBe(1);
    const inserted = document.children?.[1].props?.revision as any;
    expect(inserted.segments).toEqual([{ type: 'insert', text: 'two' }]);
  });

  it('deleted paragraph stays in the redline as a tracked deletion', () => {
    const { document, summary } = diffDocuments(
      doc([para('one'), para('two')]),
      doc([para('one')])
    );
    expect(summary.tracked.deleted).toBe(1);
    expect(document.children).toHaveLength(2);
    const deleted = document.children?.[1].props as any;
    expect(deleted.text).toBe('');
    expect(deleted.revision.segments).toEqual([
      { type: 'delete', text: 'two' },
    ]);
  });

  it('pairs same-name neighbours; different components become delete+insert', () => {
    const { document, summary } = diffDocuments(
      doc([para('old text')]),
      doc([{ name: 'heading', props: { text: 'New Title', level: 1 } }])
    );
    // paragraph deleted (tracked), heading inserted (tracked)
    expect(summary.tracked.deleted).toBe(1);
    expect(summary.tracked.inserted).toBe(1);
    expect(document.children).toHaveLength(2);
  });

  it('propagates author and date into revisions', () => {
    const { document } = diffDocuments(doc([para('a')]), doc([para('b')]), {
      author: 'jto-agent',
      date: '2026-06-09T10:00:00Z',
    });
    const revision = document.children?.[0].props?.revision as any;
    expect(revision.author).toBe('jto-agent');
    expect(revision.date).toBe('2026-06-09T10:00:00Z');
  });

  it('diffs list items at item level', () => {
    const { document, summary } = diffDocuments(
      doc([{ name: 'list', props: { items: ['alpha', 'beta', 'gamma'] } }]),
      doc([
        { name: 'list', props: { items: ['alpha', 'beta improved', 'delta'] } },
      ])
    );
    expect(summary.tracked.modified).toBe(1);
    const items = document.children?.[0].props?.items as any[];
    // alpha unchanged, beta modified, gamma deleted+delta inserted (paired)
    expect(items[0]).toEqual({ text: 'alpha', level: 0 });
    expect(items[1].revision.segments).toEqual([
      { type: 'equal', text: 'beta' },
      { type: 'insert', text: ' improved' },
    ]);
    const reconstructed = items
      .flatMap((i) => i.revision?.segments ?? [{ type: 'equal', text: i.text }])
      .filter((s: any) => s.type !== 'delete')
      .map((s: any) => s.text)
      .join('|');
    expect(reconstructed).toContain('delta');
  });

  it('legacy {headers, rows} table stays on the opaque path', () => {
    // That shape is schema-invalid and only survives through a renderer
    // conversion, so the row-level differ deliberately does not touch it.
    const oldTable: JsonNode = {
      name: 'table',
      props: { headers: ['a'], rows: [['1']] },
    };
    const newTable: JsonNode = {
      name: 'table',
      props: { headers: ['a'], rows: [['2']] },
    };
    const { document, summary } = diffDocuments(
      doc([oldTable]),
      doc([newTable])
    );
    expect(summary.tracked.modified).toBe(0);
    expect(summary.untracked).toHaveLength(1);
    expect(summary.untracked[0].component).toBe('table');
    expect(summary.untracked[0].kind).toBe('modified');
    expect((document.children?.[0].props as any).rows).toEqual([['2']]);
  });

  it('deleted legacy table is dropped and reported as untracked', () => {
    const table: JsonNode = { name: 'table', props: { rows: [['x']] } };
    const { document, summary } = diffDocuments(
      doc([para('keep'), table]),
      doc([para('keep')])
    );
    expect(document.children).toHaveLength(1);
    expect(summary.untracked[0].kind).toBe('deleted');
  });

  it('recurses into containers', () => {
    const oldSection: JsonNode = {
      name: 'section',
      props: { title: 'S' },
      children: [para('inner old')],
    };
    const newSection: JsonNode = {
      name: 'section',
      props: { title: 'S' },
      children: [para('inner new')],
    };
    const { document, summary } = diffDocuments(
      doc([oldSection]),
      doc([newSection])
    );
    expect(summary.tracked.modified).toBe(1);
    const inner = document.children?.[0].children?.[0].props?.revision as any;
    expect(inner).toBeDefined();
  });

  it('formatting-only change is untracked, no revision injected', () => {
    const { document, summary } = diffDocuments(
      doc([para('same text', { font: { bold: false } })]),
      doc([para('same text', { font: { bold: true } })])
    );
    expect(summary.tracked.modified).toBe(0);
    expect(summary.untracked).toHaveLength(1);
    expect(document.children?.[0].props?.revision).toBeUndefined();
  });

  it('markdown-only change (e.g. hyperlink target) is surfaced as untracked', () => {
    const { document, summary } = diffDocuments(
      doc([para('see [terms](https://old.example.com)')]),
      doc([para('see [terms](https://new.example.com)')])
    );
    expect(summary.tracked.modified).toBe(0);
    expect(summary.untracked).toHaveLength(1);
    expect(summary.untracked[0].detail).toContain('link target');
    expect(document.children?.[0].props?.revision).toBeUndefined();
  });

  it('unchanged list items keep raw markdown when a sibling changes', () => {
    const shared = ['**bold item** stays', 'see [docs](https://x.com)'];
    const { document } = diffDocuments(
      doc([{ name: 'list', props: { items: [...shared, 'third old'] } }]),
      doc([{ name: 'list', props: { items: [...shared, 'third new'] } }])
    );
    const items = document.children?.[0].props?.items as any[];
    expect(items[0].text).toBe('**bold item** stays');
    expect(items[1].text).toBe('see [docs](https://x.com)');
    expect(items[2].revision).toBeDefined();
  });

  it('NFD vs NFC text compares equal (no phantom changes)', () => {
    const nfd = 'café menu';
    const nfc = 'café menu';
    const { summary } = diffDocuments(doc([para(nfd)]), doc([para(nfc)]));
    expect(summary.tracked.modified).toBe(0);
    expect(summary.untracked).toEqual([]);
  });

  it('enabled false->true is a tracked insertion, true->false a deletion', () => {
    const off = { ...para('clause'), enabled: false };
    const on = para('clause');
    const enabledNow = diffDocuments(doc([off]), doc([on]));
    expect(enabledNow.summary.tracked.inserted).toBe(1);
    const disabledNow = diffDocuments(doc([on]), doc([{ ...off }]));
    expect(disabledNow.summary.tracked.deleted).toBe(1);
    // the emitted deletion node must actually render (not stay disabled)
    expect(disabledNow.document.children?.[0].enabled).not.toBe(false);
  });

  it('deleting a disabled node is silent (it never rendered)', () => {
    const off = { ...para('never shown'), enabled: false };
    const { document, summary } = diffDocuments(
      doc([para('keep'), off]),
      doc([para('keep')])
    );
    expect(summary.tracked.deleted).toBe(0);
    expect(document.children).toHaveLength(1);
  });

  it('placeholders inside changed text are flagged as untracked', () => {
    const { summary } = diffDocuments(
      doc([para('Generated for review')]),
      doc([para('Generated {DATE} for review')])
    );
    expect(
      summary.untracked.some((u) => u.detail.includes('placeholder'))
    ).toBe(true);
  });

  it('summary.notes warns about empty paragraphs left by accept-all', () => {
    const { summary } = diffDocuments(
      doc([para('one'), para('two')]),
      doc([para('one')])
    );
    expect(summary.notes.some((n) => n.includes('empty paragraph'))).toBe(true);
  });

  it('survives large nearly-identical documents (prefix/suffix trim)', () => {
    const many = Array.from({ length: 30000 }, (_, i) => para(`block ${i}`));
    const edited = [...many];
    edited[15000] = para('block 15000 edited');
    const start = Date.now();
    const { summary } = diffDocuments(doc(many), doc(edited));
    expect(Date.now() - start).toBeLessThan(5000);
    expect(summary.tracked.modified).toBe(1);
    expect(summary.unchangedBlocks).toBe(29999);
  });

  it('is deterministic for identical inputs', () => {
    const oldD = doc([para('a b c'), para('x')]);
    const newD = doc([para('a B c'), para('y'), para('z')]);
    const run1 = diffDocuments(oldD, newD, { date: '2026-01-01T00:00:00Z' });
    const run2 = diffDocuments(oldD, newD, { date: '2026-01-01T00:00:00Z' });
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});

describe('column-based table diff', () => {
  const table = (
    rows: string[][],
    extra: Record<string, unknown> = {}
  ): JsonNode => ({
    name: 'table',
    props: {
      columns: [
        {
          header: { content: 'Tier' },
          cells: rows.map((row) => ({ content: row[0] })),
        },
        {
          header: { content: 'Price' },
          cells: rows.map((row) => ({ content: row[1] })),
        },
      ],
      ...extra,
    },
  });

  const rowsOf = (node: JsonNode) =>
    ((node.props as any).columns[0].cells as { content: string }[]).map(
      (cell, index) => [
        cell.content,
        ((node.props as any).columns[1].cells as { content: string }[])[index]
          .content,
      ]
    );

  it('marks an added row as a row insertion', () => {
    const { document, summary } = diffDocuments(
      doc([table([['Basic', '10']])]),
      doc([
        table([
          ['Basic', '10'],
          ['Pro', '25'],
        ]),
      ])
    );

    const result = document.children![0];
    expect(rowsOf(result)).toEqual([
      ['Basic', '10'],
      ['Pro', '25'],
    ]);
    expect((result.props as any).rows).toEqual([
      {},
      { revision: { type: 'insert' } },
    ]);
    expect(summary.tracked.inserted).toBe(1);
  });

  it('keeps a removed row and marks it deleted', () => {
    const { document, summary } = diffDocuments(
      doc([
        table([
          ['Basic', '10'],
          ['Legacy', '15'],
        ]),
      ]),
      doc([table([['Basic', '10']])])
    );

    const result = document.children![0];
    // The row survives in the redline so the reader can see what went.
    expect(rowsOf(result)).toEqual([
      ['Basic', '10'],
      ['Legacy', '15'],
    ]);
    expect((result.props as any).rows).toEqual([
      {},
      { revision: { type: 'delete' } },
    ]);
    expect(summary.tracked.deleted).toBe(1);
  });

  it('turns a rewritten row into cell-level word changes', () => {
    const { document, summary } = diffDocuments(
      doc([table([['Basic', '10']])]),
      doc([table([['Basic', '12']])])
    );

    const result = document.children![0];
    const priceCell = (result.props as any).columns[1].cells[0];
    expect(priceCell.content).toBe('12');
    expect(priceCell.revision.segments).toEqual([
      { type: 'delete', text: '10' },
      { type: 'insert', text: '12' },
    ]);
    // The untouched cell is left exactly as authored.
    expect((result.props as any).columns[0].cells[0].revision).toBeUndefined();
    expect(summary.tracked.modified).toBe(1);
  });

  it('reports an unchanged table as unchanged', () => {
    const { summary } = diffDocuments(
      doc([table([['Basic', '10']])]),
      doc([table([['Basic', '10']])])
    );

    expect(summary.unchangedBlocks).toBe(1);
    expect(summary.untracked).toHaveLength(0);
  });

  it('falls back to a block replace when the column count changes', () => {
    const oldTable = table([['Basic', '10']]);
    const newTable: JsonNode = {
      name: 'table',
      props: {
        columns: [
          { header: { content: 'Tier' }, cells: [{ content: 'Basic' }] },
        ],
      },
    };
    const { document, summary } = diffDocuments(
      doc([oldTable]),
      doc([newTable])
    );

    expect(document.children![0]).toEqual(newTable);
    expect(summary.untracked[0].detail).toContain('column count changed');
  });

  it('reports a changed header row as untracked', () => {
    const oldTable = table([['Basic', '10']]);
    const newTable = table([['Basic', '10']]);
    (newTable.props as any).columns[0].header.content = 'Plan';

    const { summary } = diffDocuments(doc([oldTable]), doc([newTable]));
    expect(summary.untracked.some((u) => u.detail.includes('header row'))).toBe(
      true
    );
  });

  it('marks every row of an added table inserted', () => {
    const { document, summary } = diffDocuments(
      doc([para('keep')]),
      doc([
        para('keep'),
        table([
          ['Basic', '10'],
          ['Pro', '25'],
        ]),
      ])
    );

    const result = document.children![1];
    expect((result.props as any).rows).toEqual([
      { revision: { type: 'insert' } },
      { revision: { type: 'insert' } },
    ]);
    expect(summary.tracked.inserted).toBe(1);
  });

  it('keeps a removed table with every row marked deleted', () => {
    const { document, summary } = diffDocuments(
      doc([para('keep'), table([['Basic', '10']])]),
      doc([para('keep')])
    );

    // Previously the whole table was dropped from the redline.
    expect(document.children).toHaveLength(2);
    expect((document.children![1].props as any).rows).toEqual([
      { revision: { type: 'delete' } },
    ]);
    expect(summary.tracked.deleted).toBe(1);
  });

  it('preserves authored row properties through the diff', () => {
    const before = table([['Basic', '10']], {
      rows: [{ cantSplit: true, tableHeader: true }],
    });
    const after = table(
      [
        ['Basic', '10'],
        ['Pro', '25'],
      ],
      {
        rows: [{ cantSplit: true, tableHeader: true }, {}],
      }
    );

    const { document } = diffDocuments(doc([before]), doc([after]));

    // The authored props travel with their row; the diff only adds revisions.
    expect((document.children![0].props as any).rows).toEqual([
      { cantSplit: true, tableHeader: true },
      { revision: { type: 'insert' } },
    ]);
  });

  it('keeps authored row properties on a reinserted deleted row', () => {
    // Deleted rows come back from the old table, so index alignment against
    // either input's props.rows is gone — the props have to travel with them.
    const before = table(
      [
        ['Basic', '10'],
        ['Legacy', '15'],
      ],
      {
        rows: [{}, { cantSplit: true }],
      }
    );
    const after = table([['Basic', '10']], { rows: [{}] });

    const { document } = diffDocuments(doc([before]), doc([after]));

    expect((document.children![0].props as any).rows).toEqual([
      {},
      { cantSplit: true, revision: { type: 'delete' } },
    ]);
  });

  it('reports a markdown-only cell change as untracked', () => {
    const before = table([['Basic', '10']]);
    const after = table([['Basic', '10']]);
    (after.props as any).columns[0].cells[0].content = '**Basic**';

    const { summary } = diffDocuments(doc([before]), doc([after]));

    expect(
      summary.untracked.some((entry) => entry.detail.includes('markdown-only'))
    ).toBe(true);
    expect(summary.unchangedBlocks).toBe(0);
  });

  it('reports markdown flattened inside a revised cell', () => {
    const before = table([['Basic', '10']]);
    const after = table([['Basic', '10']]);
    (after.props as any).columns[1].cells[0].content = '**12**';

    const { summary } = diffDocuments(doc([before]), doc([after]));

    expect(
      summary.untracked.some((entry) =>
        entry.detail.includes('flattened to plain text in a table cell')
      )
    ).toBe(true);
  });

  it('carries the configured author and date onto row revisions', () => {
    const { document } = diffDocuments(
      doc([table([['Basic', '10']])]),
      doc([
        table([
          ['Basic', '10'],
          ['Pro', '25'],
        ]),
      ]),
      { author: 'Legal', date: '2026-06-09T10:00:00Z' }
    );

    expect((document.children![0].props as any).rows[1].revision).toEqual({
      type: 'insert',
      author: 'Legal',
      date: '2026-06-09T10:00:00Z',
    });
  });
});

describe('notes on tracked-change paragraphs', () => {
  const withNote = (text: string): JsonNode => ({
    name: 'paragraph',
    props: { text, footnotes: [{ id: 'a', text: 'Source note' }] },
  });

  it('drops notes from a modified paragraph and reports them', () => {
    // The renderer rejects revision + notes, so a redline carrying both would
    // not be renderable at all.
    const { document, summary } = diffDocuments(
      doc([withNote('Revenue grew 10%[^a].')]),
      doc([withNote('Revenue grew 12%[^a].')])
    );

    const props = document.children![0].props as any;
    expect(props.revision).toBeDefined();
    expect(props.footnotes).toBeUndefined();
    expect(
      summary.untracked.some((entry) =>
        entry.detail.includes('dropped from a tracked-change paragraph')
      )
    ).toBe(true);
  });

  it('drops notes from inserted and deleted paragraphs too', () => {
    const inserted = diffDocuments(
      doc([para('keep')]),
      doc([para('keep'), withNote('Added[^a].')])
    );
    expect(
      (inserted.document.children![1].props as any).footnotes
    ).toBeUndefined();

    const deleted = diffDocuments(
      doc([para('keep'), withNote('Removed[^a].')]),
      doc([para('keep')])
    );
    expect(
      (deleted.document.children![1].props as any).footnotes
    ).toBeUndefined();
  });

  it('keeps a component cell a component when the differ revises it', () => {
    // Replacing the content with a bare string would silently discard the
    // paragraph's font, alignment and everything else it carries.
    const cellTable = (price: string): JsonNode => ({
      name: 'table',
      props: {
        columns: [
          {
            header: { content: 'Price' },
            cells: [
              {
                content: {
                  name: 'paragraph',
                  props: {
                    text: price,
                    font: { bold: true },
                    alignment: 'right',
                  },
                },
              },
            ],
          },
        ],
      },
    });

    const { document } = diffDocuments(
      doc([cellTable('10')]),
      doc([cellTable('12')])
    );

    const cell = (document.children![0].props as any).columns[0].cells[0];
    expect(cell.content.name).toBe('paragraph');
    expect(cell.content.props).toMatchObject({
      text: '12',
      font: { bold: true },
      alignment: 'right',
    });
    expect(cell.revision.segments).toEqual([
      { type: 'delete', text: '10' },
      { type: 'insert', text: '12' },
    ]);
  });

  it('leaves notes alone on an unchanged paragraph', () => {
    const { document } = diffDocuments(
      doc([withNote('Unchanged[^a].')]),
      doc([withNote('Unchanged[^a].')])
    );

    expect((document.children![0].props as any).footnotes).toEqual([
      { id: 'a', text: 'Source note' },
    ]);
  });
});
