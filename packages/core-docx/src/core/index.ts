/**
 * Core module exports
 * Functional document generation API
 */

// Main API
export {
  generateDocument,
  generateFromConfig,
  saveDocument,
  generateAndSave,
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

// Content creation functions
export {
  createText,
  createHeading,
  createTitleContent,
  createImage,
  createStatistic,
  createTable,
  createHeaderElement,
  createFooterElement,
  createHeaderFooterTable,
} from './content';

// Rendering functions
export { renderDocument, renderSection, renderComponent } from './render';
export {
  renderComponentWithCache,
  initializeComponentCache,
  getComponentCache,
  clearComponentCache,
  getComponentCacheStats,
  warmComponentCache,
} from './cached-render';

// Type exports
export type {
  ProcessedDocument,
  DocumentMetadata,
  ProcessedSection,
} from './structure';

export type { LayoutPlan, SectionLayout, LayoutGroup } from './layout';

export type {
  TextOptions,
  ImageOptions,
  TableOptions,
  StatisticData,
} from './content';
