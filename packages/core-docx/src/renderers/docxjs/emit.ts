/**
 * DocxIR → docx.js objects.
 *
 * Each function maps one IR node onto the option bag docx.js expects. Every
 * cascade, default and unit conversion already happened in the compiler, so
 * this layer only translates vocabulary — with two exceptions that are
 * genuinely properties of *this* backend:
 *
 * - A line break is not a node here. docx.js expresses it as `break: 1` on the
 *   run that follows, so a `lineBreak` in the IR is folded into the next run.
 * - A tab is a run containing a `Tab`, because a tab character inside `<w:t>`
 *   is dropped by Word and paragraph tab stops only bind to real tab runs.
 */

import {
  AlignmentType,
  BookmarkEnd,
  BookmarkStart,
  BorderStyle,
  ColumnBreak,
  Paragraph,
  Tab,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
  type ITableCellOptions,
  type ParagraphChild,
} from 'docx';
import { assertNever } from '@json-to-office/shared/rendering';
import type {
  DocxIrBlock,
  DocxIrBorder,
  DocxIrInline,
  DocxIrParagraph,
  DocxIrParagraphFormatting,
  DocxIrRunFormatting,
  DocxIrTable,
  DocxIrTableCell,
  DocxIrTableRow,
} from '../../ir/types';

export const ALIGNMENT: Readonly<
  Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]>
> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justified: AlignmentType.JUSTIFIED,
  start: AlignmentType.START,
  end: AlignmentType.END,
};

/* ------------------------------------------------------------------ *
 * Runs
 * ------------------------------------------------------------------ */

export function runOptions(
  formatting: DocxIrRunFormatting | undefined
): IRunOptions {
  if (!formatting) return {};
  const options: Record<string, unknown> = {};
  if (formatting.fontFamily) options.font = formatting.fontFamily;
  if (formatting.sizeHalfPoints !== undefined) {
    options.size = formatting.sizeHalfPoints;
  }
  if (formatting.color) options.color = formatting.color.hex;
  if (formatting.bold !== undefined) options.bold = formatting.bold;
  if (formatting.italic !== undefined) options.italics = formatting.italic;
  if (formatting.underline !== undefined) {
    options.underline = formatting.underline
      ? { type: formatting.underline.type }
      : undefined;
  }
  if (formatting.strike !== undefined) options.strike = formatting.strike;
  if (formatting.scalePercent !== undefined) {
    options.scale = formatting.scalePercent;
  }
  if (formatting.characterSpacingTwentieths !== undefined) {
    options.characterSpacing = formatting.characterSpacingTwentieths;
  }
  if (formatting.language) {
    options.language = { value: formatting.language };
  }
  if (formatting.noProof !== undefined) options.noProof = formatting.noProof;
  return options as IRunOptions;
}

/**
 * Turn inline nodes into paragraph children.
 *
 * `pendingBreaks` carries a run of `lineBreak` nodes forward onto whichever run
 * comes next, which is where docx.js puts them.
 */
export function inlineChildren(
  children: readonly DocxIrInline[]
): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  let pendingBreaks = 0;

  const breakOption = (): { break?: number } => {
    if (pendingBreaks === 0) return {};
    const value = { break: pendingBreaks };
    pendingBreaks = 0;
    return value;
  };

  for (const child of children) {
    switch (child.kind) {
      case 'lineBreak':
        pendingBreaks += 1;
        break;

      case 'text':
        out.push(
          new TextRun({
            text: child.text,
            ...runOptions(child.formatting),
            ...breakOption(),
          })
        );
        break;

      case 'tab':
        out.push(
          new TextRun({
            children: [new Tab()],
            ...breakOption(),
          })
        );
        break;

      case 'columnBreak':
        out.push(new ColumnBreak());
        break;

      case 'pageBreak':
        out.push(new TextRun({ break: 1 }));
        break;

      case 'bookmarkStart':
        out.push(new BookmarkStart(child.name, child.id));
        break;

      case 'bookmarkEnd':
        out.push(new BookmarkEnd(child.id));
        break;

      case 'image':
      case 'hyperlink':
      case 'field':
      case 'noteReference':
      case 'commentRangeStart':
      case 'commentRangeEnd':
      case 'commentReference':
      case 'revision':
        // Reachable only if capability checking let it through, which would be
        // a bug — never a silent drop.
        throw new Error(
          `the docxjs renderer has no emitter for inline "${child.kind}"`
        );

      default:
        assertNever(child, 'DocxIrInline');
    }
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Paragraphs
 * ------------------------------------------------------------------ */

export function paragraphOptions(
  formatting: DocxIrParagraphFormatting | undefined
): Partial<IParagraphOptions> {
  const options: Record<string, unknown> = {};
  if (!formatting) return options as Partial<IParagraphOptions>;

  if (formatting.alignment) {
    options.alignment = ALIGNMENT[formatting.alignment];
  }
  if (formatting.spacing) {
    const spacing: Record<string, unknown> = {};
    if (formatting.spacing?.beforeTwips !== undefined) {
      spacing.before = formatting.spacing.beforeTwips;
    }
    if (formatting.spacing?.afterTwips !== undefined) {
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
    options.spacing = spacing;
  }
  if (formatting.indent) {
    const indent: Record<string, unknown> = {};
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
    options.indent = indent;
  }
  if (formatting.tabStops) {
    options.tabStops = formatting.tabStops.map((stop) => ({
      position: stop.positionTwips,
      type: stop.type,
      ...(stop.leader ? { leader: stop.leader } : {}),
    }));
  }
  if (formatting.keepNext !== undefined) options.keepNext = formatting.keepNext;
  if (formatting.keepLines !== undefined) {
    options.keepLines = formatting.keepLines;
  }
  if (formatting.outlineLevel !== undefined) {
    options.outlineLevel = formatting.outlineLevel;
  }

  return options as Partial<IParagraphOptions>;
}

export function emitParagraph(block: DocxIrParagraph): Paragraph {
  return new Paragraph({
    children: inlineChildren(block.children),
    // A paragraph with no style named is one that deliberately has none — a
    // table cell, whose run properties come from the cell itself.
    ...(block.styleId ? { style: block.styleId } : {}),
    ...paragraphOptions(block.formatting),
    ...(block.numbering
      ? {
          numbering: block.numbering.none
            ? // An empty reference is how docx.js is told to suppress the
              // numbering a style would otherwise apply.
              { reference: '', level: 0, instance: 0 }
            : {
                reference: block.numbering.reference,
                level: block.numbering.level,
              },
        }
      : {}),
  });
}

export function emitBlock(block: DocxIrBlock): Paragraph | Table {
  switch (block.kind) {
    case 'paragraph':
      return emitParagraph(block);
    case 'table':
      return emitTable(block);
    case 'toc':
      throw new Error(
        `the docxjs renderer has no emitter for "${block.kind}" (${block.path})`
      );
    default:
      return assertNever(block, 'DocxIrBlock');
  }
}

/* ------------------------------------------------------------------ *
 * Tables
 * ------------------------------------------------------------------ */

const VERTICAL_ALIGN: Readonly<
  Record<string, (typeof VerticalAlign)[keyof typeof VerticalAlign]>
> = {
  top: VerticalAlign.TOP,
  center: VerticalAlign.CENTER,
  bottom: VerticalAlign.BOTTOM,
};

export function emitTable(block: DocxIrTable): Table {
  return new Table({
    width: {
      size: block.width.kind === 'auto' ? 0 : block.width.value,
      type: block.width.kind === 'twips' ? WidthType.DXA : WidthType.PERCENTAGE,
    },
    layout:
      block.layout === 'fixed'
        ? TableLayoutType.FIXED
        : TableLayoutType.AUTOFIT,
    columnWidths: block.columnGrid.values,
    rows: block.rows.map(emitTableRow),
  });
}

function emitTableRow(row: DocxIrTableRow): TableRow {
  return new TableRow({
    children: row.cells.map(emitTableCell),
    ...(row.heightTwips !== undefined
      ? {
          height: { value: row.heightTwips, rule: row.heightRule ?? 'atLeast' },
        }
      : {}),
    ...(row.isHeader !== undefined ? { tableHeader: row.isHeader } : {}),
    ...(row.cantSplit !== undefined ? { cantSplit: row.cantSplit } : {}),
  });
}

function emitTableCell(cell: DocxIrTableCell): TableCell {
  const options: Record<string, unknown> = {
    children: cell.children.map(emitBlock),
  };

  if (cell.verticalAlign) {
    options.verticalAlign = VERTICAL_ALIGN[cell.verticalAlign];
  }
  if (cell.shading) options.shading = { fill: cell.shading.fill.hex };
  if (cell.margins) {
    options.margins = {
      // Stated in twips, which docx.js only believes if told the unit.
      marginUnitType: WidthType.DXA,
      top: cell.margins.topTwips ?? 0,
      bottom: cell.margins.bottomTwips ?? 0,
      left: cell.margins.leftTwips ?? 0,
      right: cell.margins.rightTwips ?? 0,
    };
  }
  if (cell.borders) {
    options.borders = {
      top: emitBorder(cell.borders.top),
      bottom: emitBorder(cell.borders.bottom),
      left: emitBorder(cell.borders.left),
      right: emitBorder(cell.borders.right),
    };
  }
  if (cell.columnSpan !== undefined) options.columnSpan = cell.columnSpan;
  if (cell.rowSpan !== undefined) options.verticalMerge = cell.rowSpan;

  return new TableCell(options as unknown as ITableCellOptions);
}

const BORDER_STYLE: Readonly<
  Record<string, (typeof BorderStyle)[keyof typeof BorderStyle]>
> = {
  none: BorderStyle.NONE,
  single: BorderStyle.SINGLE,
  double: BorderStyle.DOUBLE,
  dashed: BorderStyle.DASHED,
  dotted: BorderStyle.DOTTED,
};

function emitBorder(border: DocxIrBorder | undefined) {
  if (!border) return undefined;
  return {
    style: BORDER_STYLE[border.style] ?? BorderStyle.SINGLE,
    size: border.sizeEighthPoints ?? 0,
    color: border.color?.hex ?? '000000',
  };
}
