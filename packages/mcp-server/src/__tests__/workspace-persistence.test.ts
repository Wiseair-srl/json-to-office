/**
 * What survives the connection (#290).
 *
 * The field report this issue came from lost five revisions of authoring to a
 * host session reset while the server process itself stayed up and idle. So
 * the load-bearing case here is not "a file appears on disk" — it is that a
 * SECOND store, built on the same root exactly as a reconnecting client would
 * get, finds the handle and reads back the revision the first one left. Every
 * test that matters is written that way.
 *
 * The clock is injected, as in `workspace-store.test.ts`: the TTL cases are
 * about the store's arithmetic, and the persistence root sorts by `updatedAt`,
 * which a real clock would make order-dependent on how fast the machine is.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import {
  createMemoryWorkspaceStore,
  WORKSPACE_ERROR_CODES,
  type MemoryWorkspaceStore,
  type MemoryWorkspaceStoreOptions,
} from '../workspace/store.js';
import {
  createWorkspacePersistence,
  createWorkspacePersistenceAt,
  isPersistableHandle,
  WORKSPACE_DIR_ENV,
  type PersistenceLimits,
} from '../workspace/persistence.js';
import { ERROR_CODES } from '../lib/errors.js';

const document = () => ({
  name: 'docx',
  props: { theme: 'minimal' },
  children: [{ name: 'heading', props: { text: 'One', level: 1 } }],
});

let clock = 1_700_000_000_000;
let root: string;
let scratch: string;

beforeEach(async () => {
  clock = 1_700_000_000_000;
  scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'jto-ws-persist-'));
  root = path.join(scratch, 'workspaces');
});

afterEach(async () => {
  await fs.rm(scratch, { recursive: true, force: true });
});

/**
 * A store on the shared root.
 *
 * Calling this twice is the whole point: the second one has an empty memory
 * map and nothing but the directory, which is what a client gets after the
 * session it was talking to went away.
 */
function build(
  options: MemoryWorkspaceStoreOptions & {
    limits?: Partial<PersistenceLimits>;
  } = {}
): MemoryWorkspaceStore {
  const { limits, ...storeOptions } = options;
  return createMemoryWorkspaceStore({
    now: () => clock,
    persistence: createWorkspacePersistenceAt(root, limits ?? {}),
    ...storeOptions,
  });
}

function unwrap<T extends { ok: boolean }>(result: T) {
  if (!result.ok) {
    throw new Error(
      `expected success, got ${JSON.stringify((result as any).diagnostics)}`
    );
  }
  return result as Extract<T, { ok: true }>;
}

function failed(result: { ok: boolean }): {
  code: string;
  message: string;
  context?: Record<string, unknown>;
} {
  expect(result.ok).toBe(false);
  return (result as any).diagnostics[0];
}

async function open(store: MemoryWorkspaceStore, doc: unknown = document()) {
  return unwrap(await store.create({ format: 'docx', document: doc })).record;
}

async function setTitle(
  store: MemoryWorkspaceStore,
  handle: string,
  text: string
) {
  return unwrap(
    await store.patch({
      handle,
      operations: [{ op: 'add', path: '/props/title', value: text }],
    })
  ).record;
}

/** Directory names under the root, whatever state they are in. */
async function handles(): Promise<string[]> {
  try {
    return (await fs.readdir(root)).sort();
  } catch {
    return [];
  }
}

describe('surviving the connection', () => {
  it('is durable from the opening revision, not from the first patch', async () => {
    // The record has to report what actually happened to THIS call: a create
    // that says `persisted` before its own write has landed is a claim the
    // agent cannot check, and was a real bug here.
    const store = build();
    const record = await open(store);
    expect(record.revision).toBe(1);
    expect(record.persisted).toBe(true);
    expect(await handles()).toEqual([record.handle]);
  });

  it('reads back the revision a lost session left behind', async () => {
    const first = build();
    const { handle } = await open(first);
    await setTitle(first, handle, 'Draft');
    const before = await setTitle(first, handle, 'Second draft');
    expect(before.revision).toBe(3);
    expect(before.persisted).toBe(true);

    // The connection ends here. Nothing is closed, nothing is exported: the
    // client simply goes away, which is exactly the reported failure.
    const reconnected = build();
    const read = unwrap(await reconnected.get(handle));
    expect(read.record.revision).toBe(3);
    expect((read.document as any).props.title).toBe('Second draft');
  });

  it('offers the handles back through list, without being told them', async () => {
    const first = build();
    const a = await open(first);
    clock += 1_000;
    const b = unwrap(
      await first.create({
        format: 'pptx',
        document: { name: 'pptx' },
        title: 'Deck',
      })
    ).record;

    const reconnected = build();
    const listed = unwrap(await reconnected.list());
    const found = new Map(
      listed.records.map((record) => [record.handle, record])
    );
    expect([...found.keys()].sort()).toEqual([a.handle, b.handle].sort());
    expect(found.get(b.handle)).toMatchObject({
      format: 'pptx',
      title: 'Deck',
      revision: 1,
      persisted: true,
    });
  });

  it('keeps patching from where the previous connection stopped', async () => {
    const first = build();
    const { handle } = await open(first);
    await setTitle(first, handle, 'Draft');

    const reconnected = build();
    const patched = unwrap(
      await reconnected.patch({
        handle,
        operations: [{ op: 'add', path: '/props/author', value: 'Wiseair' }],
        // The revision the client last saw: a resumed workspace has to honour
        // a conditional write, or resuming is not the same as continuing.
        baseRevision: 2,
      })
    ).record;
    expect(patched.revision).toBe(3);

    const third = build();
    expect((unwrap(await third.get(handle)).document as any).props).toEqual({
      theme: 'minimal',
      title: 'Draft',
      author: 'Wiseair',
    });
  });

  it('carries pinned revisions across, readable by number', async () => {
    const first = build();
    const { handle } = await open(first);
    await setTitle(first, handle, 'Pinned');
    const pinned = unwrap(await first.snapshot(handle)).record;
    expect(pinned.pinnedRevisions).toEqual([2]);
    await setTitle(first, handle, 'Later');

    const reconnected = build();
    const record = unwrap(await reconnected.get(handle)).record;
    expect(record.revision).toBe(3);
    expect(record.pinnedRevisions).toEqual([2]);

    const old = unwrap(await reconnected.get(handle, { revision: 2 }));
    expect((old.document as any).props.title).toBe('Pinned');
    expect(old.record.revision).toBe(2);
  });

  it('keeps a pin taken at the head, which is where a snapshot is taken', async () => {
    const first = build();
    const { handle } = await open(first);
    expect(unwrap(await first.snapshot(handle)).record.pinnedRevisions).toEqual(
      [1]
    );

    const reconnected = build();
    expect(
      unwrap(await reconnected.get(handle)).record.pinnedRevisions
    ).toEqual([1]);
  });

  it('recovers a handle the idle TTL released, instead of losing it', async () => {
    const store = build({ idleTtlMs: 60_000 });
    const { handle } = await open(store);
    await setTitle(store, handle, 'Still here');
    clock += 60_001;

    // Same store, same process: the sweep has dropped it out of memory, and
    // the disk copy is what makes that an eviction rather than a loss.
    const read = unwrap(await store.get(handle));
    expect(read.record.revision).toBe(2);
    expect((read.document as any).props.title).toBe('Still here');
  });

  it('still lists a workspace the TTL swept', async () => {
    const store = build({ idleTtlMs: 60_000 });
    const { handle } = await open(store);
    clock += 60_001;

    const listed = unwrap(await store.list());
    expect(listed.records.map((record) => record.handle)).toEqual([handle]);
  });

  it('leaves nothing behind, and says nothing about disk, without a root', async () => {
    const store = createMemoryWorkspaceStore({ now: () => clock });
    const record = await open(store);
    expect(record.persisted).toBeUndefined();
    expect(store.persistence).toBeUndefined();
    expect(await handles()).toEqual([]);

    const other = createMemoryWorkspaceStore({ now: () => clock });
    expect(failed(await other.get(record.handle)).code).toBe(
      ERROR_CODES.UNKNOWN_HANDLE
    );
  });

  it('publishes the root it is writing to', async () => {
    const store = build();
    expect(store.persistence?.root).toBe(root);
    expect(store.persistence?.limits.maxWorkspaces).toBeGreaterThan(0);
  });
});

describe('closing', () => {
  it('destroys the durable copy too', async () => {
    const first = build();
    const { handle } = await open(first);
    expect(unwrap(await first.close(handle)).closed).toBe(true);
    expect(await handles()).toEqual([]);

    const reconnected = build();
    expect(unwrap(await reconnected.list()).records).toEqual([]);
    expect(failed(await reconnected.get(handle)).code).toBe(
      ERROR_CODES.UNKNOWN_HANDLE
    );
  });

  it('closes a handle it only ever saw on disk', async () => {
    const first = build();
    const { handle } = await open(first);

    const reconnected = build();
    expect(unwrap(await reconnected.close(handle)).closed).toBe(true);
    expect(await handles()).toEqual([]);
    // And is still idempotent from there.
    expect(unwrap(await reconnected.close(handle)).closed).toBe(false);
  });

  it('keeps the disk when a host reclaims memory with closeAll', async () => {
    const store = build();
    const { handle } = await open(store);
    await setTitle(store, handle, 'Kept');

    // The asymmetry with `close` is the point: this is memory management, and
    // #290 is about an event that ends a connection not destroying revisions.
    await store.closeAll();
    expect(store.usage()).toEqual({ workspaces: 0, bytes: 0 });

    const read = unwrap(await store.get(handle));
    expect((read.document as any).props.title).toBe('Kept');
  });

  it('still lists the handle after closeAll, which is the way back to it', async () => {
    const store = build();
    const { handle } = await open(store);
    await store.closeAll();

    // `list` hides handles that were closed on purpose. A host reclaiming
    // memory is not that, and hiding these would leave the recovery path
    // pointing at nothing.
    const listed = unwrap(await store.list());
    expect(listed.records.map((record) => record.handle)).toEqual([handle]);
  });

  it('reports nothing closed, and keeps the workspace, when the disk refuses', async () => {
    // The store under test has to be the one whose close fails, or "the entry
    // survived" is a claim about some other store's memory.
    const persistence = createWorkspacePersistenceAt(root);
    const store = createMemoryWorkspaceStore({ now: () => clock, persistence });
    const { handle } = await open(store);

    // A directory that cannot be removed, which is what a permission problem
    // or a Windows file lock looks like from here.
    const removal = vi
      .spyOn(persistence, 'remove')
      .mockRejectedValue(new Error('EPERM: operation not permitted'));

    const problem = failed(await store.close(handle));
    expect(problem.code).toBe(WORKSPACE_ERROR_CODES.NOT_CLOSED);
    expect(problem.message).toMatch(/still open and still on disk/);

    // Still resident, not merely still on disk: a read that had to go to the
    // disk would mean the entry was released on the strength of a delete that
    // never happened.
    const load = vi.spyOn(persistence, 'load');
    expect(unwrap(await store.get(handle)).record.revision).toBe(1);
    expect(load).not.toHaveBeenCalled();
    load.mockRestore();
    expect(await handles()).toEqual([handle]);

    // And the failure is what it says it is: retryable.
    removal.mockRestore();
    expect(unwrap(await store.close(handle)).closed).toBe(true);
    expect(await handles()).toEqual([]);
  });
});

describe('overlapping calls', () => {
  it('does not let a patch in flight resurrect a closed workspace', async () => {
    const persistence = createWorkspacePersistenceAt(root);
    const store = createMemoryWorkspaceStore({ now: () => clock, persistence });
    const { handle } = await open(store);

    // The interleaving is forced rather than hoped for: the patch's write is
    // held open, so the close is guaranteed to arrive while it is in flight —
    // the arrangement in which an unserialized save recreates the directory
    // the close just deleted.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const write = persistence.save.bind(persistence);
    vi.spyOn(persistence, 'save').mockImplementationOnce(async (snapshot) => {
      await held;
      return write(snapshot);
    });

    const patching = store.patch({
      handle,
      operations: [{ op: 'add', path: '/props/title', value: 'racing' }],
    });
    const closing = store.close(handle);
    release();
    const [patched, closed] = await Promise.all([patching, closing]);

    expect(unwrap(closed).closed).toBe(true);
    // Whichever order they landed in, the close is the last word on disk.
    expect(await handles()).toEqual([]);
    expect(unwrap(await store.list()).records).toEqual([]);
    expect(failed(await build().get(handle)).code).toBe(
      ERROR_CODES.UNKNOWN_HANDLE
    );
    // The patch either committed before the close or reported the handle
    // gone; what it may not do is leave the document behind.
    if (patched.ok) expect(patched.record.revision).toBe(2);
  });

  it('drops a write that was queued behind the close of its own workspace', async () => {
    // The other ordering. Here the close reaches the disk first, so the
    // queue alone cannot help: the write that comes after has to notice the
    // workspace it belongs to is gone and decline to recreate it.
    const persistence = createWorkspacePersistenceAt(root);
    const store = createMemoryWorkspaceStore({ now: () => clock, persistence });
    const { handle } = await open(store);

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const erase = persistence.remove.bind(persistence);
    vi.spyOn(persistence, 'remove').mockImplementationOnce(async (target) => {
      await held;
      return erase(target);
    });

    const closing = store.close(handle);
    const patching = store.patch({
      handle,
      operations: [{ op: 'add', path: '/props/title', value: 'too late' }],
    });
    release();
    const [closed, patched] = await Promise.all([closing, patching]);

    expect(unwrap(closed).closed).toBe(true);
    expect(await handles()).toEqual([]);
    // The patch may well have committed in memory — it was applied before the
    // close landed — but it must not have put the workspace back on disk.
    if (patched.ok) expect(patched.record.persisted).toBe(false);
  });

  it('holds the workspace ceiling when several are opened at once', async () => {
    const store = build({ limits: { maxWorkspaces: 2 } });

    // Concurrent first saves each count the root before any of them has
    // created its directory, so unserialized they all see room.
    const created = await Promise.all([
      store.create({ format: 'docx', document: document() }),
      store.create({ format: 'docx', document: document() }),
      store.create({ format: 'docx', document: document() }),
    ]);
    for (const result of created) expect(result.ok).toBe(true);

    expect(await handles()).toHaveLength(2);
    // Every surviving directory is whole — none was deleted mid-write by a
    // sibling that thought it was pruning something stale.
    for (const handle of await handles()) {
      const restored = await createWorkspacePersistenceAt(root).load(handle);
      expect(restored?.head.revision).toBe(1);
    }
  });
});

describe('bounds', () => {
  it('keeps the root under its workspace ceiling, stalest first', async () => {
    const store = build({ limits: { maxWorkspaces: 2 } });
    const first = await open(store);
    clock += 1_000;
    const second = await open(store);
    clock += 1_000;
    const third = await open(store);

    expect((await handles()).sort()).toEqual(
      [second.handle, third.handle].sort()
    );

    // Dropped from disk, still resident: the ceiling bounds durability, not
    // the live workspace the agent is holding.
    const reconnected = build({ limits: { maxWorkspaces: 2 } });
    expect(failed(await reconnected.get(first.handle)).code).toBe(
      ERROR_CODES.UNKNOWN_HANDLE
    );
  });

  it('keeps only the retained revisions per workspace', async () => {
    const store = build({ limits: { maxRevisionsPerWorkspace: 2 } });
    const { handle } = await open(store);
    await store.snapshot(handle); // pins 1
    await setTitle(store, handle, 'two');
    await store.snapshot(handle); // pins 2
    await setTitle(store, handle, 'three');

    const files = (await fs.readdir(path.join(root, handle))).sort();
    expect(files).toEqual(['meta.json', 'rev-2.json', 'rev-3.json']);

    const reconnected = build();
    const record = unwrap(await reconnected.get(handle)).record;
    expect(record.revision).toBe(3);
    // Only the pin that was actually kept is advertised.
    expect(record.pinnedRevisions).toEqual([2]);
  });

  it('warns rather than fails when a revision is too large to persist', async () => {
    const store = build({ limits: { maxEntryBytes: 200 } });
    const created = unwrap(
      await store.create({
        format: 'docx',
        document: { name: 'docx', children: ['x'.repeat(500)] },
      })
    );

    expect(created.record.persisted).toBe(false);
    expect(created.warnings?.[0]).toMatchObject({
      severity: 'warning',
      code: WORKSPACE_ERROR_CODES.NOT_PERSISTED,
    });
    expect(created.warnings?.[0].message).toMatch(/persistence limit/);
    expect(await handles()).toEqual([]);

    // The workspace itself is entirely usable; only durability was refused.
    expect(unwrap(await store.get(created.record.handle)).record.revision).toBe(
      1
    );
  });

  it('refuses to restore into a full memory budget, and keeps the disk copy', async () => {
    const small = { name: 'docx' };
    const bytes = Buffer.byteLength(JSON.stringify(small));
    const first = build();
    const stored = await open(first, small);

    const tight = build({ maxTotalBytes: bytes - 1 });
    const problem = failed(await tight.get(stored.handle));
    expect(problem.code).toBe(WORKSPACE_ERROR_CODES.LIMIT);
    expect(problem.context).toMatchObject({ handle: stored.handle });

    // Nothing was thrown away: a roomier connection still finds it.
    const roomy = build();
    expect(unwrap(await roomy.get(stored.handle)).document).toEqual(small);
  });
});

describe('a directory it did not write', () => {
  it('ignores a workspace whose metadata is corrupt', async () => {
    const first = build();
    const { handle } = await open(first);
    await fs.writeFile(
      path.join(root, handle, 'meta.json'),
      '{ not json',
      'utf8'
    );

    const reconnected = build();
    expect(unwrap(await reconnected.list()).records).toEqual([]);
    expect(failed(await reconnected.get(handle)).code).toBe(
      ERROR_CODES.UNKNOWN_HANDLE
    );
  });

  it('ignores a workspace whose metadata names a format it does not have', async () => {
    const first = build();
    const { handle } = await open(first);
    const meta = JSON.parse(
      await fs.readFile(path.join(root, handle, 'meta.json'), 'utf8')
    );
    await fs.writeFile(
      path.join(root, handle, 'meta.json'),
      JSON.stringify({ ...meta, format: 'xlsx' }),
      'utf8'
    );

    expect(unwrap(await build().list()).records).toEqual([]);
  });

  it('discards a half-restored workspace whose document is missing', async () => {
    const first = build();
    const { handle } = await open(first);
    await fs.rm(path.join(root, handle, 'rev-1.json'));

    const reconnected = build();
    expect(failed(await reconnected.get(handle)).code).toBe(
      ERROR_CODES.UNKNOWN_HANDLE
    );
    // And it stops being offered, rather than staying in `list` as a handle
    // that fails on every use.
    expect(await handles()).toEqual([]);
  });

  it('never lets a handle name a directory of its own choosing', async () => {
    expect(isPersistableHandle('ws_abc-DEF_123')).toBe(true);
    for (const hostile of [
      '../escape',
      'a/b',
      'a\\b',
      '.',
      '..',
      '',
      'ws\0null',
    ]) {
      expect(isPersistableHandle(hostile)).toBe(false);
    }

    const store = build({ newHandle: () => '../escaped' });
    const created = unwrap(
      await store.create({ format: 'docx', document: document() })
    );
    expect(created.record.persisted).toBe(false);
    expect(created.warnings?.[0].code).toBe(
      WORKSPACE_ERROR_CODES.NOT_PERSISTED
    );
    expect(await fs.readdir(scratch)).not.toContain('escaped');
  });

  it('writes its own document rather than trusting a revision number', async () => {
    // Two connections on one root, both resuming revision 1 and both
    // committing revision 2. The file name collides; the content does not.
    // Trusting the name put one store's document under the other's metadata,
    // which is worse than either of them simply losing.
    const first = build();
    const { handle } = await open(first);

    const second = build();
    await setTitle(second, handle, 'from second');
    await setTitle(first, handle, 'from first');

    const reconnected = build();
    const read = unwrap(await reconnected.get(handle));
    expect(read.record.revision).toBe(2);
    // Last writer wins, whole: the document belongs to the metadata beside it.
    expect((read.document as any).props.title).toBe('from first');
    expect(read.record.bytes).toBe(
      Buffer.byteLength(JSON.stringify(read.document))
    );
  });

  it('reaps a temporary file an interrupted write left behind', async () => {
    const store = build();
    const { handle } = await open(store);
    const dir = path.join(root, handle);

    const debris = path.join(dir, 'rev-9.json.deadbeef.tmp');
    await fs.writeFile(debris, '{"name":"docx"}', 'utf8');
    const live = path.join(dir, 'rev-9.json.feedface.tmp');
    await fs.writeFile(live, '{"name":"docx"}', 'utf8');

    // Only one of them looks like a write that died: a `.tmp` exists for
    // milliseconds, so an hour old is debris and anything newer may still
    // belong to a write in flight on a shared root.
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(debris, old, old);

    await setTitle(store, handle, 'sweeps on write');

    const left = (await fs.readdir(dir)).filter((name) =>
      name.endsWith('.tmp')
    );
    expect(left).toEqual([path.basename(live)]);
  });

  it('never names a revision file the metadata does not have', async () => {
    const store = build();
    const { handle } = await open(store);
    await store.snapshot(handle);
    await setTitle(store, handle, 'two');
    await setTitle(store, handle, 'three');

    const dir = path.join(root, handle);
    const meta = JSON.parse(
      await fs.readFile(path.join(dir, 'meta.json'), 'utf8')
    );
    for (const revision of [meta.revision, ...meta.pinnedRevisions]) {
      await expect(
        fs.access(path.join(dir, `rev-${revision}.json`))
      ).resolves.toBeUndefined();
    }
    // Nothing is left over either.
    expect(
      (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'))
    ).toEqual([]);
  });
});

describe('when the disk refuses', () => {
  it('commits the edit and says the revision did not reach disk', async () => {
    // A file where the root's parent directory has to be: `mkdir` cannot
    // succeed, which is the cheap portable stand-in for a read-only or full
    // disk.
    const blocked = path.join(scratch, 'not-a-dir');
    await fs.writeFile(blocked, 'occupied', 'utf8');
    const store = createMemoryWorkspaceStore({
      now: () => clock,
      persistence: createWorkspacePersistenceAt(
        path.join(blocked, 'workspaces')
      ),
    });

    const created = unwrap(
      await store.create({ format: 'docx', document: document() })
    );
    expect(created.record.persisted).toBe(false);
    const warning = created.warnings?.[0];
    expect(warning?.code).toBe(WORKSPACE_ERROR_CODES.NOT_PERSISTED);
    expect(warning?.severity).toBe('warning');
    expect(warning?.suggestion).toMatch(/jto_workspace_snapshot/);

    // The edit itself landed, and keeps landing.
    const patched = unwrap(
      await store.patch({
        handle: created.record.handle,
        operations: [{ op: 'add', path: '/props/title', value: 'Draft' }],
      })
    );
    expect(patched.record.revision).toBe(2);
    expect(patched.warnings?.[0].code).toBe(
      WORKSPACE_ERROR_CODES.NOT_PERSISTED
    );
  });
});

describe('configuration', () => {
  it('is off unless a root is named', () => {
    expect(createWorkspacePersistence({ env: {} })).toBeUndefined();
    expect(
      createWorkspacePersistence({ env: { [WORKSPACE_DIR_ENV]: '   ' } })
    ).toBeUndefined();
  });

  it('takes the environment, and the flag over it', () => {
    const fromEnv = createWorkspacePersistence({
      env: { [WORKSPACE_DIR_ENV]: root },
    });
    expect(fromEnv?.root).toBe(root);

    const flagged = path.join(scratch, 'flagged');
    const fromFlag = createWorkspacePersistence({
      flagDir: flagged,
      env: { [WORKSPACE_DIR_ENV]: root },
    });
    expect(fromFlag?.root).toBe(flagged);
  });

  it('resolves a relative root against the working directory', () => {
    const persistence = createWorkspacePersistence({ flagDir: 'ws-relative' });
    expect(persistence?.root).toBe(path.resolve('ws-relative'));
  });

  it('does not create the root until something is written', async () => {
    createWorkspacePersistenceAt(root);
    await expect(fs.access(root)).rejects.toThrow();
  });
});
