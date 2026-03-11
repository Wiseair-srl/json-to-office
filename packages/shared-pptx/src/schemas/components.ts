/**
 * PPTX TypeBox Component Schemas
 *
 * IMPORTANT: Standard components are defined in component-registry.ts (SINGLE SOURCE OF TRUTH).
 * This file uses that registry to generate TypeBox schemas.
 */

import { Type, Static } from '@sinclair/typebox';
import { createAllPptxComponentSchemas } from './component-registry';

export * from './components/common';
export * from './components/presentation';
export * from './components/slide';
export * from './components/text';
export * from './components/image';
export * from './components/shape';
export * from './components/table';
export * from './components/highcharts';

// ============================================================================
// Component Definitions with Discriminated Union
// ============================================================================

export const PptxStandardComponentDefinitionSchema = Type.Union(
  [...createAllPptxComponentSchemas(Type.Any())],
  {
    discriminator: { propertyName: 'name' },
    description: 'Standard PPTX component definition with discriminated union',
  }
);

export const PptxComponentDefinitionSchema = Type.Recursive((This) =>
  Type.Union(
    [...createAllPptxComponentSchemas(This)],
    {
      discriminator: { propertyName: 'name' },
      description: 'PPTX component definition with discriminated union',
    }
  )
);

// ============================================================================
// TypeScript Types
// ============================================================================

export type PptxComponentDefinition = Static<typeof PptxComponentDefinitionSchema>;
