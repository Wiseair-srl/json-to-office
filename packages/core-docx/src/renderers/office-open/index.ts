/**
 * The experimental `@office-open/docx` renderer.
 *
 * Selecting it is explicit and opt-in; `docxjs` stays the default. The backend
 * is an optional peer dependency, resolved at call time so a missing package
 * surfaces as an install hint rather than a module-resolution failure.
 *
 * The capability set below is deliberately narrow. A feature is listed only
 * when it has been proven against the real package, never from its README, and
 * a gap in the backend is expressed by *omitting* the capability — which makes
 * the pipeline reject the document before any bytes exist, instead of shipping
 * a file with content quietly missing.
 */

import AdmZip from 'adm-zip';
import type { DocxFeature } from '../../ir/features';
import type {
  DocxIR,
  DocxIrBlock,
  DocxIrChartRun,
  DocxIrInline,
  DocxIrNote,
} from '../../ir/types';
import { spliceChartParts } from './chartParts';
import {
  rasterizeSvgFallbacks,
  type SvgFallbackJob,
} from '../../utils/imageUtils';
import {
  canonicalizeDocxBuffer,
  normalizeDocxCaseBuffer,
  resolveGenerationDate,
} from '../../utils/packageDocument';
import type { DocxRenderOptions, DocxRenderer, DocxRendererId } from '../types';
import {
  block,
  emuToPixels,
  numberingConfig,
  section,
  type EmitContext,
  type ImageMediaFactory,
} from './emit';
import { emitStyles } from './styles';

export const OFFICE_OPEN_DOCX_RENDERER_ID: DocxRendererId = 'office-open';

/**
 * Module specifier held in a variable so TypeScript does not resolve the
 * optional dependency at build time and the failure lands at selection time.
 */
const OFFICE_OPEN_DOCX = '@office-open/docx';

/**
 * This adapter uses an explicit allowlist: a new `DocxFeature` stays
 * unsupported until the adapter deliberately adds and tests it.
 *
 * What this adapter does *not* declare, and why.
 *
 * - `cached-fields` — vocabulary no backend here emits; also undeclared by
 *   `docxjs`.
 * - `comment-threads` — `CommentOptions` is `{id, author, initials, date,
 *   children}`: it carries neither a parent nor a resolved state, so a threaded
 *   reply would flatten into an unrelated top-level comment.
 * - `table-merged-cells`, `shading`, `rtl` — vocabulary the compiler does not
 *   require of any backend yet. Both adapters leave them out so the declared
 *   sets keep meaning "proven by a test". `borders` left that list when
 *   `divider` started requiring it: a paragraph border is what draws a
 *   horizontal line, and both adapters now emit and test one.
 */
const OFFICE_OPEN_CAPABILITIES: ReadonlySet<DocxFeature> = new Set([
  'paragraphs',
  'styles',
  'numbering',
  'sections',
  'columns',
  'headers-footers',
  'tables',
  'floating-tables',
  'images',
  'floating-images',
  'svg-images',
  'text-frames',
  'text-boxes',
  'drawing-groups',
  'charts',
  'toc',
  'cached-toc',
  'fields',
  'hyperlinks',
  'bookmarks',
  'cross-references',
  'comments',
  'footnotes',
  'endnotes',
  'revisions',
  'breaks',
  'borders',
  'tab-stops',
  'proofing-language',
  'custom-properties',
]);

interface OfficeOpenBackend {
  generateDocument: (
    options: Record<string, unknown>,
    packerOptions?: { type?: string }
  ) => Promise<Uint8Array>;
}

export async function createOfficeOpenDocxRenderer(): Promise<DocxRenderer> {
  // Throws `Cannot find package '@office-open/docx'` when the optional
  // dependency is absent; the registry rewrites that into an install hint.
  const backend = (await import(
    /* @vite-ignore */ OFFICE_OPEN_DOCX
  )) as unknown as OfficeOpenBackend;

  if (typeof backend.generateDocument !== 'function') {
    throw new Error(
      `${OFFICE_OPEN_DOCX} does not export generateDocument(); the installed version is not compatible with this adapter.`
    );
  }

  return {
    id: OFFICE_OPEN_DOCX_RENDERER_ID,
    format: 'docx',
    capabilities: OFFICE_OPEN_CAPABILITIES,
    async render(ir: DocxIR, options?: DocxRenderOptions): Promise<Uint8Array> {
      const charts: DocxIrChartRun[] = [];
      const document = await buildDocumentOptions(
        ir,
        charts,
        options?.svgRasterFallback
      );
      const bytes = await backend.generateDocument(document, {
        type: 'uint8array',
      });
      let raw = Buffer.from(
        bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      );

      // The backend writes a chart's cached values and nothing that sources
      // them: no workbook, no series colours, no axis titles. Splicing those
      // in is what separates a chart that draws from one a recipient can
      // actually edit — see `chartParts.ts`.
      if (charts.length > 0) {
        const zip = new AdmZip(raw);
        spliceChartParts(zip, charts);
        raw = zip.toBuffer();
      }

      if (options?.deterministic === false)
        return new Uint8Array(normalizeDocxCaseBuffer(raw));
      // The backend stamps ZIP entries with the wall clock, so the same
      // document rendered twice differs. Pinning those is a property of an
      // OOXML package rather than of this backend, which is why the same pass
      // runs over the default backend's output too.
      return new Uint8Array(
        canonicalizeDocxBuffer(
          raw,
          resolveGenerationDate({
            deterministic: options?.deterministic,
            generatedAt: options?.generatedAt,
          })
        )
      );
    },
  };
}

/**
 * Build the backend's document object for an IR document.
 *
 * Exported for tests: asserting on this object is far cheaper, and far more
 * legible, than unzipping a package.
 */
export async function buildDocumentOptions(
  ir: DocxIR,
  charts: DocxIrChartRun[] = [],
  svgRasterFallback?: boolean
): Promise<Record<string, unknown>> {
  // One counter for the whole document. `wp:docPr` ids only have to be unique
  // within their part, and numbering across every part is both simpler and
  // strictly stronger — see `EmitContext`.
  let nextDrawingId = 1;
  const ctx: EmitContext = {
    pictures: await prepareImages(ir, svgRasterFallback),
    nextDrawingId: () => nextDrawingId++,
    charts,
  };

  return {
    styles: emitStyles(ir.styles),
    sections: ir.sections.map((value) => section(value, ctx)),
    ...coreProperties(ir),
    features: {
      updateFields: ir.settings.updateFields,
      ...(ir.settings.trackRevisions ? { trackRevisions: true } : {}),
    },
    ...(ir.numbering.length > 0
      ? { numbering: { config: ir.numbering.map(numberingConfig) } }
      : {}),
    ...(ir.footnotes.length > 0
      ? { footnotes: noteBodies(ir.footnotes, ctx) }
      : {}),
    ...(ir.endnotes.length > 0
      ? { endnotes: noteBodies(ir.endnotes, ctx) }
      : {}),
    ...(ir.comments.length > 0
      ? {
          comments: {
            children: ir.comments.map((comment) => ({
              id: comment.id,
              author: comment.author,
              ...(comment.initials ? { initials: comment.initials } : {}),
              date: comment.date,
              children: comment.children.map((child) =>
                paragraphOf(child, ctx)
              ),
            })),
          },
        }
      : {}),
  };
}

/**
 * Note and comment bodies are paragraph options, not tagged section children.
 *
 * Anything else in one is a compiler bug rather than an author error: the
 * pipeline only ever puts paragraphs in a note or a comment.
 */
function paragraphOf(
  value: DocxIrBlock,
  ctx: EmitContext
): Record<string, unknown> {
  const emitted = block(value, ctx);
  const asParagraph = emitted.paragraph as Record<string, unknown> | undefined;
  if (!asParagraph) {
    throw new Error(
      `the office-open renderer expected a paragraph, not a "${value.kind}"`
    );
  }
  return asParagraph;
}

/** Note bodies keyed by id, which is how the backend takes them. */
function noteBodies(
  notes: readonly DocxIrNote[],
  ctx: EmitContext
): Record<string, { children: Record<string, unknown>[] }> {
  const bodies: Record<string, { children: Record<string, unknown>[] }> = {};
  for (const note of notes) {
    bodies[String(note.id)] = {
      children: note.children.map((child) => paragraphOf(child, ctx)),
    };
  }
  return bodies;
}

/**
 * Build a media factory per resource.
 *
 * Separate from `buildDocumentOptions`'s synchronous work because a vector
 * image has to be rasterised for the fallback Word draws below 2016, and the
 * raster depends on the size the image is drawn at — so every placement of a
 * vector resource is rasterised up front and the factory looks the right one up.
 */
async function prepareImages(
  ir: DocxIR,
  svgRasterFallback?: boolean
): Promise<ReadonlyMap<string, ImageMediaFactory>> {
  const placements = collectImagePlacements(ir);
  const jobs: SvgFallbackJob[] = [];

  for (const resource of ir.resources) {
    if (resource.kind !== 'image' || resource.mediaType !== 'svg') continue;
    for (const size of placements.get(resource.id) ?? []) {
      const [width, height] = size.split('x').map(Number);
      jobs.push({
        key: `${resource.id}:${size}`,
        svg: Buffer.from(resource.bytes),
        width,
        height,
      });
    }
  }

  const rasters = await rasterizeSvgFallbacks(jobs, svgRasterFallback);

  const resources = new Map<string, ImageMediaFactory>();
  for (const resource of ir.resources) {
    if (resource.kind !== 'image') continue;
    const type = resource.mediaType;
    const data = Buffer.from(resource.bytes);
    const placementData = new Map<string, Buffer>();
    [...(placements.get(resource.id) ?? [])].forEach((size, index) => {
      placementData.set(
        size,
        index === 0 ? data : distinguishImageBytes(data, type, size)
      );
    });
    resources.set(resource.id, (placement) => {
      const sizeKey = placementKey(placement);
      const stem = `${resource.id}-${sizeKey}`;
      return {
        type,
        // @office-open/docx stores a drawing transformation on its deduplicated
        // media entry. Equivalent bytes drawn at a second size would otherwise
        // reuse the first size, so each distinct placement size gets equivalent
        // image bytes carrying a harmless format-native marker.
        data: placementData.get(sizeKey) ?? data,
        // Named after the resource and the size it is drawn at, so two
        // placements of one image at one size share a single part and a third
        // at another size gets its own.
        fileName: `${stem}.${type}`,
        ...(type === 'svg'
          ? {
              // Word before 2016 draws the fallback rather than the vector. A
              // raster that could not be produced falls back to the SVG bytes,
              // which is what this pipeline has always shipped.
              fallback: {
                type: 'png',
                data: rasters.get(`${resource.id}:${sizeKey}`) ?? data,
              },
              fallbackFileName: `${stem}-fallback.png`,
            }
          : {}),
      };
    });
  }
  return resources;
}

/**
 * The key one placement of a resource is distinguished by: its drawn size in
 * whole pixels.
 *
 * One function so the collecting walk and the factory cannot disagree — a key
 * computed two ways is a silently-shared media entry and an image drawn at the
 * wrong size.
 */
function placementKey(placement: {
  widthEmu: number;
  heightEmu: number;
}): string {
  return `${emuToPixels(placement.widthEmu)}x${emuToPixels(placement.heightEmu)}`;
}

/**
 * Keep an image visually identical while giving a differently-sized placement
 * distinct bytes. The backend deduplicates media by bytes and, unlike OOXML,
 * keeps the drawing extent on that shared media record.
 */
function distinguishImageBytes(
  data: Buffer,
  mediaType: string,
  placement: string
): Buffer {
  const marker = Buffer.from(`json-to-office:${placement}`, 'utf8');

  switch (mediaType) {
    case 'png':
      return addPngTextChunk(data, marker);
    case 'jpg':
      return addJpegComment(data, marker);
    case 'gif':
      return addGifComment(data, marker);
    case 'svg':
      return Buffer.concat([
        data,
        Buffer.from(`\n<!-- ${marker.toString('utf8')} -->`, 'utf8'),
      ]);
    case 'bmp': {
      const marked = Buffer.concat([data, marker]);
      if (
        marked.length >= 14 &&
        marked.subarray(0, 2).toString('ascii') === 'BM'
      ) {
        marked.writeUInt32LE(marked.length, 2);
      }
      return marked;
    }
    default:
      return Buffer.concat([data, marker]);
  }
}

/** Insert a valid ancillary tEXt chunk immediately before PNG's IEND chunk. */
function addPngTextChunk(data: Buffer, marker: Buffer): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (data.length < 8 || !data.subarray(0, 8).equals(signature)) {
    return Buffer.concat([data, marker]);
  }

  let offset = 8;
  while (offset + 12 <= data.length) {
    const payloadLength = data.readUInt32BE(offset);
    const chunkEnd = offset + 12 + payloadLength;
    if (chunkEnd > data.length) break;
    if (data.subarray(offset + 4, offset + 8).toString('ascii') === 'IEND') {
      const payload = Buffer.concat([
        Buffer.from('json-to-office\0', 'latin1'),
        marker,
      ]);
      const chunk = Buffer.alloc(12 + payload.length);
      chunk.writeUInt32BE(payload.length, 0);
      chunk.write('tEXt', 4, 4, 'ascii');
      payload.copy(chunk, 8);
      chunk.writeUInt32BE(
        crc32(chunk.subarray(4, 8 + payload.length)),
        8 + payload.length
      );
      return Buffer.concat([
        data.subarray(0, offset),
        chunk,
        data.subarray(offset),
      ]);
    }
    offset = chunkEnd;
  }

  return Buffer.concat([data, marker]);
}

/** Insert a legal JPEG COM segment after the start-of-image marker. */
function addJpegComment(data: Buffer, marker: Buffer): Buffer {
  if (data.length < 2 || data[0] !== 0xff || data[1] !== 0xd8) {
    return Buffer.concat([data, marker]);
  }
  const comment = Buffer.alloc(4 + marker.length);
  comment[0] = 0xff;
  comment[1] = 0xfe;
  comment.writeUInt16BE(marker.length + 2, 2);
  marker.copy(comment, 4);
  return Buffer.concat([data.subarray(0, 2), comment, data.subarray(2)]);
}

/** Insert a legal GIF comment extension before the trailer. */
function addGifComment(data: Buffer, marker: Buffer): Buffer {
  const trailer = data.lastIndexOf(0x3b);
  if (trailer < 0 || marker.length > 255) {
    return Buffer.concat([data, marker]);
  }
  const comment = Buffer.concat([
    Buffer.from([0x21, 0xfe, marker.length]),
    marker,
    Buffer.from([0]),
  ]);
  return Buffer.concat([
    data.subarray(0, trailer),
    comment,
    data.subarray(trailer),
  ]);
}

/** CRC-32 used by PNG chunks. */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Every size each image resource is drawn at, as `WxH` in pixels.
 *
 * Only vector resources need this, but the walk cannot know which is which
 * without the resource list, and walking twice would cost more than it saves.
 */
interface PlacementSize {
  widthEmu: number;
  heightEmu: number;
}

function collectImagePlacements(ir: DocxIR): Map<string, Set<string>> {
  const placements = new Map<string, Set<string>>();

  const record = (resourceId: string, placement: PlacementSize): void => {
    const sizes = placements.get(resourceId) ?? new Set<string>();
    sizes.add(placementKey(placement));
    placements.set(resourceId, sizes);
  };

  const visitInline = (inline: DocxIrInline): void => {
    if (inline.kind === 'image') {
      record(inline.resourceId, inline);
      return;
    }
    if (inline.kind === 'drawingGroup') {
      // A grouped picture is media like any other, and shares the resource
      // pool with the run-level ones — so it has to take part in the same
      // per-size bookkeeping or the two would fight over one media entry.
      for (const child of inline.children) {
        if (child.kind === 'picture') {
          record(child.resourceId, {
            widthEmu: child.frame.widthEmu,
            heightEmu: child.frame.heightEmu,
          });
          continue;
        }
        child.text?.paragraphs.forEach(visitBlock);
      }
      return;
    }
    if (inline.kind === 'hyperlink' || inline.kind === 'revision') {
      inline.children.forEach(visitInline);
      return;
    }
    if (inline.kind === 'shape') inline.children.forEach(visitBlock);
  };

  const visitBlock = (value: DocxIrBlock): void => {
    if (value.kind === 'paragraph') {
      value.children.forEach(visitInline);
      return;
    }
    if (value.kind === 'table') {
      for (const row of value.rows) {
        for (const cell of row.cells) cell.children.forEach(visitBlock);
      }
    }
  };

  for (const value of ir.sections) {
    value.children.forEach(visitBlock);
    for (const slot of ['default', 'first', 'even'] as const) {
      value.headers?.[slot]?.children.forEach(visitBlock);
      value.footers?.[slot]?.children.forEach(visitBlock);
    }
  }
  for (const comment of ir.comments) comment.children.forEach(visitBlock);
  for (const note of [...ir.footnotes, ...ir.endnotes]) {
    note.children.forEach(visitBlock);
  }

  return placements;
}

function coreProperties(ir: DocxIR): Record<string, unknown> {
  const { metadata } = ir;
  return {
    ...(metadata.title ? { title: metadata.title } : {}),
    ...(metadata.subject ? { subject: metadata.subject } : {}),
    ...(metadata.description ? { description: metadata.description } : {}),
    ...(metadata.author ? { creator: metadata.author } : {}),
    ...(metadata.lastModifiedBy
      ? { lastModifiedBy: metadata.lastModifiedBy }
      : {}),
    ...(metadata.keywords ? { keywords: metadata.keywords } : {}),
    ...(metadata.custom?.length ? { customProperties: metadata.custom } : {}),
  };
}
