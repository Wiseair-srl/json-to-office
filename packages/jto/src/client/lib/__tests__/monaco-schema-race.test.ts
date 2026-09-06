import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A schema refresh is fired for every event that can change the component
 * set: each browser plugin that finishes compiling, each disk-plugin toggle,
 * the editor mounting. Several are routinely in flight at once and the
 * document schema is megabytes of JSON, so they do not answer in the order
 * they were sent. Whichever answer is installed last is the one Monaco
 * validates against, so an older one landing late used to leave the editor
 * flagging a component the page had already compiled as an unknown `name`.
 */

const setDiagnosticsOptions = vi.fn();
const fakeMonaco = {
  languages: {
    json: {
      jsonDefaults: {
        diagnosticsOptions: {} as Record<string, unknown>,
        setDiagnosticsOptions: (options: Record<string, unknown>) => {
          setDiagnosticsOptions(options);
          fakeMonaco.languages.json.jsonDefaults.diagnosticsOptions = options;
        },
      },
    },
    registerDocumentFormattingEditProvider: vi.fn(),
    registerCompletionItemProvider: vi.fn(() => ({ dispose: vi.fn() })),
  },
  editor: { getModels: () => [], setModelLanguage: vi.fn() },
};

const fetchDocumentSchema = vi.fn();

vi.mock('@monaco-editor/react', () => ({
  loader: { init: async () => fakeMonaco },
}));
vi.mock('../schema-service', () => ({
  schemaService: {
    fetchDocumentSchema: (...args: unknown[]) => fetchDocumentSchema(...args),
    clearPluginSchemaCache: vi.fn(),
  },
}));
vi.mock('../json-schema-generator', () => ({
  createReportSchemaConfig: () => ({
    uri: 'report',
    fileMatch: [],
    schema: {},
  }),
  createThemeSchemaConfig: () => ({ uri: 'theme', fileMatch: [], schema: {} }),
}));
vi.mock('../quality-policy-schema', () => ({
  createQualityPolicySchemaConfig: () => ({
    uri: 'quality',
    fileMatch: [],
    schema: {},
  }),
}));
vi.mock('../monaco-fonts-codelens', () => ({ registerFontCodeLens: vi.fn() }));
vi.mock('../block-references', () => ({
  loadBlockReferences: async () => [],
}));
vi.mock('../monaco-theme', () => ({ registerMonacoThemes: vi.fn() }));

import { updateMonacoWithPlugins } from '../monaco-config';
import type { Monaco } from '@monaco-editor/react';

const monaco = fakeMonaco as unknown as Monaco;

/** The component names carried by the schema Monaco is currently using. */
function installedComponents(): string[] {
  const options = fakeMonaco.languages.json.jsonDefaults.diagnosticsOptions;
  const schemas = (options.schemas ?? []) as Array<{
    uri: string;
    schema: { components?: string[] };
  }>;
  const report = schemas.find((s) => s.uri.includes('report'));
  return report?.schema.components ?? [];
}

/** A stand-in document schema that just names the components it was built for. */
function schemaFor(names: string[]) {
  return { type: 'object', components: names };
}

function component(name: string) {
  return {
    name,
    versions: [{ version: '1.0.0', propsSchema: { type: 'object' } }],
  };
}

describe('updateMonacoWithPlugins concurrency', () => {
  beforeEach(() => {
    setDiagnosticsOptions.mockClear();
    fetchDocumentSchema.mockReset();
    fakeMonaco.languages.json.jsonDefaults.diagnosticsOptions = {};
  });

  it('keeps the newest schema when an older request answers last', async () => {
    // Two plugins finish compiling in quick succession: the first refresh
    // knows about one component, the second about both. The first answer is
    // the slow one.
    const release: Array<() => void> = [];
    fetchDocumentSchema.mockImplementation(
      (_plugins: string[], browser: Array<{ name: string }>) =>
        new Promise((resolve) => {
          release.push(() => resolve(schemaFor(browser.map((c) => c.name))));
        })
    );

    const stale = updateMonacoWithPlugins(monaco, [], undefined, [
      component('callout'),
    ]);
    const fresh = updateMonacoWithPlugins(monaco, [], undefined, [
      component('callout'),
      component('prova'),
    ]);

    release[1]();
    await fresh;
    expect(installedComponents()).toEqual(['callout', 'prova']);

    release[0]();
    await stale;
    expect(installedComponents()).toEqual(['callout', 'prova']);
  });

  it('reports success for a superseded refresh', async () => {
    const release: Array<() => void> = [];
    fetchDocumentSchema.mockImplementation(
      (_plugins: string[], browser: Array<{ name: string }>) =>
        new Promise((resolve) => {
          release.push(() => resolve(schemaFor(browser.map((c) => c.name))));
        })
    );

    const stale = updateMonacoWithPlugins(monaco, [], undefined, [
      component('callout'),
    ]);
    const fresh = updateMonacoWithPlugins(monaco, [], undefined, [
      component('callout'),
      component('prova'),
    ]);

    release[1]();
    await fresh;
    release[0]();

    // A superseded refresh did not fail — the newer one owns the outcome, and
    // a `false` here surfaces to the user as "Schema validation failed".
    await expect(stale).resolves.toBe(true);
    await expect(fresh).resolves.toBe(true);
    // It installed nothing either: only the newer schema was ever applied.
    expect(setDiagnosticsOptions).toHaveBeenCalledTimes(1);
  });

  it('does not roll a newer schema back when an older request fails', async () => {
    const release: Array<(ok: boolean) => void> = [];
    fetchDocumentSchema.mockImplementation(
      (_plugins: string[], browser: Array<{ name: string }>) =>
        new Promise((resolve, reject) => {
          release.push((ok) =>
            ok
              ? resolve(schemaFor(browser.map((c) => c.name)))
              : reject(new Error('offline'))
          );
        })
    );

    const stale = updateMonacoWithPlugins(monaco, [], undefined, [
      component('callout'),
    ]);
    const fresh = updateMonacoWithPlugins(monaco, [], undefined, [
      component('callout'),
      component('prova'),
    ]);

    release[1](true);
    await fresh;
    release[0](false);
    await expect(stale).rejects.toThrow('offline');

    expect(installedComponents()).toEqual(['callout', 'prova']);
  });
});
