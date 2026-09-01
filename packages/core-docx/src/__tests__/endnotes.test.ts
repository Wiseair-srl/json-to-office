/**
 * Endnotes reuse the footnote marker machinery and differ only in destination:
 * `word/endnotes.xml` and the end of the document rather than the page foot.
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
function authoredNotes(xml: string, tag: 'footnote' | 'endnote'): string[] {
  const pattern = new RegExp(
    `<w:${tag} w:id="(\\d+)">([\\s\\S]*?)</w:${tag}>`,
    'g'
  );
  return Array.from(xml.matchAll(pattern))
    .filter(([, id]) => Number(id) > 0)
    .map(([, , body]) => body);
}

afterEach(() => vi.restoreAllMocks());

describe('endnotes', () => {
  it('renders a marker as an endnote reference and writes the body', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'Sampling followed the protocol[^proto].',
          endnotes: [{ id: 'proto', text: 'See Annex B.' }],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    expect(document).toContain('<w:endnoteReference w:id="1"/>');
    expect(document).not.toContain('<w:footnoteReference');
    expect(document).not.toContain('[^proto]');

    const notes = authoredNotes(
      await read(zip, 'word/endnotes.xml'),
      'endnote'
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('See Annex B.');
    expect(notes[0]).toContain('<w:pStyle w:val="EndnoteText"/>');

    expect(await read(zip, 'word/_rels/document.xml.rels')).toContain(
      'endnotes.xml'
    );
  });

  it('numbers footnotes and endnotes in separate id spaces', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'Both here[^f] and here[^e].',
          footnotes: [{ id: 'f', text: 'Footnote body' }],
          endnotes: [{ id: 'e', text: 'Endnote body' }],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    // They are separate parts, so both start at 1 without colliding.
    expect(document).toContain('<w:footnoteReference w:id="1"/>');
    expect(document).toContain('<w:endnoteReference w:id="1"/>');

    expect(
      authoredNotes(await read(zip, 'word/footnotes.xml'), 'footnote')[0]
    ).toContain('Footnote body');
    expect(
      authoredNotes(await read(zip, 'word/endnotes.xml'), 'endnote')[0]
    ).toContain('Endnote body');
  });

  it('numbers endnotes in reference order across paragraphs', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'First[^a].',
          endnotes: [{ id: 'a', text: 'Note A' }],
        },
      },
      {
        name: 'paragraph',
        props: {
          text: 'Second[^b].',
          endnotes: [{ id: 'b', text: 'Note B' }],
        },
      },
    ]);

    const endnotes = await read(zip, 'word/endnotes.xml');
    expect(endnotes).toMatch(/<w:endnote w:id="1">[\s\S]*?Note A/);
    expect(endnotes).toMatch(/<w:endnote w:id="2">[\s\S]*?Note B/);
  });

  it('splits a body on newlines into paragraphs', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'See[^n].',
          endnotes: [{ id: 'n', text: 'First line\nSecond line' }],
        },
      },
    ]);

    const [body] = authoredNotes(
      await read(zip, 'word/endnotes.xml'),
      'endnote'
    );
    expect(body.match(/<w:p>/g)?.length).toBe(2);
  });

  it('prefers the footnote and warns when an id is declared as both', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const zip = await generate([
      {
        name: 'paragraph',
        props: {
          text: 'Ambiguous[^dup].',
          footnotes: [{ id: 'dup', text: 'The footnote' }],
          endnotes: [{ id: 'dup', text: 'The endnote' }],
        },
      },
    ]);

    const document = await read(zip, 'word/document.xml');
    expect(document).toContain('<w:footnoteReference w:id="1"/>');
    expect(document).not.toContain('<w:endnoteReference');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('both a footnote and an endnote')
    );
  });

  it('warns about an endnote nothing references', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await generate([
      {
        name: 'paragraph',
        props: {
          text: 'No marker here.',
          endnotes: [{ id: 'unused', text: 'Orphan' }],
        },
      },
    ]);

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(
        'Endnote "unused" is declared but never referenced'
      )
    );
  });

  it('emits no authored endnotes when nothing references one', async () => {
    const zip = await generate([
      { name: 'paragraph', props: { text: 'Plain paragraph.' } },
    ]);

    expect(
      authoredNotes(await read(zip, 'word/endnotes.xml'), 'endnote')
    ).toHaveLength(0);
  });

  it('styles endnotes from the theme, smaller than body text', async () => {
    const zip = await generate([
      {
        name: 'paragraph',
        props: { text: 'Note[^n]', endnotes: [{ id: 'n', text: 'body' }] },
      },
    ]);

    const styles = await read(zip, 'word/styles.xml');
    const endnoteText = styles.match(
      /<w:style [^>]*w:styleId="EndnoteText"[\s\S]*?<\/w:style>/
    )![0];
    const normal = styles.match(
      /<w:style [^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/
    )![0];

    const size = (xml: string) =>
      Number(xml.match(/<w:sz w:val="(\d+)"\/>/)![1]);
    expect(size(endnoteText)).toBeLessThan(size(normal));
    expect(endnoteText).toMatch(/w:ascii="Calibri"/);
    expect(styles.match(/w:styleId="EndnoteText"/g)).toHaveLength(1);
    expect(styles.match(/w:styleId="EndnoteReference"/g)).toHaveLength(1);
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
            endnotes: [
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
});
