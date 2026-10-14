/**
 * Guard: outside `embed` mode the DOCX output carries no font bytes. `custom`
 * (the default) and `substitute` emit no entry under `word/fonts/`, no
 * `w:embed*` in the font table and no `w:embedTrueTypeFonts` in the settings,
 * and asking for `custom` builds the very bytes that asking for nothing does —
 * `embed` is opt-in, and adding it must not move a byte of the other two.
 * Also exercises both modes and the strict guard. `font-embedding.test.ts`
 * covers `embed` itself.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';

async function listZipEntries(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  return Object.keys(zip.files);
}

/** Every trace an embedded font leaves in a package, empty when it has none. */
async function embeddingTraces(buf: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const fontTable =
    (await zip.file('word/fontTable.xml')?.async('string')) ?? '';
  const settings = (await zip.file('word/settings.xml')?.async('string')) ?? '';
  return [
    ...Object.keys(zip.files).filter((e) => e.startsWith('word/fonts/')),
    ...(fontTable.match(/<w:embed\w*/g) ?? []),
    ...(settings.match(/<w:embedTrueTypeFonts\b/g) ?? []),
  ];
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
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        { name: 'heading', props: { level: 1, text: 'Title' } },
        { name: 'paragraph', props: { text: 'Body.' } },
      ],
    } as any);
    const entries = await listZipEntries(buf);
    const fontEntries = entries.filter((e) => e.startsWith('word/fonts/'));
    expect(fontEntries).toEqual([]);
    expect(await embeddingTraces(buf)).toEqual([]);
  });

  it('substitute mode rewrites Inter to a safe equivalent in the runs', async () => {
    const buf = await generateBufferFromJson(DOC_REFERENCING_INTER as any, {
      fonts: { mode: 'substitute' },
    });
    const entries = await listZipEntries(buf);
    expect(entries.filter((e) => e.startsWith('word/fonts/'))).toEqual([]);
    expect(await embeddingTraces(buf)).toEqual([]);
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
    expect(await embeddingTraces(buf)).toEqual([]);
    const xml = await readDocumentXml(buf);
    expect(xml).toMatch(/\bInter\b/);
  });

  it('custom mode builds the same bytes as passing no fonts option', async () => {
    const custom = await generateBufferFromJson(DOC_REFERENCING_INTER as any, {
      fonts: { mode: 'custom' },
    });
    const none = await generateBufferFromJson(DOC_REFERENCING_INTER as any);
    expect(custom.equals(none)).toBe(true);
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
