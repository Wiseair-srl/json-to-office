/**
 * Component Schemas Index
 *
 * Re-exports all component schemas from individual files.
 */

// Common types and utilities
export * from './common';

// Individual component schemas
export * from './report';
export * from './section';
export * from './columns';
export * from './heading';
export * from './paragraph';
export * from './text-box';
export * from './image';
export * from './highcharts';
export * from './statistic';
export * from './table';
export * from './header';
export * from './footer';
export * from './list';
export * from './toc';

// Re-export from the main components file
export {
  ComponentDefinitionSchema,
  StandardComponentDefinitionSchema,
} from '../components';
