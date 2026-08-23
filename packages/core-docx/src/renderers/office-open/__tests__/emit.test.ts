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
  type EmitContext,
} from '../emit';
import type { DocxIrShapeRun, DocxIrTable } from '../../../ir/types';

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
