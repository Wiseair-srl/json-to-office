/**
 * `w:pgSz/@w:code` carries the DEVMODE paper-size code that printer drivers key
 * off. It is derived from the named size and must never appear on a custom one.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

async function pageSizes(definition: unknown): Promise<string[]> {
  const buf = await generateBufferFromJson(definition as never);
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml')!.async('string');
  return Array.from(xml.matchAll(/<w:pgSz\b[^>]*\/>/g)).map((m) => m[0]);
}

const paragraph = { name: 'paragraph', props: { text: 'Body' } };

describe('page size code', () => {
  it('emits the A4 code for the default page', async () => {
    const [pgSz] = await pageSizes({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [paragraph],
    });

    expect(pgSz).toContain('w:w="11906"');
    expect(pgSz).toContain('w:h="16838"');
    expect(pgSz).toContain('w:code="9"');
  });

  it('emits the Letter code for a section override', async () => {
    const sizes = await pageSizes({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: { page: { size: 'LETTER' } },
          children: [paragraph],
        },
      ],
    });

    expect(sizes.some((s) => s.includes('w:code="1"'))).toBe(true);
    expect(sizes.some((s) => s.includes('w:w="12240"'))).toBe(true);
  });

  it('emits no code for a custom size, and does not leak the theme code', async () => {
    const sizes = await pageSizes({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: { page: { size: { width: 10000, height: 14000 } } },
          children: [paragraph],
        },
      ],
    });

    const custom = sizes.find((s) => s.includes('w:w="10000"'));
    expect(custom, 'expected the custom page size to be emitted').toBeDefined();
    expect(custom).not.toContain('w:code');
  });

  it('keeps the theme code when a section overrides margins only', async () => {
    const sizes = await pageSizes({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: { page: { margins: { top: 720 } } },
          children: [paragraph],
        },
      ],
    });

    expect(sizes.every((s) => s.includes('w:code="9"'))).toBe(true);
  });
});
