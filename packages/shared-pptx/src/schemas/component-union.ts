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
