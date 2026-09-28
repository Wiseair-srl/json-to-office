/**
 * The `chart` component, on every DOCX renderer.
 *
 * Both backends draw a native chart — `docxjs` through docx's `ChartRun` since
 * docx 9.8.0, `office-open` through its own chart run — so the component sits
 * in every renderer's branch of the schema, and nothing about the renderer is
 * reported against it.
 */

import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';
import { generateUnifiedDocumentSchema } from '../schemas/generator';
import { collectDocxRendererErrors } from '../schemas/renderer';
import { validateDocument } from '../validation/unified';

const chart = {
  name: 'chart',
  props: {
    type: 'bar',
    data: [{ name: 'Revenue', labels: ['Q1', 'Q2'], values: [12, 18] }],
  },
};

function document(renderer?: 'docxjs' | 'office-open', node: unknown = chart) {
  return {
    name: 'docx',
    ...(renderer ? { renderer } : {}),
    props: {},
    children: [{ name: 'section', children: [node] }],
  };
}

describe('chart component schema', () => {
  const schema = generateUnifiedDocumentSchema();

  it.each(['docxjs', 'office-open', undefined] as const)(
    'accepts a chart under %s',
    (renderer) => {
      expect(Value.Check(schema, document(renderer))).toBe(true);
    }
  );

  it('reports nothing about the renderer for a chart', () => {
    expect(collectDocxRendererErrors(document('docxjs'))).toEqual([]);
    expect(collectDocxRendererErrors(document())).toEqual([]);
    expect(collectDocxRendererErrors(document('office-open'))).toEqual([]);
  });

  it('passes the document validator on the default renderer', () => {
    const result = validateDocument(document());
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('requires at least one series', () => {
    const empty = { name: 'chart', props: { type: 'bar', data: [] } };
    expect(Value.Check(schema, document('office-open', empty))).toBe(false);
  });

  it('rejects slide coordinates, which mean nothing in a Word flow', () => {
    const positioned = {
      name: 'chart',
      props: { ...chart.props, x: 1, y: 1, w: 4, h: 3 },
    };
    expect(Value.Check(schema, document('office-open', positioned))).toBe(
      false
    );
  });

  it('accepts the flow placement props image and highcharts already spell', () => {
    const placed = {
      name: 'chart',
      props: {
        ...chart.props,
        width: 6.5,
        height: 3,
        alignment: 'center',
        caption: 'Revenue by quarter',
        alt: 'Bar chart of quarterly revenue',
        keepNext: true,
      },
    };
    expect(Value.Check(schema, document('office-open', placed))).toBe(true);
  });
});
