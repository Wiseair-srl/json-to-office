/**
 * PptxIR → `@office-open/pptx` options.
 *
 * The mapping is unusually direct because the two models agree on units: EMU
 * for geometry, points for font sizes, degrees for angles, percent for gradient
 * stops. Bare numbers reach the backend in exactly those units — the
 * `UniversalMeasure` string form is never used here, because a value that has
 * already been resolved has no business being re-parsed.
 *
 * Backend gaps are handled by *not declaring the capability* in `index.ts`, so
 * anything this module cannot express has already been rejected before it is
 * called. Reaching a `throw` here is a bug, not a user error.
 */

import { assertNever } from '@json-to-office/shared/rendering';
import type {
  PptxIrBackground,
  PptxIrColor,
  PptxIrElement,
  PptxIrFill,
  PptxIrGeometry,
  PptxIrGroupElement,
  PptxIrHyperlink,
  PptxIrImageElement,
  PptxIrLine,
  PptxIrResource,
  PptxIrShadow,
  PptxIrShapeElement,
  PptxIrTableElement,
  PptxIrTextBodyStyle,
  PptxIrTextBoxElement,
  PptxIrTextRun,
  PptxIrTransform,
} from '../../ir/types';

type Opts = Record<string, unknown>;

export type ResourceLookup = ReadonlyMap<string, PptxIrResource>;

export interface OfficeOpenEmitContext {
  resources: ResourceLookup;
  /** Bytes for file and remote resources, fetched before rendering. */
  resourceBytes: ReadonlyMap<string, Uint8Array>;
}

/* ------------------------------------------------------------------ *
 * Primitives
 * ------------------------------------------------------------------ */

/** Geometry: a bare `prst` name, which is what the backend interpolates. */
function geometryName(geometry: PptxIrGeometry): string {
  return typeof geometry === 'string' ? geometry : geometry.custom;
}

function frame(transform: PptxIrTransform): Opts {
  return {
    x: transform.xEmu,
    y: transform.yEmu,
    width: transform.widthEmu,
    height: transform.heightEmu,
  };
}

/**
 * A colour.
 *
 * `FillOptions` accepts a bare hex string for the common opaque case; anything
 * with transparency needs the object form with an `alpha` transform.
 */
function color(value: PptxIrColor): unknown {
  if (value.transparency === undefined) return value.hex;
  return {
    type: 'srgb',
    value: value.hex,
    transforms: { alpha: 100 - value.transparency },
  };
}

/**
 * OOXML `prst` pattern names → the backend's friendly names.
 *
 * `PresetPattern` spells `pct25` as `percent25`; the IR carries the OOXML name,
 * so the mapping happens here rather than in the IR.
 */
const PATTERN_NAMES: Readonly<Record<string, string>> = {
  pct5: 'percent5',
  pct10: 'percent10',
  pct20: 'percent20',
  pct25: 'percent25',
  pct30: 'percent30',
  pct40: 'percent40',
  pct50: 'percent50',
  pct60: 'percent60',
  pct70: 'percent70',
  pct75: 'percent75',
  pct80: 'percent80',
  pct90: 'percent90',
  horz: 'horizontal',
  vert: 'vertical',
  ltHorz: 'lightHorizontal',
  ltVert: 'lightVertical',
  dkHorz: 'darkHorizontal',
  dkVert: 'darkVertical',
  narHorz: 'narrowHorizontal',
  narVert: 'narrowVertical',
  cross: 'cross',
  diagCross: 'diagonalCross',
  upDiag: 'upwardDiagonal',
  dnDiag: 'downwardDiagonal',
  ltUpDiag: 'lightUpwardDiagonal',
  ltDnDiag: 'lightDownwardDiagonal',
  dkUpDiag: 'darkUpwardDiagonal',
  dkDnDiag: 'darkDownwardDiagonal',
  wdUpDiag: 'wideUpwardDiagonal',
  wdDnDiag: 'wideDownwardDiagonal',
  smGrid: 'smallGrid',
  lgGrid: 'largeGrid',
  dotGrid: 'dottedGrid',
  smCheck: 'smallCheckerBoard',
  lgCheck: 'largeCheckerBoard',
  trellis: 'trellis',
  divot: 'divot',
  shingle: 'shingle',
  weave: 'weave',
  plaid: 'plaid',
  sphere: 'sphere',
  zigZag: 'zigZag',
  wave: 'wave',
};

export function fill(value: PptxIrFill, ctx: OfficeOpenEmitContext): unknown {
  switch (value.kind) {
    case 'none':
      return { type: 'none' };
    case 'solid':
      return { type: 'solid', color: color(value.color) };
    case 'gradient': {
      const stops = value.gradient.stops.map((stop) => ({
        position: stop.position,
        color: color(stop.color),
      }));
      return value.gradient.type === 'radial'
        ? { type: 'gradient', path: 'circle', stops }
        : { type: 'gradient', angle: value.gradient.angleDegrees, stops };
    }
    case 'pattern':
      return {
        type: 'pattern',
        pattern: PATTERN_NAMES[value.preset] ?? value.preset,
        foregroundColor: color(value.foreground),
        backgroundColor: color(value.background),
      };
    case 'image': {
      const bytes = ctx.resourceBytes.get(value.resourceId);
      const resource = ctx.resources.get(value.resourceId);
      if (!bytes || !resource) {
        throw new Error(
          `image fill references unresolved resource "${value.resourceId}"`
        );
      }
      return { type: 'blip', data: bytes, imageType: pictureType(resource) };
    }
    default:
      return assertNever(value, 'PptxIrFill');
  }
}

function outline(line: PptxIrLine): Opts {
  const opts: Opts = {};
  if (line.color) opts.fill = { type: 'solid', color: color(line.color) };
  // Outline width is EMU; the IR keeps stroke width in points.
  if (line.widthPoints !== undefined) {
    opts.width = Math.round(line.widthPoints * 12700);
  }
  if (line.dash) opts.dash = line.dash;
  return opts;
}

function effects(shadow: PptxIrShadow): Opts {
  return {
    outerShadow: {
      blurRadius: Math.round(shadow.blurPoints * 12700),
      distance: Math.round(shadow.offsetPoints * 12700),
      direction: shadow.angleDegrees,
      color: {
        type: 'srgb',
        value: shadow.color.hex,
        transforms: { alpha: Math.round(shadow.opacity * 100) },
      },
    },
  };
}

function hyperlink(link: PptxIrHyperlink): Opts {
  return link.kind === 'external'
    ? { url: link.url, ...(link.tooltip ? { tooltip: link.tooltip } : {}) }
    : {
        slide: link.slideIndex,
        ...(link.tooltip ? { tooltip: link.tooltip } : {}),
      };
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

const ALIGNMENT: Readonly<Record<string, string>> = {
  left: 'left',
  center: 'center',
  right: 'right',
  justify: 'justify',
};

const ANCHOR: Readonly<Record<string, string>> = {
  top: 't',
  middle: 'ctr',
  bottom: 'b',
};

function runProperties(run: PptxIrTextRun): Opts {
  const opts: Opts = {
    size: run.fontSize,
    font: run.fontFamily,
    fill: { type: 'solid', color: color(run.color) },
  };
  if (run.bold !== undefined) opts.bold = run.bold;
  if (run.italic !== undefined) opts.italic = run.italic;
  if (run.strike) opts.strike = 'single';
  if (run.underline) opts.underline = 'single';
  if (run.superscript) opts.baseline = 30;
  if (run.subscript) opts.baseline = -25;
  if (run.characterSpacing !== undefined) opts.spacing = run.characterSpacing;
  if (run.language) opts.lang = run.language;
  if (run.hyperlink) opts.hyperlink = hyperlink(run.hyperlink);
  return opts;
}

/**
 * Build a text body.
 *
 * `breakAfter` on a run starts a new paragraph, which is how the IR expresses a
 * hard break inside a body.
 */
export function textBody(
  runs: readonly PptxIrTextRun[],
  style: PptxIrTextBodyStyle | undefined
): Opts {
  const paragraphs: Opts[] = [];
  let current: Opts[] = [];

  const flush = () => {
    paragraphs.push({
      ...(style ? { properties: paragraphProperties(style) } : {}),
      children: current,
    });
    current = [];
  };

  for (const run of runs) {
    current.push({ text: run.text, ...runProperties(run) });
    if (run.breakAfter) flush();
  }
  if (current.length > 0 || paragraphs.length === 0) flush();

  const body: Opts = { paragraphs };
  if (style) {
    body.anchor = ANCHOR[style.verticalAlign] ?? 't';
    if (style.autoFit) body.autoFit = 'shape';
    if (style.insetPoints !== undefined) {
      body.margins = insetMargins(style.insetPoints);
    }
  }
  return body;
}

function insetMargins(inset: number | [number, number, number, number]): Opts {
  const toEmu = (points: number) => Math.round(points * 12700);
  if (typeof inset === 'number') {
    const value = toEmu(inset);
    return { left: value, top: value, right: value, bottom: value };
  }
  const [left, top, right, bottom] = inset;
  return {
    left: toEmu(left),
    top: toEmu(top),
    right: toEmu(right),
    bottom: toEmu(bottom),
  };
}

function paragraphProperties(style: PptxIrTextBodyStyle): Opts {
  const opts: Opts = {};
  if (style.align) opts.alignment = ALIGNMENT[style.align] ?? style.align;
  if (style.lineSpacingMultiple !== undefined) {
    opts.lineSpacingPercent = style.lineSpacingMultiple * 100;
  } else if (style.lineSpacingPoints !== undefined) {
    opts.lineSpacingPoints = style.lineSpacingPoints;
  }
  if (style.spaceBeforePoints !== undefined) {
    opts.spaceBefore = style.spaceBeforePoints;
  }
  if (style.spaceAfterPoints !== undefined) {
    opts.spaceAfter = style.spaceAfterPoints;
  }
  if (style.bullet) {
    opts.bullet =
      style.bullet.type === 'number'
        ? {
            type: 'autoNumber',
            ...(style.bullet.startAt !== undefined
              ? { startAt: style.bullet.startAt }
              : {}),
          }
        : { type: 'character', character: style.bullet.style ?? '•' };
  }
  return opts;
}

/* ------------------------------------------------------------------ *
 * Elements
 * ------------------------------------------------------------------ */

function textBoxChild(
  element: PptxIrTextBoxElement,
  ctx: OfficeOpenEmitContext
): Opts {
  const shape: Opts = {
    ...frame(element.transform),
    geometry: 'rect',
    textBody: textBody(element.runs, element.style),
  };
  if (element.fill) shape.fill = fill(element.fill, ctx);
  else shape.fill = { type: 'none' };
  if (element.line) shape.outline = outline(element.line);
  if (element.shadow) shape.effects = effects(element.shadow);
  if (element.transform.rotationDegrees !== undefined) {
    shape.rotation = element.transform.rotationDegrees;
  }
  if (element.altText) shape.description = element.altText;
  return { shape };
}

function shapeChild(
  element: PptxIrShapeElement,
  ctx: OfficeOpenEmitContext
): Opts {
  const shape: Opts = {
    ...frame(element.transform),
    geometry: geometryName(element.geometry),
  };
  if (element.fill) shape.fill = fill(element.fill, ctx);
  if (element.line) shape.outline = outline(element.line);
  if (element.shadow) shape.effects = effects(element.shadow);
  if (element.transform.rotationDegrees !== undefined) {
    shape.rotation = element.transform.rotationDegrees;
  }
  if (element.transform.flipHorizontal) shape.flipHorizontal = true;
  if (element.runs && element.runs.length > 0) {
    shape.textBody = textBody(element.runs, element.style);
  }
  if (element.altText) shape.description = element.altText;
  return { shape };
}

/** Media type → the backend's picture `type` discriminator. */
function pictureType(resource: PptxIrResource): string {
  switch (resource.mediaType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
      return 'bmp';
    case 'image/png':
      return 'png';
    default:
      // Capability checking rejects SVG, and the backend takes no other types.
      return 'png';
  }
}

function pictureChild(
  element: PptxIrImageElement,
  ctx: OfficeOpenEmitContext
): Opts {
  const resource = ctx.resources.get(element.resourceId);
  const bytes = ctx.resourceBytes.get(element.resourceId);
  if (!resource || !bytes) {
    throw new Error(
      `image ${element.path} references unresolved resource "${element.resourceId}"`
    );
  }
  const picture: Opts = {
    ...frame(element.transform),
    data: bytes,
    type: pictureType(resource),
  };
  if (element.shadow) picture.effects = effects(element.shadow);
  if (element.altText) picture.description = element.altText;
  return { picture };
}

/**
 * A table.
 *
 * Cells carry `children` (paragraphs), not a text body, and cell formatting is
 * flattened onto the single run each cell holds — the authoring surface gives a
 * cell one string, so one run is the whole of it.
 *
 * Merged cells are deliberately absent from this adapter's capabilities: the
 * backend expresses a merge as `restart`/`continue` markers on the covered
 * cells, whereas the IR carries span counts, and inventing the covered cells
 * without a test to prove the geometry would be guesswork.
 */
function tableChild(
  element: PptxIrTableElement,
  ctx: OfficeOpenEmitContext
): Opts {
  void ctx;
  const columnCount = Math.max(
    ...element.rows.map((row) => row.cells.length),
    1
  );
  const columnWidths =
    element.columnWidthsEmu.length === columnCount
      ? [...element.columnWidthsEmu]
      : evenColumns(element, columnCount);

  const rows = element.rows.map((row, rowIndex) => {
    const out: Opts = {
      cells: row.cells.map((cell) => tableCell(cell, element)),
    };
    const height = element.rowHeightsEmu[rowIndex];
    if (height !== undefined) out.height = height;
    return out;
  });

  return {
    table: { ...frame(element.transform), columnWidths, rows },
  };
}

function tableCell(
  cell: PptxIrTableElement['rows'][number]['cells'][number],
  element: PptxIrTableElement
): Opts {
  const formatting = cell.formatting;
  const defaults = element.defaults;

  const runProps: Opts = {
    size: formatting?.fontSize ?? defaults.fontSize,
    font: formatting?.fontFamily ?? defaults.fontFamily,
  };
  const cellColor = formatting?.color ?? defaults.color;
  if (cellColor) runProps.fill = { type: 'solid', color: color(cellColor) };
  const bold = formatting?.bold ?? defaults.bold;
  if (bold !== undefined) runProps.bold = bold;
  if (formatting?.italic !== undefined) runProps.italic = formatting.italic;

  const align = formatting?.align ?? defaults.align;
  const paragraph: Opts = {
    children: [{ text: cell.text, ...runProps }],
  };
  if (align) {
    paragraph.properties = { alignment: ALIGNMENT[align] ?? align };
  }

  const out: Opts = {
    children: [paragraph],
    verticalAlign: ANCHOR[formatting?.verticalAlign ?? defaults.verticalAlign],
  };
  if (cell.fill) out.fill = { type: 'solid', color: color(cell.fill) };
  return out;
}

/** Even column widths when the IR did not carry a matching set. */
function evenColumns(
  element: PptxIrTableElement,
  columnCount: number
): number[] {
  const each = Math.floor(element.transform.widthEmu / columnCount);
  return Array.from({ length: columnCount }, () => each);
}

function groupChild(
  element: PptxIrGroupElement,
  ctx: OfficeOpenEmitContext
): Opts {
  const group: Opts = {
    ...frame(element.transform),
    childOffset: { x: element.transform.xEmu, y: element.transform.yEmu },
    childExtents: {
      width: element.transform.widthEmu,
      height: element.transform.heightEmu,
    },
    children: element.children.map((child) => slideChild(child, ctx)),
  };
  if (element.transform.rotationDegrees !== undefined) {
    group.rotation = element.transform.rotationDegrees;
  }
  return { group };
}

export function slideChild(
  element: PptxIrElement,
  ctx: OfficeOpenEmitContext
): Opts {
  switch (element.kind) {
    case 'textBox':
      return textBoxChild(element, ctx);
    case 'shape':
      return shapeChild(element, ctx);
    case 'image':
      return pictureChild(element, ctx);
    case 'table':
      return tableChild(element, ctx);
    case 'group':
      return groupChild(element, ctx);
    case 'chart':
      // `charts` is not in this adapter's capability set — see index.ts.
      throw new Error(
        `the office-open renderer does not emit charts (${element.path})`
      );
    default:
      return assertNever(element, 'PptxIrElement');
  }
}

export function background(
  value: PptxIrBackground,
  ctx: OfficeOpenEmitContext
): Opts {
  if (value.kind === 'solid') {
    return { fill: { type: 'solid', color: color(value.color) } };
  }
  return { fill: fill({ kind: 'image', resourceId: value.resourceId }, ctx) };
}
