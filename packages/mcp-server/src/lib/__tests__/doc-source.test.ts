import { describe, it, expect, afterEach } from 'vitest';

import { resolveDocumentSource, parseDocumentJson } from '../doc-source.js';
import { ERROR_CODES } from '../errors.js';
import {
  getWorkspaceStore,
  setWorkspaceStore,
  unavailableWorkspaceStore,
  type WorkspaceRecord,
  type WorkspaceStore,
} from '../workspace-store.js';

const record: WorkspaceRecord = {
  handle: 'ws_1',
  format: 'docx',
  revision: 7,
  bytes: 12,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  pinnedRevisions: [],
};

/** Minimal store that answers `get` and nothing else. */
function fakeStore(get: WorkspaceStore['get']): WorkspaceStore {
  return { ...unavailableWorkspaceStore, available: true, get };
}

afterEach(() => {
  setWorkspaceStore(undefined);
});

describe('resolveDocumentSource', () => {
  it('passes an inline document through', async () => {
    const document = { props: {}, content: [] };
    const resolved = await resolveDocumentSource({ document });
    expect(resolved).toEqual({ ok: true, document, origin: 'inline' });
  });

  it('rejects neither given', async () => {
    const resolved = await resolveDocumentSource({});
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].code).toBe(ERROR_CODES.DOC_SOURCE_MISSING);
  });

  it('rejects both given', async () => {
    const resolved = await resolveDocumentSource({
      document: {},
      handle: 'ws_1',
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].code).toBe(ERROR_CODES.DOC_SOURCE_AMBIGUOUS);
  });

  it('rejects a revision paired with an inline document', async () => {
    const resolved = await resolveDocumentSource({
      document: {},
      revision: 3,
    });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].code).toBe(ERROR_CODES.DOC_SOURCE_AMBIGUOUS);
  });

  it('reads through the workspace store', async () => {
    const document = { props: { title: 'from workspace' } };
    const store = fakeStore(async () => ({ ok: true, record, document }));
    const resolved = await resolveDocumentSource({ handle: 'ws_1' }, store);
    expect(resolved).toEqual({
      ok: true,
      document,
      origin: 'workspace',
      handle: 'ws_1',
      revision: 7,
    });
  });

  it('forwards the requested revision to the store', async () => {
    let seen: number | undefined;
    const store = fakeStore(async (_handle, options) => {
      seen = options?.revision;
      return { ok: true, record, document: {} };
    });
    await resolveDocumentSource({ handle: 'ws_1', revision: 5 }, store);
    expect(seen).toBe(5);
  });

  it('surfaces the store failure verbatim', async () => {
    const store = fakeStore(async () => ({
      ok: false,
      diagnostics: [
        {
          severity: 'error' as const,
          code: ERROR_CODES.STALE_REVISION,
          message: 'stale',
        },
      ],
    }));
    const resolved = await resolveDocumentSource(
      { handle: 'ws_1', revision: 2 },
      store
    );
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].code).toBe(ERROR_CODES.STALE_REVISION);
  });

  it('reports handles as unavailable when no store is installed', async () => {
    const resolved = await resolveDocumentSource({ handle: 'ws_1' });
    expect(resolved.ok).toBe(false);
    if (resolved.ok) return;
    expect(resolved.diagnostics[0].code).toBe(
      ERROR_CODES.WORKSPACES_UNAVAILABLE
    );
  });
});

describe('workspace store holder', () => {
  it('defaults to the unavailable store and restores on undefined', () => {
    expect(getWorkspaceStore().available).toBe(false);
    const store = fakeStore(async () => ({ ok: true, record, document: {} }));
    setWorkspaceStore(store);
    expect(getWorkspaceStore()).toBe(store);
    setWorkspaceStore(undefined);
    expect(getWorkspaceStore()).toBe(unavailableWorkspaceStore);
  });

  it('answers list with an empty set rather than an error', async () => {
    const listed = await unavailableWorkspaceStore.list();
    expect(listed).toEqual({ ok: true, records: [] });
  });
});

describe('parseDocumentJson', () => {
  it('parses valid JSON', () => {
    expect(parseDocumentJson('{"a":1}')).toEqual({
      ok: true,
      document: { a: 1 },
    });
  });

  it('returns a structured error for invalid JSON', () => {
    const result = parseDocumentJson('{oops', '/content/0');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostics[0].code).toBe(ERROR_CODES.INVALID_JSON);
    expect(result.diagnostics[0].path).toBe('/content/0');
  });
});
