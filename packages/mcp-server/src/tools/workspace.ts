/**
 * `jto_workspace_*` — connection-scoped documents an agent edits in place.
 *
 * The point is the round trip an agent does NOT have to make: open a document
 * once, read the two pointers it cares about, send a five-operation patch, and
 * never put the whole tree back through the model. The JSON stays
 * authoritative — a workspace holds exactly the document you gave it, and
 * every other tool takes `handle` wherever it takes `document` (#271).
 *
 * Deliberately not validated on write. Half-finished authoring states are the
 * normal case here: an agent adds a section, then its heading, then its rows,
 * and a store that rejected the intermediate steps would force it back to
 * whole-document rewrites — the exact cost this feature removes. Validation is
 * `jto_validate` with the handle, whenever the agent wants it. The single
 * exception is the root's type, which the store refuses to make a non-object:
 * every other bad state can be read back and patched, that one cannot.
 *
 * Every output schema here marks only `ok` and `diagnostics` as required. The
 * SDK validates outgoing `structuredContent` and, when it does not match,
 * throws the whole result away in favour of an isError text blob — so listing
 * `workspace` as required would mean that every failure, which by design
 * carries diagnostics and nothing else, reached the agent as an unreadable
 * protocol-ish error instead of the repairable one it is.
 */

import type { McpServer } from '@modelcontextprotocol/server';

import type { ToolDeps } from '../lib/deps.js';
import {
  FORMAT_NAMES,
  S,
  artifactSchema,
  formatSchema,
  outputSchema,
} from '../lib/schema.js';
import type { FormatName } from '../lib/adapters.js';
import { deliverArtifact } from '../lib/artifacts.js';
import {
  ERROR_CODES,
  diagnostic,
  guarded,
  success,
  toolResult,
  type Diagnostic,
} from '../lib/errors.js';
import {
  hasWorkspaceStore,
  type JsonPatchOperation,
  type WorkspaceRecord,
  type WorkspaceStore,
} from '../lib/workspace-store.js';
import { PATCH_OPS } from '../workspace/json-patch.js';
import {
  createMemoryWorkspaceStore,
  type MemoryWorkspaceStore,
  type WorkspaceLimits,
} from '../workspace/store.js';

const workspaceSchema = {
  type: 'object' as const,
  description: 'The state of one open document.',
  properties: {
    handle: {
      type: 'string' as const,
      description: 'Opaque, valid only on this connection.',
    },
    format: { type: 'string' as const, enum: [...FORMAT_NAMES] },
    revision: {
      type: 'integer' as const,
      description:
        'Increments by one per committed patch. Pass it as `baseRevision` to make the next write conditional.',
    },
    bytes: {
      type: 'integer' as const,
      description: 'Size of the serialized document.',
    },
    createdAt: { type: 'string' as const },
    updatedAt: { type: 'string' as const },
    title: { type: 'string' as const },
    pinnedRevisions: {
      type: 'array' as const,
      items: { type: 'integer' as const },
      description:
        'Revisions kept retrievable by jto_workspace_snapshot; read one back with `revision`.',
    },
  },
  required: [
    'handle',
    'format',
    'revision',
    'bytes',
    'createdAt',
    'updatedAt',
    'pinnedRevisions',
  ],
  additionalProperties: false,
};

const limitsSchema = {
  type: 'object' as const,
  description:
    'What this connection allows. Bounded on purpose; see the codes above.',
  properties: {
    maxWorkspaces: { type: 'integer' as const },
    maxDocumentBytes: { type: 'integer' as const },
    maxTotalBytes: { type: 'integer' as const },
    idleTtlMs: {
      type: 'integer' as const,
      description:
        'Idle time after which a handle is released. Any use resets it.',
    },
    maxPinnedRevisions: { type: 'integer' as const },
  },
  required: [
    'maxWorkspaces',
    'maxDocumentBytes',
    'maxTotalBytes',
    'idleTtlMs',
    'maxPinnedRevisions',
  ],
  additionalProperties: false,
};

const pointerDescription =
  'RFC 6901 JSON Pointer. "" is the whole document, "/children/0/props/text" a member of it; "~0" escapes "~" and "~1" escapes "/".';

/** The skeleton `jto_workspace_create` opens when given no document. */
export function blankDocument(format: FormatName): Record<string, unknown> {
  return { name: format, props: {}, children: [] };
}

function isMemoryStore(store: WorkspaceStore): store is MemoryWorkspaceStore {
  return 'limits' in store && 'usage' in store;
}

/**
 * Give this connection a store, unless it already has one.
 *
 * The store is installed onto the `ToolDeps` the tools were registered with,
 * not into a module global: `deps` is what every other tool reads a handle
 * through, and it is per-connection, so two `createServer` calls in one
 * process cannot list or read each other's documents. That is the whole
 * meaning of "valid only on this connection" — a host serving several clients
 * builds `deps` per connection and gets isolation for free. The second
 * `createServer` of a legacy-protocol opening shares the first's store because
 * it shares its `deps`, which is the same connection.
 *
 * A host can still supply `deps.workspaces` itself, or install a store
 * process-wide with `setWorkspaceStore` before `createServer` — including
 * `unavailableWorkspaceStore` to switch the feature off, which is why the
 * question asked here is "did the host install one", not "is it available".
 */
function ensureStore(deps: ToolDeps): void {
  if (deps.workspaces().available || hasWorkspaceStore()) return;
  const owned = createMemoryWorkspaceStore();
  deps.workspaces = () => owned;
}

export function register(server: McpServer, deps: ToolDeps): void {
  ensureStore(deps);

  server.registerTool(
    'jto_workspace_create',
    {
      title: 'Open a document workspace',
      description:
        'Hold a document on the server so later calls can name it by `handle` instead of resending the JSON. Returns the handle and revision 1. Omit `document` to start from an empty skeleton and patch content in. Nothing is validated here — call jto_validate when you want it.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        openWorldHint: false,
      },
      inputSchema: S<{
        format: FormatName;
        document?: Record<string, unknown>;
        title?: string;
      }>({
        type: 'object',
        properties: {
          format: formatSchema,
          document: {
            type: 'object',
            description:
              'The initial document JSON. Omitted, the workspace opens on an empty skeleton for this format.',
            additionalProperties: true,
          },
          title: {
            type: 'string',
            description:
              'Your own label for the workspace, echoed back by jto_workspace_list. Never read by the renderer.',
          },
        },
        required: ['format'],
        additionalProperties: false,
      }),
      outputSchema: S(outputSchema({ workspace: workspaceSchema })),
    },
    async (args) =>
      toolResult(
        await guarded(async () => {
          const seeded = args.document === undefined;
          const created = await deps.workspaces().create({
            format: args.format,
            document: seeded ? blankDocument(args.format) : args.document,
            ...(args.title !== undefined && { title: args.title }),
          });
          if (!created.ok) return created;

          return success(
            { workspace: created.record },
            seeded
              ? [
                  diagnostic(
                    'W_BLANK_DOCUMENT',
                    `Opened an empty ${args.format} skeleton; it has no content until you patch some in.`,
                    {
                      severity: 'info',
                      suggestion:
                        'Append with add operations on "/children/-", then validate.',
                    }
                  ),
                ]
              : []
          );
        })
      )
  );

  server.registerTool(
    'jto_workspace_inspect',
    {
      title: 'Read a workspace document',
      description:
        'Read an open document, or — with `paths` — only the JSON Pointers you name, which is the point of a workspace on anything large. Pointers that resolve nowhere come back in `missingPaths` rather than as null, so "absent" stays distinguishable from "present and null".',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: S<{
        handle: string;
        revision?: number;
        paths?: string[];
        includeDocument?: boolean;
      }>({
        type: 'object',
        properties: {
          handle: { type: 'string', minLength: 1 },
          revision: {
            type: 'integer',
            minimum: 1,
            description:
              'Read this exact revision: the current one, or one pinned by jto_workspace_snapshot. Anything else fails rather than quietly returning newer JSON.',
          },
          paths: {
            type: 'array',
            items: { type: 'string', description: pointerDescription },
            description:
              'Project only these locations. Omit to read the whole document.',
          },
          includeDocument: {
            type: 'boolean',
            description:
              'Return the whole document alongside a projection. Default false when `paths` is given, true when it is not.',
          },
        },
        required: ['handle'],
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema({
          workspace: workspaceSchema,
          document: {
            type: 'object',
            description:
              'The document at the revision named by `workspace.revision`.',
            additionalProperties: true,
          },
          projection: {
            type: 'object',
            description:
              'Requested pointer → value, for the pointers that resolved.',
            additionalProperties: true,
          },
          missingPaths: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Requested pointers that resolve nowhere in this revision.',
          },
        })
      ),
    },
    async (args) =>
      toolResult(
        await guarded(async () => {
          const read = await deps.workspaces().get(args.handle, {
            ...(args.revision !== undefined && { revision: args.revision }),
            ...(args.paths !== undefined && { paths: args.paths }),
          });
          if (!read.ok) return read;

          const projecting = args.paths !== undefined;
          const includeDocument = args.includeDocument ?? !projecting;
          const projection = read.projection ?? {};
          const missingPaths = projecting
            ? (args.paths as string[]).filter(
                (pointer) => !(pointer in projection)
              )
            : [];

          const diagnostics: Diagnostic[] = missingPaths.map((pointer) =>
            diagnostic(
              'W_PATH_NOT_FOUND',
              `${pointer} does not resolve in revision ${read.record.revision}.`,
              {
                severity: 'warning',
                path: pointer,
                suggestion:
                  'Read a shorter prefix of the pointer to see what is actually there.',
              }
            )
          );

          return success(
            {
              workspace: read.record,
              ...(includeDocument && { document: read.document }),
              ...(projecting && { projection, missingPaths }),
            },
            diagnostics
          );
        })
      )
  );

  server.registerTool(
    'jto_workspace_patch',
    {
      title: 'Patch a workspace document',
      description:
        'Apply an RFC 6902 patch atomically: the whole patch is checked, applied to a copy, and committed only if every operation lands — a failure leaves the document exactly as it was and does not burn a revision. Pass `baseRevision` to make the write conditional on the document not having moved. Invalid intermediate states are kept on purpose; validate when you are ready.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      },
      inputSchema: S<{
        handle: string;
        operations: JsonPatchOperation[];
        baseRevision?: number;
      }>({
        type: 'object',
        properties: {
          handle: { type: 'string', minLength: 1 },
          operations: {
            type: 'array',
            minItems: 1,
            description: 'RFC 6902 operations, applied in order.',
            items: {
              type: 'object',
              properties: {
                op: { type: 'string', enum: [...PATCH_OPS] },
                path: { type: 'string', description: pointerDescription },
                from: {
                  type: 'string',
                  description: 'Source pointer for `move` and `copy`.',
                },
                value: {
                  description:
                    'JSON to write, for `add`, `replace` and `test`. Any type, including null.',
                },
              },
              required: ['op', 'path'],
              additionalProperties: false,
            },
          },
          baseRevision: {
            type: 'integer',
            minimum: 1,
            description:
              'Revision you built this patch against. When it no longer matches, the write fails with E_STALE_REVISION and nothing is applied.',
          },
        },
        required: ['handle', 'operations'],
        additionalProperties: false,
      }),
      outputSchema: S(outputSchema({ workspace: workspaceSchema })),
    },
    async (args) =>
      toolResult(
        await guarded(async () => {
          const patched = await deps.workspaces().patch({
            handle: args.handle,
            operations: args.operations,
            ...(args.baseRevision !== undefined && {
              baseRevision: args.baseRevision,
            }),
          });
          if (!patched.ok) return patched;
          return success({ workspace: patched.record });
        })
      )
  );

  server.registerTool(
    'jto_workspace_snapshot',
    {
      title: 'Snapshot a workspace document',
      description:
        'Export the authoritative JSON and pin the revision it was taken at, so jto_workspace_inspect can still read that exact tree after later patches. Take one before a restructuring you could not cleanly undo. With `filename` the JSON is written under the server output root and returned as a path instead of inline.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: S<{ handle: string; filename?: string }>({
        type: 'object',
        properties: {
          handle: { type: 'string', minLength: 1 },
          filename: {
            type: 'string',
            description:
              'Write the snapshot here, relative to the output root, instead of returning it inline. Must not escape the root: no absolute paths, no "..".',
          },
        },
        required: ['handle'],
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema({
          workspace: workspaceSchema,
          document: {
            type: 'object',
            description: 'The snapshot, when it was not written to a file.',
            additionalProperties: true,
          },
          artifact: {
            ...artifactSchema,
            description: 'The written snapshot, when `filename` was given.',
          },
        })
      ),
    },
    async (args) =>
      toolResult(
        await guarded(async () => {
          const snapshot = await deps.workspaces().snapshot(args.handle);
          if (!snapshot.ok) return snapshot;

          const diagnostics: Diagnostic[] = [];
          if (
            !snapshot.record.pinnedRevisions.includes(snapshot.record.revision)
          ) {
            // The document is in hand either way; only the "come back to this
            // revision later" half was refused, and silently is not an option.
            diagnostics.push(
              diagnostic(
                'W_SNAPSHOT_NOT_PINNED',
                `Revision ${snapshot.record.revision} was exported but not pinned: this connection's workspace budget is full.`,
                {
                  severity: 'warning',
                  suggestion:
                    'Keep this JSON yourself, or close workspaces you are done with before the next snapshot.',
                }
              )
            );
          }

          if (args.filename === undefined) {
            return success(
              { workspace: snapshot.record, document: snapshot.document },
              diagnostics
            );
          }

          const written = await deliverArtifact(
            Buffer.from(
              `${JSON.stringify(snapshot.document, null, 2)}\n`,
              'utf8'
            ),
            {
              filename: args.filename,
              mimeType: 'application/json',
              outputRoot: deps.outputRoot,
            }
          );
          if (!written.ok) return written;
          return success(
            { workspace: snapshot.record, artifact: written.artifact },
            diagnostics
          );
        })
      )
  );

  server.registerTool(
    'jto_workspace_list',
    {
      title: 'List open workspaces',
      description:
        'Every document open on this connection, with its revision and size. Call this to recover handles you no longer have — it is the cheapest way back after losing track of what you opened. An empty list means nothing is open, not that anything failed.',
      annotations: { readOnlyHint: true, openWorldHint: false },
      inputSchema: S<Record<string, never>>({
        type: 'object',
        properties: {},
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema({
          workspaces: { type: 'array', items: workspaceSchema },
          available: {
            type: 'boolean',
            description:
              'False when this connection has workspaces switched off.',
          },
          limits: limitsSchema,
          usage: {
            type: 'object',
            properties: {
              workspaces: { type: 'integer' },
              bytes: { type: 'integer' },
            },
            required: ['workspaces', 'bytes'],
            additionalProperties: false,
          },
        })
      ),
    },
    async () =>
      toolResult(
        await guarded(async () => {
          const store = deps.workspaces();
          const listed = await store.list();
          if (!listed.ok) return listed;

          const budget: {
            limits?: WorkspaceLimits;
            usage?: ReturnType<MemoryWorkspaceStore['usage']>;
          } = isMemoryStore(store)
            ? { limits: store.limits, usage: store.usage() }
            : {};

          return success({
            workspaces: listed.records as WorkspaceRecord[],
            available: store.available,
            ...budget,
          });
        })
      )
  );

  server.registerTool(
    'jto_workspace_close',
    {
      title: 'Close a workspace',
      description:
        'Release a handle and the memory behind it, including its pinned snapshots. Idempotent: closing a handle that is already gone reports `closed: false` rather than failing. Snapshot anything you still want first — closing is not recoverable.',
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
      inputSchema: S<{ handle: string }>({
        type: 'object',
        properties: { handle: { type: 'string', minLength: 1 } },
        required: ['handle'],
        additionalProperties: false,
      }),
      outputSchema: S(
        outputSchema({
          handle: { type: 'string' },
          closed: {
            type: 'boolean',
            description: 'False when the handle was already closed or evicted.',
          },
        })
      ),
    },
    async (args) =>
      toolResult(
        await guarded(async () => {
          const closed = await deps.workspaces().close(args.handle);
          if (!closed.ok) return closed;
          return success(
            { handle: closed.handle, closed: closed.closed },
            closed.closed
              ? []
              : [
                  diagnostic(
                    ERROR_CODES.UNKNOWN_HANDLE,
                    `No workspace ${args.handle} was open; nothing to close.`,
                    { severity: 'info' }
                  ),
                ]
          );
        })
      )
  );
}
