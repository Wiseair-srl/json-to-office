/**
 * What every tool module is handed at registration.
 *
 * Tools reach for nothing else process-wide: the output root, the adapters and
 * the workspace store all arrive here, so a test can stand a whole server up
 * on a temp directory and a fake store without mutating global state.
 */

import { getAdapter, type FormatAdapter, type FormatName } from './adapters.js';
import { MAX_INLINE_ARTIFACT_BYTES } from './artifacts.js';
import { createOutputRoot, type OutputRoot } from './output-root.js';
import { SERVER_VERSION } from './version.js';
import { getWorkspaceStore, type WorkspaceStore } from './workspace-store.js';
import {
  createWorkspacePersistence,
  type WorkspacePersistence,
} from '../workspace/persistence.js';

export interface ToolDeps {
  /** `@json-to-office/mcp-server`'s own version, as reported by `jto_info`. */
  serverVersion: string;
  /** The only directory the server writes to. */
  outputRoot: OutputRoot;
  /** Memoized format adapters from `@json-to-office/jto-ops`. */
  getAdapter(format: FormatName): FormatAdapter;
  /**
   * The connection's workspace store.
   *
   * A function, not a value: #271 installs the real store after the tools are
   * registered, and a snapshot taken at registration would pin the stand-in.
   */
  workspaces(): WorkspaceStore;
  /**
   * Disk backing for that store (#290), when a root was configured.
   *
   * Undefined is the default and means memory-only handles. It lives here
   * rather than inside the store because `tools/workspace.ts` is what builds
   * the connection's store, and `jto_info` reports the root without touching
   * one.
   */
  workspacePersistence?: WorkspacePersistence;
  /** Ceiling for `outputMode: 'base64'`, in bytes. */
  maxInlineArtifactBytes: number;
}

export interface CreateToolDepsOptions {
  /** `--output-dir`, or an already-built root (tests hand one in). */
  outputDir?: string;
  outputRoot?: OutputRoot;
  /** `--workspace-dir`. Absent, `JTO_MCP_WORKSPACE_DIR` decides. */
  workspaceDir?: string;
  /** An already-built persistence layer, for hosts and tests. */
  workspacePersistence?: WorkspacePersistence;
  env?: NodeJS.ProcessEnv;
  serverVersion?: string;
  workspaces?: () => WorkspaceStore;
  getAdapter?: (format: FormatName) => FormatAdapter;
  maxInlineArtifactBytes?: number;
}

export function createToolDeps(options: CreateToolDepsOptions = {}): ToolDeps {
  const workspacePersistence =
    options.workspacePersistence ??
    createWorkspacePersistence({
      ...(options.workspaceDir !== undefined && {
        flagDir: options.workspaceDir,
      }),
      ...(options.env !== undefined && { env: options.env }),
    });

  return {
    serverVersion: options.serverVersion ?? SERVER_VERSION,
    outputRoot:
      options.outputRoot ??
      createOutputRoot({
        ...(options.outputDir !== undefined && { flagDir: options.outputDir }),
        ...(options.env !== undefined && { env: options.env }),
      }),
    getAdapter: options.getAdapter ?? getAdapter,
    workspaces: options.workspaces ?? getWorkspaceStore,
    ...(workspacePersistence !== undefined && { workspacePersistence }),
    maxInlineArtifactBytes:
      options.maxInlineArtifactBytes ?? MAX_INLINE_ARTIFACT_BYTES,
  };
}
