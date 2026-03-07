/**
 * Table of Contents Component Schema
 */

import { Type, Static } from '@sinclair/typebox';

export const TocStyleSchema = Type.Union(
  [Type.Literal('numeric'), Type.Literal('bullet'), Type.Literal('none')],
  { description: 'TOC numbering style' }
);

export const TocScopeSchema = Type.Union(
  [Type.Literal('document'), Type.Literal('section')],
  { description: 'TOC scope: document-wide or section-only' }
);

export const TocStyleMappingSchema = Type.Object(
  {
    styleId: Type.String({
      description: 'Custom style ID matching a key in theme.styles',
    }),
    level: Type.Number({
      minimum: 1,
      maximum: 6,
      description: 'TOC level (1-6) to assign to this style',
    }),
  },
  {
    description: 'Mapping of custom style to TOC level',
    additionalProperties: false,
  }
);

export const TocDepthRangeSchema = Type.Object(
  {
    from: Type.Optional(
      Type.Number({
        minimum: 1,
        maximum: 6,
        default: 1,
        description:
          'Starting heading level (1-6). Defaults to 1 if not specified.',
      })
    ),
    to: Type.Optional(
      Type.Number({
        minimum: 1,
        maximum: 6,
        default: 3,
        description:
          'Ending heading level (1-6). Defaults to 3 if not specified.',
      })
    ),
  },
  {
    description:
      'Range of heading levels to include in TOC. Specify at least one of "from" or "to".',
    additionalProperties: false,
  }
);

export const TocPropsSchema = Type.Object(
  {
    pageBreak: Type.Optional(
      Type.Boolean({
        description: 'Insert page break before TOC block',
      })
    ),
    depth: Type.Optional(
      Type.Object(
        {
          from: Type.Optional(
            Type.Number({
              minimum: 1,
              maximum: 6,
              default: 1,
              description:
                'Starting heading level (1-6). Defaults to 1 if not specified.',
            })
          ),
          to: Type.Optional(
            Type.Number({
              minimum: 1,
              maximum: 6,
              default: 3,
              description:
                'Ending heading level (1-6). Defaults to 3 if not specified.',
            })
          ),
        },
        {
          description:
            'Range of heading levels to include in TOC. Specify "from", "to", or both. Defaults: from=1, to=3',
          additionalProperties: false,
          default: { to: 3 },
        }
      )
    ),
    pageNumbersDepth: Type.Optional(
      Type.Object(
        {
          from: Type.Optional(
            Type.Number({
              minimum: 1,
              maximum: 6,
              default: 1,
              description:
                'Starting heading level (1-6). Defaults to 1 if not specified.',
            })
          ),
          to: Type.Optional(
            Type.Number({
              minimum: 1,
              maximum: 6,
              default: 3,
              description:
                'Ending heading level (1-6). Defaults to 3 if not specified.',
            })
          ),
        },
        {
          description:
            'Range of heading levels to show page numbers. Specify "from", "to", or both. When specified, page numbers are hidden for entries outside this range.',
          additionalProperties: false,
        }
      )
    ),
    numberingStyle: Type.Optional(TocStyleSchema),
    title: Type.Optional(
      Type.String({
        description: 'TOC heading title',
      })
    ),
    includePageNumbers: Type.Optional(
      Type.Boolean({
        default: true,
        description: 'Show page numbers next to entries',
      })
    ),
    numberSeparator: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          'Use tab separator between entry and page number. True applies "\\t" (default), false applies " "',
      })
    ),
    scope: Type.Optional(
      Type.Union([TocScopeSchema, Type.Literal('auto')], {
        default: 'auto',
        description:
          'TOC scope: "document" for entire document, "section" for parent section only, "auto" for automatic detection (section if inside section, otherwise document)',
      })
    ),
    styles: Type.Optional(
      Type.Array(TocStyleMappingSchema, {
        description:
          'Custom style mappings for TOC entries. Maps custom theme styles to TOC levels.',
      })
    ),
  },
  {
    description: 'Table of Contents component props',
    additionalProperties: false,
  }
);

export type TocProps = Static<typeof TocPropsSchema>;
