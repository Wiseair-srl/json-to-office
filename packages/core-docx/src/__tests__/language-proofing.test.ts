/**
 * Language & proofing: the document-level `language` sets the docDefaults
 * proofing language, and per-component `language` / `noProof` emit run-level
 * w:lang / w:noProof, overriding the default.
 */
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateBufferFromJson } from '../core/generator';
import type { DocxRendererId } from '../renderers/types';

const RENDERERS: readonly DocxRendererId[] = ['docxjs', 'office-open'];

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

  describe.each(RENDERERS)(
    'noProofWords beyond paragraphs on %s',
    (renderer) => {
      const SVG =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

      /** Every run in `xml` whose text, kept or deleted, is exactly `word`. */
      function runsOf(xml: string, word: string): string[] {
        const text = new RegExp(`<w:(t|delText)(?: [^>]*)?>${word}</w:\\1>`);
        return [...xml.matchAll(/<w:r(?: [^>]*)?>[\s\S]*?<\/w:r>/g)]
          .map(([run]) => run)
          .filter((run) => text.test(run));
      }

      /** At least one run of `word`, and every one of them marked no-proof. */
      function expectNoProof(xml: string, word: string): void {
        const runs = runsOf(xml, word);
        expect(runs.length, `a run of "${word}"`).toBeGreaterThan(0);
        for (const run of runs) expect(run).toMatch(/<w:noProof\s*\/>/);
      }

      async function generate(children: unknown[]): Promise<Buffer> {
        return generateBufferFromJson({
          name: 'docx',
          renderer,
          props: { theme: 'minimal', noProofWords: ['Mobility'] },
          children,
        } as any);
      }

      it('reaches table cells, header cells and a cell paragraph of its own', async () => {
        const buf = await generate([
          {
            name: 'table',
            props: {
              columns: [
                {
                  header: { content: 'Mobility' },
                  cells: [
                    { content: 'web-app Mobility Connect' },
                    {
                      content: {
                        name: 'paragraph',
                        props: { text: 'Wiseair', noProofWords: ['Wiseair'] },
                      },
                    },
                  ],
                },
              ],
            },
          },
        ]);
        const xml = await readZipEntry(buf, 'word/document.xml');
        expectNoProof(xml, 'Mobility');
        expect(runsOf(xml, 'Mobility')).toHaveLength(2);
        expectNoProof(xml, 'Wiseair');
        // The words around it are still proofed.
        expect(runsOf(xml, 'web-app ')[0]).not.toMatch(/<w:noProof/);
      });

      it('reaches list items, markdown lists included', async () => {
        const buf = await generate([
          { name: 'list', props: { items: ['Mobility plan'] } },
          {
            name: 'paragraph',
            props: { text: '- Wiseair app', noProofWords: ['Wiseair'] },
          },
        ]);
        const xml = await readZipEntry(buf, 'word/document.xml');
        expectNoProof(xml, 'Mobility');
        expectNoProof(xml, 'Wiseair');
      });

      it('reaches captions, plain and decorated', async () => {
        const buf = await generate([
          { name: 'image', props: { svg: SVG, caption: 'Mobility map' } },
          {
            name: 'image',
            props: { svg: SVG, caption: '**Figure 2** Mobility flows' },
          },
        ]);
        const xml = await readZipEntry(buf, 'word/document.xml');
        expectNoProof(xml, 'Mobility');
        expect(runsOf(xml, 'Mobility')).toHaveLength(2);
      });

      it('reaches a statistic description and a contents title', async () => {
        const buf = await generate([
          { name: 'toc', props: { title: 'Mobility' } },
          {
            name: 'statistic',
            props: { number: '42', description: 'Mobility' },
          },
        ]);
        const xml = await readZipEntry(buf, 'word/document.xml');
        expectNoProof(xml, 'Mobility');
        expect(runsOf(xml, 'Mobility')).toHaveLength(2);
      });

      it('reaches tracked changes, inserted, deleted and unchanged', async () => {
        const buf = await generate([
          {
            name: 'paragraph',
            props: {
              text: 'x',
              revision: {
                segments: [
                  { type: 'equal', text: 'Mobility ' },
                  { type: 'delete', text: 'Mobility' },
                  { type: 'insert', text: 'Mobility Connect' },
                ],
              },
            },
          },
          {
            name: 'table',
            props: {
              columns: [
                {
                  header: { content: 'h' },
                  cells: [
                    {
                      content: 'c',
                      revision: {
                        segments: [{ type: 'insert', text: 'Mobility' }],
                      },
                    },
                  ],
                },
              ],
            },
          },
        ]);
        const xml = await readZipEntry(buf, 'word/document.xml');
        expectNoProof(xml, 'Mobility');
        expect(runsOf(xml, 'Mobility')).toHaveLength(4);
        // The rest of the inserted line is an insertion of its own, proofed, and
        // no two insertions share an id.
        const ids = [...xml.matchAll(/<w:(?:ins|del) w:id="(\d+)"/g)].map(
          ([, id]) => id
        );
        expect(new Set(ids).size).toBe(ids.length);
        expect(xml).toMatch(
          /<w:ins [^>]*><w:r>(?:(?!<\/w:r>).)*> Connect<\/w:t>/
        );
        expect(runsOf(xml, ' Connect')[0]).not.toMatch(/<w:noProof/);
      });

      it('reaches the text of a native visual, in text elements and shapes', async () => {
        const buf = await generate([
          {
            name: 'visual',
            props: {
              renderMode: 'native',
              canvas: { width: 3, height: 1 },
              elements: [
                {
                  name: 'text',
                  props: { text: 'Mobility', x: 0.1, y: 0.1, w: 1, h: 0.3 },
                },
                {
                  name: 'shape',
                  props: {
                    type: 'rect',
                    text: 'Mobility',
                    x: 1.5,
                    y: 0.1,
                    w: 1,
                    h: 0.8,
                  },
                },
              ],
            },
          },
        ]);
        const xml = await readZipEntry(buf, 'word/document.xml');
        expectNoProof(xml, 'Mobility');
        expect(runsOf(xml, 'Mobility')).toHaveLength(2);
      });

      it('reaches note and comment bodies', async () => {
        const buf = await generate([
          {
            name: 'paragraph',
            props: {
              text: 'Plan[^n].',
              footnotes: [{ id: 'n', text: 'Mobility' }],
              comment: { text: 'Mobility', author: 'A' },
            },
          },
        ]);
        expectNoProof(
          await readZipEntry(buf, 'word/footnotes.xml'),
          'Mobility'
        );
        expectNoProof(await readZipEntry(buf, 'word/comments.xml'), 'Mobility');
      });
    }
  );
});
