import { type TSchema, type Static } from '@sinclair/typebox';
import { isValidSemver } from '../utils/semver';
import type { AddWarningFunction } from '../types/warnings';

/**
 * Render function context - parameters passed to render.
 * TTheme defaults to unknown so format-specific packages can narrow it.
 */
export interface RenderContext<T, TTheme = unknown> {
  /** The validated props for this component */
  props: T;
  /** The resolved theme configuration */
  theme: TTheme;
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
  TComponentDefinition = unknown,
  TTheme = unknown,
> = (context: RenderContext<TProps, TTheme>) => Promise<TComponentDefinition[]>;

/**
 * A single version entry within a versioned component.
 * Each version is self-contained with its own schema, render, and metadata.
 */
export interface ComponentVersion<
  TComponentDefinition = unknown,
  TPropsSchema extends TSchema = TSchema,
  TTheme = unknown,
> {
  /** TypeBox schema for props validation */
  propsSchema: TPropsSchema;
  /** Async render function to transform props into standard components */
  render: RenderFunction<Static<TPropsSchema>, TComponentDefinition, TTheme>;
  /** Whether this version supports nested children */
  hasChildren?: boolean;
  /** Optional description for this version */
  description?: string;
}

/**
 * Map of semver version strings to their version definitions.
 */
export type ComponentVersionMap<
  TComponentDefinition = unknown,
  TTheme = unknown,
> = Record<string, ComponentVersion<TComponentDefinition, any, TTheme>>;

/**
 * Custom component definition with multiple semver-keyed versions.
 */
export interface CustomComponent<
  TComponentDefinition = unknown,
  TVersions extends ComponentVersionMap<
    TComponentDefinition,
    any
  > = ComponentVersionMap<TComponentDefinition, any>,
  TName extends string = string,
> {
  /** Unique name for the component type */
  name: TName;
  /** Map of semver version strings to version definitions */
  versions: TVersions;
}

/**
 * Create a single version entry with full type inference for props.
 */
export function createVersion<
  TPropsSchema extends TSchema,
  TComponentDefinition = unknown,
  TTheme = unknown,
>(
  version: ComponentVersion<TComponentDefinition, TPropsSchema, TTheme>
): ComponentVersion<TComponentDefinition, TPropsSchema, TTheme> {
  return version;
}

/**
 * Create a custom component with multiple semver-keyed versions.
 */
export function createComponent<
  TComponentDefinition = unknown,
  TVersions extends ComponentVersionMap<
    TComponentDefinition,
    any
  > = ComponentVersionMap<TComponentDefinition, any>,
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
