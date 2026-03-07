/**
 * TypeBox Component Schemas
 *
 * Complete component definitions with discriminated unions for perfect
 * JSON schema autocompletion and validation.
 *
 * IMPORTANT: Standard components are defined in component-registry.ts (SINGLE SOURCE OF TRUTH).
 * This file uses that registry to generate TypeBox schemas.
 */

import { Type, Static } from '@sinclair/typebox';
import { createAllComponentSchemas } from './component-registry';

// Re-export all schemas from individual component files
export * from './components/common';
export * from './components/report';
export * from './components/section';
export * from './components/columns';
export * from './components/heading';
export * from './components/paragraph';
export * from './components/image';
export * from './components/highcharts';
export * from './components/statistic';
export * from './components/table';
export * from './components/header';
export * from './components/footer';
export * from './components/list';
export * from './components/toc';
export * from './components/text-box';

// ============================================================================
// Component Definitions with Discriminated Union
// ============================================================================

// StandardComponentDefinitionSchema - Union of all standard component types
// Generated from the component registry (SINGLE SOURCE OF TRUTH)
export const StandardComponentDefinitionSchema = Type.Union(
  // Use Type.Any() for non-recursive standard components
  // Convert readonly array to mutable array for Type.Union
  [...createAllComponentSchemas(Type.Any())],
  {
    discriminator: { propertyName: 'name' },
    description:
      'Standard component definition with discriminated union',
  }
);

export const ComponentDefinitionSchema = Type.Recursive((This) =>
  Type.Union(
    [
      // Standard components from registry - SINGLE SOURCE OF TRUTH
      // Note: Report and section use special factory functions with recursive refs
      // Convert readonly array to mutable array for Type.Union
      ...createAllComponentSchemas(This),
    ],
    {
      discriminator: { propertyName: 'name' },
      description: 'Component definition with discriminated union',
    }
  )
);

// ============================================================================
// TypeScript Types
// ============================================================================

export type ComponentDefinition = Static<typeof ComponentDefinitionSchema>;
