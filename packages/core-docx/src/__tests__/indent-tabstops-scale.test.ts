/**
 * Paragraph indentation (w:ind), tab stops (w:tabs + real <w:tab/> runs), and
 * character width scaling (w:w): props.indent / props.tabStops on paragraph
 * (indent also on heading) and font.scale wherever a font object is accepted.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

async function readZipEntry(buf: Buffer, path: string): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file(path);
  if (!entry) throw new Error(`${path} missing`);
  return entry.async('string');
}

describe('paragraph indentation (w:ind)', () => {
  it('emits w:ind with left and right on a paragraph', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Indented body text.',
            indent: { left: 720, right: 360 },
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toMatch(/<w:ind [^>]*w:left="720"/);
    expect(xml).toMatch(/<w:ind [^>]*w:right="360"/);
  });

  it('emits a hanging indent on a paragraph', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Hanging indent paragraph.',
            indent: { left: 720, hanging: 360 },
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toMatch(/<w:ind [^>]*w:hanging="360"/);
  });

  it('emits a firstLine indent on a heading', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'heading',
          props: {
            text: 'Indented Heading',
            level: 2,
            indent: { firstLine: 240 },
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toMatch(/<w:ind [^>]*w:firstLine="240"/);
  });

  it('rejects hanging and firstLine together', async () => {
    await expect(
      generateBufferFromJson({
        name: 'docx',
        props: { theme: 'minimal' },
        children: [
          {
            name: 'paragraph',
            props: {
              text: 'Conflicting indent.',
              indent: { hanging: 360, firstLine: 240 },
            },
          },
        ],
      } as any)
    ).rejects.toThrow(/validation failed/i);
  });
});

describe('tab stops (w:tabs) and tab characters', () => {
  it('emits tab stop definitions and a real <w:tab/> for \\t in text', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Label\t42',
            tabStops: [{ type: 'right', position: 9000 }],
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    // Tab stop definition on the paragraph
    expect(xml).toMatch(
      /<w:tabs><w:tab w:val="right" w:pos="9000"\/><\/w:tabs>/
    );
    // Real tab run between the two text runs
    expect(xml).toContain('<w:tab/>');
    expect(xml).toContain('Label');
    expect(xml).toContain('42');
  });

  it('emits a leader on a tab stop', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Chapter 1\t3',
            tabStops: [{ type: 'right', position: 8500, leader: 'dot' }],
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toMatch(/<w:tab w:val="right" w:pos="8500" w:leader="dot"\/>/);
  });

  it('emits multiple tabs for multiple \\t characters', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'a\tb\tc',
            tabStops: [
              { type: 'center', position: 4500 },
              { type: 'right', position: 9000 },
            ],
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml.match(/<w:tab\/>/g)?.length).toBe(2);
  });

  it('rejects an invalid tab stop type', async () => {
    await expect(
      generateBufferFromJson({
        name: 'docx',
        props: { theme: 'minimal' },
        children: [
          {
            name: 'paragraph',
            props: {
              text: 'Bad tab.',
              tabStops: [{ type: 'weird', position: 100 }],
            },
          },
        ],
      } as any)
    ).rejects.toThrow(/validation failed/i);
  });
});

describe('character width scaling (w:w)', () => {
  it('emits w:w for font.scale on a paragraph', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Compressed display text.',
            font: { scale: 55 },
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toContain('<w:w w:val="55"/>');
  });

  it('emits w:w for font.scale on a heading', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'heading',
          props: {
            text: 'Expanded Heading',
            level: 1,
            font: { scale: 115 },
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toContain('<w:w w:val="115"/>');
  });

  it('rejects font.scale outside 1-600', async () => {
    await expect(
      generateBufferFromJson({
        name: 'docx',
        props: { theme: 'minimal' },
        children: [
          {
            name: 'paragraph',
            props: { text: 'Too wide.', font: { scale: 700 } },
          },
        ],
      } as any)
    ).rejects.toThrow(/validation failed/i);
  });
});
