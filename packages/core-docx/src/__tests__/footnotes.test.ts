/**
 * Footnotes: an inline `[^id]` marker in the text, a body declared on the
 * paragraph, and a `w:footnoteReference` joining them to `word/footnotes.xml`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

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

/** Bodies only, without docx's reserved separator notes (ids -1 and 0). */
function authoredNotes(footnotesXml: string): string[] {
  return Array.from(
    footnotesXml.matchAll(/<w:footnote w:id="(\d+)">([\s\S]*?)<\/w:footnote>/g)
  )
    .filter(([, id]) => Number(id) > 0)
    .map(([, , body]) => body);
}

afterEach(() => vi.restoreAllMocks());

describe('footnotes', () => {
  it('renders a marker as a reference and writes the body', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'Revenue grew 12%[^rev] last year.',
          footnotes: [{ id: 'rev', text: 'Source: FY26 audited accounts.' }],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    expect(document).toContain('<w:footnoteReference w:id="1"/>');
    // The marker itself must not survive as text.
    expect(document).not.toContain('[^rev]');
    expect(document).toContain('Revenue grew 12%');
    expect(document).toContain(' last year.');

    const notes = authoredNotes(await read(zip, 'word/footnotes.xml'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('Source: FY26 audited accounts.');
    expect(notes[0]).toContain('<w:pStyle w:val="FootnoteText"/>');

    expect(await read(zip, 'word/_rels/document.xml.rels')).toContain(
      'footnotes.xml'
    );
  });

  it('numbers multiple footnotes in reference order', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'First[^b] then second[^a].',
          // Declaration order is deliberately the reverse of reference order.
          footnotes: [
            { id: 'a', text: 'Note A' },
            { id: 'b', text: 'Note B' },
          ],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    const ids = Array.from(
      document.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g)
    ).map((match) => Number(match[1]));
    expect(ids).toEqual([1, 2]);

    const footnotes = await read(zip, 'word/footnotes.xml');
    expect(footnotes).toMatch(/<w:footnote w:id="1">[\s\S]*?Note B/);
    expect(footnotes).toMatch(/<w:footnote w:id="2">[\s\S]*?Note A/);
  });

  it('splits a body on newlines into paragraphs', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'See note[^n].',
          footnotes: [{ id: 'n', text: 'First line\nSecond line' }],
        },
      },
    ]);

    const [body] = authoredNotes(await read(zip, 'word/footnotes.xml'));
    expect(body).toContain('First line');
    expect(body).toContain('Second line');
    expect(body.match(/<w:p>/g)?.length).toBe(2);
  });

  it('reuses one note when the same marker appears twice', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'Here[^n] and here[^n].',
          footnotes: [{ id: 'n', text: 'Only once' }],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    const ids = Array.from(
      document.matchAll(/<w:footnoteReference w:id="(\d+)"\/>/g)
    ).map((match) => Number(match[1]));

    expect(ids).toEqual([1, 1]);
    expect(authoredNotes(await read(zip, 'word/footnotes.xml'))).toHaveLength(
      1
    );
  });

  it('resolves a marker inside decorated text and next to a link', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: '**Bold claim[^n]** and [a link](https://example.com)[^m].',
          footnotes: [
            { id: 'n', text: 'About the claim' },
            { id: 'm', text: 'About the link' },
          ],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    expect(document).toContain('<w:footnoteReference w:id="1"/>');
    expect(document).toContain('<w:footnoteReference w:id="2"/>');
    expect(document).toContain('<w:b/>');
    expect(document).toContain('<w:hyperlink');
    expect(document).not.toContain('[^n]');
    expect(document).not.toContain('[^m]');
  });

  it('keeps a marker inside {PLACEHOLDER} text literal, and warns', async () => {
    // The placeholder path parses literal chunks without the parser options,
    // so markers are not recognised there. Silence would be the bad outcome.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'Generated {YEAR} with a note[^n].',
          footnotes: [{ id: 'n', text: 'body' }],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    expect(document).toContain('[^n]');
    expect(document).not.toContain('<w:footnoteReference');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('{PLACEHOLDER}'));
  });

  it('leaves marker-shaped text alone when no footnotes are declared', async () => {
    const zip = await generate([
      { name: 'paragraph', props: { text: 'The class [^a-z]+ matches.' } },
    ]);

    const document = await read(zip, 'word/document.xml');
    expect(document).toContain('[^a-z]+');
    expect(document).not.toContain('<w:footnoteReference');
  });

  it('warns and keeps the marker literal when the id is unknown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'Typo here[^oops].',
          footnotes: [{ id: 'n', text: 'Never referenced' }],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    expect(document).toContain('[^oops]');
    expect(document).not.toContain('<w:footnoteReference');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[^oops]'));
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('never referenced')
    );
  });

  it('emits no authored notes when nothing references one', async () => {
    const zip = await generate([
      { name: 'paragraph', props: { text: 'Plain paragraph.' } },
    ]);

    expect(authoredNotes(await read(zip, 'word/footnotes.xml'))).toHaveLength(
      0
    );
  });

  it('is deterministic: identical input yields identical bytes', async () => {
    const definition = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'A[^x] B[^y]',
            footnotes: [
              { id: 'x', text: 'first' },
              { id: 'y', text: 'second' },
            ],
          },
        },
      ],
    };
    const [first, second] = await Promise.all([
      generateBufferFromJson(definition as never),
      generateBufferFromJson(definition as never),
    ]);
    expect(first.equals(second)).toBe(true);
  });

  it('styles notes from the theme, smaller than body text', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'Note[^n]',
          footnotes: [{ id: 'n', text: 'body' }],
        },
      },
    ]);

    const styles = await read(zip, 'word/styles.xml');
    const footnoteText = styles.match(
      /<w:style [^>]*w:styleId="FootnoteText"[\s\S]*?<\/w:style>/
    )![0];
    const normal = styles.match(
      /<w:style [^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/
    )![0];

    const size = (xml: string) =>
      Number(xml.match(/<w:sz w:val="(\d+)"\/>/)![1]);
    expect(size(footnoteText)).toBeLessThan(size(normal));
    expect(footnoteText).toMatch(/w:ascii="Arial"/);

    // Exactly one definition per id — a duplicate w:styleId is resolved
    // differently by different readers.
    expect(styles.match(/w:styleId="FootnoteText"/g)).toHaveLength(1);
    expect(styles.match(/w:styleId="FootnoteReference"/g)).toHaveLength(1);
  });
});

describe('notes on other paragraph paths', () => {
  it('resolves markers in a markdown-list paragraph', async () => {
    // The list branch returns early from renderParagraphComponent; without the
    // resolver travelling with it the marker stays literal and no body is
    // written.
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: '- First item[^a]\n- Second item',
          footnotes: [{ id: 'a', text: 'About the first item' }],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    expect(document).toContain('<w:footnoteReference w:id="1"/>');
    expect(document).not.toContain('[^a]');
    expect(authoredNotes(await read(zip, 'word/footnotes.xml'))[0]).toContain(
      'About the first item'
    );
  });

  it('rejects notes on a revised paragraph, and still warns if validation is skipped', async () => {
    // Tracked-change text renders literally, so a marker inside it cannot
    // resolve — and docx offers no way to put a footnote reference inside
    // w:ins/w:del, since InsertedTextRun wraps exactly one TextRun built from
    // its own options. Validation rejects the combination; the renderer's
    // warning covers callers that turn validation off.
    const definition = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'The fee is 12%[^n].',
            footnotes: [{ id: 'n', text: 'Per the amended schedule.' }],
            revision: {
              segments: [
                { type: 'equal', text: 'The fee is ' },
                { type: 'delete', text: '10%' },
                { type: 'insert', text: '12%' },
                { type: 'equal', text: '[^n].' },
              ],
            },
          },
        },
      ],
    };

    await expect(generateBufferFromJson(definition as never)).rejects.toThrow(
      /validation failed/i
    );

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const buf = await generateBufferFromJson(
      definition as never,
      {
        validation: { enabled: false },
      } as never
    );

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('alongside a `revision`')
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[^n]'));

    const zip = await JSZip.loadAsync(buf);
    expect(authoredNotes(await read(zip, 'word/footnotes.xml'))).toHaveLength(
      0
    );
  });

  it('keeps the first of two notes sharing an id, and warns', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'Ambiguous[^dup].',
          footnotes: [
            { id: 'dup', text: 'The first body' },
            { id: 'dup', text: 'The second body' },
          ],
        },
      },
    ]);

    const notes = authoredNotes(await read(zip, 'word/footnotes.xml'));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('The first body');
    expect(notes[0]).not.toContain('The second body');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('declared twice in the same footnotes array')
    );
  });
});
