/**
 * Type declarations for the import paths a plugin file uses for the plugin
 * API, mirroring what the published packages export.
 *
 * The runtime behind every one of these is the shared `createComponent` /
 * `createVersion` (see sandbox.worker.ts); what differs per format is the
 * component and theme types `render` sees. Declaring only the plugin API here
 * also makes the shim the allowlist: a plugin that reaches for
 * `generateBufferFromJson` gets a type error in the editor, which is the same
 * answer the sandbox would give at run time.
 */

function pluginApiDeclaration(
  sharedPackage: string,
  componentType: string,
  themeType: string
): string {
  return `import type { TSchema } from '@sinclair/typebox';
import type { ${componentType}, ${themeType} } from '${sharedPackage}';
import type {
  RenderContext as SharedRenderContext,
  RenderFunction as SharedRenderFunction,
  ComponentVersion as SharedComponentVersion,
  ComponentVersionMap as SharedComponentVersionMap,
  CustomComponent as SharedCustomComponent,
} from '@json-to-office/shared/plugin';

/** The resolved theme handed to \`render\`. */
export type ThemeConfig = ${themeType};

export type RenderContext<T> = SharedRenderContext<T, ${themeType}>;

export type RenderFunction<
  TProps,
  TComponentDefinition = ${componentType},
> = SharedRenderFunction<TProps, TComponentDefinition, ${themeType}>;

export type ComponentVersion<
  TComponentDefinition = ${componentType},
  TPropsSchema extends TSchema = TSchema,
> = SharedComponentVersion<TComponentDefinition, TPropsSchema, ${themeType}>;

export type ComponentVersionMap<TComponentDefinition = ${componentType}> =
  SharedComponentVersionMap<TComponentDefinition, ${themeType}>;

export type CustomComponent<
  TComponentDefinition = ${componentType},
  TVersions extends
    ComponentVersionMap<TComponentDefinition> = ComponentVersionMap<TComponentDefinition>,
  TName extends string = string,
> = SharedCustomComponent<TComponentDefinition, TVersions, TName>;

/** Create one semver version entry with full type inference for its props. */
export declare function createVersion<
  TPropsSchema extends TSchema,
  TComponentDefinition = ${componentType},
>(
  version: ComponentVersion<TComponentDefinition, TPropsSchema>
): ComponentVersion<TComponentDefinition, TPropsSchema>;

/** Create a custom component with semver-keyed versions. */
export declare function createComponent<
  TComponentDefinition = ${componentType},
  TVersions extends
    ComponentVersionMap<TComponentDefinition> = ComponentVersionMap<TComponentDefinition>,
  TName extends string = string,
>(
  component: CustomComponent<TComponentDefinition, TVersions, TName>
): CustomComponent<TComponentDefinition, TVersions, TName>;

export {
  resolveComponentVersion,
  ComponentValidationError,
  DuplicateComponentError,
} from '@json-to-office/shared/plugin';
export type { ${componentType}, ${themeType} } from '${sharedPackage}';
`;
}

const DOCX_API = pluginApiDeclaration(
  '@json-to-office/shared-docx',
  'ComponentDefinition',
  'ThemeConfigJson'
);
const PPTX_API = pluginApiDeclaration(
  '@json-to-office/shared-pptx',
  'PptxComponentDefinition',
  'ThemeConfigJson'
);

function manifest(name: string, withPluginSubpath: boolean): string {
  return JSON.stringify(
    {
      name,
      version: '0.0.0-playground',
      types: 'index.d.ts',
      exports: {
        '.': { types: './index.d.ts' },
        ...(withPluginSubpath
          ? { './plugin': { types: './plugin/index.d.ts' } }
          : {}),
      },
    },
    null,
    2
  );
}

/**
 * Virtual files keyed like the generated type libs
 * (`node_modules/<pkg>/<file>`).
 */
export const PLUGIN_TYPE_SHIMS: Readonly<Record<string, string>> = {
  'node_modules/@json-to-office/core-docx/package.json': manifest(
    '@json-to-office/core-docx',
    true
  ),
  'node_modules/@json-to-office/core-docx/index.d.ts': DOCX_API,
  'node_modules/@json-to-office/core-docx/plugin/index.d.ts': DOCX_API,
  'node_modules/@json-to-office/json-to-docx/package.json': manifest(
    '@json-to-office/json-to-docx',
    false
  ),
  'node_modules/@json-to-office/json-to-docx/index.d.ts': DOCX_API,
  'node_modules/@json-to-office/core-pptx/package.json': manifest(
    '@json-to-office/core-pptx',
    true
  ),
  'node_modules/@json-to-office/core-pptx/index.d.ts': PPTX_API,
  'node_modules/@json-to-office/core-pptx/plugin/index.d.ts': PPTX_API,
  'node_modules/@json-to-office/json-to-pptx/package.json': manifest(
    '@json-to-office/json-to-pptx',
    false
  ),
  'node_modules/@json-to-office/json-to-pptx/index.d.ts': PPTX_API,
};

/**
 * Module ids the sandbox resolves to the shared plugin API. Kept next to the
 * declarations above so the editor and the runtime agree on what exists.
 */
export const PLUGIN_API_MODULE_IDS: readonly string[] = [
  '@json-to-office/core-docx',
  '@json-to-office/core-docx/plugin',
  '@json-to-office/json-to-docx',
  '@json-to-office/core-pptx',
  '@json-to-office/core-pptx/plugin',
  '@json-to-office/json-to-pptx',
];
