/**
 * Highcharts → image, before compilation.
 *
 * A `highcharts` component is authoring sugar: it describes a chart that an
 * export server renders to a PNG. That fetch is I/O, and the result is just an
 * image, so it is resolved here — an authoring-only expansion — rather than in
 * the compiler or an adapter. By the time PptxIR exists there is no chart
 * service left to depend on.
 *
 * This mirrors how the DOCX pipeline pre-rasterizes `visual` components.
 */

import type { HighchartsServiceConfig } from '@json-to-office/shared';
import type { PptxHighchartsProps } from '@json-to-office/shared-pptx';
import type {
  PipelineWarning,
  PptxComponentInput,
  PptxThemeConfig,
  ProcessedPresentation,
} from '../types';
import { definedChartColorTokens, resolveColor } from '../utils/color';
import { isNodeEnvironment } from '../utils/environment';

/** Screen pixels per inch, the unit the export server reports sizes in. */
const PX_PER_INCH = 96;
const DEFAULT_EXPORT_SERVER_URL = 'http://localhost:7801';

export interface HighchartsExpansionResult {
  presentation: ProcessedPresentation;
  /**
   * Highcharts components this pass did not reach.
   *
   * Placeholder content is merged with its declaration during compilation, so
   * expanding it here would use pre-merge dimensions. Rather than render a
   * chart at the wrong size, those are reported and the caller refuses.
   */
  unexpanded: Array<{ name: string; path: string }>;
}

/**
 * Replace every `highcharts` component with the `image` it renders to.
 *
 * Slide components and template objects are expanded in place. The presentation
 * is copied rather than mutated so a caller's tree is never altered.
 */
export async function expandHighchartsComponents(
  presentation: ProcessedPresentation,
  services: HighchartsServiceConfig | undefined,
  warnings: PipelineWarning[]
): Promise<HighchartsExpansionResult> {
  const unexpanded: HighchartsExpansionResult['unexpanded'] = [];

  const templates = presentation.templates
    ? await Promise.all(
        presentation.templates.map(async (template, index) => ({
          ...template,
          objects: template.objects
            ? await expandList(
                template.objects,
                `masters[${index}].elements`,
                presentation.theme,
                services,
                warnings
              )
            : template.objects,
        }))
      )
    : presentation.templates;

  const slides = await Promise.all(
    presentation.slides.map(async (slide, index) => {
      for (const [name, component] of Object.entries(
        slide.placeholders ?? {}
      )) {
        if (component.name === 'highcharts') {
          unexpanded.push({
            name: 'highcharts',
            path: `slides[${index}].placeholders.${name}`,
          });
        }
      }
      return {
        ...slide,
        components: await expandList(
          slide.components,
          `slides[${index}].elements`,
          presentation.theme,
          services,
          warnings
        ),
      };
    })
  );

  return {
    presentation: { ...presentation, slides, templates },
    unexpanded,
  };
}

async function expandList(
  components: PptxComponentInput[],
  path: string,
  theme: PptxThemeConfig,
  services: HighchartsServiceConfig | undefined,
  warnings: PipelineWarning[]
): Promise<PptxComponentInput[]> {
  const out: PptxComponentInput[] = [];
  for (const [index, component] of components.entries()) {
    out.push(
      component.name === 'highcharts'
        ? await expandOne(
            component,
            `${path}[${index}]`,
            theme,
            services,
            warnings
          )
        : component
    );
  }
  return out;
}

async function expandOne(
  component: PptxComponentInput,
  path: string,
  theme: PptxThemeConfig,
  services: HighchartsServiceConfig | undefined,
  warnings: PipelineWarning[]
): Promise<PptxComponentInput> {
  const props = component.props as unknown as PptxHighchartsProps;
  const chart = await renderChart(
    withThemeColors(props, theme, warnings),
    services
  );

  void path;
  return {
    ...component,
    name: 'image',
    props: {
      base64: chart.dataUri,
      x: props.x ?? 0,
      y: props.y ?? 0,
      w: props.w ?? chart.widthPx / PX_PER_INCH,
      h: props.h ?? chart.heightPx / PX_PER_INCH,
    },
  };
}

interface RenderedChart {
  dataUri: string;
  widthPx: number;
  heightPx: number;
}

async function renderChart(
  config: PptxHighchartsProps,
  services: HighchartsServiceConfig | undefined
): Promise<RenderedChart> {
  if (!isNodeEnvironment()) {
    throw new Error(
      'Highcharts export server requires a Node.js environment. ' +
        'Chart generation is not available in browser environments.'
    );
  }

  const serverUrl = exportServerUrl(config.serverUrl, services?.serverUrl);
  const requestBody = {
    infile: config.options,
    type: 'png',
    b64: true,
    scale: config.scale,
    // Forwarded verbatim only when present, so the payload stays byte-identical
    // for callers that omit it.
    ...(config.resources ? { resources: config.resources } : {}),
  };

  const resolvedHeaders =
    typeof services?.headers === 'function'
      ? await services.headers(requestBody)
      : services?.headers;

  const response = await fetch(`${serverUrl}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...resolvedHeaders },
    body: JSON.stringify(requestBody),
  }).catch((error) => {
    throw new Error(
      `Highcharts Export Server is not running at ${serverUrl}. ` +
        'Start it with: npx highcharts-export-server --enableServer true\n' +
        `Cause: ${error instanceof Error ? error.message : String(error)}`
    );
  });

  if (!response.ok) {
    throw new Error(
      `Highcharts export server returned ${response.status}: ${response.statusText}`
    );
  }

  return {
    dataUri: `data:image/png;base64,${await response.text()}`,
    widthPx: config.options.chart?.width ?? 960,
    heightPx: config.options.chart?.height ?? 720,
  };
}

function exportServerUrl(propsUrl?: string, servicesUrl?: string): string {
  const raw = propsUrl || servicesUrl || DEFAULT_EXPORT_SERVER_URL;
  return raw.startsWith('http') ? raw : `http://${raw}`;
}

/**
 * Inject the theme's chart palette when the config sets no top-level `colors`.
 *
 * Without it, series render in the Highcharts default palette and ignore the
 * document theme. Slots the theme leaves unset are skipped — the same rule the
 * native chart component and DOCX both follow — so the palette never repeats
 * `primary`. An explicit `colors` always wins.
 */
function withThemeColors(
  props: PptxHighchartsProps,
  theme: PptxThemeConfig,
  warnings: PipelineWarning[]
): PptxHighchartsProps {
  if (!props.options || props.options.colors || !theme?.colors) return props;
  const palette = definedChartColorTokens(theme).map(
    (token) => `#${resolveColor(token, theme, warnings)}`
  );
  if (palette.length === 0) return props;
  return { ...props, options: { ...props.options, colors: palette } };
}
