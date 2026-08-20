/**
 * Word review comments: anchors in `word/document.xml`, bodies in
 * `word/comments.xml`, and a relationship joining them.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { componentBypassReason } from '../core/cached-render';
import type { ComponentDefinition } from '../types';

async function generate(children: unknown[]): Promise<JSZip> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal' },
    children,
  } as never);
  return JSZip.loadAsync(buf);
}

async function read(zip: JSZip, path: string): Promise<string> {
  const entry = zip.file(path);
  if (!entry) throw new Error(`${path} missing`);
  return entry.async('string');
}

afterEach(() => vi.restoreAllMocks());

const COMMENT = {
  text: 'Confirm this figure with finance.',
  author: 'Reviewer One',
  date: '2026-06-09T10:00:00Z',
};

describe('comment anchors and bodies', () => {
  it('wraps a paragraph in a comment range and emits the body', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: { text: 'Revenue grew 12%.', comment: COMMENT },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    expect(document).toContain('<w:commentRangeStart w:id="1"/>');
    expect(document).toContain('<w:commentRangeEnd w:id="1"/>');
    expect(document).toContain('<w:commentReference w:id="1"/>');
    // Order matters: the range must open before the text and close after it.
    expect(document.indexOf('<w:commentRangeStart w:id="1"/>')).toBeLessThan(
      document.indexOf('Revenue grew 12%.')
    );
    expect(document.indexOf('Revenue grew 12%.')).toBeLessThan(
      document.indexOf('<w:commentRangeEnd w:id="1"/>')
    );

    const comments = await read(zip, 'word/comments.xml');
    expect(comments).toContain('Confirm this figure with finance.');
    expect(comments).toMatch(/<w:comment [^>]*w:author="Reviewer One"/);
    expect(comments).toMatch(/<w:comment [^>]*w:id="1"/);

    // w:commentReference is run-inner content: emitted bare as a child of w:p
    // it is schema-invalid and readers drop the comment without complaining.
    expect(document).toContain(
      '<w:commentRangeEnd w:id="1"/><w:r><w:commentReference w:id="1"/></w:r>'
    );

    const rels = await read(zip, 'word/_rels/document.xml.rels');
    expect(rels).toContain('comments.xml');
  });

  it('derives initials from the author and keeps an explicit override', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: { text: 'A', comment: { text: 'x', author: 'Ada Lovelace' } },
      },
      {
        name: 'paragraph',
        props: {
          text: 'B',
          comment: { text: 'y', author: 'Ada Lovelace', initials: 'ZZ' },
        },
      },
    ]);

    const comments = await read(zip, 'word/comments.xml');
    expect(comments).toMatch(/w:initials="AL"/);
    expect(comments).toMatch(/w:initials="ZZ"/);
  });

  it('allocates unique, monotonic ids across components', async () => {
    const zip = await generate([
      {
        name: 'heading',
        props: { text: 'Findings', level: 1, comment: { text: 'first' } },
      },
      {
        name: 'paragraph',
        props: { text: 'Body', comment: { text: 'second' } },
      },
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'Metric', comment: { text: 'third' } },
              cells: [{ content: 'x' }],
            },
          ],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    const ids = Array.from(
      document.matchAll(/<w:commentRangeStart w:id="(\d+)"\/>/g)
    ).map((match) => Number(match[1]));

    expect(ids).toEqual([1, 2, 3]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('spans a whole list from the first item to the last', async () => {
    const zip = await generate([
      {
        name: 'list',
        props: {
          items: ['One', 'Two', 'Three'],
          comment: { text: 'Reorder these' },
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    expect(document.indexOf('<w:commentRangeStart w:id="1"/>')).toBeLessThan(
      document.indexOf('One')
    );
    expect(document.indexOf('Three')).toBeLessThan(
      document.indexOf('<w:commentRangeEnd w:id="1"/>')
    );
  });

  it('comments a table cell', async () => {
    const zip = await generate([
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'Metric' },
              cells: [
                { content: 'Revenue', comment: { text: 'Check the units' } },
              ],
            },
          ],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    const cell = document.match(
      /<w:tc>(?:(?!<\/w:tc>)[\s\S])*<w:commentRangeStart[\s\S]*?<\/w:tc>/
    );
    expect(cell, 'expected a comment range inside a table cell').not.toBeNull();
    expect(cell![0]).toContain('<w:commentReference w:id="1"/>');
    expect(await read(zip, 'word/comments.xml')).toContain('Check the units');
  });

  it('splits the body on newlines into paragraphs', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: { text: 'A', comment: { text: 'first line\nsecond line' } },
      },
    ]);

    const comments = await read(zip, 'word/comments.xml');
    expect(comments).toContain('first line');
    expect(comments).toContain('second line');
    const body = comments.match(/<w:comment\b[\s\S]*?<\/w:comment>/)![0];
    expect(body.match(/<w:p>/g)?.length).toBe(2);
  });

  it('is deterministic: identical input yields identical bytes', async () => {
    const definition = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        { name: 'paragraph', props: { text: 'A', comment: { text: 'note' } } },
        { name: 'paragraph', props: { text: 'B', comment: { text: 'other' } } },
      ],
    };
    const [first, second] = await Promise.all([
      generateBufferFromJson(definition as never),
      generateBufferFromJson(definition as never),
    ]);
    expect(first.equals(second)).toBe(true);
  });

  it('uses a stable default author and date', async () => {
    const zip = await generate([
      { name: 'paragraph', props: { text: 'A', comment: { text: 'note' } } },
    ]);

    const comments = await read(zip, 'word/comments.xml');
    expect(comments).toMatch(/w:author="json-to-office"/);
    expect(comments).toMatch(/w:date="1970-01-01T00:00:00/);
  });

  it('leaves the comments part empty when nothing is commented', async () => {
    // docx always writes word/comments.xml; what must not appear is a comment.
    const zip = await generate([
      { name: 'paragraph', props: { text: 'Plain' } },
    ]);
    const comments = await read(zip, 'word/comments.xml');

    expect(comments).not.toContain('<w:comment ');
    expect(await read(zip, 'word/document.xml')).not.toContain(
      '<w:commentRangeStart'
    );
  });

  it('anchors a comment on a markdown-list paragraph', async () => {
    // The list branch returns early from renderParagraphComponent, so the
    // comment has to travel with it or the anchor and body are both lost.
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: '- First item\n- Second item',
          comment: { text: 'Reorder these' },
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    expect(document).toContain('<w:commentRangeStart w:id="1"/>');
    expect(document.indexOf('<w:commentRangeStart w:id="1"/>')).toBeLessThan(
      document.indexOf('First item')
    );
    expect(document.indexOf('Second item')).toBeLessThan(
      document.indexOf('<w:commentRangeEnd w:id="1"/>')
    );
    expect(await read(zip, 'word/comments.xml')).toContain('Reorder these');
  });

  it('anchors a comment on a cell with no content', async () => {
    // The empty-cell early return used to drop the anchor and the body.
    const zip = await generate([
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'Metric' },
              cells: [{ comment: { text: 'Fill this in' } }],
            },
          ],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    const cell = document.match(
      /<w:tc>(?:(?!<\/w:tc>)[\s\S])*<w:commentRangeStart[\s\S]*?<\/w:tc>/
    );
    expect(cell, 'expected a comment range in the empty cell').not.toBeNull();
    expect(cell![0]).toContain('<w:commentReference w:id="1"/>');
    expect(await read(zip, 'word/comments.xml')).toContain('Fill this in');
  });
});

describe('comment threads', () => {
  const THREAD = {
    text: 'Confirm with finance.',
    author: 'Ada Lovelace',
    replies: [
      { text: 'Confirmed against the accounts.', author: 'Grace Hopper' },
      { text: 'Thanks.', author: 'Ada Lovelace' },
    ],
  };

  it('anchors every comment in the thread over the same range', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: { text: 'Revenue grew 12%.', comment: THREAD },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    const order = Array.from(
      document.matchAll(
        /<w:comment(RangeStart|RangeEnd|Reference) w:id="(\d+)"\/>/g
      )
    ).map(([, kind, id]) => `${kind}:${id}`);

    expect(order).toEqual([
      'RangeStart:1',
      'RangeStart:2',
      'RangeStart:3',
      'RangeEnd:1',
      'Reference:1',
      'RangeEnd:2',
      'Reference:2',
      'RangeEnd:3',
      'Reference:3',
    ]);
    // The commented text sits inside the range.
    expect(document.indexOf('<w:commentRangeStart w:id="1"/>')).toBeLessThan(
      document.indexOf('Revenue grew 12%.')
    );
    expect(document.indexOf('Revenue grew 12%.')).toBeLessThan(
      document.indexOf('<w:commentRangeEnd w:id="1"/>')
    );
  });

  it('derives paraIdParent links in commentsExtended.xml', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: { text: 'Revenue grew 12%.', comment: THREAD },
      },
    ]);

    const extended = await read(zip, 'word/commentsExtended.xml');
    // docx derives paraId as (id + 1) in 8-char uppercase hex.
    expect(extended).toContain('<w15:commentEx w15:paraId="00000002"/>');
    expect(extended).toContain(
      'w15:paraId="00000003" w15:paraIdParent="00000002"'
    );
    expect(extended).toContain(
      'w15:paraId="00000004" w15:paraIdParent="00000002"'
    );
  });

  it('marks the whole thread resolved with w15:done', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'Revenue grew 12%.',
          comment: { ...THREAD, resolved: true },
        },
      },
    ]);

    const extended = await read(zip, 'word/commentsExtended.xml');
    expect(extended.match(/w15:done="1"/g)).toHaveLength(3);
  });

  it('writes done="0" for an explicitly unresolved thread', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'Revenue grew 12%.',
          comment: { ...THREAD, resolved: false },
        },
      },
    ]);

    const extended = await read(zip, 'word/commentsExtended.xml');
    expect(extended.match(/w15:done="0"/g)).toHaveLength(3);
  });

  it('leaves unthreaded comments without a parent', async () => {
    const zip = await generate([
      { name: 'paragraph', props: { text: 'A', comment: THREAD } },
      {
        name: 'paragraph',
        props: { text: 'B', comment: { text: 'Standalone' } },
      },
    ]);

    const extended = await read(zip, 'word/commentsExtended.xml');
    // id 4 -> paraId 00000005, the standalone comment.
    expect(extended).toContain('<w15:commentEx w15:paraId="00000005"/>');
  });

  it('warns when resolved is set but nothing in the document is threaded', async () => {
    // docx writes commentsExtended.xml only for threaded comments, so the flag
    // would be dropped in silence otherwise.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await generate([
      {
        name: 'paragraph',
        props: { text: 'A', comment: { text: 'Handled', resolved: true } },
      },
    ]);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('`resolved`'));
  });

  it('is deterministic across threads', async () => {
    const definition = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        { name: 'paragraph', props: { text: 'A', comment: THREAD } },
        {
          name: 'paragraph',
          props: { text: 'B', comment: { text: 'Second' } },
        },
      ],
    };
    const [first, second] = await Promise.all([
      generateBufferFromJson(definition as never),
      generateBufferFromJson(definition as never),
    ]);
    expect(first.equals(second)).toBe(true);
  });
});

describe('comment cache bypass', () => {
  it('reports comment-ids for a commented component', () => {
    expect(
      componentBypassReason({
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'A' },
              cells: [{ content: 'a', comment: { text: 'x' } }],
            },
          ],
        },
      } as unknown as ComponentDefinition)
    ).toBe('comment-ids');
  });

  it('leaves an uncommented table cacheable', () => {
    expect(
      componentBypassReason({
        name: 'table',
        props: {
          columns: [{ header: { content: 'A' }, cells: [{ content: 'a' }] }],
        },
      } as unknown as ComponentDefinition)
    ).toBeNull();
  });
});
