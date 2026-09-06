/**
 * Unified Presentation Schema Generator
 *
 * Generates JSON schemas that include both standard and custom plugin components.
 * Used at build-time for static schema files and at runtime for plugin-aware validation.
 */
import { Type, TSchema } from '@sinclair/typebox';
import { latestVersion } from '@json-to-office/shared';
import { createAllPptxComponentSchemasNarrowed } from './component-registry';
import {
  DEFAULT_PPTX_RENDERER_ID,
  PPTX_RENDERER_IDS,
  pptxComponentDefinitionName,
  type PptxRendererId,
} from './renderer';

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

  const branches = PPTX_RENDERER_IDS.map((renderer) =>
    generateRendererSchema(
      customComponents,
      renderer,
      renderer !== DEFAULT_PPTX_RENDERER_ID
    )
  );

  return Type.Union(branches, {
    description:
      'Presentation definition, discriminated by the optional renderer field. Omitted renderer means pptxgenjs.',
  });
}

function generateRendererSchema(
  customComponents: CustomComponentInfo[],
  renderer: PptxRendererId,
  requireDiscriminator: boolean
): TSchema {
  return Type.Recursive(
    (Self) => {
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
          // One branch per version, flat in the component union (as the DOCX
          // generator does): a nested union has no `name` const of its own,
          // so the export could not restructure the union into the if/then
          // dispatch editors need, and a group's children fell back to an
          // untyped name for the plugin.
          pluginSchemas.push(...versions);
        }
      }

      // ── Phase 2: Build standard components with narrowed children ──
      const standardSchemas = createAllPptxComponentSchemasNarrowed(
        Self,
        pluginSchemas,
        { renderer, requireDiscriminator }
      );

      const componentSchemas = [...standardSchemas, ...pluginSchemas];

      if (componentSchemas.length === 0) {
        return Type.Object({});
      }

      return Type.Union(componentSchemas);
    },
    // Named per renderer so the export keys `definitions` by a stable name.
    { $id: pptxComponentDefinitionName(renderer) }
  );
}
