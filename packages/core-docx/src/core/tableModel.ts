/**
 * The `table` component, resolved down to plain numbers and colours.
 *
 * A table's authoring surface is layered: a value may come from the cell, the
 * column, the table's header defaults, the table's cell defaults, the table's
 * own border settings, or the built-in defaults — and borders, sizes and
 * padding each cascade *per side*, so a cell can take its left border from one
 * layer and its top from another. Getting that cascade right is the whole job,
 * and it has nothing to do with any renderer.
 *
 * So it lives here, once. Both the pre-IR writer (`createTable`) and the DocxIR
 * compiler resolve a table through this module and then only translate the
 * result into their own vocabulary. Two copies of these rules would drift, and
 * the drift would be invisible until a border quietly changed colour.
 *
 * Everything returned is resolved: colours are 6-digit hex without `#`, border
 * sizes are points, padding and heights are points. Nothing here loads content
 * or touches the filesystem.
 */

import type { ComponentDefinition } from '../types';
import type { ThemeConfig } from '../styles';
import { resolveColor } from '../styles/utils/colorUtils';
import {
  getAvailableWidthTwips,
  relativeLengthToTwips,
} from '../utils/widthUtils';
import { pointsToTwips } from '../styles/utils/styleHelpers';

/* ------------------------------------------------------------------ *
 * Authoring shapes
 * ------------------------------------------------------------------ */

export type TableCellContent = string | ComponentDefinition;

export type TableFontConfig = {
  family?: string;
  size?: number;
  bold?: boolean;
  fontWeight?: number;
  italic?: boolean;
  underline?: boolean;
};

export type BorderColor =
  | string
  | { bottom?: string; top?: string; right?: string; left?: string };

export type BorderSize =
  | number
  | { bottom?: number; top?: number; right?: number; left?: number };

export type Padding =
  | number
  | { bottom?: number; top?: number; right?: number; left?: number };

export type CellDefaults = {
  color?: string;
  backgroundColor?: string;
  horizontalAlignment?: 'left' | 'center' | 'right' | 'justify';
  verticalAlignment?: 'top' | 'middle' | 'bottom';
  font?: TableFontConfig;
  borderColor?: BorderColor;
  borderSize?: BorderSize;
  padding?: Padding;
  height?: number;
};

export type HideBorders =
  | boolean
  | {
      top?: boolean;
      right?: boolean;
      bottom?: boolean;
      left?: boolean;
      insideHorizontal?: boolean;
      insideVertical?: boolean;
    };

/** A cell as written, plus the annotations that ride along with it. */
export type TableCellSource<TComment, TRevision> = CellDefaults & {
  comment?: TComment;
  revision?: TRevision;
  content?: TableCellContent;
};

export type TableColumnSource<TComment, TRevision> = {
  /** Width in points (number) or as a percentage string, e.g. `"40%"`. */
  width?: number | string;
  cellDefaults?: CellDefaults;
  header?: TableCellSource<TComment, TRevision>;
  cells?: TableCellSource<TComment, TRevision>[];
};

export type TableSource<TComment, TRevision, TRowRevision> = {
  borderColor?: BorderColor;
  borderSize?: BorderSize;
  hideBorders?: HideBorders;
  cellDefaults?: CellDefaults;
  headerCellDefaults?: CellDefaults;
  width?: number;
  columns: TableColumnSource<TComment, TRevision>[];
  /** Row-parallel properties, indexed like `columns[].cells`. */
  rows?: {
    revision?: TRowRevision;
    cantSplit?: boolean;
    tableHeader?: boolean;
  }[];
  keepInOnePage?: boolean;
  keepNext?: boolean;
  repeatHeaderOnPageBreak?: boolean;
};

/* ------------------------------------------------------------------ *
 * Resolved shapes
 * ------------------------------------------------------------------ */

export interface ResolvedSides<T> {
  top: T;
  right: T;
  bottom: T;
  left: T;
}

/** One side of a cell's border, after the cascade and the hide rules. */
export interface ResolvedBorder {
  /** Points. Zero means no border. */
  size: number;
  /** 6-digit hex, no `#`. */
  color: string;
  /** True when `hideBorders` suppressed this side for this cell. */
  hidden: boolean;
}

export interface ResolvedCell<TComment, TRevision> {
  content?: TableCellContent;
  comment?: TComment;
  revision?: TRevision;
  /** Text colour: hex, `auto`, or undefined to inherit the table style. */
  color?: string;
  /** Fill: hex, `auto`, or the `transparent` sentinel meaning "no shading". */
  backgroundColor?: string;
  horizontalAlignment: 'left' | 'center' | 'right' | 'justify';
  verticalAlignment: 'top' | 'middle' | 'bottom';
  font: TableFontConfig;
  borders: ResolvedSides<ResolvedBorder>;
  /** Points, per side. Absent when no layer asked for padding. */
  padding?: ResolvedSides<number>;
  /**
   * A cell the source never wrote, kept only so the grid stays rectangular.
   *
   * It draws its borders and nothing else — no fill, no padding, no content —
   * which is what tells a renderer to leave it empty rather than style it.
   */
  missing?: boolean;
}

export interface ResolvedRow<TComment, TRevision, TRowRevision> {
  cells: ResolvedCell<TComment, TRevision>[];
  /** Points; the tallest height any cell in the row asked for. */
  height?: number;
  isHeader: boolean;
  /** Set only when the source stated it. */
  tableHeader?: boolean;
  cantSplit?: boolean;
  revision?: TRowRevision;
  /** Every cell paragraph in the row keeps with the next one. */
  keepNext: boolean;
}

/**
 * The table's column grid.
 *
 * `twips` is the real OOXML unit. `percent` is what the pipeline has always
 * written when no column states a width — the grid then carries a percentage
 * per column rather than a width, which Word tolerates because the table
 * itself is sized in percent.
 */
export interface ResolvedColumnGrid {
  unit: 'twips' | 'percent';
  values: number[];
}

export interface ResolvedTable<TComment, TRevision, TRowRevision> {
  columnGrid: ResolvedColumnGrid;
  width: { size: number; unit: 'twips' | 'percent' };
  header: ResolvedRow<TComment, TRevision, TRowRevision>;
  rows: ResolvedRow<TComment, TRevision, TRowRevision>[];
  /** Headers repeat across page breaks unless the source disabled it. */
  repeatHeader: boolean;
  /** Emitted when the column widths cannot fit the page. */
  overflow?: { totalTwips: number; availableTwips: number };
}

/* ------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------ */

/** What a cell looks like before any layer has said anything. */
function baseDefaults(): Required<
  Pick<
    CellDefaults,
    | 'color'
    | 'backgroundColor'
    | 'horizontalAlignment'
    | 'verticalAlignment'
    | 'font'
    | 'borderColor'
    | 'borderSize'
  >
> {
  return {
    color: '000000',
    backgroundColor: 'transparent',
    horizontalAlignment: 'left',
    verticalAlignment: 'top',
    font: {
      family: 'Arial',
      size: 11,
      bold: false,
      italic: false,
      underline: false,
    },
    borderColor: '000000',
    borderSize: 1,
  };
}

/**
 * Sentinels for "this layer did not say".
 *
 * Normalising a per-side value has to distinguish "not stated" from a real
 * value so a lower layer can still win, and the two sentinels are what the
 * cascade searches past.
 */
const UNSET_COLOR = '';
const UNSET_SIZE = -1;

/* ------------------------------------------------------------------ *
 * Per-side cascades
 * ------------------------------------------------------------------ */

function normalizeBorderColor(
  border: BorderColor | undefined
): ResolvedSides<string> | undefined {
  if (border === undefined) return undefined;
  if (typeof border === 'string') {
    return { top: border, right: border, bottom: border, left: border };
  }
  return {
    top: border.top ?? UNSET_COLOR,
    right: border.right ?? UNSET_COLOR,
    bottom: border.bottom ?? UNSET_COLOR,
    left: border.left ?? UNSET_COLOR,
  };
}

function normalizeBorderSize(
  border: BorderSize | undefined
): ResolvedSides<number> | undefined {
  if (border === undefined) return undefined;
  if (typeof border === 'number') {
    return { top: border, right: border, bottom: border, left: border };
  }
  return {
    top: border.top ?? UNSET_SIZE,
    right: border.right ?? UNSET_SIZE,
    bottom: border.bottom ?? UNSET_SIZE,
    left: border.left ?? UNSET_SIZE,
  };
}

function normalizePadding(
  padding: Padding | undefined
): ResolvedSides<number> | undefined {
  if (padding === undefined) return undefined;
  if (typeof padding === 'number') {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  return {
    top: padding.top ?? UNSET_SIZE,
    right: padding.right ?? UNSET_SIZE,
    bottom: padding.bottom ?? UNSET_SIZE,
    left: padding.left ?? UNSET_SIZE,
  };
}

/** First layer to state a colour for each side wins, side by side. */
function mergeBorderColorPerSide(
  ...borders: (BorderColor | undefined)[]
): ResolvedSides<string> {
  const normalized = borders.map(normalizeBorderColor);
  const fallback = baseDefaults().borderColor as string;
  const pick = (side: keyof ResolvedSides<string>): string =>
    normalized.find((b) => b && b[side] !== UNSET_COLOR)?.[side] ?? fallback;

  return {
    top: pick('top'),
    right: pick('right'),
    bottom: pick('bottom'),
    left: pick('left'),
  };
}

function mergeBorderSizePerSide(
  ...borders: (BorderSize | undefined)[]
): ResolvedSides<number> {
  const normalized = borders.map(normalizeBorderSize);
  const fallback = baseDefaults().borderSize as number;
  const pick = (side: keyof ResolvedSides<number>): number =>
    normalized.find((b) => b && b[side] !== UNSET_SIZE)?.[side] ?? fallback;

  return {
    top: pick('top'),
    right: pick('right'),
    bottom: pick('bottom'),
    left: pick('left'),
  };
}

/**
 * Padding, or nothing.
 *
 * Unlike borders there is no built-in padding: if no layer asked for any, the
 * cell keeps whatever margins the document defines rather than being pinned to
 * zero.
 */
function mergePaddingPerSide(
  ...paddings: (Padding | undefined)[]
): ResolvedSides<number> | undefined {
  const normalized = paddings.map(normalizePadding);
  if (!normalized.some((p) => p !== undefined)) return undefined;
  const pick = (side: keyof ResolvedSides<number>): number =>
    normalized.find((p) => p && p[side] !== UNSET_SIZE)?.[side] ?? 0;

  return {
    top: pick('top'),
    right: pick('right'),
    bottom: pick('bottom'),
    left: pick('left'),
  };
}

/**
 * The table's own border applied to the cells on its outside edge.
 *
 * A table-level border is a border around the *table*, so it only reaches the
 * sides of a cell that face outwards. It is applied a second time, to every
 * side, as the last fallback before the built-in default — that is what makes
 * `borderColor: '#ccc'` on a table colour the inner grid too.
 */
function outerBorderOverride(
  position: {
    isHeader?: boolean;
    isFirstCol?: boolean;
    isLastCol?: boolean;
    isLastRow?: boolean;
  },
  tableBorderColor?: BorderColor,
  tableBorderSize?: BorderSize
): {
  borderColor?: Partial<ResolvedSides<string>>;
  borderSize?: Partial<ResolvedSides<number>>;
} {
  const result: {
    borderColor?: Partial<ResolvedSides<string>>;
    borderSize?: Partial<ResolvedSides<number>>;
  } = {};

  const color = normalizeBorderColor(tableBorderColor);
  if (tableBorderColor && color) {
    result.borderColor = {};
    if (position.isHeader && color.top !== UNSET_COLOR) {
      result.borderColor.top = color.top;
    }
    if (position.isFirstCol && color.left !== UNSET_COLOR) {
      result.borderColor.left = color.left;
    }
    if (position.isLastCol && color.right !== UNSET_COLOR) {
      result.borderColor.right = color.right;
    }
    if (position.isLastRow && color.bottom !== UNSET_COLOR) {
      result.borderColor.bottom = color.bottom;
    }
  }

  const size = normalizeBorderSize(tableBorderSize);
  if (tableBorderSize && size) {
    result.borderSize = {};
    if (position.isHeader && size.top !== UNSET_SIZE) {
      result.borderSize.top = size.top;
    }
    if (position.isFirstCol && size.left !== UNSET_SIZE) {
      result.borderSize.left = size.left;
    }
    if (position.isLastCol && size.right !== UNSET_SIZE) {
      result.borderSize.right = size.right;
    }
    if (position.isLastRow && size.bottom !== UNSET_SIZE) {
      result.borderSize.bottom = size.bottom;
    }
  }

  return result;
}

function normalizeHideBorders(
  hideBorders: HideBorders | undefined
): ResolvedSides<boolean> & {
  insideHorizontal: boolean;
  insideVertical: boolean;
} {
  if (hideBorders === undefined) {
    return {
      top: false,
      right: false,
      bottom: false,
      left: false,
      insideHorizontal: false,
      insideVertical: false,
    };
  }
  if (typeof hideBorders === 'boolean') {
    return {
      top: hideBorders,
      right: hideBorders,
      bottom: hideBorders,
      left: hideBorders,
      insideHorizontal: hideBorders,
      insideVertical: hideBorders,
    };
  }
  return {
    top: hideBorders.top ?? false,
    right: hideBorders.right ?? false,
    bottom: hideBorders.bottom ?? false,
    left: hideBorders.left ?? false,
    insideHorizontal: hideBorders.insideHorizontal ?? false,
    insideVertical: hideBorders.insideVertical ?? false,
  };
}

/* ------------------------------------------------------------------ *
 * Colours
 * ------------------------------------------------------------------ */

export interface TableModelOptions {
  /** Reports a value that could not be used. Deduplicated by the caller. */
  onWarning?: (code: string, message: string) => void;
}

/**
 * Resolve a cell colour the way every other colour in the schema resolves.
 *
 * Bare 6-digit hex and `auto` pass through: they are the only raw values OOXML
 * itself accepts, so documents relying on them predate theme resolution and
 * must keep working. `transparent` is a `backgroundColor`-only sentinel — on
 * the text path nothing consumes it and it is not a legal `w:color`, so it is
 * dropped with a warning rather than emitted.
 */
function resolveCellColor(
  value: string | undefined,
  prop: 'color' | 'backgroundColor',
  theme: ThemeConfig,
  options: TableModelOptions
): string | undefined {
  if (value === undefined || value === 'auto') return value;
  if (value === 'transparent') {
    if (prop === 'backgroundColor') return value;
    options.onWarning?.(
      'TABLE_CELL_COLOR_INVALID',
      `"transparent" is not a valid table cell "color"; ignoring it and using the table style color. It only applies to "backgroundColor".`
    );
    return undefined;
  }
  if (/^[0-9A-Fa-f]{6}$/.test(value)) return value.toUpperCase();
  try {
    return resolveColor(value, theme);
  } catch {
    // Passing the value through instead would not save the document: no
    // renderer can emit a non-hex, non-"auto" fill, so it would still fail —
    // deeper in the stack with an opaque message.
    const allowed =
      prop === 'backgroundColor'
        ? '"auto", or "transparent" for no shading'
        : 'or "auto"';
    throw new Error(
      `Invalid table cell ${prop}: "${value}". Must be a hex color with # prefix (e.g. "#000000"), a theme color name, ${allowed}.`
    );
  }
}

/* ------------------------------------------------------------------ *
 * The cascade
 * ------------------------------------------------------------------ */

type MergedCell = Omit<
  ResolvedCell<never, never>,
  'content' | 'comment' | 'revision' | 'borders'
> & {
  borderColor: ResolvedSides<string>;
  borderSize: ResolvedSides<number>;
  height?: number;
};

/**
 * A body cell's resolved properties.
 *
 * Priority, highest first: the cell, the column, the table border on the sides
 * that face out, the table's cell defaults, the table border everywhere, the
 * built-in defaults.
 */
function mergeCellDefaults(
  tableDef: CellDefaults | undefined,
  columnDef: CellDefaults | undefined,
  cellDef: CellDefaults | undefined,
  position: { isFirstCol?: boolean; isLastCol?: boolean; isLastRow?: boolean },
  tableOuterBorder: { borderColor?: BorderColor; borderSize?: BorderSize },
  theme: ThemeConfig,
  options: TableModelOptions
): MergedCell {
  const defaults = baseDefaults();
  const outer = outerBorderOverride(
    position,
    tableOuterBorder.borderColor,
    tableOuterBorder.borderSize
  );

  return {
    color: resolveCellColor(
      cellDef?.color ?? columnDef?.color ?? tableDef?.color ?? defaults.color,
      'color',
      theme,
      options
    ),
    backgroundColor: resolveCellColor(
      cellDef?.backgroundColor ??
        columnDef?.backgroundColor ??
        tableDef?.backgroundColor ??
        defaults.backgroundColor,
      'backgroundColor',
      theme,
      options
    ),
    horizontalAlignment:
      cellDef?.horizontalAlignment ??
      columnDef?.horizontalAlignment ??
      tableDef?.horizontalAlignment ??
      defaults.horizontalAlignment,
    verticalAlignment:
      cellDef?.verticalAlignment ??
      columnDef?.verticalAlignment ??
      tableDef?.verticalAlignment ??
      defaults.verticalAlignment,
    font: {
      ...defaults.font,
      ...tableDef?.font,
      ...columnDef?.font,
      ...cellDef?.font,
    },
    borderColor: mergeBorderColorPerSide(
      cellDef?.borderColor,
      columnDef?.borderColor,
      outer.borderColor as BorderColor,
      tableDef?.borderColor,
      tableOuterBorder.borderColor
    ),
    borderSize: mergeBorderSizePerSide(
      cellDef?.borderSize,
      columnDef?.borderSize,
      outer.borderSize as BorderSize,
      tableDef?.borderSize,
      tableOuterBorder.borderSize
    ),
    padding: mergePaddingPerSide(
      cellDef?.padding,
      columnDef?.padding,
      tableDef?.padding
    ),
    height: cellDef?.height ?? columnDef?.height ?? tableDef?.height,
  };
}

/**
 * A header cell's resolved properties.
 *
 * Same shape as a body cell with one extra layer — the table's header defaults
 * — and the table border always reaching the top, because the header row is
 * always the table's top edge.
 */
function mergeHeaderCellDefaults(
  tableDef: CellDefaults | undefined,
  headerTableDef: CellDefaults | undefined,
  columnDef: CellDefaults | undefined,
  headerDef: CellDefaults | undefined,
  position: { isFirstCol?: boolean; isLastCol?: boolean },
  tableOuterBorder: { borderColor?: BorderColor; borderSize?: BorderSize },
  theme: ThemeConfig,
  options: TableModelOptions
): MergedCell {
  const defaults = baseDefaults();
  const outer = outerBorderOverride(
    {
      isHeader: true,
      isFirstCol: position.isFirstCol,
      isLastCol: position.isLastCol,
    },
    tableOuterBorder.borderColor,
    tableOuterBorder.borderSize
  );

  return {
    color: resolveCellColor(
      headerDef?.color ??
        headerTableDef?.color ??
        columnDef?.color ??
        tableDef?.color ??
        defaults.color,
      'color',
      theme,
      options
    ),
    backgroundColor: resolveCellColor(
      headerDef?.backgroundColor ??
        headerTableDef?.backgroundColor ??
        columnDef?.backgroundColor ??
        tableDef?.backgroundColor ??
        defaults.backgroundColor,
      'backgroundColor',
      theme,
      options
    ),
    horizontalAlignment:
      headerDef?.horizontalAlignment ??
      headerTableDef?.horizontalAlignment ??
      columnDef?.horizontalAlignment ??
      tableDef?.horizontalAlignment ??
      defaults.horizontalAlignment,
    verticalAlignment:
      headerDef?.verticalAlignment ??
      headerTableDef?.verticalAlignment ??
      columnDef?.verticalAlignment ??
      tableDef?.verticalAlignment ??
      defaults.verticalAlignment,
    font: {
      ...defaults.font,
      ...tableDef?.font,
      ...headerTableDef?.font,
      ...columnDef?.font,
      ...headerDef?.font,
    },
    borderColor: mergeBorderColorPerSide(
      headerDef?.borderColor,
      columnDef?.borderColor,
      outer.borderColor as BorderColor,
      headerTableDef?.borderColor,
      tableDef?.borderColor,
      tableOuterBorder.borderColor
    ),
    borderSize: mergeBorderSizePerSide(
      headerDef?.borderSize,
      columnDef?.borderSize,
      outer.borderSize as BorderSize,
      headerTableDef?.borderSize,
      tableDef?.borderSize,
      tableOuterBorder.borderSize
    ),
    padding: mergePaddingPerSide(
      headerDef?.padding,
      headerTableDef?.padding,
      columnDef?.padding,
      tableDef?.padding
    ),
    height:
      headerDef?.height ??
      headerTableDef?.height ??
      columnDef?.height ??
      tableDef?.height,
  };
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

/**
 * Resolve a whole table.
 *
 * The generic parameters keep the annotation types (`comment`, `revision`) out
 * of this module: it carries them through untouched, so neither the pre-IR
 * writer's docx-shaped types nor the IR's own have to be known here.
 */
export function resolveTableModel<TComment, TRevision, TRowRevision>(
  source: TableSource<TComment, TRevision, TRowRevision>,
  theme: ThemeConfig,
  themeName: string,
  options: TableModelOptions = {}
): ResolvedTable<TComment, TRevision, TRowRevision> {
  const columns = source.columns ?? [];
  const columnCount = columns.length;
  const rowCount = columns[0]?.cells?.length ?? 0;
  const hidden = normalizeHideBorders(source.hideBorders);
  const outerBorder = {
    borderColor: source.borderColor,
    borderSize: source.borderSize,
  };

  /** Which `hideBorders` switch governs one side of one cell. */
  const isHidden = (
    side: 'top' | 'right' | 'bottom' | 'left',
    position: {
      isFirstRow?: boolean;
      isLastRow?: boolean;
      isFirstCol?: boolean;
      isLastCol?: boolean;
    }
  ): boolean => {
    switch (side) {
      case 'top':
        return position.isFirstRow ? hidden.top : hidden.insideHorizontal;
      case 'bottom':
        return position.isLastRow ? hidden.bottom : hidden.insideHorizontal;
      case 'left':
        return position.isFirstCol ? hidden.left : hidden.insideVertical;
      case 'right':
        return position.isLastCol ? hidden.right : hidden.insideVertical;
    }
  };

  const borders = (
    merged: MergedCell,
    position: {
      isFirstRow?: boolean;
      isLastRow?: boolean;
      isFirstCol?: boolean;
      isLastCol?: boolean;
    }
  ): ResolvedSides<ResolvedBorder> => ({
    top: {
      size: merged.borderSize.top,
      color: merged.borderColor.top,
      hidden: isHidden('top', position),
    },
    right: {
      size: merged.borderSize.right,
      color: merged.borderColor.right,
      hidden: isHidden('right', position),
    },
    bottom: {
      size: merged.borderSize.bottom,
      color: merged.borderColor.bottom,
      hidden: isHidden('bottom', position),
    },
    left: {
      size: merged.borderSize.left,
      color: merged.borderColor.left,
      hidden: isHidden('left', position),
    },
  });

  /** The tallest height any cell in a row asked for. */
  const tallest = (heights: (number | undefined)[]): number | undefined =>
    heights.reduce<number | undefined>(
      (max, height) =>
        height === undefined
          ? max
          : max === undefined
            ? height
            : Math.max(max, height),
      undefined
    );

  // -- header row ---------------------------------------------------
  const headerMerges = columns.map((column, colIndex) =>
    mergeHeaderCellDefaults(
      source.cellDefaults,
      source.headerCellDefaults,
      column.cellDefaults,
      column.header,
      { isFirstCol: colIndex === 0, isLastCol: colIndex === columnCount - 1 },
      outerBorder,
      theme,
      options
    )
  );

  const header: ResolvedRow<TComment, TRevision, TRowRevision> = {
    isHeader: true,
    height: tallest(headerMerges.map((m) => m.height)),
    keepNext: source.keepInOnePage === true,
    cells: columns.map((column, colIndex) => {
      const merged = headerMerges[colIndex];
      const position = {
        isFirstRow: true,
        // The header is the last row too when the table has no body.
        isLastRow: rowCount === 0,
        isFirstCol: colIndex === 0,
        isLastCol: colIndex === columnCount - 1,
      };
      return {
        ...(column.header?.content !== undefined
          ? { content: column.header.content }
          : {}),
        ...(column.header?.comment !== undefined
          ? { comment: column.header.comment }
          : {}),
        ...(column.header?.revision !== undefined
          ? { revision: column.header.revision }
          : {}),
        color: merged.color,
        backgroundColor: merged.backgroundColor,
        horizontalAlignment: merged.horizontalAlignment,
        verticalAlignment: merged.verticalAlignment,
        font: merged.font,
        borders: borders(merged, position),
        ...(merged.padding ? { padding: merged.padding } : {}),
      };
    }),
  };

  // -- body rows ----------------------------------------------------
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const isLastRow = rowIndex === rowCount - 1;
    const rowProps = source.rows?.[rowIndex];

    const merges = columns.map((column, colIndex) =>
      mergeCellDefaults(
        source.cellDefaults,
        column.cellDefaults,
        column.cells?.[rowIndex],
        {
          isFirstCol: colIndex === 0,
          isLastCol: colIndex === columnCount - 1,
          isLastRow,
        },
        outerBorder,
        theme,
        options
      )
    );

    const row: ResolvedRow<TComment, TRevision, TRowRevision> = {
      isHeader: false,
      // A height stated on a column or the table applies to a row only where
      // that row actually has a cell; an absent cell contributes nothing.
      height: tallest(
        merges.map((merged, colIndex) =>
          columns[colIndex].cells?.[rowIndex] ? merged.height : undefined
        )
      ),
      keepNext:
        (source.keepInOnePage === true && !isLastRow) ||
        (isLastRow && source.keepNext === true),
      ...(rowProps?.cantSplit !== undefined
        ? { cantSplit: rowProps.cantSplit }
        : {}),
      ...(rowProps?.tableHeader !== undefined
        ? { tableHeader: rowProps.tableHeader }
        : {}),
      ...(rowProps?.revision !== undefined
        ? { revision: rowProps.revision }
        : {}),
      cells: columns.map((column, colIndex) => {
        const cell = column.cells?.[rowIndex];
        const merged = merges[colIndex];
        const position = {
          // Data rows are never the first row; the header is.
          isFirstRow: false,
          isFirstCol: colIndex === 0,
          isLastCol: colIndex === columnCount - 1,
          isLastRow,
        };
        // A row longer than this column keeps the cell — with its borders, so
        // the grid stays closed — but nothing else about it.
        if (!cell) {
          return {
            horizontalAlignment: 'left' as const,
            verticalAlignment: merged.verticalAlignment,
            font: merged.font,
            borders: borders(merged, position),
            missing: true,
          };
        }
        return {
          ...(cell.content !== undefined ? { content: cell.content } : {}),
          ...(cell.comment !== undefined ? { comment: cell.comment } : {}),
          ...(cell.revision !== undefined ? { revision: cell.revision } : {}),
          color: merged.color,
          backgroundColor: merged.backgroundColor,
          horizontalAlignment: merged.horizontalAlignment,
          verticalAlignment: merged.verticalAlignment,
          font: merged.font,
          borders: borders(merged, position),
          ...(merged.padding ? { padding: merged.padding } : {}),
        };
      }),
    };
    return row;
  });

  return {
    ...resolveWidths(source, columns, theme, themeName),
    header,
    rows,
    repeatHeader: source.repeatHeaderOnPageBreak ?? true,
  };
}

/**
 * Column widths and the table's own width.
 *
 * Two modes, and which one applies is decided by whether *any* column states a
 * width. With explicit widths everything is in twips and the table is as wide
 * as its columns; with none, the columns split the table evenly and the table
 * is sized as a percentage of the text column.
 */
function resolveWidths<TComment, TRevision, TRowRevision>(
  source: TableSource<TComment, TRevision, TRowRevision>,
  columns: TableColumnSource<TComment, TRevision>[],
  theme: ThemeConfig,
  themeName: string
): Pick<
  ResolvedTable<TComment, TRevision, TRowRevision>,
  'columnGrid' | 'width' | 'overflow'
> {
  const hasExplicitWidths = columns.some((col) => col.width !== undefined);

  if (!hasExplicitWidths) {
    const share = 100 / columns.length;
    return {
      columnGrid: { unit: 'percent', values: columns.map(() => share) },
      width: { size: source.width ?? 100, unit: 'percent' },
    };
  }

  const available = getAvailableWidthTwips(theme, themeName);
  const stated = columns.map((col) =>
    col.width !== undefined
      ? relativeLengthToTwips(col.width, available)
      : undefined
  );
  const totalStated = stated.reduce<number>((sum, w) => sum + (w ?? 0), 0);
  const unstatedCount = columns.filter((col) => col.width === undefined).length;

  // Whatever the stated columns left over, split between the rest. With every
  // column stated there is nothing to share, so an inch stands in — it is only
  // reached when the value is never used.
  const remaining = Math.max(0, available - totalStated);
  const shareOfRemainder =
    unstatedCount > 0 ? remaining / unstatedCount : pointsToTwips(72);

  const values = stated.map((w) => w || shareOfRemainder);
  return {
    columnGrid: { unit: 'twips', values },
    width: {
      size: values.reduce((sum, w) => sum + w, 0),
      unit: 'twips',
    },
    ...(totalStated > available
      ? { overflow: { totalTwips: totalStated, availableTwips: available } }
      : {}),
  };
}
