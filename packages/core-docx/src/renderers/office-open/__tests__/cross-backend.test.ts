/**
 * The whole corpus, through both backends.
 *
 * Identical OOXML between two different renderers is not the goal and is not
 * asserted — the two disagree about plenty that a reader cannot see. What is
 * asserted is that the IR *means* the same thing to both: the same text in the
 * same order, the same number of tables, rows, cells, drawings, links, note and
 * comment references, drawing extents, the same paper and margins section by
 * section, the same note and comment parts, and the same bold, italic, size
 * and tracking on every style the IR declares.
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
 *
 * Two rules are held on each backend on its own, over the corpus and the two
 * report templates the block matrix is generated from: every table cell ends
 * on a paragraph, and every length OOXML states in whole twips is written as
 * one.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { imageIntegrityDefect } from '@json-to-office/shared/images/node';
import {
  compileDocumentToIr,
  generateBufferViaIr,
} from '../../../core/generateFromIr';
import type { DocxIrBlock } from '../../../ir/types';
import { resolveDocxRenderer } from '../../registry';
import { CORPUS } from '../../../__tests__/fixtures/corpus';
import {
  BMP_4X2,
  GIF_4X2,
  JPEG_8X4,
  PNG_4X2,
} from '../../../__tests__/fixtures/corpus-blocks';
import { readImageDimensions } from '../../../utils/imageUtils';
import { minimalTheme } from '../../../templates/themes';

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

/**
 * A run property as stated: half-points for a size, twentieths of a point for
 * tracking, else `on` or `off`.
 */
function statedValue(rPr: string, name: string): string | undefined {
  const match = new RegExp(`<${name}(?:\\s+w:val="([^"]*)")?\\s*/>`).exec(rPr);
  if (!match) return undefined;
  if (name.startsWith('w:sz') || name === 'w:spacing') return match[1];
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

/** How many content controls stand inside a table cell, however deep. */
function contentControlsInCells(xml: string): number {
  let depth = 0;
  let count = 0;
  for (const [tag] of xml.matchAll(/<\/?w:tc>|<w:sdt>/g)) {
    if (tag === '<w:tc>') depth += 1;
    else if (tag === '</w:tc>') depth -= 1;
    else if (depth > 0) count += 1;
  }
  return count;
}

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
  styles: Record<string, StyleRun>;
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

/** What a style's own `w:rPr` states about weight, slant, size and tracking. */
type StyleRun = Record<
  'bold' | 'italic' | 'size' | 'tracking',
  string | undefined
>;

/**
 * Each declared style's weight, slant, size and tracking, from its last
 * definition.
 *
 * The last, because docx.js writes its own `Heading1`-`Heading6` and `Title`
 * before the ones it was given, under the same ids, and LibreOffice applies
 * the later one.
 */
function styleRuns(
  stylesXml: string,
  ids: readonly string[]
): Record<string, StyleRun> {
  const definitions = new Map<string, string>();
  for (const [, id, body] of stylesXml.matchAll(STYLE)) {
    definitions.set(id, body);
  }
  return Object.fromEntries(
    ids.map((id) => {
      const rPr =
        /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(definitions.get(id) ?? '')?.[1] ?? '';
      return [
        id,
        {
          bold: statedValue(rPr, 'w:b'),
          italic: statedValue(rPr, 'w:i'),
          size: statedValue(rPr, 'w:sz'),
          tracking: statedValue(rPr, 'w:spacing'),
        },
      ];
    })
  );
}

async function shapeOf(
  buffer: Buffer,
  styleIds: readonly string[] = []
): Promise<Shape> {
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
    styles: styleRuns(await read('word/styles.xml'), styleIds),
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

      const styleIds = await declaredStyleIds(testCase.document);
      const officeShape = await shapeOf(officeOpen.buffer, styleIds);
      const docxShape = await shapeOf(docxjs.buffer, styleIds);
      const { media: officeMedia, ...officeSemantics } = officeShape;
      const { media: docxMedia, ...docxSemantics } = docxShape;

      expect(officeSemantics).toEqual(docxSemantics);
      expect(officeMedia).toBeGreaterThanOrEqual(docxMedia);

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

  it('reads the style properties it compares', async () => {
    // Guards the style comparison above from passing because neither side's
    // `styles.xml` was read. `minimal`'s Heading 5 is the case docx.js used to
    // lose: an italic the style states, which it never wrote.
    const document = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'heading', props: { level: 5, text: 'Five' } }],
    };
    const { ir } = await compileDocumentToIr(
      structuredClone(document) as never,
      { warnings: [] }
    );
    const heading = ir.styles.paragraph.find(
      (style) => style.id === 'Heading5'
    );
    expect(heading?.run?.italic).toBe(true);

    for (const renderer of ['docxjs', 'office-open'] as const) {
      const { buffer } = await generateBufferViaIr(
        structuredClone(document) as never,
        { renderer }
      );
      const { styles } = await shapeOf(buffer, ['Heading5']);
      expect(styles.Heading5.italic, renderer).toBe('on');
    }
  }, 60_000);

  it('reads the tracking it compares, in whole twentieths', async () => {
    // The same guard for tracking. `consulting`'s eyebrow tracks 8% of an em
    // at 8pt, 12.8 twentieths of a point, which `w:spacing` cannot state:
    // docx.js floors it to 12, and the other backend wrote 12.8.
    const document = {
      name: 'docx',
      props: { theme: 'consulting' },
      children: [{ name: 'paragraph', props: { text: 'Body.' } }],
    };
    const { ir } = await compileDocumentToIr(
      structuredClone(document) as never,
      { warnings: [] }
    );
    const eyebrow = ir.styles.paragraph.find((style) => style.id === 'eyebrow');
    expect(eyebrow?.run?.characterSpacingTwentieths).toBeCloseTo(12.8);

    for (const renderer of ['docxjs', 'office-open'] as const) {
      const { buffer } = await generateBufferViaIr(
        structuredClone(document) as never,
        { renderer }
      );
      const { styles } = await shapeOf(buffer, ['eyebrow']);
      expect(styles.eyebrow.tracking, renderer).toBe('12');
    }
  }, 60_000);

  it('floors run tracking as docx.js does, at the edges no style reaches', async () => {
    // A run's tracking goes through the same floor as a style's. Below zero it
    // floors away from zero; below one twentieth docx.js still writes a zero,
    // which overrides the tracking of the run's style.
    const tracked = (text: string, type: string, value: number) => ({
      name: 'paragraph',
      props: { text, font: { characterSpacing: { type, value } } },
    });
    const document = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        tracked('A', 'expanded', 12.8),
        tracked('B', 'condensed', 9.456),
        tracked('C', 'expanded', 0.5),
        tracked('D', 'expanded', 0),
      ],
    };
    const tracking = async (renderer: 'docxjs' | 'office-open') => {
      const { buffer } = await generateBufferViaIr(
        structuredClone(document) as never,
        { renderer }
      );
      const zip = await JSZip.loadAsync(buffer);
      const body = (await zip.file('word/document.xml')?.async('string')) ?? '';
      return Object.fromEntries(
        [...body.matchAll(/<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g)].flatMap(
          ([, run]) => {
            const text = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/.exec(run)?.[1];
            const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(run)?.[1] ?? '';
            return text ? [[text, statedValue(rPr, 'w:spacing')]] : [];
          }
        )
      );
    };

    const floored = { A: '12', B: '-10', C: '0', D: undefined };
    expect(await tracking('docxjs')).toEqual(floored);
    expect(await tracking('office-open')).toEqual(floored);
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

  it('keeps a table of contents that stands in a table cell', async () => {
    // A text box rendered as a table holds its content in the table's one
    // cell, and `@office-open/docx` writes a cell's paragraphs and tables and
    // nothing else: the field vanished on this backend alone, title and all
    // but the entries. One box ends on it, one opens with it, one holds it a
    // table deeper in `columns`, one has no entries to cache, and one stands
    // in a header, which is a part of its own.
    const box = (children: unknown[]) => ({
      name: 'text-box',
      props: {},
      children,
    });
    const toc = (title: string, props: Record<string, unknown> = {}) => ({
      name: 'toc',
      props: { title, ...props },
    });
    const paragraph = (text: string) => ({
      name: 'paragraph',
      props: { text },
    });
    const document = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: { header: [box([toc('In the header')])] },
          children: [
            box([paragraph('Before the contents.'), toc('Last in its box')]),
            box([toc('First in its box'), paragraph('After the contents.')]),
            box([
              {
                name: 'columns',
                props: { columns: 2 },
                children: [toc('A table deeper'), paragraph('Beside it.')],
              },
            ]),
            box([toc('Nothing to cache', { depth: { from: 6, to: 6 } })]),
            { name: 'heading', props: { level: 1, text: 'Alpha' } },
            { name: 'heading', props: { level: 2, text: 'Beta' } },
          ],
        },
      ],
    };
    const [docxjs, officeOpen] = await Promise.all([
      generateBufferViaIr(structuredClone(document) as never, {
        renderer: 'docxjs',
      }),
      generateBufferViaIr(structuredClone(document) as never, {
        renderer: 'office-open',
      }),
    ]);

    const officeShape = await shapeOf(officeOpen.buffer);
    expect(officeShape).toEqual(await shapeOf(docxjs.buffer));
    expect(officeShape.counts['w:sdt']).toBe(4);

    const parts = async (buffer: Buffer) => {
      const zip = await JSZip.loadAsync(buffer);
      return Promise.all(
        ['word/document.xml', 'word/header1.xml'].map(
          async (name) => (await zip.file(name)?.async('string')) ?? ''
        )
      );
    };
    const text = (xml: string): string[] =>
      [...xml.matchAll(TEXT)].map((m) => m[1]).filter((t) => t.length > 0);
    const [officeBody, officeHeader] = await parts(officeOpen.buffer);
    const [docxBody, docxHeader] = await parts(docxjs.buffer);

    // In the cell, not beside the table.
    expect(contentControlsInCells(officeBody)).toBe(4);
    expect(contentControlsInCells(docxBody)).toBe(4);
    expect(contentControlsInCells(officeHeader)).toBe(1);
    expect(contentControlsInCells(docxHeader)).toBe(1);
    expect(text(officeHeader)).toEqual(text(docxHeader));
    // And the cell still ends on a paragraph, as docx.js ends it.
    expect(officeBody + officeHeader).not.toMatch(/<\/w:sdt><\/w:tc>/);
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

/**
 * Every start, end and empty-element tag of a part, in order. An attribute
 * value is matched whole, since one may hold a `>`.
 */
const TAG =
  /<(\/?)([\w:.-]+)(?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*\s*(\/?)>/g;

/**
 * The last child element of every `w:tc` in a part, in document order, at any
 * depth: `none` for a cell that holds nothing at all.
 */
function cellEndings(xml: string): string[] {
  const open: Array<{ name: string; cell?: number; last?: string }> = [];
  const endings: string[] = [];
  for (const [, closing, name, empty] of xml.matchAll(TAG)) {
    if (closing) {
      const element = open.pop();
      if (element?.cell !== undefined)
        endings[element.cell] = element.last ?? 'none';
      continue;
    }
    const parent = open[open.length - 1];
    if (parent) parent.last = name;
    const cell = name === 'w:tc' ? endings.push('none') - 1 : undefined;
    if (!empty) open.push({ name, cell });
  }
  return endings;
}

/** The parts a table can stand in: the body, the headers and the footers. */
const TABLE_PARTS = /^word\/(document|header\d*|footer\d*)\.xml$/;

/** Every cell of a package whose last block is not a paragraph. */
async function cellsNotEndingOnAParagraph(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const found: string[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!TABLE_PARTS.test(path)) continue;
    cellEndings(await entry.async('string')).forEach((last, index) => {
      if (last !== 'w:p') found.push(`${path} cell ${index + 1}: ${last}`);
    });
  }
  return found;
}

/** Cells of the IR, at any depth, whose last block is a table. */
function cellsEndingOnATable(blocks: readonly DocxIrBlock[]): number {
  let count = 0;
  for (const value of blocks) {
    if (value.kind !== 'table') continue;
    for (const cell of value.rows.flatMap((row) => row.cells)) {
      if (cell.children[cell.children.length - 1]?.kind === 'table') count++;
      count += cellsEndingOnATable(cell.children);
    }
  }
  return count;
}

const TEMPLATES_DIR = fileURLToPath(
  new URL('../../../../../jto/src/client/public/templates/', import.meta.url)
);

/** A `highcharts` needs an export server, which no test here has: an image. */
function chartsAsImages(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(chartsAsImages);
  if (typeof node !== 'object' || node === null) return node;
  if ((node as { name?: unknown }).name === 'highcharts')
    return { name: 'image', props: { base64: PNG_4X2, width: 320 } };
  return Object.fromEntries(
    Object.entries(node).map(([key, value]) => [key, chartsAsImages(value)])
  );
}

/** The report templates the block matrix is generated from. */
const BLOCK_TEMPLATES = [
  'client-report-blocks.docx.json',
  'technical-report-blocks.docx.json',
].map((name) => ({
  name,
  document: chartsAsImages(
    JSON.parse(readFileSync(join(TEMPLATES_DIR, name), 'utf8'))
  ),
}));

/**
 * Word ends every table cell on a paragraph. A cell whose last block is a
 * nested table is one Word tolerates and LibreOffice misreads: the client
 * report's cover band, a floating text box ending on a table, stopped floating
 * on `office-open` and lost its top border (#468). Each backend is held to the
 * rule on its own rather than to the other, over every case it draws and over
 * the two report templates, whose blocks nest tables in text boxes.
 */
describe('every table cell ends on a paragraph', () => {
  it('reads the last block of every cell, nested ones included', () => {
    expect(
      cellEndings(
        '<w:tbl><w:tr><w:tc><w:tcPr><w:tcW w:w="1"/></w:tcPr><w:tbl><w:tr>' +
          '<w:tc><w:p><w:fldSimple w:instr="IF 2 > 1"/><w:r><w:t>a > b</w:t>' +
          '</w:r></w:p></w:tc></w:tr></w:tbl></w:tc><w:tc><w:tcPr/></w:tc>' +
          '<w:tc/></w:tr></w:tbl>'
      )
    ).toEqual(['w:tbl', 'w:p', 'w:tcPr', 'none']);
  });

  it('checks templates that end a cell on a table', async () => {
    for (const template of BLOCK_TEMPLATES) {
      const { ir } = await compileDocumentToIr(
        structuredClone(template.document) as never,
        { baseDir: TEMPLATES_DIR, warnings: [] }
      );
      const blocks = ir.sections.flatMap((section) => [
        ...section.children,
        ...[section.headers, section.footers].flatMap((set) =>
          Object.values(set ?? {}).flatMap((part) => part?.children ?? [])
        ),
      ]);
      expect(cellsEndingOnATable(blocks), template.name).toBeGreaterThan(0);
    }
  }, 60_000);

  describe.each([
    ['docxjs', CORPUS],
    ['office-open', COMMON],
  ] as const)('on %s', (renderer, cases) => {
    it.each(cases.map((c) => [c.name, c] as const))(
      'in %s',
      async (_name, testCase) => {
        const { buffer } = await generateBufferViaIr(
          structuredClone(testCase.document) as never,
          { renderer }
        );
        expect(await cellsNotEndingOnAParagraph(buffer)).toEqual([]);
      },
      60_000
    );

    it.each(BLOCK_TEMPLATES.map((t) => [t.name, t] as const))(
      'in the %s template',
      async (_name, template) => {
        const { buffer } = await generateBufferViaIr(
          structuredClone(template.document) as never,
          { renderer, baseDir: TEMPLATES_DIR }
        );
        expect(await cellsNotEndingOnAParagraph(buffer)).toEqual([]);
      },
      60_000
    );
  });
});

/**
 * The attributes, by element, that OOXML types as a whole number of twips —
 * `ST_TwipsMeasure` or `ST_SignedTwipsMeasure` — among those written from the
 * IR. A width's `w:w` in twips, `w:type="dxa"`, is held to it wherever it
 * stands: a table's, a cell's, a cell margin's. `w:spacing` names two
 * elements, a run's tracking and a paragraph's spacing, and both are held.
 */
const WHOLE_TWIPS: Readonly<Record<string, readonly string[]>> = {
  'w:spacing': ['w:val', 'w:before', 'w:after', 'w:line'],
  'w:tab': ['w:pos'],
  'w:framePr': ['w:w', 'w:h', 'w:x', 'w:y'],
  'w:ind': [
    'w:left',
    'w:right',
    'w:start',
    'w:end',
    'w:hanging',
    'w:firstLine',
  ],
  'w:trHeight': ['w:val'],
  'w:tblpPr': [
    'w:tblpX',
    'w:tblpY',
    'w:leftFromText',
    'w:rightFromText',
    'w:topFromText',
    'w:bottomFromText',
  ],
  'w:gridCol': ['w:w'],
  'w:pgSz': ['w:w', 'w:h'],
  'w:pgMar': [
    'w:top',
    'w:right',
    'w:bottom',
    'w:left',
    'w:header',
    'w:footer',
    'w:gutter',
  ],
  'w:cols': ['w:space'],
  'w:col': ['w:w', 'w:space'],
};

const ELEMENT = /<([\w:]+)((?:\s+[\w:.-]+="[^"]*")*)\s*\/?>/g;
const ATTRIBUTE = /([\w:.-]+)="([^"]*)"/g;

/** Each attribute of a part held to whole twips that holds anything else. */
function fractionalTwipsIn(path: string, xml: string): string[] {
  const found: string[] = [];
  for (const [, name, attributes] of xml.matchAll(ELEMENT)) {
    const values = new Map(
      [...attributes.matchAll(ATTRIBUTE)].map(([, key, value]) => [key, value])
    );
    const whole = new Set([
      ...(WHOLE_TWIPS[name] ?? []),
      ...(values.get('w:type') === 'dxa' ? ['w:w'] : []),
    ]);
    for (const attribute of whole) {
      const value = values.get(attribute);
      if (value !== undefined && !/^-?\d+$/.test(value))
        found.push(`${path} <${name} ${attribute}="${value}">`);
    }
  }
  return found;
}

async function fractionalTwips(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer);
  const found: string[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!/^word\/[^/]+\.xml$/.test(path)) continue;
    found.push(...fractionalTwipsIn(path, await entry.async('string')));
  }
  return found;
}

/**
 * A length OOXML states in twips is a whole number of them, which the IR does
 * not promise: a theme's tracking is a share of an em times the size, 12.8
 * twentieths of a point for an 8pt eyebrow, and a nested cell's padding halves
 * a remainder. docx.js floors each such attribute on the way out; the other
 * backend wrote what it was given, a document the schema refuses, and
 * LibreOffice set the client report's eyebrow and running head that much
 * wider. Each backend is held to it on its own.
 *
 * Paragraph spacing, tab stops and text frames go out as given on both
 * backends — docx.js floors none of them — so the compiler rounds them, for
 * both at once: a line height taken from a multiple of 1.157 was 277.68 twips
 * on each, `devportal`'s 1.02-line title 244.8. The corpus reaches only that
 * title fractional, so the lengths an author can state with a fraction are
 * held here in a document of their own.
 */
describe('every length in twips is a whole number', () => {
  it('reads the lengths it holds to whole twips, and only those', () => {
    expect(
      fractionalTwipsIn(
        'word/document.xml',
        '<w:pPr><w:tabs><w:tab w:val="center" w:pos="4513.5"/></w:tabs>' +
          '<w:spacing w:before="0.5" w:after="120" w:line="277.68" w:lineRule="auto"/>' +
          '<w:ind w:left="-9.5" w:hanging="360"/>' +
          '<w:framePr w:w="2000.5" w:h="300" w:x="-100.5" w:y="200.5" w:hAnchor="page"/>' +
          '</w:pPr><w:r><w:rPr><w:spacing w:val="12.8"/></w:rPr><w:tab/></w:r>' +
          '<w:tcPr><w:tcW w:w="206.5" w:type="dxa"/><w:tcMar>' +
          '<w:left w:w="112.5" w:type="dxa"/></w:tcMar></w:tcPr>' +
          '<w:tblW w:w="33.5" w:type="pct"/>'
      )
    ).toEqual([
      'word/document.xml <w:tab w:pos="4513.5">',
      'word/document.xml <w:spacing w:before="0.5">',
      'word/document.xml <w:spacing w:line="277.68">',
      'word/document.xml <w:ind w:left="-9.5">',
      'word/document.xml <w:framePr w:w="2000.5">',
      'word/document.xml <w:framePr w:x="-100.5">',
      'word/document.xml <w:framePr w:y="200.5">',
      'word/document.xml <w:spacing w:val="12.8">',
      'word/document.xml <w:tcW w:w="206.5">',
      'word/document.xml <w:left w:w="112.5">',
    ]);
  });

  /**
   * Every way a length in twips reaches the IR with a fraction, in one
   * document: a line-height multiple on a paragraph, in a cell and in the
   * theme's table-header style; a theme style's exact line height in points;
   * a tab stop on a paragraph and in the theme's TOC style; a frame's size
   * and offsets; a statistic's spacing; the gap the theme sets above a TOC
   * title. Each is rounded to the nearest whole twip.
   */
  const fractionalTheme = structuredClone(minimalTheme) as Record<string, any>;
  fractionalTheme.styles.heading1.lineSpacing = {
    type: 'exactly',
    value: 28.944,
  };
  fractionalTheme.styles.TOC1.tabStops = [
    { type: 'right', position: 8400.5, leader: 'none' },
  ];
  fractionalTheme.styles.tableHeader = {
    lineSpacing: { type: 'multiple', value: 1.157 },
  };
  fractionalTheme.componentDefaults = {
    ...fractionalTheme.componentDefaults,
    heading: { spacing: { before: 7.5 } },
  };

  const FRACTIONAL = {
    name: 'docx',
    props: { theme: 'fractional' },
    children: [
      { name: 'toc', props: { title: 'Contents' } },
      {
        name: 'paragraph',
        props: {
          text: 'Leading\tthen a centred tab.',
          font: { lineSpacing: { type: 'multiple', value: 1.157 } },
          tabStops: [{ type: 'center', position: 4513.5 }],
        },
      },
      {
        name: 'paragraph',
        props: {
          text: 'Framed.',
          floating: {
            width: 2000.5,
            height: 300.5,
            horizontalPosition: { relative: 'page', offset: -100.5 },
            verticalPosition: { relative: 'page', offset: '12.5%' },
          },
        },
      },
      {
        name: 'statistic',
        props: {
          number: '99',
          description: 'Uptime',
          spacing: { before: 120.5, after: 0.5 },
        },
      },
      {
        name: 'table',
        props: {
          columns: [
            {
              header: { content: 'H' },
              cells: [
                {
                  content: 'A',
                  font: { lineSpacing: { type: 'multiple', value: 1.11 } },
                },
              ],
            },
          ],
        },
      },
    ],
  };

  it.each(['docxjs', 'office-open'] as const)(
    'rounds the lengths stated with a fraction, on %s',
    async (renderer) => {
      const { buffer } = await generateBufferViaIr(
        structuredClone(FRACTIONAL) as never,
        { renderer, customThemes: { fractional: fractionalTheme as never } }
      );
      expect(await fractionalTwips(buffer)).toEqual([]);

      const zip = await JSZip.loadAsync(buffer);
      const [document, styles] = await Promise.all(
        ['word/document.xml', 'word/styles.xml'].map((path) =>
          zip.file(path)!.async('string')
        )
      );
      const lines = (xml: string) =>
        [...xml.matchAll(/<w:spacing [^>]*w:line="(-?\d+)"/g)].map(
          ([, line]) => line
        );
      // 1.157 lines are 277.68 240ths — on the paragraph and the header cell —
      // 1.11 lines 266.4, and 28.944pt is 578.88 twips.
      expect(lines(document).filter((line) => line === '278')).toHaveLength(2);
      expect(lines(document)).toContain('266');
      expect(lines(styles)).toContain('579');
      expect(document).toMatch(/<w:tab [^>]*w:pos="4514"/);
      expect(styles).toMatch(/<w:tab [^>]*w:pos="8401"/);
      const frame = /<w:framePr [^>]*\/>/.exec(document)?.[0] ?? '';
      // 12.5% of A4's 16838 twips is 2104.75.
      for (const [attribute, value] of [
        ['w:w', '2001'],
        ['w:h', '301'],
        ['w:x', '-100'],
        ['w:y', '2105'],
      ])
        expect(frame).toContain(`${attribute}="${value}"`);
      // 120.5 twips above the statistic, 7.5 above the TOC title.
      expect(document).toMatch(/<w:spacing [^>]*w:before="121"/);
      expect(document).toMatch(/<w:spacing [^>]*w:before="8"/);
    },
    60_000
  );

  describe.each([
    ['docxjs', CORPUS],
    ['office-open', COMMON],
  ] as const)('on %s', (renderer, cases) => {
    it.each(cases.map((c) => [c.name, c] as const))(
      'in %s',
      async (_name, testCase) => {
        const { buffer } = await generateBufferViaIr(
          structuredClone(testCase.document) as never,
          { renderer }
        );
        expect(await fractionalTwips(buffer)).toEqual([]);
      },
      60_000
    );

    it.each(BLOCK_TEMPLATES.map((t) => [t.name, t] as const))(
      'in the %s template',
      async (_name, template) => {
        const { buffer } = await generateBufferViaIr(
          structuredClone(template.document) as never,
          { renderer, baseDir: TEMPLATES_DIR }
        );
        expect(await fractionalTwips(buffer)).toEqual([]);
      },
      60_000
    );
  });
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
