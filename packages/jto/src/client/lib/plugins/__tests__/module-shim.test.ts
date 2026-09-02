import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import * as typebox from '@sinclair/typebox';
import * as sharedPlugin from '@json-to-office/shared/plugin';
import {
  describeComponent,
  evaluateCommonJs,
  extractComponent,
  isValidComponent,
} from '../module-shim';
import { componentNameFromFileName, pluginStarterSource } from '../templates';
import { extractPluginExamples } from '../examples';
import { PLUGIN_API_MODULE_IDS } from '../type-shims';

/**
 * The same modules the sandbox worker hands to `require`, minus the schema
 * packages the starters do not touch at run time (their imports are
 * type-only and erased by the compiler).
 */
const pluginApi = {
  createComponent: sharedPlugin.createComponent,
  createVersion: sharedPlugin.createVersion,
};
const MODULES: Record<string, unknown> = {
  '@sinclair/typebox': typebox,
  '@json-to-office/shared/plugin': sharedPlugin,
  ...Object.fromEntries(PLUGIN_API_MODULE_IDS.map((id) => [id, pluginApi])),
};

/** What Monaco's worker emits for a plugin, produced with the same options. */
function compile(source: string): string {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  return result.outputText;
}

describe('evaluateCommonJs', () => {
  it('runs compiled TypeScript against the module map', () => {
    const exports = evaluateCommonJs(
      compile(
        `import { Type } from '@sinclair/typebox'; export const s = Type.String();`
      ),
      MODULES
    );
    expect((exports.s as { type: string }).type).toBe('string');
  });

  it('names a module outside the allowlist', () => {
    expect(() =>
      evaluateCommonJs(
        compile(`import fs from 'node:fs'; export const x = fs;`),
        MODULES
      )
    ).toThrow(/Module "node:fs" is not available in the playground sandbox/);
  });
});

describe('extractComponent', () => {
  const version = {
    propsSchema: typebox.Type.Object({}),
    render: async () => [],
  };
  const component = { name: 'kpi', versions: { '1.0.0': version } };

  it('prefers the default export, then *Component exports, then anything valid', () => {
    expect(extractComponent({ default: component })).toBe(component);
    expect(
      extractComponent({
        helper: 1,
        kpiComponent: component,
        other: { name: 'x' },
      })
    ).toBe(component);
    expect(extractComponent({ anything: component })).toBe(component);
    expect(
      extractComponent({ nothing: { name: 'x', versions: {} } })
    ).toBeNull();
    expect(isValidComponent({ name: '', versions: { '1.0.0': version } })).toBe(
      false
    );
  });
});

describe('describeComponent', () => {
  it('serialises every version, picks the latest, and keeps examples', () => {
    const component = {
      name: 'kpi',
      versions: {
        '1.0.0': {
          propsSchema: typebox.Type.Object({ a: typebox.Type.String() }),
          render: async () => [],
        },
        '2.0.0': {
          propsSchema: typebox.Type.Object({ b: typebox.Type.Number() }),
          render: async () => [],
          hasChildren: true,
          description: 'v2',
        },
      },
    };
    const metadata = describeComponent(component, 'docx', [
      { props: { b: 1 } },
    ]);
    expect(metadata.latest).toBe('2.0.0');
    expect(metadata.versions.map((v) => v.version)).toEqual(['1.0.0', '2.0.0']);
    expect(metadata.versions[1]).toMatchObject({
      hasChildren: true,
      description: 'v2',
      propsSchema: { type: 'object', properties: { b: { type: 'number' } } },
    });
    // Plain JSON: no TypeBox symbols survive, so it can cross postMessage.
    expect(
      Object.getOwnPropertySymbols(metadata.versions[0].propsSchema)
    ).toEqual([]);
    expect(metadata.examples).toEqual([{ props: { b: 1 } }]);
  });

  it('rejects a bad semver key and a version without render', () => {
    expect(() =>
      describeComponent(
        {
          name: 'x',
          versions: { latest: { propsSchema: {}, render: async () => [] } },
        },
        'docx',
        []
      )
    ).toThrow(/invalid semver key "latest"/);
    expect(() =>
      describeComponent(
        { name: 'x', versions: { '1.0.0': { propsSchema: {} } as never } },
        'docx',
        []
      )
    ).toThrow(/requires a render function/);
  });
});

describe('starter templates', () => {
  it.each(['docx', 'pptx'] as const)(
    '%s starter compiles, loads, validates its example and renders theme-aware output',
    async (format) => {
      const source = pluginStarterSource(
        format,
        componentNameFromFileName('my-block.component.ts')
      );
      const exports = evaluateCommonJs(compile(source), MODULES);
      const component = extractComponent(exports);
      expect(component).not.toBeNull();
      const examples = extractPluginExamples(source);
      expect(examples).toHaveLength(1);

      const metadata = describeComponent(component!, format, examples);
      expect(metadata.name).toBe('my-block');
      expect(metadata.latest).toBe('1.0.0');

      const entry = sharedPlugin.resolveComponentVersion(
        component!.name,
        component!.versions as never
      );
      const validation = sharedPlugin.validateCustomComponentProps(
        entry.propsSchema,
        examples[0].props
      );
      expect(validation.valid).toBe(true);

      const warnings: string[] = [];
      const theme =
        format === 'docx'
          ? {
              colors: {
                primary: '#111111',
                secondary: '#222222',
                accent: '#333333',
                text: '#000000',
              },
            }
          : {
              colors: { primary: '#111111', text: '#000000', text2: '#444444' },
            };
      const output = (await entry.render({
        props: validation.data,
        theme,
        addWarning: (message: string) => warnings.push(message),
        children: undefined,
      })) as Array<{ name: string; props: Record<string, unknown> }>;
      expect(output.length).toBeGreaterThan(0);
      expect(warnings).toEqual([]);
      const serialised = JSON.stringify(output);
      // The starters read the theme, which is the point of the starter.
      expect(serialised).toContain(format === 'docx' ? '#333333' : '#111111');
    }
  );

  it('derives a safe component name from the file name', () => {
    expect(componentNameFromFileName('KPI Tile.component.ts')).toBe('kpi-tile');
    expect(componentNameFromFileName('2fast.component.ts')).toBe('x-2fast');
    expect(componentNameFromFileName('.component.ts')).toBe('custom-block');
  });
});
