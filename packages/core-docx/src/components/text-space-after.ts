/**
 * Text Space After Custom Component
 * A text component with hardcoded spacing after the paragraph
 *
 * This component is provided as an example of the legacy custom component system.
 * For new custom components, use the plugin system instead:
 * @see packages/core/src/plugin/example/ for modern examples
 */

import { Type, Static } from '@sinclair/typebox';
import { createComponent, createVersion } from '../plugin/createComponent';
import type { ComponentDefinition } from '@json-to-office/shared-docx';

/**
 * Props schema for text-space-after component
 */
const TextSpaceAfterPropsSchema = Type.Object({
  text: Type.String({
    description: 'Text content to display',
  }),
  // Retained for backwards compatibility of props shape, but not applied
  spacing: Type.Optional(
    Type.Object({
      before: Type.Optional(Type.Number()),
      after: Type.Optional(Type.Number()),
    })
  ),
});

export type TextSpaceAfterProps = Static<typeof TextSpaceAfterPropsSchema>;

/**
 * Text space after component - adds hardcoded spacing after paragraphs
 */
export const textSpaceAfterComponent = createComponent({
  name: 'text-space-after',
  versions: {
    '1.0.0': createVersion({
      propsSchema: TextSpaceAfterPropsSchema,
      description: 'Text component with hardcoded spacing after the paragraph',
      render: async ({ props }) => {
        // Create paragraph component with hardcoded spacing after
        const result: ComponentDefinition = {
          name: 'paragraph',
          props: {
            text: props.text,
            spacing: {
              ...props.spacing,
              after: props.spacing?.after || 12,
            },
          },
        };

        return [result];
      },
    }),
  },
});
