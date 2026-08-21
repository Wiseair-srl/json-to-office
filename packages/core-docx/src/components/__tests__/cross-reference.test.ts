/**
 * `[@id]` cross-references: Word REF fields pointing at a numbered heading or
 * list item, carrying the number as a cached value so the PDF path (headless
 * LibreOffice, which never updates fields) shows it too.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../../core/generator';

async function documentXml(children: unknown[]): Promise<string> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal' },
    children,
  } as never);
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}

/**
 * Every `w:fldSimple` in the document, in order. A field with no cached value
 * is self-closing, so both shapes have to match.
 */
function fields(xml: string): string[] {
  return (
    xml.match(/<w:fldSimple\b[^>]*(?:\/>|>[\s\S]*?<\/w:fldSimple>)/g) ?? []
  );
}

const numberedHeadings = [
  { name: 'heading', props: { text: 'Approach', level: 1, numbering: true } },
  {
    name: 'heading',
    id: 'methods',
    props: { text: 'Methods', level: 2, numbering: true },
  },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cross-references to headings', () => {
  it('emits a REF field with the relative switch and the cached number', async () => {
    const xml = await documentXml([
      ...numberedHeadings,
      { name: 'paragraph', props: { text: 'See [@methods] for detail.' } },
    ]);

    const field = fields(xml).find((f) => f.includes('REF methods'));
    expect(field).toBeDefined();
    expect(field).toContain('w:instr="REF methods \\h \\r"');
    expect(field).toContain('>1.1<');
  });

  it('caches the item number alone for :no_context', async () => {
    const xml = await documentXml([
      ...numberedHeadings,
      { name: 'paragraph', props: { text: '[@methods:no_context]' } },
    ]);

    const field = fields(xml)[0];
    expect(field).toContain('w:instr="REF methods \\h \\n"');
    expect(field).toContain('>1<');
  });

  it('caches the whole number for :full_context', async () => {
    const xml = await documentXml([
      ...numberedHeadings,
      { name: 'paragraph', props: { text: '[@methods:full_context]' } },
    ]);

    const field = fields(xml)[0];
    expect(field).toContain('w:instr="REF methods \\h \\w"');
    expect(field).toContain('>1.1<');
  });

  it('references the target text for :none', async () => {
    const xml = await documentXml([
      ...numberedHeadings,
      { name: 'paragraph', props: { text: '[@methods:none]' } },
    ]);

    const field = fields(xml)[0];
    expect(field).toContain('w:instr="REF methods \\h"');
    expect(field).toContain('>Methods<');
  });

  it('resolves a heading whose id is slugged from its text', async () => {
    const xml = await documentXml([
      {
        name: 'heading',
        props: { text: 'Data Sources', level: 1, numbering: true },
      },
      { name: 'paragraph', props: { text: 'See [@data-sources].' } },
    ]);

    expect(fields(xml)[0]).toContain('w:instr="REF data-sources \\h \\r"');
  });

  it('predicts the same dedupe render applies to a colliding slug', async () => {
    // The paragraph claims "results" first, so the heading's slug has to
    // become "results-1" — in the pre-pass exactly as in the render, or the
    // reference points at a bookmark that is never written.
    const xml = await documentXml([
      { name: 'paragraph', props: { id: 'results', text: 'Summary.' } },
      {
        name: 'heading',
        props: { text: 'Results', level: 1, numbering: true },
      },
      { name: 'paragraph', props: { text: 'See [@results-1].' } },
    ]);

    expect(xml).toContain('w:name="results-1"');
    expect(fields(xml)[0]).toContain('>1<');
  });

  it('resolves a forward reference to a heading further down', async () => {
    const xml = await documentXml([
      { name: 'paragraph', props: { text: 'Later: [@methods].' } },
      ...numberedHeadings,
    ]);

    expect(fields(xml)[0]).toContain('>1.1<');
  });

  it('works from a heading and from a list item, not only a paragraph', async () => {
    const xml = await documentXml([
      ...numberedHeadings,
      { name: 'heading', props: { text: 'Recap of [@methods]', level: 2 } },
      { name: 'list', props: { items: ['Per [@methods]'] } },
    ]);

    expect(fields(xml).filter((f) => f.includes('REF methods'))).toHaveLength(
      2
    );
  });
});

describe('cross-references to list items', () => {
  it('bookmarks an item that declares an id and caches its decimal counter', async () => {
    const xml = await documentXml([
      {
        name: 'list',
        props: {
          format: 'numbered',
          items: [
            'First',
            'Second',
            { text: 'Third', id: 'clause-three' },
            'Fourth',
          ],
        },
      },
      { name: 'paragraph', props: { text: 'See [@clause-three].' } },
    ]);

    const bookmark = xml.match(
      /<w:bookmarkStart w:name="clause-three" w:id="(\d+)"\/><w:r><w:t[^>]*>Third<\/w:t><\/w:r><w:bookmarkEnd w:id="\1"\/>/
    );
    expect(
      bookmark,
      'item runs are not wrapped in the bookmark'
    ).not.toBeNull();
    const field = fields(xml)[0];
    expect(field).toContain('w:instr="REF clause-three \\h \\r"');
    expect(field).toContain('>3<');
  });

  it('caches the level format the item actually renders with', async () => {
    const xml = await documentXml([
      {
        name: 'list',
        props: {
          levels: [{ level: 0, format: 'lowerLetter', text: '%1.' }],
          items: ['One', 'Two', { text: 'Three', id: 'sub-c' }],
        },
      },
      { name: 'paragraph', props: { text: '[@sub-c]' } },
    ]);

    expect(fields(xml)[0]).toContain('>c<');
  });

  it('continues the count across lists sharing a reference', async () => {
    const xml = await documentXml([
      {
        name: 'list',
        props: {
          reference: 'clauses',
          format: 'numbered',
          items: ['One', 'Two'],
        },
      },
      { name: 'paragraph', props: { text: 'Interlude.' } },
      {
        name: 'list',
        props: {
          reference: 'clauses',
          format: 'numbered',
          items: [{ text: 'Three', id: 'clause-three' }],
        },
      },
      { name: 'paragraph', props: { text: '[@clause-three]' } },
    ]);

    expect(fields(xml)[0]).toContain('>3<');
  });

  it('restarts the count for lists with auto-generated references', async () => {
    const xml = await documentXml([
      { name: 'list', props: { format: 'numbered', items: ['One', 'Two'] } },
      {
        name: 'list',
        props: {
          format: 'numbered',
          items: [{ text: 'Fresh', id: 'fresh-one' }],
        },
      },
      { name: 'paragraph', props: { text: '[@fresh-one]' } },
    ]);

    expect(fields(xml)[0]).toContain('>1<');
  });

  it('honours props.start and skips empty items', async () => {
    const xml = await documentXml([
      {
        name: 'list',
        props: {
          format: 'numbered',
          start: 5,
          items: ['One', '  ', { text: 'Two', id: 'second' }],
        },
      },
      { name: 'paragraph', props: { text: '[@second]' } },
    ]);

    expect(fields(xml)[0]).toContain('>6<');
  });

  it('bookmarks a tracked-change item too', async () => {
    const xml = await documentXml([
      {
        name: 'list',
        props: {
          items: [
            {
              text: '',
              id: 'inserted-clause',
              revision: {
                author: 'A',
                date: '2026-01-01T00:00:00Z',
                segments: [{ type: 'insert', text: 'New clause' }],
              },
            },
          ],
        },
      },
    ]);

    expect(xml).toMatch(
      /<w:bookmarkStart w:name="inserted-clause" w:id="(\d+)"\/><w:ins\b[\s\S]*?<\/w:ins><w:bookmarkEnd w:id="\1"\/>/
    );
  });

  it('resolves an internal link to a bookmarked item', async () => {
    const xml = await documentXml([
      {
        name: 'list',
        props: { items: [{ text: 'Anchored', id: 'anchor-me' }] },
      },
      { name: 'paragraph', props: { text: '[jump](#anchor-me)' } },
    ]);

    expect(xml).toContain('w:anchor="anchor-me"');
  });
});

describe('unresolvable cross-references', () => {
  it('renders an unknown id as literal text and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const xml = await documentXml([
      ...numberedHeadings,
      { name: 'paragraph', props: { text: 'See [@nope] here.' } },
    ]);

    expect(fields(xml)).toHaveLength(0);
    expect(xml).toContain('[@nope]');
    expect(warn.mock.calls.flat().join(' ')).toContain('[@nope]');
  });

  it('writes an uncached field for an unnumbered target and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const xml = await documentXml([
      { name: 'list', props: { items: [{ text: 'Bullet', id: 'a-bullet' }] } },
      { name: 'paragraph', props: { text: '[@a-bullet]' } },
    ]);

    const field = fields(xml)[0];
    expect(field).toContain('w:instr="REF a-bullet \\h \\r"');
    // Self-closing: docx omits the cached run when there is no value.
    expect(field).toMatch(
      /<w:fldSimple[^>]*\/>|<w:fldSimple[^>]*><\/w:fldSimple>/
    );
    expect(warn.mock.calls.flat().join(' ')).toContain('unnumbered list-item');
  });

  it('still resolves the text of an unnumbered target with :none', async () => {
    const xml = await documentXml([
      { name: 'list', props: { items: [{ text: 'Bullet', id: 'a-bullet' }] } },
      { name: 'paragraph', props: { text: '[@a-bullet:none]' } },
    ]);

    expect(fields(xml)[0]).toContain('>Bullet<');
  });

  it('leaves markdown links alone', async () => {
    const xml = await documentXml([
      {
        name: 'paragraph',
        props: { text: 'A [link](https://example.com) and text.' },
      },
    ]);

    expect(xml).toContain('and text.');
    expect(fields(xml)).toHaveLength(0);
  });
});

describe('cross-reference id grammar', () => {
  // `id` is a free string in the schema, so the token grammar has to accept
  // whatever an author can legally write on a list item or a node.
  it.each(['item.1', 'step_2', 'fig-3a', 'Ref4'])(
    'resolves the id %s',
    async (id) => {
      const xml = await documentXml([
        {
          name: 'list',
          props: { format: 'numbered', items: [{ text: 'First', id }] },
        },
        { name: 'paragraph', props: { text: `See [@${id}].` } },
      ]);

      const field = fields(xml).find((f) => f.includes(`REF ${id}`));
      expect(field).toBeDefined();
      expect(field).toContain('>1<');
    }
  );

  it('does not swallow a sentence when a token is left unclosed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const xml = await documentXml([
      { name: 'paragraph', props: { text: 'An [@unclosed reference here.' } },
    ]);

    expect(fields(xml)).toHaveLength(0);
    expect(xml).toContain('reference here.');
    expect(warn.mock.calls.flat().join(' ')).not.toContain('has no target');
  });
});
