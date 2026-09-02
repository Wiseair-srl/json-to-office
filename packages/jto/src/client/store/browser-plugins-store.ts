import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStorage } from '../lib/idb-storage';
import { hashSource } from '../lib/plugins/hash';
import type {
  BrowserPluginMetadata,
  BrowserPluginRecord,
  PluginDiagnostic,
} from '../lib/plugins/types';

/**
 * Plugins compiled in the browser, one record per `*.component.ts` file.
 *
 * The compiled JavaScript and the metadata are persisted alongside the
 * enable switches, so a reload can expand documents and offer completions
 * without recompiling first — compiling needs Monaco's TypeScript worker,
 * which is not up until the editor is. The source itself lives with the
 * document; `sourceHash` is what tells the sync hook a record is stale.
 *
 * IndexedDB, like the documents and themes: compiled code for a plugin that
 * inlines an asset runs past what localStorage tolerates, and a store that
 * stops persisting on a quota error would do so silently.
 */

export interface BrowserPluginsState {
  records: Record<string, BrowserPluginRecord>;
}

export interface BrowserPluginsActions {
  /** Create or update a record; missing fields keep their previous value. */
  upsert: (
    docName: string,
    patch: Partial<Omit<BrowserPluginRecord, 'docName' | 'createdAt'>>
  ) => void;
  setEnabled: (docName: string, enabled: boolean) => void;
  setAllowNetwork: (docName: string, allowNetwork: boolean) => void;
  rename: (oldName: string, newName: string) => void;
  remove: (docName: string) => void;
}

export type BrowserPluginsStore = BrowserPluginsState & BrowserPluginsActions;

export function createBrowserPluginRecord(
  docName: string,
  patch: Partial<Omit<BrowserPluginRecord, 'docName'>> = {}
): BrowserPluginRecord {
  const now = Date.now();
  return {
    docName,
    enabled: true,
    allowNetwork: false,
    status: 'idle',
    sourceHash: '',
    diagnostics: [],
    createdAt: now,
    updatedAt: now,
    ...patch,
  };
}

export const useBrowserPluginsStore = create<BrowserPluginsStore>()(
  persist(
    (set) => ({
      records: {},

      upsert: (docName, patch) =>
        set((state) => {
          const existing =
            state.records[docName] ?? createBrowserPluginRecord(docName);
          return {
            records: {
              ...state.records,
              [docName]: { ...existing, ...patch, updatedAt: Date.now() },
            },
          };
        }),

      // A plugin file is on screen before the sync hook has compiled it, so
      // these two create the record they are missing rather than dropping the
      // switch: the setting the author just made has to survive the compile.
      setEnabled: (docName, enabled) =>
        set((state) => {
          const existing =
            state.records[docName] ?? createBrowserPluginRecord(docName);
          if (state.records[docName] && existing.enabled === enabled)
            return state;
          return {
            records: {
              ...state.records,
              [docName]: { ...existing, enabled, updatedAt: Date.now() },
            },
          };
        }),

      setAllowNetwork: (docName, allowNetwork) =>
        set((state) => {
          const existing =
            state.records[docName] ?? createBrowserPluginRecord(docName);
          if (state.records[docName] && existing.allowNetwork === allowNetwork)
            return state;
          return {
            records: {
              ...state.records,
              [docName]: { ...existing, allowNetwork, updatedAt: Date.now() },
            },
          };
        }),

      rename: (oldName, newName) =>
        set((state) => {
          const existing = state.records[oldName];
          if (!existing || oldName === newName) return state;
          const records = { ...state.records };
          delete records[oldName];
          records[newName] = { ...existing, docName: newName };
          return { records };
        }),

      remove: (docName) =>
        set((state) => {
          if (!state.records[docName]) return state;
          const records = { ...state.records };
          delete records[docName];
          return { records };
        }),
    }),
    {
      name: 'jto-browser-plugins',
      version: 2,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({ records: state.records }),
      // v1 lived in localStorage and had no createdAt; a record from then
      // has nothing to migrate except that field.
      migrate: (persisted) => {
        const state = persisted as {
          records?: Record<string, BrowserPluginRecord>;
        };
        const records: Record<string, BrowserPluginRecord> = {};
        for (const [name, record] of Object.entries(state?.records ?? {})) {
          records[name] = {
            ...record,
            createdAt: record.createdAt ?? record.updatedAt ?? Date.now(),
          };
        }
        return { records };
      },
    }
  )
);

/**
 * Resolves once the persisted records are in memory. The IndexedDB read is
 * asynchronous, and a sync that ran before it would compile every plugin
 * from scratch and then be overwritten by what the store had all along.
 */
export function whenBrowserPluginsHydrated(): Promise<void> {
  const api = useBrowserPluginsStore.persist;
  if (api.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const stop = api.onFinishHydration(() => {
      stop();
      resolve();
    });
  });
}

/** A plugin that takes part in schema generation and expansion. */
export interface ActiveBrowserPlugin {
  docName: string;
  metadata: BrowserPluginMetadata;
}

export function selectActivePlugins(
  state: BrowserPluginsState
): ActiveBrowserPlugin[] {
  const active: ActiveBrowserPlugin[] = [];
  for (const record of Object.values(state.records)) {
    if (record.enabled && record.status === 'ready' && record.metadata) {
      active.push({ docName: record.docName, metadata: record.metadata });
    }
  }
  return active.sort((a, b) => a.docName.localeCompare(b.docName));
}

/**
 * A string that changes exactly when the set of active plugins, or any of
 * their schemas, changes — what schema refreshes key on.
 */
export function activePluginsSignature(state: BrowserPluginsState): string {
  const components = browserComponentsForSchema(state);
  // Empty stays empty, so a page with no active plugin keys on '' rather than
  // on the hash of an empty array.
  if (components.length === 0) return '';
  // The whole payload the schema route receives, not the props alone:
  // `hasChildren` and `description` reach the composed schema too.
  return hashSource(JSON.stringify(components));
}

/**
 * Which file owns a component name when several claim it: the one created
 * first. Deterministic across reloads, and a rename of the newcomer resolves
 * it on its next compile.
 */
export function componentNameOwner(
  records: Record<string, BrowserPluginRecord>,
  componentName: string
): string | undefined {
  let owner: BrowserPluginRecord | undefined;
  for (const record of Object.values(records)) {
    if (record.metadata?.name !== componentName) continue;
    if (!owner || record.createdAt < owner.createdAt) owner = record;
  }
  return owner?.docName;
}

/** The shape `POST /api/discovery/schemas/document` accepts for a browser plugin. */
export interface BrowserComponentSchemaInfo {
  name: string;
  versions: Array<{
    version: string;
    propsSchema: Record<string, unknown>;
    hasChildren?: boolean;
    description?: string;
  }>;
}

export function browserComponentsForSchema(
  state: BrowserPluginsState
): BrowserComponentSchemaInfo[] {
  return selectActivePlugins(state).map((plugin) => ({
    name: plugin.metadata.name,
    versions: plugin.metadata.versions.map((v) => ({
      version: v.version,
      propsSchema: v.propsSchema,
      ...(v.hasChildren ? { hasChildren: true } : {}),
      ...(v.description ? { description: v.description } : {}),
    })),
  }));
}

/** Diagnostics a record carries, for the sidebar and the editor strip. */
export function recordErrors(
  record: BrowserPluginRecord | undefined
): PluginDiagnostic[] {
  return (record?.diagnostics ?? []).filter((d) => d.severity === 'error');
}
