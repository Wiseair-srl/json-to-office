import { beforeEach, describe, expect, it, vi } from 'vitest';

// The store persists to IndexedDB, which Node does not have; an in-memory
// map stands in so the actions can be exercised and hydration completes.
vi.mock('idb-keyval', () => {
  const memory = new Map<string, string>();
  return {
    get: async (key: string) => memory.get(key),
    set: async (key: string, value: string) => {
      memory.set(key, value);
    },
    del: async (key: string) => {
      memory.delete(key);
    },
  };
});

import {
  activePluginsSignature,
  browserComponentsForSchema,
  componentNameOwner,
  selectActivePlugins,
  useBrowserPluginsStore,
  whenBrowserPluginsHydrated,
} from '../browser-plugins-store';
import type { BrowserPluginMetadata } from '../../lib/plugins/types';

const metadata = (name: string): BrowserPluginMetadata => ({
  name,
  format: 'docx',
  versions: [
    { version: '1.0.0', propsSchema: { type: 'object' }, hasChildren: false },
  ],
  latest: '1.0.0',
  examples: [],
});

describe('browser plugins store', () => {
  beforeEach(async () => {
    await whenBrowserPluginsHydrated();
    useBrowserPluginsStore.setState({ records: {} });
  });

  it('upsert creates with defaults and patches in place', () => {
    const store = useBrowserPluginsStore.getState();
    store.upsert('a.component.ts', { status: 'compiling', sourceHash: 'h1' });
    let record = useBrowserPluginsStore.getState().records['a.component.ts'];
    expect(record).toMatchObject({
      enabled: true,
      allowNetwork: false,
      status: 'compiling',
      sourceHash: 'h1',
      diagnostics: [],
    });
    expect(typeof record.createdAt).toBe('number');
    const createdAt = record.createdAt;
    store.upsert('a.component.ts', {
      status: 'ready',
      metadata: metadata('a'),
    });
    record = useBrowserPluginsStore.getState().records['a.component.ts'];
    expect(record.status).toBe('ready');
    expect(record.sourceHash).toBe('h1');
    expect(record.createdAt).toBe(createdAt);
  });

  it('only enabled, ready plugins with metadata are active', () => {
    const store = useBrowserPluginsStore.getState();
    store.upsert('a.component.ts', {
      status: 'ready',
      metadata: metadata('a'),
    });
    store.upsert('b.component.ts', {
      status: 'error',
      metadata: metadata('b'),
    });
    store.upsert('c.component.ts', {
      status: 'ready',
      metadata: metadata('c'),
    });
    store.setEnabled('c.component.ts', false);
    store.upsert('d.component.ts', { status: 'ready' });
    const active = selectActivePlugins(useBrowserPluginsStore.getState());
    expect(active.map((p) => p.metadata.name)).toEqual(['a']);
    expect(
      browserComponentsForSchema(useBrowserPluginsStore.getState())
    ).toEqual([
      {
        name: 'a',
        versions: [{ version: '1.0.0', propsSchema: { type: 'object' } }],
      },
    ]);
  });

  it('signature changes when the set or a schema changes', () => {
    const store = useBrowserPluginsStore.getState();
    store.upsert('a.component.ts', {
      status: 'ready',
      metadata: metadata('a'),
    });
    const first = activePluginsSignature(useBrowserPluginsStore.getState());
    expect(first).not.toBe('');
    store.upsert('a.component.ts', {
      metadata: {
        ...metadata('a'),
        versions: [
          {
            version: '1.0.0',
            propsSchema: {
              type: 'object',
              properties: { x: { type: 'string' } },
            },
            hasChildren: false,
          },
        ],
      },
    });
    const second = activePluginsSignature(useBrowserPluginsStore.getState());
    expect(second).not.toBe(first);
    store.setEnabled('a.component.ts', false);
    expect(activePluginsSignature(useBrowserPluginsStore.getState())).toBe('');
  });

  it('the signature follows every field the schema route receives', () => {
    const store = useBrowserPluginsStore.getState();
    store.upsert('a.component.ts', {
      status: 'ready',
      metadata: metadata('a'),
    });
    const base = activePluginsSignature(useBrowserPluginsStore.getState());

    // `hasChildren` and `description` reach the composed schema too, so a
    // change to either has to refresh Monaco and the schema dialog.
    store.upsert('a.component.ts', {
      metadata: {
        ...metadata('a'),
        versions: [
          {
            version: '1.0.0',
            propsSchema: { type: 'object' },
            hasChildren: true,
          },
        ],
      },
    });
    const withChildren = activePluginsSignature(
      useBrowserPluginsStore.getState()
    );
    expect(withChildren).not.toBe(base);

    store.upsert('a.component.ts', {
      metadata: {
        ...metadata('a'),
        versions: [
          {
            version: '1.0.0',
            propsSchema: { type: 'object' },
            hasChildren: true,
            description: 'A tile.',
          },
        ],
      },
    });
    expect(activePluginsSignature(useBrowserPluginsStore.getState())).not.toBe(
      withChildren
    );
  });

  it('a switch flipped before the first compile creates the record', () => {
    const store = useBrowserPluginsStore.getState();
    // The file is on screen the moment it is created; the sync hook writes
    // its record one compile later. A switch touched in between has to stick.
    store.setEnabled('fresh.component.ts', false);
    expect(
      useBrowserPluginsStore.getState().records['fresh.component.ts']
    ).toMatchObject({ docName: 'fresh.component.ts', enabled: false });

    store.setAllowNetwork('other.component.ts', true);
    expect(
      useBrowserPluginsStore.getState().records['other.component.ts']
    ).toMatchObject({
      docName: 'other.component.ts',
      enabled: true,
      allowNetwork: true,
    });
  });

  it('rename keeps the switches and remove drops the record', () => {
    const store = useBrowserPluginsStore.getState();
    store.upsert('a.component.ts', {
      status: 'ready',
      metadata: metadata('a'),
    });
    store.setAllowNetwork('a.component.ts', true);
    store.rename('a.component.ts', 'b.component.ts');
    const records = useBrowserPluginsStore.getState().records;
    expect(records['a.component.ts']).toBeUndefined();
    expect(records['b.component.ts']).toMatchObject({
      docName: 'b.component.ts',
      allowNetwork: true,
    });
    store.remove('b.component.ts');
    expect(useBrowserPluginsStore.getState().records).toEqual({});
  });

  it('the oldest record owns a component name, whatever its status', () => {
    const store = useBrowserPluginsStore.getState();
    // `createdAt` is stamped by upsert and not patchable; the clock is
    // faked so the records get distinct, ordered stamps.
    vi.useFakeTimers();
    try {
      vi.setSystemTime(200);
      store.upsert('newer.component.ts', {
        status: 'ready',
        metadata: metadata('kpi'),
      });
      vi.setSystemTime(100);
      store.upsert('older.component.ts', {
        status: 'error',
        metadata: metadata('kpi'),
      });
      vi.setSystemTime(50);
      store.upsert('other.component.ts', {
        status: 'ready',
        metadata: metadata('other'),
      });
      const records = useBrowserPluginsStore.getState().records;
      expect(componentNameOwner(records, 'kpi')).toBe('older.component.ts');
      expect(componentNameOwner(records, 'other')).toBe('other.component.ts');
      expect(componentNameOwner(records, 'missing')).toBeUndefined();
      // A record that has not compiled yet claims nothing.
      vi.setSystemTime(1);
      store.upsert('draft.component.ts', { status: 'compiling' });
      expect(
        componentNameOwner(useBrowserPluginsStore.getState().records, 'kpi')
      ).toBe('older.component.ts');
    } finally {
      vi.useRealTimers();
    }
  });
});
