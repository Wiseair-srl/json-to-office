/**
 * Three authoring limits found while writing a real report: notes declared on
 * a list, a paragraph numbered by hand as `1.\tText`, and braces in prose.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import { validateDocument } from '@json-to-office/shared-docx';

async function documentXml(children: unknown[]): Promise<{
  document: string;
  footnotes: string;
}> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal' },
    children,
  } as never);
  const zip = await JSZip.loadAsync(buf);
  return {
    document: await zip.file('word/document.xml')!.async('string'),
    footnotes: (await zip.file('word/footnotes.xml')?.async('string')) ?? '',
  };
}

describe('notes on a list', () => {
  const list = {
    name: 'list',
    props: {
      items: ['First item[^a]', 'Second item'],
      footnotes: [{ id: 'a', text: 'Note on the first item.' }],
    },
  };

  it('passes validation', () => {
    const result = validateDocument({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [list],
    });
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('renders the marker as a reference', async () => {
    const { document, footnotes } = await documentXml([list]);
    expect(document).toContain('<w:footnoteReference w:id="1"/>');
    expect(document).not.toContain('[^a]');
    expect(footnotes).toContain('Note on the first item.');
  });
});

describe('a paragraph numbered by hand', () => {
  it('keeps "1.<tab>" as text, not a numbered list', async () => {
    const { document } = await documentXml([
      {
        name: 'paragraph',
        props: { text: '1.\tFirst point', font: { family: 'Georgia' } },
      },
    ]);
    expect(document).not.toContain('<w:numPr>');
    expect(document).toContain('1.');
    expect(document).toContain('<w:tab/>');
    expect(document).toContain('Georgia');
  });

  it('still reads "1. " with a space as a markdown list, keeping the font', async () => {
    const { document } = await documentXml([
      {
        name: 'paragraph',
        props: { text: '1. One\n2. Two', font: { family: 'Georgia' } },
      },
    ]);
    expect(document).toContain('<w:numPr>');
    expect(document).toContain('Georgia');
  });
});

describe('braces in prose', () => {
  it('leaves {0, 1} as text and still resolves note markers', async () => {
    const { document } = await documentXml([
      {
        name: 'paragraph',
        props: {
          text: 'A value in {0, 1}[^n] and a [link](https://example.com).',
          footnotes: [{ id: 'n', text: 'Binary.' }],
        },
      },
    ]);
    expect(document).toContain('{0, 1}');
    expect(document).toContain('<w:footnoteReference w:id="1"/>');
    expect(document).toContain('<w:hyperlink');
  });

  it('still resolves a real placeholder', async () => {
    const { document } = await documentXml([
      { name: 'paragraph', props: { text: 'Page {PAGE} of {total_pages}' } },
    ]);
    expect(document).toContain('PAGE');
    expect(document).toContain('NUMPAGES');
    expect(document).not.toContain('{PAGE}');
  });
});
