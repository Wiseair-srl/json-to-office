import { Type } from '@sinclair/typebox';
import { createComponent, createVersion } from '../createComponent';
import type { ComponentDefinition } from '@json-to-office/shared';

/**
 * Columns layout component configuration schema
 * This component has no props - it only contains children
 */
const ColumnsLayoutPropsSchema = Type.Object(
  {},
  {
    additionalProperties: false,
  }
);

/**
 * Columns layout component that renders a list of components in a 2-column layout
 *
 * @example
 * ```json
 * {
 *   "name": "columnsLayout",
 *   "children": [
 *     {
 *       "name": "paragraph",
 *       "props": {
 *         "content": "Left column content"
 *       }
 *     },
 *     {
 *       "name": "paragraph",
 *       "props": {
 *         "content": "Right column content"
 *       }
 *     }
 *   ]
 * }
 * ```
 */
export const columnsLayoutComponent = createComponent({
  name: 'columnsLayout',
  versions: {
    '1.0.0': createVersion({
      propsSchema: ColumnsLayoutPropsSchema,
      hasChildren: true,
      description: 'Renders a list of components in a 2-column layout',

      render: async ({ children }) => {
        return [
          {
            name: 'columns',
            props: {
              columns: 2,
            },
            children: (children || []) as ComponentDefinition[],
          } as ComponentDefinition,
        ];
      },
    }),
  },
});
