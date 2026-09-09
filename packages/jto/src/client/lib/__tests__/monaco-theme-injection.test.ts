import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Custom theme names are offered for `props.theme` by injecting them into the
 * schema's `examples` before it is installed.
 *
 * The docx schema declares `theme` as a bare string, but the pptx one declares
 * it as `string | inline theme config` — a TypeBox union, which compiles to a
 * node carrying `anyOf` and no `type` of its own. The injector checked `type`
 * before anything else, so on pptx it reached the property and returned
 * immediately: the playground served six custom themes from
 * `public/templates/themes/` and the editor offered none of them.
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
vi.mock('../block-references', () => ({ loadBlockReferences: async () => [] }));
vi.mock('../monaco-theme', () => ({ registerMonacoThemes: vi.fn() }));

import { updateMonacoWithPlugins } from '../monaco-config';
import type { Monaco } from '@monaco-editor/react';

const monaco = fakeMonaco as unknown as Monaco;

/** A `theme` property shaped the way the pptx schema declares it. */
function unionThemeProp() {
  return {
    description: 'Theme to apply: a name, or an inline theme config object',
    anyOf: [
      { type: 'string', examples: ['consulting', 'default'] },
      { type: 'object', properties: { colors: { type: 'object' } } },
    ],
  };
}

/** A `theme` property shaped the way the docx schema declares it. */
function stringThemeProp() {
  return { type: 'string', examples: ['minimal'] };
}

function propsHolder(themeProp: unknown) {
  return {
    type: 'object',
    properties: {
      props: { type: 'object', properties: { theme: themeProp } },
    },
  };
}

/**
 * The pptx root dispatches on `renderer` to one referenced definition per
 * profile, each of which is itself a union carrying the root component — the
 * two-level walk the injector has to make.
 */
function pptxShapedSchema() {
  return {
    type: 'object',
    definitions: {
      PptxComponentDefinition_pptxgenjs: {
        allOf: [
          {
            if: { properties: { name: { const: 'pptx' } } },
            then: propsHolder(unionThemeProp()),
          },
        ],
      },
    },
    allOf: [
      {
        if: { properties: { renderer: { const: 'pptxgenjs' } } },
        then: { $ref: '#/definitions/PptxComponentDefinition_pptxgenjs' },
      },
    ],
  };
}

/** Theme `examples` from every string branch the installed schema carries. */
function installedThemeExamples(): string[] {
  const options = fakeMonaco.languages.json.jsonDefaults.diagnosticsOptions;
  const schemas = (options.schemas ?? []) as Array<{
    uri: string;
    schema: unknown;
  }>;
  const report = schemas.find((s) => s.uri.includes('report'));
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const obj = node as Record<string, unknown>;
    const theme = (obj.properties as Record<string, unknown> | undefined)
      ?.theme;
    if (theme) {
      const branches = (theme as Record<string, unknown>).anyOf ?? [theme];
      for (const branch of branches as Array<Record<string, unknown>>) {
        if (branch?.type === 'string' && Array.isArray(branch.examples)) {
          found.push(...(branch.examples as string[]));
        }
      }
    }
    Object.values(obj).forEach(walk);
  };
  walk(report?.schema);
  return [...new Set(found)];
}

describe('custom theme name injection', () => {
  beforeEach(() => {
    setDiagnosticsOptions.mockClear();
    fetchDocumentSchema.mockReset();
    fakeMonaco.languages.json.jsonDefaults.diagnosticsOptions = {};
  });

  it('reaches the string branch of a union-typed theme property (pptx)', async () => {
    fetchDocumentSchema.mockResolvedValue(pptxShapedSchema());

    await updateMonacoWithPlugins(monaco, [], ['lumina', 'wiseair']);

    const examples = installedThemeExamples();
    expect(examples).toContain('lumina');
    expect(examples).toContain('wiseair');
    // The built-ins the schema shipped with are kept, not replaced.
    expect(examples).toContain('consulting');
  });

  it('leaves the inline theme config branch alone', async () => {
    fetchDocumentSchema.mockResolvedValue(pptxShapedSchema());

    await updateMonacoWithPlugins(monaco, [], ['lumina']);

    const options = fakeMonaco.languages.json.jsonDefaults.diagnosticsOptions;
    const schemas = (options.schemas ?? []) as Array<{
      uri: string;
      schema: Record<string, any>;
    }>;
    const report = schemas.find((s) => s.uri.includes('report'));
    const theme =
      report?.schema.definitions.PptxComponentDefinition_pptxgenjs.allOf[0].then
        .properties.props.properties.theme;
    expect(theme.anyOf[1]).not.toHaveProperty('examples');
  });

  it('still injects into a bare string theme property (docx)', async () => {
    fetchDocumentSchema.mockResolvedValue(propsHolder(stringThemeProp()));

    await updateMonacoWithPlugins(monaco, [], ['corporate']);

    expect(installedThemeExamples()).toEqual(['minimal', 'corporate']);
  });
});
