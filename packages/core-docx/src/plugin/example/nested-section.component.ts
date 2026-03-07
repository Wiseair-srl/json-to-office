import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '../createComponent';
import type { ComponentDefinition } from '@json-to-office/shared-docx';

/**
 * Custom component with nested sections
 */
const NestedSectionsSchema = Type.Object(
  {},
  {
    additionalProperties: false,
  }
);

/**
 * Nested sections component that generates nested sections for embedding in documents
 *
 * @example
 * ```json
 * {
 *   "name": "nestedSections",
 *   "props": {}
 * }
 * ```
 */
export const nestedSectionsComponent = createComponent({
  name: 'nestedSections',
  versions: {
    '1.0.0': createVersion({
      propsSchema: NestedSectionsSchema,
      description: 'Generates nested sections for embedding in documents',

      render: async () => {
        // Build component array with full type inference
        const components: ComponentDefinition[] = [];

        components.push({
          name: 'section',
          props: {
            title: 'First level 1 section',
            level: 1,
          },
          children: [
            {
              name: 'heading',
              props: {
                text: 'Level 2 heading of first level 1 section',
                level: 2,
              },
            },
            {
              name: 'paragraph',
              props: {
                text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
              },
            },
            {
              name: 'heading',
              props: {
                text: 'Level 2 heading of first level 1 section',
                level: 2,
              },
            },
            {
              name: 'paragraph',
              props: {
                text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
              },
            },
          ],
        });

        components.push({
          name: 'section',
          props: {
            title: 'Second level 1 section',
            level: 1,
          },
          children: [
            {
              name: 'heading',
              props: {
                text: 'Level 2 heading of second level 1 section',
                level: 2,
              },
            },
            {
              name: 'paragraph',
              props: {
                text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
              },
            },
          ],
        });

        return components;
      },
    }),
  },
});
