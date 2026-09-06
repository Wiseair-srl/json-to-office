import { Type, type TSchema } from '@sinclair/typebox';

/**
 * Content roles a definition may assign to a slot. A quality profile reads
 * them to require or measure content (an action title at most two lines, a
 * source under every chart); the theme only styles them. No role adds a
 * requirement on its own.
 */
export const BLOCK_SLOT_ROLES = [
  'actionTitle',
  'takeaway',
  'source',
  'tracker',
  'footer',
] as const;
export type BlockSlotRole = (typeof BLOCK_SLOT_ROLES)[number];

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
  role?: BlockSlotRole;
}

/** Definitions are authored data. No concrete block is registered by the core. */
export interface JsonBlockDefinition {
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
  /** PPTX slide settings the invocation's slide inherits unless it states its own. */
  slide?: {
    background?: unknown;
    grid?: unknown;
    notes?: unknown;
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
        ].map((v) => Type.Literal(v)),
        {
          description:
            'Content type accepted by this slot. Use component for a document component or registered plugin.',
        }
      ),
      description: Type.Optional(
        Type.String({
          description: 'Explain this slot’s content and purpose to authors.',
        })
      ),
      required: Type.Optional(
        Type.Boolean({
          description:
            'Require a value when no default is provided. Defaults to false.',
        })
      ),
      default: Type.Optional(
        Type.Unknown({
          description:
            'Value used when the caller omits this slot. Must satisfy the slot’s type and constraints.',
        })
      ),
      enum: Type.Optional(
        Type.Array(Type.Union([Type.String(), Type.Number(), Type.Boolean()]), {
          minItems: 1,
          description: 'Allowed scalar values for this slot.',
        })
      ),
      minItems: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: 'Minimum number of array entries, inclusive.',
        })
      ),
      maxItems: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: 'Maximum number of array entries, inclusive.',
        })
      ),
      minLength: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: 'Minimum string length in characters, inclusive.',
        })
      ),
      maxLength: Type.Optional(
        Type.Integer({
          minimum: 0,
          description: 'Maximum string length in characters, inclusive.',
        })
      ),
      minimum: Type.Optional(
        Type.Number({ description: 'Minimum numeric value, inclusive.' })
      ),
      maximum: Type.Optional(
        Type.Number({ description: 'Maximum numeric value, inclusive.' })
      ),
      maxWords: Type.Optional(
        Type.Integer({
          minimum: 1,
          description:
            'Maximum whitespace-separated word count. Exceeding it fails validation.',
        })
      ),
      oneLine: Type.Optional(
        Type.Boolean({
          description:
            'Reject newline characters in string values. Does not prevent visual line wrapping.',
        })
      ),
      items: Type.Optional({
        ...Self,
        description: 'Slot type and constraints for each array entry.',
      }),
      properties: Type.Optional(
        Type.Record(Type.String(), Self, {
          description:
            'Named child slots accepted by an object slot. Undeclared properties are rejected.',
        })
      ),
      role: Type.Optional(
        Type.Union(
          BLOCK_SLOT_ROLES.map((role) => Type.Literal(role)),
          {
            description:
              'Content role for quality profiles: actionTitle, takeaway, source, tracker or footer. A profile may require or measure it; the theme only styles it.',
          }
        )
      ),
    },
    { additionalProperties: false }
  )
);

export const JsonBlockDefinitionSchema = Type.Unsafe<JsonBlockDefinition>(
  Type.Object(
    {
      description: Type.Optional(
        Type.String({
          description:
            'Describe what this reusable block renders and when to use it.',
        })
      ),
      slots: Type.Record(Type.String(), BlockSlotSchema, {
        description:
          'Named inputs and their types, defaults and constraints. Use an empty object for a block with no inputs.',
      }),
      body: Type.Array(Type.Unknown(), {
        description:
          'Components and binding directives expanded in order when this block is invoked.',
      }),
      section: Type.Optional(
        Type.Object(
          {
            tracker: Type.Optional(
              Type.Unknown({
                description:
                  'Section tracker value or binding, available to headers and footers through $context at /section/tracker.',
              })
            ),
            header: Type.Optional(
              Type.Array(Type.Unknown(), {
                description:
                  'Header component templates. Explicit header settings on the section take precedence.',
              })
            ),
            footer: Type.Optional(
              Type.Array(Type.Unknown(), {
                description:
                  'Footer component templates. Explicit footer settings on the section take precedence.',
              })
            ),
            pageBreak: Type.Optional(
              Type.Boolean({
                description:
                  'Start the containing section on a new page. An explicit section pageBreak setting takes precedence.',
              })
            ),
            scope: Type.Optional(
              Type.Union([Type.Literal('section'), Type.Literal('following')], {
                description:
                  'Apply header/footer templates to this section only, or inherit them in following sections. Defaults to section.',
              })
            ),
          },
          {
            additionalProperties: false,
            description:
              'DOCX section tracker, header/footer templates and page-break behavior. Place this block at the section boundary.',
          }
        )
      ),
      slide: Type.Optional(
        Type.Object(
          {
            background: Type.Optional(
              Type.Unknown({
                description:
                  'Slide background (color, gradient or image) or a binding. A background the slide states itself takes precedence.',
              })
            ),
            grid: Type.Optional(
              Type.Unknown({
                description:
                  'Grid configuration merged over the presentation grid when resolving grid placements in this block’s body.',
              })
            ),
            notes: Type.Optional(
              Type.Unknown({
                description:
                  'Speaker notes or a binding. Notes the slide states itself take precedence.',
              })
            ),
          },
          {
            additionalProperties: false,
            description:
              'PPTX slide background, grid and notes supplied by this block. Invoke the block as a direct child of a slide.',
          }
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
    slots: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description:
          'Input values keyed by the slot names declared in the referenced block definition.',
      })
    ),
  },
  { additionalProperties: false }
);

/** Portable JSON Schema for a single slot, also used by catalog/inspect clients. */
export function blockSlotJsonSchema(slot: BlockSlot): Record<string, unknown> {
  const { oneLine, properties, items, role, ...rest } = slot;
  void role;
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
