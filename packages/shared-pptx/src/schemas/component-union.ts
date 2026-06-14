/**
 * PPTX Component Definition Schemas (discriminated union)
 *
 * Extracted to its own file to break circular imports:
 * slide.ts → component-union.ts → component-registry.ts → slide.ts
 * ESM resolves this safely because SlidePropsSchema is a top-level declaration.
 */

import { Type, Static } from '@sinclair/typebox';
import {
  createAllPptxComponentSchemas,
  createAllPptxComponentSchemasNarrowed,
  createPptxComponentSchemaObject,
  getPptxContentComponents,
} from './component-registry';

export const PptxStandardComponentDefinitionSchema = Type.Union(
  [...createAllPptxComponentSchemas(Type.Any())],
  {
    discriminator: { propertyName: 'name' },
    description: 'Standard PPTX component definition with discriminated union',
  }
);

export const PptxComponentDefinitionSchema = Type.Recursive((This) =>
  Type.Union([...createAllPptxComponentSchemasNarrowed(This)], {
    discriminator: { propertyName: 'name' },
    description: 'PPTX component definition with discriminated union',
  })
);

export type PptxComponentDefinition = Static<
  typeof PptxComponentDefinitionSchema
>;

/**
 * A single PPTX slide content element — the discriminated union of the
 * leaf content components a slide can hold (text, image, shape, table,
 * highcharts, chart). Non-recursive (these components have no children), so it
 * embeds cleanly into other schemas (e.g. the docx `visual` component's
 * `elements`). The explicit `$id` lets JSON-Schema export hoist it into a
 * single shared `definitions` entry instead of inlining it at every use site.
 */
export const PptxSlideContentSchema = Type.Union(
  getPptxContentComponents().map((c) => createPptxComponentSchemaObject(c)),
  {
    $id: 'PptxSlideContent',
    discriminator: { propertyName: 'name' },
    description:
      'A single PPTX slide content element (text, image, shape, table, highcharts, or chart).',
  }
);

export type PptxSlideContent = Static<typeof PptxSlideContentSchema>;
