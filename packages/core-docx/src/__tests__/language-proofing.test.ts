/**
 * Language & proofing: the document-level `language` sets the docDefaults
 * proofing language, and per-component `language` / `noProof` emit run-level
 * w:lang / w:noProof, overriding the default.
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

describe('language & proofing', () => {
  it('sets the document default language on docDefaults', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal', language: 'en-US' },
      children: [{ name: 'paragraph', props: { text: 'Hello world.' } }],
    } as any);
    const styles = await readZipEntry(buf, 'word/styles.xml');
    expect(styles).toMatch(/<w:docDefaults>[\s\S]*<w:lang w:val="en-US"\/>/);
  });

  it('omits docDefaults language when none is given', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'paragraph', props: { text: 'Hello world.' } }],
    } as any);
    const styles = await readZipEntry(buf, 'word/styles.xml');
    const docDefaults = styles.match(
      /<w:docDefaults>[\s\S]*?<\/w:docDefaults>/
    )?.[0];
    expect(docDefaults).toBeDefined();
    expect(docDefaults).not.toContain('<w:lang');
  });

  it('emits a per-run w:lang for a paragraph language override', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal', language: 'en-US' },
      children: [
        {
          name: 'paragraph',
          props: { text: 'Ce paragraphe est en français.', language: 'fr-FR' },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toContain('<w:lang w:val="fr-FR"/>');
  });

  it('emits a per-run w:lang for a heading language override', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'heading',
          props: { text: 'Überschrift', level: 2, language: 'de-DE' },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toContain('<w:lang w:val="de-DE"/>');
  });

  it('emits w:noProof when a paragraph disables proofing', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'paragraph',
          props: { text: 'const x = 1; // code', noProof: true },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toMatch(/<w:noProof\s*\/>/);
  });
});
