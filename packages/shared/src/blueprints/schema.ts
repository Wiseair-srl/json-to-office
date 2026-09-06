/**
 * Blueprints: document archetypes as data.
 *
 * A blueprint is a whole-document plan — the recommended theme, the quality
 * profile that judges the result, the playground template whose block
 * definitions it invokes, and one or more structural variants, each an ordered
 * list of top-level children with every slot holding an explicit `{{…}}`
 * scaffold marker. The marker's text is the guidance for that slot; nothing in
 * a blueprint composes, styles or registers anything. Adding one is a JSON
 * file in a registry directory, not code.
 */
import { Type, type Static } from '@sinclair/typebox';
import { Value, type ValueError } from '@sinclair/typebox/value';

export const BLUEPRINT_FORMATS = ['docx', 'pptx'] as const;
export type BlueprintFormat = (typeof BLUEPRINT_FORMATS)[number];

const Identifier = Type.String({
  pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$',
  description: 'Kebab-case identifier.',
});

export const BlueprintPagesSchema = Type.Object(
  {
    min: Type.Integer({ minimum: 1 }),
    max: Type.Integer({ minimum: 1 }),
  },
  {
    additionalProperties: false,
    description:
      'Expected length once filled: pages for a document, slides for a deck.',
  }
);

export const BlueprintVariantSchema = Type.Object(
  {
    description: Type.String({ minLength: 1 }),
    whenToUse: Type.String({ minLength: 1 }),
    pages: BlueprintPagesSchema,
    metadata: Type.Optional(
      Type.Record(Type.String(), Type.String(), {
        description:
          'Document metadata the scaffold writes; a value may be a scaffold marker.',
      })
    ),
    children: Type.Array(Type.Unknown(), {
      minItems: 1,
      description:
        'The top-level children of the scaffolded document, in order: sections holding block invocations and ordinary components, every slot carrying a {{…}} marker whose text is the guidance for filling it.',
    }),
  },
  { additionalProperties: false }
);

export const BlueprintSchema = Type.Object(
  {
    id: Identifier,
    format: Type.Union(BLUEPRINT_FORMATS.map((f) => Type.Literal(f))),
    title: Type.String({ minLength: 1 }),
    description: Type.String({ minLength: 1 }),
    whenToUse: Type.String({ minLength: 1 }),
    theme: Type.String({
      minLength: 1,
      description:
        'Recommended theme. Any theme renders the scaffold; this one is the archetype’s house look.',
    }),
    profile: Identifier,
    definitions: Type.String({
      minLength: 1,
      description:
        'The playground template whose props.blocks the variants invoke. The scaffold copies the definitions it needs, and their dependencies, into the document.',
    }),
    numbering: Type.Union([Type.Literal('none'), Type.Literal('sections')], {
      description:
        'Whether section openers carry numbers the reader cites (01, 02, …).',
    }),
    toc: Type.Boolean({
      description: 'Whether the scaffold places a table of contents.',
    }),
    variants: Type.Record(Identifier, BlueprintVariantSchema, {
      minProperties: 1,
      description:
        'Structural variants of the same archetype, so two documents from one brief do not look alike.',
    }),
  },
  { additionalProperties: false, description: 'A document archetype as data.' }
);

export type Blueprint = Static<typeof BlueprintSchema>;
export type BlueprintVariant = Static<typeof BlueprintVariantSchema>;

/**
 * One `{{…}}` marker an instantiated blueprint left for the author.
 *
 * Declared here rather than beside the DOCX instantiator because the MCP
 * server hands the same entries over the wire and cannot depend on a core.
 */
export interface BlueprintFillEntry {
  /** JSON pointer into the instantiated document; the value is the marker. */
  path: string;
  /** The marker as written, `{{…}}` included. */
  marker: string;
  /** The marker's text: what to write there. */
  guidance: string;
  /** Where the marker sits. */
  kind: 'slot' | 'text' | 'metadata';
  /** For a `slot`: the block and the slot, dotted for nested fields. */
  block?: string;
  slot?: string;
  /**
   * For a `slot`: the declared slot type and its bounds. A marker inside a
   * component slot's content reports that component slot.
   */
  type?: string;
  maxWords?: number;
  maxLength?: number;
  oneLine?: boolean;
  required?: boolean;
}

export interface BlueprintIssue {
  path: string;
  message: string;
}

/** Schema errors for a candidate blueprint, empty when it conforms. */
export function validateBlueprint(value: unknown): BlueprintIssue[] {
  const issues = [...Value.Errors(BlueprintSchema, value)].map(
    (error: ValueError) => ({ path: error.path, message: error.message })
  );
  if (issues.length > 0) return issues;
  // The schema bounds each end of a page range; only this can compare them.
  for (const [id, variant] of Object.entries((value as Blueprint).variants)) {
    if (variant.pages.min > variant.pages.max)
      issues.push({
        path: `/variants/${id}/pages`,
        message: `min (${variant.pages.min}) exceeds max (${variant.pages.max})`,
      });
  }
  return issues;
}

export function isBlueprint(value: unknown): value is Blueprint {
  return Value.Check(BlueprintSchema, value);
}
