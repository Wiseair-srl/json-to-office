/**
 * Unified Presentation Schema Generator
 *
 * Generates JSON schemas that include both standard and custom plugin components.
 * Used at build-time for static schema files and at runtime for plugin-aware validation.
 */
import { Type, TSchema } from '@sinclair/typebox';
import { latestVersion } from '@json-to-office/shared';
import { createAllPptxComponentSchemasNarrowed } from './component-registry';

export interface VersionedPropsEntry {
  version: string;
  propsSchema: TSchema;
  hasChildren?: boolean;
  description?: string;
}

export interface CustomComponentInfo {
  name: string;
  versions: VersionedPropsEntry[];
}

export interface GenerateSchemaOptions {
  customComponents?: CustomComponentInfo[];
  includeMetadata?: boolean;
}

function createPluginVersionSchema(
  custom: CustomComponentInfo,
  entry: VersionedPropsEntry,
  recursiveRef: TSchema,
  isLatest: boolean
): TSchema {
  const fields: Record<string, TSchema> = {
    name: Type.Literal(custom.name),
    id: Type.Optional(Type.String()),
    enabled: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          'When false, this component is filtered out and not rendered. Defaults to true.',
      })
    ),
    // Omitting version selects the latest release at runtime. Explicit older
    // versions remain discriminated so their own props schema is enforced.
    version: isLatest
      ? Type.Optional(Type.Literal(entry.version))
      : Type.Literal(entry.version),
    props: entry.propsSchema,
  };

  if (entry.hasChildren) {
    fields.children = Type.Optional(Type.Array(recursiveRef));
  }

  return Type.Object(fields, {
    additionalProperties: false,
    description: entry.description ?? custom.name,
  });
}

/**
 * Generate a unified presentation schema that includes standard + custom components.
 * Uses Type.Recursive so container components (presentation, slide) can have children.
 */
export function generateUnifiedDocumentSchema(
  options: GenerateSchemaOptions = {}
): TSchema {
  const { customComponents = [] } = options;

  return Type.Recursive((Self) => {
    // ── Phase 1: Build plugin schemas (plugins get Self for arbitrary nesting) ──
    const pluginSchemas: TSchema[] = [];

    for (const custom of customComponents) {
      if (custom.versions.length > 0) {
        const latest = latestVersion(
          custom.versions.map((entry) => entry.version)
        );
        const versions = custom.versions.map((entry) =>
          createPluginVersionSchema(
            custom,
            entry,
            Self,
            entry.version === latest
          )
        );
        pluginSchemas.push(
          versions.length === 1 ? versions[0] : Type.Union(versions)
        );
      }
    }

    // ── Phase 2: Build standard components with narrowed children ──
    const standardSchemas = createAllPptxComponentSchemasNarrowed(
      Self,
      pluginSchemas
    );

    const componentSchemas = [...standardSchemas, ...pluginSchemas];

    if (componentSchemas.length === 0) {
      return Type.Object({});
    }

    return Type.Union(componentSchemas);
  });
}
