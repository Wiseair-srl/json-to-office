/**
 * PPTX Component Registry - SINGLE SOURCE OF TRUTH
 *
 * This is the ONLY place where standard PPTX components are defined.
 * All schema generators MUST use this registry.
 */

import { Type, TSchema } from '@sinclair/typebox';
import {
  PPTX_SLIDE_CONTENT_COMPONENTS,
  pptxComponentRequiresProps,
} from '@json-to-office/shared/schemas/slide-content';
import {
  PPTX_RENDERER_IDS,
  pptxPropsSchemaForRenderer,
  type PptxRendererId,
} from './renderer';
import { BlockInvocationPropsSchema } from '@json-to-office/shared';
import { PptxGroupPropsSchema } from './components/group';

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
  category: 'container' | 'content' | 'layout';
  description: string;
  /**
   * Force `props` to stay required even though the props schema accepts `{}`.
   * See `pptxComponentRequiresProps` for when that is legitimate.
   */
  propsRequired?: boolean;
  special?: {
    hasSchemaField?: boolean;
  };
}
import { PresentationPropsSchema } from './components/presentation';
import { SlidePropsSchema } from './components/slide';

/** What a slide holds: content, a document-local block, or a transparent group. */
const SLIDE_CHILDREN: readonly string[] = [
  ...PPTX_SLIDE_CONTENT_COMPONENTS.map(({ name }) => name),
  'block',
  'group',
];

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
      // Every presentation prop is optional, but the root is where a deck
      // states its title, size and theme, and both the published schema and
      // the deep validator have always demanded the key. Keeping it required
      // is a decision, not the schema's own answer, so it is declared.
      propsRequired: true,
      description:
        'Main presentation container - defines the overall presentation structure. Required as the root component. Always declare `slideWidth`/`slideHeight` (13.333 × 7.5 for 16:9) — omitted, the renderer silently falls back to 4:3 and 16:9 content leaves a dead strip.',
      special: {
        hasSchemaField: true,
      },
    },
    {
      name: 'slide',
      propsSchema: SlidePropsSchema,
      hasChildren: true,
      allowedChildren: SLIDE_CHILDREN,
      category: 'container',
      // No `propsRequired`: every slide prop is optional and nothing outside
      // the schema asks for one, so `{ "name": "slide", "children": [...] }`
      // is a whole slide and the published schema says so.
      description:
        'Slide container - groups content elements on a single slide. One idea per slide: past roughly 40 words of body text, split the content across more slides.',
    },

    {
      name: 'group',
      propsSchema: PptxGroupPropsSchema,
      hasChildren: true,
      allowedChildren: SLIDE_CHILDREN,
      category: 'layout',
      description:
        'Transparent group of slide content; also the inspectable result of block expansion. Give it a frame (x/y/w/h or grid) to position children within it, and a direction to distribute them into equal or weighted cells.',
    },
    {
      name: 'block',
      propsSchema: BlockInvocationPropsSchema,
      hasChildren: false,
      category: 'layout',
      description:
        'Invoke a JSON block defined in this document’s props.blocks. Fill its named slots; no block names are built into the engine and no coordinates are accepted here.',
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

/**
 * Whether this component must carry a `props` key — the one answer both the
 * published schema and the deep validator read.
 *
 * Re-exported from `@json-to-office/shared` so the registry is the single
 * place a consumer has to look: the rule is the props schema's own (a schema
 * that accepts `{}` demands nothing) unless the definition overrides it.
 */
export { pptxComponentRequiresProps };

// ============================================================================
// Schema Generation Helpers
// ============================================================================

export function createPptxComponentSchemaObject(
  component: PptxStandardComponentDefinition,
  recursiveRef?: TSchema,
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

  // Optionality is decided from the canonical definition, never from the
  // pruned/placeholder-augmented copy above: the deep validator checks the
  // canonical schema, so reading anything else here is how the published
  // schema and the runtime would start disagreeing about the same document.
  if (!pptxComponentRequiresProps(component)) {
    schema.props = Type.Optional(schema.props);
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
    if (!comp.hasChildren) {
      leafSchemas.set(
        comp.name,
        createPptxComponentSchemaObject(comp, undefined, profile)
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

      if (comp.name === 'group') {
        // A group holds what a slide holds, itself included, so it recurses
        // through the self-reference narrowed to slide content — never a
        // slide or the root.
        const content = Type.Intersect([
          selfRef,
          Type.Object({
            name: Type.Union([
              ...comp.allowedChildren!.map((name) => Type.Literal(name)),
              ...pluginSchemas.map(
                (schema) => (schema as any).properties?.name ?? Type.String()
              ),
            ]),
          }),
        ]);
        resolved.set(
          comp.name,
          createPptxComponentSchemaObject(comp, content, profile)
        );
        pending.splice(i, 1);
        continue;
      }
      if (!comp.allowedChildren) {
        // No allowedChildren declared — fallback to full recursive ref
        resolved.set(
          comp.name,
          createPptxComponentSchemaObject(comp, selfRef, profile)
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
        createPptxComponentSchemaObject(comp, childrenType, profile)
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
