/**
 * Native visual content — the DrawingML side of the `visual` component.
 *
 * A raster visual is authored as a pptx slide because a pptx slide is what
 * rasterizes it. A *native* visual has no such intermediary: it becomes one
 * Word drawing group, so its content model is the subset of that pptx surface
 * Word can draw natively — three element kinds, and only the properties that
 * lower to real DrawingML.
 *
 * The surface is deliberately narrower than the raster one, and strict with it.
 * Every schema here is `additionalProperties: false`, so a property that native
 * mode would ignore is rejected at the authoring boundary instead of silently
 * doing nothing: an author who writes a gradient fill or a chart gets told it
 * is not drawn, rather than shipping a document missing the thing they asked
 * for.
 *
 * Geometry is inches, or a percentage of the canvas extent on that axis. The
 * raster path's "a number below 100 is inches, at or above it is EMU" rule is
 * deliberately not reproduced: nothing here is ever EMU.
 */

import { Type, Static, type TSchema } from '@sinclair/typebox';
import { ShapeTypeSchema } from '@json-to-office/shared/schemas/slide-content';

/**
 * A colour anywhere inside a native visual.
 *
 * The same vocabulary the rest of a `.docx.json` uses — `#RRGGBB`, a bare
 * six-digit hex, or a docx theme colour name — because a native visual is
 * drawn by the docx pipeline against the docx theme. The pptx palette names
 * (`accent4`, `tx1`, `bg2`) belong to the raster path and do not resolve here.
 */
export const NativeVisualColorSchema = Type.String({
  pattern: '^(#?[0-9A-Fa-f]{6}|[a-zA-Z][a-zA-Z0-9]*)$',
  description:
    'Hex colour ("#0F172A" or "0F172A") or a docx theme colour name (e.g. "primary")',
});

/**
 * A signed percentage, for a position: an element may legitimately start off
 * the left or top edge of the canvas.
 */
const SIGNED_PERCENT_PATTERN = '^-?\\d+(\\.\\d+)?%$';

/**
 * An unsigned percentage, for a size.
 *
 * Separate from the signed pattern on purpose. The number branch below states
 * `minimum: 0`, and a size that could be negative in one spelling and not the
 * other would make the surface's strictness depend on how the author happened
 * to write it — a negative width has no drawing to refuse it, it just comes
 * out as a zero-size object nobody can see.
 */
const PERCENT_PATTERN = '^\\d+(\\.\\d+)?%$';

/** A position on the canvas: inches, or a percentage of the canvas extent. */
export const NativeVisualOffsetSchema = Type.Union(
  [
    Type.Number({ description: 'Inches from the canvas origin' }),
    Type.String({
      pattern: SIGNED_PERCENT_PATTERN,
      description: 'Percentage of the canvas extent on this axis, e.g. "25%"',
    }),
  ],
  { description: 'Position in inches (number) or as a canvas percentage' }
);

/** An extent on the canvas: inches, or a percentage of the canvas extent. */
export const NativeVisualExtentSchema = Type.Union(
  [
    Type.Number({ minimum: 0, description: 'Size in inches' }),
    Type.String({
      pattern: PERCENT_PATTERN,
      description: 'Percentage of the canvas extent on this axis, e.g. "50%"',
    }),
  ],
  { description: 'Size in inches (number) or as a canvas percentage' }
);

const FrameProps = {
  x: Type.Optional(NativeVisualOffsetSchema),
  y: Type.Optional(NativeVisualOffsetSchema),
  w: Type.Optional(NativeVisualExtentSchema),
  h: Type.Optional(NativeVisualExtentSchema),
  rotate: Type.Optional(
    Type.Number({ description: 'Clockwise rotation in degrees' })
  ),
} as const;

/**
 * Underline, as Word draws it.
 *
 * `true` is a single line in the run's own colour; the object form names the
 * line style and, optionally, a colour of its own.
 */
export const NativeVisualUnderlineSchema = Type.Union(
  [
    Type.Boolean({ description: 'Single underline in the text colour' }),
    Type.Object(
      {
        style: Type.Optional(
          Type.Union(
            [
              Type.Literal('sng'),
              Type.Literal('dbl'),
              Type.Literal('dash'),
              Type.Literal('dotted'),
            ],
            { description: 'Underline style (default "sng")' }
          )
        ),
        color: Type.Optional(NativeVisualColorSchema),
      },
      { additionalProperties: false }
    ),
  ],
  { description: 'Underline: true for a single line, or a style/colour object' }
);

const InlineTextProps = {
  fontFace: Type.Optional(Type.String({ description: 'Font family name' })),
  fontSize: Type.Optional(
    Type.Number({ minimum: 1, description: 'Font size in points' })
  ),
  bold: Type.Optional(Type.Boolean()),
  italic: Type.Optional(Type.Boolean()),
} as const;

/** One formatted span inside a native `text` element. */
export const NativeVisualTextRunSchema = Type.Object(
  {
    text: Type.String({ description: 'Run text' }),
    color: Type.Optional(NativeVisualColorSchema),
    ...InlineTextProps,
    underline: Type.Optional(NativeVisualUnderlineSchema),
    strike: Type.Optional(Type.Boolean({ description: 'Strikethrough' })),
    breakLine: Type.Optional(
      Type.Boolean({ description: 'Start a new line after this run' })
    ),
  },
  {
    additionalProperties: false,
    description: 'A formatted run inside a native visual text element',
  }
);

/**
 * One span of a shape's text.
 *
 * Deliberately not the same shape as a text run: shape text carries no
 * underline or strikethrough in the raster surface either, and native mode
 * keeps the two surfaces aligned rather than quietly widening one.
 */
export const NativeVisualTextSegmentSchema = Type.Object(
  {
    text: Type.String({ description: 'Segment text' }),
    color: Type.Optional(NativeVisualColorSchema),
    ...InlineTextProps,
    breakLine: Type.Optional(
      Type.Boolean({ description: 'Start a new line after this segment' })
    ),
  },
  {
    additionalProperties: false,
    description: 'A formatted segment of a native visual shape’s text',
  }
);

/** A solid fill, or none at all. */
export const NativeVisualFillSchema = Type.Object(
  {
    color: Type.Optional(NativeVisualColorSchema),
    transparency: Type.Optional(
      Type.Number({
        minimum: 0,
        maximum: 100,
        description: 'Fill transparency, 0 (opaque) to 100 (invisible)',
      })
    ),
  },
  {
    additionalProperties: false,
    description:
      'Solid fill. Omit the whole property for no fill; gradients and patterns are raster-only.',
  }
);

/** A shape outline: solid or dashed, one uniform stroke. */
export const NativeVisualLineSchema = Type.Object(
  {
    color: Type.Optional(NativeVisualColorSchema),
    width: Type.Optional(
      Type.Number({ minimum: 0, description: 'Outline width in points' })
    ),
    dashType: Type.Optional(
      Type.Union(
        [
          Type.Literal('solid'),
          Type.Literal('dash'),
          Type.Literal('dot'),
          Type.Literal('dashDot'),
        ],
        { description: 'Outline dash pattern (default "solid")' }
      )
    ),
  },
  { additionalProperties: false, description: 'Shape outline' }
);

export const NativeVisualAlignmentSchema = Type.Union(
  [
    Type.Literal('left'),
    Type.Literal('center'),
    Type.Literal('right'),
    Type.Literal('justify'),
  ],
  { description: 'Horizontal text alignment' }
);

export const NativeVisualVerticalAlignmentSchema = Type.Union(
  [Type.Literal('top'), Type.Literal('middle'), Type.Literal('bottom')],
  { description: 'Vertical text anchoring inside the box' }
);

/** Text inset, in points: one value for every side, or `[top, right, bottom, left]`. */
export const NativeVisualMarginSchema = Type.Union(
  [
    Type.Number({ minimum: 0, description: 'Inset on every side, in points' }),
    Type.Array(Type.Number({ minimum: 0 }), {
      minItems: 4,
      maxItems: 4,
      description: 'Insets as [top, right, bottom, left], in points',
    }),
  ],
  { description: 'Text insets in points' }
);

export const NativeVisualTextPropsSchema = Type.Object(
  {
    text: Type.Optional(Type.String({ description: 'Plain text content' })),
    runs: Type.Optional(
      Type.Array(NativeVisualTextRunSchema, {
        minItems: 1,
        description: 'Formatted runs, as an alternative to "text"',
      })
    ),
    ...FrameProps,
    color: Type.Optional(NativeVisualColorSchema),
    ...InlineTextProps,
    underline: Type.Optional(NativeVisualUnderlineSchema),
    strike: Type.Optional(Type.Boolean({ description: 'Strikethrough' })),
    align: Type.Optional(NativeVisualAlignmentSchema),
    valign: Type.Optional(NativeVisualVerticalAlignmentSchema),
    margin: Type.Optional(NativeVisualMarginSchema),
    fill: Type.Optional(NativeVisualFillSchema),
  },
  {
    additionalProperties: false,
    description:
      'Native visual text element — becomes a Word text box (wps:wsp) inside the drawing group',
  }
);

export const NativeVisualShapePropsSchema = Type.Object(
  {
    type: ShapeTypeSchema,
    ...FrameProps,
    fill: Type.Optional(NativeVisualFillSchema),
    line: Type.Optional(NativeVisualLineSchema),
    text: Type.Optional(
      Type.Union(
        [
          Type.String(),
          Type.Array(NativeVisualTextSegmentSchema, { minItems: 1 }),
        ],
        { description: 'Text drawn inside the shape' }
      )
    ),
    ...InlineTextProps,
    fontColor: Type.Optional(NativeVisualColorSchema),
    align: Type.Optional(NativeVisualAlignmentSchema),
    valign: Type.Optional(NativeVisualVerticalAlignmentSchema),
    margin: Type.Optional(NativeVisualMarginSchema),
    flipH: Type.Optional(Type.Boolean({ description: 'Mirror horizontally' })),
    flipV: Type.Optional(Type.Boolean({ description: 'Mirror vertically' })),
  },
  {
    additionalProperties: false,
    description:
      'Native visual shape element — becomes a preset-geometry shape (wps:wsp) inside the drawing group',
  }
);

export const NativeVisualImagePropsSchema = Type.Object(
  {
    path: Type.Optional(
      Type.String({ description: 'File path or http(s) URL' })
    ),
    base64: Type.Optional(Type.String({ description: 'Base64 data URI' })),
    svg: Type.Optional(Type.String({ description: 'Raw SVG markup' })),
    ...FrameProps,
    sizing: Type.Optional(
      Type.Object(
        {
          type: Type.Union(
            [
              Type.Literal('contain'),
              Type.Literal('cover'),
              Type.Literal('crop'),
            ],
            { description: 'How the image fills its box' }
          ),
          w: Type.Optional(
            Type.Number({
              minimum: 0,
              description:
                'Box width in inches; overrides the element’s own "w"',
            })
          ),
          h: Type.Optional(
            Type.Number({
              minimum: 0,
              description:
                'Box height in inches; overrides the element’s own "h"',
            })
          ),
        },
        {
          additionalProperties: false,
          description:
            'How the image fills its box. "w"/"h" state the box itself, taking precedence over the element’s "w"/"h", as they do in raster mode.',
        }
      )
    ),
    alt: Type.Optional(
      Type.String({ description: 'Alternative text for accessibility' })
    ),
  },
  {
    additionalProperties: false,
    description:
      'Native visual image element — becomes a native picture inside the drawing group',
  }
);

/** The three element kinds a native visual can hold, in public schema order. */
export const NATIVE_VISUAL_ELEMENT_NAMES = ['text', 'shape', 'image'] as const;

export type NativeVisualElementName =
  (typeof NATIVE_VISUAL_ELEMENT_NAMES)[number];

function nativeElement<
  const TName extends NativeVisualElementName,
  const TProps extends TSchema,
>(name: TName, propsSchema: TProps, description: string) {
  return Type.Object(
    {
      name: Type.Literal(name),
      id: Type.Optional(Type.String()),
      enabled: Type.Optional(
        Type.Boolean({
          default: true,
          description:
            'When false, this element is filtered out and not drawn. Defaults to true.',
        })
      ),
      props: propsSchema,
    },
    { additionalProperties: false, description }
  );
}

/**
 * A single element of a native visual.
 *
 * `table`, `chart` and `highcharts` are absent on purpose: a Word table cannot
 * live inside a drawing group, and neither chart kind has a native mapping
 * here yet. Naming one is a validation error rather than a silent drop.
 *
 * The `$id` is distinct from the raster union's `PptxSlideContent` so the two
 * never collide when the document schema hoists them into shared definitions.
 */
export const NativeVisualElementSchema = Type.Union(
  [
    nativeElement(
      'text',
      NativeVisualTextPropsSchema,
      'Text element - a native Word text box drawn on the visual canvas.'
    ),
    nativeElement(
      'shape',
      NativeVisualShapePropsSchema,
      'Shape element - a native preset-geometry shape, optionally holding text.'
    ),
    nativeElement(
      'image',
      NativeVisualImagePropsSchema,
      'Image element - a native picture; an SVG stays vector.'
    ),
  ],
  {
    $id: 'DocxNativeVisualContent',
    discriminator: { propertyName: 'name' },
    description: 'A single native visual element (text, shape, or image).',
  }
);

/**
 * The canvas a native visual is drawn on.
 *
 * No `theme`: the raster canvas names a *pptx* theme, which the docx pipeline
 * cannot resolve. Native colours resolve against the document's own docx theme
 * instead, so naming a pptx theme here would promise something that could not
 * be kept.
 */
export const NativeVisualCanvasSchema = Type.Object(
  {
    width: Type.Number({
      minimum: 0.1,
      description: 'Canvas width in inches',
    }),
    height: Type.Number({
      minimum: 0.1,
      description: 'Canvas height in inches',
    }),
    background: Type.Optional(
      Type.Object(
        {
          color: Type.Optional(NativeVisualColorSchema),
          image: Type.Optional(
            Type.Object(
              {
                path: Type.Optional(Type.String()),
                base64: Type.Optional(Type.String()),
              },
              { additionalProperties: false }
            )
          ),
        },
        {
          additionalProperties: false,
          description:
            'Canvas background. A colour becomes the bottom-most rectangle; an image becomes the bottom-most picture.',
        }
      )
    ),
  },
  {
    additionalProperties: false,
    description: 'Drawing canvas for a native visual',
  }
);

export type NativeVisualCanvas = Static<typeof NativeVisualCanvasSchema>;
export type NativeVisualElement = Static<typeof NativeVisualElementSchema>;
export type NativeVisualTextProps = Static<typeof NativeVisualTextPropsSchema>;
export type NativeVisualShapeProps = Static<
  typeof NativeVisualShapePropsSchema
>;
export type NativeVisualImageProps = Static<
  typeof NativeVisualImagePropsSchema
>;
export type NativeVisualTextRun = Static<typeof NativeVisualTextRunSchema>;
export type NativeVisualTextSegment = Static<
  typeof NativeVisualTextSegmentSchema
>;
export type NativeVisualFill = Static<typeof NativeVisualFillSchema>;
export type NativeVisualLine = Static<typeof NativeVisualLineSchema>;
