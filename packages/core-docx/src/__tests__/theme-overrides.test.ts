/**
 * In-document themeOverrides (root props) and theme-token resolution on
 * boldColor: overridden tokens must reach w:color runs, and boldColor must go
 * through the same resolution as font.color.
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

describe('root themeOverrides', () => {
  it('overridden and added color tokens resolve in runs', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: {
        theme: 'minimal',
        themeOverrides: {
          colors: { primary: '#231F20', accent4: '#292526' },
        },
      },
      children: [
        {
          name: 'paragraph',
          props: { text: 'Ink', font: { color: 'primary', size: 12 } },
        },
        {
          name: 'paragraph',
          props: { text: 'Soft ink', font: { color: 'accent4', size: 12 } },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toContain('w:color w:val="231F20"');
    expect(xml).toContain('w:color w:val="292526"');
  });

  it('font role overrides merge field-wise into run fonts', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: {
        theme: 'minimal',
        themeOverrides: { fonts: { body: { family: 'Georgia' } } },
      },
      children: [
        { name: 'paragraph', props: { text: 'Body in overridden family.' } },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/styles.xml');
    expect(xml).toMatch(/w:rFonts [^>]*w:ascii="Georgia"/);
  });
});

describe('boldColor theme resolution', () => {
  it('accepts a token name and a raw hex equally', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: {
        theme: 'minimal',
        themeOverrides: { colors: { accent: '#E6620C' } },
      },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Plain **token bold**',
            boldColor: 'accent',
            font: { size: 12, color: '#231F20' },
          },
        },
        {
          name: 'paragraph',
          props: {
            text: 'Plain **hex bold**',
            boldColor: '#25408F',
            font: { size: 12, color: '#231F20' },
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toContain('w:color w:val="E6620C"');
    expect(xml).toContain('w:color w:val="25408F"');
  });
});
