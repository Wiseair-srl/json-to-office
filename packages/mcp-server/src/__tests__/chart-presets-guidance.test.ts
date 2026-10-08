/**
 * `componentDefaults.highcharts.options` reaches three surfaces: the theme
 * description a design guide is rendered from, the guide's own statement of
 * what a theme paints, and the schema `jto_describe_component` hands back for
 * the root component's `componentDefaults`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { InMemoryTransport } from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

import { createServer } from '../server.js';
import { createToolDeps } from '../lib/deps.js';
import { designGuide, renderDesignGuide } from '../lib/design-guide.js';
import { describeTheme } from '../lib/themes.js';

const theme = {
  name: 'unipol',
  displayName: 'Unipol',
  description: 'Navy on white.',
  whenToUse: 'Mobility plans.',
  fonts: { heading: { family: 'Manrope' }, body: { family: 'Manrope' } },
  colors: { primary: '#0F3250' },
  componentDefaults: {
    highcharts: { options: { chart: { backgroundColor: 'transparent' } } },
  },
};

describe('theme descriptions', () => {
  it('say when a theme states chart options', () => {
    expect(describeTheme(theme, 'docx').chartOptions).toBe(true);
  });

  it('say nothing about chart options for a theme without them', () => {
    expect(
      describeTheme({ ...theme, componentDefaults: undefined }, 'docx')
        .chartOptions
    ).toBeUndefined();
  });
});

describe('design guide', () => {
  it('states that a theme carries Highcharts options in componentDefaults.highcharts.options', async () => {
    for (const format of ['docx', 'pptx'] as const) {
      const guide = await designGuide(format);
      expect(guide.markdown).toContain(
        '`componentDefaults.highcharts.options`'
      );
      expect(guide.markdown).toContain('`Highcharts.setOptions`');
    }
  });

  it('renders a theme line for the chart options', async () => {
    const guide = await designGuide('docx');
    const markdown = renderDesignGuide({
      ...guide,
      themes: [describeTheme(theme, 'docx')],
    });
    expect(markdown).toContain(
      'Chart options: the theme writes Highcharts options beneath every chart (`componentDefaults.highcharts.options`).'
    );
  });
});

describe('jto_describe_component', () => {
  let client: Client;

  beforeAll(async () => {
    const server = createServer(
      createToolDeps({ serverVersion: '9.9.9-test' })
    );
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: 'test-client', version: '1.0.0' });
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it.each([
    ['docx', 'docx'],
    ['pptx', 'pptx'],
  ])(
    'hands back the highcharts defaults under %s componentDefaults',
    async (format, name) => {
      const result = await client.callTool({
        name: 'jto_describe_component',
        arguments: { format, name, expandProps: ['componentDefaults'] },
      });
      const schema = (result.structuredContent as { schema: any }).schema;
      const highcharts =
        schema.properties.props.properties.componentDefaults.properties
          .highcharts;
      expect(Object.keys(highcharts.properties)).toContain('options');
      expect(Object.keys(highcharts.properties)).not.toContain('byType');
      expect(Object.keys(highcharts.properties)).not.toContain('callbacks');
      expect(highcharts.properties.options.description).toContain(
        'Highcharts.setOptions'
      );
    }
  );
});
