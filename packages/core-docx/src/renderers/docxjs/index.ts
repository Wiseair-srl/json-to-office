/**
 * The docx.js renderer.
 *
 * This is the only place in `core-docx` production code that may import `docx`
 * once the migration completes. It consumes DocxIR and nothing else — no author
 * JSON, no `ProcessedDocument`, no theme lookups.
 *
 */

import {
  BookmarkEnd,
  BookmarkStart,
  Column,
  Document,
  Footer,
  Header,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  type ICommentOptions,
  type ILevelsOptions,
  type ISectionOptions,
} from 'docx';
import { emitStyles } from './styles';
import { rasterizeSvgFallback } from '../../utils/imageUtils';
import type {
  DocxIR,
  DocxIrBlock,
  DocxIrHeaderFooter,
  DocxIrInline,
  DocxIrNote,
  DocxIrNumbering,
  DocxIrSection,
} from '../../ir/types';
import { ALL_DOCX_FEATURES, type DocxFeature } from '../../ir/features';
import {
  canonicalizeDocxBuffer,
  resolveGenerationDate,
} from '../../utils/packageDocument';
import { fixFloatingImageIdsInBuffer } from '../../utils/fixFloatingImageIds';
import type { DocxRenderOptions, DocxRenderer, DocxRendererId } from '../types';
import {
  ALIGNMENT,
  emitBlock,
  floatingOptions,
  runOptions,
  type EmitResources,
  type ImageRunFactory,
} from './emit';
import { emuToPixels } from '../../ir/units';

export const DOCXJS_RENDERER_ID: DocxRendererId = 'docxjs';

/**
 * What this adapter can express today.
 *
 * The exclusions are the slice boundary, not backend gaps: docx.js supports all
 * of them, and each moves into this set as the compiler learns to lower it.
 */
const NOT_YET_EMITTED: ReadonlySet<DocxFeature> = new Set<DocxFeature>([
  'table-merged-cells',
  'cached-fields',
  'shading',
  'borders',
  'rtl',
]);

const DOCXJS_CAPABILITIES: ReadonlySet<DocxFeature> = new Set(
  [...ALL_DOCX_FEATURES].filter((feature) => !NOT_YET_EMITTED.has(feature))
);

export function createDocxJsRenderer(): DocxRenderer {
  return {
    id: DOCXJS_RENDERER_ID,
    format: 'docx',
    capabilities: DOCXJS_CAPABILITIES,
    async render(
      ir: DocxIR,
      renderOptions?: DocxRenderOptions
    ): Promise<Uint8Array> {
      const resources = await prepareImages(ir);
      const document = buildDocument(ir, resources);
      const packed = (await Packer.toBuffer(document)) as Buffer;
      const fixed = fixFloatingImageIdsInBuffer(packed);

      if (renderOptions?.deterministic === false) return new Uint8Array(fixed);
      return new Uint8Array(
        canonicalizeDocxBuffer(
          fixed,
          resolveGenerationDate({
            deterministic: renderOptions?.deterministic,
            generatedAt: renderOptions?.generatedAt,
          })
        )
      );
    },
  };
}

/**
 * Build the docx.js object graph for an IR document.
 *
 * Exported for tests: asserting on the object graph is far cheaper, and far
 * more legible, than unzipping a package.
 */
export function buildDocument(
  ir: DocxIR,
  resources: EmitResources = new Map()
): Document {
  return new Document({
    styles: emitStyles(ir.styles),
    sections: ir.sections.map((section) => sectionOptions(section, resources)),
    ...coreProperties(ir),
    features: {
      updateFields: ir.settings.updateFields,
      ...(ir.settings.trackRevisions ? { trackRevisions: true } : {}),
    },
    ...(ir.numbering.length > 0
      ? { numbering: { config: ir.numbering.map(numberingConfig) } }
      : {}),
    // word/footnotes.xml and word/endnotes.xml, keyed by the id their
    // references carry.
    ...(ir.footnotes.length > 0
      ? { footnotes: noteBodies(ir.footnotes, resources) }
      : {}),
    ...(ir.endnotes.length > 0
      ? { endnotes: noteBodies(ir.endnotes, resources) }
      : {}),
    // word/comments.xml, written only when something was actually commented.
    ...(ir.comments.length > 0
      ? {
          comments: {
            children: ir.comments.map((comment) => ({
              id: comment.id,
              author: comment.author,
              ...(comment.initials ? { initials: comment.initials } : {}),
              date: new Date(comment.date),
              children: comment.children.map((block) =>
                emitBlock(block, resources)
              ),
              ...(comment.parentId !== undefined
                ? { parentId: comment.parentId }
                : {}),
              ...(comment.resolved !== undefined
                ? { resolved: comment.resolved }
                : {}),
            })) as ICommentOptions[],
          },
        }
      : {}),
  });
}

/** Note bodies keyed by id, which is how docx.js takes them. */
function noteBodies(
  notes: readonly DocxIrNote[],
  resources: EmitResources
): Record<string, { children: Paragraph[] }> {
  const bodies: Record<string, { children: Paragraph[] }> = {};
  for (const note of notes) {
    bodies[String(note.id)] = {
      children: note.children.map(
        (block) => emitBlock(block, resources) as Paragraph
      ),
    };
  }
  return bodies;
}

/** One IR numbering definition as a docx.js abstract numbering config. */
function numberingConfig(numbering: DocxIrNumbering): {
  reference: string;
  levels: ILevelsOptions[];
} {
  return {
    reference: numbering.reference,
    levels: numbering.levels.map((level) => ({
      level: level.level,
      format: level.format as ILevelsOptions['format'],
      text: level.text,
      alignment: level.alignment ? ALIGNMENT[level.alignment] : undefined,
      ...(level.suffix ? { suffix: level.suffix } : {}),
      style: {
        ...(level.indent
          ? {
              paragraph: {
                indent: {
                  ...(level.indent.leftTwips !== undefined
                    ? { left: level.indent.leftTwips }
                    : {}),
                  ...(level.indent.hangingTwips !== undefined
                    ? { hanging: level.indent.hangingTwips }
                    : {}),
                },
              },
            }
          : {}),
        ...(level.run ? { run: runOptions(level.run) } : {}),
        ...(level.paragraphStyleId ? { style: level.paragraphStyleId } : {}),
      },
      ...(level.start !== undefined ? { start: level.start } : {}),
    })),
  };
}

/**
 * Build an image run factory per resource.
 *
 * Separate from `buildDocument` because a vector image has to be rasterised
 * for the fallback Word draws below 2016, and that is asynchronous while
 * building the document is not. The raster depends on the size the image is
 * drawn at, so every placement of a vector resource is rasterised up front and
 * the factory looks the right one up.
 */
async function prepareImages(ir: DocxIR): Promise<EmitResources> {
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

  const resources = new Map<string, ImageRunFactory>();
  for (const resource of ir.resources) {
    if (resource.kind !== 'image') continue;
    const type = resource.mediaType as 'jpg' | 'png' | 'gif' | 'bmp' | 'svg';
    const data = Buffer.from(resource.bytes);
    // One run per placement: the same bytes may be drawn at two sizes, and the
    // transformation lives on the run rather than on the resource.
    resources.set(resource.id, (image) => {
      const transformation = {
        width: emuToPixels(image.widthEmu),
        height: emuToPixels(image.heightEmu),
      };
      return new ImageRun({
        type,
        data,
        transformation,
        ...(type === 'svg'
          ? {
              // Word before 2016 draws the fallback rather than the vector. A
              // raster that could not be produced falls back to the SVG bytes,
              // which is what the pipeline has always shipped.
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
        // `altText` is deliberately not passed. docx.js would write it into
        // `wp:docPr`, and no DOCX this pipeline has ever produced carries it —
        // adding it now would rewrite every document with an alt-bearing
        // image. The compiler warns instead, so the gap is visible.
      } as ConstructorParameters<typeof ImageRun>[0]);
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

  const visitBlock = (block: DocxIrBlock): void => {
    if (block.kind === 'paragraph') {
      block.children.forEach(visitInline);
      return;
    }
    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) cell.children.forEach(visitBlock);
      }
    }
  };

  for (const section of ir.sections) {
    section.children.forEach(visitBlock);
    section.headers?.default?.children.forEach(visitBlock);
    section.footers?.default?.children.forEach(visitBlock);
  }
  for (const comment of ir.comments) comment.children.forEach(visitBlock);
  for (const note of [...ir.footnotes, ...ir.endnotes]) {
    note.children.forEach(visitBlock);
  }

  return placements;
}

function sectionOptions(
  section: DocxIrSection,
  resources: EmitResources
): ISectionOptions {
  const { page, columns } = section.properties;
  const options: Record<string, unknown> = {
    properties: {
      ...(section.properties.type ? { type: section.properties.type } : {}),
      page: {
        // Orientation is implied by the width/height pair, which is how the
        // pre-IR writer expressed it; stating it as well changes `w:pgSz`.
        size: {
          width: page.widthTwips,
          height: page.heightTwips,
          ...(page.code !== undefined ? { code: page.code } : {}),
        },
        margin: {
          top: page.margins.topTwips,
          right: page.margins.rightTwips,
          bottom: page.margins.bottomTwips,
          left: page.margins.leftTwips,
          ...(page.margins.headerTwips !== undefined
            ? { header: page.margins.headerTwips }
            : {}),
          ...(page.margins.footerTwips !== undefined
            ? { footer: page.margins.footerTwips }
            : {}),
          ...(page.margins.gutterTwips !== undefined
            ? { gutter: page.margins.gutterTwips }
            : {}),
        },
      },
      ...(columns
        ? {
            column: {
              count: columns.count,
              ...(columns.spaceTwips !== undefined
                ? { space: columns.spaceTwips }
                : {}),
              ...(columns.equalWidth !== undefined
                ? { equalWidth: columns.equalWidth }
                : {}),
              ...(columns.widths
                ? {
                    children: columns.widths.map(
                      (c) =>
                        new Column({
                          width: c.widthTwips,
                          ...(c.spaceTwips !== undefined
                            ? { space: c.spaceTwips }
                            : {}),
                        })
                    ),
                  }
                : {}),
            },
          }
        : {}),
    },
    children: sectionChildren(section, resources),
  };

  const header = section.headers?.default;
  if (header)
    options.headers = {
      default: new Header({ children: partChildren(header, resources) }),
    };
  const footer = section.footers?.default;
  if (footer)
    options.footers = {
      default: new Footer({ children: partChildren(footer, resources) }),
    };

  return options as unknown as ISectionOptions;
}

function partChildren(part: DocxIrHeaderFooter, resources: EmitResources) {
  return part.children.map((block) => emitBlock(block, resources));
}

/**
 * A section's blocks, wrapped in its bookmark range when it has one.
 *
 * The anchors are zero-spacing paragraphs because OOXML has nowhere else to put
 * them: a bookmark is an inline construct, so covering a section means opening
 * one before its content and closing it after, without the anchor paragraphs
 * themselves adding visible space.
 */
function sectionChildren(
  section: DocxIrSection,
  resources: EmitResources
): (Paragraph | Table)[] {
  const blocks = section.children.map((block) => emitBlock(block, resources));
  const bookmark = section.bookmark;
  if (!bookmark) return blocks;

  const out: (Paragraph | Table)[] = [];
  if (bookmark.opens) {
    out.push(
      new Paragraph({
        children: [new BookmarkStart(bookmark.name, bookmark.id)],
        spacing: { before: 0, after: 0, line: 0 },
      })
    );
  }
  out.push(...blocks);
  if (bookmark.closes) {
    out.push(new Paragraph({ children: [new BookmarkEnd(bookmark.id)] }));
  }
  return out;
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
