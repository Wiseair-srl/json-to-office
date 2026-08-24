/**
 * The in-memory workspace store (#271).
 *
 * Documents are held as **serialized JSON text**, not as live trees. That one
 * decision buys three of the issue's requirements outright:
 *
 * - Isolation. A read is a fresh `JSON.parse`, so a caller can mutate what it
 *   got and two workspaces can never share a subtree — the structural-sharing
 *   bug this feature invites cannot be written.
 * - Atomicity. A commit is a single string assignment after a successful
 *   apply; a patch that fails leaves the stored bytes untouched, literally.
 * - Accounting. `bytes` is the real size, already computed, so the count and
 *   byte budgets are exact rather than estimated.
 *
 * The cost is a parse and a stringify per operation, which for documents in
 * the tens to hundreds of kilobytes this format produces is far below the
 * round trip that made the agent call us.
 *
 * Nothing here throws: an unknown handle, a stale revision and a full store
 * are answers an agent repairs, so they come back as structured failures
 * (`lib/errors.ts`) exactly like a bad document does.
 */

import { randomBytes } from 'crypto';

import { ERROR_CODES, failure, type Failure } from '../lib/errors.js';
import type {
  JsonPatchOperation,
  WorkspaceRecord,
  WorkspaceStore,
} from '../lib/workspace-store.js';
import type { FormatName } from '../lib/adapters.js';
import { applyPatch, PATCH_ERROR_CODES, typeName } from './json-patch.js';
import {
  POINTER_ERROR_CODE,
  isRecord,
  parsePointer,
  resolvePointer,
} from './json-pointer.js';

/**
 * Workspace-lifecycle codes.
 *
 * Kept here rather than in `lib/errors.ts` (owned by #203, edited
 * concurrently); they read as ordinary diagnostic codes to a client. TTL
 * eviction gets its own code rather than reusing `E_UNKNOWN_HANDLE` because
 * an agent can reopen and carry on after an idle handle expires.
 */
export const WORKSPACE_ERROR_CODES = {
  EVICTED: 'E_WORKSPACE_EVICTED',
  LIMIT: 'E_WORKSPACE_LIMIT',
  DOCUMENT_TOO_LARGE: 'E_DOCUMENT_TOO_LARGE',
  INVALID_ROOT: 'E_INVALID_DOCUMENT_ROOT',
} as const;

export type EvictionReason = 'ttl' | 'closed';

export interface WorkspaceLimits {
  /** Open documents at once. */
  maxWorkspaces: number;
  /** Ceiling for a single serialized document. */
  maxDocumentBytes: number;
  /** Ceiling for every document and pinned snapshot together. */
  maxTotalBytes: number;
  /** Idle time after which a handle is dropped. Any read or write resets it. */
  idleTtlMs: number;
  /** Snapshots kept retrievable per workspace; new pins are refused at the cap. */
  maxPinnedRevisions: number;
}

/**
 * Deliberately modest.
 *
 * A workspace is a live authoring buffer for one agent on one stdio
 * connection, not a document store: sixteen open documents is already more
 * than an agent can hold in context, and the byte ceilings exist to stop a
 * runaway loop from turning a helper process into the machine's memory
 * problem. The idle TTL is half an hour because an agent's turn can stall on a
 * human for a long while, and losing a document mid-conversation is worse than
 * holding a few megabytes.
 */
export const DEFAULT_WORKSPACE_LIMITS: WorkspaceLimits = {
  maxWorkspaces: 16,
  maxDocumentBytes: 16 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
  idleTtlMs: 30 * 60 * 1000,
  maxPinnedRevisions: 8,
};

/** Tombstones kept so a dropped handle can still explain itself. */
const MAX_TOMBSTONES = 64;

export interface MemoryWorkspaceStoreOptions extends Partial<WorkspaceLimits> {
  /** Injectable clock; the TTL suite drives it instead of waiting. */
  now?: () => number;
  /** Injectable handle source, for tests that need predictable handles. */
  newHandle?: () => string;
}

export interface MemoryWorkspaceStore extends WorkspaceStore {
  readonly limits: WorkspaceLimits;
  /** Live totals, for `jto_workspace_list` to show the agent its budget. */
  usage(): { workspaces: number; bytes: number };
}

interface Pin {
  text: string;
  bytes: number;
}

interface Entry {
  handle: string;
  format: FormatName;
  revision: number;
  text: string;
  bytes: number;
  createdAt: number;
  updatedAt: number;
  /** Last read *or* write — what the idle TTL is measured from. */
  touchedAt: number;
  title?: string;
  pins: Map<number, Pin>;
}

interface Tombstone {
  reason: EvictionReason;
  at: number;
  revision: number;
}

export function createMemoryWorkspaceStore(
  options: MemoryWorkspaceStoreOptions = {}
): MemoryWorkspaceStore {
  const limits: WorkspaceLimits = {
    maxWorkspaces:
      options.maxWorkspaces ?? DEFAULT_WORKSPACE_LIMITS.maxWorkspaces,
    maxDocumentBytes:
      options.maxDocumentBytes ?? DEFAULT_WORKSPACE_LIMITS.maxDocumentBytes,
    maxTotalBytes:
      options.maxTotalBytes ?? DEFAULT_WORKSPACE_LIMITS.maxTotalBytes,
    idleTtlMs: options.idleTtlMs ?? DEFAULT_WORKSPACE_LIMITS.idleTtlMs,
    maxPinnedRevisions:
      options.maxPinnedRevisions ?? DEFAULT_WORKSPACE_LIMITS.maxPinnedRevisions,
  };
  const now = options.now ?? Date.now;
  const newHandle = options.newHandle ?? defaultHandle;

  /** Insertion-ordered, which is also the order `list` reports. */
  const entries = new Map<string, Entry>();
  const tombstones = new Map<string, Tombstone>();

  function footprint(entry: Entry): number {
    let total = entry.bytes;
    for (const pin of entry.pins.values()) total += pin.bytes;
    return total;
  }

  function totalBytes(): number {
    let total = 0;
    for (const entry of entries.values()) total += footprint(entry);
    return total;
  }

  function tombstone(entry: Entry, reason: EvictionReason): void {
    tombstones.set(entry.handle, {
      reason,
      at: now(),
      revision: entry.revision,
    });
    // Oldest first: `Map` preserves insertion order, and a re-set handle is
    // deleted before it is written, so the order stays honest.
    while (tombstones.size > MAX_TOMBSTONES) {
      const oldest = tombstones.keys().next();
      if (oldest.done) break;
      tombstones.delete(oldest.value);
    }
  }

  function evict(entry: Entry, reason: EvictionReason): void {
    entries.delete(entry.handle);
    tombstones.delete(entry.handle);
    tombstone(entry, reason);
  }

  /**
   * Drop whatever has gone idle.
   *
   * Lazy rather than on a timer: a `setInterval` in a library that a host
   * embeds is a handle that keeps an event loop alive and a surprise for
   * anyone who imports us in a test. Every entry point calls this first, so
   * the observable behaviour is the same.
   */
  function sweep(): void {
    const at = now();
    for (const entry of [...entries.values()]) {
      if (at - entry.touchedAt > limits.idleTtlMs) evict(entry, 'ttl');
    }
  }

  function missing(handle: string): Failure {
    const grave = tombstones.get(handle);
    if (grave?.reason === 'ttl') {
      return failure(
        WORKSPACE_ERROR_CODES.EVICTED,
        `Workspace ${handle} was released after ${Math.round(
          limits.idleTtlMs / 1000
        )}s of inactivity.`,
        {
          suggestion:
            'Re-create the workspace from your last snapshot, or pass the document inline.',
          context: { handle, reason: 'ttl', revision: grave.revision },
        }
      );
    }
    return failure(
      ERROR_CODES.UNKNOWN_HANDLE,
      grave
        ? `Workspace ${handle} was closed.`
        : `No workspace ${handle} is open on this connection.`,
      {
        suggestion:
          'Call jto_workspace_list for the open handles, or jto_workspace_create to open one.',
        context: { handle, ...(grave && { reason: 'closed' }) },
      }
    );
  }

  /** Capacity failures never destroy an unrelated workspace or snapshot. */
  function hasRoom(needed: number, forNewWorkspace: boolean): boolean {
    return (
      totalBytes() + needed <= limits.maxTotalBytes &&
      (!forNewWorkspace || entries.size < limits.maxWorkspaces)
    );
  }

  function toRecord(
    entry: Entry,
    view?: { revision: number; bytes: number }
  ): WorkspaceRecord {
    return {
      handle: entry.handle,
      format: entry.format,
      revision: view?.revision ?? entry.revision,
      bytes: view?.bytes ?? entry.bytes,
      createdAt: new Date(entry.createdAt).toISOString(),
      updatedAt: new Date(entry.updatedAt).toISOString(),
      ...(entry.title !== undefined && { title: entry.title }),
      pinnedRevisions: [...entry.pins.keys()].sort((a, b) => a - b),
    };
  }

  return {
    available: true,
    limits,

    usage() {
      sweep();
      return { workspaces: entries.size, bytes: totalBytes() };
    },

    async create(input) {
      sweep();

      const badRoot = rootMustBeObject(input.document, {
        format: input.format,
      });
      if (badRoot) return badRoot;

      const serialized = serialize(input.document);
      if (!serialized.ok) return serialized;
      if (serialized.bytes > limits.maxDocumentBytes) {
        return tooLarge(serialized.bytes, limits.maxDocumentBytes);
      }
      if (!hasRoom(serialized.bytes, true)) {
        return failure(
          WORKSPACE_ERROR_CODES.LIMIT,
          `A ${serialized.bytes}-byte document does not fit in the ${limits.maxTotalBytes}-byte workspace budget.`,
          {
            suggestion:
              'Pass the document inline instead of opening a workspace for it.',
            context: {
              bytes: serialized.bytes,
              maxTotalBytes: limits.maxTotalBytes,
              maxWorkspaces: limits.maxWorkspaces,
            },
          }
        );
      }

      const at = now();
      const entry: Entry = {
        handle: newHandle(),
        format: input.format,
        revision: 1,
        text: serialized.text,
        bytes: serialized.bytes,
        createdAt: at,
        updatedAt: at,
        touchedAt: at,
        ...(input.title !== undefined && { title: input.title }),
        pins: new Map(),
      };
      entries.set(entry.handle, entry);
      return { ok: true, record: toRecord(entry) };
    },

    async get(handle, readOptions) {
      sweep();
      const entry = entries.get(handle);
      if (!entry) return missing(handle);
      entry.touchedAt = now();

      let text = entry.text;
      let bytes = entry.bytes;
      let revision = entry.revision;
      const wanted = readOptions?.revision;
      if (wanted !== undefined && wanted !== entry.revision) {
        const pin = entry.pins.get(wanted);
        if (!pin) return stale(entry, wanted, toRecord(entry).pinnedRevisions);
        text = pin.text;
        bytes = pin.bytes;
        revision = wanted;
      }

      const document = JSON.parse(text) as unknown;

      // The record describes the document actually handed back, so a pinned
      // read reports the pinned revision — `lib/doc-source.ts` passes
      // `record.revision` on as "the revision this document is", and a
      // workspace that answered with the current one there would have every
      // downstream tool label an old tree with a new number.
      const record = toRecord(entry, { revision, bytes });

      if (!readOptions?.paths) return { ok: true, record, document };

      const projection: Record<string, unknown> = {};
      for (const pointer of readOptions.paths) {
        const parsed = parsePointer(pointer);
        if (!parsed.ok) {
          return failure(POINTER_ERROR_CODE, parsed.message, {
            suggestion:
              'Pointers are RFC 6901: "" is the whole document, "/children/0/props" a member of it.',
            context: { handle, pointer },
          });
        }
        const found = resolvePointer(document, parsed.tokens);
        // A pointer that resolves nowhere is left out rather than reported as
        // null: the caller has to be able to tell "absent" from "present and
        // null", and the tool turns the gap into a diagnostic.
        if (found.found) projection[pointer] = found.value;
      }
      return { ok: true, record, document, projection };
    },

    async patch(input) {
      sweep();
      const entry = entries.get(input.handle);
      if (!entry) return missing(input.handle);
      entry.touchedAt = now();

      if (
        input.baseRevision !== undefined &&
        input.baseRevision !== entry.revision
      ) {
        return stale(
          entry,
          input.baseRevision,
          toRecord(entry).pinnedRevisions,
          true
        );
      }
      if (input.operations.length === 0) {
        return failure(
          PATCH_ERROR_CODES.SYNTAX,
          'A patch needs at least one operation.',
          {
            suggestion:
              'Send the operations you want applied; an empty patch would burn a revision for nothing.',
            context: { handle: input.handle, revision: entry.revision },
          }
        );
      }

      // A private parse: `applyPatch` mutates what it is given, and the stored
      // text is not touched until every operation has landed on this copy.
      const draft = JSON.parse(entry.text) as unknown;
      const applied = applyPatch(draft, input.operations);
      if (!applied.ok) {
        const { code, message, operationIndex, pointer, suggestion, context } =
          applied.problem;
        return failure(code, message, {
          ...(pointer !== undefined && { path: pointer }),
          ...(suggestion !== undefined && { suggestion }),
          context: {
            ...context,
            handle: input.handle,
            revision: entry.revision,
            operationIndex,
          },
        });
      }

      const badRoot = rootMustBeObject(
        applied.document,
        { handle: input.handle, revision: entry.revision },
        true
      );
      if (badRoot) return badRoot;

      const serialized = serialize(applied.document);
      if (!serialized.ok) return serialized;
      if (serialized.bytes > limits.maxDocumentBytes) {
        return tooLarge(serialized.bytes, limits.maxDocumentBytes);
      }
      const growth = serialized.bytes - entry.bytes;
      if (growth > 0 && !hasRoom(growth, false)) {
        return failure(
          WORKSPACE_ERROR_CODES.LIMIT,
          `Applying this patch would take the connection past its ${limits.maxTotalBytes}-byte workspace budget.`,
          {
            suggestion:
              'Close workspaces you have finished with, or snapshot and continue inline.',
            context: {
              handle: input.handle,
              bytes: serialized.bytes,
              maxTotalBytes: limits.maxTotalBytes,
            },
          }
        );
      }

      // The commit. One assignment, so there is no state in which half a patch
      // is visible.
      entry.text = serialized.text;
      entry.bytes = serialized.bytes;
      entry.revision += 1;
      entry.updatedAt = now();
      entry.touchedAt = entry.updatedAt;
      return { ok: true, record: toRecord(entry) };
    },

    async snapshot(handle) {
      sweep();
      const entry = entries.get(handle);
      if (!entry) return missing(handle);
      entry.touchedAt = now();

      const revision = entry.revision;
      const document = JSON.parse(entry.text) as unknown;

      // Pinning is best-effort on purpose: a snapshot is the recovery path, so
      // it returns the JSON even when there is no room to keep a copy. What
      // the agent gets back always tells the truth — `pinnedRevisions` only
      // lists pins that actually took.
      if (
        !entry.pins.has(revision) &&
        entry.pins.size < limits.maxPinnedRevisions
      ) {
        if (hasRoom(entry.bytes, false)) {
          entry.pins.set(revision, { text: entry.text, bytes: entry.bytes });
        }
      }

      return { ok: true, record: toRecord(entry), document };
    },

    async list() {
      sweep();
      return {
        ok: true,
        records: [...entries.values()].map((entry) => toRecord(entry)),
      };
    },

    async close(handle) {
      sweep();
      const entry = entries.get(handle);
      if (!entry) return { ok: true, handle, closed: false };
      evict(entry, 'closed');
      return { ok: true, handle, closed: true };
    },

    async closeAll() {
      for (const entry of [...entries.values()]) evict(entry, 'closed');
    },
  };

  function stale(
    entry: Entry,
    wanted: number,
    pinned: number[],
    mutation = false
  ): Failure {
    return failure(
      ERROR_CODES.STALE_REVISION,
      `Workspace ${entry.handle} is at revision ${entry.revision}, not ${wanted}.` +
        (mutation ? ' Nothing was applied.' : ''),
      {
        suggestion: mutation
          ? 'Re-read the workspace (jto_workspace_inspect) and rebuild the patch against the current revision.'
          : 'Read without `revision` for the current document, or snapshot a revision before you need to come back to it.',
        context: {
          handle: entry.handle,
          requested: wanted,
          current: entry.revision,
          pinnedRevisions: pinned,
        },
      }
    );
  }
}

function defaultHandle(): string {
  return `ws_${randomBytes(9).toString('base64url')}`;
}

/**
 * Serialize the authoritative text.
 *
 * `JSON.stringify` returns `undefined` for a top-level `undefined` or function
 * and throws on a cycle; both mean the caller handed us something that is not
 * a JSON document, which is its defect to fix, not ours to guess at.
 */
function serialize(
  document: unknown
): { ok: true; text: string; bytes: number } | Failure {
  let text: string | undefined;
  try {
    text = JSON.stringify(document);
  } catch (error) {
    return failure(
      ERROR_CODES.INVALID_JSON,
      `The document is not JSON-serializable: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  if (typeof text !== 'string') {
    return failure(
      ERROR_CODES.INVALID_JSON,
      'The document is not JSON-serializable.',
      {
        suggestion:
          'Send a JSON object, e.g. { "name": "docx", "props": {}, "children": [] }.',
      }
    );
  }
  return { ok: true, text, bytes: Buffer.byteLength(text, 'utf8') };
}

/**
 * The one invalid state a workspace refuses to hold.
 *
 * Half-finished authoring stays writable on purpose — a missing `name`,
 * children added one at a time, props of the wrong type are all still objects,
 * so `get` reads them back and the next patch repairs them. A root that is not
 * a JSON object is the exception: `jto_workspace_create` takes an object and
 * both read tools declare `document` as one, so committing a scalar or an
 * array would leave the agent holding a handle whose content it can no longer
 * read, with nothing to patch against. The write is the last point at which
 * the document still exists to be kept.
 */
function rootMustBeObject(
  document: unknown,
  context: Record<string, unknown>,
  mutation = false
): Failure | undefined {
  if (isRecord(document)) return undefined;
  return failure(
    WORKSPACE_ERROR_CODES.INVALID_ROOT,
    `A workspace document must be a JSON object, not ${typeName(document)}.` +
      (mutation ? ' Nothing was applied.' : ''),
    {
      path: '',
      suggestion: mutation
        ? 'Patch members of the document — "/props/theme", "/children/-" — rather than replacing the root itself.'
        : 'Send a JSON object, e.g. { "name": "docx", "props": {}, "children": [] }.',
      context: { ...context, rootType: typeName(document) },
    }
  );
}

function tooLarge(bytes: number, limit: number): Failure {
  return failure(
    WORKSPACE_ERROR_CODES.DOCUMENT_TOO_LARGE,
    `The document is ${bytes} bytes, over this connection's ${limit}-byte per-document limit.`,
    {
      suggestion:
        'Split the document, or drop inline base64 assets in favour of file paths.',
      context: { bytes, maxDocumentBytes: limit },
    }
  );
}

/** Re-exported so a caller can name what a patch failure was without importing two modules. */
export type { JsonPatchOperation };
