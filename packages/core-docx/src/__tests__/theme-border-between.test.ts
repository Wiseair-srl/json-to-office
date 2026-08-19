/**
 * `borders.between` maps to `w:between` — the rule Word draws between
 * consecutive paragraphs that share a border set, instead of the adjoining
 * bottom and top edges.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

async function normalStyle(borders: unknown): Promise<string> {
  const buf = await generateBufferFromJson({
    name: 'docx',
    props: {
      theme: 'minimal',
      themeOverrides: { styles: { normal: { borders } } },
    },
    children: [
      { name: 'paragraph', props: { text: 'First.' } },
      { name: 'paragraph', props: { text: 'Second.' } },
    ],
  } as never);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/styles.xml')!.async('string');
  return xml.match(/<w:style [^>]*w:styleId="Normal"[\s\S]*?<\/w:style>/)![0];
}

describe('theme borders.between', () => {
  it('emits w:between inside the style pBdr', async () => {
    const style = await normalStyle({
      between: { style: 'single', size: 6, color: '#E6620C', space: 4 },
    });

    expect(style).toContain('<w:pBdr>');
    expect(style).toMatch(/<w:between [^>]*w:val="single"/);
    expect(style).toMatch(/<w:between [^>]*w:color="E6620C"/);
    expect(style).toMatch(/<w:between [^>]*w:sz="6"/);
    expect(style).toMatch(/<w:between [^>]*w:space="4"/);
  });

  it('resolves a theme colour token', async () => {
    const style = await normalStyle({
      between: { style: 'dotted', size: 4, color: 'primary' },
    });

    expect(style).toMatch(/<w:between [^>]*w:color="[0-9A-F]{6}"/);
    expect(style).not.toContain('primary');
  });

  it('coexists with the per-side borders', async () => {
    const style = await normalStyle({
      top: { style: 'single', size: 6, color: '#000000' },
      between: { style: 'single', size: 2, color: '#CCCCCC' },
    });

    expect(style).toMatch(/<w:top [^>]*w:sz="6"/);
    expect(style).toMatch(/<w:between [^>]*w:sz="2"/);
  });

  it('emits no w:between when the theme does not ask for one', async () => {
    const style = await normalStyle({
      top: { style: 'single', size: 6, color: '#000000' },
    });

    expect(style).toContain('<w:pBdr>');
    expect(style).not.toContain('<w:between');
  });
});
