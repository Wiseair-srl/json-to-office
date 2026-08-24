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
  CommentRangeEnd,
  CommentRangeStart,
  CommentReference,
  DeletedTextRun,
  EndnoteReferenceRun,
  ExternalHyperlink,
  FootnoteReferenceRun,
  InsertedTextRun,
  InternalHyperlink,
  OverlapType,
  PageNumber,
  Paragraph,
  RelativeHorizontalPosition,
  RelativeVerticalPosition,
  SimpleField,
  StyleLevel,
  Tab,
  Table,
  TableAnchorType,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  TextWrappingType,
  WidthType,
  WpsShapeRun,
  type IFrameOptions,
  type IParagraphOptions,
  type IRunOptions,
  type ITableCellOptions,
  type ParagraphChild,
} from 'docx';
import { assertNever } from '@json-to-office/shared/rendering';
import type {
  DocxIrBlock,
  DocxIrBorder,
  DocxIrFloating,
  DocxIrFrame,
  DocxIrImageRun,
  DocxIrInline,
  DocxIrParagraph,
  DocxIrParagraphFormatting,
  DocxIrParagraphMarkRevision,
  DocxIrRevisionRange,
  DocxIrRunFormatting,
  DocxIrShapeRun,
  DocxIrTable,
  DocxIrTableCell,
  DocxIrTableFloating,
  DocxIrTableOfContents,
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

/**
 * Image runs, keyed by IR resource id.
 *
 * docx.js needs an `ImageRun` object, and building one for a vector image is
 * asynchronous — it rasterises a fallback. So the renderer builds them all
 * before the document, and this layer only places them.
 */
export type EmitResources = ReadonlyMap<string, ImageRunFactory>;

/** Builds the run for one placement, which carries its own size and anchor. */
export type ImageRunFactory = (image: DocxIrImageRun) => ParagraphChild;

/**
 * The field instructions docx.js has a run child for.
 *
 * Anything else would need the begin/instrText/end triple written by hand,
 * which is why an unknown instruction is refused rather than approximated.
 */
const PAGE_FIELD: Readonly<
  Record<string, (typeof PageNumber)[keyof typeof PageNumber]>
> = {
  PAGE: PageNumber.CURRENT,
  NUMPAGES: PageNumber.TOTAL_PAGES,
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
  children: readonly DocxIrInline[],
  resources: EmitResources = new Map()
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
            ...runOptions(child.formatting),
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

      case 'image': {
        const build = resources.get(child.resourceId);
        if (!build) {
          throw new Error(
            `no image was prepared for resource "${child.resourceId}"`
          );
        }
        // A break before an image belongs on a run of its own: docx.js puts a
        // break and a drawing in the same run only by dropping one.
        const pending = breakOption();
        if (pending.break) out.push(new TextRun(pending));
        out.push(build(child));
        break;
      }

      case 'hyperlink':
        out.push(
          child.target.kind === 'bookmark'
            ? new InternalHyperlink({
                children: inlineChildren(
                  child.children,
                  resources
                ) as TextRun[],
                anchor: child.target.anchor,
              })
            : new ExternalHyperlink({
                children: inlineChildren(
                  child.children,
                  resources
                ) as TextRun[],
                link: child.target.url,
              })
        );
        break;

      case 'field': {
        if (child.instruction.startsWith('REF ')) {
          // A REF field is a whole `w:fldSimple`, not a run child, so it goes
          // in as its own element with its cached text inside.
          out.push(new SimpleField(child.instruction, child.cachedText));
          break;
        }
        const page = PAGE_FIELD[child.instruction];
        if (!page) {
          throw new Error(
            `the docxjs renderer has no emitter for the field "${child.instruction}"`
          );
        }
        out.push(
          new TextRun({
            children: [page],
            ...runOptions(child.formatting),
            ...breakOption(),
          })
        );
        break;
      }

      case 'revision':
        out.push(...emitRevision(child, breakOption()));
        break;

      case 'commentRangeStart':
        out.push(new CommentRangeStart(child.id));
        break;

      case 'commentRangeEnd':
        out.push(new CommentRangeEnd(child.id));
        break;

      case 'commentReference':
        // `w:commentReference` is run-inner content, so it has to sit inside a
        // `w:r`. Emitted as a direct child of `w:p` it is schema-invalid and
        // readers drop the comment without saying so.
        out.push(new TextRun({ children: [new CommentReference(child.id)] }));
        break;

      case 'shape':
        out.push(emitShape(child, resources));
        break;

      case 'drawingGroup':
        // Unreachable: docx.js declines `drawing-groups`, so the capability
        // gate refuses the document before any adapter is asked to emit one.
        throw new Error(
          'the docxjs renderer has no emitter for a drawing group; ' +
            'this document should have been refused by the capability check'
        );

      case 'chart':
        // Unreachable for the same reason as a drawing group: docx.js has no
        // chart primitive, declines `charts`, and the capability gate refuses
        // the document before this adapter is asked for one.
        throw new Error(
          'the docxjs renderer has no emitter for a chart; ' +
            'this document should have been refused by the capability check'
        );

      case 'noteReference':
        out.push(
          child.noteKind === 'endnote'
            ? new EndnoteReferenceRun(child.id)
            : new FootnoteReferenceRun(child.id)
        );
        break;

      default:
        assertNever(child, 'DocxIrInline');
    }
  }

  return out;
}

/**
 * A tracked change, as runs marked with its id.
 *
 * Every text child becomes a run carrying the range's `w:ins` / `w:del`
 * attributes: docx.js has no wrapper element, so the mark rides on the runs.
 */
function emitRevision(
  range: DocxIrRevisionRange,
  pending: { break?: number }
): ParagraphChild[] {
  const mark = {
    id: range.id,
    author: range.author,
    date: range.date,
  };
  const out: ParagraphChild[] = [];
  let breaks = pending.break ?? 0;

  for (const child of range.children) {
    if (child.kind === 'lineBreak') {
      breaks += 1;
      continue;
    }
    if (child.kind !== 'text') {
      throw new Error(
        `the docxjs renderer has no emitter for "${child.kind}" inside a revision`
      );
    }
    const options = {
      text: child.text,
      ...runOptions(child.formatting),
      ...(breaks > 0 ? { break: breaks } : {}),
      ...mark,
    };
    breaks = 0;
    out.push(
      range.type === 'insert'
        ? new InsertedTextRun(options)
        : new DeletedTextRun(options)
    );
  }

  return out;
}

/** docx.js numbers its wrap types; OOXML names them. */
const WRAP_TYPE: Readonly<
  Record<string, (typeof TextWrappingType)[keyof typeof TextWrappingType]>
> = {
  none: TextWrappingType.NONE,
  square: TextWrappingType.SQUARE,
  tight: TextWrappingType.TIGHT,
  topAndBottom: TextWrappingType.TOP_AND_BOTTOM,
};

/** An IR anchor as docx.js floating options. */
export function floatingOptions(
  floating: DocxIrFloating
): Record<string, unknown> {
  return {
    ...(floating.horizontal
      ? {
          horizontalPosition: {
            ...(floating.horizontal.relativeTo
              ? { relative: floating.horizontal.relativeTo }
              : {}),
            ...(floating.horizontal.align !== undefined
              ? { align: floating.horizontal.align }
              : {}),
            ...(floating.horizontal.offsetEmu !== undefined
              ? { offset: floating.horizontal.offsetEmu }
              : {}),
          },
        }
      : {}),
    ...(floating.vertical
      ? {
          verticalPosition: {
            ...(floating.vertical.relativeTo
              ? { relative: floating.vertical.relativeTo }
              : {}),
            ...(floating.vertical.align !== undefined
              ? { align: floating.vertical.align }
              : {}),
            ...(floating.vertical.offsetEmu !== undefined
              ? { offset: floating.vertical.offsetEmu }
              : {}),
          },
        }
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

/**
 * A native text box, as a `wps:wsp` shape run.
 *
 * docx 9.7.1 emits `a:noFill` + `a:ln` for an outline and then `a:solidFill`
 * for the fill — two fill groups, in the wrong order for CT_ShapeProperties,
 * which Word rejects. The compiler resolves that conflict before it gets here,
 * so a shape never arrives with both.
 */
function emitShape(
  shape: DocxIrShapeRun,
  resources: EmitResources
): ParagraphChild {
  return new WpsShapeRun({
    type: 'wps',
    children: shape.children.map((child) => emitParagraph(child, resources)),
    transformation: { width: shape.widthPx, height: shape.heightPx },
    ...(shape.fill
      ? { solidFill: { type: 'rgb', value: shape.fill.hex } as const }
      : {}),
    ...(shape.outline
      ? {
          outline: {
            type: 'solidFill' as const,
            solidFillType: 'rgb' as const,
            value: shape.outline.color.hex,
            ...(shape.outline.widthEmu !== undefined
              ? { width: shape.outline.widthEmu }
              : {}),
          },
        }
      : {}),
    ...(shape.insetsEmu
      ? { bodyProperties: { margins: shape.insetsEmu } }
      : {}),
    ...(shape.floating ? { floating: floatingOptions(shape.floating) } : {}),
  } as ConstructorParameters<typeof WpsShapeRun>[0]);
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

export function emitParagraph(
  block: DocxIrParagraph,
  resources: EmitResources = new Map()
): Paragraph {
  return new Paragraph({
    children: inlineChildren(block.children, resources),
    // A paragraph with no style named is one that deliberately has none — a
    // table cell, whose run properties come from the cell itself.
    ...(block.styleId ? { style: block.styleId } : {}),
    ...paragraphOptions(block.formatting),
    ...(block.markRevision ? { run: revisionMark(block.markRevision) } : {}),
    ...(block.frame ? { frame: frameOptions(block.frame) } : {}),
    ...(block.numbering
      ? {
          numbering: block.numbering.none
            ? // docx.js writes `numId 0` for a literal false, which is how a
              // paragraph detaches from the numbering its style applies.
              (false as const)
            : {
                reference: block.numbering.reference,
                level: block.numbering.level,
              },
        }
      : {}),
  });
}

/**
 * A paragraph positioned as a floating box (`w:framePr`).
 *
 * Exactly one positioning mode: absolute when the frame states coordinates,
 * alignment otherwise. OOXML cannot mix them, and docx.js takes the choice as
 * a discriminant.
 */
function frameOptions(frame: DocxIrFrame): IFrameOptions {
  const base = {
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

  return (
    frame.xTwips !== undefined || frame.yTwips !== undefined
      ? {
          type: 'absolute',
          position: { x: frame.xTwips ?? 0, y: frame.yTwips ?? 0 },
          ...base,
        }
      : {
          type: 'alignment',
          alignment: { x: frame.xAlign, y: frame.yAlign },
          ...base,
        }
  ) as IFrameOptions;
}

export function emitBlock(
  block: DocxIrBlock,
  resources: EmitResources = new Map()
): Paragraph | Table | TableOfContents {
  switch (block.kind) {
    case 'paragraph':
      return emitParagraph(block, resources);
    case 'table':
      return emitTable(block, resources);
    case 'toc':
      return emitToc(block);
    default:
      return assertNever(block, 'DocxIrBlock');
  }
}

/* ------------------------------------------------------------------ *
 * Table of contents
 * ------------------------------------------------------------------ */

/**
 * The TOC field.
 *
 * A top-level block, not a paragraph child: wrapping it in a paragraph makes
 * Word draw an empty structured-document-tag above the entries.
 */
function emitToc(block: DocxIrTableOfContents): TableOfContents {
  return new TableOfContents(block.alias ?? 'Table of Contents', {
    ...(block.hyperlink !== undefined ? { hyperlink: block.hyperlink } : {}),
    ...(block.headingRange
      ? {
          headingStyleRange: `${block.headingRange.from}-${block.headingRange.to}`,
        }
      : {}),
    stylesWithLevels: (block.styleLevels ?? []).map(
      (style) => new StyleLevel(style.styleName, style.level)
    ),
    entriesFromBookmark: block.bookmarkScope,
    ...(block.omitPageNumbersForLevels?.length
      ? {
          pageNumbersEntryLevelsRange: block.omitPageNumbersForLevels
            .map((range) => `${range.from}-${range.to}`)
            .join(','),
        }
      : {}),
    ...(block.entrySeparator !== undefined
      ? { entryAndPageNumberSeparator: block.entrySeparator }
      : {}),
    ...(block.cachedEntries?.length
      ? {
          cachedEntries: block.cachedEntries.map((entry) => ({
            title: entry.text,
            level: entry.level,
          })),
        }
      : {}),
  });
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

export function emitTable(
  block: DocxIrTable,
  resources: EmitResources = new Map()
): Table {
  return new Table({
    width: {
      size: block.width.kind === 'auto' ? 0 : block.width.value,
      type: block.width.kind === 'twips' ? WidthType.DXA : WidthType.PERCENTAGE,
    },
    layout:
      block.layout === 'fixed'
        ? TableLayoutType.FIXED
        : TableLayoutType.AUTOFIT,
    // An empty grid is a table with nothing to say about its columns, which is
    // not the same as one whose columns are all zero wide.
    ...(block.columnGrid.values.length > 0
      ? { columnWidths: block.columnGrid.values }
      : {}),
    ...(block.borders
      ? {
          borders: {
            top: emitBorder(block.borders.top),
            right: emitBorder(block.borders.right),
            bottom: emitBorder(block.borders.bottom),
            left: emitBorder(block.borders.left),
            insideHorizontal: emitBorder(block.borders.insideHorizontal),
            insideVertical: emitBorder(block.borders.insideVertical),
          },
        }
      : {}),
    ...(block.floating ? { float: tableFloat(block.floating) } : {}),
    rows: block.rows.map((row) => emitTableRow(row, resources)),
  });
}

const TABLE_ANCHOR: Readonly<
  Record<string, (typeof TableAnchorType)[keyof typeof TableAnchorType]>
> = {
  margin: TableAnchorType.MARGIN,
  page: TableAnchorType.PAGE,
  text: TableAnchorType.TEXT,
};

const HORIZONTAL_POSITION: Readonly<
  Record<
    string,
    (typeof RelativeHorizontalPosition)[keyof typeof RelativeHorizontalPosition]
  >
> = {
  left: RelativeHorizontalPosition.LEFT,
  center: RelativeHorizontalPosition.CENTER,
  right: RelativeHorizontalPosition.RIGHT,
  inside: RelativeHorizontalPosition.INSIDE,
  outside: RelativeHorizontalPosition.OUTSIDE,
};

const VERTICAL_POSITION: Readonly<
  Record<
    string,
    (typeof RelativeVerticalPosition)[keyof typeof RelativeVerticalPosition]
  >
> = {
  top: RelativeVerticalPosition.TOP,
  center: RelativeVerticalPosition.CENTER,
  bottom: RelativeVerticalPosition.BOTTOM,
  inside: RelativeVerticalPosition.INSIDE,
  outside: RelativeVerticalPosition.OUTSIDE,
};

/** Where a floating table sits, in the vocabulary docx.js takes. */
function tableFloat(floating: DocxIrTableFloating): Record<string, unknown> {
  return {
    ...(floating.horizontalAnchor
      ? { horizontalAnchor: TABLE_ANCHOR[floating.horizontalAnchor] }
      : {}),
    ...(floating.verticalAnchor
      ? { verticalAnchor: TABLE_ANCHOR[floating.verticalAnchor] }
      : {}),
    ...(floating.absoluteHorizontalPositionTwips !== undefined
      ? {
          absoluteHorizontalPosition: floating.absoluteHorizontalPositionTwips,
        }
      : {}),
    ...(floating.relativeHorizontalPosition
      ? {
          relativeHorizontalPosition:
            HORIZONTAL_POSITION[floating.relativeHorizontalPosition],
        }
      : {}),
    ...(floating.absoluteVerticalPositionTwips !== undefined
      ? { absoluteVerticalPosition: floating.absoluteVerticalPositionTwips }
      : {}),
    ...(floating.relativeVerticalPosition
      ? {
          relativeVerticalPosition:
            VERTICAL_POSITION[floating.relativeVerticalPosition],
        }
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
    ...(floating.overlap
      ? {
          overlap:
            floating.overlap === 'never'
              ? OverlapType.NEVER
              : OverlapType.OVERLAP,
        }
      : {}),
  };
}

function emitTableRow(row: DocxIrTableRow, resources: EmitResources): TableRow {
  return new TableRow({
    children: row.cells.map((cell) => emitTableCell(cell, resources)),
    ...(row.heightTwips !== undefined
      ? {
          height: { value: row.heightTwips, rule: row.heightRule ?? 'atLeast' },
        }
      : {}),
    ...(row.isHeader !== undefined ? { tableHeader: row.isHeader } : {}),
    ...(row.cantSplit !== undefined ? { cantSplit: row.cantSplit } : {}),
    ...(row.revision ? revisionMark(row.revision) : {}),
  });
}

/** `w:trPr/w:ins` or `w:trPr/w:del` — the row itself was inserted or deleted. */
function revisionMark(revision: DocxIrParagraphMarkRevision): {
  insertion?: { id: number; author: string; date: string };
  deletion?: { id: number; author: string; date: string };
} {
  const attributes = {
    id: revision.id,
    author: revision.author,
    date: revision.date,
  };
  return revision.type === 'insert'
    ? { insertion: attributes }
    : { deletion: attributes };
}

function emitTableCell(
  cell: DocxIrTableCell,
  resources: EmitResources
): TableCell {
  const options: Record<string, unknown> = {
    children: cell.children.map((child) => emitBlock(child, resources)),
  };

  if (cell.widthTwips !== undefined) {
    options.width = { size: cell.widthTwips, type: WidthType.DXA };
  }
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
