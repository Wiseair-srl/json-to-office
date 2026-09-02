import { describe, expect, it, vi } from 'vitest';

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
  isPluginDocumentName,
} from '../documents-store';

describe('plugin documents', () => {
  it('a *.component.ts file is a plugin, whatever its text', () => {
    const store = createDocumentsStore(initDocumentsStore());
    store.getState().createDocument('kpi.component.ts', 'export const x = 1;');
    store
      .getState()
      .createDocument(
        'theme-like.component.ts',
        '{"colors":{},"fonts":{},"styles":{}}'
      );
    store.getState().createDocument('brand.docx.theme.json', '{}');
    const { documentTypes, documents } = store.getState();
    expect(documentTypes['kpi.component.ts']).toBe(
      'application/typescript+plugin'
    );
    expect(documentTypes['theme-like.component.ts']).toBe(
      'application/typescript+plugin'
    );
    expect(documentTypes['brand.docx.theme.json']).toBe(
      'application/json+theme'
    );
    expect(documents.find((d) => d.name === 'kpi.component.ts')?.type).toBe(
      'text/typescript'
    );
    expect(isPluginDocumentName('X.COMPONENT.TS')).toBe(true);
    expect(isPluginDocumentName('x.ts')).toBe(false);
  });

  it('rename keeps the plugin type', () => {
    const store = createDocumentsStore(initDocumentsStore());
    store.getState().createDocument('kpi.component.ts', '');
    store.getState().renameDocument('kpi.component.ts', 'tile.component.ts');
    expect(store.getState().documentTypes['tile.component.ts']).toBe(
      'application/typescript+plugin'
    );
  });
});
