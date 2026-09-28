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
  LineRuleType,
  Paragraph,
  type Run,
  Table,
  type TableOfContents,
  type ICommentOptions,
  type ILevelsOptions,
  type ISectionOptions,
  type IThemeOptions,
} from 'docx';
import { emitStyles } from './styles';
import { loadDocxCharts } from './charts';
import {
  rasterizeSvgFallbacks,
  type SvgFallbackJob,
} from '../../utils/imageUtils';
import type {
  DocxIR,
  DocxIrBlock,
  DocxIrHeaderFooter,
  DocxIrInline,
  DocxIrNote,
  DocxIrNumbering,
  DocxIrSection,
  DocxIrTheme,
} from '../../ir/types';
import type { DocxFeature } from '../../ir/features';
import {
  canonicalizeDocxBuffer,
  normalizeDocxCaseBuffer,
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
import { docxSubpath } from './docxSubpath';
import {
  chooseMarkers,
  createDrawingGroupFactory,
  type GroupPictureSource,
} from './drawingGroup';
import { repairDrawingGroupsInBuffer } from './drawingGroupRepair';
import { emuToPixels } from '../../ir/units';

export const DOCXJS_RENDERER_ID: DocxRendererId = 'docxjs';

/**
 * `docx/shapes`, loaded only by a render whose IR holds a drawing group. It is
 * 186 KB minified and costs about 13 ms and 1.5 MB of heap to load, none of
 * which a document without a native visual should pay.
 */
const shapes = docxSubpath(
  'docx/shapes',
  'visual',
  () => import('docx/shapes')
);

/**
 * Explicit allowlist of what this adapter can express today.
 *
 * A new `DocxFeature` stays unsupported until this adapter deliberately adds
 * and tests it. Most omissions are slice boundaries. `charts` and
 * `drawing-groups` were backend gaps until docx 9.8.0; they are drawn through
 * `docx/charts` and `docx/shapes`, each imported at render time rather than
 * with the package (see `docxSubpath.ts`, #478).
 */
const DOCXJS_CAPABILITIES: ReadonlySet<DocxFeature> = new Set([
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
  'charts',
  'text-frames',
  'text-boxes',
  'drawing-groups',
  'toc',
  'cached-toc',
  'fields',
  'hyperlinks',
  'bookmarks',
  'cross-references',
  'comments',
  'comment-threads',
  'footnotes',
  'endnotes',
  'revisions',
  'breaks',
  'borders',
  'tab-stops',
  'proofing-language',
  'custom-properties',
]);

export function createDocxJsRenderer(): DocxRenderer {
  return {
    id: DOCXJS_RENDERER_ID,
    format: 'docx',
    capabilities: DOCXJS_CAPABILITIES,
    async render(
      ir: DocxIR,
      renderOptions?: DocxRenderOptions
    ): Promise<Uint8Array> {
      await loadDocxCharts();
      const prepared = await prepareImages(
        ir,
        renderOptions?.svgRasterFallback
      );
      // A document without a drawing group never loads `docx/shapes`, never
      // has its strings walked for markers and never goes through the repair
      // pass, so its bytes are exactly what they were before groups existed.
      const markers =
        prepared.drawingGroups > 0 ? chooseMarkers(ir) : undefined;
      let resources: EmitResources = prepared.images;
      if (markers) {
        await shapes.load();
        resources = Object.assign(prepared.images, {
          drawingGroup: createDrawingGroupFactory(
            shapes.get(),
            prepared.pictureSource,
            markers
          ),
        });
      }
      const document = buildDocument(ir, resources);
      const packed = (await Packer.toBuffer(document)) as Buffer;
      const fixed = fixFloatingImageIdsInBuffer(packed);
      const repaired = markers
        ? repairDrawingGroupsInBuffer(fixed, markers)
        : fixed;

      if (renderOptions?.deterministic === false)
        return new Uint8Array(normalizeDocxCaseBuffer(repaired));
      return new Uint8Array(
        canonicalizeDocxBuffer(
          repaired,
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
 * more legible, than unzipping a package. An IR with charts needs
 * `await loadDocxCharts()` first; `render()` does it.
 */
export function buildDocument(
  ir: DocxIR,
  resources: EmitResources = new Map()
): Document {
  return new Document({
    styles: emitStyles(ir.styles),
    ...(ir.theme ? { theme: themeOptions(ir.theme) } : {}),
    sections: ir.sections.map((section, index) =>
      sectionOptions(section, resources, index === ir.sections.length - 1)
    ),
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

/**
 * The IR theme as docx.js takes it. Slot names are ST_ThemeColor's on both
 * sides, so this only unwraps the colours. `colors` and `fonts` are passed only
 * when non-empty: docx.js names a scheme after the theme whenever the object is
 * present, even empty.
 */
function themeOptions(theme: DocxIrTheme): IThemeOptions {
  const colors: Record<string, string> = {};
  for (const [slot, color] of Object.entries(theme.colors)) {
    if (color) colors[slot] = color.hex;
  }
  const fonts = {
    ...(theme.headingFont ? { headings: theme.headingFont } : {}),
    ...(theme.bodyFont ? { body: theme.bodyFont } : {}),
  };
  return {
    name: theme.name,
    ...(Object.keys(colors).length > 0 ? { colors } : {}),
    ...(Object.keys(fonts).length > 0 ? { fonts } : {}),
  };
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
 * the factory looks the right one up. A picture inside a drawing group is a
 * placement too, and `pictureSource` hands it the same bytes and fallback.
 */
async function prepareImages(
  ir: DocxIR,
  svgRasterFallback?: boolean
): Promise<{
  images: Map<string, ImageRunFactory>;
  pictureSource: GroupPictureSource;
  /** How many drawing groups the IR holds; none means no `docx/shapes`. */
  drawingGroups: number;
}> {
  const { placements, drawingGroups } = collectImagePlacements(ir);
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

  const pictureSource: GroupPictureSource = (resourceId, placement) => {
    const resource = ir.resources.find(
      (candidate) => candidate.kind === 'image' && candidate.id === resourceId
    );
    if (!resource) {
      throw new Error(`no image was prepared for resource "${resourceId}"`);
    }
    const data = Buffer.from(resource.bytes);
    if (resource.mediaType !== 'svg') {
      return {
        type: resource.mediaType as 'jpg' | 'png' | 'gif' | 'bmp',
        data,
      };
    }
    // The same fallback rule as an image run's, keyed by the drawn size.
    const size = `${emuToPixels(placement.widthEmu)}x${emuToPixels(placement.heightEmu)}`;
    return {
      type: 'svg',
      data,
      fallback: {
        type: 'png',
        data: rasters.get(`${resourceId}:${size}`) ?? data,
      },
    };
  };

  return { images: resources, pictureSource, drawingGroups };
}

/**
 * Every size each image resource is drawn at, as `WxH` in pixels, and how
 * many drawing groups the IR holds.
 *
 * Only vector resources need the sizes, but the walk cannot know which is
 * which without the resource list, and walking twice would cost more than it
 * saves. The group count rides along for the same reason.
 */
function collectImagePlacements(ir: DocxIR): {
  placements: Map<string, Set<string>>;
  drawingGroups: number;
} {
  const placements = new Map<string, Set<string>>();
  let drawingGroups = 0;

  const record = (
    resourceId: string,
    widthEmu: number,
    heightEmu: number
  ): void => {
    const key = `${emuToPixels(widthEmu)}x${emuToPixels(heightEmu)}`;
    const sizes = placements.get(resourceId) ?? new Set<string>();
    sizes.add(key);
    placements.set(resourceId, sizes);
  };

  const visitInline = (inline: DocxIrInline): void => {
    if (inline.kind === 'image') {
      record(inline.resourceId, inline.widthEmu, inline.heightEmu);
      return;
    }
    if (inline.kind === 'drawingGroup') {
      drawingGroups += 1;
      for (const child of inline.children) {
        if (child.kind === 'picture') {
          record(child.resourceId, child.frame.widthEmu, child.frame.heightEmu);
        } else {
          child.text?.paragraphs.forEach(visitBlock);
        }
      }
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
    // Every chrome slot, not only `default`: an SVG that appears solely in a
    // first-page or even-page header would otherwise reach the package with
    // its own bytes labelled `image/png` as the raster fallback (#256).
    for (const slot of ['default', 'first', 'even'] as const) {
      section.headers?.[slot]?.children.forEach(visitBlock);
      section.footers?.[slot]?.children.forEach(visitBlock);
    }
  }
  for (const comment of ir.comments) comment.children.forEach(visitBlock);
  for (const note of [...ir.footnotes, ...ir.endnotes]) {
    note.children.forEach(visitBlock);
  }

  return { placements, drawingGroups };
}

function sectionOptions(
  section: DocxIrSection,
  resources: EmitResources,
  closesDocument = false
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
    children: sectionChildren(section, resources, closesDocument),
  };

  const headers = chromeSlots(section.headers, Header, resources);
  if (headers) options.headers = headers;
  const footers = chromeSlots(section.footers, Footer, resources);
  if (footers) options.footers = footers;

  return options as unknown as ISectionOptions;
}

/**
 * The `default` / `first` / `even` parts a section carries, if any.
 *
 * All three slots, not only `default`: the IR distinguishes them and dropping
 * one here would lose a whole header without any diagnostic — the same gap the
 * SVG walk had (#256).
 */
function chromeSlots(
  set: DocxIrSection['headers'],
  Part: typeof Header | typeof Footer,
  resources: EmitResources
): Record<string, Header | Footer> | undefined {
  if (!set) return undefined;
  const out: Record<string, Header | Footer> = {};
  for (const slot of ['default', 'first', 'even'] as const) {
    const part = set[slot];
    if (part) {
      out[slot] = new Part({ children: partChildren(part, resources) });
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function partChildren(
  part: DocxIrHeaderFooter,
  resources: EmitResources
): (Paragraph | Table)[] {
  return part.children.map((block) => emitBlock(block, resources)) as (
    | Paragraph
    | Table
  )[];
}

/**
 * A section's blocks, wrapped in its bookmark range when it has one.
 *
 * A bookmark is an inline construct, so covering a section means opening it
 * inside the first paragraph and closing it inside the last. When that edge
 * block is a table, the anchor goes in a paragraph of its own — one point
 * tall, exact, no spacing — because a bare Normal paragraph there costs a
 * full line, and a section whose last page was already full pushed that line
 * onto an empty page carrying nothing but the running head.
 *
 * The document's last section gets that paragraph after a text frame too,
 * bookmark or not. When the body ends on consecutive framed paragraphs in a
 * section with its own header or footer, LibreOffice drops the frame of the
 * one before last and sets its text at the top of the page: the back cover of
 * the modern annual report lost its "Follow Us" label that way once the
 * bookmark end moved into the last frame. An earlier section never ends the
 * body, since its section properties close it in a paragraph of their own.
 */
function sectionChildren(
  section: DocxIrSection,
  resources: EmitResources,
  closesDocument = false
): (Paragraph | Table | TableOfContents)[] {
  const blocks = section.children.map((block) => emitBlock(block, resources));
  const bookmark = section.bookmark;
  const endsInFrame = closesDocument && lastBlockIsFrame(section);
  if (!bookmark && !endsInFrame) return blocks;

  const out: (Paragraph | Table | TableOfContents)[] = [...blocks];
  if (bookmark?.opens) {
    const start = new BookmarkStart(bookmark.name, bookmark.id);
    const first = out[0];
    if (first instanceof Paragraph) {
      // Ahead of the runs, so the range covers the paragraph's own text: a
      // section-scoped TOC lists a heading only when the heading is inside.
      // docx.js types the front slot as a run, but it is a raw root splice.
      first.addRunToFront(start as unknown as Run);
    } else {
      out.unshift(anchorParagraph(start));
    }
  }
  if (bookmark?.closes) {
    const end = new BookmarkEnd(bookmark.id);
    const last = out[out.length - 1];
    if (last instanceof Paragraph && !endsInFrame) {
      last.addChildElement(end);
    } else {
      out.push(anchorParagraph(end));
    }
  } else if (endsInFrame) {
    out.push(anchorParagraph());
  }
  return out;
}

/** Whether a section's last block is a paragraph set as a text frame. */
function lastBlockIsFrame(section: DocxIrSection): boolean {
  const last = section.children[section.children.length - 1];
  return last?.kind === 'paragraph' && last.frame !== undefined;
}

/**
 * A paragraph that exists only to hold a bookmark anchor next to a table, or
 * to end the body after a text frame: one point tall, exact, no spacing.
 */
function anchorParagraph(anchor?: BookmarkStart | BookmarkEnd): Paragraph {
  return new Paragraph({
    children: anchor ? [anchor] : [],
    spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
  });
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
