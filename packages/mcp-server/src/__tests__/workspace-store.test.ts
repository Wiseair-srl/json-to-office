/**
 * The store's promises: monotonic revisions, atomic writes, isolation between
 * workspaces, and bounds that say why they fired.
 *
 * The clock is injected rather than faked globally — the TTL cases are about
 * the store's arithmetic, not about vitest's timers, and a real 30-minute wait
 * is obviously off the table.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  createMemoryWorkspaceStore,
  DEFAULT_WORKSPACE_LIMITS,
  WORKSPACE_ERROR_CODES,
  type MemoryWorkspaceStore,
} from '../workspace/store.js';
import { ERROR_CODES } from '../lib/errors.js';
import { PATCH_ERROR_CODES } from '../workspace/json-patch.js';

const document = () => ({
  name: 'docx',
  props: { theme: 'minimal' },
  children: [{ name: 'heading', props: { text: 'One', level: 1 } }],
});

let clock = 1_700_000_000_000;
let store: MemoryWorkspaceStore;

function build(options: Parameters<typeof createMemoryWorkspaceStore>[0] = {}) {
  return createMemoryWorkspaceStore({ now: () => clock, ...options });
}

async function open(
  target: MemoryWorkspaceStore = store,
  doc: unknown = document()
) {
  const created = await target.create({ format: 'docx', document: doc });
  if (!created.ok) throw new Error(created.diagnostics[0].message);
  return created.record;
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
  path?: string;
  context?: Record<string, unknown>;
} {
  expect(result.ok).toBe(false);
  return (result as any).diagnostics[0];
}

beforeEach(() => {
  clock = 1_700_000_000_000;
  store = build();
});

describe('handles and revisions', () => {
  it('opens at revision 1 with an opaque handle', async () => {
    const record = await open();
    expect(record.revision).toBe(1);
    expect(record.handle).toMatch(/^ws_[A-Za-z0-9_-]+$/);
    expect(record.bytes).toBe(Buffer.byteLength(JSON.stringify(document())));
    expect(record.pinnedRevisions).toEqual([]);
  });

  it('never reuses a handle across two workspaces', async () => {
    const handles = new Set<string>();
    for (let index = 0; index < 8; index += 1) {
      handles.add((await open()).handle);
    }
    expect(handles.size).toBe(8);
  });

  it('increments the revision by one per committed patch', async () => {
    const { handle } = await open();
    for (let expected = 2; expected <= 4; expected += 1) {
      const patched = unwrap(
        await store.patch({
          handle,
          operations: [
            { op: 'add', path: '/children/-', value: { name: 'divider' } },
          ],
        })
      );
      expect(patched.record.revision).toBe(expected);
    }
  });

  it('echoes a title and reports growth in bytes', async () => {
    const created = unwrap(
      await store.create({
        format: 'pptx',
        document: { name: 'pptx' },
        title: 'Deck',
      })
    );
    expect(created.record.title).toBe('Deck');
    expect(created.record.format).toBe('pptx');
    const patched = unwrap(
      await store.patch({
        handle: created.record.handle,
        operations: [
          { op: 'add', path: '/props', value: { title: 'A longer value' } },
        ],
      })
    );
    expect(patched.record.bytes).toBeGreaterThan(created.record.bytes);
  });

  it('refuses a document that is not JSON', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(
      failed(await store.create({ format: 'docx', document: circular })).code
    ).toBe(ERROR_CODES.INVALID_JSON);
  });

  it('refuses a document whose root is not an object', async () => {
    for (const document of [42, 'oops', [1, 2, 3], null]) {
      const refused = failed(await store.create({ format: 'docx', document }));
      expect(refused.code).toBe(WORKSPACE_ERROR_CODES.INVALID_ROOT);
      expect(refused.path).toBe('');
    }
  });
});

describe('isolation', () => {
  it('does not share structure with the document it was given', async () => {
    const source = document();
    const { handle } = await open(store, source);
    source.children[0].props.text = 'mutated outside';

    const read = unwrap(await store.get(handle));
    expect((read.document as any).children[0].props.text).toBe('One');
  });

  it('hands out a copy the caller may mutate freely', async () => {
    const { handle } = await open();
    const first = unwrap(await store.get(handle));
    (first.document as any).children.push({ name: 'injected' });

    const second = unwrap(await store.get(handle));
    expect((second.document as any).children).toHaveLength(1);
  });

  it('keeps two workspaces opened from the same object apart', async () => {
    const shared = document();
    const left = await open(store, shared);
    const right = await open(store, shared);
    expect(left.handle).not.toBe(right.handle);

    unwrap(
      await store.patch({
        handle: left.handle,
        operations: [
          { op: 'replace', path: '/props/theme', value: 'corporate' },
        ],
      })
    );

    const other = unwrap(await store.get(right.handle));
    expect((other.document as any).props.theme).toBe('minimal');
    expect(other.record.revision).toBe(1);
  });
});

describe('patching is atomic', () => {
  it('leaves the document byte-identical when an operation fails', async () => {
    const { handle } = await open();
    const before = unwrap(await store.get(handle));

    const result = await store.patch({
      handle,
      operations: [
        { op: 'add', path: '/props/author', value: 'Wiseair' },
        { op: 'replace', path: '/children/9/props/text', value: 'nope' },
      ],
    });
    const problem = failed(result);
    expect(problem.code).toBe(PATCH_ERROR_CODES.FAILED);
    expect(problem.context).toMatchObject({ handle, operationIndex: 1 });

    const after = unwrap(await store.get(handle));
    expect(JSON.stringify(after.document)).toBe(
      JSON.stringify(before.document)
    );
    expect(after.record.revision).toBe(1);
  });

  it('does not burn a revision on a failed patch', async () => {
    const { handle } = await open();
    await store.patch({
      handle,
      operations: [{ op: 'test', path: '/props/theme', value: 'x' }],
    });
    const listed = unwrap(await store.list());
    expect(listed.records[0].revision).toBe(1);
  });

  it('names the offending pointer when it is not RFC 6901', async () => {
    const { handle } = await open();
    const problem = failed(
      await store.patch({
        handle,
        operations: [{ op: 'add', path: 'children/-', value: {} }],
      })
    );
    expect(problem.code).toBe('E_INVALID_POINTER');
    expect(problem.message).toMatch(/must be empty .* or start with "\/"/);
    expect(problem.context).toMatchObject({
      pointer: 'children/-',
      operationIndex: 0,
    });
  });

  it('rejects an empty patch instead of bumping the revision for nothing', async () => {
    const { handle } = await open();
    expect(failed(await store.patch({ handle, operations: [] })).code).toBe(
      PATCH_ERROR_CODES.SYNTAX
    );
  });

  it('keeps invalid authoring states on purpose', async () => {
    const { handle } = await open();
    const patched = unwrap(
      await store.patch({
        handle,
        operations: [{ op: 'replace', path: '/name', value: 42 }],
      })
    );
    expect(patched.record.revision).toBe(2);
    expect((unwrap(await store.get(handle)).document as any).name).toBe(42);
  });

  // The line between the two: a bad `name` is still an object, so the agent
  // reads it back and patches it. A root that is not an object cannot be read
  // back at all — `get` would hand every caller something no output schema
  // admits — so the write is the last moment the document can be saved.
  it('refuses a patch that would leave the root a non-object', async () => {
    const { handle } = await open();
    for (const value of [42, 'oops', [1, 2, 3], null]) {
      const refused = failed(
        await store.patch({
          handle,
          operations: [{ op: 'replace', path: '', value }],
        })
      );
      expect(refused.code).toBe(WORKSPACE_ERROR_CODES.INVALID_ROOT);
      expect(refused.path).toBe('');
    }

    // The check is on what would be committed, not on `replace ""`.
    expect(
      failed(
        await store.patch({
          handle,
          operations: [{ op: 'copy', path: '', from: '/children' }],
        })
      ).code
    ).toBe(WORKSPACE_ERROR_CODES.INVALID_ROOT);

    const read = unwrap(await store.get(handle));
    expect(read.record.revision).toBe(1);
    expect(read.document).toEqual(document());
  });

  it('still allows a root swapped for another object', async () => {
    const { handle } = await open();
    const patched = unwrap(
      await store.patch({
        handle,
        operations: [
          { op: 'replace', path: '', value: { name: 'docx', children: [] } },
        ],
      })
    );
    expect(patched.record.revision).toBe(2);
  });
});

describe('conditional writes', () => {
  it('applies when baseRevision matches', async () => {
    const { handle } = await open();
    const patched = unwrap(
      await store.patch({
        handle,
        baseRevision: 1,
        operations: [{ op: 'add', path: '/props/author', value: 'Wiseair' }],
      })
    );
    expect(patched.record.revision).toBe(2);
  });

  it('rejects a stale write without applying any of it', async () => {
    const { handle } = await open();
    unwrap(
      await store.patch({
        handle,
        operations: [{ op: 'add', path: '/props/author', value: 'Wiseair' }],
      })
    );

    const problem = failed(
      await store.patch({
        handle,
        baseRevision: 1,
        operations: [
          { op: 'add', path: '/children/-', value: { name: 'divider' } },
        ],
      })
    );
    expect(problem.code).toBe(ERROR_CODES.STALE_REVISION);
    expect(problem.message).toMatch(/Nothing was applied/);
    expect(problem.context).toMatchObject({ requested: 1, current: 2 });

    const after = unwrap(await store.get(handle));
    expect(after.record.revision).toBe(2);
    expect((after.document as any).children).toHaveLength(1);
  });

  it('rejects a read pinned to a revision that was never kept', async () => {
    const { handle } = await open();
    expect(failed(await store.get(handle, { revision: 7 })).code).toBe(
      ERROR_CODES.STALE_REVISION
    );
  });
});

describe('projection', () => {
  it('returns only the pointers asked for', async () => {
    const { handle } = await open();
    const read = unwrap(
      await store.get(handle, {
        paths: ['/props/theme', '/children/0/props/text'],
      })
    );
    expect(read.projection).toEqual({
      '/props/theme': 'minimal',
      '/children/0/props/text': 'One',
    });
  });

  it('omits pointers that resolve nowhere rather than reporting null', async () => {
    const { handle } = await open();
    const read = unwrap(await store.get(handle, { paths: ['/props/missing'] }));
    expect(read.projection).toEqual({});
  });

  it('fails a malformed pointer with the pointer in context', async () => {
    const { handle } = await open();
    const problem = failed(await store.get(handle, { paths: ['props/theme'] }));
    expect(problem.code).toBe('E_INVALID_POINTER');
    expect(problem.context).toMatchObject({ pointer: 'props/theme' });
  });
});

describe('snapshots', () => {
  it('pins the revision it exported so it stays readable after later patches', async () => {
    const { handle } = await open();
    const snapshot = unwrap(await store.snapshot(handle));
    expect(snapshot.record.pinnedRevisions).toEqual([1]);

    unwrap(
      await store.patch({
        handle,
        operations: [
          { op: 'replace', path: '/props/theme', value: 'corporate' },
        ],
      })
    );

    const pinned = unwrap(await store.get(handle, { revision: 1 }));
    expect((pinned.document as any).props.theme).toBe('minimal');
    // The record describes the document that came back, not the live head.
    expect(pinned.record.revision).toBe(1);

    const head = unwrap(await store.get(handle));
    expect(head.record.revision).toBe(2);
    expect((head.document as any).props.theme).toBe('corporate');
  });

  it('is idempotent at one revision', async () => {
    const { handle } = await open();
    await store.snapshot(handle);
    const again = unwrap(await store.snapshot(handle));
    expect(again.record.pinnedRevisions).toEqual([1]);
  });

  it('exports without releasing an older pin at the cap', async () => {
    store = build({ maxPinnedRevisions: 2 });
    const { handle } = await open();
    for (let index = 0; index < 3; index += 1) {
      await store.snapshot(handle);
      unwrap(
        await store.patch({
          handle,
          operations: [
            { op: 'add', path: '/children/-', value: { name: 'divider' } },
          ],
        })
      );
    }
    const listed = unwrap(await store.list());
    expect(listed.records[0].pinnedRevisions).toEqual([1, 2]);
    expect(
      unwrap(await store.get(handle, { revision: 1 })).record.revision
    ).toBe(1);
    expect(failed(await store.get(handle, { revision: 3 })).code).toBe(
      ERROR_CODES.STALE_REVISION
    );
  });
});

describe('bounds', () => {
  it('refuses a new workspace without evicting existing workspaces', async () => {
    store = build({ maxWorkspaces: 2 });
    const first = await open();
    const second = await open();
    const problem = failed(
      await store.create({ format: 'docx', document: document() })
    );
    expect(problem.code).toBe(WORKSPACE_ERROR_CODES.LIMIT);

    const listed = unwrap(await store.list());
    expect(listed.records.map((record) => record.handle)).toEqual([
      first.handle,
      second.handle,
    ]);
  });

  it('refuses document growth without evicting another workspace', async () => {
    const small = { name: 'docx' };
    const bytes = Buffer.byteLength(JSON.stringify(small));
    store = build({ maxTotalBytes: bytes * 2 + 5 });
    const first = await open(store, small);
    const second = await open(store, small);

    const problem = failed(
      await store.patch({
        handle: second.handle,
        operations: [{ op: 'add', path: '/value', value: 'too large' }],
      })
    );
    expect(problem.code).toBe(WORKSPACE_ERROR_CODES.LIMIT);
    expect(unwrap(await store.get(first.handle)).document).toEqual(small);
    expect(unwrap(await store.get(second.handle)).document).toEqual(small);
  });

  it('refuses a document over the per-document ceiling', async () => {
    store = build({ maxDocumentBytes: 200 });
    const problem = failed(
      await store.create({
        format: 'docx',
        document: { name: 'docx', children: ['x'.repeat(500)] },
      })
    );
    expect(problem.code).toBe(WORKSPACE_ERROR_CODES.DOCUMENT_TOO_LARGE);
    expect(problem.context).toMatchObject({ maxDocumentBytes: 200 });
  });

  it('refuses a patch that would push the document over the ceiling, and keeps the old one', async () => {
    store = build({ maxDocumentBytes: 300 });
    const { handle } = await open(store, { name: 'docx', children: [] });
    const problem = failed(
      await store.patch({
        handle,
        operations: [
          { op: 'add', path: '/children/-', value: 'x'.repeat(500) },
        ],
      })
    );
    expect(problem.code).toBe(WORKSPACE_ERROR_CODES.DOCUMENT_TOO_LARGE);

    const after = unwrap(await store.get(handle));
    expect((after.document as any).children).toEqual([]);
    expect(after.record.revision).toBe(1);
  });

  it('reports the total budget when nothing can be freed', async () => {
    store = build({ maxTotalBytes: 100 });
    const problem = failed(
      await store.create({
        format: 'docx',
        document: { name: 'docx', children: ['x'.repeat(500)] },
      })
    );
    expect(problem.code).toBe(WORKSPACE_ERROR_CODES.LIMIT);
  });

  it('publishes its limits and live usage', async () => {
    await open();
    expect(store.limits).toEqual(DEFAULT_WORKSPACE_LIMITS);
    expect(store.usage()).toEqual({
      workspaces: 1,
      bytes: Buffer.byteLength(JSON.stringify(document())),
    });
  });
});

describe('idle TTL', () => {
  it('releases a handle that has gone untouched, saying so', async () => {
    store = build({ idleTtlMs: 60_000 });
    const { handle } = await open();
    clock += 60_001;

    const problem = failed(await store.get(handle));
    expect(problem.code).toBe(WORKSPACE_ERROR_CODES.EVICTED);
    expect(problem.context).toMatchObject({ reason: 'ttl', revision: 1 });
    expect(problem.message).toMatch(/60s of inactivity/);
  });

  it('is reset by any use, read or write', async () => {
    store = build({ idleTtlMs: 60_000 });
    const { handle } = await open();
    for (let step = 0; step < 5; step += 1) {
      clock += 59_000;
      expect(unwrap(await store.get(handle)).record.revision).toBe(1);
    }
    clock += 59_000;
    unwrap(
      await store.patch({
        handle,
        operations: [{ op: 'add', path: '/props/author', value: 'Wiseair' }],
      })
    );
    clock += 60_001;
    expect(failed(await store.get(handle)).code).toBe(
      WORKSPACE_ERROR_CODES.EVICTED
    );
  });

  it('drops expired workspaces out of list', async () => {
    store = build({ idleTtlMs: 60_000 });
    const stale = await open();
    clock += 59_000;
    const fresh = await open();
    clock += 2_000;

    const listed = unwrap(await store.list());
    expect(listed.records.map((record) => record.handle)).toEqual([
      fresh.handle,
    ]);
    expect(failed(await store.get(stale.handle)).context).toMatchObject({
      reason: 'ttl',
    });
  });
});

describe('close', () => {
  it('releases the handle and reports the reason afterwards', async () => {
    const { handle } = await open();
    expect(unwrap(await store.close(handle))).toMatchObject({
      handle,
      closed: true,
    });

    const problem = failed(await store.get(handle));
    expect(problem.code).toBe(ERROR_CODES.UNKNOWN_HANDLE);
    expect(problem.message).toMatch(/was closed/);
  });

  it('is idempotent', async () => {
    const { handle } = await open();
    await store.close(handle);
    expect(unwrap(await store.close(handle))).toMatchObject({ closed: false });
  });

  it('distinguishes a handle it has never seen', async () => {
    const problem = failed(await store.get('ws_never'));
    expect(problem.code).toBe(ERROR_CODES.UNKNOWN_HANDLE);
    expect(problem.message).toMatch(/No workspace/);
  });

  it('closeAll empties the store', async () => {
    await open();
    await open();
    await store.closeAll();
    expect(unwrap(await store.list()).records).toEqual([]);
    expect(store.usage()).toEqual({ workspaces: 0, bytes: 0 });
  });
});

describe('recovering from context loss', () => {
  it('lists every open handle with its revision and size', async () => {
    const first = await open();
    unwrap(
      await store.patch({
        handle: first.handle,
        operations: [{ op: 'add', path: '/props/author', value: 'Wiseair' }],
      })
    );
    const second = unwrap(
      await store.create({
        format: 'pptx',
        document: { name: 'pptx' },
        title: 'Deck',
      })
    ).record;

    // Everything the agent knew is gone; `list` is all it has.
    const listed = unwrap(await store.list());
    expect(listed.records).toHaveLength(2);
    expect(listed.records[0]).toMatchObject({
      handle: first.handle,
      revision: 2,
    });
    expect(listed.records[1]).toMatchObject({
      handle: second.handle,
      title: 'Deck',
      format: 'pptx',
      revision: 1,
    });

    const recovered = unwrap(await store.get(listed.records[0].handle));
    expect((recovered.document as any).props.author).toBe('Wiseair');
  });
});
