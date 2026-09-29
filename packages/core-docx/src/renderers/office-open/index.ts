/**
 * The experimental `@office-open/docx` renderer.
 *
 * Selecting it is explicit and opt-in; `docxjs` stays the default. The backend
 * is a dependency of this package, loaded at call time: only a document that
 * selects this renderer pays for loading it, and a broken install surfaces as
 * an install hint rather than a module-resolution failure.
 *
 * The capability set below is deliberately narrow. A feature is listed only
 * when it has been proven against the real package, never from its README, and
 * a gap in the backend is expressed by *omitting* the capability — which makes
 * the pipeline reject the document before any bytes exist, instead of shipping
 * a file with content quietly missing.
 */

import AdmZip from 'adm-zip';
import {
  assertBackendVersion,
  installedPackageVersion,
} from '@json-to-office/shared/rendering/node';
import type {
  CommentOptions,
  DocumentOptions,
  FootnoteOptions,
  ParagraphOptions,
} from '@office-open/docx';
import type { DocxFeature } from '../../ir/features';
import type {
  DocxIR,
  DocxIrBlock,
  DocxIrChartRun,
  DocxIrInline,
  DocxIrNote,
} from '../../ir/types';
import { finishChartParts } from './chartParts';
import { spliceTheme } from './themePart';
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
  type PreparedImage,
} from './emit';
import { emitStyles } from './styles';

export const OFFICE_OPEN_DOCX_RENDERER_ID: DocxRendererId = 'office-open';

/**
 * Module specifier held in a variable so neither TypeScript nor a bundler
 * resolves the backend statically, and a missing one fails at selection time.
 * Its types are imported by name alone (`import type`), which erases.
 */
const OFFICE_OPEN_DOCX = '@office-open/docx';

/**
 * The `@office-open/docx` release this adapter is built and verified against, and the
 * exact version `package.json` pins (a test holds the two together).
 *
 * The adapter hands the backend its options as data, typed against this
 * release: another one can rename or restructure them with nothing failing
 * until a document comes out with content missing. So a different version
 * installed — an override, a hoisted copy — refuses the renderer by name
 * instead (`RENDERER_BACKEND_VERSION_MISMATCH`).
 */
export const OFFICE_OPEN_VERSION = '0.14.6';

/** The version of `@office-open/docx` this module resolves, or nothing if unreadable. */
function installedBackendVersion(): string | undefined {
  let resolved: string | undefined;
  try {
    // Resolved here, as this module's dependency; a test transform may not
    // provide `import.meta.resolve`, and the helper then searches from
    // `import.meta.url` itself.
    resolved = import.meta.resolve?.(OFFICE_OPEN_DOCX);
  } catch {
    resolved = undefined;
  }
  return installedPackageVersion(OFFICE_OPEN_DOCX, import.meta.url, resolved);
}

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

/** The two entry points this adapter calls, typed as the package types them. */
type OfficeOpenBackend = Pick<
  typeof import('@office-open/docx'),
  'generateDocument'
>;

export async function createOfficeOpenDocxRenderer(): Promise<DocxRenderer> {
  // Throws `Cannot find package '@office-open/docx'` when the backend is
  // missing from the install; the registry rewrites that into an install hint.
  const backend = (await import(
    /* @vite-ignore */ OFFICE_OPEN_DOCX
  )) as unknown as OfficeOpenBackend;
  assertBackendVersion(
    OFFICE_OPEN_DOCX,
    OFFICE_OPEN_VERSION,
    installedBackendVersion()
  );

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

      // The backend writes every chart option but a scatter chart's style,
      // which is finished here — see `chartParts.ts`. And it always writes
      // Office's theme and takes no option for another, so the document's is
      // spliced in — see `themePart.ts`. The compiler always sets `ir.theme`,
      // so every render now takes this pass. That is deliberate and costs
      // nothing: `canonicalizeDocxBuffer` re-zips anyway. Do not narrow the
      // condition back.
      if (ir.theme || charts.length > 0) {
        const zip = new AdmZip(raw);
        if (ir.theme) spliceTheme(zip, ir.theme);
        finishChartParts(zip, charts);
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
): Promise<DocumentOptions> {
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
    sections: ir.sections.map((value, index) =>
      section(value, ctx, index === ir.sections.length - 1)
    ),
    ...coreProperties(ir),
    settings: {
      updateFields: ir.settings.updateFields,
      ...(ir.settings.trackRevisions ? { trackRevisions: true } : {}),
    },
    ...(ir.numbering.length > 0
      ? {
          numbering: {
            abstractNumberings: ir.numbering.map(numberingConfig),
          },
        }
      : {}),
    ...(ir.footnotes.length > 0
      ? { footnotes: noteBodies(ir.footnotes, ctx) }
      : {}),
    ...(ir.endnotes.length > 0
      ? { endnotes: noteBodies(ir.endnotes, ctx) }
      : {}),
    ...(ir.comments.length > 0
      ? {
          comments: ir.comments.map(
            (comment): CommentOptions => ({
              id: comment.id,
              author: comment.author,
              ...(comment.initials ? { initials: comment.initials } : {}),
              date: comment.date,
              children: comment.children.map((child) =>
                paragraphOf(child, ctx)
              ),
            })
          ),
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
function paragraphOf(value: DocxIrBlock, ctx: EmitContext): ParagraphOptions {
  const emitted = block(value, ctx);
  if (!('paragraph' in emitted) || typeof emitted.paragraph === 'string') {
    throw new Error(
      `the office-open renderer expected a paragraph, not a "${value.kind}"`
    );
  }
  return emitted.paragraph;
}

/** Note bodies with their ids, which is how the backend takes them. */
function noteBodies(
  notes: readonly DocxIrNote[],
  ctx: EmitContext
): FootnoteOptions[] {
  return notes.map((note) => ({
    id: note.id,
    children: note.children.map((child) => paragraphOf(child, ctx)),
  }));
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
    // The IR's media types are the backend's picture types, `svg` included.
    const type = resource.mediaType as PreparedImage['type'];
    const data = Buffer.from(resource.bytes);
    resources.set(resource.id, (placement) => {
      const sizeKey = placementKey(placement);
      const stem = `${resource.id}-${sizeKey}`;
      return {
        type,
        // The same bytes at every size: the backend keeps each drawing's
        // extent on the drawing. 0.11 kept it on its deduplicated media
        // entry, and an image drawn at a second size took the first one's,
        // unless its bytes were told apart.
        data,
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

function coreProperties(
  ir: DocxIR
): Pick<
  DocumentOptions,
  | 'title'
  | 'subject'
  | 'description'
  | 'creator'
  | 'lastModifiedBy'
  | 'keywords'
  | 'customProperties'
> {
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
