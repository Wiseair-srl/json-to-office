import { TSchema } from '@sinclair/typebox';

/**
 * Base component definition interface, parameterized by category.
 * Both docx and pptx component registries extend this.
 */
export interface ComponentDefinition<
  TCategory extends string = 'container' | 'content' | 'layout',
> {
  name: string;
  propsSchema: TSchema;
  hasChildren: boolean;
  category: TCategory;
  description: string;
  special?: {
    hasSchemaField?: boolean;
  };
}
