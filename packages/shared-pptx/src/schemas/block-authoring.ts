import {
  createBlockAuthoringSchema,
  unionBranches,
  type DocumentBlockTarget,
} from '@json-to-office/shared';
import {
  DEFAULT_PPTX_RENDERER_ID,
  pptxComponentDefinitionName,
  PPTX_RENDERER_IDS,
} from './renderer';

type Schema = Record<string, any>;

/**
 * Enrich every PPTX root in the exported schema, including plugin profiles.
 *
 * A block body holds what a slide holds — content components, nested blocks
 * and groups — so each renderer's component definition is narrowed to that
 * surface (never the root, never a slide) and derived into a binding-aware
 * authoring schema, then installed as the `items` of every definition body
 * under `props.blocks`. Runs before the name unions are restructured, while
 * the definition is still a flat `anyOf` the derivation can filter.
 */
export function addPptxBlockAuthoringSchemas(schema: Schema): void {
  const definitions = schema.definitions ?? {};
  const bodies = new Map<string, Schema>();
  for (const renderer of PPTX_RENDERER_IDS) {
    const name = pptxComponentDefinitionName(renderer);
    if (definitions[name])
      bodies.set(
        renderer,
        createBlockAuthoringSchema(definitions, name, ['pptx', 'slide'], 'pptx')
      );
  }
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const value = node as Schema;
    if (value.properties?.name?.const === 'pptx') {
      // The renderer const is the root branch's own declaration; the default
      // profile leaves the key optional, the others require it.
      const body = bodies.get(value.properties.renderer?.const);
      const blocks =
        value.properties.props?.properties?.blocks?.patternProperties;
      if (body && blocks)
        for (const block of Object.values(blocks) as Schema[])
          block.properties.body.items = body;
    }
    Object.values(value).forEach(visit);
  };
  visit(schema);
}

/**
 * Dispatch the root on `renderer` instead of leaving a flat union of
 * references.
 *
 * The exported root is `anyOf` over one `$ref` per renderer profile. A
 * schema-driven editor resolves a document against such a union by keeping
 * the best-matching branch, and with `"renderer": "office-open"` plus one
 * mistake in the deck the best match is often the *default* profile — whose
 * only complaint is that the renderer must be `pptxgenjs`, which hides the
 * real problem. Standard draft-07 conditionals select the branch the
 * document names, so diagnostics and completion come from that profile; a
 * renderer nobody offers falls to the default branch, which rejects it by
 * value. The set of accepted documents is unchanged.
 */
export function dispatchPptxRootByRenderer(schema: Schema): void {
  const branches = schema.anyOf;
  if (!Array.isArray(branches)) return;
  const refs = new Map<string, Schema>();
  for (const renderer of PPTX_RENDERER_IDS) {
    const ref = `#/definitions/${pptxComponentDefinitionName(renderer)}`;
    const branch = branches.find(
      (entry: Schema) => entry && entry.$ref === ref
    );
    if (branch) refs.set(renderer, branch);
  }
  if (refs.size !== branches.length || !refs.has(DEFAULT_PPTX_RENDERER_ID))
    return;
  const named = (renderer: string): Schema => ({
    properties: { renderer: { const: renderer } },
    required: ['renderer'],
  });
  const others = PPTX_RENDERER_IDS.filter(
    (renderer) => renderer !== DEFAULT_PPTX_RENDERER_ID && refs.has(renderer)
  );
  delete schema.anyOf;
  schema.type = 'object';
  schema.properties = {
    renderer: {
      description: 'Renderer backend. Omitted defaults to "pptxgenjs".',
      anyOf: PPTX_RENDERER_IDS.filter((renderer) => refs.has(renderer)).map(
        (renderer) => ({ const: renderer, type: 'string' })
      ),
    },
  };
  schema.allOf = [
    ...others.map((renderer) => ({
      if: named(renderer),
      then: refs.get(renderer),
    })),
    {
      if: { not: { anyOf: others.map(named) } },
      then: refs.get(DEFAULT_PPTX_RENDERER_ID),
    },
  ];
}

/**
 * Prepare the targets a document's own block definitions apply to, and
 * return them. One target per renderer's component definition, plus one per
 * slot-content definition, so a block placed inside a component slot
 * completes too. A component slot accepts what a slide holds; that union is
 * inlined in each slide branch rather than published, so this hoists it
 * under `PptxSlotContent_<renderer>` once — the one write it makes to the
 * schema — and references it.
 */
export function preparePptxDocumentBlockTargets(
  schema: Schema
): DocumentBlockTarget[] {
  const definitions = schema.definitions ?? {};
  const targets: DocumentBlockTarget[] = [];
  for (const renderer of PPTX_RENDERER_IDS) {
    const name = pptxComponentDefinitionName(renderer);
    const definition = definitions[name];
    if (!definition) continue;
    const contentName = `PptxSlotContent_${renderer}`;
    if (!definitions[contentName]) {
      const slide = unionBranches(definition).find(
        (branch: Schema) => branch.properties?.name?.const === 'slide'
      ) as Schema | undefined;
      const items = slide?.properties?.children?.items;
      if (items) definitions[contentName] = JSON.parse(JSON.stringify(items));
    }
    if (!definitions[contentName]) {
      targets.push({ name });
      continue;
    }
    const componentRef = { $ref: `#/definitions/${contentName}` };
    targets.push({ name, componentRef }, { name: contentName, componentRef });
  }
  return targets;
}
