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
    description:
      'Text element - displays text with formatting, positioning and styling options.',
  },
  {
    name: 'image',
    propsSchema: PptxImagePropsSchema,
    hasChildren: false,
    category: 'content',
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
    description: 'Table element - displays tabular data with rows and columns.',
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
      props: component.propsSchema,
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
