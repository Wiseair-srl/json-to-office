import type { TSchema } from '@sinclair/typebox';
import type { ComponentDefinition } from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../styles';
import {
  createVersion as sharedCreateVersion,
  createComponent as sharedCreateComponent,
} from '@json-to-office/shared/plugin';
import type {
  RenderContext as SharedRenderContext,
  RenderFunction as SharedRenderFunction,
  ComponentVersion as SharedComponentVersion,
  ComponentVersionMap as SharedComponentVersionMap,
  CustomComponent as SharedCustomComponent,
} from '@json-to-office/shared/plugin';

// ---- DOCX-specific type aliases (backward compat) ----

/**
 * DOCX render context with ThemeConfig baked in
 */
export type RenderContext<T> = SharedRenderContext<T, ThemeConfig>;

export type RenderFunction<
  TProps,
  TComponentDefinition = ComponentDefinition,
> = SharedRenderFunction<TProps, TComponentDefinition, ThemeConfig>;

export type ComponentVersion<
  TComponentDefinition = ComponentDefinition,
  TPropsSchema extends TSchema = TSchema,
> = SharedComponentVersion<TComponentDefinition, TPropsSchema, ThemeConfig>;

export type ComponentVersionMap<TComponentDefinition = ComponentDefinition> =
  SharedComponentVersionMap<TComponentDefinition, ThemeConfig>;

export type CustomComponent<
  TComponentDefinition = ComponentDefinition,
  TVersions extends
    ComponentVersionMap<TComponentDefinition> = ComponentVersionMap<TComponentDefinition>,
  TName extends string = string,
> = SharedCustomComponent<TComponentDefinition, TVersions, TName>;

// ---- Re-export factory functions (thin wrappers for DOCX defaults) ----

export function createVersion<
  TPropsSchema extends TSchema,
  TComponentDefinition = ComponentDefinition,
>(
  version: ComponentVersion<TComponentDefinition, TPropsSchema>
): ComponentVersion<TComponentDefinition, TPropsSchema> {
  return sharedCreateVersion(version);
}

export function createComponent<
  TComponentDefinition = ComponentDefinition,
  TVersions extends
    ComponentVersionMap<TComponentDefinition> = ComponentVersionMap<TComponentDefinition>,
  TName extends string = string,
>(
  component: CustomComponent<TComponentDefinition, TVersions, TName>
): CustomComponent<TComponentDefinition, TVersions, TName> {
  return sharedCreateComponent(component);
}
