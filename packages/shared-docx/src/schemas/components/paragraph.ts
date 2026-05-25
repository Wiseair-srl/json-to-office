/**
 * Paragraph Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { SpacingSchema } from './common';
import { FontDefinitionSchema } from '../font';

// Frame wrapping type schema
const FrameWrapTypeSchema = Type.Union(
  [
    Type.Literal('around'),
    Type.Literal('none'),
    Type.Literal('notBeside'),
    Type.Literal('through'),
    Type.Literal('tight'),
    Type.Literal('auto'),
  ],
  {
    description: 'Frame text wrapping type',
  }
);

// Frame anchor type schema
const FrameAnchorTypeSchema = Type.Union(
  [Type.Literal('margin'), Type.Literal('page'), Type.Literal('text')],
  {
    description: 'Frame anchor type',
  }
);

// Frame horizontal position alignment schema
const FrameHorizontalAlignSchema = Type.Union(
  [
    Type.Literal('left'),
    Type.Literal('center'),
    Type.Literal('right'),
    Type.Literal('inside'),
    Type.Literal('outside'),
  ],
  {
    description: 'Frame horizontal alignment',
  }
);

// Frame vertical position alignment schema
const FrameVerticalAlignSchema = Type.Union(
  [
    Type.Literal('top'),
    Type.Literal('center'),
    Type.Literal('bottom'),
    Type.Literal('inside'),
    Type.Literal('outside'),
  ],
  {
    description: 'Frame vertical alignment',
  }
);

// Floating frame properties schema
const FloatingFramePropertiesSchema = Type.Object(
  {
    horizontalPosition: Type.Optional(
      Type.Object(
        {
          relative: Type.Optional(FrameAnchorTypeSchema),
          align: Type.Optional(FrameHorizontalAlignSchema),
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
        }
      )
    ),
    verticalPosition: Type.Optional(
      Type.Object(
        {
          relative: Type.Optional(FrameAnchorTypeSchema),
          align: Type.Optional(FrameVerticalAlignSchema),
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
        }
      )
    ),
    wrap: Type.Optional(
      Type.Object(
        {
          type: FrameWrapTypeSchema,
        },
        {
          description: 'Text wrapping configuration',
        }
      )
    ),
    lockAnchor: Type.Optional(
      Type.Boolean({
        description: 'Lock the anchor position',
      })
    ),
    width: Type.Optional(
      Type.Number({
        minimum: 1,
        description: 'Frame width in twips (DXA units)',
      })
    ),
    height: Type.Optional(
      Type.Number({
        minimum: 1,
        description: 'Frame height in twips (DXA units)',
      })
    ),
  },
  {
    description: 'Floating text frame properties',
  }
);

// Paragraph indent schema. All values in twips (1/20 of a point) unless noted.
// firstLineChars uses Word's char-grid model (hundredths of a character),
// useful for CJK text where indents should align to character columns.
// firstLine and hanging are mutually exclusive — encoded as a Union so
// validators reject documents that set both.
const LeftRightIndentFields = {
  left: Type.Optional(
    Type.Number({ description: 'Left indent in twips (1/20 of a point)' })
  ),
  right: Type.Optional(
    Type.Number({ description: 'Right indent in twips (1/20 of a point)' })
  ),
};

const IndentWithFirstLineSchema = Type.Object(
  {
    ...LeftRightIndentFields,
    firstLine: Type.Optional(
      Type.Number({
        minimum: 0,
        description: 'First-line indent in twips (1/20 of a point).',
      })
    ),
    firstLineChars: Type.Optional(
      Type.Number({
        description:
          'First-line indent in hundredths of a character (e.g. 200 = 2 characters). CJK-friendly companion to firstLine; takes precedence when both are set.',
      })
    ),
  },
  {
    description:
      'Paragraph indent with first-line indent (twips and/or CJK char-grid).',
    additionalProperties: false,
  }
);

const IndentWithHangingSchema = Type.Object(
  {
    ...LeftRightIndentFields,
    hanging: Type.Optional(
      Type.Number({
        minimum: 0,
        description: 'Hanging indent in twips (1/20 of a point).',
      })
    ),
  },
  {
    description: 'Paragraph indent with hanging indent.',
    additionalProperties: false,
  }
);

const IndentSchema = Type.Union(
  [IndentWithFirstLineSchema, IndentWithHangingSchema],
  {
    description:
      'Paragraph indent options. firstLine and hanging are mutually exclusive — pick one variant.',
  }
);

// Alignment type schema (paragraph-level, not font-level)
const AlignmentSchema = Type.Union(
  [
    Type.Literal('left'),
    Type.Literal('center'),
    Type.Literal('right'),
    Type.Literal('justify'),
  ],
  {
    description: 'Paragraph text alignment',
  }
);

export const ParagraphPropsSchema = Type.Object(
  {
    text: Type.String({
      description: 'Text content (required)',
    }),
    // New nested font object, aligned with theme's FontDefinitionSchema
    // Allow partial overrides (family not required when overriding a subset)
    font: Type.Optional(Type.Partial(FontDefinitionSchema)),
    // Optional reference to a named style from theme.styles (e.g., 'heading1', 'normal')
    themeStyle: Type.Optional(Type.String()),
    // Rich-text decoration color for bold segments (kept as top-level behavior option)
    boldColor: Type.Optional(Type.String()),
    // Paragraph spacing (in points) — limited paragraph-level option allowed
    spacing: Type.Optional(SpacingSchema),
    // Paragraph alignment (moved from font to config level)
    alignment: Type.Optional(AlignmentSchema),
    indent: Type.Optional(IndentSchema),
    pageBreak: Type.Optional(
      Type.Boolean({
        description: 'Insert page break before paragraph',
      })
    ),
    columnBreak: Type.Optional(
      Type.Boolean({
        description: 'Insert column break before paragraph',
      })
    ),
    floating: Type.Optional(FloatingFramePropertiesSchema),
    keepNext: Type.Optional(
      Type.Boolean({
        description: 'Keep paragraph with next paragraph on same page',
      })
    ),
    keepLines: Type.Optional(
      Type.Boolean({
        description: 'Keep all lines of paragraph together on same page',
      })
    ),
    id: Type.Optional(
      Type.String({
        description: 'Unique identifier for internal linking (bookmark anchor)',
      })
    ),
  },
  {
    description:
      'Paragraph component props (font nested for theme consistency; no flat font properties)',
    additionalProperties: false,
  }
);

export type ParagraphProps = Static<typeof ParagraphPropsSchema>;
