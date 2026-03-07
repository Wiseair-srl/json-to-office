/**
 * Text Box Component Schema
 * A floating container that can hold child components (e.g., text, image, columns)
 *
 * Positioning API mirrors existing floating options from text/image for consistency.
 *
 * **Nested Columns Support:**
 * When a `columns` component is nested inside a `text-box`, it automatically renders
 * as a multi-column table instead of a section-level column layout. This allows
 * for columnar content within floating or inline containers.
 */

import { Type, Static } from '@sinclair/typebox';
import { FloatingPropertiesSchema } from './common';

export const TextBoxPropsSchema = Type.Object(
  {
    width: Type.Optional(
      Type.Union(
        [
          Type.Number({
            minimum: 1,
            description: 'Text box width in pixels',
          }),
          Type.String({
            pattern: '^\\d+(\\.\\d+)?%$',
            description:
              'Text box width as percentage (e.g., "50%") relative to content width',
          }),
        ],
        {
          description:
            'Text box width in pixels (number) or as percentage string (e.g., "50%")',
        }
      )
    ),
    height: Type.Optional(
      Type.Union(
        [
          Type.Number({
            minimum: 1,
            description: 'Text box height in pixels',
          }),
          Type.String({
            pattern: '^\\d+(\\.\\d+)?%$',
            description:
              'Text box height as percentage (e.g., "50%") relative to content height',
          }),
        ],
        {
          description:
            'Text box height in pixels (number) or as percentage string (e.g., "50%")',
        }
      )
    ),
    floating: Type.Optional(FloatingPropertiesSchema),
    style: Type.Optional(
      Type.Object(
        {
          padding: Type.Optional(
            Type.Object(
              {
                top: Type.Optional(Type.Number({ minimum: 0 })),
                right: Type.Optional(Type.Number({ minimum: 0 })),
                bottom: Type.Optional(Type.Number({ minimum: 0 })),
                left: Type.Optional(Type.Number({ minimum: 0 })),
              },
              { additionalProperties: false }
            )
          ),
          border: Type.Optional(
            Type.Object(
              {
                top: Type.Optional(
                  // Reuse border schema semantics: style/width/color
                  Type.Object({
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
                    color: Type.Optional(Type.String()),
                  })
                ),
                right: Type.Optional(
                  Type.Object({
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
                    color: Type.Optional(Type.String()),
                  })
                ),
                bottom: Type.Optional(
                  Type.Object({
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
                    color: Type.Optional(Type.String()),
                  })
                ),
                left: Type.Optional(
                  Type.Object({
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
                    color: Type.Optional(Type.String()),
                  })
                ),
              },
              { additionalProperties: false }
            )
          ),
          shading: Type.Optional(
            Type.Object(
              {
                fill: Type.Optional(Type.String()),
              },
              { additionalProperties: false }
            )
          ),
        },
        { additionalProperties: false }
      )
    ),
  },
  { additionalProperties: false }
);

export type TextBoxProps = Static<typeof TextBoxPropsSchema>;
