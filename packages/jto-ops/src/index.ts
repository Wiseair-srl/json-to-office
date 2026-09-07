// Host-side operations shared by the CLI, the playground server and the MCP
// server: format adapters, the LibreOffice rasterizer and font staging.
// Deliberately free of terminal/UI dependencies — see `diagnostics.ts`.

// Format adapters
export {
  type FormatName,
  type FormatAdapter,
  type GeneratorOptions,
  type GeneratorResult,
  DocxFormatAdapter,
  PptxFormatAdapter,
  createAdapter,
} from './format-adapter.js';

// PPTX rasterizer (backs docx `visual` components)
export {
  createLibreOfficePptxRasterizer,
  createLibreOfficePptxBatchRasterizer,
  getRasterizerCacheStats,
  clearRasterizerCache,
  type RasterizerCacheStats,
} from './pptx-rasterizer.js';

// PDF text geometry — rendered ground truth for the quality estimators
export {
  parsePdfTextBbox,
  extractPdfTextGeometry,
  pdftotextAvailable,
  type PdfTextWord,
  type PdfTextLine,
  type PdfTextPage,
} from './pdf-text-geometry.js';

// Rendered-certainty pass (#344) — findings from the preview PDF, mapped
// back to authored pointers.
export {
  parsePdfFonts,
  extractPdfFonts,
  pdffontsAvailable,
  familyRendered,
  type PdfFontInfo,
} from './pdf-fonts.js';
export {
  analyzeRenderedDocument,
  VISIBLE_SPILL_PT,
  type RenderedAnalysis,
  type RenderedAnalysisInput,
  type RenderedAnalysisSummary,
  type RenderedMapping,
  type RenderedTextEntry,
  type RequestedFont,
} from './rendered-analysis.js';
export {
  RENDERED_QUALITY_RULES,
  type RenderedRuleId,
} from './rendered-rules.js';
export {
  assignInventory,
  authoredTextForMatch,
  normalizeForMatch,
  readingOrder,
  type InventoryEntry,
  type InventoryMatch,
  type MappingStatus,
  type TextOccurrence,
} from './rendered-text-match.js';

// Block boundary matrix (#343) — boundary documents for every embedded
// JSON block definition, for the static and rendered calibration suites.
export {
  enumerateBlockDefinitions,
  generateBlockMatrix,
  blockCaseDocument,
  reportCaseDocument,
  boundaryInvocation,
  boundarySlotValue,
  overBudgetInvocation,
  widestNumber,
  FALLBACK_FONTS,
  MATRIX_IMAGE,
  type BlockMatrixCase,
  type BlockMatrixDefinition,
  type BlockMatrixOptions,
  type CaseConditions,
  type MatrixCanvas,
  type MatrixEdge,
  type MatrixFont,
} from './block-matrix.js';

// LibreOffice font staging — used by the rasterizer above and by the
// playground's PDF-preview converter in `@json-to-office/jto`.
export {
  getFontStager,
  NoopFontStager,
  FontconfigStager,
  WindowsFontStager,
  MacOSCoreTextStager,
  type FontStager,
  type FontStageHandle,
  type FontStageOptions,
} from './font-staging/index.js';

// Diagnostics sink — hosts install one, this package never writes a stream.
export {
  emitDiagnostic,
  runWithDiagnosticSink,
  stderrDiagnosticSink,
  type DiagnosticSink,
  type DiagnosticTone,
} from './diagnostics.js';
