/**
 * Word review comments: anchors in `word/document.xml`, bodies in
 * `word/comments.xml`, and a relationship joining them.
 */
import { describe, it, expect } from 'vitest';
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
