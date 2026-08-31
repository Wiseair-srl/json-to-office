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
const TEMP_SUFFIX = '.tmp';

/**
 * How old a `.tmp` has to be before it is treated as debris.
 *
 * A temporary revision only exists between `writeFile` and `rename`, which is
 * milliseconds; an hour is far past any write still in flight, including one
 * belonging to another process sharing the root. Below that they are left
 * alone, because deleting a live one would fail somebody else's write.
 */
const STALE_TEMP_MS = 60 * 60 * 1000;

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

/**
 * The durable half of a workspace store.
 *
 * Not internally synchronized: `save` and `remove` each read the root, decide
 * what to prune and then act, so two of them running at once can both decide
 * there is room, or one can delete a directory the other is half way through
 * writing. Callers serialize — `createMemoryWorkspaceStore` runs every durable
 * operation through one queue, which is also where the ordering against a
 * close is settled. Reads (`list`, `load`) need no such treatment: metadata is
 * renamed into place after the revision it names, so a concurrent read sees
 * one committed state or the other, and `load` re-reads before it treats a
 * missing document as a torn directory.
 */
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
   *
   * Throws when the directory is there and could not be deleted. That has to
   * reach the caller: `jto_workspace_close` promises the document is gone, and
   * a swallowed failure would report it closed while the JSON stayed readable
   * by the next connection to use the handle.
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
   * Revision files THIS layer wrote, per handle.
   *
   * A revision number is only immutable within one lineage. Two connections
   * sharing a root can both restore revision N and both commit N+1 with
   * different content, so "the file is already there" does not mean "the file
   * is the bytes I am about to write" — trusting that put one store's document
   * on disk under the other store's metadata, which is a worse failure than
   * either of them losing. What a file name does prove is that a revision this
   * layer itself wrote has not changed since, so authorship is what the skip
   * is keyed on: no redundant writes in the normal single-client case, and a
   * genuine last-writer-wins when a root is shared.
   */
  const authored = new Map<string, Set<number>>();

  function claim(handle: string, revision: number): void {
    const owned = authored.get(handle) ?? new Set<number>();
    owned.add(revision);
    authored.set(handle, owned);
  }

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
    const temp = `${target}.${randomBytes(6).toString('hex')}${TEMP_SUFFIX}`;
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
      // Its files are gone, so the claims on them are worthless — and left
      // here they would be one small `Set` per handle this process has ever
      // written, for the lifetime of the process.
      authored.delete(victim.handle);
    }
  }

  /**
   * Delete revision files the metadata no longer names, and debris.
   *
   * A `.tmp` only exists between `writeFile` and `rename`, so one that has
   * been sitting there for an hour belongs to a process that died mid-write.
   * Left forever they would accumulate one document per interrupted write and
   * quietly put the workspace over the size bound it advertises; deleted
   * eagerly they would break a live write from another connection on a shared
   * root. The age check is what separates the two.
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
    const owned = authored.get(handle);
    for (const name of names) {
      const target = path.join(dirFor(handle), name);

      if (name.endsWith(TEMP_SUFFIX)) {
        if (await isStale(target)) {
          await fs.rm(target, { force: true }).catch(() => undefined);
        }
        continue;
      }

      const revision = revisionOf(name);
      if (revision === undefined || retained.has(revision)) continue;
      await fs.rm(target, { force: true }).catch(() => undefined);
      // The bytes are gone, so the claim on them has to go too: a later
      // revision reusing this number must be written, not skipped.
      owned?.delete(revision);
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

      const owned = authored.get(snapshot.handle);
      for (const document of files) {
        // Skipped only when this layer wrote that exact revision itself, which
        // is the case that repeats: re-persisting on a snapshot, and carrying
        // pins forward on every later patch. Anything else is written, so the
        // document on disk always belongs to the metadata written beside it.
        if (owned?.has(document.revision)) continue;
        await writeAtomic(
          revisionFile(snapshot.handle, document.revision),
          document.text
        );
        claim(snapshot.handle, document.revision);
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

      // Read twice before condemning anything. A read is not serialized
      // against a write, so a `load` that picked up revision N's metadata a
      // moment before a save committed N+1 and pruned N finds the document it
      // was promised gone — through no fault of the directory. The retry sees
      // the newer metadata and succeeds; only a directory that is still
      // missing its own head on the second look is genuinely torn.
      let meta = await readMeta(handle);
      if (!meta) return undefined;
      let head = await readRevision(handle, meta.revision);
      if (!head) {
        const second = await readMeta(handle);
        if (second) {
          meta = second;
          head = await readRevision(handle, second.revision);
        }
      }

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
      if (!(await exists(dir))) {
        authored.delete(handle);
        return false;
      }
      // Deliberately unguarded: a failure here means the document is still
      // readable, and the caller has promised the agent it would not be.
      await fs.rm(dir, { recursive: true, force: true });
      authored.delete(handle);
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

/** Older than a write could plausibly still be in flight for. */
async function isStale(target: string): Promise<boolean> {
  try {
    const { mtimeMs } = await fs.stat(target);
    return Date.now() - mtimeMs > STALE_TEMP_MS;
  } catch {
    // Already gone, or unreadable: either way not ours to delete.
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
