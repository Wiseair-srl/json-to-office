/**
 * PPTX Component Registry - SINGLE SOURCE OF TRUTH
 *
 * This is the ONLY place where standard PPTX components are defined.
 * All schema generators MUST use this registry.
 */

import { Type, TSchema } from '@sinclair/typebox';
import { PPTX_SLIDE_CONTENT_COMPONENTS } from '@json-to-office/shared/schemas/slide-content';
import {
  PPTX_RENDERER_IDS,
  isPptxComponentSupported,
  pptxPropsSchemaForRenderer,
  type PptxRendererId,
} from './renderer';

/**
 * Component definition with metadata
 */
export interface PptxStandardComponentDefinition {
  name: string;
  propsSchema: TSchema;
  hasChildren: boolean;
  /**
   * Names of standard components allowed as direct children.
   * Only meaningful when hasChildren is true.
   * Plugin components are always allowed in addition to these.
   * Omit to allow the full recursive union (backward-compat).
   */
  allowedChildren?: readonly string[];
  hasPlaceholders?: boolean;
  category: 'container' | 'content' | 'layout';
  description: string;
  special?: {
    hasSchemaField?: boolean;
  };
}
import { PresentationPropsSchema } from './components/presentation';
import { SlidePropsSchema } from './components/slide';

/**
 * SINGLE SOURCE OF TRUTH for all standard PPTX components
 */
export const PPTX_STANDARD_COMPONENTS_REGISTRY: readonly PptxStandardComponentDefinition[] =
  [
    // ========================================================================
    // Container Components (can contain children)
    // ========================================================================
    {
      name: 'pptx',
      propsSchema: PresentationPropsSchema,
      hasChildren: true,
      allowedChildren: ['slide'],
      category: 'container',
      description:
        'Main presentation container - defines the overall presentation structure. Required as the root component.',
      special: {
        hasSchemaField: true,
      },
    },
    {
      name: 'slide',
      propsSchema: SlidePropsSchema,
      hasChildren: true,
      allowedChildren: PPTX_SLIDE_CONTENT_COMPONENTS.map(({ name }) => name),
      hasPlaceholders: true,
      category: 'container',
      description:
        'Slide container - groups content elements on a single slide.',
    },

    // Content components are canonical in @json-to-office/shared so DOCX
    // visuals can reuse the exact schemas without depending on shared-pptx.
    ...PPTX_SLIDE_CONTENT_COMPONENTS,
  ] as const;

// ============================================================================
// Helper Functions
// ============================================================================

export function getPptxStandardComponent(
  name: string
): PptxStandardComponentDefinition | undefined {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.find((c) => c.name === name);
}

export function getAllPptxComponentNames(): readonly string[] {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.map((c) => c.name);
}

export function getPptxComponentsByCategory(
  category: PptxStandardComponentDefinition['category']
): readonly PptxStandardComponentDefinition[] {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.filter(
    (c) => c.category === category
  );
}

export function getPptxContainerComponents(): readonly PptxStandardComponentDefinition[] {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.filter((c) => c.hasChildren);
}

export function getPptxContentComponents(): readonly PptxStandardComponentDefinition[] {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.filter((c) => !c.hasChildren);
}

export function isPptxStandardComponent(name: string): boolean {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.some((c) => c.name === name);
}

// ============================================================================
// Schema Generation Helpers
// ============================================================================

export function createPptxComponentSchemaObject(
  component: PptxStandardComponentDefinition,
  recursiveRef?: TSchema,
  placeholderRef?: TSchema,
  profile?: { renderer: PptxRendererId; requireDiscriminator: boolean }
): TSchema {
  const schema: Record<string, TSchema> = {
    name: Type.Literal(component.name),
    id: Type.Optional(Type.String()),
    enabled: Type.Optional(
      Type.Boolean({
        default: true,
        description:
          'When false, this component is filtered out and not rendered. Defaults to true.',
      })
    ),
  };

  if (component.special?.hasSchemaField) {
    schema.$schema = Type.Optional(Type.String({ format: 'uri' }));
    schema.renderer = profile
      ? profile.requireDiscriminator
        ? Type.Literal(profile.renderer, {
            description: 'Renderer backend for this presentation',
          })
        : Type.Optional(
            Type.Literal(profile.renderer, {
              description: 'Renderer backend. Omitted defaults to "pptxgenjs".',
            })
          )
      : Type.Optional(
          Type.Union(
            PPTX_RENDERER_IDS.map((renderer) => Type.Literal(renderer)),
            {
              description: 'Renderer backend. Omitted defaults to "pptxgenjs".',
            }
          )
        );
  }

  schema.props = profile
    ? pptxPropsSchemaForRenderer(
        component.name,
        component.propsSchema,
        profile.renderer
      )
    : component.propsSchema;

  if (component.hasChildren && recursiveRef) {
    schema.children = Type.Optional(Type.Array(recursiveRef));
  }

  if (
    component.hasPlaceholders &&
    (placeholderRef ?? recursiveRef) &&
    profile?.renderer !== 'office-open'
  ) {
    const baseProperties = (schema.props as any).properties ?? {};
    const phRef = placeholderRef ?? recursiveRef!;
    schema.props = Type.Object(
      {
        ...baseProperties,
        placeholders: Type.Optional(
          Type.Record(Type.String(), phRef, {
            description:
              'Content for named placeholders: { "title": { "name": "text", ... } }',
          })
        ),
      },
      {
        additionalProperties: false,
        description: (component.propsSchema as any).description,
      }
    );
  }

  return Type.Object(schema, {
    additionalProperties: false,
    description: component.description,
  });
}

export function createAllPptxComponentSchemas(
  recursiveRef?: TSchema
): readonly TSchema[] {
  return PPTX_STANDARD_COMPONENTS_REGISTRY.map((component) =>
    createPptxComponentSchemaObject(component, recursiveRef)
  );
}

/**
 * Build all standard PPTX component schemas with per-container narrowed children.
 *
 * Resolves containers in dependency order so each container's children union
 * only references its allowedChildren. Plugin schemas are always included in
 * every container's children.
 *
 * @param selfRef - The Type.Recursive self-reference (fallback and for plugin children)
 * @param pluginSchemas - Plugin component schemas (always allowed in all containers)
 * @returns Array of TypeBox schemas with narrowed children per container
 */
export function createAllPptxComponentSchemasNarrowed(
  selfRef: TSchema,
  pluginSchemas: TSchema[] = [],
  profile?: { renderer: PptxRendererId; requireDiscriminator: boolean }
): TSchema[] {
  // Phase 1: Build leaf (non-container) component schemas — no children
  const leafSchemas = new Map<string, TSchema>();
  for (const comp of PPTX_STANDARD_COMPONENTS_REGISTRY) {
    if (
      !comp.hasChildren &&
      (!profile || isPptxComponentSupported(comp.name, profile.renderer))
    ) {
      leafSchemas.set(
        comp.name,
        createPptxComponentSchemaObject(comp, undefined, selfRef, profile)
      );
    }
  }

  // Phase 2: Resolve containers in dependency order
  const containers = PPTX_STANDARD_COMPONENTS_REGISTRY.filter(
    (c) => c.hasChildren
  );
  const resolved = new Map<string, TSchema>();
  const pending = [...containers];

  while (pending.length > 0) {
    const before = pending.length;
    for (let i = pending.length - 1; i >= 0; i--) {
      const comp = pending[i];

      if (!comp.allowedChildren) {
        // No allowedChildren declared — fallback to full recursive ref
        resolved.set(
          comp.name,
          createPptxComponentSchemaObject(comp, selfRef, selfRef, profile)
        );
        pending.splice(i, 1);
        continue;
      }

      // Check if all container dependencies are resolved
      const containerDeps = comp.allowedChildren.filter((name) =>
        containers.some((c) => c.name === name)
      );
      if (!containerDeps.every((d) => resolved.has(d))) continue;

      // Build narrowed children union
      const childSchemas = comp.allowedChildren
        .map((name) => resolved.get(name) ?? leafSchemas.get(name))
        .filter((s): s is TSchema => s !== undefined);

      const allChildSchemas = [...childSchemas, ...pluginSchemas];
      const childrenType =
        allChildSchemas.length === 1
          ? allChildSchemas[0]
          : Type.Union(allChildSchemas);

      resolved.set(
        comp.name,
        createPptxComponentSchemaObject(comp, childrenType, selfRef, profile)
      );
      pending.splice(i, 1);
    }

    if (pending.length === before) {
      throw new Error(
        `Circular allowedChildren among: ${pending.map((c) => c.name).join(', ')}`
      );
    }
  }

  // Combine: containers (resolved) + leaves
  return [...resolved.values(), ...leafSchemas.values()];
}
