import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '../createComponent';
import type { ComponentDefinition } from '@json-to-office/shared';

/**
 * Text space after component configuration schema
 */
const TextSpaceAfterPropsSchema = Type.Object(
  {
    text: Type.String({
      description: 'Text to display',
    }),
    spaceAfter: Type.Optional(
      Type.Number({
        default: 1,
        description: 'Space after text in points',
      })
    ),
  },
  {
    additionalProperties: false,
  }
);

/**
 * Text space after component that adds space after text
 *
 * @example
 * ```json
 * {
 *   "name": "text-space-after",
 *   "props": {
 *     "text": "Hello, world!",
 *     "spaceAfter": 100
 *   }
 * }
 * ```
 */
export const textSpaceAfterComponent = createComponent({
  name: 'text-space-after',
  versions: {
    '1.0.0': createVersion({
      propsSchema: TextSpaceAfterPropsSchema,
      description: 'Adds space after text',

      render: async ({ props }) => {
        const components: ComponentDefinition[] = [
          {
            name: 'paragraph',
            props: {
              text: props.text,
              spacing: {
                after: props.spaceAfter,
              },
            },
          },
        ];

        return components;
      },
    }),
  },
});
