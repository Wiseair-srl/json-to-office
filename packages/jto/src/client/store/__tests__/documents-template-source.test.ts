import { describe, expect, it, vi } from 'vitest';

// In-memory stand-in: idb-keyval touches real IndexedDB at import time under
// the persist middleware, which node's test environment doesn't have.
vi.mock('idb-keyval', () => {
  const store = new Map<string, unknown>();
  return {
    get: async (k: string) => store.get(k),
    set: async (k: string, v: unknown) => void store.set(k, v),
    del: async (k: string) => void store.delete(k),
  };
});

import {
  createDocumentsStore,
  initDocumentsStore,
  resolveSourceName,
} from '../documents-store';

describe('template provenance', () => {
  it('createDocument records templateSource and rename preserves it', () => {
    const store = createDocumentsStore(initDocumentsStore());
    store.getState().createDocument('vermilion-annual-report', '{}', {
      templateSource: 'vermilion-annual-report',
    });
    store.getState().createDocument('scratch', '{}');

    let docs = store.getState().documents;
    expect(
      docs.find((d) => d.name === 'vermilion-annual-report')
    ).toMatchObject({ templateSource: 'vermilion-annual-report' });
    expect(
      docs.find((d) => d.name === 'scratch')?.templateSource
    ).toBeUndefined();

    store.getState().renameDocument('vermilion-annual-report', 'my-report');
    docs = store.getState().documents;
    expect(docs.find((d) => d.name === 'my-report')).toMatchObject({
      templateSource: 'vermilion-annual-report',
    });
  });

  it('resolveSourceName prefers provenance and falls back to the name', () => {
    const docs = [
      { name: 'my-report', templateSource: 'vermilion-annual-report' },
      { name: 'scratch' },
    ] as Parameters<typeof resolveSourceName>[0];

    expect(resolveSourceName(docs, 'my-report')).toBe(
      'vermilion-annual-report'
    );
    // Pre-provenance documents and never-persisted names keep today's
    // behaviour: the display name goes to the server as-is.
    expect(resolveSourceName(docs, 'scratch')).toBe('scratch');
    expect(resolveSourceName(docs, 'unknown')).toBe('unknown');
  });
});
