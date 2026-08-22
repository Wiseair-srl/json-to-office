/**
 * The whole corpus, through both backends.
 *
 * Identical OOXML between two different renderers is not the goal and is not
 * asserted — the two disagree about plenty that a reader cannot see. What is
 * asserted is that the IR *means* the same thing to both: the same text in the
 * same order, the same number of tables, rows, cells, drawings, links, note and
 * comment references, and the same media, footnote, endnote and comment parts.
 *
 * Running every corpus case rather than a hand-picked subset is deliberate. A
 * subset only proves what someone thought to include; the corpus is the set of
 * inputs this pipeline is known to care about, and any of them silently losing
 * content on the second backend is exactly what this is for.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../../../core/generateFromIr';
import { resolveDocxRenderer } from '../../registry';
import { CORPUS } from '../../../__tests__/fixtures/corpus';

const officeOpen = await resolveDocxRenderer('office-open');

/**
 * The features a case needs that the second backend does not declare.
 *
 * Split rather than skipped: a case outside the common subset still has
 * something to prove — that it is refused, by name, before any bytes exist.
 */
async function missingFeatures(document: unknown): Promise<string[]> {
  const compiled = await compileDocumentToIr(
    structuredClone(document) as never
  );
  return [
    ...new Set(compiled.required.map((requirement) => requirement.feature)),
  ]
    .filter((feature) => !officeOpen.capabilities.has(feature))
    .sort();
}

const COMMON: typeof CORPUS = [];
const OUTSIDE: Array<(typeof CORPUS)[number] & { missing: string[] }> = [];
for (const testCase of CORPUS) {
  const missing = await missingFeatures(testCase.document);
  if (missing.length === 0) COMMON.push(testCase);
  else OUTSIDE.push({ ...testCase, missing });
}

/**
 * `<w:t …>` only — not `<w:tab/>`, which shares the prefix and would otherwise
 * open a capture that swallows the rest of the paragraph.
 */
const TEXT = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;

/** Elements whose count says how much of the document survived. */
const STRUCTURE = [
  'w:tbl',
  'w:tr',
  'w:tc',
  'w:drawing',
  'w:hyperlink',
  'w:numPr',
  'w:bookmarkStart',
  'w:footnoteReference',
  'w:endnoteReference',
  'w:commentReference',
  'w:sectPr',
  'w:sdt',
  'w:br',
] as const;

interface Shape {
  text: string[];
  counts: Record<string, number>;
  media: number;
  footnotes: number;
  endnotes: number;
  comments: number;
}

async function shapeOf(buffer: Buffer): Promise<Shape> {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name: string): Promise<string> =>
    (await zip.file(name)?.async('string')) ?? '';

  const document = await read('word/document.xml');
  const body = document.slice(document.indexOf('<w:body>'));
  const count = (tag: string): number =>
    (body.match(new RegExp(`<${tag}[ />]`, 'g')) ?? []).length;

  return {
    // Empty text nodes are dropped: docx.js writes one per cached TOC entry as
    // the page-number placeholder and the other backend does not, which is a
    // difference in punctuation rather than in content.
    text: [...body.matchAll(TEXT)].map((m) => m[1]).filter((t) => t.length > 0),
    counts: Object.fromEntries(STRUCTURE.map((tag) => [tag, count(tag)])),
    media: Object.values(zip.files).filter(
      (file) => !file.dir && file.name.startsWith('word/media/')
    ).length,
    footnotes:
      (await read('word/footnotes.xml')).match(/<w:footnote /g)?.length ?? 0,
    endnotes:
      (await read('word/endnotes.xml')).match(/<w:endnote /g)?.length ?? 0,
    comments:
      (await read('word/comments.xml')).match(/<w:comment /g)?.length ?? 0,
  };
}

describe('both DOCX backends over the corpus', () => {
  it.each(COMMON.map((c) => [c.name, c] as const))(
    'carry the same document for %s',
    async (_name, testCase) => {
      const [docxjs, officeOpen] = await Promise.all([
        generateBufferViaIr(structuredClone(testCase.document) as never, {
          renderer: 'docxjs',
        }),
        generateBufferViaIr(structuredClone(testCase.document) as never, {
          renderer: 'office-open',
        }),
      ]);

      expect(await shapeOf(officeOpen.buffer)).toEqual(
        await shapeOf(docxjs.buffer)
      );
    },
    30_000
  );

  it.each(OUTSIDE.map((c) => [c.name, c] as const))(
    'refuses %s by name rather than losing what it needs',
    async (_name, testCase) => {
      const rendering = generateBufferViaIr(
        structuredClone(testCase.document) as never,
        { renderer: 'office-open' }
      );

      await expect(rendering).rejects.toThrow(
        new RegExp(testCase.missing.join('|'))
      );
    },
    30_000
  );

  it('covers most of the corpus on both backends', () => {
    // A guard on the split above: if a mapping regressed and everything moved
    // to the refused list, both `it.each` blocks would still pass.
    expect(COMMON.length).toBeGreaterThan(CORPUS.length * 0.9);
  });

  it('produces a different package, not a copy of the default one', async () => {
    // Guards the test above from passing because the renderer option was
    // ignored and both calls ran the same backend.
    const document = CORPUS[0].document;
    const [docxjs, officeOpen] = await Promise.all([
      generateBufferViaIr(structuredClone(document) as never, {
        renderer: 'docxjs',
      }),
      generateBufferViaIr(structuredClone(document) as never, {
        renderer: 'office-open',
      }),
    ]);

    expect(officeOpen.buffer.equals(docxjs.buffer)).toBe(false);
  }, 30_000);
});

describe('the office-open backend', () => {
  const document = {
    name: 'docx',
    props: {
      theme: 'minimal',
      metadata: { title: 'Parts', author: 'JTO', company: 'Wiseair' },
    },
    children: [
      { name: 'heading', props: { level: 1, text: 'Heading' } },
      { name: 'paragraph', props: { text: 'Body.' } },
    ],
  };

  it('writes every part a DOCX needs', async () => {
    const { buffer } = await generateBufferViaIr(document as never, {
      renderer: 'office-open',
    });
    const zip = await JSZip.loadAsync(buffer);
    const paths = Object.values(zip.files)
      .filter((file) => !file.dir)
      .map((file) => file.name);

    for (const required of [
      '[Content_Types].xml',
      '_rels/.rels',
      'docProps/core.xml',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
      'word/settings.xml',
    ]) {
      expect(paths).toContain(required);
    }
  }, 30_000);

  it('renders the same bytes twice', async () => {
    const [first, second] = await Promise.all([
      generateBufferViaIr(structuredClone(document) as never, {
        renderer: 'office-open',
        generatedAt: '2024-01-01T00:00:00Z',
      }),
      generateBufferViaIr(structuredClone(document) as never, {
        renderer: 'office-open',
        generatedAt: '2024-01-01T00:00:00Z',
      }),
    ]);

    expect(second.buffer.equals(first.buffer)).toBe(true);
  }, 30_000);

  it('carries the document metadata and the pinned timestamps', async () => {
    const { buffer } = await generateBufferViaIr(
      structuredClone(document) as never,
      { renderer: 'office-open', generatedAt: '2025-06-07T08:09:10.000Z' }
    );
    const zip = await JSZip.loadAsync(buffer);
    const core = await zip.file('docProps/core.xml')!.async('string');
    const custom = await zip.file('docProps/custom.xml')?.async('string');

    expect(core).toContain('<dc:title>Parts</dc:title>');
    expect(core).toContain('<dc:creator>JTO</dc:creator>');
    // The wall clock never reaches the package: both backends stamp it and the
    // generic finalization pass rewrites it to the requested instant.
    expect(core).toContain(
      '<dcterms:created xsi:type="dcterms:W3CDTF">2025-06-07T08:09:10.000Z</dcterms:created>'
    );
    expect(core).toContain(
      '<dcterms:modified xsi:type="dcterms:W3CDTF">2025-06-07T08:09:10.000Z</dcterms:modified>'
    );
    expect(custom).toContain('Wiseair');
  }, 30_000);
});
