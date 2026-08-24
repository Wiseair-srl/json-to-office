/**
 * The `chart` component is office-open's alone.
 *
 * docx.js has no chart primitive at all, so this is a real backend gap rather
 * than a slice boundary. The component therefore has to disappear from the
 * `docxjs` branch of the schema — not merely fail at render time — so a
 * schema-driven editor never offers a component that backend cannot draw.
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

  it('accepts a chart under office-open', () => {
    expect(Value.Check(schema, document('office-open'))).toBe(true);
  });

  it('rejects a chart under docxjs', () => {
    expect(Value.Check(schema, document('docxjs'))).toBe(false);
  });

  it('rejects a chart when the renderer is omitted, which means docxjs', () => {
    expect(Value.Check(schema, document())).toBe(false);
  });

  it('names the renderer in the diagnostic rather than calling it unknown', () => {
    const errors = collectDocxRendererErrors(document('docxjs'));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      path: '/children/0/children/0/name',
      code: 'unsupported_renderer_feature',
    });
    expect(errors[0].message).toContain('office-open');
  });

  it('reports the chart through the document validator', () => {
    const result = validateDocument(document('docxjs'));
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((error) =>
        error.message.toLowerCase().includes('chart')
      )
    ).toBe(true);
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
