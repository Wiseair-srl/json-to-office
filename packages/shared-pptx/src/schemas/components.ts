/**
 * PPTX TypeBox Component Schemas
 *
 * IMPORTANT: Standard components are defined in component-registry.ts (SINGLE SOURCE OF TRUTH).
 * This file uses that registry to generate TypeBox schemas.
 */

export * from './components/common';
export * from './components/presentation';
export * from './components/slide';
export * from './components/text';
export * from './components/image';
export * from './components/shape';
export * from './components/table';
export * from './components/highcharts';

// Component Definition Schemas (discriminated union)
export {
  PptxStandardComponentDefinitionSchema,
  PptxComponentDefinitionSchema,
} from './component-union';
export type { PptxComponentDefinition } from './component-union';
