/**
 * Regression: the PPTX output must never contain font bytes. The
 * `fontEmbedding` utility has been removed; both `custom` and `substitute`
 * modes emit PPTX files with zero entries under `ppt/fonts/`. Also
 * exercises the two supported modes and the strict guard.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import type { PresentationComponentDefinition } from '../types';

async function listZipEntries(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files);
}

async function readAllSlideXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const parts = await Promise.all(
    Object.entries(zip.files)
      .filter(([p]) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
      .map(([, entry]) => entry.async('string'))
  );
  return parts.join('\n');
}

const DOC_REFERENCING_INTER: PresentationComponentDefinition = {
  name: 'pptx',
  props: { theme: 'default' },
  children: [
    {
      name: 'slide',
      props: {},
      children: [
        {
          name: 'text',
          props: { text: 'Hello', fontFace: 'Inter' },
        } as any,
      ],
    } as any,
  ],
};

describe('pptx output contains no font bytes', () => {
  it('produces no ppt/fonts/ entries for a basic presentation', async () => {
    const doc: PresentationComponentDefinition = {
      name: 'pptx',
      props: { theme: 'default' },
      children: [
        {
          name: 'slide',
          props: {},
          children: [{ name: 'text', props: { text: 'Hello' } } as any],
        } as any,
      ],
    };
    const buf = await generateBufferFromJson(doc);
    const entries = await listZipEntries(buf);
    const fontEntries = entries.filter((e) => e.startsWith('ppt/fonts/'));
    expect(fontEntries).toEqual([]);
  });

  it('substitute mode rewrites Inter to a safe equivalent in slide xml', async () => {
    const buf = await generateBufferFromJson(DOC_REFERENCING_INTER, {
      fonts: { mode: 'substitute' },
    });
    const entries = await listZipEntries(buf);
    expect(entries.filter((e) => e.startsWith('ppt/fonts/'))).toEqual([]);
    const xml = await readAllSlideXml(buf);
    expect(xml).not.toMatch(/\bInter\b/);
    expect(xml).toMatch(/Calibri|Arial/);
  });

  it('custom mode preserves Inter in slide xml (no rewrite)', async () => {
    const buf = await generateBufferFromJson(DOC_REFERENCING_INTER, {
      fonts: { mode: 'custom' },
    });
    const entries = await listZipEntries(buf);
    expect(entries.filter((e) => e.startsWith('ppt/fonts/'))).toEqual([]);
    const xml = await readAllSlideXml(buf);
    expect(xml).toMatch(/\bInter\b/);
  });

  it('strict mode throws on an unresolved non-safe reference in custom mode', async () => {
    await expect(
      generateBufferFromJson(DOC_REFERENCING_INTER, {
        fonts: { mode: 'custom', strict: true, onResolved: () => {} },
      })
    ).rejects.toThrow(/strict mode/i);
  });

  it('strict + substitute does not throw — substitution resolves the refs pre-validation', async () => {
    // applyExportMode rewrites `Inter` → safe equivalent before
    // resolveDocumentFonts validates. Strict only fires on refs that
    // survive the rewrite.
    const buf = await generateBufferFromJson(DOC_REFERENCING_INTER, {
      fonts: { mode: 'substitute', strict: true, onResolved: () => {} },
    });
    const entries = await listZipEntries(buf);
    expect(entries.filter((e) => e.startsWith('ppt/fonts/'))).toEqual([]);
  });
});
