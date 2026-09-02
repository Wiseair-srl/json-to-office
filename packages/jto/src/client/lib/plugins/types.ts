/**
 * Types shared by the in-browser plugin system: the compiled record the
 * store keeps, the metadata the sandbox reports, and the wire protocol
 * between the page and a plugin's worker.
 */

export type PluginFormat = 'docx' | 'pptx';

/** One semver-keyed version of a component, as the sandbox describes it. */
export interface PluginVersionMetadata {
  version: string;
  /** The TypeBox props schema, JSON-roundtripped (no Kind symbols). */
  propsSchema: Record<string, unknown>;
  hasChildren: boolean;
  description?: string;
}

export interface PluginExample {
  title?: string;
  description?: string;
  props: unknown;
}

export interface BrowserPluginMetadata {
  /** The component name documents use in `name`. */
  name: string;
  format: PluginFormat;
  versions: PluginVersionMetadata[];
  latest: string;
  examples: PluginExample[];
}

export interface PluginDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** Who produced it: the TypeScript compiler, the sandbox, or the playground itself. */
  source: 'typescript' | 'sandbox' | 'playground';
  /** Machine-readable kind for playground diagnostics the sync re-evaluates. */
  code?: 'name-conflict' | 'timeout' | 'network-off';
  line?: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export type BrowserPluginStatus = 'idle' | 'compiling' | 'ready' | 'error';

export interface BrowserPluginRecord {
  /** The workspace file this plugin was compiled from (`*.component.ts`). */
  docName: string;
  /** Take part in schema generation and expansion. */
  enabled: boolean;
  /** Leave `fetch` and friends available inside the sandbox. */
  allowNetwork: boolean;
  status: BrowserPluginStatus;
  /** Hash of the source `js`/`metadata` were produced from. */
  sourceHash: string;
  /** Compiled CommonJS; present once a compile succeeded. */
  js?: string;
  metadata?: BrowserPluginMetadata;
  diagnostics: PluginDiagnostic[];
  /** When the record was first created; the older of two same-named plugins keeps the name. */
  createdAt: number;
  updatedAt: number;
}

export interface PluginRenderWarning {
  message: string;
  context?: Record<string, unknown>;
}

/**
 * Prefix of the error a sandbox throws when a plugin reaches for the network
 * with its switch off; the page turns it into a diagnostic that names the
 * switch instead of a bare ReferenceError.
 */
export const NETWORK_OFF_MARKER = '[plugin-network-off]';

// ---- Sandbox protocol ----

export interface SandboxLoadRequest {
  id: number;
  type: 'load';
  js: string;
  format: PluginFormat;
  allowNetwork: boolean;
  examples: PluginExample[];
}

export interface SandboxRenderRequest {
  id: number;
  type: 'render';
  version?: string;
  props: unknown;
  theme: unknown;
  children?: unknown[];
}

export type SandboxRequest = SandboxLoadRequest | SandboxRenderRequest;

export interface SandboxLoadedResponse {
  id: number;
  type: 'loaded';
  metadata: BrowserPluginMetadata;
}

export interface SandboxRenderedResponse {
  id: number;
  type: 'rendered';
  components: unknown[];
  warnings: PluginRenderWarning[];
}

export interface SandboxErrorResponse {
  id: number;
  type: 'error';
  message: string;
  stack?: string;
}

export type SandboxResponse =
  | SandboxLoadedResponse
  | SandboxRenderedResponse
  | SandboxErrorResponse;
