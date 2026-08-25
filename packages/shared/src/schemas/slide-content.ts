/**
 * Canonical schemas for leaf content rendered on a PPTX slide.
 *
 * Kept in the format-agnostic shared package because DOCX visuals embed the
 * same content model without depending on the full PPTX schema package.
 */

import { Type, Static, TSchema } from '@sinclair/typebox';
import { TextPropsSchema } from './slide-content/text';
import { PptxImagePropsSchema } from './slide-content/image';
import { ShapePropsSchema } from './slide-content/shape';
import { PptxTablePropsSchema } from './slide-content/table';
import { PptxHighchartsPropsSchema } from './slide-content/highcharts';
import { PptxChartPropsSchema } from './slide-content/chart';

export * from './slide-content/common';
export * from './slide-content/theme';
export * from './slide-content/text';
export * from './slide-content/image';
export * from './slide-content/shape';
export * from './slide-content/table';
export * from './slide-content/highcharts';
export * from './slide-content/chart';

export interface PptxSlideContentComponentDescriptor<
  TName extends string = string,
  TPropsSchema extends TSchema = TSchema,
> {
  readonly name: TName;
  readonly propsSchema: TPropsSchema;
  readonly hasChildren: false;
  readonly category: 'content';
  readonly description: string;
  /**
   * Force `props` to stay required even though the props schema accepts `{}`.
   *
   * Only for components whose content requirement is real but inexpressible in
   * a single TypeBox object — see `pptxComponentRequiresProps`.
   */
  readonly propsRequired?: boolean;
}

/**
 * Whether a PPTX component must carry a `props` key.
 *
 * The default answer is the props schema's own: a schema that accepts `{}`
 * demands nothing, so the key adds nothing and may be omitted (this mirrors
 * `demandsProps` in shared-docx). Two components override it, because their
 * content requirement is a rule a single TypeBox object cannot state: `text`
 * needs exactly one of `text`/`runs` and `image` exactly one of
 * `path`/`base64`/`svg`, so both leave every field optional and are still
 * unrenderable empty. Declaring it here rather than in each consumer is what
 * keeps the published schema and the runtime validator asking for the same
 * key — they both call this.
 *
 * The override is what the published schema has always said for both, so it is
 * the runtime that moved to meet it. Reading the schema's own answer instead
 * would have loosened the published contract on `image` — a change to what
 * agents are told, made to fix a disagreement about what they are told.
 */
export function pptxComponentRequiresProps(component: {
  readonly propsSchema: TSchema;
  readonly propsRequired?: boolean;
}): boolean {
  if (component.propsRequired !== undefined) return component.propsRequired;
  const schema = component.propsSchema as {
    type?: string;
    required?: readonly string[];
  };
  return schema.type !== 'object' || (schema.required?.length ?? 0) > 0;
}

/**
 * Single source of truth for PPTX leaf content, in public schema order.
 */
export const PPTX_SLIDE_CONTENT_COMPONENTS = [
  {
    name: 'text',
    propsSchema: TextPropsSchema,
    hasChildren: false,
    category: 'content',
    // `text` XOR `runs`: both optional in the schema, one of them mandatory in
    // fact (validation/text-content-conflicts.ts rejects neither and both).
    propsRequired: true,
    description:
      'Text element - displays text with formatting, positioning and styling options.',
  },
  {
    name: 'image',
    propsSchema: PptxImagePropsSchema,
    hasChildren: false,
    category: 'content',
    // One of `path`/`base64`/`svg`, so same shape as `text`: a source is
    // mandatory in fact and optional in the schema. Unlike `text` this is only
    // half enforced — the missing key is caught, an empty props object is not,
    // because `image` has no analogue of validation/text-content-conflicts.ts
    // and a sourceless image is an IMAGE_NO_SOURCE warning at generation, not
    // an error. The flag is still not the guess: `image` has required `props`
    // in the published schema since it was first generated, so dropping it
    // here would loosen that contract rather than tighten the runtime.
    propsRequired: true,
    description:
      'Image element - displays images from file path, URL, or base64 data.',
  },
  {
    name: 'shape',
    propsSchema: ShapePropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Shape element - draws geometric shapes with optional text, fill, and line styling.',
  },
  {
    name: 'table',
    propsSchema: PptxTablePropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Table element, declared ROW-MAJOR: `props.rows[][]`, an array of rows, each an array of cells, with no structural header — `headerRow: true` styles the first row as one. Note the DOCX `table` is the other way round — columns each carrying their own header and cells — so a table cannot be moved between the formats unchanged.',
  },
  {
    name: 'highcharts',
    propsSchema: PptxHighchartsPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Highcharts element - renders charts via Highcharts Export Server.',
  },
  {
    name: 'chart',
    propsSchema: PptxChartPropsSchema,
    hasChildren: false,
    category: 'content',
    description:
      'Native PowerPoint chart - editable, scalable, no external server needed.',
  },
] as const satisfies readonly PptxSlideContentComponentDescriptor[];

export type PptxSlideContentComponentName =
  (typeof PPTX_SLIDE_CONTENT_COMPONENTS)[number]['name'];

function createSlideContentComponentSchema<
  const TName extends string,
  const TPropsSchema extends TSchema,
>(component: PptxSlideContentComponentDescriptor<TName, TPropsSchema>) {
  return Type.Object(
    {
      name: Type.Literal(component.name),
      id: Type.Optional(Type.String()),
      enabled: Type.Optional(
        Type.Boolean({
          default: true,
          description:
            'When false, this component is filtered out and not rendered. Defaults to true.',
        })
      ),
      props: pptxComponentRequiresProps(component)
        ? component.propsSchema
        : Type.Optional(component.propsSchema),
    },
    { additionalProperties: false, description: component.description }
  );
}

/**
 * A single PPTX slide content element. The explicit id lets JSON-Schema export
 * hoist the union into one shared definition when DOCX visuals embed it.
 */
export const PptxSlideContentSchema = Type.Union(
  [
    createSlideContentComponentSchema(PPTX_SLIDE_CONTENT_COMPONENTS[0]),
    createSlideContentComponentSchema(PPTX_SLIDE_CONTENT_COMPONENTS[1]),
    createSlideContentComponentSchema(PPTX_SLIDE_CONTENT_COMPONENTS[2]),
    createSlideContentComponentSchema(PPTX_SLIDE_CONTENT_COMPONENTS[3]),
    createSlideContentComponentSchema(PPTX_SLIDE_CONTENT_COMPONENTS[4]),
    createSlideContentComponentSchema(PPTX_SLIDE_CONTENT_COMPONENTS[5]),
  ],
  {
    $id: 'PptxSlideContent',
    discriminator: { propertyName: 'name' },
    description:
      'A single PPTX slide content element (text, image, shape, table, highcharts, or chart).',
  }
);

export type PptxSlideContent = Static<typeof PptxSlideContentSchema>;
