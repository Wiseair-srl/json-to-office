/**
 * Regression: the DOCX output must never contain font bytes. The old
 * `embed`-mode pipeline has been removed — both `custom` and `substitute`
 * modes emit DOCX files with zero entries under `word/fonts/`. Also
 * exercises the two supported modes and the strict guard.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { Packer } from 'docx';
import { generateDocument, generateBufferFromJson } from '../core/generator';

async function listZipEntries(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files);
}

async function readDocumentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const entry = zip.file('word/document.xml');
  if (!entry) throw new Error('word/document.xml missing');
  return entry.async('string');
}

const DOC_REFERENCING_INTER = {
  name: 'docx' as const,
  props: { theme: 'minimal' },
  children: [
    {
      name: 'paragraph',
      props: { text: 'Body.', font: { family: 'Inter' } },
    },
  ],
};

describe('docx output contains no font bytes', () => {
  it('produces no word/fonts/ entries for a basic document', async () => {
    const doc = await generateDocument({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        { name: 'heading', props: { level: 1, text: 'Title' } },
        { name: 'paragraph', props: { text: 'Body.' } },
      ],
    } as any);
    const buf = (await Packer.toBuffer(doc)) as Buffer;
    const entries = await listZipEntries(buf);
    const fontEntries = entries.filter((e) => e.startsWith('word/fonts/'));
    expect(fontEntries).toEqual([]);
  });

  it('substitute mode rewrites Inter to a safe equivalent in the runs', async () => {
    const buf = await generateBufferFromJson(DOC_REFERENCING_INTER as any, {
      fonts: { mode: 'substitute' },
    });
    const entries = await listZipEntries(buf);
    expect(entries.filter((e) => e.startsWith('word/fonts/'))).toEqual([]);
    const xml = await readDocumentXml(buf);
    // Inter falls into the sans-serif bucket → Calibri (Word's default
    // safe sans). The exact mapping is owned by `substitute.ts`; the
    // contract we care about here is "Inter is gone, a safe family
    // replaced it."
    expect(xml).not.toMatch(/\bInter\b/);
    expect(xml).toMatch(/Calibri|Arial/);
  });

  it('custom mode preserves Inter in the runs (no rewrite)', async () => {
    const buf = await generateBufferFromJson(DOC_REFERENCING_INTER as any, {
      fonts: { mode: 'custom' },
    });
    const entries = await listZipEntries(buf);
    expect(entries.filter((e) => e.startsWith('word/fonts/'))).toEqual([]);
    const xml = await readDocumentXml(buf);
    expect(xml).toMatch(/\bInter\b/);
  });

  it('strict mode throws on an unresolved non-safe reference in custom mode', async () => {
    await expect(
      generateBufferFromJson(DOC_REFERENCING_INTER as any, {
        fonts: { mode: 'custom', strict: true, onResolved: () => {} },
      })
    ).rejects.toThrow(/strict mode/i);
  });

  it('strict + substitute does not throw — substitution resolves the refs pre-validation', async () => {
    // applyExportMode rewrites `Inter` → safe equivalent before
    // resolveDocumentFonts validates. Strict only fires on refs that
    // survive the rewrite. For a doc whose only non-safe family has a
    // default safe mapping, substitute + strict is effectively a no-op
    // on the strict guard.
    const buf = await generateBufferFromJson(DOC_REFERENCING_INTER as any, {
      fonts: { mode: 'substitute', strict: true, onResolved: () => {} },
    });
    const entries = await listZipEntries(buf);
    expect(entries.filter((e) => e.startsWith('word/fonts/'))).toEqual([]);
  });
});
