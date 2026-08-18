/**
 * Letter tracking (w:spacing on a run, twentieths of a point; negative =
 * condensed) must reach every path that accepts a `font` object.
 *
 * `font.scale` and `font.characterSpacing` are rendered by the same run
 * builder, so a path that forwards one and drops the other fails silently:
 * the document validates, renders, and simply ignores the tracking. Two such
 * paths shipped that way — heading, and any text containing a placeholder —
 * while plain paragraphs worked, which is the hardest version to notice.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

async function documentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('word/document.xml missing');
  return entry.async('string');
}

describe('font.characterSpacing (w:spacing)', () => {
  it('emits expanded tracking on a paragraph', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Tracked body text.',
            font: { characterSpacing: { type: 'expanded', value: 40 } },
          },
        },
      ],
    } as never);
    expect(await documentXml(buf)).toMatch(/<w:spacing w:val="40"/);
  });

  it('emits condensed tracking as a negative value', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Condensed body text.',
            font: { characterSpacing: { type: 'condensed', value: 20 } },
          },
        },
      ],
    } as never);
    expect(await documentXml(buf)).toMatch(/<w:spacing w:val="-20"/);
  });

  it('emits tracking on a heading, like font.scale does', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'heading',
          props: {
            text: 'Tracked Heading',
            level: 1,
            font: { characterSpacing: { type: 'expanded', value: 60 } },
          },
        },
      ],
    } as never);
    expect(await documentXml(buf)).toMatch(/<w:spacing w:val="60"/);
  });

  it('keeps tracking when the text contains a placeholder', async () => {
    // Placeholder text routes through processTextWithPlaceholders rather than
    // the plain run builder; both must carry the same run properties.
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Generated on {DATE} for review.',
            font: { characterSpacing: { type: 'expanded', value: 30 } },
          },
        },
      ],
    } as never);
    expect(await documentXml(buf)).toMatch(/<w:spacing w:val="30"/);
  });
});

/**
 * The plain-text and placeholder paths now share one run builder
 * (buildRunCommonProps / buildTextRuns in textParser). This suite pins the
 * invariant that builder exists to guarantee: every run-level property
 * renders identically whether or not the text contains a placeholder.
 */
describe('run-property parity between plain and placeholder paths', () => {
  const cases: Array<{
    label: string;
    props: Record<string, unknown>;
    pattern: RegExp;
  }> = [
    {
      label: 'font family (w:rFonts)',
      props: { font: { family: 'Courier New' } },
      pattern: /<w:rFonts [^>]*w:ascii="Courier New"/,
    },
    {
      label: 'font size (w:sz)',
      props: { font: { size: 13 } },
      pattern: /<w:sz w:val="26"/,
    },
    {
      label: 'color (w:color)',
      props: { font: { color: 'FF6600' } },
      pattern: /<w:color w:val="FF6600"/,
    },
    {
      label: 'bold (w:b)',
      props: { font: { bold: true } },
      pattern: /<w:b\/>/,
    },
    {
      label: 'italic (w:i)',
      props: { font: { italic: true } },
      pattern: /<w:i\/>/,
    },
    {
      label: 'underline (w:u)',
      props: { font: { underline: true } },
      pattern: /<w:u w:val="single"/,
    },
    {
      label: 'scale (w:w)',
      props: { font: { scale: 150 } },
      pattern: /<w:w w:val="150"/,
    },
    {
      label: 'characterSpacing (w:spacing)',
      props: {
        font: { characterSpacing: { type: 'expanded', value: 30 } },
      },
      pattern: /<w:spacing w:val="30"/,
    },
    {
      label: 'language (w:lang)',
      props: { language: 'fr-FR' },
      pattern: /<w:lang [^>]*w:val="fr-FR"/,
    },
    {
      label: 'noProof (w:noProof)',
      props: { noProof: true },
      pattern: /<w:noProof\/>/,
    },
  ];

  async function renderParagraph(
    text: string,
    props: Record<string, unknown>
  ): Promise<string> {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'paragraph', props: { text, ...props } }],
    } as never);
    return documentXml(buf);
  }

  for (const { label, props, pattern } of cases) {
    it(`forwards ${label} on both paths`, async () => {
      const plain = await renderParagraph('Alpha beta gamma.', props);
      const withPlaceholder = await renderParagraph(
        'Alpha {DATE} gamma.',
        props
      );
      expect(plain).toMatch(pattern);
      expect(withPlaceholder).toMatch(pattern);
    });
  }
});
