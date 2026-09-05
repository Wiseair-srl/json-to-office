/**
 * Common Types and Schemas for Components
 *
 * Shared type definitions used across multiple component schemas.
 */

import { Type, Static } from '@sinclair/typebox';
import { HexColorSchema } from '../font';

// ============================================================================
// Common Types
// ============================================================================

export const AlignmentSchema = Type.Union(
  [Type.Literal('left'), Type.Literal('center'), Type.Literal('right')],
  { description: 'Text alignment options' }
);

export const JustifiedAlignmentSchema = Type.Union(
  [
    Type.Literal('left'),
    Type.Literal('center'),
    Type.Literal('right'),
    Type.Literal('justify'),
  ],
  { description: 'Text alignment options including justify' }
);

export const HeadingLevelSchema = Type.Union(
  [
    Type.Literal(1),
    Type.Literal(2),
    Type.Literal(3),
    Type.Literal(4),
    Type.Literal(5),
    Type.Literal(6),
  ],
  { description: 'Heading level (1-6)' }
);

export const SpacingSchema = Type.Object(
  {
    before: Type.Optional(
      Type.Number({
        minimum: 0,
        description: 'Spacing before element in points',
      })
    ),
    after: Type.Optional(
      Type.Number({
        minimum: 0,
        description: 'Spacing after element in points',
      })
    ),
  },
  {
    description: 'Spacing configuration',
    additionalProperties: false,
  }
);

export const ListSpacingSchema = Type.Object(
  {
    before: Type.Optional(
      Type.Number({
        minimum: 0,
        description: 'Spacing before list in points',
      })
    ),
    after: Type.Optional(
      Type.Number({
        minimum: 0,
        description: 'Spacing after list in points',
      })
    ),
    item: Type.Optional(
      Type.Number({
        minimum: 0,
        description: 'Spacing between list items in points',
      })
    ),
  },
  {
    description: 'List spacing configuration with item spacing',
    additionalProperties: false,
  }
);

export const MarginsSchema = Type.Object(
  {
    top: Type.Optional(Type.Number({ minimum: 0 })),
    bottom: Type.Optional(Type.Number({ minimum: 0 })),
    left: Type.Optional(Type.Number({ minimum: 0 })),
    right: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { description: 'Margin configuration', additionalProperties: false }
);

export const BorderSchema = Type.Object(
  {
    style: Type.Optional(
      Type.Union([
        Type.Literal('solid'),
        Type.Literal('dashed'),
        Type.Literal('dotted'),
        Type.Literal('double'),
        Type.Literal('none'),
      ])
    ),
    width: Type.Optional(Type.Number({ minimum: 0 })),
    color: Type.Optional(HexColorSchema),
  },
  { description: 'Border configuration', additionalProperties: false }
);

export const LineSpacingSchema = Type.Object(
  {
    type: Type.Union(
      [
        Type.Literal('single'),
        Type.Literal('atLeast'),
        Type.Literal('exactly'),
        Type.Literal('double'),
        Type.Literal('multiple'),
      ],
      {
        description:
          '`single`/`double` ignore `value`; `multiple` scales single spacing by it; `atLeast` is a floor the line grows past; `exactly` pins an absolute box the glyphs are clipped to.',
      }
    ),
    value: Type.Optional(
      Type.Number({
        minimum: 0,
        description:
          'Points for `exactly` and `atLeast`, a factor of single spacing for `multiple`. `exactly` has no floor of its own — an empty spacer paragraph legitimately pins a fraction of a point — so a box smaller than the text it holds is accepted here and clips it.',
      })
    ),
  },
  { description: 'Line spacing configuration', additionalProperties: false }
);

/**
 * List-level indentation, in POINTS.
 *
 * Points, unlike `ParagraphIndentSchema` next door, which is twips — the two
 * have always disagreed and neither said so, which is how every bundled theme
 * came to ship `indent: 3` meaning half an inch and getting three points: the
 * marker landed outside the page margin, to the left of the body text it was
 * supposed to label.
 */
export const IndentSchema = Type.Object(
  {
    left: Type.Optional(
      Type.Number({
        minimum: 0,
        description:
          'Left indentation in points. Omit to inherit the per-level default of 36pt (half an inch) per level.',
      })
    ),
    hanging: Type.Optional(
      Type.Number({
        minimum: 0,
        description:
          'Hanging indent in points — how far the marker sits left of the text. Omit for the 18pt default.',
      })
    ),
  },
  {
    description: 'Indentation configuration, in points',
    additionalProperties: false,
  }
);

export const ParagraphIndentSchema = Type.Object(
  {
    left: Type.Optional(
      Type.Number({
        description: 'Left indentation in twips (1/20 of a point)',
      })
    ),
    right: Type.Optional(
      Type.Number({
        description: 'Right indentation in twips (1/20 of a point)',
      })
    ),
    hanging: Type.Optional(
      Type.Number({
        minimum: 0,
        description:
          'Hanging indent in twips: first line stays at the left indent, following lines are indented. Mutually exclusive with firstLine.',
      })
    ),
    firstLine: Type.Optional(
      Type.Number({
        minimum: 0,
        description:
          'First-line indent in twips: only the first line is indented. Mutually exclusive with hanging.',
      })
    ),
  },
  {
    description:
      'Paragraph indentation (w:ind) in twips. Use either hanging or firstLine, not both.',
    additionalProperties: false,
  }
);

export const TabStopTypeSchema = Type.Union(
  [
    Type.Literal('left'),
    Type.Literal('right'),
    Type.Literal('center'),
    Type.Literal('decimal'),
    Type.Literal('bar'),
  ],
  { description: 'Tab stop alignment type' }
);

export const TabStopLeaderSchema = Type.Union(
  [
    Type.Literal('dot'),
    Type.Literal('hyphen'),
    Type.Literal('underscore'),
    Type.Literal('middleDot'),
    Type.Literal('none'),
  ],
  { description: 'Leader character filling the space before the tab stop' }
);

export const TabStopSchema = Type.Object(
  {
    type: TabStopTypeSchema,
    position: Type.Number({
      minimum: 0,
      description: 'Tab stop position in twips (1/20 of a point)',
    }),
    leader: Type.Optional(TabStopLeaderSchema),
  },
  {
    description: 'Tab stop definition (w:tab in w:tabs)',
    additionalProperties: false,
  }
);

/**
 * A block slot that holds one line of text: non-empty, no line break. A line
 * break inside a running head, a cover title or a takeaway would break the
 * recipe that draws it, so the shape is a schema bound and a violation is a
 * path-addressed error at the slot.
 */
export const oneLineText = (description: string) =>
  Type.String({
    minLength: 1,
    pattern: '^[^\\r\\n]+$',
    description,
  });

export const TabStopsSchema = Type.Array(TabStopSchema, {
  description:
    'Tab stops for the paragraph. Tab characters (\\t) in the text jump to these positions.',
});

// ============================================================================
// Floating Positioning Schemas (shared between image, text-box components)
// ============================================================================

export const HorizontalPositionRelativeFromSchema = Type.Union(
  [
    Type.Literal('character'),
    Type.Literal('column'),
    Type.Literal('margin'),
    Type.Literal('page'),
    Type.Literal('text'), // VML compatibility for text-box
  ],
  {
    description: 'Horizontal position relative to',
  }
);

export const VerticalPositionRelativeFromSchema = Type.Union(
  [
    Type.Literal('margin'),
    Type.Literal('page'),
    Type.Literal('paragraph'),
    Type.Literal('line'),
    Type.Literal('text'), // VML compatibility for text-box
  ],
  {
    description: 'Vertical position relative to',
  }
);

export const HorizontalPositionAlignSchema = Type.Union(
  [
    Type.Literal('left'),
    Type.Literal('center'),
    Type.Literal('right'),
    Type.Literal('inside'),
    Type.Literal('outside'),
  ],
  {
    description: 'Horizontal alignment',
  }
);

export const VerticalPositionAlignSchema = Type.Union(
  [
    Type.Literal('top'),
    Type.Literal('center'),
    Type.Literal('bottom'),
    Type.Literal('inside'),
    Type.Literal('outside'),
  ],
  {
    description: 'Vertical alignment',
  }
);

export const TextWrappingTypeSchema = Type.Union(
  [
    Type.Literal('none'),
    Type.Literal('square'),
    Type.Literal('topAndBottom'),
    Type.Literal('around'), // VML compatibility for text-box
    Type.Literal('tight'), // VML compatibility for text-box
    Type.Literal('through'), // VML compatibility for text-box
  ],
  {
    description: 'Text wrapping type',
  }
);

export const TextWrappingSideSchema = Type.Union(
  [
    Type.Literal('bothSides'),
    Type.Literal('left'),
    Type.Literal('right'),
    Type.Literal('largest'),
  ],
  {
    description: 'Text wrapping side',
  }
);

export const FloatingPropertiesSchema = Type.Object(
  {
    horizontalPosition: Type.Optional(
      Type.Object(
        {
          relative: Type.Optional(HorizontalPositionRelativeFromSchema),
          align: Type.Optional(HorizontalPositionAlignSchema),
          offset: Type.Optional(
            Type.Union([
              Type.Number({
                description: 'Horizontal offset in twips (1/20 of a point)',
              }),
              Type.String({
                pattern: '^\\d+(\\.\\d+)?%$',
                description:
                  'Horizontal offset as percentage (e.g., "50%") relative to page or margin width',
              }),
            ])
          ),
        },
        {
          description:
            'Horizontal positioning (use either align or offset, not both)',
          additionalProperties: false,
        }
      )
    ),
    verticalPosition: Type.Optional(
      Type.Object(
        {
          relative: Type.Optional(VerticalPositionRelativeFromSchema),
          align: Type.Optional(VerticalPositionAlignSchema),
          offset: Type.Optional(
            Type.Union([
              Type.Number({
                description: 'Vertical offset in twips (1/20 of a point)',
              }),
              Type.String({
                pattern: '^\\d+(\\.\\d+)?%$',
                description:
                  'Vertical offset as percentage (e.g., "50%") relative to page or margin height',
              }),
            ])
          ),
        },
        {
          description:
            'Vertical positioning (use either align or offset, not both)',
          additionalProperties: false,
        }
      )
    ),
    wrap: Type.Optional(
      Type.Object(
        {
          type: TextWrappingTypeSchema,
          side: Type.Optional(TextWrappingSideSchema),
          margins: Type.Optional(
            Type.Object(
              {
                top: Type.Optional(
                  Type.Union([
                    Type.Number({ description: 'Top margin in twips' }),
                    Type.String({
                      pattern: '^\\d+(\\.\\d+)?%$',
                      description: 'Top margin as percentage of page height',
                    }),
                  ])
                ),
                bottom: Type.Optional(
                  Type.Union([
                    Type.Number({ description: 'Bottom margin in twips' }),
                    Type.String({
                      pattern: '^\\d+(\\.\\d+)?%$',
                      description: 'Bottom margin as percentage of page height',
                    }),
                  ])
                ),
                left: Type.Optional(
                  Type.Union([
                    Type.Number({ description: 'Left margin in twips' }),
                    Type.String({
                      pattern: '^\\d+(\\.\\d+)?%$',
                      description: 'Left margin as percentage of page width',
                    }),
                  ])
                ),
                right: Type.Optional(
                  Type.Union([
                    Type.Number({ description: 'Right margin in twips' }),
                    Type.String({
                      pattern: '^\\d+(\\.\\d+)?%$',
                      description: 'Right margin as percentage of page width',
                    }),
                  ])
                ),
              },
              {
                description: 'Distance from text margins',
                additionalProperties: false,
              }
            )
          ),
        },
        {
          description: 'Text wrapping configuration',
          additionalProperties: false,
        }
      )
    ),
    allowOverlap: Type.Optional(
      Type.Boolean({
        description: 'Allow element to overlap with other elements',
      })
    ),
    behindDocument: Type.Optional(
      Type.Boolean({
        description: 'Place element behind document text',
      })
    ),
    lockAnchor: Type.Optional(
      Type.Boolean({
        description: 'Lock the anchor position',
      })
    ),
    layoutInCell: Type.Optional(
      Type.Boolean({
        description: 'Layout element within table cell',
      })
    ),
    zIndex: Type.Optional(
      Type.Number({
        minimum: 0,
        description: 'Z-order for overlapping elements (must be non-negative)',
      })
    ),
    rotation: Type.Optional(
      Type.Number({
        description: 'Rotation angle in degrees',
      })
    ),
    visibility: Type.Optional(
      Type.Union([Type.Literal('hidden'), Type.Literal('inherit')], {
        description: 'Visibility of the floating element',
      })
    ),
  },
  {
    description: 'Floating element properties',
    additionalProperties: false,
  }
);

export type HorizontalPositionRelativeFrom = Static<
  typeof HorizontalPositionRelativeFromSchema
>;
export type VerticalPositionRelativeFrom = Static<
  typeof VerticalPositionRelativeFromSchema
>;
export type HorizontalPositionAlign = Static<
  typeof HorizontalPositionAlignSchema
>;
export type VerticalPositionAlign = Static<typeof VerticalPositionAlignSchema>;
export type TextWrappingType = Static<typeof TextWrappingTypeSchema>;
export type TextWrappingSide = Static<typeof TextWrappingSideSchema>;
export type FloatingProperties = Static<typeof FloatingPropertiesSchema>;

export const NumberingSchema = Type.Object(
  {
    start: Type.Optional(Type.Number({ minimum: 1 })),
    style: Type.Optional(
      Type.Union([
        Type.Literal('decimal'),
        Type.Literal('lowerLetter'),
        Type.Literal('upperLetter'),
        Type.Literal('lowerRoman'),
        Type.Literal('upperRoman'),
      ])
    ),
    separator: Type.Optional(Type.String()),
  },
  {
    description: 'Numbering configuration for lists',
    additionalProperties: false,
  }
);

// ============================================================================
// Base Component Props (common fields across all components)
// ============================================================================
// Note: BaseComponentFields is currently empty as common properties
// (className, style, hidden, condition) are not implemented in the rendering engine.
// These were removed to accurately reflect actual capabilities.

const BaseComponentFields = {};

// Export BaseComponentPropsSchema
export const BaseComponentPropsSchema = Type.Object(BaseComponentFields, {
  description: 'Base component props',
  additionalProperties: true,
});

// Export BaseComponentFields for use in component definitions
export { BaseComponentFields };

// ============================================================================
// TypeScript Types
// ============================================================================

export type Alignment = Static<typeof AlignmentSchema>;
export type JustifiedAlignment = Static<typeof JustifiedAlignmentSchema>;
export type HeadingLevel = Static<typeof HeadingLevelSchema>;
export type Spacing = Static<typeof SpacingSchema>;
export type ListSpacing = Static<typeof ListSpacingSchema>;
export type LineSpacing = Static<typeof LineSpacingSchema>;
export type Indent = Static<typeof IndentSchema>;
export type ParagraphIndent = Static<typeof ParagraphIndentSchema>;
export type TabStopType = Static<typeof TabStopTypeSchema>;
export type TabStopLeader = Static<typeof TabStopLeaderSchema>;
export type TabStop = Static<typeof TabStopSchema>;
export type TabStops = Static<typeof TabStopsSchema>;
export type Numbering = Static<typeof NumberingSchema>;
export type Margins = Static<typeof MarginsSchema>;
export type Border = Static<typeof BorderSchema>;
export type BaseComponentProps = Static<typeof BaseComponentPropsSchema>;
