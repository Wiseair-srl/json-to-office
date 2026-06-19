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

  it('wraps document-level noProofWords in no-proof runs, whole-word', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal', noProofWords: ['Wiseair', 'json-to-office'] },
      children: [
        {
          name: 'paragraph',
          props: { text: 'Built with json-to-office at Wiseair today.' },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    // The two known words are emitted as their own no-proof runs.
    expect(xml).toMatch(
      /<w:r><w:rPr><w:noProof\s*\/><\/w:rPr><w:t[^>]*>json-to-office<\/w:t><\/w:r>/
    );
    expect(xml).toMatch(
      /<w:r><w:rPr><w:noProof\s*\/><\/w:rPr><w:t[^>]*>Wiseair<\/w:t><\/w:r>/
    );
    // Surrounding text is a separate run with no noProof.
    expect(xml).toMatch(/<w:t[^>]*>Built with <\/w:t>/);
  });

  it('matches noProofWords case-insensitively but only as whole words', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal', noProofWords: ['pptx'] },
      children: [
        {
          name: 'paragraph',
          // "PPTX" should match (case-insensitive); "pptxgenjs" should NOT.
          props: { text: 'Use PPTX, not pptxgenjs.' },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toMatch(
      /<w:r><w:rPr><w:noProof\s*\/><\/w:rPr><w:t[^>]*>PPTX<\/w:t><\/w:r>/
    );
    // pptxgenjs must remain in a normal (proofed) run — no noProof wrapper.
    expect(xml).not.toMatch(/<w:noProof\s*\/><\/w:rPr><w:t[^>]*>pptxgenjs/);
  });

  it('merges component-level noProofWords with the document list', async () => {
    const buf = await generateBufferFromJson({
      name: 'docx',
      props: { theme: 'minimal', noProofWords: ['Wiseair'] },
      children: [
        {
          name: 'paragraph',
          props: {
            text: 'Wiseair and Filaferro.',
            noProofWords: ['Filaferro'],
          },
        },
      ],
    } as any);
    const xml = await readZipEntry(buf, 'word/document.xml');
    expect(xml).toMatch(
      /<w:r><w:rPr><w:noProof\s*\/><\/w:rPr><w:t[^>]*>Wiseair<\/w:t><\/w:r>/
    );
    expect(xml).toMatch(
      /<w:r><w:rPr><w:noProof\s*\/><\/w:rPr><w:t[^>]*>Filaferro<\/w:t><\/w:r>/
    );
  });
});
