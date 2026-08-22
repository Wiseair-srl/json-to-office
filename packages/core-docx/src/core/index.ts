/**
 * Core module exports
 * Functional document generation API
 */

// Main API
export {
  generateBufferFromJson,
  generateBufferWithWarnings,
  generateBufferFromConfig,
  generateBufferFromFile,
  generateAndSaveFromJson,
  generateAndSaveFromFile,
  DocumentGenerator,
} from './generator';

// Structure functions
export {
  processDocument,
  createDocumentMetadata,
  extractSections,
  flattenComponents,
  createRenderContext,
} from './structure';

// Layout functions
export {
  applyLayout,
  analyzeLayoutGroups,
  determineComponentLayout,
  processLayoutComponents,
  getColumnSettings,
  createSectionProperties,
  calculateColumnDistribution,
} from './layout';

// Compilation and rendering
export { compileDocumentToIr, generateBufferViaIr } from './generateFromIr';
export { desugarExternals } from './desugarExternals';

// Type exports
export type {
  ProcessedDocument,
  DocumentMetadata,
  ProcessedSection,
} from './structure';

export type { LayoutPlan, SectionLayout, LayoutGroup } from './layout';

export type { ImageOptions } from '../components/visual';
