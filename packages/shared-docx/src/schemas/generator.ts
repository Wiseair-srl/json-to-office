/**
 * Unified Document Schema Generator - SHARED UTILITY
 *
 * This is the SHARED implementation for generating document schemas.
 * It's used by MULTIPLE CONSUMERS with different requirements:
 *
 * 1. BUILD-TIME: generate-schemas.mjs uses this to create static .schema.json files
 *    - Only standard components (no custom components available at build time)
 *    - Outputs to filesystem for IDE autocomplete
 *
 * 2. RUNTIME PLUGIN: plugin/schema.ts uses this for plugin-enhanced schemas
 *    - Includes custom components registered at runtime
 *    - Cannot be generated at build time (components must be instantiated)
 *
 * 3. WEB APP: Monaco editor may use this for in-browser validation
 *    - Optimized for browser environment
 *    - No filesystem access
 *
 * This separation is ARCHITECTURAL, not accidental:
 * - Build-time vs runtime constraints are incompatible
 * - Custom components require runtime instantiation
 * - Different consumers need different output formats
 *
 * IMPORTANT: Standard components are defined in component-registry.ts (SINGLE SOURCE OF TRUTH).
 * This generator consumes that registry to ensure consistency across all schema generation.
 */

import { Type, TSchema } from '@sinclair/typebox';
import {
  STANDARD_COMPONENTS_REGISTRY,
  createComponentSchemaObject,
  getStandardComponent,
} from './component-registry';
import { latestVersion } from '@json-to-office/shared';

/**
 * Per-version props schema entry
 */
export interface VersionedPropsEntry {
  version: string;
  propsSchema: TSchema;
  hasChildren?: boolean;
  description?: string;
}

/**
 * Custom component interface for plugins
 */
export interface CustomComponentInfo {
  name: string;
  propsSchema: TSchema;
  /** When true, the component includes an optional `children` array */
  hasChildren?: boolean;
  /** Human-readable description shown in autocomplete */
  description?: string;
  /**
   * Per-version props schemas for version-discriminated validation.
   * When provided, separate schema variants are generated per version,
   * each pairing its version literal with its specific props schema.
   * A "no version" fallback variant uses the latest version's props.
   */
  versionedProps?: VersionedPropsEntry[];
}

/**
 * Options for generating document schema
 */
export interface GenerateDocumentSchemaOptions {
  includeStandardComponents?: boolean;
  includeTheme?: boolean;
  customComponents?: CustomComponentInfo[];
  title?: string;
  description?: string;
}

/**
 * Generate a complete document schema with all components
 *
 * This is the SHARED IMPLEMENTATION used by:
 * - Build-time schema generation (standard components only)
 * - Runtime plugin schema generation (with custom components)
 * - Web app schema generation (optimized for browser)
 *
 * @param options Configuration for what to include in the schema
 * @returns TypeBox schema that can be converted to JSON Schema
 */
export function generateUnifiedDocumentSchema(
  options: GenerateDocumentSchemaOptions = {}
): TSchema {
  const {
    includeStandardComponents = true,
    customComponents = [],
    title = 'JSON Report Definition',
    description = 'JSON report definition with TypeBox schemas',
  } = options;

  // Create a recursive component definition schema
  const ComponentDefinition = Type.Recursive(
    (This) => {
      const componentSchemas: TSchema[] = [];

      // Add standard components from registry - SINGLE SOURCE OF TRUTH
      if (includeStandardComponents) {
        for (const component of STANDARD_COMPONENTS_REGISTRY) {
          componentSchemas.push(createComponentSchemaObject(component, This));
        }
      }

      // Add custom components
      for (const customComponent of customComponents) {
        if (
          customComponent.versionedProps &&
          customComponent.versionedProps.length > 0
        ) {
          // Version-discriminated: one variant per version + one "no version" fallback
          const versionEntries = customComponent.versionedProps;
          const latest = latestVersion(versionEntries.map((e) => e.version));

          // Per-version variants: version is required, props are version-specific
          for (const entry of versionEntries) {
            // Attach description directly to the version literal so Monaco
            // shows it in the autocomplete dropdown for version values
            const versionLiteralDesc =
              entry.description || customComponent.description;
            const schema: Record<string, TSchema> = {
              name: Type.Literal(customComponent.name),
              id: Type.Optional(Type.String()),
              version: versionLiteralDesc
                ? Type.Literal(entry.version, {
                  description: versionLiteralDesc,
                })
                : Type.Literal(entry.version),
              props: entry.propsSchema,
            };
            if (entry.hasChildren) {
              schema.children = Type.Optional(Type.Array(This));
            }
            // Build description: combine component-level + version-level descriptions
            const versionDesc = entry.description
              ? `${customComponent.name} v${entry.version} — ${entry.description}`
              : customComponent.description
                ? `${customComponent.name} v${entry.version} — ${customComponent.description}`
                : `${customComponent.name} v${entry.version}`;
            componentSchemas.push(
              Type.Object(schema, {
                additionalProperties: false,
                description: versionDesc,
              })
            );
          }

          // "No version" fallback: version is NOT allowed, uses latest props
          const latestEntry = versionEntries.find((e) => e.version === latest)!;
          const fallbackSchema: Record<string, TSchema> = {
            name: Type.Literal(customComponent.name),
            id: Type.Optional(Type.String()),
            props: latestEntry.propsSchema,
          };
          if (latestEntry.hasChildren) {
            fallbackSchema.children = Type.Optional(Type.Array(This));
          }
          const fallbackDesc = latestEntry.description
            ? `${customComponent.name} (latest: v${latest}) — ${latestEntry.description}`
            : customComponent.description
              ? `${customComponent.name} (latest: v${latest}) — ${customComponent.description}`
              : `${customComponent.name} (latest: v${latest})`;
          componentSchemas.push(
            Type.Object(fallbackSchema, {
              additionalProperties: false,
              description: fallbackDesc,
            })
          );
        } else {
          // Non-versioned component: single variant
          const hasChildren = !!customComponent.hasChildren;
          const schema: Record<string, TSchema> = {
            name: Type.Literal(customComponent.name),
            id: Type.Optional(Type.String()),
            props: customComponent.propsSchema,
          };
          if (hasChildren) {
            schema.children = Type.Optional(Type.Array(This));
          }
          componentSchemas.push(
            Type.Object(schema, {
              additionalProperties: false,
              ...(customComponent.description
                ? { description: customComponent.description }
                : {}),
            })
          );
        }
      }

      // Create the union based on the number of schemas
      if (componentSchemas.length === 0) {
        return Type.Any();
      } else if (componentSchemas.length === 1) {
        return componentSchemas[0];
      } else {
        // Create union with discriminator for proper JSON Schema generation
        const componentDescription =
          customComponents.length > 0
            ? 'Component definition with discriminated union including custom components'
            : 'Component definition with discriminated union';

        return Type.Union(componentSchemas, {
          discriminator: { propertyName: 'name' },
          description: componentDescription,
        });
      }
    },
    { $id: 'ComponentDefinition' }
  );

  // In the unified structure, a document IS a report component with an optional $schema field
  // Only support the new unified structure - no legacy support

  // Get report component props from registry
  const reportComponent = getStandardComponent('report');
  if (!reportComponent) {
    throw new Error('Report component not found in registry');
  }

  return Type.Object(
    {
      name: Type.Literal('report'),
      id: Type.Optional(Type.String()),
      $schema: Type.Optional(Type.String({ format: 'uri' })),
      props: reportComponent.propsSchema,
      children: Type.Optional(Type.Array(ComponentDefinition)),
    },
    {
      additionalProperties: false,
      title,
      description,
    }
  );
}
