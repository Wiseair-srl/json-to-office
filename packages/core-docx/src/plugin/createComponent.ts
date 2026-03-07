import { type TSchema, type Static } from '@sinclair/typebox';
import { isValidSemver } from '@json-to-docx/shared';
import type { ThemeConfig } from '../styles';
import type {
  ComponentDefinition,
  AddWarningFunction,
} from '@json-to-docx/shared';

/**
 * Render function context - parameters passed to render
 */
export interface RenderContext<T> {
  /** The validated props for this component */
  props: T;
  /** The resolved theme configuration */
  theme: ThemeConfig;
  /** Function to add warnings during processing */
  addWarning: AddWarningFunction;
  /** For container components: processed nested children */
  children?: unknown[];
}

/**
 * Render function that transforms custom component props into standard components.
 */
export type RenderFunction<
  TProps,
  TComponentDefinition = ComponentDefinition,
> = (context: RenderContext<TProps>) => Promise<TComponentDefinition[]>;

/**
 * A single version entry within a versioned component.
 * Each version is self-contained with its own schema, render, and metadata.
 */
export interface ComponentVersion<
  TComponentDefinition = ComponentDefinition,
  TPropsSchema extends TSchema = TSchema,
> {
  /** TypeBox schema for props validation */
  propsSchema: TPropsSchema;
  /** Async render function to transform props into standard components */
  render: RenderFunction<Static<TPropsSchema>, TComponentDefinition>;
  /** Whether this version supports nested children */
  hasChildren?: boolean;
  /** Optional description for this version */
  description?: string;
}

/**
 * Map of semver version strings to their version definitions.
 */
export type ComponentVersionMap<TComponentDefinition = ComponentDefinition> =
  Record<string, ComponentVersion<TComponentDefinition, any>>;

/**
 * Custom component definition with multiple semver-keyed versions.
 * Each version is self-contained with its own schema + render.
 *
 * @typeParam TComponentDefinition - The component definition type for render return
 * @typeParam TVersions - The versions map type
 * @typeParam TName - The literal string type for the component name
 */
export interface CustomComponent<
  TComponentDefinition = ComponentDefinition,
  TVersions extends
    ComponentVersionMap<TComponentDefinition> = ComponentVersionMap<TComponentDefinition>,
  TName extends string = string,
> {
  /** Unique name for the component type */
  name: TName;
  /** Map of semver version strings to version definitions */
  versions: TVersions;
}

/**
 * Create a single version entry with full type inference for props.
 *
 * Wrapping each version with `createVersion` lets TypeScript infer the
 * props type from `propsSchema` and propagate it to the `render` function,
 * so `props` is fully typed instead of `any`.
 *
 * @example
 * ```typescript
 * createVersion({
 *   propsSchema: Type.Object({ city: Type.String() }),
 *   render: async ({ props }) => {
 *     // props.city is inferred as string
 *     return [{ name: 'paragraph', props: { text: props.city } }];
 *   },
 * })
 * ```
 */
export function createVersion<
  TPropsSchema extends TSchema,
  TComponentDefinition = ComponentDefinition,
>(
  version: ComponentVersion<TComponentDefinition, TPropsSchema>
): ComponentVersion<TComponentDefinition, TPropsSchema> {
  return version;
}

/**
 * Create a custom component with multiple semver-keyed versions.
 *
 * Use {@link createVersion} for each version entry to get full type inference
 * for `props` in render functions.
 *
 * @example Basic single-version usage
 * ```typescript
 * const weatherComponent = createComponent({
 *   name: 'weather' as const,
 *   versions: {
 *     '1.0.0': createVersion({
 *       propsSchema: Type.Object({ city: Type.String() }),
 *       render: async ({ props }) => [{
 *         name: 'paragraph',
 *         props: { text: `Weather in ${props.city}` }
 *       }]
 *     })
 *   }
 * });
 * ```
 *
 * @example Multi-version with breaking changes
 * ```typescript
 * const weatherComponent = createComponent({
 *   name: 'weather' as const,
 *   versions: {
 *     '1.0.0': createVersion({
 *       propsSchema: WeatherV1PropsSchema,
 *       render: async ({ props }) => [...],
 *     }),
 *     '2.0.0': createVersion({
 *       propsSchema: WeatherV2PropsSchema,
 *       render: async ({ props }) => [...],
 *     }),
 *   },
 * });
 * ```
 */
export function createComponent<
  TComponentDefinition = ComponentDefinition,
  TVersions extends
    ComponentVersionMap<TComponentDefinition> = ComponentVersionMap<TComponentDefinition>,
  TName extends string = string,
>(
  component: CustomComponent<TComponentDefinition, TVersions, TName>
): CustomComponent<TComponentDefinition, TVersions, TName> {
  if (!component.name) {
    throw new Error('Component name is required');
  }

  if (!component.versions || typeof component.versions !== 'object') {
    throw new Error(`Component "${component.name}" requires a versions map`);
  }

  const versionKeys = Object.keys(component.versions);
  if (versionKeys.length === 0) {
    throw new Error(
      `Component "${component.name}" must have at least one version`
    );
  }

  for (const key of versionKeys) {
    if (!isValidSemver(key)) {
      throw new Error(
        `Component "${component.name}": invalid semver key "${key}". Expected format: major.minor.patch`
      );
    }
    const entry = component.versions[key];
    if (!entry.propsSchema) {
      throw new Error(
        `Component "${component.name}" version "${key}" requires a propsSchema`
      );
    }
    if (!entry.render || typeof entry.render !== 'function') {
      throw new Error(
        `Component "${component.name}" version "${key}" requires a render function`
      );
    }
  }

  return component;
}
