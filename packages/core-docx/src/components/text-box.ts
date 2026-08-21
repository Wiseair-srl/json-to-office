/**
 * Text Box Component
 * Floating container that groups child paragraphs (from text/image components)
 */

import {
  Paragraph,
  Table,
  TableRow,
  TableCell,
  WidthType,
  TableAnchorType,
  RelativeHorizontalPosition,
  RelativeVerticalPosition,
  OverlapType,
  TableLayoutType,
  WpsShapeRun,
  type IWpsShapeOptions,
} from 'docx';
import {
  ComponentDefinition,
  TextBoxComponentDefinition,
  isTextBoxComponent,
} from '../types';
import { ThemeConfig } from '../styles';
// No direct image or text parsing here; children components render themselves
import { renderComponent } from '../core/render';
import { NONE_BORDERS } from '../styles/utils/borderUtils';
import { buildCellOptions, CellStyleConfig } from '../styles/utils/cellUtils';
import { resolveColor } from '../styles/utils/colorUtils';
import { mapFloatingOptions } from '../utils/docxImagePositioning';
import {
  resolveOffsetTwips,
  getPageWidthTwips,
  getPageHeightTwips,
  getAvailableWidthTwips,
  getAvailableHeightTwips,
} from '../utils/widthUtils';

// VML style helpers removed in favor of floating table approach

// Map floating config to docx paragraph frame options to enforce wrapping at paragraph level

// Map floating config to table float options for a one-cell table container
function mapTableFloatOptions(
  floating?: NonNullable<TextBoxComponentDefinition['props']['floating']>,
  theme?: ThemeConfig,
  themeName?: string
): any | undefined {
  if (!floating) return undefined;

  const opt: any = {};

  // Determine reference dimensions for percentage resolution
  const hRelative = floating.horizontalPosition?.relative;
  const vRelative = floating.verticalPosition?.relative;
  const hRef =
    hRelative && hRelative !== 'page'
      ? getAvailableWidthTwips(theme, themeName)
      : getPageWidthTwips(theme, themeName);
  const vRef =
    vRelative && vRelative !== 'page'
      ? getAvailableHeightTwips(theme, themeName)
      : getPageHeightTwips(theme, themeName);

  const hp = floating.horizontalPosition;
  if (hp?.relative) {
    opt.horizontalAnchor =
      hp.relative === 'margin'
        ? TableAnchorType.MARGIN
        : hp.relative === 'page'
          ? TableAnchorType.PAGE
          : TableAnchorType.TEXT;
  }
  if (hp?.offset !== undefined) {
    opt.absoluteHorizontalPosition = resolveOffsetTwips(hp.offset, hRef);
  } else if (hp?.align) {
    const map: Record<
      string,
      (typeof RelativeHorizontalPosition)[keyof typeof RelativeHorizontalPosition]
    > = {
      left: RelativeHorizontalPosition.LEFT,
      center: RelativeHorizontalPosition.CENTER,
      right: RelativeHorizontalPosition.RIGHT,
      inside: RelativeHorizontalPosition.INSIDE,
      outside: RelativeHorizontalPosition.OUTSIDE,
    };
    opt.relativeHorizontalPosition = map[hp.align];
  }

  const vp = floating.verticalPosition;
  if (vp?.relative) {
    opt.verticalAnchor =
      vp.relative === 'margin'
        ? TableAnchorType.MARGIN
        : vp.relative === 'page'
          ? TableAnchorType.PAGE
          : TableAnchorType.TEXT;
  }
  if (vp?.offset !== undefined) {
    opt.absoluteVerticalPosition = resolveOffsetTwips(vp.offset, vRef);
  } else if (vp?.align) {
    const mapV: Record<
      string,
      (typeof RelativeVerticalPosition)[keyof typeof RelativeVerticalPosition]
    > = {
      top: RelativeVerticalPosition.TOP,
      center: RelativeVerticalPosition.CENTER,
      bottom: RelativeVerticalPosition.BOTTOM,
      inside: RelativeVerticalPosition.INSIDE,
      outside: RelativeVerticalPosition.OUTSIDE,
    } as any;
    opt.relativeVerticalPosition = mapV[vp.align];
  }

  // Map wrap margins to clearance distances (resolve percentages against page dimensions)
  const pageW = getPageWidthTwips(theme, themeName);
  const pageH = getPageHeightTwips(theme, themeName);
  const m = floating.wrap?.margins;
  if (m) {
    if (m.top !== undefined) opt.topFromText = resolveOffsetTwips(m.top, pageH);
    if (m.right !== undefined)
      opt.rightFromText = resolveOffsetTwips(m.right, pageW);
    if (m.bottom !== undefined)
      opt.bottomFromText = resolveOffsetTwips(m.bottom, pageH);
    if (m.left !== undefined)
      opt.leftFromText = resolveOffsetTwips(m.left, pageW);
  }

  opt.overlap = OverlapType.OVERLAP;

  return opt;
}

/**
 * Render a text box's children with the box itself as their parent — the link
 * that makes a nested `columns` render as a table rather than as a
 * section-level column layout.
 */
async function renderTextBoxChildren(
  tb: TextBoxComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  context: import('../types').RenderContext
): Promise<(Paragraph | Table)[]> {
  const childContext: import('../types').RenderContext = {
    ...context,
    parent: tb,
  };

  const rendered: (Paragraph | Table)[] = [];
  for (const child of tb.children || []) {
    rendered.push(
      ...(await renderComponent(child, theme, themeName, childContext))
    );
  }
  return rendered;
}

/**
 * Render the text box as a borderless one-cell table — the default, and the
 * only rendering with autofit, per-side borders and lazy percentage widths.
 *
 * `prerendered` carries the children a failed shape attempt already rendered:
 * rendering them again would repeat their bookmark, comment and footnote
 * registrations.
 */
async function renderTextBoxAsTable(
  tb: TextBoxComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  _context: import('../types').RenderContext,
  prerendered?: (Paragraph | Table)[]
): Promise<(Paragraph | Table)[]> {
  const isInline = !tb.props.floating;

  if (isInline) {
    // Inline: use a one-cell table container for multi-paragraph support
    const cellChildren =
      prerendered ??
      (await renderTextBoxChildren(tb, theme, themeName, _context));

    const styleCfg = (tb.props as any).style as CellStyleConfig | undefined;
    const cellOpts = buildCellOptions(cellChildren, styleCfg, theme);

    const row = new TableRow({ children: [new TableCell(cellOpts)] });
    const table = new Table({
      layout: TableLayoutType.FIXED, // Lock column widths
      rows: [row],
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NONE_BORDERS,
    });
    return [table];
  }

  // Always use a floating one-cell table container for multi-paragraph support
  const cellChildren =
    prerendered ??
    (await renderTextBoxChildren(tb, theme, themeName, _context));

  const styleCfg = (tb.props as any).style as CellStyleConfig | undefined;
  const cellOpts = buildCellOptions(cellChildren, styleCfg, theme);

  const row = new TableRow({
    children: [new TableCell(cellOpts)],
  });

  const float = mapTableFloatOptions(tb.props.floating, theme, themeName);

  // Conversion factor: 1 pixel = 15 twips (at 96 DPI: 1440 twips/inch / 96 pixels/inch)
  const PIXELS_TO_TWIPS = 15;
  const DEFAULT_WIDTH_TWIPS = 5000; // ~333 pixels

  // Support width as number (pixels) or percentage string
  // Read from props.width (new location) with fallback to props.floating.width (legacy, in twips)
  const rawWidth = tb.props.width ?? (tb.props.floating as any)?.width;
  let widthSize: number;
  let widthType: (typeof WidthType)[keyof typeof WidthType];

  if (rawWidth === undefined) {
    // No width specified, use default
    widthSize = DEFAULT_WIDTH_TWIPS;
    widthType = WidthType.DXA;
  } else if (typeof rawWidth === 'string' && rawWidth.endsWith('%')) {
    // Percentage width
    widthSize = parseFloat(rawWidth);
    widthType = WidthType.PERCENTAGE;
  } else {
    // Number in pixels - convert to twips (DXA)
    widthSize =
      typeof rawWidth === 'number'
        ? rawWidth * PIXELS_TO_TWIPS
        : DEFAULT_WIDTH_TWIPS;
    widthType = WidthType.DXA;
  }

  const table = new Table({
    layout: TableLayoutType.FIXED, // Lock column widths
    rows: [row],
    width: { size: widthSize, type: widthType },
    float,
    borders: NONE_BORDERS,
  });
  return [table];
}

/** 1 px at 96 DPI in EMU (914400 EMU/inch ÷ 96 px/inch). */
const PIXELS_TO_EMU = 9525;
/** 1 px at 96 DPI in twips (1440 twips/inch ÷ 96 px/inch). */
const TWIPS_PER_PIXEL = 15;

type TextBoxStyle = NonNullable<TextBoxComponentDefinition['props']['style']>;
type BorderSide = NonNullable<NonNullable<TextBoxStyle['border']>['top']>;

/**
 * Resolve a `width`/`height` prop to whole pixels.
 *
 * A shape carries an absolute size in the file, so a percentage cannot stay
 * lazy the way a table's `w:tblW` can: it is resolved here against the page's
 * content box and frozen. Callers warn about that, once per text box.
 */
function resolveShapeSize(
  value: number | string | undefined,
  axis: 'width' | 'height',
  theme: ThemeConfig,
  themeName: string
): { pixels?: number; resolvedPercentage: boolean } {
  if (typeof value === 'number') {
    return { pixels: Math.round(value), resolvedPercentage: false };
  }
  if (typeof value !== 'string') return { resolvedPercentage: false };

  const fraction = parseFloat(value) / 100;
  if (!Number.isFinite(fraction) || fraction <= 0) {
    return { resolvedPercentage: false };
  }
  const availableTwips =
    axis === 'width'
      ? getAvailableWidthTwips(theme, themeName)
      : getAvailableHeightTwips(theme, themeName);
  return {
    pixels: Math.round((availableTwips * fraction) / TWIPS_PER_PIXEL),
    resolvedPercentage: true,
  };
}

/** Hex without the leading '#', which DrawingML's `a:srgbClr` does not take. */
function shapeColor(value: string, theme: ThemeConfig): string {
  return resolveColor(value, theme).replace(/^#/, '');
}

/**
 * Collapse the per-side border config into the single `a:ln` a shape has.
 *
 * Sides are considered in top/left/bottom/right order; when they disagree, the
 * first one wins and the caller is told which.
 */
function shapeOutline(
  style: TextBoxStyle | undefined,
  theme: ThemeConfig
): {
  outline?: IWpsShapeOptions['outline'];
  ignoredSides: string[];
  unsupportedStyles: string[];
} {
  const border = style?.border;
  if (!border) return { ignoredSides: [], unsupportedStyles: [] };

  const order: (keyof NonNullable<TextBoxStyle['border']>)[] = [
    'top',
    'left',
    'bottom',
    'right',
  ];
  const declared = order
    .map((side) => [side, border[side]] as const)
    .filter((entry): entry is [(typeof order)[number], BorderSide] =>
      Boolean(entry[1])
    );
  if (declared.length === 0) return { ignoredSides: [], unsupportedStyles: [] };

  // docx's OutlineOptions carries width, cap, compound and fill — there is no
  // `a:prstDash`, so a dash pattern cannot be expressed at all, and the one
  // `compoundLine` that could stand in for `double` is emitted as the enum key
  // (`cmpd="DOUBLE"`) rather than the OOXML value. Drawing any of the three as
  // a plain solid line would silently change the design, so the caller falls
  // back to the table rendering, which supports all of them.
  const unsupportedStyles = [
    ...new Set(
      declared
        .map(([, config]) => config.style)
        .filter(
          (value): value is 'dashed' | 'dotted' | 'double' =>
            value === 'dashed' || value === 'dotted' || value === 'double'
        )
    ),
  ];
  if (unsupportedStyles.length > 0) {
    return { ignoredSides: [], unsupportedStyles };
  }

  const [, used] = declared[0];
  const differs = ({ style: s, width, color }: BorderSide): boolean =>
    s !== used.style || width !== used.width || color !== used.color;
  const ignoredSides = declared
    .slice(1)
    .filter(([, config]) => differs(config))
    .map(([side]) => side);

  if (used.style === 'none') return { ignoredSides, unsupportedStyles };

  return {
    outline: {
      type: 'solidFill',
      solidFillType: 'rgb',
      value: used.color ? shapeColor(used.color, theme) : '000000',
      ...(used.width !== undefined && {
        width: Math.round(used.width * PIXELS_TO_EMU),
      }),
    },
    ignoredSides,
    unsupportedStyles,
  };
}

/** `bodyPr` insets are EMU, like every other DrawingML length. */
function shapeBodyProperties(
  style: TextBoxStyle | undefined
): IWpsShapeOptions['bodyProperties'] {
  const padding = style?.padding;
  if (!padding) return undefined;

  const toEmu = (value: number | undefined) =>
    value === undefined ? undefined : Math.round(value * PIXELS_TO_EMU);

  return {
    margins: {
      ...(padding.top !== undefined && { top: toEmu(padding.top) }),
      ...(padding.bottom !== undefined && { bottom: toEmu(padding.bottom) }),
      ...(padding.left !== undefined && { left: toEmu(padding.left) }),
      ...(padding.right !== undefined && { right: toEmu(padding.right) }),
    },
  };
}

/**
 * A shape rendering, or the reason there is none — carrying back whatever the
 * attempt already rendered so the table fallback can reuse it.
 */
type ShapeAttempt =
  | { kind: 'shape'; paragraphs: Paragraph[] }
  | { kind: 'fallback'; rendered?: (Paragraph | Table)[] };

/**
 * Render the text box as a native Word text box (a `wps:wsp` shape).
 *
 * Everything a shape cannot express falls back to the table rendering rather
 * than shipping a box that clips its content or quietly redraws its border.
 * The checks that read props only run before the children render, so the
 * common fallbacks cost nothing.
 */
async function renderTextBoxAsShape(
  tb: TextBoxComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  context: import('../types').RenderContext
): Promise<ShapeAttempt> {
  const width = resolveShapeSize(tb.props.width, 'width', theme, themeName);
  const height = resolveShapeSize(tb.props.height, 'height', theme, themeName);
  if (width.pixels === undefined || height.pixels === undefined) {
    console.warn(
      '[core-docx] text-box renderAs "shape" needs an explicit width and height (a shape has no autofit); falling back to table rendering.'
    );
    return { kind: 'fallback' };
  }

  const style = tb.props.style;
  const { outline, ignoredSides, unsupportedStyles } = shapeOutline(
    style,
    theme
  );
  if (unsupportedStyles.length > 0) {
    console.warn(
      `[core-docx] text-box renderAs "shape" cannot draw a ${unsupportedStyles.join('/')} border (a shape outline has no dash pattern); falling back to table rendering, which draws it.`
    );
    return { kind: 'fallback' };
  }

  const rendered = await renderTextBoxChildren(tb, theme, themeName, context);
  // `WpsShapeCoreOptions.children` is `readonly Paragraph[]`: a nested
  // `columns` (which renders as a Table) has nowhere to go in a shape.
  if (rendered.some((element) => !(element instanceof Paragraph))) {
    console.warn(
      '[core-docx] text-box renderAs "shape" requires paragraph-only content; falling back to table rendering.'
    );
    return { kind: 'fallback', rendered };
  }
  const children = rendered as Paragraph[];

  if (width.resolvedPercentage || height.resolvedPercentage) {
    console.warn(
      '[core-docx] text-box renderAs "shape" resolves percentage sizes at generation time, against the current page content box; the shape will not reflow if the page size changes.'
    );
  }

  const fill = style?.shading?.fill;
  if (ignoredSides.length > 0) {
    console.warn(
      `[core-docx] text-box renderAs "shape" has one uniform outline; using the first declared border side and ignoring ${ignoredSides.join(', ')}.`
    );
  }

  // docx 9.7.1 emits `a:noFill` + `a:ln` for an outline and then `a:solidFill`
  // for the fill, which is two fill groups in the wrong order for
  // CT_ShapeProperties — Word rejects it. Verified against the packed XML, so
  // when both are asked for, the fill wins.
  const dropOutline = Boolean(fill) && Boolean(outline);
  if (dropOutline) {
    console.warn(
      '[core-docx] text-box renderAs "shape" cannot carry a fill and a border at once (docx emits invalid shape properties); keeping the fill and dropping the border.'
    );
  }

  const bodyProperties = shapeBodyProperties(style);
  const run = new WpsShapeRun({
    type: 'wps',
    children,
    transformation: { width: width.pixels, height: height.pixels },
    ...(fill && {
      solidFill: { type: 'rgb', value: shapeColor(fill, theme) } as const,
    }),
    ...(outline && !dropOutline && { outline }),
    ...(bodyProperties && { bodyProperties }),
    // Absent `floating` makes it a `wp:inline` drawing.
    ...(tb.props.floating && {
      floating: mapFloatingOptions(tb.props.floating, theme, themeName),
    }),
  });

  return {
    kind: 'shape',
    paragraphs: [
      new Paragraph({ children: [run], spacing: { before: 0, after: 0 } }),
    ],
  };
}

export async function renderTextBoxComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  context: import('../types').RenderContext
): Promise<(Paragraph | Table)[]> {
  if (!isTextBoxComponent(component)) return [];
  const tb = component as TextBoxComponentDefinition;

  if (tb.props.renderAs === 'shape') {
    const attempt = await renderTextBoxAsShape(tb, theme, themeName, context);
    if (attempt.kind === 'shape') return attempt.paragraphs;
    return renderTextBoxAsTable(
      tb,
      theme,
      themeName,
      context,
      attempt.rendered
    );
  }

  return renderTextBoxAsTable(tb, theme, themeName, context);
}
