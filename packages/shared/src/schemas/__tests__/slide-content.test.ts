import { describe, expect, it } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  PPTX_SLIDE_CONTENT_COMPONENTS,
  PptxSlideContentSchema,
  TextPropsSchema,
  PptxImagePropsSchema,
  ShapePropsSchema,
  PptxTablePropsSchema,
  PptxHighchartsPropsSchema,
  PptxChartPropsSchema,
} from '../slide-content';

describe('canonical PPTX slide content', () => {
  it('keeps descriptors and schemas in public union order', () => {
    const names = PPTX_SLIDE_CONTENT_COMPONENTS.map(({ name }) => name);

    expect(names).toEqual([
      'text',
      'image',
      'shape',
      'table',
      'highcharts',
      'chart',
    ]);
    expect(
      PPTX_SLIDE_CONTENT_COMPONENTS.map(({ propsSchema }) => propsSchema)
    ).toEqual([
      TextPropsSchema,
      PptxImagePropsSchema,
      ShapePropsSchema,
      PptxTablePropsSchema,
      PptxHighchartsPropsSchema,
      PptxChartPropsSchema,
    ]);
    expect(
      PptxSlideContentSchema.anyOf.map((schema) => schema.properties.name.const)
    ).toEqual(names);
  });

  it.each([
    ['text', { text: 'Hello' }],
    ['image', { path: 'image.png' }],
    ['shape', { type: 'rect' }],
    ['table', { rows: [['value']] }],
    ['highcharts', { options: { chart: { width: 800, height: 450 } } }],
    ['chart', { type: 'bar', data: [{ labels: ['A'], values: [1] }] }],
  ])('accepts %s content', (name, props) => {
    expect(Value.Check(PptxSlideContentSchema, { name, props })).toBe(true);
  });

  it('rejects unknown names, props, and children', () => {
    expect(
      Value.Check(PptxSlideContentSchema, {
        name: 'unknown',
        props: {},
      })
    ).toBe(false);
    expect(
      Value.Check(PptxSlideContentSchema, {
        name: 'text',
        props: { text: 'Hello', unknown: true },
      })
    ).toBe(false);
    expect(
      Value.Check(PptxSlideContentSchema, {
        name: 'text',
        props: { text: 'Hello' },
        children: [],
      })
    ).toBe(false);
  });
});
