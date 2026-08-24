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
import { emuToPixels, pixelsToEmu } from '../../ir/units';

type Opts = Record<string, unknown>;

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
  type: string;
  data: Buffer;
  /** The raster Word draws when it cannot draw the vector. */
  fallback?: { type: string; data: Buffer };
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
   * The backend numbers `word/charts/chartN.xml` by the order it stringifies
   * chart runs, which is document order — the same order this array fills. The
   * post-generation splice reads it to match each part with the data the
   * backend dropped.
   */
  charts?: DocxIrChartRun[];
}

/** A context for content that holds no drawings, and for tests. */
export function emptyContext(): EmitContext {
  let next = 1;
  return { pictures: new Map(), nextDrawingId: () => next++, charts: [] };
}

/**
 * Where a field becomes a whole `w:fldSimple` rather than a run child.
 *
 * The backend writes any instruction this way, with its cached result inside,
 * so there is no per-instruction table to keep — which is the one place this
 * adapter is plainly better off than the docx.js one.
 */
function simpleField(instruction: string, cachedText?: string): Opts {
  return {
    simpleField: {
      instruction,
      ...(cachedText !== undefined ? { cachedValue: cachedText } : {}),
    },
  };
}

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

export function runProperties(
  formatting: DocxIrRunFormatting | undefined
): Opts {
  if (!formatting) return {};
  const out: Opts = {};
  if (formatting.fontFamily) out.font = formatting.fontFamily;
  if (formatting.sizeHalfPoints !== undefined) {
    // The backend states run size in points and doubles it on the way out,
    // where docx.js takes half-points and writes them straight through.
    out.size = formatting.sizeHalfPoints / 2;
  }
  if (formatting.color) out.color = formatting.color.hex;
  if (formatting.bold !== undefined) out.bold = formatting.bold;
  // `italic` here, `italics` in docx.js — the one run property the two spell
  // differently.
  if (formatting.italic !== undefined) out.italic = formatting.italic;
  if (formatting.underline) {
    out.underline = {
      type: formatting.underline.type,
      ...(formatting.underline.color
        ? { color: formatting.underline.color.hex }
        : {}),
    };
  }
  if (formatting.strike !== undefined) out.strike = formatting.strike;
  if (formatting.doubleStrike !== undefined) {
    out.doubleStrike = formatting.doubleStrike;
  }
  if (formatting.superScript) out.superScript = true;
  if (formatting.subScript) out.subScript = true;
  if (formatting.smallCaps !== undefined) out.smallCaps = formatting.smallCaps;
  if (formatting.allCaps !== undefined) out.allCaps = formatting.allCaps;
  if (formatting.highlight !== undefined) out.highlight = formatting.highlight;
  if (formatting.shading) out.shading = shading(formatting.shading);
  if (formatting.scalePercent !== undefined)
    out.scale = formatting.scalePercent;
  if (formatting.characterSpacingTwentieths !== undefined) {
    out.characterSpacing = formatting.characterSpacingTwentieths;
  }
  if (formatting.language) out.language = { value: formatting.language };
  if (formatting.noProof !== undefined) out.noProof = formatting.noProof;
  return out;
}

function shading(value: DocxIrShading): Opts {
  return {
    fill: value.fill.hex,
    ...(value.pattern ? { type: value.pattern } : {}),
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
): Opts[] {
  const out: Opts[] = [];
  let pendingBreaks = 0;
  let pendingClear: string | undefined;

  const breakOption = (): Opts => {
    if (pendingBreaks === 0) return {};
    const value: Opts = {
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
        if (child.clear && child.clear !== 'none') pendingClear = child.clear;
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
        ctx.charts?.push(child);
        out.push({ chart: chartOptions(child, ctx) });
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
function revisionRuns(range: DocxIrRevisionRange, pending: Opts): Opts[] {
  const runs: Opts[] = [];
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

/** OOXML names its wrap types; the backend numbers them, as docx.js does. */
const WRAP_TYPE: Readonly<Record<string, number>> = {
  none: 0,
  square: 1,
  tight: 2,
  topAndBottom: 3,
};

/** An IR anchor as the backend's floating options. */
export function floatingOptions(floating: DocxIrFloating): Opts {
  const position = (axis: DocxIrFloating['horizontal']): Opts => ({
    ...(axis?.relativeTo ? { relative: axis.relativeTo } : {}),
    ...(axis?.align !== undefined ? { align: axis.align } : {}),
    ...(axis?.offsetEmu !== undefined ? { offset: axis.offsetEmu } : {}),
  });

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
            type: WRAP_TYPE[floating.wrap.type],
            ...(floating.wrap.side ? { side: floating.wrap.side } : {}),
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
  };
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
function pictureOptions(image: DocxIrImageRun, ctx: EmitContext): Opts {
  const media = imageMedia(ctx, image.resourceId, image);
  return {
    type: media.type,
    data: media.data,
    // No `fileName`: at run level the backend allocates one, and stating our
    // own would only fight it.
    ...(media.fallback ? { fallback: media.fallback } : {}),
    // Raw numbers are EMUs in @office-open/docx. Passing pixels here makes a
    // normal image only a few hundred EMUs wide, effectively a dot.
    transformation: { width: image.widthEmu, height: image.heightEmu },
    // The id is stated rather than left to the backend's process-global
    // counter. `name` stays empty, which is what it was before and what the
    // backend falls back to.
    altText: { id: String(ctx.nextDrawingId()) },
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
): Opts {
  // Allocated before the children so ids run in document order.
  const id = ctx.nextDrawingId();
  return {
    altText: {
      id: String(id),
      ...(group.altText ? { description: group.altText } : {}),
    },
    transformation: { width: group.widthEmu, height: group.heightEmu },
    childOffset: { x: 0, y: 0 },
    childExtent: { cx: group.canvasWidthEmu, cy: group.canvasHeightEmu },
    children: group.children.map((child) => groupChild(child, ctx)),
    ...(group.floating ? { floating: floatingOptions(group.floating) } : {}),
  };
}

/**
 * A chart run, in the vocabulary the backend actually reads.
 *
 * Only the fields `@office-open/docx` forwards are set. Everything else the IR
 * node carries — series colours, axis titles, the workbook behind "Edit Data" —
 * is spliced into the emitted part afterwards, because the backend's chart run
 * drops those options rather than emitting them. See `chartParts.ts`.
 *
 * A shared category axis means the categories are the first series' labels; the
 * compiler has already refused a document whose series disagree about them.
 */
function chartOptions(chart: DocxIrChartRun, ctx: EmitContext): Opts {
  // Stated, never left to the backend. `@office-open/docx` numbers an unnamed
  // `wp:docPr` from `_docPropsIdGen`, a module-level generator that never
  // resets, so the same document rendered twice in one process came out with
  // different ids — the identical hazard the adapter already handles for every
  // other drawing, and the reason this one is allocated per render.
  const id = ctx.nextDrawingId();
  return {
    type: chart.chartType,
    categories: chart.series[0]?.labels ?? [],
    series: chart.series.map((entry, index) => ({
      name: entry.name ?? `Series ${index + 1}`,
      values: entry.values,
    })),
    ...(chart.title && chart.showTitle !== false ? { title: chart.title } : {}),
    ...(chart.showLegend !== undefined ? { showLegend: chart.showLegend } : {}),
    transformation: { width: chart.widthEmu, height: chart.heightEmu },
    altText: {
      id: String(id),
      ...(chart.altText ? { description: chart.altText } : {}),
    },
    ...(chart.floating ? { floating: floatingOptions(chart.floating) } : {}),
  };
}

/** One child of a group: a `wps:wsp` shape or a `pic:pic` picture. */
function groupChild(child: DocxIrDrawingGroupChild, ctx: EmitContext): Opts {
  return child.kind === 'shape'
    ? groupShape(child, ctx)
    : groupPicture(child, ctx);
}

function groupShape(shape: DocxIrDrawingShape, ctx: EmitContext): Opts {
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
      presetGeometry: { preset: shape.geometry },
      ...(shape.fill ? { fill: drawingFill(shape.fill) } : {}),
      ...(shape.outline ? { outline: drawingOutline(shape.outline) } : {}),
      children: (shape.text?.paragraphs ?? []).map((child) =>
        paragraph(child, ctx)
      ),
      ...(shape.text ? { bodyProperties: bodyProperties(shape.text) } : {}),
    },
  };
}

function groupPicture(picture: DocxIrDrawingPicture, ctx: EmitContext): Opts {
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
  };
}

/**
 * A child's `a:xfrm`, in the shape the backend's group children take.
 *
 * Group children carry an already-resolved `MediaDataTransformation` rather
 * than the plain `{width, height}` a run-level drawing takes — the backend
 * converts the latter and passes the former straight through — so the pixel
 * mirrors have to be filled in here.
 */
function childTransformation(frame: DocxIrDrawingFrame): Opts {
  const flip = {
    ...(frame.flipHorizontal ? { horizontal: true } : {}),
    ...(frame.flipVertical ? { vertical: true } : {}),
  };
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
    ...(Object.keys(flip).length > 0 ? { flip } : {}),
  };
}

function drawingFill(fill: NonNullable<DocxIrDrawingShape['fill']>): Opts {
  if (fill.kind === 'none') return { type: 'none' };
  return {
    type: 'solid',
    color: {
      type: 'rgb',
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
): Opts {
  return {
    ...(outline.widthEmu !== undefined ? { width: outline.widthEmu } : {}),
    ...(outline.dash ? { dash: outline.dash } : {}),
    ...(outline.color
      ? { type: 'solidFill', color: { value: outline.color.hex } }
      : {}),
  };
}

/** OOXML's vertical anchors, which the IR names in full. */
const BODY_ANCHOR: Readonly<Record<string, string>> = {
  top: 't',
  middle: 'ctr',
  bottom: 'b',
};

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
}): Opts {
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
): Opts {
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
function shapeOptions(shape: DocxIrShapeRun, ctx: EmitContext): Opts {
  // Allocated before the children, so ids run in document order.
  const id = String(ctx.nextDrawingId());
  return {
    altText: { id },
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
            color: { type: 'rgb', value: shape.fill.hex },
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
): Opts {
  const out: Opts = {};
  if (!formatting) return out;

  if (formatting.alignment) out.alignment = alignment(formatting.alignment);
  if (formatting.spacing) {
    const spacing: Opts = {};
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
    const indent: Opts = {};
    if (formatting.indent.leftTwips !== undefined) {
      indent.left = formatting.indent.leftTwips;
    }
    if (formatting.indent.rightTwips !== undefined) {
      indent.right = formatting.indent.rightTwips;
    }
    if (formatting.indent.firstLineTwips !== undefined) {
      indent.firstLine = formatting.indent.firstLineTwips;
    }
    if (formatting.indent.hangingTwips !== undefined) {
      indent.hanging = formatting.indent.hangingTwips;
    }
    out.indent = indent;
  }
  if (formatting.tabStops) {
    out.tabStops = formatting.tabStops.map((stop) => ({
      type: stop.type,
      position: stop.positionTwips,
      ...(stop.leader ? { leader: stop.leader } : {}),
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
function alignment(value: string): string {
  return value === 'justified' ? 'both' : value;
}

export function paragraph(
  block: DocxIrParagraph,
  ctx: EmitContext = emptyContext()
): Opts {
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
function frameOptions(frame: DocxIrFrame): Opts {
  const base: Opts = {
    width: frame.widthTwips,
    height: frame.heightTwips,
    anchor: {
      horizontal: frame.anchorHorizontal,
      vertical: frame.anchorVertical,
    },
    ...(frame.wrap ? { wrap: frame.wrap } : {}),
    ...(frame.anchorLock !== undefined ? { anchorLock: frame.anchorLock } : {}),
    ...(frame.rule ? { rule: frame.rule } : {}),
  };

  return frame.xTwips !== undefined || frame.yTwips !== undefined
    ? {
        type: 'absolute',
        position: { x: frame.xTwips ?? 0, y: frame.yTwips ?? 0 },
        ...base,
      }
    : {
        type: 'alignment',
        alignment: { x: frame.xAlign, y: frame.yAlign },
        ...base,
      };
}

/** `w:ins` / `w:del` on a paragraph mark or a row. */
function revisionMark(revision: DocxIrParagraphMarkRevision): Opts {
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
): Opts {
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
 * Where a cached TOC entry's page number sits.
 *
 * One twip inside `TabStopPosition.MAX`, which is the constant docx.js uses for
 * the same job — a fixed measure edge rather than one derived from the page, so
 * an entry looks the same wherever the field appears.
 */
const TOC_PAGE_TAB_TWIPS = 9025;

/**
 * A cached TOC entry.
 *
 * Text, then a tab to the page-number stop. The number itself is left empty:
 * the IR carries no page for an entry, because nothing before a layout pass
 * knows one. Word fills both in the moment it refreshes the field; a reader
 * that never refreshes still shows the entries, which is the whole point of
 * caching them.
 */
function tocEntry(entry: { text: string; level: number }): Opts {
  return {
    paragraph: {
      style: `TOC${entry.level}`,
      tabStops: [
        { type: 'right', position: TOC_PAGE_TAB_TWIPS, leader: 'dot' },
      ],
      children: [{ text: entry.text }, { children: [{ tab: true }] }],
    },
  };
}

function tableOfContents(value: DocxIrTableOfContents): Opts {
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

export function table(value: DocxIrTable, ctx: EmitContext): Opts {
  return {
    rows: value.rows.map((row) => tableRow(row, ctx)),
    width: {
      size: value.width.kind === 'auto' ? 0 : value.width.value,
      type:
        value.width.kind === 'twips'
          ? 'dxa'
          : value.width.kind === 'percent'
            ? 'pct'
            : 'auto',
    },
    layout: value.layout,
    // An empty grid is a table with nothing to say about its columns, which is
    // not the same as one whose columns are all zero wide.
    ...(value.columnGrid.values.length > 0
      ? { columnWidths: value.columnGrid.values }
      : {}),
    ...(value.alignment ? { alignment: alignment(value.alignment) } : {}),
    ...(value.borders ? { borders: borders(value.borders) } : {}),
    ...(value.cellMargins ? { margins: cellMargins(value.cellMargins) } : {}),
    ...(value.floating ? { float: tableFloat(value.floating) } : {}),
  };
}

function tableFloat(floating: DocxIrTableFloating): Opts {
  return {
    ...(floating.horizontalAnchor
      ? { horizontalAnchor: floating.horizontalAnchor }
      : {}),
    ...(floating.verticalAnchor
      ? { verticalAnchor: floating.verticalAnchor }
      : {}),
    ...(floating.absoluteHorizontalPositionTwips !== undefined
      ? { absoluteHorizontalPosition: floating.absoluteHorizontalPositionTwips }
      : {}),
    ...(floating.relativeHorizontalPosition
      ? { relativeHorizontalPosition: floating.relativeHorizontalPosition }
      : {}),
    ...(floating.absoluteVerticalPositionTwips !== undefined
      ? { absoluteVerticalPosition: floating.absoluteVerticalPositionTwips }
      : {}),
    ...(floating.relativeVerticalPosition
      ? { relativeVerticalPosition: floating.relativeVerticalPosition }
      : {}),
    ...(floating.topFromTextTwips !== undefined
      ? { topFromText: floating.topFromTextTwips }
      : {}),
    ...(floating.rightFromTextTwips !== undefined
      ? { rightFromText: floating.rightFromTextTwips }
      : {}),
    ...(floating.bottomFromTextTwips !== undefined
      ? { bottomFromText: floating.bottomFromTextTwips }
      : {}),
    ...(floating.leftFromTextTwips !== undefined
      ? { leftFromText: floating.leftFromTextTwips }
      : {}),
    ...(floating.overlap ? { overlap: floating.overlap } : {}),
  };
}

function tableRow(row: DocxIrTableRow, ctx: EmitContext): Opts {
  return {
    cells: row.cells.map((cell) => tableCell(cell, ctx)),
    ...(row.heightTwips !== undefined
      ? {
          height: { value: row.heightTwips, rule: row.heightRule ?? 'atLeast' },
        }
      : {}),
    ...(row.isHeader !== undefined ? { tableHeader: row.isHeader } : {}),
    ...(row.cantSplit !== undefined ? { cantSplit: row.cantSplit } : {}),
    ...(row.revision ? revisionMark(row.revision) : {}),
  };
}

function tableCell(cell: DocxIrTableCell, ctx: EmitContext): Opts {
  return {
    children: cell.children.map((child) => block(child, ctx)),
    ...(cell.widthTwips !== undefined
      ? { width: { size: cell.widthTwips, type: 'dxa' } }
      : {}),
    ...(cell.verticalAlign ? { verticalAlign: cell.verticalAlign } : {}),
    ...(cell.shading ? { shading: shading(cell.shading) } : {}),
    ...(cell.margins ? { margins: cellMargins(cell.margins) } : {}),
    ...(cell.borders ? { borders: borders(cell.borders) } : {}),
    ...(cell.columnSpan !== undefined ? { columnSpan: cell.columnSpan } : {}),
    ...(cell.rowSpan !== undefined ? { verticalMerge: cell.rowSpan } : {}),
    ...(cell.textDirection ? { textDirection: cell.textDirection } : {}),
  };
}

/** Cell margins, stated in twips, which the backend only believes if told. */
function cellMargins(margins: {
  topTwips?: number;
  bottomTwips?: number;
  leftTwips?: number;
  rightTwips?: number;
}): Opts {
  const side = (value: number | undefined): Opts | undefined =>
    value === undefined ? undefined : { size: value, type: 'dxa' };
  const out: Opts = {};
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

function border(value: DocxIrBorder): Opts {
  return {
    style: value.style,
    ...(value.sizeEighthPoints !== undefined
      ? { size: value.sizeEighthPoints }
      : {}),
    ...(value.color ? { color: value.color.hex } : {}),
    ...(value.spacePoints !== undefined ? { space: value.spacePoints } : {}),
  };
}

function borders(value: DocxIrBorders): Opts {
  const out: Opts = {};
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

export function section(value: DocxIrSection, ctx: EmitContext): Opts {
  const { page, columns } = value.properties;
  return {
    properties: {
      ...(value.properties.type ? { type: value.properties.type } : {}),
      ...(value.properties.titlePage !== undefined
        ? { titlePage: value.properties.titlePage }
        : {}),
      page: {
        // Orientation is implied by the width/height pair, which is how this
        // pipeline has always expressed it; stating it as well changes `w:pgSz`.
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
        ...(value.properties.pageNumbers
          ? {
              pageNumbers: {
                ...(value.properties.pageNumbers.start !== undefined
                  ? { start: value.properties.pageNumbers.start }
                  : {}),
                ...(value.properties.pageNumbers.formatType
                  ? { formatType: value.properties.pageNumbers.formatType }
                  : {}),
              },
            }
          : {}),
        ...(value.properties.borders
          ? {
              borders: {
                ...(value.properties.borders.display
                  ? { display: value.properties.borders.display }
                  : {}),
                ...(value.properties.borders.offsetFrom
                  ? { offsetFrom: value.properties.borders.offsetFrom }
                  : {}),
                ...(value.properties.borders.borders
                  ? borders(value.properties.borders.borders)
                  : {}),
              },
            }
          : {}),
      },
      ...(columns
        ? {
            column: {
              count: columns.count,
              ...(columns.spaceTwips !== undefined
                ? { space: columns.spaceTwips }
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
                      width: column.widthTwips,
                      ...(column.spaceTwips !== undefined
                        ? { space: column.spaceTwips }
                        : {}),
                    })),
                  }
                : {}),
            },
          }
        : {}),
    },
    children: sectionChildren(value, ctx),
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
): Opts {
  const out: Opts = {};
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
 */
function sectionChildren(value: DocxIrSection, ctx: EmitContext): Opts[] {
  const blocks = value.children.map((child) => block(child, ctx));
  const bookmark = value.bookmark;
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

export function numberingConfig(numbering: DocxIrNumbering): Opts {
  return {
    reference: numbering.reference,
    levels: numbering.levels.map((level) => ({
      level: level.level,
      format: level.format,
      text: level.text,
      ...(level.alignment ? { alignment: alignment(level.alignment) } : {}),
      ...(level.suffix ? { suffix: level.suffix } : {}),
      ...(level.start !== undefined ? { start: level.start } : {}),
      ...(level.paragraphStyleId
        ? { paragraphStyle: level.paragraphStyleId }
        : {}),
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
        ...(level.run ? { run: runProperties(level.run) } : {}),
      },
    })),
  };
}

export { emuToPixels };
