/**
 * Plugin-specific type definitions
 */

import type { TSchema, Static } from '@sinclair/typebox';
import type { ComponentDefinition } from '@json-to-office/shared-docx';
import type { AddWarningFunction } from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../styles';

/**
 * Render function context - parameters passed to render
 */
export interface PluginRenderContext<T> {
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
 * Returns a properly typed array of component definitions with full type inference.
 */
export type PluginRenderFunction<T> = (
  context: PluginRenderContext<T>
) => Promise<ComponentDefinition[]>;

/**
 * Plugin component definition with automatic props type inference from schema
 */
export interface PluginComponent<TPropsSchema extends TSchema = TSchema> {
  /** Unique name for the component type */
  name: string;
  /** TypeBox schema for props validation */
  propsSchema: TPropsSchema;
  /** Async render function to transform props into standard components */
  render: PluginRenderFunction<Static<TPropsSchema>>;
  /** Whether this component can contain nested `children` */
  hasChildren?: boolean;
  /** Optional description for documentation */
  description?: string;
  /** Optional version for compatibility tracking */
  version?: string;
}

/**
 * Plugin validation error details
 */
export interface PluginValidationError {
  /** Path to the error (e.g., "children[2].props.city") */
  path: string;
  /** Human-readable error message */
  message: string;
  /** Error code for programmatic handling */
  code: string;
  /** The actual value that failed validation */
  value?: unknown;
}

/**
 * Plugin validation result
 */
export interface PluginValidationResult<T = unknown> {
  /** Whether validation succeeded */
  success: boolean;
  /** Validated and typed data */
  data?: T;
  /** List of validation errors if failed */
  errors?: PluginValidationError[];
}
