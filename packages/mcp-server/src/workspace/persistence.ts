/**
 * Disk backing for workspaces (#290).
 *
 * #271 made the document JSON authoritative and then kept it in exactly one
 * place: server memory. Anything that ends a connection — a host session
 * reset, a client restart, a crash — took every revision with it, and
 * `jto_workspace_snapshot` did not help because the pins lived in the same
 * `Map`. This module is the durable half: memory stays the fast path and the
 * only thing tools read from, and every committed revision is mirrored here so
 * a reconnecting client can resume instead of re-authoring.
 *
 * Off unless a root is configured (`--workspace-dir`, `JTO_MCP_WORKSPACE_DIR`),
 * because turning handles durable turns them cross-connection, and a server
 * that started leaving documents on a user's disk without being asked would be
 * a surprise rather than a feature.
 *
 * Three properties the layout is chosen for:
 *
 * - Crash safety. A revision file is written and renamed into place BEFORE the
 *   metadata that names it, so `meta.json` never points at bytes that are not
 *   there. Interrupt this at any point and what is on disk is either the old
 *   revision or the new one, never half of either.
 * - Cheap listing. Recovering handles after a reset reads one small
 *   `meta.json` per workspace; the documents are only paid for when a handle
 *   is actually used.
 * - No caller-named paths. A handle is the only thing that reaches the
 *   filesystem, and it is matched against a whitelist first, so nothing a
 *   client sends can address a directory of its choosing.
 *
 * Nothing here is a tool result, so these functions throw rather than return
 * diagnostics; the store catches and downgrades a write failure to a warning
 * (`W_WORKSPACE_NOT_PERSISTED`), because losing durability is worth saying out
 * loud and is never worth failing an edit over.
 *
 * Not a concurrency layer. Individual writes are atomic, so a root two
 * connections share never tears — but each holds its own memory copy of an
 * entry, and the second to commit a revision is the one on disk. The intended
 * arrangement is one root per client, which is what a reconnect is.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { randomBytes } from 'crypto';

import { FORMAT_NAMES } from '../lib/schema.js';
import type { FormatName } from '../lib/adapters.js';

/** Env var that names the workspace root, below the `--workspace-dir` flag. */
export const WORKSPACE_DIR_ENV = 'JTO_MCP_WORKSPACE_DIR';

/** Bumped only if the on-disk shape changes; older directories are ignored. */
const SCHEMA_VERSION = 1;

const META_FILE = 'meta.json';
const REVISION_PREFIX = 'rev-';
const REVISION_SUFFIX = '.json';

/**
 * Handles that may become a directory name.
 *
 * The store's own handles are `ws_<base64url>`, but a host can inject its own
 * generator and a client can send any string at all — and both end up here as
 * a path segment. So the shape is whitelisted rather than sanitized: no
 * separators, no dots, nothing to traverse with.
 */
const SAFE_HANDLE = /^[A-Za-z0-9_-]{1,128}$/;

export function isPersistableHandle(handle: string): boolean {
  return SAFE_HANDLE.test(handle);
}

export interface PersistenceLimits {
  /** Workspaces kept on disk; the least recently updated go first. */
  maxWorkspaces: number;
  /** Revision files per workspace — the head plus its pinned revisions. */
  maxRevisionsPerWorkspace: number;
  /** Ceiling for a single revision file. */
  maxEntryBytes: number;
}

/**
 * Roomier than the memory limits on purpose.
 *
 * Memory bounds protect a process; these bound a directory that outlives it,
 * where the cost of keeping a document is a few hundred kilobytes of disk and
 * the cost of dropping one is authoring an agent has to redo. `maxWorkspaces`
 * is twice the memory ceiling so a reconnecting client still finds what the
 * previous connection had open, and the revision cap is the head plus the
 * default eight pins, so a default setup never has to discard a pin it took.
 */
export const DEFAULT_PERSISTENCE_LIMITS: PersistenceLimits = {
  maxWorkspaces: 32,
  maxRevisionsPerWorkspace: 9,
  maxEntryBytes: 16 * 1024 * 1024,
};

/** One retained revision: the serialized document and its size. */
export interface PersistedDocument {
  revision: number;
  text: string;
  bytes: number;
}

/** What the store hands over to be made durable. */
export interface PersistedSnapshot {
  handle: string;
  format: FormatName;
  createdAt: number;
  updatedAt: number;
  title?: string;
  /** The current revision. */
  head: PersistedDocument;
  /** Revisions pinned by `snapshot`, oldest first. */
  pins: readonly PersistedDocument[];
}

/** A workspace as `list` reports it, without paying for the documents. */
export interface PersistedMeta {
  handle: string;
  format: FormatName;
  revision: number;
  bytes: number;
  createdAt: number;
  updatedAt: number;
  title?: string;
  pinnedRevisions: number[];
}

/** A workspace read back whole, ready to become a live entry again. */
export interface RestoredWorkspace extends PersistedMeta {
  head: PersistedDocument;
  pins: PersistedDocument[];
}

export interface WorkspacePersistence {
  /** Absolute path of the root. May not exist on disk until first write. */
  readonly root: string;
  readonly limits: PersistenceLimits;
  /** Mirror a workspace's current state. Overwrites whatever was there. */
  save(snapshot: PersistedSnapshot): Promise<void>;
  /** Everything on disk, newest update first. Corrupt entries are skipped. */
  list(): Promise<PersistedMeta[]>;
  /** One workspace, documents included, or undefined when it is not there. */
  load(handle: string): Promise<RestoredWorkspace | undefined>;
  /**
   * Forget a workspace durably. Idempotent; answers whether anything was
   * there, which is how `close` reports a handle it only ever saw on disk.
   */
  remove(handle: string): Promise<boolean>;
}

export interface WorkspacePersistenceOptions
  extends Partial<PersistenceLimits> {
  /** `--workspace-dir` value, highest precedence. */
  flagDir?: string;
  /** Defaults to `process.env`; injectable so the precedence is testable. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Build the persistence layer, or answer `undefined` when none was configured.
 *
 * `undefined` rather than a no-op implementation: the store branches on
 * whether it has durability at all — to decide what `jto_info` reports and
 * whether an evicted handle is recoverable — and a stand-in that quietly
 * discarded writes would make that question unanswerable.
 */
export function createWorkspacePersistence(
  options: WorkspacePersistenceOptions = {}
): WorkspacePersistence | undefined {
  const env = options.env ?? process.env;
  const configured = options.flagDir?.trim() || env[WORKSPACE_DIR_ENV]?.trim();
  if (!configured) return undefined;
  return createWorkspacePersistenceAt(path.resolve(configured), options);
}

/** The same layer on an explicit directory, for hosts and tests. */
export function createWorkspacePersistenceAt(
  root: string,
  limits: Partial<PersistenceLimits> = {}
): WorkspacePersistence {
  const bounds: PersistenceLimits = {
    maxWorkspaces:
      limits.maxWorkspaces ?? DEFAULT_PERSISTENCE_LIMITS.maxWorkspaces,
    maxRevisionsPerWorkspace:
      limits.maxRevisionsPerWorkspace ??
      DEFAULT_PERSISTENCE_LIMITS.maxRevisionsPerWorkspace,
    maxEntryBytes:
      limits.maxEntryBytes ?? DEFAULT_PERSISTENCE_LIMITS.maxEntryBytes,
  };

  let ensured: Promise<void> | undefined;

  /**
   * Create the root once, lazily.
   *
   * Deferred like the output root's: a connection that never opens a
   * workspace should not leave a directory behind. 0o700 because these are the
   * user's documents and the root may well be under a shared temp dir.
   */
  async function ensureRoot(): Promise<void> {
    if (ensured === undefined) {
      ensured = fs.mkdir(root, { recursive: true, mode: 0o700 }).then(
        () => undefined,
        (error: unknown) => {
          ensured = undefined;
          throw error;
        }
      );
    }
    return ensured;
  }

  function dirFor(handle: string): string {
    return path.join(root, handle);
  }

  /**
   * Write bytes so that a reader sees either the old file or the new one.
   *
   * `rename` within a directory is atomic on every platform this runs on, so
   * the temp name is what absorbs an interrupted write. The suffix is random
   * because two connections may share a configured root.
   */
  async function writeAtomic(target: string, contents: string): Promise<void> {
    const temp = `${target}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temp, contents, { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temp, target);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  function revisionFile(handle: string, revision: number): string {
    return path.join(
      dirFor(handle),
      `${REVISION_PREFIX}${revision}${REVISION_SUFFIX}`
    );
  }

  async function readMeta(handle: string): Promise<PersistedMeta | undefined> {
    let raw: string;
    try {
      raw = await fs.readFile(path.join(dirFor(handle), META_FILE), 'utf8');
    } catch {
      return undefined;
    }
    return parseMeta(raw, handle);
  }

  async function readRevision(
    handle: string,
    revision: number
  ): Promise<PersistedDocument | undefined> {
    let text: string;
    try {
      text = await fs.readFile(revisionFile(handle, revision), 'utf8');
    } catch {
      return undefined;
    }
    // Parsed only to prove it is a document; the store wants the TEXT, which
    // is its authoritative form, so the parse result is deliberately dropped.
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      )
        return undefined;
    } catch {
      return undefined;
    }
    return { revision, text, bytes: Buffer.byteLength(text, 'utf8') };
  }

  /** Handles with a directory in the root, whatever state it is in. */
  async function handleDirs(): Promise<string[]> {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      return entries
        .filter(
          (entry) => entry.isDirectory() && isPersistableHandle(entry.name)
        )
        .map((entry) => entry.name);
    } catch {
      return [];
    }
  }

  /**
   * Keep the root under `maxWorkspaces`, dropping the stalest first.
   *
   * Run before a new workspace's first write rather than on a timer, and
   * `incoming` is both exempt and counted — it is about to exist, so making
   * room for it is the whole point, and it can never evict itself.
   */
  async function pruneWorkspaces(incoming: string): Promise<void> {
    const handles = (await handleDirs()).filter(
      (handle) => handle !== incoming
    );
    const excess = handles.length + 1 - bounds.maxWorkspaces;
    if (excess <= 0) return;

    const metas = await Promise.all(
      handles.map(async (handle) => ({
        handle,
        // An unreadable entry sorts first: it is the one worth losing.
        updatedAt: (await readMeta(handle))?.updatedAt ?? 0,
      }))
    );
    metas.sort((a, b) => a.updatedAt - b.updatedAt);

    for (const victim of metas.slice(0, excess)) {
      await fs
        .rm(dirFor(victim.handle), { recursive: true, force: true })
        .catch(() => undefined);
    }
  }

  /**
   * Delete revision files the metadata no longer names.
   *
   * Half-written `.tmp` files are deliberately left: `revisionOf` does not
   * match them, and one could belong to a write another connection sharing
   * this root is in the middle of. A leaked one is reaped with its workspace,
   * by `remove` or by the workspace ceiling, so it cannot accumulate without
   * bound.
   */
  async function pruneRevisions(
    handle: string,
    retained: ReadonlySet<number>
  ): Promise<void> {
    let names: string[];
    try {
      names = await fs.readdir(dirFor(handle));
    } catch {
      return;
    }
    for (const name of names) {
      const revision = revisionOf(name);
      if (revision === undefined || retained.has(revision)) continue;
      await fs
        .rm(path.join(dirFor(handle), name), { force: true })
        .catch(() => undefined);
    }
  }

  return {
    root,
    limits: bounds,

    async save(snapshot) {
      if (!isPersistableHandle(snapshot.handle)) {
        throw new Error(
          `Workspace handle ${JSON.stringify(
            snapshot.handle
          )} cannot be used as a directory name.`
        );
      }
      if (snapshot.head.bytes > bounds.maxEntryBytes) {
        throw new Error(
          `Revision ${snapshot.head.revision} is ${snapshot.head.bytes} bytes, over the ${bounds.maxEntryBytes}-byte persistence limit.`
        );
      }

      await ensureRoot();
      const dir = dirFor(snapshot.handle);
      const fresh = !(await exists(dir));
      if (fresh) await pruneWorkspaces(snapshot.handle);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });

      // Head first, then the pins newest-first, so a revision cap that bites
      // discards the oldest pin rather than the document itself. A pin taken
      // at the current head shares its file and costs nothing to keep — it is
      // still listed, because the memory store lists it and a record that
      // changed shape on recovery would be its own bug.
      const files: PersistedDocument[] = [snapshot.head];
      const retained = new Set([snapshot.head.revision]);
      const pinned: number[] = [];
      for (const pin of [...snapshot.pins].sort(
        (a, b) => b.revision - a.revision
      )) {
        if (!retained.has(pin.revision)) {
          if (files.length >= bounds.maxRevisionsPerWorkspace) continue;
          files.push(pin);
          retained.add(pin.revision);
        }
        pinned.push(pin.revision);
      }

      for (const document of files) {
        const target = revisionFile(snapshot.handle, document.revision);
        // Revisions are immutable, so an existing file is already the right
        // bytes: only the head is ever new, and re-pinning is metadata.
        if (await exists(target)) continue;
        await writeAtomic(target, document.text);
      }

      const meta: PersistedMeta & { schema: number } = {
        schema: SCHEMA_VERSION,
        handle: snapshot.handle,
        format: snapshot.format,
        revision: snapshot.head.revision,
        bytes: snapshot.head.bytes,
        createdAt: snapshot.createdAt,
        updatedAt: snapshot.updatedAt,
        ...(snapshot.title !== undefined && { title: snapshot.title }),
        pinnedRevisions: pinned.sort((a, b) => a - b),
      };
      await writeAtomic(path.join(dir, META_FILE), JSON.stringify(meta));

      // Only now, with the metadata committed, is an older revision file
      // unreferenced and safe to delete.
      await pruneRevisions(snapshot.handle, retained);
    },

    async list() {
      const handles = await handleDirs();
      const metas = await Promise.all(
        handles.map((handle) => readMeta(handle))
      );
      return metas
        .filter((meta): meta is PersistedMeta => meta !== undefined)
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async load(handle) {
      if (!isPersistableHandle(handle)) return undefined;
      const meta = await readMeta(handle);
      if (!meta) return undefined;

      const head = await readRevision(handle, meta.revision);
      // Metadata without its document is a torn or hand-edited directory. It
      // is not recoverable, and leaving it would keep answering `list` with a
      // handle that fails on use, so it goes.
      if (!head) {
        await fs
          .rm(dirFor(handle), { recursive: true, force: true })
          .catch(() => undefined);
        return undefined;
      }

      const pins: PersistedDocument[] = [];
      for (const revision of meta.pinnedRevisions) {
        const pin = await readRevision(handle, revision);
        if (pin) pins.push(pin);
      }

      return {
        ...meta,
        // A pin whose file went missing is dropped rather than advertised: the
        // record has to describe what can actually be read back.
        pinnedRevisions: pins.map((pin) => pin.revision).sort((a, b) => a - b),
        head,
        pins,
      };
    },

    async remove(handle) {
      if (!isPersistableHandle(handle)) return false;
      const dir = dirFor(handle);
      if (!(await exists(dir))) return false;
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      return true;
    },
  };
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
}

/** Revision number encoded in a file name, or undefined for anything else. */
function revisionOf(name: string): number | undefined {
  if (!name.startsWith(REVISION_PREFIX) || !name.endsWith(REVISION_SUFFIX)) {
    return undefined;
  }
  const digits = name.slice(
    REVISION_PREFIX.length,
    name.length - REVISION_SUFFIX.length
  );
  if (!/^[0-9]+$/.test(digits)) return undefined;
  return Number(digits);
}

/**
 * Read metadata defensively.
 *
 * This directory outlives the process that wrote it and is a plain path a user
 * can edit, back up or half-restore, so every field is checked before it is
 * trusted — a corrupt entry is skipped, never allowed to become a live
 * workspace whose record lies about what it holds.
 */
function parseMeta(raw: string, handle: string): PersistedMeta | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return undefined;
  }
  const meta = parsed as Record<string, unknown>;
  if (meta.schema !== SCHEMA_VERSION) return undefined;
  if (meta.handle !== handle) return undefined;
  if (!FORMAT_NAMES.includes(meta.format as FormatName)) return undefined;
  if (!isPositiveInteger(meta.revision)) return undefined;
  if (!isNonNegativeInteger(meta.bytes)) return undefined;
  if (!isNonNegativeInteger(meta.createdAt)) return undefined;
  if (!isNonNegativeInteger(meta.updatedAt)) return undefined;
  if (meta.title !== undefined && typeof meta.title !== 'string')
    return undefined;

  const pinnedRevisions = Array.isArray(meta.pinnedRevisions)
    ? meta.pinnedRevisions.filter(isPositiveInteger)
    : [];

  return {
    handle,
    format: meta.format as FormatName,
    revision: meta.revision,
    bytes: meta.bytes,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    ...(typeof meta.title === 'string' && { title: meta.title }),
    pinnedRevisions: [...pinnedRevisions].sort((a, b) => a - b),
  };
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}
