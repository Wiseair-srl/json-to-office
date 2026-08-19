/**
 * Paragraph Component Schema
 */

import { Type, Static } from '@sinclair/typebox';
import { SpacingSchema, ParagraphIndentSchema, TabStopsSchema } from './common';
import {
  FontDefinitionSchema,
  HexColorSchema,
  LanguageSchema,
  NoProofSchema,
  NoProofWordsSchema,
} from '../font';
import { RevisionSchema } from './revision';
import { CommentSchema } from './comment';

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
          additionalProperties: false,
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
          additionalProperties: false,
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
          additionalProperties: false,
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
    additionalProperties: false,
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
    // Local language override (BCP-47). Falls back to the document default when omitted.
    language: Type.Optional(LanguageSchema),
    // Disable spell/grammar checking for this paragraph's text
    noProof: Type.Optional(NoProofSchema),
    // Known-words allowlist for this paragraph (merged with the document list)
    noProofWords: Type.Optional(NoProofWordsSchema),
    // Rich-text decoration color for bold segments (kept as top-level behavior
    // option). Same value space as font.color: hex or theme color token.
    boldColor: Type.Optional(HexColorSchema),
    // Paragraph spacing (in points) — limited paragraph-level option allowed
    spacing: Type.Optional(SpacingSchema),
    // Paragraph alignment (moved from font to config level)
    alignment: Type.Optional(AlignmentSchema),
    // Paragraph indentation (w:ind) in twips
    indent: Type.Optional(ParagraphIndentSchema),
    // Tab stops (w:tabs); tab characters (\t) in text jump to these positions
    tabStops: Type.Optional(TabStopsSchema),
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
    revision: Type.Optional(RevisionSchema),
    comment: Type.Optional(CommentSchema),
  },
  {
    description:
      'Paragraph component props (font nested for theme consistency; no flat font properties)',
    additionalProperties: false,
  }
);

export type ParagraphProps = Static<typeof ParagraphPropsSchema>;
