/**
 * The option bags, where the two backends disagree about units or spelling.
 *
 * `emit.ts` builds plain objects rather than the backend's declared types on
 * purpose — typing them would put an optional peer dependency into this
 * package's published `.d.ts` and break every consumer without it. The cost is
 * no compile-time check that a field is named and scaled the way the backend
 * reads it, so the places where the two libraries differ are pinned here
 * instead. Each of these was a real defect first.
 */

import { describe, expect, it } from 'vitest';
import {
  block,
  emptyContext,
  floatingOptions,
  inlineChildren,
  numberingConfig,
  paragraphProperties,
  runProperties,
  section,
  type EmitContext,
} from '../emit';
import { emitStyles } from '../styles';
import type {
  DocxIrBlock,
  DocxIrShapeRun,
  DocxIrTable,
  DocxIrTableOfContents,
} from '../../../ir/types';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

/** A context with one prepared PNG resource, `res1`. */
function pngContext(): EmitContext {
  return {
    ...emptyContext(),
    pictures: new Map([
      [
        'res1',
        () => ({ type: 'png', data: PNG_BYTES, fileName: 'res1-1x1.png' }),
      ],
    ]),
  };
}

/** The `wp:docPr` id each emitted drawing states. */
function drawingIds(emitted: Record<string, unknown>[]): string[] {
  return emitted
    .map((entry) => entry.picture ?? entry.wpgGroup)
    .filter(Boolean)
    .map(
      (drawing) =>
        ((drawing as Record<string, any>).altText as { id: string }).id
    );
}

describe('run properties', () => {
  it('states size in points, because the backend doubles it', () => {
    // docx.js takes half-points and writes them through; this backend takes
    // points and writes `size * 2`. Passing half-points would set every run at
    // twice the intended size.
    expect(runProperties({ sizeHalfPoints: 22 })).toMatchObject({ size: 11 });
  });

  it('spells the italic flag without the docx.js plural', () => {
    expect(runProperties({ italic: true })).toMatchObject({ italic: true });
    expect(runProperties({ bold: false })).toMatchObject({ bold: false });
  });

  it('gives size, bold and italic the complex-script twins docx.js adds', () => {
    // docx.js writes `w:szCs`, `w:bCs` and `w:iCs` beside the Latin property
    // on its own; this backend writes only what it is given, so Arabic or
    // Hebrew kept the default size, weight and slant. An `off` is doubled too.
    expect(
      runProperties({ sizeHalfPoints: 21, bold: false, italic: true })
    ).toMatchObject({
      size: 10.5,
      sizeComplexScript: 10.5,
      bold: false,
      boldComplexScript: false,
      italic: true,
      italicComplexScript: true,
    });
  });

  it('adds no twin docx.js would leave out', () => {
    // No twin for an unstated property, nor for a zero size: docx.js tests
    // the size for truth before writing `w:szCs`.
    const out = runProperties({ sizeHalfPoints: 0, color: { hex: '000000' } });
    expect(out).not.toHaveProperty('sizeComplexScript');
    expect(out).not.toHaveProperty('boldComplexScript');
    expect(out).not.toHaveProperty('italicComplexScript');
  });

  it('keeps character spacing in twentieths of a point', () => {
    expect(runProperties({ characterSpacingTwentieths: -20 })).toMatchObject({
      characterSpacing: -20,
    });
  });

  it('carries colour, underline and proofing language', () => {
    expect(
      runProperties({
        color: { hex: 'FF0000' },
        underline: { type: 'single', color: { hex: '00FF00' } },
        language: 'en-GB',
        noProof: true,
      })
    ).toMatchObject({
      color: 'FF0000',
      underline: { type: 'single', color: '00FF00' },
      language: { value: 'en-GB' },
      noProof: true,
    });
  });
});

describe('paragraph properties', () => {
  it('spells justified alignment the way OOXML does', () => {
    expect(paragraphProperties({ alignment: 'justified' })).toMatchObject({
      alignment: 'both',
    });
    expect(paragraphProperties({ alignment: 'center' })).toMatchObject({
      alignment: 'center',
    });
  });

  it('keeps a line rule that states no height', () => {
    expect(
      paragraphProperties({ spacing: { lineRule: 'atLeast' } })
    ).toMatchObject({ spacing: { lineRule: 'atLeast' } });
  });
});

describe('inline children', () => {
  it('folds line breaks onto the run that follows', () => {
    expect(
      inlineChildren([
        { kind: 'lineBreak' },
        { kind: 'lineBreak' },
        { kind: 'text', text: 'after' },
      ])
    ).toEqual([{ text: 'after', break: 2 }]);
  });

  it('gives a break before a drawing a run of its own', () => {
    const emitted = inlineChildren(
      [
        { kind: 'lineBreak' },
        { kind: 'image', resourceId: 'res1', widthEmu: 100, heightEmu: 100 },
      ],
      pngContext()
    );

    expect(emitted).toEqual([
      { break: 1 },
      {
        picture: {
          type: 'png',
          data: PNG_BYTES,
          transformation: { width: 100, height: 100 },
          altText: { id: '1' },
        },
      },
    ]);
  });

  it('numbers each drawing in document order', () => {
    const ctx = pngContext();
    const image = {
      kind: 'image' as const,
      resourceId: 'res1',
      widthEmu: 100,
      heightEmu: 100,
    };

    // A `wp:docPr` id left to the backend's module-level counter would keep
    // climbing across documents; these restart with the context.
    expect(drawingIds(inlineChildren([image, image], ctx))).toEqual(['1', '2']);
    expect(
      drawingIds(
        inlineChildren([image], { ...emptyContext(), pictures: ctx.pictures })
      )
    ).toEqual(['1']);
  });

  it('wraps a revision once rather than marking every run', () => {
    // docx.js has no wrapper element, so it copies the id onto each run. This
    // backend has one, which is why the id appears once.
    expect(
      inlineChildren([
        {
          kind: 'revision',
          type: 'insert',
          id: 7,
          author: 'A',
          date: '1970-01-01T00:00:00Z',
          children: [
            { kind: 'text', text: 'one' },
            { kind: 'text', text: 'two' },
          ],
        },
      ])
    ).toEqual([
      {
        insertion: {
          id: 7,
          author: 'A',
          date: '1970-01-01T00:00:00Z',
          children: [{ text: 'one' }, { text: 'two' }],
        },
      },
    ]);
  });

  it('writes any field as a simple field with its cached result', () => {
    expect(
      inlineChildren([
        { kind: 'field', instruction: 'PAGE', cachedText: '3' },
        { kind: 'field', instruction: 'REF _Ref1 \\h' },
      ])
    ).toEqual([
      { simpleField: { instruction: 'PAGE', cachedValue: '3' } },
      { simpleField: { instruction: 'REF _Ref1 \\h' } },
    ]);
  });

  it('splits a hyperlink by target kind', () => {
    expect(
      inlineChildren([
        {
          kind: 'hyperlink',
          target: { kind: 'bookmark', anchor: 'intro' },
          children: [{ kind: 'text', text: 'go' }],
        },
      ])
    ).toEqual([{ hyperlink: { anchor: 'intro', children: [{ text: 'go' }] } }]);
  });
});

describe('native text boxes', () => {
  const textBox = (extra: Partial<DocxIrShapeRun> = {}): DocxIrShapeRun => ({
    kind: 'shape',
    widthPx: 240,
    heightPx: 90,
    children: [{ kind: 'paragraph', id: 'p', path: 'p', children: [] }],
    ...extra,
  });

  /** The `wps:wsp` options a lone text box run emits. */
  const shapeOf = (shape: DocxIrShapeRun): Record<string, any> =>
    (inlineChildren([shape])[0] as Record<string, any>).wpsShape;

  it('names text insets the way `a:bodyPr` does', () => {
    // The backend reads `lIns`/`tIns`/`rIns`/`bIns` (or a `margins` object).
    // It has no `*Inset` key anywhere, so the padding on every shape-mode text
    // box was accepted here and then dropped on the way out — silently, and
    // only on this backend.
    expect(
      shapeOf(textBox({ insetsEmu: { top: 1, bottom: 2, left: 3, right: 4 } }))
        .bodyProperties
    ).toEqual({ lIns: 3, tIns: 1, rIns: 4, bIns: 2 });
  });

  it('states no body properties when there are no insets', () => {
    expect(shapeOf(textBox())).not.toHaveProperty('bodyProperties');
  });

  it('puts the outline colour on the outline, not under a `fill`', () => {
    // `OutlineOptions` is line properties and fill properties merged into one
    // bag; a nested `fill` is ignored, which drew every border in the default
    // colour rather than the authored one.
    expect(
      shapeOf(
        textBox({
          outline: { color: { hex: 'CC0000' }, widthEmu: 19050 },
        })
      ).outline
    ).toEqual({
      width: 19050,
      type: 'solidFill',
      color: { value: 'CC0000' },
    });
  });
});

describe('tables', () => {
  const table: DocxIrTable = {
    kind: 'table',
    id: 't',
    path: 'sections[0].children[0]',
    rows: [
      {
        cells: [
          {
            children: [],
            rowSpan: 'restart',
            margins: { topTwips: 60, leftTwips: 120 },
            widthTwips: 2400,
          },
        ],
      },
    ],
    columnGrid: { unit: 'twips', values: [2400] },
    width: { kind: 'percent', value: 100 },
    layout: 'fixed',
  };

  it('states cell margins as sized widths, not values', () => {
    const emitted = block(table).table as Record<string, never>;
    const cell = (emitted.rows as never[])[0]['cells' as never][0];

    expect(cell).toMatchObject({
      margins: {
        top: { size: 60, type: 'dxa' },
        left: { size: 120, type: 'dxa' },
      },
      width: { size: 2400, type: 'dxa' },
      // The IR's vertical merge is already the backend's vocabulary.
      verticalMerge: 'restart',
    });
  });

  it('names the width unit the backend expects', () => {
    expect(block(table).table).toMatchObject({
      width: { size: 100, type: 'pct' },
      layout: 'fixed',
      columnWidths: [2400],
    });
  });

  it('closes a cell on an empty paragraph unless it ends on one, as docx.js does', () => {
    // The backend takes a nested table as a cell's last block, and a cell
    // ending on one is what LibreOffice misread in the cover band (#468).
    const paragraph = (text: string) => ({
      kind: 'paragraph' as const,
      id: text,
      path: text,
      children: [{ kind: 'text' as const, text }],
    });
    const cells = [[paragraph('a')], [paragraph('b'), table], []].map(
      (children) => ({ children })
    );
    const emitted = block({ ...table, rows: [{ cells }] }).table as {
      rows: Array<{ cells: Array<{ children: unknown[] }> }>;
    };
    const [flat, nested, empty] = emitted.rows[0].cells.map(
      (cell) => cell.children
    );

    const closing = { paragraph: { children: [] } };
    expect(flat).toHaveLength(1);
    expect(nested).toHaveLength(3);
    expect(nested[1]).toHaveProperty('table');
    expect(nested[2]).toEqual(closing);
    expect(empty).toEqual([closing]);
  });

  it('spells every stated cell border side and leaves the table bare', () => {
    // The table model already adjudicated the borders: every cell states all
    // four sides — `none` included — and facing halves of a shared edge agree
    // (see `core/tableModel.ts`), so neither Word nor LibreOffice is left a
    // conflict to resolve. The backend's whole job is spelling each side as
    // `{style, size, color}` with the size already in eighths. The table
    // itself states no borders, and none may be invented for it: docx.js
    // writes its default single/auto/sz-4 `w:tblBorders` there while this
    // backend writes none — a recorded difference (see
    // docs/architecture/office-renderer-ir.md) that no reader can see, since
    // the fully-stated cells shadow the table everywhere.
    const bordered: DocxIrTable = {
      ...table,
      rows: [
        {
          cells: [
            {
              children: [],
              borders: {
                top: {
                  style: 'none',
                  sizeEighthPoints: 0,
                  color: { hex: '000000' },
                },
                bottom: {
                  style: 'single',
                  sizeEighthPoints: 4,
                  color: { hex: 'EF4130' },
                },
                left: {
                  style: 'none',
                  sizeEighthPoints: 0,
                  color: { hex: '000000' },
                },
                right: {
                  style: 'single',
                  sizeEighthPoints: 4,
                  color: { hex: 'C7C8CA' },
                },
              },
            },
          ],
        },
      ],
    };

    const emitted = block(bordered).table as Record<string, never>;
    expect(emitted['borders' as never]).toBeUndefined();
    expect((emitted.rows as never[])[0]['cells' as never][0]).toMatchObject({
      borders: {
        top: { style: 'none', size: 0, color: '000000' },
        bottom: { style: 'single', size: 4, color: 'EF4130' },
        left: { style: 'none', size: 0, color: '000000' },
        right: { style: 'single', size: 4, color: 'C7C8CA' },
      },
    });
  });

  it('hands a table of contents in a cell over as its entries between markers', () => {
    // The backend drops a cell child that is neither a paragraph nor a table,
    // so the field is put around these entries once the package exists
    // (`cellTocs.ts`). A cell that ends on one still ends on a paragraph, as
    // docx.js ends it; one that goes on past it needs none.
    const toc: DocxIrTableOfContents = {
      kind: 'toc',
      id: 'toc',
      path: 'sections[0].children[0].rows[0].cells[0].children[0]',
      alias: 'Contents',
      headingRange: { from: 1, to: 2 },
      hyperlink: true,
      cachedEntries: [
        { text: 'Alpha', level: 1 },
        { text: 'Beta', level: 2 },
      ],
    };
    const ctx = emptyContext();
    const emitted = block(
      {
        ...table,
        rows: [
          {
            cells: [
              { children: [toc] },
              {
                children: [
                  toc,
                  {
                    kind: 'paragraph',
                    id: 'p',
                    path: 'sections[0].children[0].rows[0].cells[1].children[1]',
                    children: [{ kind: 'text', text: 'After' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      ctx
    ).table as { rows: Array<{ cells: Array<{ children: unknown[] }> }> };
    const [ending, continuing] = emitted.rows[0].cells;
    const [first, second] = ctx.cellTocs;
    const marker = (text: string) => ({ paragraph: { children: [{ text }] } });
    const entries = [
      {
        paragraph: {
          style: 'TOC1',
          children: [{ text: 'Alpha' }, { children: [{ tab: true }] }],
        },
      },
      {
        paragraph: {
          style: 'TOC2',
          children: [{ text: 'Beta' }, { children: [{ tab: true }] }],
        },
      },
    ];

    expect(ctx.cellTocs).toHaveLength(2);
    expect(first).toMatchObject({
      alias: 'Contents',
      options: { hyperlink: true, headingStyleRange: '1-2' },
    });
    expect(first.options).not.toHaveProperty('entries');
    expect(
      new Set([first.start, first.end, second.start, second.end]).size
    ).toBe(4);
    expect(ending.children).toEqual([
      marker(first.start),
      ...entries,
      marker(first.end),
      { paragraph: { children: [] } },
    ]);
    expect(continuing.children).toEqual([
      marker(second.start),
      ...entries,
      marker(second.end),
      { paragraph: { children: [{ text: 'After' }] } },
    ]);
  });
});

describe('sections', () => {
  const paragraph = {
    kind: 'paragraph' as const,
    id: 'p',
    path: 'p',
    children: [],
  };
  const table: DocxIrTable = {
    kind: 'table',
    id: 't',
    path: 't',
    rows: [{ cells: [{ children: [paragraph] }] }],
    columnGrid: { unit: 'twips', values: [2400] },
    width: { kind: 'percent', value: 100 },
    layout: 'fixed',
  };
  /** The last two children of a bookmarked section holding `children`. */
  const ending = (children: DocxIrBlock[]) =>
    (
      section(
        {
          id: 's',
          path: 's',
          children,
          properties: {
            page: {
              widthTwips: 11906,
              heightTwips: 16838,
              orientation: 'portrait',
              margins: {
                topTwips: 1440,
                bottomTwips: 1440,
                leftTwips: 1440,
                rightTwips: 1440,
              },
            },
          },
          bookmark: { id: 7, name: '_Section_7', opens: true, closes: true },
        },
        emptyContext()
      ).children as unknown[]
    ).slice(-2);

  it('closes a bookmarked section that ends on a table after a one-point paragraph, as docx.js does', () => {
    // Without it the table is followed by the paragraph holding the section's
    // properties, where LibreOffice anchors a floating table: the cover band,
    // floated past the bottom margin, left the cover an empty page (#468).
    expect(ending([paragraph, table])).toEqual([
      {
        paragraph: {
          children: [],
          spacing: { before: 0, after: 0, line: 20, lineRule: 'exact' },
        },
      },
      { bookmarkEnd: { id: 7 } },
    ]);
    const [last, end] = ending([table, paragraph]);
    expect(last).toHaveProperty('paragraph');
    expect(last).not.toHaveProperty('paragraph.spacing');
    expect(end).toEqual({ bookmarkEnd: { id: 7 } });
  });
});

describe('floating placement', () => {
  it('numbers the wrap type', () => {
    expect(
      floatingOptions({
        zIndex: 1,
        wrap: { type: 'topAndBottom' },
        horizontal: { relativeTo: 'column', offsetEmu: 100 },
      })
    ).toMatchObject({
      wrap: { type: 3 },
      horizontalPosition: { relative: 'column', offset: 100 },
      zIndex: 1,
    });
  });
});

describe('numbering', () => {
  it('binds a level to its paragraph style by the backend name', () => {
    // docx.js takes `style.style`; this backend takes `paragraphStyle`.
    expect(
      numberingConfig({
        reference: 'ref',
        levels: [
          {
            level: 0,
            format: 'decimal',
            text: '%1.',
            paragraphStyleId: 'Heading1',
            indent: { leftTwips: 720, hangingTwips: 360 },
          },
        ],
      })
    ).toEqual({
      reference: 'ref',
      levels: [
        {
          level: 0,
          format: 'decimal',
          text: '%1.',
          paragraphStyle: 'Heading1',
          style: { paragraph: { indent: { left: 720, hanging: 360 } } },
        },
      ],
    });
  });
});

describe('styles', () => {
  it('give their run formatting the same complex-script twins as a run', () => {
    // A heading style set in Arabic takes its size and weight from the twins
    // in `styles.xml`, not from the run, so every place a style states run
    // formatting carries them: document defaults, styles, built-in overrides.
    const run = { sizeHalfPoints: 32, bold: true, italic: false };
    const twins = {
      sizeComplexScript: 16,
      boldComplexScript: true,
      italicComplexScript: false,
    };
    const options = emitStyles({
      defaults: { run, paragraph: {} },
      paragraph: [{ id: 'Heading1', name: 'Heading 1', run }],
      character: [{ id: 'Emphasis', name: 'Emphasis', run }],
      builtIn: { footnoteReference: { run } },
    }) as Record<string, any>;

    expect(options.default.document.run).toMatchObject(twins);
    expect(options.paragraphStyles[0].run).toMatchObject(twins);
    expect(options.characterStyles[0].run).toMatchObject(twins);
    expect(options.default.footnoteReference.run).toMatchObject(twins);
  });
});

describe('lengths in twips', () => {
  // OOXML states them as whole numbers and the IR does not promise one. docx.js
  // floors each it is handed; this backend writes what it is given, so the
  // consulting eyebrow's tracking was 12.8 twentieths here and 12 there.
  it('floors tracking as docx.js does, below zero and below one twentieth', () => {
    expect(runProperties({ characterSpacingTwentieths: 12.8 })).toMatchObject({
      characterSpacing: 12,
    });
    expect(runProperties({ characterSpacingTwentieths: -9.456 })).toMatchObject(
      { characterSpacing: -10 }
    );
    // docx.js writes the zero a fraction floors to. The backend drops a zero
    // stated as a number and keeps one stated in points.
    expect(runProperties({ characterSpacingTwentieths: 0.5 })).toMatchObject({
      characterSpacing: '0pt',
    });
    expect(runProperties({ characterSpacingTwentieths: 0 })).toMatchObject({
      characterSpacing: 0,
    });
  });

  it('floors indents as docx.js does', () => {
    expect(
      paragraphProperties({
        indent: {
          leftTwips: 360.9,
          rightTwips: -0.5,
          firstLineTwips: 12.5,
          hangingTwips: 283.5,
        },
      })
    ).toMatchObject({
      indent: { left: 360, right: -1, firstLine: 12, hanging: 283 },
    });
    expect(
      numberingConfig({
        reference: 'ref',
        levels: [
          {
            level: 0,
            format: 'bullet',
            text: '•',
            indent: { leftTwips: 720.5, hangingTwips: 360.5 },
          },
        ],
      })
    ).toMatchObject({
      levels: [
        { style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ],
    });
  });

  it('floors table lengths as docx.js does', () => {
    const table: DocxIrTable = {
      kind: 'table',
      id: 't',
      path: 't',
      rows: [
        {
          heightTwips: 283.5,
          cells: [
            { children: [], widthTwips: 1902.5, margins: { leftTwips: 112.5 } },
          ],
        },
      ],
      columnGrid: { unit: 'twips', values: [1902.5] },
      width: { kind: 'twips', value: 1902.5 },
      layout: 'fixed',
      cellMargins: { topTwips: 0.5 },
      floating: {
        absoluteHorizontalPositionTwips: -0.5,
        absoluteVerticalPositionTwips: 100.9,
        topFromTextTwips: 0.5,
        rightFromTextTwips: 1.5,
        bottomFromTextTwips: 2.5,
        leftFromTextTwips: 3.5,
      },
    };

    expect(block(table).table).toMatchObject({
      width: { size: 1902, type: 'dxa' },
      columnWidths: [1902],
      margins: { top: { size: 0, type: 'dxa' } },
      float: {
        absoluteHorizontalPosition: -1,
        absoluteVerticalPosition: 100,
        topFromText: 0,
        rightFromText: 1,
        bottomFromText: 2,
        leftFromText: 3,
      },
      rows: [
        {
          height: { value: 283 },
          cells: [
            {
              width: { size: 1902, type: 'dxa' },
              margins: { left: { size: 112, type: 'dxa' } },
            },
          ],
        },
      ],
    });
  });

  it('floors page lengths as docx.js does', () => {
    const emitted = section(
      {
        id: 's',
        path: 's',
        children: [],
        properties: {
          page: {
            widthTwips: 11906.4,
            heightTwips: 16838.9,
            orientation: 'portrait',
            margins: {
              topTwips: 1440.5,
              bottomTwips: 1440.5,
              leftTwips: 1080.5,
              rightTwips: 1080.5,
              headerTwips: 708.5,
              footerTwips: 708.5,
              gutterTwips: 0.5,
            },
          },
          columns: {
            count: 2,
            spaceTwips: 708.5,
            widths: [
              { widthTwips: 4500.5, spaceTwips: 708.5 },
              { widthTwips: 4500.5 },
            ],
          },
        },
      },
      emptyContext()
    );

    expect(emitted.properties).toMatchObject({
      page: {
        size: { width: 11906, height: 16838 },
        margin: {
          top: 1440,
          bottom: 1440,
          left: 1080,
          right: 1080,
          header: 708,
          footer: 708,
          gutter: 0,
        },
      },
      column: {
        space: 708,
        children: [{ width: 4500, space: 708 }, { width: 4500 }],
      },
    });
  });

  it('leaves the lengths docx.js writes as given', () => {
    // Paragraph spacing, tab stops and frames: docx.js writes these as it is
    // handed them, so the two backends agree whatever the IR holds, and
    // flooring them here alone would part them.
    expect(
      paragraphProperties({
        spacing: { beforeTwips: 0.5, afterTwips: 120.5, lineTwips: 277.68 },
        tabStops: [{ positionTwips: 4513.5, type: 'right' }],
      })
    ).toMatchObject({
      spacing: { before: 0.5, after: 120.5, line: 277.68 },
      tabStops: [{ position: 4513.5 }],
    });
    expect(
      block({
        kind: 'paragraph',
        id: 'p',
        path: 'p',
        children: [],
        frame: {
          widthTwips: 2000.5,
          heightTwips: 300.5,
          anchorHorizontal: 'page',
          anchorVertical: 'page',
          xTwips: 100.5,
          yTwips: 200.5,
        },
      }).paragraph
    ).toMatchObject({
      frame: { width: 2000.5, height: 300.5, position: { x: 100.5, y: 200.5 } },
    });
  });
});
