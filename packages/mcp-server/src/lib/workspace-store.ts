/**
 * The workspace contract.
 *
 * #271 adds connection-scoped documents an agent edits by JSON Patch instead
 * of resending the whole tree. This module is the seam: the interface, the
 * holder for a host's process-wide override, and a stand-in that answers every
 * call with a structured "unavailable" so the inline path works untouched
 * before #271 lands and on any connection where workspaces are switched off.
 *
 * The holder is deliberately NOT where a connection's own store lives. Handles
 * are scoped to one connection, and a module-global default would hand the
 * second `createServer` in a process the first one's documents; the connection
 * store hangs off its `ToolDeps` instead (`../tools/workspace.ts`).
 *
 * The real store lives in `../workspace/store.ts`.
 *
 * Every method resolves rather than throws. A missing handle and a stale
 * revision are ordinary answers a tool reports to the agent, not server
 * failures (see `errors.ts`).
 */

import {
  ERROR_CODES,
  failure,
  type Diagnostic,
  type Failure,
} from './errors.js';
import type { FormatName } from './adapters.js';

/**
 * A success may still have something to say.
 *
 * `warnings` is how a store reports what did not go wrong enough to fail the
 * call — a revision that did not reach disk (#290) being the case that
 * matters: the edit landed, the handle works, and the agent still needs to
 * know it has stopped being recoverable. Tools fold these into the
 * `diagnostics` of the result they were already returning.
 */
export type WorkspaceResult<T> =
  | ({ ok: true; warnings?: Diagnostic[] } & T)
  | Failure;

/** RFC 6902 operation. Paths are RFC 6901 pointers — no private dialect (#271). */
export interface JsonPatchOperation {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  from?: string;
  value?: unknown;
}

/** What `jto_workspace_list` shows, and what every mutation returns. */
export interface WorkspaceRecord {
  /** Opaque, server-generated, meaningless outside this connection. */
  handle: string;
  format: FormatName;
  /** Starts at 1 on create; +1 per committed patch. Never reused, never decreases. */
  revision: number;
  /** Size of the serialized document, for the agent's own budgeting. */
  bytes: number;
  createdAt: string;
  updatedAt: string;
  /** Caller-supplied label, echoed back verbatim. */
  title?: string;
  /** Revisions pinned by `snapshot`, still retrievable through `get`. */
  pinnedRevisions: number[];
  /**
   * Whether this revision is on disk and so survives the connection (#290).
   * Absent when the store has no durable backing at all, which is the default.
   */
  persisted?: boolean;
}

export interface WorkspaceStore {
  /**
   * False on the stand-in. Tools read it to describe the connection's
   * capabilities (`jto_info`) without provoking an error.
   */
  readonly available: boolean;

  /** Open a document. The returned revision is 1. */
  create(input: {
    format: FormatName;
    document: unknown;
    title?: string;
  }): Promise<WorkspaceResult<{ record: WorkspaceRecord }>>;

  /**
   * Read a document.
   *
   * With `revision`, the read is checked: a revision that is neither current
   * nor pinned fails `E_STALE_REVISION` rather than quietly returning newer
   * JSON than the caller reasoned about. With `paths`, only those JSON
   * Pointers are projected, keyed by pointer — that is `jto_workspace_inspect`
   * on a large document.
   */
  get(
    handle: string,
    options?: { revision?: number; paths?: readonly string[] }
  ): Promise<
    WorkspaceResult<{
      record: WorkspaceRecord;
      document: unknown;
      /** Present only when `paths` was given. */
      projection?: Record<string, unknown>;
    }>
  >;

  /**
   * Apply a patch atomically.
   *
   * Syntax and paths are checked, the patch is applied to a copy, and only a
   * clean apply commits and bumps the revision — a half-applied document is
   * never observable. `baseRevision` makes the write conditional; omitting it
   * is a deliberate last-writer-wins.
   */
  patch(input: {
    handle: string;
    operations: readonly JsonPatchOperation[];
    baseRevision?: number;
  }): Promise<WorkspaceResult<{ record: WorkspaceRecord }>>;

  /**
   * Export the document and pin the revision it was taken at.
   *
   * The pin is what makes "snapshot before risky changes" real: after further
   * patches, `get(handle, pinnedRevision)` still returns this exact tree, so
   * an agent can compare or roll back without having kept the JSON in context.
   */
  snapshot(
    handle: string
  ): Promise<WorkspaceResult<{ record: WorkspaceRecord; document: unknown }>>;

  /** Every open handle on this connection. Recovers references after context loss. */
  list(): Promise<WorkspaceResult<{ records: WorkspaceRecord[] }>>;

  /** Release a handle and its memory. Idempotent: closing twice is not an error. */
  close(
    handle: string
  ): Promise<WorkspaceResult<{ handle: string; closed: boolean }>>;

  /**
   * Release every handle at once.
   *
   * A connection's store is reachable only through its `ToolDeps`, so the
   * documents go when the connection's deps do; this is for a host that wants
   * the memory back at a moment of its own choosing. It releases memory only —
   * a durable store keeps its copies, because an event that ends a connection
   * is exactly what #290 stops being fatal.
   */
  closeAll(): Promise<void>;
}

const unavailable = (): Failure =>
  failure(
    ERROR_CODES.WORKSPACES_UNAVAILABLE,
    'Document workspaces are not available on this connection.',
    {
      suggestion:
        'Pass the document inline via `document` instead of `handle`.',
    }
  );

/**
 * The no-workspaces implementation.
 *
 * Note `list` succeeds with an empty array: "no open documents" is a true and
 * useful answer, and failing it would make an agent think its own bookkeeping
 * broke.
 */
export const unavailableWorkspaceStore: WorkspaceStore = {
  available: false,
  async create() {
    return unavailable();
  },
  async get() {
    return unavailable();
  },
  async patch() {
    return unavailable();
  },
  async snapshot() {
    return unavailable();
  },
  async list() {
    return { ok: true, records: [] };
  },
  async close() {
    return unavailable();
  },
  async closeAll() {
    /* nothing is open */
  },
};

/**
 * The host's override, when it installed one.
 *
 * Undefined is not the same as `unavailableWorkspaceStore` here: nothing
 * installed means "let each connection open its own store", while an installed
 * stand-in means the host switched workspaces off and is to be left alone.
 * That distinction is why `hasWorkspaceStore` exists.
 */
let override: WorkspaceStore | undefined;

/** Install a process-wide store. Passing `undefined` removes the override. */
export function setWorkspaceStore(store: WorkspaceStore | undefined): void {
  override = store;
}

export function getWorkspaceStore(): WorkspaceStore {
  return override ?? unavailableWorkspaceStore;
}

/** Whether a host installed a store — `unavailableWorkspaceStore` included. */
export function hasWorkspaceStore(): boolean {
  return override !== undefined;
}
