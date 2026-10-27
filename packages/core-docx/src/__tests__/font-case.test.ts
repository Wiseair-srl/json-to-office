import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  HeadingPropsSchema,
  ParagraphPropsSchema,
  validateDocument,
} from '@json-to-office/shared-docx';
import { generateBufferFromJson } from '../core/generator';

const run = (xml: string, text: string) =>
  [...xml.matchAll(/<w:r>[\s\S]*?<\/w:r>/g)].find(([r]) =>
    r.includes(text)
  )?.[0];

const documentWith = (
  children: unknown[],
  props: Record<string, unknown> = {}
) => ({
  name: 'docx',
  props,
  children: [{ name: 'section', children }],
});

describe('font.case on a component font', () => {
  it('is declared on the font definition, offered to editors and validated', () => {
    for (const props of [ParagraphPropsSchema, HeadingPropsSchema]) {
      const font = props.properties.font as unknown as {
        properties: { case: { anyOf: { const: string }[] } };
      };
      expect(font.properties.case.anyOf.map((branch) => branch.const)).toEqual([
        'none',
        'upper',
        'smallCaps',
      ]);
    }
    const doc = documentWith([
      { name: 'paragraph', props: { text: 'p', font: { case: 'upper' } } },
      {
        name: 'heading',
        props: { level: 2, text: 'h', font: { case: 'smallCaps' } },
      },
    ]);
    expect(validateDocument(doc).valid).toBe(true);
    const bad = documentWith([
      { name: 'paragraph', props: { text: 'p', font: { case: 'title' } } },
    ]);
    expect(validateDocument(bad).valid).toBe(false);
  });

  for (const renderer of ['docxjs', 'office-open'] as const) {
    it(`writes native caps and keeps the text (${renderer})`, async () => {
      const doc = {
        ...documentWith([
          {
            name: 'paragraph',
            props: { text: 'Upper Paragraph', font: { case: 'upper' } },
          },
          {
            name: 'heading',
            props: {
              level: 2,
              text: 'Upper Heading',
              font: { case: 'upper' },
            },
          },
          {
            name: 'paragraph',
            props: { text: 'Small Paragraph', font: { case: 'smallCaps' } },
          },
        ]),
        renderer,
      };
      const zip = await JSZip.loadAsync(
        await generateBufferFromJson(doc as never)
      );
      const xml = await zip.file('word/document.xml')!.async('string');
      for (const text of ['Upper Paragraph', 'Upper Heading']) {
        const r = run(xml, text);
        expect(r).toMatch(/<w:caps(?: w:val="(?:true|1|on)")?\/>/);
        expect(r).not.toMatch(/<w:smallCaps(?: w:val="(?:true|1|on)")?\/>/);
      }
      expect(run(xml, 'Small Paragraph')).toMatch(
        /<w:smallCaps(?: w:val="(?:true|1|on)")?\/>/
      );
      expect(xml).not.toContain('UPPER PARAGRAPH');
      expect(xml).not.toContain('UPPER HEADING');
    });
  }

  it('still applies case from a theme style', async () => {
    const doc = documentWith(
      [{ name: 'heading', props: { level: 2, text: 'Styled Heading' } }],
      {
        theme: 'minimal',
        themeOverrides: { styles: { heading2: { case: 'smallCaps' } } },
      }
    );
    expect(validateDocument(doc).valid).toBe(true);
    const zip = await JSZip.loadAsync(
      await generateBufferFromJson(doc as never)
    );
    const styles = await zip.file('word/styles.xml')!.async('string');
    const heading2 = styles.match(
      /<w:style\b[^>]*w:styleId="Heading2"[\s\S]*?<\/w:style>/
    )?.[0];
    expect(heading2).toMatch(/<w:smallCaps(?: w:val="(?:true|1|on)")?\/>/);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('Styled Heading');
  });
});
