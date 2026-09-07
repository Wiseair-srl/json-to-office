/**
 * A list's `font` styles its item text, and `keepNext` / `keepLines` keep the
 * list with what introduces it. Both were previously unreachable: items were
 * built on an empty base style and carried no keep flags, so a consumer had to
 * choose between a list's hanging indent and a paragraph's styling.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

async function document(...children: unknown[]): Promise<string> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    props: { theme: 'minimal' },
    children,
  } as never);
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}

/** The `w:p` elements that carry a numbering reference, i.e. the list items. */
function listParagraphs(xml: string): string[] {
  const paragraphs = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) ?? [];
  return paragraphs.filter((p) => p.includes('<w:numPr>'));
}

describe('list text style', () => {
  it('applies font and keep flags to every item, at every level', async () => {
    const xml = await document({
      name: 'list',
      props: {
        items: [
          'Condition one',
          { text: 'Nested condition', level: 1 },
          { text: 'Deeper still', level: 2 },
        ],
        font: { color: 'textSecondary', size: 9, italic: true },
        keepNext: true,
        keepLines: true,
      },
    });

    const items = listParagraphs(xml);
    expect(items).toHaveLength(3);

    for (const item of items) {
      // 9pt in half-points, the same conversion the paragraph path applies.
      expect(item).toContain('<w:sz w:val="18"/>');
      expect(item).toMatch(/<w:color w:val="[0-9A-F]{6}"\/>/);
      // `italic` in the theme model, `w:i` in the file.
      expect(item).toContain('<w:i/>');
      expect(item).toContain('<w:keepNext/>');
      expect(item).toContain('<w:keepLines/>');
    }

    // The token is resolved, not passed through.
    expect(xml).not.toContain('textSecondary');
  });

  it('resolves a theme colour token the way the paragraph path does', async () => {
    const list = await document({
      name: 'list',
      props: { items: ['One'], font: { color: 'textSecondary' } },
    });
    const paragraph = await document({
      name: 'paragraph',
      props: { text: 'One', font: { color: 'textSecondary' } },
    });

    const hex = /<w:color w:val="([0-9A-F]{6})"\/>/.exec(paragraph)?.[1];
    expect(hex).toBeDefined();
    expect(listParagraphs(list)[0]).toContain(`<w:color w:val="${hex}"/>`);
  });

  it('lets inline decorators layer on top of the base style', async () => {
    const xml = await document({
      name: 'list',
      props: {
        items: ['plain **bold** plain'],
        font: { color: '#E6620C', size: 9 },
      },
    });

    const runs = listParagraphs(xml)[0].match(/<w:r>[\s\S]*?<\/w:r>/g) ?? [];
    const bold = runs.filter((r) => r.includes('<w:b/>'));
    expect(bold).toHaveLength(1);
    // The decorated run keeps the list's colour and size.
    expect(bold[0]).toContain('<w:color w:val="E6620C"/>');
    expect(bold[0]).toContain('<w:sz w:val="18"/>');
  });

  it('carries the base style into a tracked change', async () => {
    const xml = await document({
      name: 'list',
      props: {
        items: [
          {
            text: 'Added',
            revision: { segments: [{ type: 'insert', text: 'Added' }] },
          },
        ],
        font: { color: '#E6620C' },
      },
    });

    expect(xml).toContain('<w:ins ');
    expect(listParagraphs(xml)[0]).toContain('<w:color w:val="E6620C"/>');
  });

  it('leaves a list without font or keep flags exactly as it was', async () => {
    const xml = await document({
      name: 'list',
      props: { items: ['One', { text: 'Two', level: 1 }] },
    });

    for (const item of listParagraphs(xml)) {
      expect(item).not.toContain('<w:color ');
      expect(item).not.toContain('<w:sz ');
      expect(item).not.toContain('<w:i/>');
      expect(item).not.toContain('<w:keepNext/>');
      expect(item).not.toContain('<w:keepLines/>');
      expect(item).not.toContain('<w:rFonts ');
    }
  });

  it('keeps a nested block together with the heading above it', async () => {
    const xml = await document(
      {
        name: 'paragraph',
        props: { text: 'Conditions', keepNext: true },
      },
      {
        name: 'list',
        props: {
          items: ['One', { text: 'Two', level: 1 }],
          keepNext: true,
          keepLines: true,
        },
      }
    );

    const items = listParagraphs(xml);
    expect(items).toHaveLength(2);
    expect(items.every((p) => p.includes('<w:keepNext/>'))).toBe(true);
  });
});
