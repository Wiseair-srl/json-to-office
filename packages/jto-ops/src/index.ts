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
