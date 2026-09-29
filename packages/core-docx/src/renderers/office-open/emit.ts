/**
 * DocxIR → `@office-open/docx` options.
 *
 * The backend takes a plain JSON document rather than an object graph, so this
 * layer is a pure function from IR nodes to option bags. Its vocabulary is
 * close to the docx.js adapter's — both mirror OOXML — but the two are kept
 * separate on purpose: they disagree about enough (tagged section children,
 * `simpleField` instead of a field class, `verticalMerge` instead of a merge
 * enum) that sharing the code would mean a conditional in every function.
 *
 * Backend gaps are handled by *not declaring the capability* in `index.ts`, so
 * anything this module cannot express has already been rejected before it is
 * called. Reaching a `throw` here is a bug, not a user error.
 */

import { assertNever } from '@json-to-office/shared/rendering';
import type {
  DocxIrBlock,
  DocxIrBorder,
  DocxIrBorders,
  DocxIrDrawingFrame,
  DocxIrDrawingGroupChild,
  DocxIrDrawingGroupRun,
  DocxIrChartRun,
  DocxIrDrawingPicture,
  DocxIrDrawingShape,
  DocxIrFloating,
  DocxIrFrame,
  DocxIrHeaderFooter,
  DocxIrImageRun,
  DocxIrInline,
  DocxIrNumbering,
  DocxIrParagraph,
  DocxIrParagraphFormatting,
  DocxIrParagraphMarkRevision,
  DocxIrRevisionRange,
  DocxIrRunFormatting,
  DocxIrSection,
  DocxIrShading,
  DocxIrShapeRun,
  DocxIrTable,
  DocxIrTableCell,
  DocxIrTableFloating,
  DocxIrTableOfContents,
  DocxIrTableRow,
} from '../../ir/types';
import type {
  DocumentOptions,
  BorderOptions,
  BordersOptions,
  BreakClear,
  BreakOptions,
  ChartOptions,
  Floating,
  FrameOptions,
  GroupChildMediaData,
  GroupOptions,
  LevelsOptions,
  MediaDataTransformation,
  ParagraphChild,
  ParagraphOptions,
  ParagraphRunOptions,
  ParagraphStylePropertiesOptions,
  PictureOptions,
  RunOptions,
  RunStylePropertiesOptions,
  SectionChild,
  SectionOptions,
  ShadingProperties,
  ShapeOptions,
  TableCellOptions,
  TableOfContentsOptions,
  TableOptions,
  TableRowOptions,
} from '@office-open/docx';
import { chartLook, withSeriesLook } from '@json-to-office/shared/rendering';
import { emuToPixels, pixelsToEmu } from '../../ir/units';
import { buildChartWorkbook } from '../../utils/chartWorkbook';
import { seriesLook } from './chartLook';
import { chartInput } from './chartParts';

/*
 * The emitter is typed against the backend's own option types, so a renamed or
 * moved option fails the build instead of reaching the backend as a key it
 * skips. The IR speaks OOXML's vocabulary with plain strings where the backend
 * spells each value as a union; the aliases below are where the two meet.
 */
type UnderlineType = NonNullable<
  NonNullable<RunStylePropertiesOptions['underline']>['type']
>;
type HighlightColor = NonNullable<RunStylePropertiesOptions['highlight']>;
type Alignment = NonNullable<ParagraphStylePropertiesOptions['alignment']>;
type BorderStyle = BorderOptions['style'];
type WrapType = NonNullable<Floating['wrap']>['type'];
type RunBreak = number | BreakOptions;
type ShapeFill = NonNullable<ShapeOptions['fill']>;
type ShapeOutline = NonNullable<ShapeOptions['outline']>;
type ShapeGeometry = Exclude<ShapeOptions['geometry'], object | undefined>;
type TableWidth = NonNullable<TableOptions['width']>;
type CellMargins = NonNullable<TableOptions['margins']>;
type PageBorders = NonNullable<
  NonNullable<SectionOptions['properties']>['pageBorders']
>;
type AnyBorders = BordersOptions &
  NonNullable<TableOptions['borders']> &
  NonNullable<TableCellOptions['borders']>;

/**
 * One prepared image per placement size.
 *
 * A vector image needs a rasterised fallback sized to the placement, and
 * producing it is asynchronous while this layer is not — so the renderer builds
 * the media first and this only places it.
 *
 * Media rather than a whole picture because the same bytes are placed two
 * different ways: a run-level `picture` states its size as a plain
 * `MediaTransformation`, while a group child states an already-resolved
 * `MediaDataTransformation` with an offset inside the group. Sharing the
 * factory is what keeps a resource embedded once however it is drawn.
 */
export interface PreparedImage {
  /** `png`, `jpg`, `svg`, … — the backend's media type tag. */
  type: PictureOptions['type'];
  data: Buffer;
  /** The raster Word draws when it cannot draw the vector. */
  fallback?: { type: RasterType; data: Buffer };
  /**
   * The media part name these bytes are stored under.
   *
   * A run-level picture lets the backend allocate one. A *group child* cannot:
   * the backend registers grouped media with a factory that ignores the name
   * it is offered, so an unnamed child ends up referencing `{undefined}` and
   * the package ships a part called `media/undefined`. Deriving the name from
   * the resource and its drawn size keeps it deterministic and keeps two
   * identical placements sharing one part.
   */
  fileName: string;
  fallbackFileName?: string;
}

/** The picture types the backend takes for a raster, as opposed to `svg`. */
export type RasterType = Exclude<PictureOptions['type'], 'svg'>;

export type ImageMediaFactory = (placement: {
  widthEmu: number;
  heightEmu: number;
}) => PreparedImage;

/**
 * What emitting a document needs beyond the IR itself.
 *
 * `nextDrawingId` exists because the backend numbers `wp:docPr` from a
 * module-level counter whenever a drawing does not state an id. That counter is
 * process-global: the same document rendered twice comes out with different
 * ids, and two rendered at once interleave. Every drawing this adapter emits
 * therefore states its own id, allocated per render in document order — which
 * is deterministic and cannot leak between documents.
 */
export interface EmitContext {
  /** Prepared image media, keyed by IR resource id. */
  pictures: ReadonlyMap<string, ImageMediaFactory>;
  /** Allocate the next `wp:docPr` id for this document. */
  nextDrawingId: () => number;
  /**
   * Charts, in the order they were emitted.
   *
   * A chart's place here names its workbook. The post-generation pass reads
   * it to match each emitted part with its IR node — see `chartParts.ts`.
   */
  charts?: DocxIrChartRun[];
}

/** A context for content that holds no drawings, and for tests. */
export function emptyContext(): EmitContext {
  let next = 1;
  return {
    pictures: new Map(),
    nextDrawingId: () => next++,
    charts: [],
  };
}

/**
 * Where a field becomes a whole `w:fldSimple` rather than a run child.
 *
 * The backend writes any instruction this way, with its cached result inside,
 * so there is no per-instruction table to keep — which is the one place this
 * adapter is plainly better off than the docx.js one.
 */
function simpleField(instruction: string, cachedText?: string): ParagraphChild {
  return {
    simpleField: {
      instruction,
      ...(cachedText !== undefined ? { cachedValue: cachedText } : {}),
    },
  };
}

/**
 * A length in twips, or tracking in twentieths of a point, as docx.js writes
 * it: floored to a whole number.
 *
 * OOXML states these as integers — `ST_TwipsMeasure`, `ST_SignedTwipsMeasure`,
 * a width's `w:w` — and the compiler hands over whatever its arithmetic gave:
 * a theme's tracking is a share of an em times the size, 12.8 twentieths of a
 * point for an 8pt eyebrow, and a nested cell's padding halves a remainder.
 * docx.js floors each such attribute on the way out, below zero too (its
 * `decimalNumber` is `Math.floor`); this backend writes a number as it is
 * given, so the same IR came out schema-invalid here, and LibreOffice set the
 * client report's eyebrow and running head that much wider.
 *
 * Only where docx.js floors. Paragraph spacing, tab stops and text frames go
 * out as given on both backends, so they agree whatever the IR holds, and the
 * compiler hands them over whole (`wholeTwips` in `ir/units.ts`) — rounded
 * rather than floored, since docx.js has no rule of its own there to match.
 */
function twips(value: number): number {
  return Math.floor(value);
}

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

/**
 * A run's formatting — for a run, a numbering level, a style or the document
 * defaults — as the backend's run options.
 *
 * Size, bold and italic each go out twice: `w:sz`, `w:b` and `w:i` for Latin
 * and East Asian text, and the twins `w:szCs`, `w:bCs` and `w:iCs`, which are
 * what a reader applies to complex-script text — Arabic, Hebrew, Thai —
 * instead. docx.js adds the twins on its own; this backend writes only what it
 * is given, so without them such text kept the document's default size,
 * weight and slant on this renderer alone. The rules are docx.js's: a twin
 * for every stated bold or italic, true or false, and for every non-zero size.
 * Its fourth, `w:highlightCs`, is not left out by oversight: OOXML defines no
 * such element, and the compiler never sets a highlight.
 */
export function runProperties(
  formatting: DocxIrRunFormatting | undefined
): RunStylePropertiesOptions {
  if (!formatting) return {};
  const out: RunStylePropertiesOptions = {};
  if (formatting.fontFamily) out.font = formatting.fontFamily;
  if (formatting.sizeHalfPoints !== undefined) {
    // The backend states run size in points and doubles it on the way out,
    // where docx.js takes half-points and writes them straight through.
    out.size = formatting.sizeHalfPoints / 2;
    if (formatting.sizeHalfPoints) out.sizeComplexScript = out.size;
  }
  if (formatting.color) out.color = formatting.color.hex;
  if (formatting.bold !== undefined) {
    out.bold = formatting.bold;
    out.boldComplexScript = formatting.bold;
  }
  // `italic` here, `italics` in docx.js — the one run property the two spell
  // differently, and its twin follows suit.
  if (formatting.italic !== undefined) {
    out.italic = formatting.italic;
    out.italicComplexScript = formatting.italic;
  }
  if (formatting.underline) {
    out.underline = {
      type: formatting.underline.type as UnderlineType,
      ...(formatting.underline.color
        ? { color: formatting.underline.color.hex }
        : {}),
    };
  }
  if (formatting.strike !== undefined) out.strike = formatting.strike;
  if (formatting.doubleStrike !== undefined) {
    out.doubleStrike = formatting.doubleStrike;
  }
  // One property here, two flags in the IR: `w:vertAlign` takes either.
  if (formatting.superScript) out.verticalAlign = 'superscript';
  if (formatting.subScript) out.verticalAlign = 'subscript';
  if (formatting.smallCaps !== undefined) out.smallCaps = formatting.smallCaps;
  if (formatting.allCaps !== undefined) out.allCaps = formatting.allCaps;
  if (formatting.highlight !== undefined) {
    out.highlight = formatting.highlight as HighlightColor;
  }
  if (formatting.shading) out.shading = shading(formatting.shading);
  if (formatting.scalePercent !== undefined)
    out.scale = formatting.scalePercent;
  // docx.js tests the value before it floors it, so tracking under one
  // twentieth still writes `w:val="0"`, a zero that overrides a style's own,
  // while tracking stated as zero writes nothing. The backend writes whatever
  // number it is given, zero included, so a stated zero is left out here.
  const stated = formatting.characterSpacingTwentieths;
  if (stated !== undefined && stated !== 0) {
    out.characterSpacing = twips(stated);
  }
  if (formatting.language) out.language = { value: formatting.language };
  if (formatting.noProof !== undefined) out.noProof = formatting.noProof;
  return out;
}

function shading(value: DocxIrShading): ShadingProperties {
  return {
    fill: value.fill.hex,
    ...(value.pattern
      ? { type: value.pattern as NonNullable<ShadingProperties['type']> }
      : {}),
    ...(value.color ? { color: value.color.hex } : {}),
  };
}

/**
 * Turn inline nodes into paragraph children.
 *
 * `pendingBreaks` carries a run of `lineBreak` nodes forward onto whichever run
 * comes next, which is where the backend puts them — `<w:br/>` is run-inner
 * content, so it has to ride on a run either way.
 */
export function inlineChildren(
  children: readonly DocxIrInline[],
  ctx: EmitContext = emptyContext()
): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  let pendingBreaks = 0;
  let pendingClear: BreakClear | undefined;

  const breakOption = (): { break?: RunBreak } => {
    if (pendingBreaks === 0) return {};
    const value = {
      break: pendingClear
        ? { count: pendingBreaks, clear: pendingClear }
        : pendingBreaks,
    };
    pendingBreaks = 0;
    pendingClear = undefined;
    return value;
  };

  for (const child of children) {
    switch (child.kind) {
      case 'lineBreak':
        pendingBreaks += 1;
        if (child.clear && child.clear !== 'none') {
          pendingClear = child.clear as BreakClear;
        }
        break;

      case 'text':
        out.push({
          text: child.text,
          ...(child.styleId ? { style: child.styleId } : {}),
          ...runProperties(child.formatting),
          ...breakOption(),
        });
        break;

      case 'tab':
        out.push({
          children: [{ tab: true }],
          ...runProperties(child.formatting),
          ...breakOption(),
        });
        break;

      case 'pageBreak':
        out.push({ pageBreak: true });
        break;

      case 'columnBreak':
        out.push({ columnBreak: true });
        break;

      case 'bookmarkStart':
        out.push({ bookmarkStart: { id: child.id, name: child.name } });
        break;

      case 'bookmarkEnd':
        out.push({ bookmarkEnd: { id: child.id } });
        break;

      case 'image': {
        // A break before a drawing belongs on a run of its own: a run holding
        // both a `<w:br/>` and a `<w:drawing>` puts them in one element, and
        // the break then lands inside the anchor rather than before it.
        const pending = breakOption();
        if (pending.break) out.push(pending);
        out.push({ picture: pictureOptions(child, ctx) });
        break;
      }

      case 'drawingGroup': {
        const pending = breakOption();
        if (pending.break) out.push(pending);
        out.push({ wpgGroup: drawingGroupOptions(child, ctx) });
        break;
      }

      case 'hyperlink':
        out.push({
          hyperlink: {
            ...(child.target.kind === 'bookmark'
              ? { anchor: child.target.anchor }
              : { url: child.target.url }),
            children: inlineChildren(child.children, ctx),
          },
        });
        break;

      case 'field':
        out.push(simpleField(child.instruction, child.cachedText));
        break;

      case 'revision':
        out.push(...revisionRuns(child, breakOption()));
        break;

      case 'commentRangeStart':
        out.push({ commentRangeStart: { id: child.id } });
        break;

      case 'commentRangeEnd':
        out.push({ commentRangeEnd: { id: child.id } });
        break;

      case 'commentReference':
        out.push({ commentReference: child.id });
        break;

      case 'shape':
        out.push({ wpsShape: shapeOptions(child, ctx) });
        break;

      case 'chart':
        out.push({
          chart: chartOptions(child, ctx, ctx.charts?.push(child) ?? 1),
        });
        break;

      case 'noteReference':
        out.push(
          child.noteKind === 'endnote'
            ? { endnoteReference: child.id }
            : { footnoteReference: child.id }
        );
        break;

      default:
        assertNever(child, 'DocxIrInline');
    }
  }

  return out;
}

/**
 * A tracked change, as an `insertion` or `deletion` wrapping its runs.
 *
 * The backend has a real wrapper element, so the id/author/date sit on the
 * range itself rather than being copied onto every run inside it.
 */
function revisionRuns(
  range: DocxIrRevisionRange,
  pending: { break?: RunBreak }
): ParagraphChild[] {
  const runs: RunOptions[] = [];
  let breaks = typeof pending.break === 'number' ? pending.break : 0;

  for (const child of range.children) {
    if (child.kind === 'lineBreak') {
      breaks += 1;
      continue;
    }
    if (child.kind !== 'text') {
      throw new Error(
        `the office-open renderer has no emitter for "${child.kind}" inside a revision`
      );
    }
    runs.push({
      text: child.text,
      ...runProperties(child.formatting),
      ...(breaks > 0 ? { break: breaks } : {}),
    });
    breaks = 0;
  }

  const mark = { id: range.id, author: range.author, date: range.date };
  return [
    range.type === 'insert'
      ? { insertion: { ...mark, children: runs } }
      : { deletion: { ...mark, children: runs } },
  ];
}

/**
 * An IR anchor as the backend's floating options.
 *
 * `Floating` requires both positions; the IR states only those the document
 * sets, and the backend writes its default for a missing one, so the object is
 * built as the IR has it and asserted whole.
 */
export function floatingOptions(floating: DocxIrFloating): Floating {
  type Position = Floating['horizontalPosition'] & Floating['verticalPosition'];
  const position = (axis: DocxIrFloating['horizontal']): Position =>
    ({
      ...(axis?.relativeTo ? { relative: axis.relativeTo } : {}),
      ...(axis?.align !== undefined ? { align: axis.align } : {}),
      ...(axis?.offsetEmu !== undefined ? { offset: axis.offsetEmu } : {}),
    }) as Position;

  return {
    ...(floating.horizontal
      ? { horizontalPosition: position(floating.horizontal) }
      : {}),
    ...(floating.vertical
      ? { verticalPosition: position(floating.vertical) }
      : {}),
    ...(floating.wrap
      ? {
          wrap: {
            // Named, as OOXML names them; 0.11 took docx.js's numbers.
            type: floating.wrap.type as WrapType,
            ...(floating.wrap.side
              ? {
                  side: floating.wrap.side as NonNullable<
                    NonNullable<Floating['wrap']>['side']
                  >,
                }
              : {}),
          },
        }
      : {}),
    ...(floating.margins
      ? {
          margins: {
            ...(floating.margins.topEmu !== undefined
              ? { top: floating.margins.topEmu }
              : {}),
            ...(floating.margins.bottomEmu !== undefined
              ? { bottom: floating.margins.bottomEmu }
              : {}),
            ...(floating.margins.leftEmu !== undefined
              ? { left: floating.margins.leftEmu }
              : {}),
            ...(floating.margins.rightEmu !== undefined
              ? { right: floating.margins.rightEmu }
              : {}),
          },
        }
      : {}),
    ...(floating.allowOverlap !== undefined
      ? { allowOverlap: floating.allowOverlap }
      : {}),
    ...(floating.behindDocument !== undefined
      ? { behindDocument: floating.behindDocument }
      : {}),
    ...(floating.lockAnchor !== undefined
      ? { lockAnchor: floating.lockAnchor }
      : {}),
    ...(floating.layoutInCell !== undefined
      ? { layoutInCell: floating.layoutInCell }
      : {}),
    zIndex: floating.zIndex,
  } as Floating;
}

/** Media for one resource at one placement size, or a clear failure. */
function imageMedia(
  ctx: EmitContext,
  resourceId: string,
  placement: { widthEmu: number; heightEmu: number }
): PreparedImage {
  const build = ctx.pictures.get(resourceId);
  if (!build) {
    throw new Error(`no image was prepared for resource "${resourceId}"`);
  }
  return build(placement);
}

/** An inline or anchored picture: one `pic:pic` inside its own drawing. */
function pictureOptions(
  image: DocxIrImageRun,
  ctx: EmitContext
): PictureOptions {
  const media = imageMedia(ctx, image.resourceId, image);
  // No `fileName`: at run level the backend allocates one, and stating our own
  // would only fight it.
  const source =
    media.type === 'svg'
      ? {
          type: 'svg' as const,
          data: media.data,
          // The SVG slot always carries a raster: `prepareImages` falls back
          // to the vector bytes when none could be made.
          fallback: media.fallback ?? {
            type: 'png' as const,
            data: media.data,
          },
        }
      : { type: media.type, data: media.data };
  return {
    ...source,
    // Raw numbers are EMUs in @office-open/docx. Passing pixels here makes a
    // normal image only a few hundred EMUs wide, effectively a dot.
    transformation: { width: image.widthEmu, height: image.heightEmu },
    // The id is stated rather than left to the backend's process-global
    // counter. `name` stays empty, which is what the backend falls back to.
    altText: { id: String(ctx.nextDrawingId()), name: '' },
    ...(image.floating ? { floating: floatingOptions(image.floating) } : {}),
    // No `description` or `title`: no DOCX this pipeline has produced carries
    // `wp:docPr` alt text, and the compiler warns so the gap is visible rather
    // than silent.
  };
}

/**
 * A drawing group: one `wpg:wgp` holding shapes and pictures.
 *
 * `childOffset`/`childExtent` are the group's `a:chOff`/`a:chExt` — the
 * coordinate space its children are placed in. Setting them to the authored
 * canvas is what lets the group be *placed* at any size while the children
 * keep the numbers the author wrote: Word scales the child space onto the
 * group's extent for us.
 */
function drawingGroupOptions(
  group: DocxIrDrawingGroupRun,
  ctx: EmitContext
): GroupOptions {
  // Allocated before the children so ids run in document order.
  const id = ctx.nextDrawingId();
  return {
    altText: {
      id: String(id),
      name: '',
      ...(group.altText ? { description: group.altText } : {}),
    },
    transformation: { width: group.widthEmu, height: group.heightEmu },
    childOffsetX: 0,
    childOffsetY: 0,
    childExtentWidth: group.canvasWidthEmu,
    childExtentHeight: group.canvasHeightEmu,
    children: group.children.map((child) => groupChild(child, ctx)),
    ...(group.floating ? { floating: floatingOptions(group.floating) } : {}),
  };
}

/**
 * A chart run, with its look, references and workbook as backend options.
 *
 * `@office-open/docx` hands a chart run's options to the part whole: the look
 * docx.js draws (`chartLook.ts`), stated in the backend's vocabulary by the
 * shared `chartLook`, the cell references behind every cached value, and the
 * workbook "Edit Data" opens, which the backend embeds with its relationship
 * and content type. Only a scatter chart's style is left to write into the
 * emitted part afterwards — see `chartParts.ts`.
 *
 * A shared category axis means the categories are the first series' labels; the
 * compiler has already refused a document whose series disagree about them.
 *
 * `ordinal` is the chart's place among the document's charts, from one. It
 * names the workbook, which has to be unique per chart: the backend embeds one
 * file per name and points each chart at the name it was given, so two charts
 * given one name would share the first one's numbers. The backend's own
 * `chartN` cannot serve, since it numbers header and footer charts in another
 * order.
 */
function chartOptions(
  chart: DocxIrChartRun,
  ctx: EmitContext,
  ordinal: number
): ChartOptions {
  // Stated, never left to the backend. `@office-open/docx` numbers an unnamed
  // `wp:docPr` from `_docPropsIdGen`, a module-level generator that never
  // resets, so the same document rendered twice in one process came out with
  // different ids — the identical hazard the adapter already handles for every
  // other drawing, and the reason this one is allocated per render.
  const id = ctx.nextDrawingId();
  const input = chartInput(chart);
  const look = chartLook(input);
  return {
    type: chart.chartType,
    categories: chart.series[0]?.labels ?? [],
    series: chart.series.map((entry, index) =>
      withSeriesLook(
        {
          name: entry.name ?? `Series ${index + 1}`,
          values: entry.values,
          ...seriesLook(chart.chartType),
        },
        look.series[index]
      )
    ),
    ...look.chart,
    ...(chart.showLegend !== undefined ? { showLegend: chart.showLegend } : {}),
    externalData: {
      ...look.chart.externalData,
      fileName: `chart${ordinal}.xlsx`,
      // A scatter chart's column A holds the x values its `c:xVal` caches.
      data: buildChartWorkbook(
        chart.series,
        input.scatterXValues ? { categoryValues: input.scatterXValues } : {}
      ),
    },
    transformation: { width: chart.widthEmu, height: chart.heightEmu },
    altText: {
      id: String(id),
      name: '',
      ...(chart.altText ? { description: chart.altText } : {}),
    },
    ...(chart.floating ? { floating: floatingOptions(chart.floating) } : {}),
  };
}

/** One child of a group: a `wps:wsp` shape or a `pic:pic` picture. */
function groupChild(
  child: DocxIrDrawingGroupChild,
  ctx: EmitContext
): GroupChildMediaData {
  return child.kind === 'shape'
    ? groupShape(child, ctx)
    : groupPicture(child, ctx);
}

function groupShape(
  shape: DocxIrDrawingShape,
  ctx: EmitContext
): GroupChildMediaData {
  // Every child carries a `cNvPr` id of its own. They only have to be unique
  // within the drawing, but drawing them from the document-wide counter is
  // both simpler and strictly stronger — and an id repeated inside a group is
  // one of the things Word offers to repair.
  const id = ctx.nextDrawingId();
  return {
    type: 'wps',
    transformation: childTransformation(shape.frame),
    data: {
      nonVisualProperties: {
        id,
        ...(shape.name ? { name: shape.name } : {}),
        // `txBox="1"` is how Word tells a text box from a shape that happens
        // to hold text, and it changes how the object behaves on selection.
        ...(shape.isTextBox ? { textBox: '1' } : {}),
      },
      geometry: shape.geometry as ShapeGeometry,
      ...(shape.fill ? { fill: drawingFill(shape.fill) } : {}),
      ...(shape.outline ? { outline: drawingOutline(shape.outline) } : {}),
      children: (shape.text?.paragraphs ?? []).map((child) =>
        paragraph(child, ctx)
      ),
      ...(shape.text ? { bodyProperties: bodyProperties(shape.text) } : {}),
    },
  };
}

function groupPicture(
  picture: DocxIrDrawingPicture,
  ctx: EmitContext
): GroupChildMediaData {
  const id = ctx.nextDrawingId();
  const media = imageMedia(ctx, picture.resourceId, {
    widthEmu: picture.frame.widthEmu,
    heightEmu: picture.frame.heightEmu,
  });
  return {
    type: media.type,
    data: media.data,
    fileName: media.fileName,
    ...(media.fallback
      ? {
          fallback: {
            ...media.fallback,
            fileName: media.fallbackFileName,
          },
        }
      : {}),
    transformation: childTransformation(picture.frame),
    nonVisualProperties: {
      id,
      ...(picture.name ? { name: picture.name } : {}),
      ...(picture.altText ? { description: picture.altText } : {}),
    },
    ...(picture.crop ? { sourceRectangle: sourceRectangle(picture.crop) } : {}),
  } as GroupChildMediaData;
}

/**
 * A child's `a:xfrm`, in the shape the backend's group children take.
 *
 * Group children carry an already-resolved `MediaDataTransformation` rather
 * than the plain `{width, height}` a run-level drawing takes — the backend
 * converts the latter and passes the former straight through — so the pixel
 * mirrors have to be filled in here.
 */
function childTransformation(
  frame: DocxIrDrawingFrame
): MediaDataTransformation {
  return {
    offset: {
      emus: { x: frame.xEmu, y: frame.yEmu },
      pixels: {
        x: Math.round(emuToPixels(frame.xEmu)),
        y: Math.round(emuToPixels(frame.yEmu)),
      },
    },
    emus: { x: frame.widthEmu, y: frame.heightEmu },
    pixels: {
      x: Math.round(emuToPixels(frame.widthEmu)),
      y: Math.round(emuToPixels(frame.heightEmu)),
    },
    // Degrees: the backend multiplies by 60000 on the way into `@rot`.
    ...(frame.rotationDegrees !== undefined
      ? { rotation: frame.rotationDegrees }
      : {}),
    ...(frame.flipHorizontal ? { flipHorizontal: true } : {}),
    ...(frame.flipVertical ? { flipVertical: true } : {}),
  };
}

function drawingFill(fill: NonNullable<DocxIrDrawingShape['fill']>): ShapeFill {
  if (fill.kind === 'none') return { type: 'none' };
  return {
    type: 'solid',
    color: {
      value: fill.color.hex,
      // Transparency becomes an alpha transform on the colour. DrawingML
      // states *opacity*, so the value is the complement of what the author
      // wrote; the backend scales the percentage into `a:alpha`'s thousandths
      // itself, so it must be handed a plain percentage here.
      ...(fill.transparencyPercent !== undefined
        ? { transforms: { alpha: 100 - fill.transparencyPercent } }
        : {}),
    },
  };
}

/**
 * A shape outline.
 *
 * `a:ln` carries its colour directly rather than through a nested fill — the
 * backend's `OutlineOptions` is line properties and fill properties merged
 * into one bag, and a `fill` key here is silently ignored, which loses the
 * colour without a word.
 */
function drawingOutline(
  outline: NonNullable<DocxIrDrawingShape['outline']>
): ShapeOutline {
  return {
    ...(outline.widthEmu !== undefined ? { width: outline.widthEmu } : {}),
    ...(outline.dash ? { dash: outline.dash } : {}),
    ...(outline.color
      ? { type: 'solidFill', color: { value: outline.color.hex } }
      : {}),
  } as ShapeOutline;
}

/** The backend's vertical anchors, which name the middle `center`. */
const BODY_ANCHOR = {
  top: 'top',
  middle: 'center',
  bottom: 'bottom',
} as const;

/**
 * `wps:bodyPr`, for anything that holds text.
 *
 * Takes the anchor and insets rather than a whole drawing-group text object so
 * the plain text box uses it too — the two used to spell the insets
 * differently, and only one of the spellings was the one the backend reads.
 */
function bodyProperties(text: {
  anchor?: 'top' | 'middle' | 'bottom';
  insetsEmu?: { top?: number; bottom?: number; left?: number; right?: number };
}): NonNullable<ShapeOptions['bodyProperties']> {
  const insets = text.insetsEmu;
  return {
    ...(text.anchor ? { anchor: BODY_ANCHOR[text.anchor] } : {}),
    // `lIns`/`tIns`/`rIns`/`bIns` is the vocabulary `a:bodyPr` actually has;
    // the backend also accepts a `margins` object and folds it into the same
    // attributes.
    ...(insets?.left !== undefined ? { lIns: insets.left } : {}),
    ...(insets?.top !== undefined ? { tIns: insets.top } : {}),
    ...(insets?.right !== undefined ? { rIns: insets.right } : {}),
    ...(insets?.bottom !== undefined ? { bIns: insets.bottom } : {}),
  };
}

/**
 * A crop as `a:srcRect` states it: how much to trim off each edge, in
 * thousandths of a percent.
 */
function sourceRectangle(
  crop: NonNullable<DocxIrDrawingPicture['crop']>
): NonNullable<PictureOptions['sourceRectangle']> {
  const thousandths = (fraction: number): number =>
    Math.round(fraction * 100000);
  return {
    ...(crop.left !== undefined ? { left: thousandths(crop.left) } : {}),
    ...(crop.top !== undefined ? { top: thousandths(crop.top) } : {}),
    ...(crop.right !== undefined ? { right: thousandths(crop.right) } : {}),
    ...(crop.bottom !== undefined ? { bottom: thousandths(crop.bottom) } : {}),
  };
}

/** A native text box: a `wps:wsp` shape holding paragraphs. */
function shapeOptions(shape: DocxIrShapeRun, ctx: EmitContext): ShapeOptions {
  // Allocated before the children, so ids run in document order.
  const id = String(ctx.nextDrawingId());
  return {
    altText: { id, name: '' },
    children: shape.children.map((child) => paragraph(child, ctx)),
    // Raw transformation numbers are EMUs in @office-open/docx, while the IR
    // deliberately stores native shape dimensions in pixels.
    transformation: {
      width: pixelsToEmu(shape.widthPx),
      height: pixelsToEmu(shape.heightPx),
    },
    ...(shape.fill
      ? {
          fill: {
            type: 'solid',
            color: { value: shape.fill.hex },
          },
        }
      : {}),
    ...(shape.outline ? { outline: drawingOutline(shape.outline) } : {}),
    ...(shape.insetsEmu
      ? { bodyProperties: bodyProperties({ insetsEmu: shape.insetsEmu }) }
      : {}),
    ...(shape.floating ? { floating: floatingOptions(shape.floating) } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Paragraphs
 * ------------------------------------------------------------------ */

export function paragraphProperties(
  formatting: DocxIrParagraphFormatting | undefined
): ParagraphStylePropertiesOptions {
  const out: ParagraphStylePropertiesOptions = {};
  if (!formatting) return out;

  if (formatting.alignment) out.alignment = alignment(formatting.alignment);
  if (formatting.spacing) {
    const spacing: NonNullable<ParagraphStylePropertiesOptions['spacing']> = {};
    if (formatting.spacing.beforeTwips !== undefined) {
      spacing.before = formatting.spacing.beforeTwips;
    }
    if (formatting.spacing.afterTwips !== undefined) {
      spacing.after = formatting.spacing.afterTwips;
    }
    if (formatting.spacing.lineTwips !== undefined) {
      spacing.line = formatting.spacing.lineTwips;
    }
    // The rule stands on its own: `atLeast` with no height still says how the
    // line is measured.
    if (formatting.spacing.lineRule !== undefined) {
      spacing.lineRule = formatting.spacing.lineRule;
    }
    out.spacing = spacing;
  }
  if (formatting.indent) {
    const indent: NonNullable<ParagraphStylePropertiesOptions['indent']> = {};
    if (formatting.indent.leftTwips !== undefined) {
      indent.left = twips(formatting.indent.leftTwips);
    }
    if (formatting.indent.rightTwips !== undefined) {
      indent.right = twips(formatting.indent.rightTwips);
    }
    if (formatting.indent.firstLineTwips !== undefined) {
      indent.firstLine = twips(formatting.indent.firstLineTwips);
    }
    if (formatting.indent.hangingTwips !== undefined) {
      indent.hanging = twips(formatting.indent.hangingTwips);
    }
    out.indent = indent;
  }
  if (formatting.tabStops) {
    type TabStop = NonNullable<
      ParagraphStylePropertiesOptions['tabStops']
    >[number];
    out.tabStops = formatting.tabStops.map((stop) => ({
      type: stop.type as TabStop['type'],
      position: stop.positionTwips,
      ...(stop.leader ? { leader: stop.leader as TabStop['leader'] } : {}),
    }));
  }
  if (formatting.keepNext !== undefined) out.keepNext = formatting.keepNext;
  if (formatting.keepLines !== undefined) out.keepLines = formatting.keepLines;
  if (formatting.widowControl !== undefined) {
    out.widowControl = formatting.widowControl;
  }
  if (formatting.pageBreakBefore !== undefined) {
    out.pageBreakBefore = formatting.pageBreakBefore;
  }
  if (formatting.outlineLevel !== undefined) {
    out.outlineLevel = formatting.outlineLevel;
  }
  if (formatting.bidirectional !== undefined) {
    out.bidirectional = formatting.bidirectional;
  }
  if (formatting.borders) out.border = borders(formatting.borders);
  if (formatting.shading) out.shading = shading(formatting.shading);

  return out;
}

/** `justified` is the only alignment the two vocabularies spell differently. */
function alignment(value: string): Alignment {
  return (value === 'justified' ? 'both' : value) as Alignment;
}

export function paragraph(
  block: DocxIrParagraph,
  ctx: EmitContext = emptyContext()
): ParagraphOptions {
  return {
    children: inlineChildren(block.children, ctx),
    // A paragraph with no style named is one that deliberately has none — a
    // table cell, whose run properties come from the cell itself.
    ...(block.styleId ? { style: block.styleId } : {}),
    ...paragraphProperties(block.formatting),
    ...(block.markRevision ? { run: revisionMark(block.markRevision) } : {}),
    ...(block.frame ? { frame: frameOptions(block.frame) } : {}),
    ...(block.numbering
      ? {
          numbering: block.numbering.none
            ? // A literal false writes `numId 0`, which is how a paragraph
              // detaches from the numbering its style applies.
              false
            : {
                reference: block.numbering.reference,
                level: block.numbering.level,
              },
        }
      : {}),
  };
}

/**
 * A paragraph positioned as a floating box (`w:framePr`).
 *
 * Exactly one positioning mode: absolute when the frame states coordinates,
 * alignment otherwise. OOXML cannot mix them, and the backend takes the choice
 * as a discriminant.
 */
function frameOptions(frame: DocxIrFrame): FrameOptions {
  type Anchor = NonNullable<FrameOptions['anchor']>['horizontal'];
  const base = {
    width: frame.widthTwips,
    height: frame.heightTwips,
    anchor: {
      horizontal: frame.anchorHorizontal as Anchor,
      vertical: frame.anchorVertical as Anchor,
    },
    ...(frame.wrap ? { wrap: frame.wrap as FrameOptions['wrap'] } : {}),
    ...(frame.anchorLock !== undefined ? { anchorLock: frame.anchorLock } : {}),
    ...(frame.rule ? { rule: frame.rule as FrameOptions['rule'] } : {}),
  };

  if (frame.xTwips !== undefined || frame.yTwips !== undefined) {
    return {
      type: 'absolute',
      position: { x: frame.xTwips ?? 0, y: frame.yTwips ?? 0 },
      ...base,
    };
  }
  type Aligned = Extract<FrameOptions, { type: 'alignment' }>['alignment'];
  return {
    type: 'alignment',
    alignment: {
      x: frame.xAlign as Aligned['x'],
      y: frame.yAlign as Aligned['y'],
    },
    ...base,
  };
}

/** `w:ins` / `w:del` on a paragraph mark or a row. */
function revisionMark(
  revision: DocxIrParagraphMarkRevision
): Pick<ParagraphRunOptions, 'insertion' | 'deletion'> {
  const attributes = {
    id: revision.id,
    author: revision.author,
    date: revision.date,
  };
  return revision.type === 'insert'
    ? { insertion: attributes }
    : { deletion: attributes };
}

/** One IR block as a tagged section child, which is how the backend takes it. */
export function block(
  value: DocxIrBlock,
  ctx: EmitContext = emptyContext()
): SectionChild {
  switch (value.kind) {
    case 'paragraph':
      return { paragraph: paragraph(value, ctx) };
    case 'table':
      return { table: table(value, ctx) };
    case 'toc':
      return { toc: tableOfContents(value) };
    default:
      return assertNever(value, 'DocxIrBlock');
  }
}

/* ------------------------------------------------------------------ *
 * Table of contents
 * ------------------------------------------------------------------ */

/**
 * A cached TOC entry.
 *
 * Text, then a tab to the page-number stop. The stop and its leader belong to
 * the theme's `TOCn` style, so the paragraph carries no tabs of its own: a
 * paragraph-level stop would override the style for every reader that shows
 * the cached entries without refreshing the field. The number itself is left
 * empty: the IR carries no page for an entry, because nothing before a layout
 * pass knows one. Word fills it in the moment it refreshes the field; a reader
 * that never refreshes still shows the entries, which is the whole point of
 * caching them.
 */
function tocEntry(entry: { text: string; level: number }): SectionChild {
  return {
    paragraph: {
      style: `TOC${entry.level}`,
      children: [{ text: entry.text }, { children: [{ tab: true }] }],
    },
  };
}

function tableOfContents(
  value: DocxIrTableOfContents
): TableOfContentsOptions & { alias: string } {
  return {
    alias: value.alias ?? 'Table of Contents',
    ...(value.hyperlink !== undefined ? { hyperlink: value.hyperlink } : {}),
    ...(value.headingRange
      ? {
          headingStyleRange: `${value.headingRange.from}-${value.headingRange.to}`,
        }
      : {}),
    ...(value.styleLevels?.length
      ? {
          // `StyleLevel` is a class the backend only reads the two fields of.
          stylesWithLevels: value.styleLevels.map((style) => ({
            styleName: style.styleName,
            level: style.level,
          })),
        }
      : {}),
    ...(value.bookmarkScope
      ? { entriesFromBookmark: value.bookmarkScope }
      : {}),
    ...(value.omitPageNumbersForLevels?.length
      ? {
          pageNumbersEntryLevelsRange: value.omitPageNumbersForLevels
            .map((range) => `${range.from}-${range.to}`)
            .join(','),
        }
      : {}),
    ...(value.entrySeparator !== undefined
      ? { entryAndPageNumberSeparator: value.entrySeparator }
      : {}),
    ...(value.cachedEntries?.length
      ? { entries: value.cachedEntries.map(tocEntry) }
      : {}),
  };
}

/* ------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------ */

export function table(value: DocxIrTable, ctx: EmitContext): TableOptions {
  return {
    rows: value.rows.map((row) => tableRow(row, ctx)),
    width: {
      // `w:w` is an integer in OOXML. A grid that splits a remainder between
      // unstated columns comes out fractional, and the XML would carry it
      // verbatim; floored here, as the docxjs backend floors it.
      size:
        value.width.kind === 'auto'
          ? 0
          : value.width.kind === 'twips'
            ? twips(value.width.value)
            : value.width.value,
      type:
        value.width.kind === 'twips'
          ? 'twips'
          : value.width.kind === 'percent'
            ? 'percent'
            : 'auto',
    },
    layout: value.layout as TableOptions['layout'],
    // An empty grid is a table with nothing to say about its columns, which is
    // not the same as one whose columns are all zero wide. The compiler hands
    // over every grid in twips; floored for the same reason as the width.
    ...(value.columnGrid.values.length > 0
      ? { columnWidths: value.columnGrid.values.map(twips) }
      : {}),
    ...(value.alignment
      ? {
          alignment: alignment(value.alignment) as TableOptions['alignment'],
        }
      : {}),
    ...(value.borders ? { borders: borders(value.borders) } : {}),
    ...(value.cellMargins ? { margins: cellMargins(value.cellMargins) } : {}),
    ...(value.floating ? { float: tableFloat(value.floating) } : {}),
  };
}

function tableFloat(
  floating: DocxIrTableFloating
): NonNullable<TableOptions['float']> {
  type Float = NonNullable<TableOptions['float']>;
  return {
    ...(floating.horizontalAnchor
      ? { horizontalAnchor: floating.horizontalAnchor }
      : {}),
    ...(floating.verticalAnchor
      ? { verticalAnchor: floating.verticalAnchor }
      : {}),
    ...(floating.absoluteHorizontalPositionTwips !== undefined
      ? {
          absoluteHorizontalPosition: twips(
            floating.absoluteHorizontalPositionTwips
          ),
        }
      : {}),
    ...(floating.relativeHorizontalPosition
      ? { relativeHorizontalPosition: floating.relativeHorizontalPosition }
      : {}),
    ...(floating.absoluteVerticalPositionTwips !== undefined
      ? {
          absoluteVerticalPosition: twips(
            floating.absoluteVerticalPositionTwips
          ),
        }
      : {}),
    ...(floating.relativeVerticalPosition
      ? { relativeVerticalPosition: floating.relativeVerticalPosition }
      : {}),
    ...(floating.topFromTextTwips !== undefined
      ? { topFromText: twips(floating.topFromTextTwips) }
      : {}),
    ...(floating.rightFromTextTwips !== undefined
      ? { rightFromText: twips(floating.rightFromTextTwips) }
      : {}),
    ...(floating.bottomFromTextTwips !== undefined
      ? { bottomFromText: twips(floating.bottomFromTextTwips) }
      : {}),
    ...(floating.leftFromTextTwips !== undefined
      ? { leftFromText: twips(floating.leftFromTextTwips) }
      : {}),
    ...(floating.overlap ? { overlap: floating.overlap } : {}),
  } as Float;
}

function tableRow(row: DocxIrTableRow, ctx: EmitContext): TableRowOptions {
  return {
    cells: row.cells.map((cell) => tableCell(cell, ctx)),
    ...(row.heightTwips !== undefined
      ? {
          height: {
            value: twips(row.heightTwips),
            rule: (row.heightRule ?? 'atLeast') as NonNullable<
              TableRowOptions['height']
            >['rule'],
          },
        }
      : {}),
    ...(row.isHeader !== undefined ? { tableHeader: row.isHeader } : {}),
    ...(row.cantSplit !== undefined ? { cantSplit: row.cantSplit } : {}),
    ...(row.revision ? revisionMark(row.revision) : {}),
  };
}

/**
 * A table cell, closed by a paragraph whatever its last block is.
 *
 * Word ends every cell on a paragraph, whose mark is the cell's end mark, and
 * its notes on ECMA-376 (MS-OI29500, §17.4.65 `tc`) ask for a `w:p` as the
 * last block of a `w:tc`. docx.js appends `<w:p/>` to any cell whose last
 * child is not a paragraph. The backend appends one to a cell that ends on a
 * table — 0.11 did not, and LibreOffice set a text box whose content ended on
 * one in the flow, without its top border (#468) — but not to one that ends
 * on a table of contents, which it takes for a paragraph. That one case gets
 * the empty paragraph here, so every cell ends as it does on docx.js.
 */
function tableCell(cell: DocxIrTableCell, ctx: EmitContext): TableCellOptions {
  const children = cellChildren(cell, ctx);
  if (cell.children[cell.children.length - 1]?.kind === 'toc')
    children.push({ paragraph: { children: [] } });
  return {
    children,
    ...(cell.widthTwips !== undefined
      ? { width: { size: twips(cell.widthTwips), type: 'twips' } }
      : {}),
    ...(cell.verticalAlign
      ? {
          verticalAlign:
            cell.verticalAlign as TableCellOptions['verticalAlign'],
        }
      : {}),
    ...(cell.shading ? { shading: shading(cell.shading) } : {}),
    ...(cell.margins ? { margins: cellMargins(cell.margins) } : {}),
    ...(cell.borders ? { borders: borders(cell.borders) } : {}),
    ...(cell.columnSpan !== undefined ? { columnSpan: cell.columnSpan } : {}),
    ...(cell.rowSpan !== undefined ? { verticalMerge: cell.rowSpan } : {}),
    ...(cell.textDirection
      ? {
          textDirection:
            cell.textDirection as TableCellOptions['textDirection'],
        }
      : {}),
  };
}

/**
 * A cell's blocks, as the backend takes them.
 *
 * A table of contents among them goes in as it does in the body: the backend
 * writes the same content control and field around its entries in a cell as
 * there. Before 0.14 it answered any cell child but a paragraph or a table
 * with an empty string, and a contents field in a text box vanished.
 */
function cellChildren(cell: DocxIrTableCell, ctx: EmitContext): SectionChild[] {
  return cell.children.map((child) => block(child, ctx));
}

/** Cell margins, stated in twips, which the backend only believes if told. */
function cellMargins(margins: {
  topTwips?: number;
  bottomTwips?: number;
  leftTwips?: number;
  rightTwips?: number;
}): CellMargins {
  const side = (value: number | undefined): TableWidth | undefined =>
    value === undefined ? undefined : { size: twips(value), type: 'twips' };
  const out: CellMargins = {};
  for (const [name, value] of [
    ['top', margins.topTwips],
    ['bottom', margins.bottomTwips],
    ['left', margins.leftTwips],
    ['right', margins.rightTwips],
  ] as const) {
    const width = side(value);
    if (width) out[name] = width;
  }
  return out;
}

function border(value: DocxIrBorder): BorderOptions {
  return {
    style: value.style as BorderStyle,
    ...(value.sizeEighthPoints !== undefined
      ? { size: value.sizeEighthPoints }
      : {}),
    ...(value.color ? { color: value.color.hex } : {}),
    ...(value.spacePoints !== undefined ? { space: value.spacePoints } : {}),
  };
}

/**
 * Every side the IR states. The one shape serves paragraphs (which have
 * `between`), tables (which have the inside rules) and page borders; each
 * backend type allows only its own sides, and the IR never states another.
 */
function borders(value: DocxIrBorders): AnyBorders {
  const out: AnyBorders = {};
  for (const side of [
    'top',
    'bottom',
    'left',
    'right',
    'insideHorizontal',
    'insideVertical',
    'between',
  ] as const) {
    const declared = value[side];
    if (declared) out[side] = border(declared);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Sections
 * ------------------------------------------------------------------ */

export function section(
  value: DocxIrSection,
  ctx: EmitContext,
  closesDocument = false
): SectionOptions {
  const { page, columns } = value.properties;
  type Properties = NonNullable<SectionOptions['properties']>;
  return {
    properties: {
      ...(value.properties.type
        ? { type: value.properties.type as Properties['type'] }
        : {}),
      ...(value.properties.titlePage !== undefined
        ? { titlePage: value.properties.titlePage }
        : {}),
      // Orientation is implied by the width/height pair, which is how this
      // pipeline has always expressed it; stating it as well changes `w:pgSz`.
      pageSize: {
        width: twips(page.widthTwips),
        height: twips(page.heightTwips),
        ...(page.code !== undefined ? { code: page.code } : {}),
      },
      pageMargin: {
        top: twips(page.margins.topTwips),
        right: twips(page.margins.rightTwips),
        bottom: twips(page.margins.bottomTwips),
        left: twips(page.margins.leftTwips),
        ...(page.margins.headerTwips !== undefined
          ? { header: twips(page.margins.headerTwips) }
          : {}),
        ...(page.margins.footerTwips !== undefined
          ? { footer: twips(page.margins.footerTwips) }
          : {}),
        ...(page.margins.gutterTwips !== undefined
          ? { gutter: twips(page.margins.gutterTwips) }
          : {}),
      },
      ...(value.properties.pageNumbers
        ? {
            pageNumberType: {
              ...(value.properties.pageNumbers.start !== undefined
                ? { start: value.properties.pageNumbers.start }
                : {}),
              ...(value.properties.pageNumbers.formatType
                ? {
                    format: value.properties.pageNumbers
                      .formatType as NonNullable<
                      Properties['pageNumberType']
                    >['format'],
                  }
                : {}),
            },
          }
        : {}),
      ...(value.properties.borders
        ? {
            pageBorders: {
              ...(value.properties.borders.display
                ? {
                    display: value.properties.borders
                      .display as PageBorders['display'],
                  }
                : {}),
              ...(value.properties.borders.offsetFrom
                ? {
                    offsetFrom: value.properties.borders
                      .offsetFrom as PageBorders['offsetFrom'],
                  }
                : {}),
              ...(value.properties.borders.borders
                ? borders(value.properties.borders.borders)
                : {}),
            },
          }
        : {}),
      ...(columns
        ? {
            columns: {
              count: columns.count,
              ...(columns.spaceTwips !== undefined
                ? { space: twips(columns.spaceTwips) }
                : {}),
              ...(columns.separator !== undefined
                ? { separate: columns.separator }
                : {}),
              ...(columns.equalWidth !== undefined
                ? { equalWidth: columns.equalWidth }
                : {}),
              ...(columns.widths
                ? {
                    children: columns.widths.map((column) => ({
                      width: twips(column.widthTwips),
                      ...(column.spaceTwips !== undefined
                        ? { space: twips(column.spaceTwips) }
                        : {}),
                    })),
                  }
                : {}),
            },
          }
        : {}),
      // No document grid, as the IR states none. Left to the backend, every
      // section gets the one Word's Chinese template sets — a 15.6pt line grid
      // (`w:type="lines"`, pitch 312) — and every line is laid out on it here
      // but at its own height on docx.js, which writes no grid type. A field
      // the backend is not given takes that default, so all three are stated.
      grid: { type: 'default', linePitch: 360, charSpace: 0 },
    },
    children: sectionChildren(value, ctx, closesDocument),
    ...(value.headers ? { headers: headerFooterSet(value.headers, ctx) } : {}),
    ...(value.footers ? { footers: headerFooterSet(value.footers, ctx) } : {}),
  };
}

function headerFooterSet(
  set: {
    default?: DocxIrHeaderFooter;
    first?: DocxIrHeaderFooter;
    even?: DocxIrHeaderFooter;
  },
  ctx: EmitContext
): NonNullable<SectionOptions['headers']> {
  const out: NonNullable<SectionOptions['headers']> = {};
  for (const slot of ['default', 'first', 'even'] as const) {
    const part = set[slot];
    if (part) out[slot] = part.children.map((child) => block(child, ctx));
  }
  return out;
}

/**
 * A section's blocks, wrapped in its bookmark range when it has one.
 *
 * The backend takes a bookmark as a section child of its own, so unlike the
 * docx.js adapter there are no anchor paragraphs to carry it — the range opens
 * and closes between blocks, which is what OOXML allows and what a reader
 * expects to find.
 *
 * A section still ends in a paragraph one point tall, exact, no spacing,
 * wherever the docx.js adapter ends it in one. docx.js closes the range in
 * such a paragraph after a table or a contents field; without it, a table
 * here was followed by the paragraph that holds the section's properties,
 * which is where LibreOffice anchors a floating table. When such a table
 * reached past the bottom margin, as the report cover's band does once its
 * content wraps, LibreOffice ran the section on to one more page, carrying
 * nothing (#468).
 *
 * And the document's last section ends in one after a text frame. When the
 * body ends on consecutive framed paragraphs in a section with its own header
 * or footer, LibreOffice drops the frame of the one before last and sets its
 * text at the top of the page. An earlier section never ends the body, since
 * its section properties close it in a paragraph of their own.
 */
function sectionChildren(
  value: DocxIrSection,
  ctx: EmitContext,
  closesDocument = false
): SectionChild[] {
  const blocks = value.children.map((child) => block(child, ctx));
  const last = value.children[value.children.length - 1];
  const bookmark = value.bookmark;
  if (
    (bookmark?.closes && last?.kind !== 'paragraph') ||
    (closesDocument && last?.kind === 'paragraph' && last.frame !== undefined)
  )
    blocks.push({
      paragraph: {
        children: [],
        spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' },
      },
    });
  // A section that ends the body on a contents field needs a paragraph of its
  // own after it. The backend puts a section's properties into its last
  // paragraph or contents field, and in the field's case that is the last
  // entry, inside the content control, where no reader looks for them. A bare
  // paragraph takes them instead: the bytes a section break has always been.
  // Not the one-point paragraph above, whose own properties would move them.
  // A closing bookmark already ends such a section on a paragraph and a
  // bookmark end, so the properties get a paragraph of their own there.
  if (!closesDocument && !bookmark?.closes && last?.kind === 'toc')
    blocks.push({ paragraph: { children: [] } });
  if (!bookmark) return blocks;

  return [
    ...(bookmark.opens
      ? [{ bookmarkStart: { id: bookmark.id, name: bookmark.name } }]
      : []),
    ...blocks,
    ...(bookmark.closes ? [{ bookmarkEnd: { id: bookmark.id } }] : []),
  ];
}

/* ------------------------------------------------------------------ *
 * Numbering
 * ------------------------------------------------------------------ */

export function numberingConfig(numbering: DocxIrNumbering): NumberingConfig {
  return {
    reference: numbering.reference,
    levels: numbering.levels.map(
      (level): LevelsOptions => ({
        level: level.level,
        format: level.format as LevelsOptions['format'],
        text: level.text,
        ...(level.alignment ? { alignment: alignment(level.alignment) } : {}),
        ...(level.suffix
          ? { suffix: level.suffix as LevelsOptions['suffix'] }
          : {}),
        // Always stated. docx.js writes `w:start w:val="1"` for a level that
        // names none, and so did this backend until 0.14, which writes no
        // `w:start` at all when it is not given one; Word and LibreOffice then
        // count every such list from 0.
        start: level.start ?? 1,
        ...(level.paragraphStyleId
          ? { paragraphStyle: level.paragraphStyleId }
          : {}),
        ...(level.indent
          ? {
              paragraph: {
                indent: {
                  ...(level.indent.leftTwips !== undefined
                    ? { left: twips(level.indent.leftTwips) }
                    : {}),
                  ...(level.indent.hangingTwips !== undefined
                    ? { hanging: twips(level.indent.hangingTwips) }
                    : {}),
                },
              },
            }
          : {}),
        ...(level.run ? { run: runProperties(level.run) } : {}),
      })
    ),
  };
}

/** One abstract numbering, as `NumberingOptions.abstractNumberings` holds it. */
export type NumberingConfig = NonNullable<
  DocumentOptions['numbering']
>['abstractNumberings'][number];

export { emuToPixels };
