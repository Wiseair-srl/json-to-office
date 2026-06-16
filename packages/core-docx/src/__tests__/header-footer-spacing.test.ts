/**
 * Regression: paragraph `lineSpacing` and `spacing` (before/after) must reach
 * section header/footer paragraphs. These props used to be silently dropped
 * because the header/footer renderer hand-built paragraphs instead of using the
 * shared text primitive. See renderHeaderFooterComponents in core/render.ts.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

/** Concatenate every zip part whose name matches `re` (e.g. all header*.xml). */
async function readParts(buf: Buffer, re: RegExp): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const parts = await Promise.all(zip.file(re).map((f) => f.async('string')));
  if (parts.length === 0) throw new Error(`no parts matched ${re}`);
  return parts.join('\n');
}

describe('header/footer paragraph spacing', () => {
  it('applies lineSpacing and spacing to a section header paragraph', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {
            header: [
              {
                name: 'paragraph',
                props: {
                  text: 'Header text',
                  font: { lineSpacing: { type: 'double' } }, // 480 twips, auto
                  spacing: { before: 8, after: 10 }, // 160 / 200 twips
                },
              },
            ],
          },
          children: [{ name: 'paragraph', props: { text: 'Body' } }],
        },
      ],
    } as any);

    const headerXml = await readParts(buf, /word\/header\d+\.xml/);
    // Sanity: we are reading the right part.
    expect(headerXml).toContain('Header text');
    // lineSpacing: double -> w:line="480" w:lineRule="auto"
    expect(headerXml).toMatch(/w:line="480"/);
    expect(headerXml).toMatch(/w:lineRule="auto"/);
    // spacing before/after (points -> twips, *20)
    expect(headerXml).toMatch(/w:before="160"/);
    expect(headerXml).toMatch(/w:after="200"/);
  });

  it('applies lineSpacing to a section footer paragraph', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {
            footer: [
              {
                name: 'paragraph',
                props: {
                  text: 'Footer text',
                  font: { lineSpacing: { type: 'exactly', value: 18 } }, // 360 twips, exact
                },
              },
            ],
          },
          children: [{ name: 'paragraph', props: { text: 'Body' } }],
        },
      ],
    } as any);

    const footerXml = await readParts(buf, /word\/footer\d+\.xml/);
    expect(footerXml).toContain('Footer text');
    // lineSpacing: exactly 18pt -> w:line="360" w:lineRule="exact"
    expect(footerXml).toMatch(/w:line="360"/);
    expect(footerXml).toMatch(/w:lineRule="exact"/);
  });
});
