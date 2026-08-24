/**
 * Library surface.
 *
 * The package's real entry point is the `jto-mcp` binary; this exists so a
 * host can embed the same server over a transport of its own, and so the
 * plumbing every tool module is built on is importable by tests.
 */

export {
  createServer,
  createServerFactory,
  SERVER_INSTRUCTIONS,
} from './server.js';

export {
  createToolDeps,
  type ToolDeps,
  type CreateToolDepsOptions,
} from './lib/deps.js';

export {
  S,
  FORMAT_NAMES,
  formatSchema,
  documentSourceProperties,
  documentSourceSchema,
  DOCUMENT_SOURCE_RULE,
  renderOptionProperties,
  artifactOutputProperties,
  diagnosticSchema,
  diagnosticsSchema,
  envelopeProperties,
  artifactSchema,
  sourceSummarySchema,
  outputSchema,
  type DocumentSourceInput,
  type RenderOptionsInput,
  type ArtifactOutputInput,
  type SourceSummary,
} from './lib/schema.js';

export {
  ERROR_CODES,
  OPTION_ERROR_CODES,
  countDiagnostics,
  diagnostic,
  diagnosticsFromThrown,
  failure,
  failureFrom,
  fromValidationError,
  fromValidationErrors,
  guarded,
  success,
  toJsonPointer,
  toolResult,
  validationDiagnostics,
  type Diagnostic,
  type DiagnosticCounts,
  type DiagnosticSeverity,
  type ErrorCode,
  type Failure,
  type ToolEnvelope,
} from './lib/errors.js';

export {
  createOutputRoot,
  checkOutputName,
  OUTPUT_DIR_ENV,
  type OutputRoot,
  type OutputRootOptions,
  type ResolvedOutputPath,
} from './lib/output-root.js';

export {
  deliverArtifact,
  MAX_INLINE_ARTIFACT_BYTES,
  MIME_TYPES,
  type Artifact,
  type ArtifactMode,
  type DeliverArtifactOptions,
  type DeliverArtifactResult,
} from './lib/artifacts.js';

export {
  resolveDocumentSource,
  parseDocumentJson,
  sourceSummary,
  type ResolvedDocument,
} from './lib/doc-source.js';

export {
  getWorkspaceStore,
  setWorkspaceStore,
  unavailableWorkspaceStore,
  type JsonPatchOperation,
  type WorkspaceRecord,
  type WorkspaceResult,
  type WorkspaceStore,
} from './lib/workspace-store.js';

export {
  getAdapter,
  resetAdapters,
  checkRenderer,
  withRenderer,
  type FormatAdapter,
  type FormatName,
} from './lib/adapters.js';

export { SERVER_NAME, SERVER_VERSION, PACKAGE_NAME } from './lib/version.js';
