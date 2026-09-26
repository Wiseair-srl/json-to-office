/**
 * The whole corpus, through both backends.
 *
 * Identical OOXML between two different renderers is not the goal and is not
 * asserted — the two disagree about plenty that a reader cannot see. What is
 * asserted is that the IR *means* the same thing to both: the same text in the
 * same order, the same number of tables, rows, cells, drawings, links, note and
 * comment references, drawing extents, the same paper and margins section by
 * section, and the same note and comment parts.
 * The second backend may need extra equivalent media parts when the same image
 * is drawn at different sizes because it stores extents on deduplicated media.
 * Every run and paragraph starts from the same document defaults on both, and
 * every section lays its lines out on the same document grid: a default one
 * backend supplies on its own changes everything that does not state its own.
 *
 * Running every corpus case rather than a hand-picked subset is deliberate. A
 * subset only proves what someone thought to include; the corpus is the set of
 * inputs this pipeline is known to care about, and any of them silently losing
 * content on the second backend is exactly what this is for.
 *
 * Complex-script text — Arabic, Hebrew, Thai — reads its size, weight and
 * slant from twins of the Latin run properties, `w:szCs`, `w:bCs` and `w:iCs`,
 * which docx.js writes beside every `w:sz`, `w:b` and `w:i` on its own. Each
 * twin is checked against its own Latin property rather than across backends:
 * what is asserted is that both set such text apart from the Latin beside it
 * in the same places — none — whatever the Latin properties themselves say.
 */

import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { imageIntegrityDefect } from '@json-to-office/shared/images/node';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../../../core/generateFromIr';
import { resolveDocxRenderer } from '../../registry';
import { CORPUS } from '../../../__tests__/fixtures/corpus';
import {
  BMP_4X2,
  GIF_4X2,
  JPEG_8X4,
  PNG_4X2,
} from '../../../__tests__/fixtures/corpus-blocks';
import { readImageDimensions } from '../../../utils/imageUtils';

const officeOpen = await resolveDocxRenderer('office-open');

const SVG_4X2 = `data:image/svg+xml;base64,${Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="2"><rect width="4" height="2" fill="#3366cc"/></svg>'
).toString('base64')}`;

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
 * The styles a case's IR declares, by the id both backends write them under.
 *
 * Each backend also ships built-in styles of its own, written from Word's
 * template rather than from the IR and not always with every twin, so those
 * are left out. The built-ins the IR does override are named by slot, and each
 * backend writes a slot under the id it is named after.
 */
async function declaredStyleIds(document: unknown): Promise<string[]> {
  const { ir } = await compileDocumentToIr(structuredClone(document) as never);
  return [
    ...ir.styles.paragraph.map((style) => style.id),
    ...ir.styles.character.map((style) => style.id),
    ...Object.keys(ir.styles.builtIn ?? {}).map(
      (slot) => slot[0].toUpperCase() + slot.slice(1)
    ),
  ];
}

/** Each Latin run property, and the twin complex-script text reads instead. */
const COMPLEX_SCRIPT_TWINS = [
  ['w:sz', 'w:szCs'],
  ['w:b', 'w:bCs'],
  ['w:i', 'w:iCs'],
] as const;

/** A run property as stated: half-points for a size, else `on` or `off`. */
function statedValue(rPr: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s+w:val="([^"]*)")?\\s*/>`).exec(rPr);
  if (!match) return undefined;
  if (name.startsWith('w:sz')) return match[1];
  // docx.js spells off `false`, the other backend `0`.
  return match[1] === undefined || ['1', 'true', 'on'].includes(match[1])
    ? 'on'
    : 'off';
}

/** The parts outside `styles.xml` that hold run properties, by kind. */
const RUN_PARTS =
  /^word\/(document|header|footer|footnotes|endnotes|comments|numbering)\d*\.xml$/;
const RUN_PROPERTIES = /<w:rPr>([\s\S]*?)<\/w:rPr>/g;
const STYLE =
  /<w:style\b[^>]*\bw:styleId="([^"]*)"[^>]*>([\s\S]*?)<\/w:style>/g;

/**
 * Every place a package sets complex-script text apart from the Latin text
 * beside it — a `w:sz`, `w:b` or `w:i` whose twin is missing or says something
 * else — tallied by where it is and what it says. Covers each run property in
 * the story parts and numbering levels, and in the styles the IR declares.
 */
async function complexScriptGaps(
  buffer: Buffer,
  styleIds: readonly string[]
): Promise<Record<string, number>> {
  const zip = await JSZip.loadAsync(buffer);
  const gaps: Record<string, number> = {};
  const check = (where: string, rPr: string): void => {
    for (const [latin, complex] of COMPLEX_SCRIPT_TWINS) {
      const [own, twin] = [statedValue(rPr, latin), statedValue(rPr, complex)];
      if (own === twin) continue;
      const gap = `${where}: ${latin}=${own ?? 'unset'} ${complex}=${twin ?? 'unset'}`;
      gaps[gap] = (gaps[gap] ?? 0) + 1;
    }
  };

  for (const [path, entry] of Object.entries(zip.files)) {
    const kind = RUN_PARTS.exec(path)?.[1];
    if (!kind) continue;
    const xml = await entry.async('string');
    for (const [, rPr] of xml.matchAll(RUN_PROPERTIES)) check(kind, rPr);
  }
  const styles = (await zip.file('word/styles.xml')?.async('string')) ?? '';
  for (const [, id, body] of styles.matchAll(STYLE)) {
    if (!styleIds.includes(id)) continue;
    for (const [, rPr] of body.matchAll(RUN_PROPERTIES)) {
      check(`style ${id}`, rPr);
    }
  }
  return gaps;
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
  drawingExtents: Array<{ widthEmu: number; heightEmu: number }>;
  /**
   * Each section's `w:pgSz` and `w:pgMar`, attribute by attribute. `w:pgMar`
   * requires all seven of its own, so a margin the IR leaves out is not
   * missing from the page: each backend writes its own default in its place,
   * and the two defaults differ (the header and footer distances did, 708
   * against 851 and 992).
   */
  pages: Array<Record<string, string>>;
  media: number;
  footnotes: number;
  endnotes: number;
  comments: number;
  docDefaults: { run: string[]; paragraph: string[] };
  /**
   * Each section's document grid: its type, and its pitch where a grid is on.
   * Without one (`default`, or no type at all) a pitch changes nothing.
   */
  grids: string[];
}

/**
 * The properties `w:docDefaults` sets, each element with its attributes in a
 * fixed order, so markup that says the same thing compares equal: an empty
 * `w:pPrDefault` and one holding an empty `w:pPr` both set nothing.
 */
function documentDefaults(styles: string): Shape['docDefaults'] {
  const block =
    /<w:docDefaults>([\s\S]*?)<\/w:docDefaults>/.exec(styles)?.[1] ?? '';
  const properties = (wrapper: 'rPr' | 'pPr'): string[] => {
    const inner =
      new RegExp(
        `<w:${wrapper}Default>([\\s\\S]*?)</w:${wrapper}Default>`
      ).exec(block)?.[1] ?? '';
    return [...inner.matchAll(/<([\w:]+)((?:\s+[\w:]+="[^"]*")*)\s*\/?>/g)]
      .filter(([, name]) => name !== `w:${wrapper}`)
      .map(([, name, attributes]) =>
        [name, ...(attributes.match(/[\w:]+="[^"]*"/g) ?? []).sort()].join(' ')
      )
      .sort();
  };
  return { run: properties('rPr'), paragraph: properties('pPr') };
}

async function shapeOf(buffer: Buffer): Promise<Shape> {
  const zip = await JSZip.loadAsync(buffer);
  const read = async (name: string): Promise<string> =>
    (await zip.file(name)?.async('string')) ?? '';

  const document = await read('word/document.xml');
  const body = document.slice(document.indexOf('<w:body>'));
  const count = (tag: string): number =>
    (body.match(new RegExp(`<${tag}[ />]`, 'g')) ?? []).length;
  const drawingExtents = [...body.matchAll(/<wp:extent\b([^>]*)\/?>/g)].map(
    ([, attributes]) => ({
      widthEmu: Number(/\bcx="(\d+)"/.exec(attributes)?.[1]),
      heightEmu: Number(/\bcy="(\d+)"/.exec(attributes)?.[1]),
    })
  );
  const pages = [...body.matchAll(/<w:(?:pgSz|pgMar)\b([^>]*)\/?>/g)].map(
    ([, attributes]) =>
      Object.fromEntries(
        [...attributes.matchAll(/\b(w:\w+)="([^"]*)"/g)].map(
          ([, name, value]) => [name, value]
        )
      )
  );

  return {
    // Empty text nodes are dropped: docx.js writes one per cached TOC entry as
    // the page-number placeholder and the other backend does not, which is a
    // difference in punctuation rather than in content.
    text: [...body.matchAll(TEXT)].map((m) => m[1]).filter((t) => t.length > 0),
    counts: Object.fromEntries(STRUCTURE.map((tag) => [tag, count(tag)])),
    drawingExtents,
    pages,
    media: Object.values(zip.files).filter(
      (file) => !file.dir && file.name.startsWith('word/media/')
    ).length,
    footnotes:
      (await read('word/footnotes.xml')).match(/<w:footnote /g)?.length ?? 0,
    endnotes:
      (await read('word/endnotes.xml')).match(/<w:endnote /g)?.length ?? 0,
    comments:
      (await read('word/comments.xml')).match(/<w:comment /g)?.length ?? 0,
    docDefaults: documentDefaults(await read('word/styles.xml')),
    grids: [...body.matchAll(/<w:docGrid\b([^>]*)>/g)].map(([, attributes]) => {
      const attribute = (name: string): string | undefined =>
        new RegExp(`\\bw:${name}="([^"]*)"`).exec(attributes)?.[1];
      const type = attribute('type') ?? 'default';
      return type === 'default'
        ? type
        : `${type} ${attribute('linePitch')} ${attribute('charSpace') ?? 0}`;
    }),
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

      const officeShape = await shapeOf(officeOpen.buffer);
      const docxShape = await shapeOf(docxjs.buffer);
      const { media: officeMedia, ...officeSemantics } = officeShape;
      const { media: docxMedia, ...docxSemantics } = docxShape;

      expect(officeSemantics).toEqual(docxSemantics);
      expect(officeMedia).toBeGreaterThanOrEqual(docxMedia);

      const styleIds = await declaredStyleIds(testCase.document);
      expect(await complexScriptGaps(officeOpen.buffer, styleIds)).toEqual(
        await complexScriptGaps(docxjs.buffer, styleIds)
      );
    },
    60_000
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
    60_000
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
  }, 60_000);

  it('keeps per-placement extents for every image type', async () => {
    const images = [PNG_4X2, JPEG_8X4, GIF_4X2, BMP_4X2, SVG_4X2].flatMap(
      (base64) => [
        { name: 'image', props: { base64, width: 80 } },
        { name: 'image', props: { base64, width: 120 } },
      ]
    );
    const document = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'section', props: {}, children: images }],
    };
    const [docxjs, officeOpen] = await Promise.all([
      generateBufferViaIr(document as never, { renderer: 'docxjs' }),
      generateBufferViaIr(document as never, { renderer: 'office-open' }),
    ]);

    expect((await shapeOf(officeOpen.buffer)).drawingExtents).toEqual(
      (await shapeOf(docxjs.buffer)).drawingExtents
    );

    const zip = await JSZip.loadAsync(officeOpen.buffer);
    for (const [path, entry] of Object.entries(zip.files)) {
      if (entry.dir || !path.startsWith('word/media/')) continue;
      const bytes = await entry.async('nodebuffer');
      expect(readImageDimensions(bytes, path).width).toBeGreaterThan(0);
      // The marker keeps the picture decodable, not just its header readable.
      expect(imageIntegrityDefect(bytes), path).toBeUndefined();
    }
  }, 60_000);

  // Marking a second placement used to append the marker after a PNG with no
  // intact IEND: one more defect in a file Word already cannot draw. Loading
  // refuses such bytes, so reaching the marker with them is a pipeline bug.
  it('refuses to mark a PNG that has no IEND', async () => {
    const compiled = await compileDocumentToIr({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        { name: 'image', props: { base64: PNG_4X2, width: 80 } },
        { name: 'image', props: { base64: PNG_4X2, width: 120 } },
      ],
    } as never);
    const [resource] = compiled.ir.resources;
    const truncated = resource.bytes.subarray(0, resource.bytes.length - 12);
    const ir = {
      ...compiled.ir,
      resources: [
        { ...resource, bytes: truncated, byteLength: truncated.length },
      ],
    };

    await expect(officeOpen.render(ir)).rejects.toThrow(/no intact IEND/);
  }, 60_000);
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
  }, 60_000);

  // Drawings are the interesting case for determinism — a `wp:docPr` id left
  // to a library counter changes on the second call — and they are covered for
  // both backends in `__tests__/document-isolation.test.ts`.
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
  }, 60_000);

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
  }, 60_000);
});
