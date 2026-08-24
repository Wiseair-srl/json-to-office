/**
 * Format-independent rendering infrastructure.
 *
 * DOCX and PPTX each compile their authoring tree to their own IR and hand it to
 * a backend adapter. Everything those two pipelines have in common — the
 * renderer contract, capability diffing, and structured diagnostics — lives
 * here; nothing format-specific does.
 *
 * See `docs/architecture/office-renderer-ir.md`.
 */

export type { OfficeFormat, OfficeRenderer, RenderOptions } from './types';
export { assertNever } from './types';

export type {
  RendererDiagnostic,
  RendererDiagnosticSeverity,
  UnsupportedRendererFeatureErrorInit,
} from './diagnostics';
export {
  UnknownRendererError,
  UnsupportedRendererFeatureError,
  partitionDiagnostics,
  rendererError,
  rendererWarning,
} from './diagnostics';

export type { FeatureRequirement } from './capabilities';
export {
  FeatureRequirementCollector,
  RendererRegistry,
  assertRendererSupports,
  diagnoseUnsupportedFeatures,
} from './capabilities';

export type {
  ChartAxisEdits,
  ChartPartInput,
  ChartPartSeries,
} from './chart-parts';
export {
  CHART_PACKAGE_RELATIONSHIP,
  CHART_WORKBOOK_CONTENT_TYPE,
  CHART_WORKBOOK_SHEET_NAME,
  categoryReference,
  chartInputSignature,
  chartPartSignature,
  chartWorkbookParts,
  chartWorkbookRelsXml,
  columnLetter,
  matchChartParts,
  seriesNameReference,
  seriesValueReference,
  spliceChartXml,
} from './chart-parts';
