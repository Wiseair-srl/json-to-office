/**
 * `resolveHighchartsOptions` is the request the render posts, not a model of
 * it: for the same node, theme and document, its output is the `infile` the
 * export server receives, and `resolveHighchartsRequest` is the whole body.
 *
 * The render does not post under the theme it was handed — the design
 * system, the document's overrides and defaults, the font mode and the
 * section's page all reach the chart first — so each of those is compared
 * here against what was actually posted.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resetChartLimiters,
  type FontRuntimeOpts,
} from '@json-to-office/shared';
import { createDocumentGenerator } from '../../plugin/createDocumentGenerator';
import { themes } from '../../styles';
import { minimalTheme } from '../../templates/themes';
import type { ThemeConfig } from '../../styles';
import {
  resolveHighchartsOptions,
  resolveHighchartsRequest,
  type ResolveHighchartsOptionsInput,
} from '../highchartsOptions';

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

/** A theme that states Highcharts presets of its own. */
const presetTheme: ThemeConfig = {
  ...minimalTheme,
  componentDefaults: {
    ...minimalTheme.componentDefaults,
    highcharts: {
      options: {
        credits: { enabled: false },
        legend: { align: 'right', verticalAlign: 'top' },
        plotOptions: {
          column: { borderRadius: 3, dataLabels: { enabled: true } },
        },
      },
    },
  } as ThemeConfig['componentDefaults'],
};

const chartProps = {
  options: {
    chart: { type: 'column', width: 800, height: 400 },
    title: { text: 'Modal split' },
    xAxis: { categories: ['Car', 'Bus', 'Bike'] },
    legend: { align: 'center' },
    series: [{ type: 'column', name: 'Share', data: [62, 21, 17] }],
  },
  width: '80%',
  scale: 2,
};

const mockFetch = vi.fn();

beforeEach(() => {
  resetChartLimiters();
  mockFetch.mockReset();
  mockFetch.mockImplementation(async () => ({
    ok: true,
    text: async () => PNG_BASE64,
  }));
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Scenario {
  theme: ThemeConfig;
  props?: Record<string, unknown>;
  documentProps?: ResolveHighchartsOptionsInput['documentProps'];
  page?: ResolveHighchartsOptionsInput['page'];
  fonts?: FontRuntimeOpts;
}

/** Render one chart and return the body the export server received. */
async function postedBody({
  theme,
  props = chartProps,
  documentProps = {},
  page,
  fonts,
}: Scenario): Promise<any> {
  const generator = createDocumentGenerator({
    theme,
    ...(fonts ? { fonts } : {}),
  });
  await generator.generateBuffer({
    name: 'docx',
    props: documentProps,
    children: [
      {
        name: 'section',
        props: page ? { page } : {},
        children: [{ name: 'highcharts', props }],
      },
    ],
  } as never);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  return JSON.parse(mockFetch.mock.calls[0][1].body as string);
}

function resolvedFor({
  theme,
  props = chartProps,
  documentProps,
  page,
  fonts,
}: Scenario): ResolveHighchartsOptionsInput {
  return {
    ...(props as typeof chartProps),
    theme,
    ...(documentProps && { documentProps }),
    ...(page && { page }),
    ...(fonts && { fonts }),
  };
}

/** What JSON makes of a value — the form it reaches the server in. */
const posted = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('resolveHighchartsOptions', { timeout: 60_000 }, () => {
  it.each(Object.keys(themes))(
    'returns the options the render posts under the built-in %s theme',
    async (name) => {
      const scenario = { theme: themes[name as keyof typeof themes] };
      const body = await postedBody(scenario);
      expect(posted(resolveHighchartsOptions(resolvedFor(scenario)))).toEqual(
        body.infile
      );
    }
  );

  it('writes the theme presets beneath the node options, as the render does', async () => {
    const scenario = { theme: presetTheme };
    const body = await postedBody(scenario);
    expect(posted(resolveHighchartsOptions(resolvedFor(scenario)))).toEqual(
      body.infile
    );
    // The node's legend alignment wins; the rest of the theme's legend fills in.
    expect(body.infile.credits).toMatchObject({ enabled: false });
    expect(body.infile.legend).toMatchObject({
      align: 'center',
      verticalAlign: 'top',
    });
    expect(body.infile.plotOptions.column).toMatchObject({ borderRadius: 3 });
  });

  it("follows the document's componentDefaults and themeOverrides", async () => {
    const scenario: Scenario = {
      theme: themes.consulting,
      documentProps: {
        componentDefaults: {
          highcharts: {
            options: { chart: { backgroundColor: 'transparent' } },
          },
        },
        themeOverrides: { fonts: { body: { family: 'Georgia' } } },
      } as never,
    };
    const body = await postedBody(scenario);
    const resolved = resolveHighchartsOptions(resolvedFor(scenario));
    expect(posted(resolved)).toEqual(body.infile);
    expect(body.infile.chart.backgroundColor).toBe('transparent');
  });

  it("resolves a percentage width against the section's own page", async () => {
    const scenario: Scenario = {
      theme: themes.vermilion,
      page: { size: 'A3', margins: { left: 720, right: 720 } },
    };
    const body = await postedBody(scenario);
    expect(posted(resolveHighchartsOptions(resolvedFor(scenario)))).toEqual(
      body.infile
    );
    const withoutPage = resolveHighchartsOptions(
      resolvedFor({ theme: themes.vermilion })
    );
    expect(posted(withoutPage)).not.toEqual(body.infile);
  });

  it('follows the font export mode', async () => {
    // Families no reader is sure to have, which `substitute` rewrites.
    const theme: ThemeConfig = {
      ...minimalTheme,
      fonts: {
        ...minimalTheme.fonts,
        body: { ...minimalTheme.fonts.body, family: 'Inter' },
        heading: { ...minimalTheme.fonts.heading, family: 'Montserrat' },
      },
    };
    const scenario: Scenario = { theme, fonts: { mode: 'substitute' } };
    const body = await postedBody(scenario);
    expect(posted(resolveHighchartsOptions(resolvedFor(scenario)))).toEqual(
      body.infile
    );
    expect(body.infile.chart.style.fontFamily).not.toContain('Inter');
  });

  it('scales the type with the width the chart is placed at', async () => {
    const scenario: Scenario = {
      theme: themes.consulting,
      props: { ...chartProps, width: 200 },
    };
    const body = await postedBody(scenario);
    const resolved = resolveHighchartsOptions(resolvedFor(scenario));
    expect(posted(resolved)).toEqual(body.infile);
    expect(resolved).not.toEqual(
      resolveHighchartsOptions(resolvedFor({ theme: themes.consulting }))
    );
  });

  it('returns the whole request the render posts', async () => {
    const scenario = { theme: presetTheme };
    const body = await postedBody(scenario);
    expect(posted(resolveHighchartsRequest(resolvedFor(scenario)))).toEqual(
      body
    );
  });

  it('is pure: it posts nothing and leaves its input alone', () => {
    const input = structuredClone(chartProps);
    resolveHighchartsOptions({ ...input, theme: themes.consulting });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(input).toEqual(chartProps);
  });
});
