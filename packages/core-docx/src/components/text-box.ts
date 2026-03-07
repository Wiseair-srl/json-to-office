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

// VML style helpers removed in favor of floating table approach

// Map floating config to docx paragraph frame options to enforce wrapping at paragraph level

// Map floating config to table float options for a one-cell table container
function mapTableFloatOptions(
  floating?: NonNullable<TextBoxComponentDefinition['props']['floating']>
): any | undefined {
  if (!floating) return undefined;

  const opt: any = {};

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
    opt.absoluteHorizontalPosition = hp.offset;
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
    opt.absoluteVerticalPosition = vp.offset;
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

  // Map wrap margins to clearance distances
  const m = floating.wrap?.margins;
  if (m) {
    if (m.top !== undefined) opt.topFromText = m.top;
    if (m.right !== undefined) opt.rightFromText = m.right;
    if (m.bottom !== undefined) opt.bottomFromText = m.bottom;
    if (m.left !== undefined) opt.leftFromText = m.left;
  }

  opt.overlap = OverlapType.OVERLAP;

  return opt;
}

export async function renderTextBoxComponent(
  component: ComponentDefinition,
  theme: ThemeConfig,
  themeName: string,
  _context: import('../types').RenderContext
): Promise<(Paragraph | Table)[]> {
  if (!isTextBoxComponent(component)) return [];
  const tb = component as TextBoxComponentDefinition;

  const isInline = !tb.props.floating;
  const childComponents = tb.children || [];

  if (isInline) {
    // Inline: use a one-cell table container for multi-paragraph support
    const cellChildren: (Paragraph | Table)[] = [];
    // Create context with current text-box as parent
    const childContext: import('../types').RenderContext = {
      ..._context,
      parent: tb,
    };
    for (const child of childComponents) {
      const rendered = await renderComponent(
        child,
        theme,
        themeName,
        childContext
      );
      cellChildren.push(...rendered);
    }

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

  // If there is at least one table or image child, use a floating one-cell table container
  const cellChildren: (Paragraph | Table)[] = [];
  // Create context with current text-box as parent
  const childContext: import('../types').RenderContext = {
    ..._context,
    parent: tb,
  };
  for (const child of childComponents) {
    const rendered = await renderComponent(
      child,
      theme,
      themeName,
      childContext
    );
    cellChildren.push(...rendered);
  }

  const styleCfg = (tb.props as any).style as CellStyleConfig | undefined;
  const cellOpts = buildCellOptions(cellChildren, styleCfg, theme);

  const row = new TableRow({
    children: [new TableCell(cellOpts)],
  });

  const float = mapTableFloatOptions(tb.props.floating);

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
