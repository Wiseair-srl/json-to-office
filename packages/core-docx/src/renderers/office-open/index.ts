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

import { ALL_DOCX_FEATURES, type DocxFeature } from '../../ir/features';
import type {
  DocxIR,
  DocxIrBlock,
  DocxIrInline,
  DocxIrNote,
} from '../../ir/types';
import { rasterizeSvgFallback } from '../../utils/imageUtils';
import {
  canonicalizeDocxBuffer,
  resolveGenerationDate,
} from '../../utils/packageDocument';
import type { DocxRenderOptions, DocxRenderer, DocxRendererId } from '../types';
import {
  block,
  emuToPixels,
  floatingOptions,
  numberingConfig,
  section,
  type EmitContext,
  type ImagePictureFactory,
} from './emit';
import { emitStyles } from './styles';

export const OFFICE_OPEN_DOCX_RENDERER_ID: DocxRendererId = 'office-open';

/**
 * Module specifier held in a variable so TypeScript does not resolve the
 * optional dependency at build time and the failure lands at selection time.
 */
const OFFICE_OPEN_DOCX = '@office-open/docx';

/**
 * What this adapter does *not* declare, and why.
 *
 * - `cached-fields` — vocabulary no backend here emits; also undeclared by
 *   `docxjs`.
 * - `comment-threads` — `CommentOptions` is `{id, author, initials, date,
 *   children}`: it carries neither a parent nor a resolved state, so a threaded
 *   reply would flatten into an unrelated top-level comment.
 * - `table-merged-cells`, `shading`, `borders`, `rtl` — vocabulary the compiler
 *   does not require of any backend yet. Both adapters leave them out so the
 *   declared sets keep meaning "proven by a test".
 */
const UNSUPPORTED: ReadonlySet<DocxFeature> = new Set<DocxFeature>([
  'cached-fields',
  'comment-threads',
  'table-merged-cells',
  'shading',
  'borders',
  'rtl',
]);

const OFFICE_OPEN_CAPABILITIES: ReadonlySet<DocxFeature> = new Set(
  [...ALL_DOCX_FEATURES].filter((feature) => !UNSUPPORTED.has(feature))
);

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
      const document = await buildDocumentOptions(ir);
      const bytes = await backend.generateDocument(document, {
        type: 'uint8array',
      });
      const raw = Buffer.from(
        bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
      );

      if (options?.deterministic === false) return new Uint8Array(raw);
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
  ir: DocxIR
): Promise<Record<string, unknown>> {
  // One counter for the whole document. `wp:docPr` ids only have to be unique
  // within their part, and numbering across every part is both simpler and
  // strictly stronger — see `EmitContext`.
  let nextDrawingId = 1;
  const ctx: EmitContext = {
    pictures: await prepareImages(ir),
    nextDrawingId: () => nextDrawingId++,
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
 * Build a picture factory per resource.
 *
 * Separate from `buildDocumentOptions`'s synchronous work because a vector
 * image has to be rasterised for the fallback Word draws below 2016, and the
 * raster depends on the size the image is drawn at — so every placement of a
 * vector resource is rasterised up front and the factory looks the right one up.
 */
async function prepareImages(
  ir: DocxIR
): Promise<ReadonlyMap<string, ImagePictureFactory>> {
  const placements = collectImagePlacements(ir);
  const rasters = new Map<string, Buffer | undefined>();

  for (const resource of ir.resources) {
    if (resource.kind !== 'image' || resource.mediaType !== 'svg') continue;
    for (const size of placements.get(resource.id) ?? []) {
      const [width, height] = size.split('x').map(Number);
      rasters.set(
        `${resource.id}:${size}`,
        await rasterizeSvgFallback(Buffer.from(resource.bytes), {
          width,
          height,
        })
      );
    }
  }

  const resources = new Map<string, ImagePictureFactory>();
  for (const resource of ir.resources) {
    if (resource.kind !== 'image') continue;
    const type = resource.mediaType;
    const data = Buffer.from(resource.bytes);
    resources.set(resource.id, (image, drawingId) => {
      const transformation = {
        width: emuToPixels(image.widthEmu),
        height: emuToPixels(image.heightEmu),
      };
      return {
        type,
        data,
        transformation,
        // The id is stated rather than left to the backend's process-global
        // counter. `name` stays empty, which is what it was before and what
        // the backend falls back to.
        altText: { id: String(drawingId) },
        ...(type === 'svg'
          ? {
              // Word before 2016 draws the fallback rather than the vector. A
              // raster that could not be produced falls back to the SVG bytes,
              // which is what this pipeline has always shipped.
              fallback: {
                type: 'png',
                data:
                  rasters.get(
                    `${image.resourceId}:${transformation.width}x${transformation.height}`
                  ) ?? data,
              },
            }
          : {}),
        ...(image.floating
          ? { floating: floatingOptions(image.floating) }
          : {}),
        // No `description` or `title`: no DOCX this pipeline has produced
        // carries `wp:docPr` alt text, and the compiler warns so the gap is
        // visible rather than silent.
      };
    });
  }
  return resources;
}

/**
 * Every size each image resource is drawn at, as `WxH` in pixels.
 *
 * Only vector resources need this, but the walk cannot know which is which
 * without the resource list, and walking twice would cost more than it saves.
 */
function collectImagePlacements(ir: DocxIR): Map<string, Set<string>> {
  const placements = new Map<string, Set<string>>();

  const visitInline = (inline: DocxIrInline): void => {
    if (inline.kind === 'image') {
      const key = `${emuToPixels(inline.widthEmu)}x${emuToPixels(inline.heightEmu)}`;
      const sizes = placements.get(inline.resourceId) ?? new Set<string>();
      sizes.add(key);
      placements.set(inline.resourceId, sizes);
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
