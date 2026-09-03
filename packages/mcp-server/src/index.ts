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
  createMemoryWorkspaceStore,
  DEFAULT_WORKSPACE_LIMITS,
  WORKSPACE_ERROR_CODES,
  type MemoryWorkspaceStore,
  type MemoryWorkspaceStoreOptions,
  type WorkspaceLimits,
} from './workspace/store.js';

export {
  createWorkspacePersistence,
  createWorkspacePersistenceAt,
  DEFAULT_PERSISTENCE_LIMITS,
  WORKSPACE_DIR_ENV,
  type PersistenceLimits,
  type WorkspacePersistence,
  type WorkspacePersistenceOptions,
} from './workspace/persistence.js';

export {
  getAdapter,
  resetAdapters,
  checkRenderer,
  withRenderer,
  type FormatAdapter,
  type FormatName,
} from './lib/adapters.js';

export { SERVER_NAME, SERVER_VERSION, PACKAGE_NAME } from './lib/version.js';

// The preview pipeline as a library. `tools/preview.ts` is the MCP surface
// over it; the design-evals harness renders the same way an agent would look
// at a document, which is only true if it goes through the same code.
export {
  renderPreview,
  type PreviewRenderResult,
  type PreviewRenderSuccess,
  type RenderedPage,
} from './preview/render.js';
export {
  buildContactSheet,
  ContactSheetError,
  type ContactSheet,
  type ContactSheetPage,
} from './preview/contact-sheet.js';
