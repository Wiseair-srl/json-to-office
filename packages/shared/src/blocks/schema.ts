import { Type, type TSchema } from '@sinclair/typebox';

export interface BlockSlot {
  type:
    | 'string'
    | 'number'
    | 'integer'
    | 'boolean'
    | 'object'
    | 'array'
    | 'component';
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: (string | number | boolean)[];
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  maxWords?: number;
  oneLine?: boolean;
  items?: BlockSlot;
  properties?: Record<string, BlockSlot>;
}

/** Definitions are authored data. No concrete block is registered by the core. */
export interface JsonBlockDefinition {
  format: 'docx' | 'pptx';
  description?: string;
  slots: Record<string, BlockSlot>;
  body: unknown[];
  /** DOCX section state, applied before rendering its header and footer. */
  section?: {
    tracker?: unknown;
    header?: unknown[];
    footer?: unknown[];
    pageBreak?: boolean;
    scope?: 'section' | 'following';
  };
}

export const BlockSlotSchema: TSchema = Type.Recursive((Self) =>
  Type.Object(
    {
      type: Type.Union(
        [
          'string',
          'number',
          'integer',
          'boolean',
          'object',
          'array',
          'component',
        ].map((v) => Type.Literal(v))
      ),
      description: Type.Optional(Type.String()),
      required: Type.Optional(Type.Boolean()),
      default: Type.Optional(Type.Unknown()),
      enum: Type.Optional(
        Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
          minItems: 1,
        })
      ),
      minItems: Type.Optional(Type.Integer({ minimum: 0 })),
      maxItems: Type.Optional(Type.Integer({ minimum: 0 })),
      minLength: Type.Optional(Type.Integer({ minimum: 0 })),
      maxLength: Type.Optional(Type.Integer({ minimum: 0 })),
      minimum: Type.Optional(Type.Number()),
      maximum: Type.Optional(Type.Number()),
      maxWords: Type.Optional(Type.Integer({ minimum: 1 })),
      oneLine: Type.Optional(Type.Boolean()),
      items: Type.Optional(Self),
      properties: Type.Optional(Type.Record(Type.String(), Self)),
    },
    { additionalProperties: false }
  )
);

export const JsonBlockDefinitionSchema = Type.Unsafe<JsonBlockDefinition>(
  Type.Object(
    {
      format: Type.Union([Type.Literal('docx'), Type.Literal('pptx')]),
      description: Type.Optional(Type.String()),
      slots: Type.Record(Type.String(), BlockSlotSchema),
      body: Type.Array(Type.Unknown()),
      section: Type.Optional(
        Type.Object(
          {
            tracker: Type.Optional(Type.Unknown()),
            header: Type.Optional(Type.Array(Type.Unknown())),
            footer: Type.Optional(Type.Array(Type.Unknown())),
            pageBreak: Type.Optional(Type.Boolean()),
            scope: Type.Optional(
              Type.Union([Type.Literal('section'), Type.Literal('following')])
            ),
          },
          { additionalProperties: false }
        )
      ),
    },
    { additionalProperties: false }
  )
);

export const BlockDefinitionsSchema = Type.Record(
  Type.String({ pattern: '^[a-zA-Z][a-zA-Z0-9_-]*$' }),
  JsonBlockDefinitionSchema,
  {
    description:
      'Document-local JSON block definitions. Names are not built into the engine.',
  }
);

export const BlockInvocationPropsSchema = Type.Object(
  {
    ref: Type.String({
      minLength: 1,
      description: 'Name in this document’s props.blocks.',
    }),
    slots: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false }
);

/** Portable JSON Schema for a single slot, also used by catalog/inspect clients. */
export function blockSlotJsonSchema(slot: BlockSlot): Record<string, unknown> {
  const { oneLine, properties, items, ...rest } = slot;
  delete rest.required;
  delete rest.maxWords;
  if (slot.type === 'component') {
    return {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      description: slot.description,
    };
  }
  return {
    ...rest,
    ...(oneLine && { pattern: '^[^\\r\\n]*$' }),
    ...(items && { items: blockSlotJsonSchema(items) }),
    ...(properties && {
      properties: Object.fromEntries(
        Object.entries(properties).map(([key, value]) => [
          key,
          blockSlotJsonSchema(value),
        ])
      ),
      required: Object.entries(properties)
        .filter(([, value]) => value.required && value.default === undefined)
        .map(([key]) => key),
      additionalProperties: false,
    }),
  };
}
