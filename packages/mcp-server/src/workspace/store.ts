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

import {
  ERROR_CODES,
  diagnostic,
  failure,
  type Diagnostic,
  type Failure,
} from '../lib/errors.js';
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
import {
  isPersistableHandle,
  type PersistedDocument,
  type PersistedMeta,
  type PersistenceLimits,
  type RestoredWorkspace,
  type WorkspacePersistence,
} from './persistence.js';

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
  /**
   * A revision could not be mirrored to disk (#290). A warning, never a
   * failure: the edit landed and the workspace is usable, but this connection
   * has stopped being survivable and saying so is the whole point.
   */
  NOT_PERSISTED: 'W_WORKSPACE_NOT_PERSISTED',
  /**
   * A close could not delete the durable copy, so nothing was released (#290).
   * An error rather than a warning: the agent asked for the document to be
   * destroyed, and it is still there to be read by the next connection.
   */
  NOT_CLOSED: 'E_WORKSPACE_NOT_CLOSED',
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
  /**
   * Disk backing (#290). Absent is the historical behaviour: memory only, and
   * everything goes when the connection does.
   */
  persistence?: WorkspacePersistence;
}

export interface MemoryWorkspaceStore extends WorkspaceStore {
  readonly limits: WorkspaceLimits;
  /** Live totals, for `jto_workspace_list` to show the agent its budget. */
  usage(): { workspaces: number; bytes: number };
  /**
   * Where revisions survive the connection, when a root was configured.
   * Absent means handles are memory-only and end with this process (#290).
   */
  readonly persistence?: { root: string; limits: PersistenceLimits };
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
  /** Whether the last write to this entry reached disk (#290). */
  persisted: boolean;
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
  const persistence = options.persistence;

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

  function tombstone(
    handle: string,
    reason: EvictionReason,
    revision: number
  ): void {
    tombstones.set(handle, { reason, at: now(), revision });
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
    tombstone(entry.handle, reason, entry.revision);
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

  /**
   * One durable operation at a time.
   *
   * Every tool call is its own async task, so a client that pipelines — and
   * agents do, they fan tool calls out — can have `jto_workspace_patch`
   * awaiting a write while `jto_workspace_close` starts deleting the same
   * directory. Two orderings go wrong without this: a save can recreate a
   * directory a close has already removed, resurrecting a workspace the agent
   * was told was destroyed; and two first saves can each read the workspace
   * count, both decide there is room, and one can then delete the other's
   * half-written directory. Both are the same defect as the swallowed `rm`
   * error — a promise about durability that the next call disproves.
   *
   * A single chain rather than one per handle: the operations being ordered
   * are a few milliseconds of filesystem work, they contend on one disk
   * anyway, and the count-then-prune sequence is about the ROOT, so a
   * per-handle lock would not have covered it.
   */
  let durable: Promise<unknown> = Promise.resolve();

  function queued<T>(work: () => Promise<T>): Promise<T> {
    const running = durable.then(work);
    // The chain must survive a failed operation, so what the next one waits on
    // is the settled shape of this one, not its rejection.
    durable = running.catch(() => undefined);
    return running;
  }

  /**
   * Mirror an entry to disk, and say so when that did not take.
   *
   * Durability is best-effort by construction. The edit is already committed
   * in memory when this runs, and refusing an otherwise good patch because a
   * directory turned read-only would trade a working authoring loop for a
   * guarantee the agent never asked for. What is NOT optional is reporting
   * it: a workspace the agent believes will survive a lost connection and
   * will not is the exact failure this feature exists to remove, so the
   * warning rides back on the same result as the edit.
   */
  async function persist(entry: Entry): Promise<Diagnostic | undefined> {
    if (!persistence) return undefined;
    try {
      const written = await queued(async () => {
        // Checked here, inside the queue, rather than before joining it: a
        // close that ran while this was waiting has already taken the
        // directory away, and writing now would put it back.
        if (entries.get(entry.handle) !== entry) return false;
        await saveEntry(entry);
        return true;
      });
      if (!written) {
        // Skipped because the workspace was closed while this waited. No
        // warning — the agent asked for that close and was told it happened —
        // but the record must not claim durability for a revision that was
        // never written.
        entry.persisted = false;
        return undefined;
      }
      entry.persisted = true;
      return undefined;
    } catch (error) {
      entry.persisted = false;
      return notPersisted(entry, error);
    }
  }

  /** The write itself, always called from inside the queue. */
  async function saveEntry(entry: Entry): Promise<void> {
    if (!persistence) return;
    await persistence.save({
      handle: entry.handle,
      format: entry.format,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      ...(entry.title !== undefined && { title: entry.title }),
      head: {
        revision: entry.revision,
        text: entry.text,
        bytes: entry.bytes,
      },
      pins: [...entry.pins.entries()].map(([revision, pin]) => ({
        revision,
        text: pin.text,
        bytes: pin.bytes,
      })),
    });
  }

  function notPersisted(entry: Entry, error: unknown): Diagnostic {
    const root = persistence?.root ?? '';
    return diagnostic(
      WORKSPACE_ERROR_CODES.NOT_PERSISTED,
      `Revision ${entry.revision} of ${entry.handle} is held in memory but was not written to ${root}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {
        severity: 'warning',
        suggestion:
          'Export the JSON with jto_workspace_snapshot and keep it yourself; this handle will not survive a lost connection.',
        context: {
          handle: entry.handle,
          revision: entry.revision,
          workspaceRoot: root,
        },
      }
    );
  }

  /** Wrap a record with whatever the write had to say. */
  function committed(
    record: WorkspaceRecord,
    warning: Diagnostic | undefined
  ): { ok: true; record: WorkspaceRecord; warnings?: Diagnostic[] } {
    return { ok: true, record, ...(warning && { warnings: [warning] }) };
  }

  /**
   * Bring a handle back from disk.
   *
   * This is the half of #290 an agent actually notices. After a host session
   * reset the memory map is empty and the handle it is holding looks unknown,
   * so every entry point that misses looks here before reporting it gone —
   * the client resumes at the revision it left off at instead of re-authoring.
   * The same path covers a handle the idle TTL swept, which is why eviction no
   * longer has to mean loss.
   *
   * The memory budget applies exactly as it does to a create: a restore that
   * does not fit is refused rather than allowed to push the connection past a
   * limit it publishes. The document stays on disk, so freeing a workspace and
   * asking again works.
   */
  async function rehydrate(
    handle: string
  ): Promise<{ ok: true; entry: Entry } | Failure | undefined> {
    if (!persistence || !isPersistableHandle(handle)) return undefined;

    let loaded: RestoredWorkspace | undefined;
    try {
      loaded = await persistence.load(handle);
    } catch {
      // An unreadable directory is indistinguishable from an absent one to the
      // agent, and `missing` already says the useful thing about both.
      return undefined;
    }
    if (!loaded) return undefined;
    const restored = loaded;

    // Disk may have been written by a connection with a roomier pin budget.
    const pins: PersistedDocument[] = [...restored.pins]
      .sort((a, b) => b.revision - a.revision)
      .slice(0, limits.maxPinnedRevisions);

    const needed = pins.reduce(
      (total, pin) => total + pin.bytes,
      restored.head.bytes
    );
    if (restored.head.bytes > limits.maxDocumentBytes) {
      return tooLarge(restored.head.bytes, limits.maxDocumentBytes);
    }
    if (!hasRoom(needed, true)) {
      return failure(
        WORKSPACE_ERROR_CODES.LIMIT,
        `Workspace ${handle} is on disk at revision ${restored.revision} but does not fit in this connection's ${limits.maxTotalBytes}-byte budget.`,
        {
          suggestion:
            'Close a workspace you have finished with, then use this handle again.',
          context: {
            handle,
            bytes: needed,
            maxTotalBytes: limits.maxTotalBytes,
            maxWorkspaces: limits.maxWorkspaces,
          },
        }
      );
    }

    const entry: Entry = {
      handle,
      format: restored.format,
      revision: restored.head.revision,
      text: restored.head.text,
      bytes: restored.head.bytes,
      createdAt: restored.createdAt,
      updatedAt: restored.updatedAt,
      touchedAt: now(),
      ...(restored.title !== undefined && { title: restored.title }),
      pins: new Map(
        pins.map((pin) => [pin.revision, { text: pin.text, bytes: pin.bytes }])
      ),
      persisted: true,
    };
    entries.set(handle, entry);
    // The handle is live again, so whatever the tombstone said about it is
    // no longer true.
    tombstones.delete(handle);
    return { ok: true, entry };
  }

  /**
   * The entry behind a handle: resident, restored from disk, or a failure
   * explaining which kind of gone it is.
   */
  async function resolve(handle: string): Promise<{ entry: Entry } | Failure> {
    const entry = entries.get(handle);
    if (entry) return { entry };
    const restored = await rehydrate(handle);
    if (restored === undefined) return missing(handle);
    if (!restored.ok) return restored;
    return { entry: restored.entry };
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
      ...(persistence && { persisted: entry.persisted }),
    };
  }

  /**
   * A record for a workspace that is on disk but not in memory (#290).
   *
   * Built from the metadata alone: `jto_workspace_list` after a reconnect is
   * how an agent finds the handles it lost, and making it read every document
   * back would charge that recovery the full price of the connection it is
   * recovering from. The documents load when a handle is used.
   */
  function fromMeta(meta: PersistedMeta): WorkspaceRecord {
    return {
      handle: meta.handle,
      format: meta.format,
      revision: meta.revision,
      bytes: meta.bytes,
      createdAt: new Date(meta.createdAt).toISOString(),
      updatedAt: new Date(meta.updatedAt).toISOString(),
      ...(meta.title !== undefined && { title: meta.title }),
      pinnedRevisions: [...meta.pinnedRevisions],
      persisted: true,
    };
  }

  return {
    available: true,
    limits,
    ...(persistence && {
      persistence: { root: persistence.root, limits: persistence.limits },
    }),

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
        persisted: false,
      };
      entries.set(entry.handle, entry);
      // Ordered: `toRecord` reports `persisted`, so the write has to have been
      // attempted before the record describing it is built.
      const warning = await persist(entry);
      return committed(toRecord(entry), warning);
    },

    async get(handle, readOptions) {
      sweep();
      const found = await resolve(handle);
      if (!('entry' in found)) return found;
      const entry = found.entry;
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
      const found = await resolve(input.handle);
      if (!('entry' in found)) return found;
      const entry = found.entry;
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
      const warning = await persist(entry);
      return committed(toRecord(entry), warning);
    },

    async snapshot(handle) {
      sweep();
      const found = await resolve(handle);
      if (!('entry' in found)) return found;
      const entry = found.entry;
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

      // The pin is part of what survives, so it is written before the agent
      // is told it exists — and before `toRecord` reports `persisted`.
      const warning = entry.pins.has(revision)
        ? await persist(entry)
        : undefined;

      return {
        ok: true,
        record: toRecord(entry),
        document,
        ...(warning && { warnings: [warning] }),
      };
    },

    async list() {
      sweep();
      const records = [...entries.values()].map((entry) => toRecord(entry));
      if (!persistence) return { ok: true, records };

      // Resident first, in the order they were opened, then whatever else the
      // root still holds — which after a reconnect is everything, and is the
      // only way back to a handle the client no longer has.
      const resident = new Set(records.map((record) => record.handle));
      let stored: PersistedMeta[] = [];
      try {
        stored = await persistence.list();
      } catch {
        /* an unreadable root simply contributes nothing */
      }
      for (const meta of stored) {
        if (resident.has(meta.handle)) continue;
        // A close is a decision, not a cache miss: a durable copy that
        // outlived one is not offered back.
        if (tombstones.get(meta.handle)?.reason === 'closed') continue;
        records.push(fromMeta(meta));
      }
      return { ok: true, records };
    },

    async close(handle) {
      sweep();
      const entry = entries.get(handle);

      // Deliberately destructive on disk as well. `jto_workspace_close` is
      // documented as unrecoverable, and a durable copy that outlived it would
      // reappear on the next use of the handle — the opposite of what the
      // agent asked for. Note this reads no document: closing has to work when
      // the byte budget is too full to restore one.
      //
      // Disk goes FIRST, and nothing is released unless it succeeds. Reporting
      // a close that left the JSON readable would be answering a request to
      // destroy data with a claim the next connection disproves, so a failure
      // here leaves the workspace exactly as it was — open, and retryable.
      if (!persistence) {
        if (entry) evict(entry, 'closed');
        return { ok: true, handle, closed: entry !== undefined };
      }

      // The delete and the eviction share one critical section. Splitting them
      // would let a patch's write, queued behind the delete, run in the gap
      // and recreate the directory — the entry would still be in the map, so
      // its own liveness check would wave it through, and a workspace the
      // agent was told was destroyed would be back.
      const root = persistence.root;
      try {
        return await queued(async () => {
          const removed = await persistence.remove(handle);
          const resident = entries.get(handle);
          if (resident) evict(resident, 'closed');
          // The revision is unknown for a handle this connection only ever saw
          // on disk, and unread: `missing` only surfaces one for a TTL
          // eviction.
          else if (removed) tombstone(handle, 'closed', 0);
          return {
            ok: true as const,
            handle,
            closed: resident !== undefined || removed,
          };
        });
      } catch (error) {
        return failure(
          WORKSPACE_ERROR_CODES.NOT_CLOSED,
          `Workspace ${handle} could not be removed from ${root}: ${
            error instanceof Error ? error.message : String(error)
          }. It is still open and still on disk.`,
          {
            suggestion:
              'Check the workspace directory is writable, then close again.',
            context: { handle, workspaceRoot: root },
          }
        );
      }
    },

    /**
     * Release memory, keep the disk.
     *
     * The asymmetry with `close` is the point: this exists for a host
     * reclaiming memory at a moment of its own choosing, and #290 is precisely
     * about an event that ends a connection not being allowed to destroy
     * revisions. The handles come back from disk on next use.
     */
    async closeAll() {
      for (const entry of [...entries.values()]) {
        if (!persistence) {
          evict(entry, 'closed');
          continue;
        }
        // No closed tombstone when there is a durable copy to come back to.
        // `list` hides handles that were closed on purpose, and this is not
        // that: the host wanted its memory back, and the root is still the way
        // back to the work — which is the whole promise being kept here.
        entries.delete(entry.handle);
        tombstones.delete(entry.handle);
      }
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
