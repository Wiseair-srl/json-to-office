/**
 * TOC level styles must carry the canonical `TOC1`..`TOC6` ids.
 *
 * docx hardcodes `w:pStyle w:val="TOC{level}"` when it writes cached TOC
 * entries, so a namespaced id leaves every cached entry unstyled while
 * styles.xml still looks perfectly well-formed.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

async function stylesXml(definition: unknown): Promise<string> {
  const buf = await generateBufferFromJson(definition as never);
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/styles.xml')!.async('string');
}

describe('TOC paragraph style ids', () => {
  it('emits canonical TOC1..TOC6 ids with canonical display names', async () => {
    const xml = await stylesXml({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        { name: 'toc', props: {} },
        { name: 'heading', props: { text: 'One', level: 1 } },
      ],
    });

    for (let level = 1; level <= 6; level++) {
      expect(xml).toContain(`w:styleId="TOC${level}"`);
      expect(xml).toContain(`<w:name w:val="TOC ${level}"/>`);
    }
    expect(xml).not.toContain('JTD_TOC');
  });

  it('keeps the canonical id when a theme overrides a TOC level', async () => {
    const xml = await stylesXml({
      name: 'docx',
      props: {
        theme: 'minimal',
        themeOverrides: { styles: { TOC1: { size: 14, color: '#FF0000' } } },
      },
      children: [
        { name: 'toc', props: {} },
        { name: 'heading', props: { text: 'One', level: 1 } },
      ],
    });

    expect(xml).toContain('w:styleId="TOC1"');
    expect(xml).toContain('<w:name w:val="TOC 1"/>');
    expect(xml).not.toContain('JTD_TOC');
  });
});
