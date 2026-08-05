/**
 * Display-size type survives round-trip to `w:sz`.
 *
 * `w:sz` is measured in half-points, so a point size emits as `size * 2` with
 * no clamping at any stage. This guards the path end-to-end: a chapter numeral
 * set at 163pt must reach `word/document.xml` as `<w:sz w:val="326"/>`, the
 * same output this library produced before `font.size` was capped at 72.
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

describe('display font sizes', () => {
  it('emits a 163pt paragraph as w:sz 326 half-points', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: { text: '07', font: { family: 'Arial', size: 163 } },
        },
      ],
    } as any);

    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toContain('<w:sz w:val="326"/>');
  });

  it('does not clamp at the old 72pt cap', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'heading',
          props: {
            text: 'Chapter One',
            level: 1,
            font: { family: 'Arial', size: 120 },
          },
        },
      ],
    } as any);

    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toContain('<w:sz w:val="240"/>');
    expect(xml).not.toContain('<w:sz w:val="144"/>'); // 72pt, the old cap
  });
});
