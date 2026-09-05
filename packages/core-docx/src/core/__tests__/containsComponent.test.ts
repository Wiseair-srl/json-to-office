/**
 * What counts as "the document has a chart" for font materialization.
 *
 * `containsComponent` decides whether a build fetches registered font bytes
 * for the export server. A disabled chart is never drawn, so it must not
 * cost that fetch either.
 */
import { describe, expect, it } from 'vitest';
import { containsComponent } from '../componentTransform';

const chart = { name: 'highcharts', props: { options: { chart: {} } } };

describe('containsComponent', () => {
  it('finds a chart in children, a section header and a table cell', () => {
    expect(
      containsComponent(
        {
          name: 'docx',
          props: {},
          children: [{ name: 'section', children: [chart] }],
        },
        'highcharts'
      )
    ).toBe(true);
    expect(
      containsComponent(
        {
          name: 'docx',
          props: {},
          children: [{ name: 'section', props: { header: [chart] } }],
        },
        'highcharts'
      )
    ).toBe(true);
    expect(
      containsComponent(
        {
          name: 'docx',
          props: {},
          children: [
            {
              name: 'table',
              props: {
                columns: [
                  { header: { content: 'A' }, cells: [{ content: chart }] },
                ],
              },
            },
          ],
        },
        'highcharts'
      )
    ).toBe(true);
  });

  it('ignores a disabled chart and everything under a disabled container', () => {
    expect(
      containsComponent(
        { name: 'docx', props: {}, children: [{ ...chart, enabled: false }] },
        'highcharts'
      )
    ).toBe(false);
    expect(
      containsComponent(
        {
          name: 'docx',
          props: {},
          children: [{ name: 'section', enabled: false, children: [chart] }],
        },
        'highcharts'
      )
    ).toBe(false);
    expect(
      containsComponent({ name: 'docx', props: {}, children: [] }, 'highcharts')
    ).toBe(false);
  });
});
