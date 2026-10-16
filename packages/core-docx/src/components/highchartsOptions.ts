/**
 * A `highcharts` node's effective options, without rendering it.
 *
 * The render does not post a chart under the theme it was handed. Before any
 * chart is drawn the theme goes through the generation prologue — the
 * document's `themeOverrides`, the design system's type roles materialized
 * into styles, the font export mode — then the document's
 * `componentDefaults`, and a top-level section with its own `page` narrows
 * the text width a percentage resolves against. Each of those changes what
 * the export server is asked for, so this module runs the very same
 * functions, in the same order, and then builds the request with the one the
 * render uses.
 */

import type { HighchartsProps } from '@json-to-office/shared-docx';
import type {
  FontRuntimeOpts,
  RasterizeFontFace,
} from '@json-to-office/shared';
import type { ThemeConfig } from '../styles';
import type { ReportComponentDefinition, ReportProps } from '../types';
import { resolveThemeContext } from '../core/generationContext';
import { resolveDocumentTree } from '../core/structure';
import {
  themeForSectionPage,
  type SectionPageOverride,
} from '../styles/utils/layoutUtils';
import {
  resolveChartRequest,
  type HighchartsExportRequest,
} from './highcharts';

export type { HighchartsExportRequest } from './highcharts';

/** What `resolveHighchartsOptions` and `resolveHighchartsRequest` read. */
export interface ResolveHighchartsOptionsInput {
  /** The node's `props.options`, as authored. */
  options: HighchartsProps['options'];
  /**
   * The theme the document renders with, as it is handed to the generator —
   * the `theme` or `customThemes` entry, or a built-in theme object. It is
   * resolved here exactly as generation resolves it.
   */
  theme: ThemeConfig;
  /** The node's `props.width`; the placed width scales the chart's type. */
  width?: HighchartsProps['width'];
  /** The node's `props.height`; it places the chart when `width` is absent. */
  height?: HighchartsProps['height'];
  /** The node's `props.scale`. */
  scale?: HighchartsProps['scale'];
  /** The node's `props.resources`. */
  resources?: HighchartsProps['resources'];
  /**
   * The document root's `props`, for the parts that reach a chart:
   * `themeOverrides` and `componentDefaults` (its `highcharts` presets merge
   * over the theme's).
   */
  documentProps?: Pick<ReportProps, 'themeOverrides' | 'componentDefaults'>;
  /**
   * `props.page` of the top-level section holding the chart, when it
   * overrides the page: a percentage `width` is of that page's text width.
   */
  page?: SectionPageOverride;
  /** The generator's `fonts` option; its export mode can rewrite families. */
  fonts?: FontRuntimeOpts;
  /**
   * The font faces the render hands the export server. They only add
   * `@font-face` rules to `resources.css`; the options never depend on them.
   */
  fontFaces?: readonly RasterizeFontFace[];
}

/**
 * The theme a chart is rendered with: the generation prologue, the document's
 * component defaults, then the section's page.
 */
function chartRenderTheme(input: ResolveHighchartsOptionsInput): ThemeConfig {
  const document = {
    name: 'docx',
    props: { ...input.documentProps },
    children: [],
  } as unknown as ReportComponentDefinition;
  const context = resolveThemeContext(document, {
    ...(input.fonts ? { fonts: input.fonts } : {}),
    warnings: [],
    resolveNamedTheme: () => input.theme,
  });
  const { theme } = resolveDocumentTree(context.document, context.theme);
  return themeForSectionPage(theme, input.page);
}

/**
 * The exact request the library posts to the export server for a `highcharts`
 * node with these props, in a document rendered with this theme. Pure: no
 * service is called.
 */
export function resolveHighchartsRequest(
  input: ResolveHighchartsOptionsInput
): HighchartsExportRequest {
  const props: HighchartsProps = {
    options: input.options,
    ...(input.width !== undefined && { width: input.width }),
    ...(input.height !== undefined && { height: input.height }),
    ...(input.scale !== undefined && { scale: input.scale }),
    ...(input.resources !== undefined && { resources: input.resources }),
  };
  return resolveChartRequest(props, chartRenderTheme(input), input.fontFaces);
}

/**
 * The effective Highcharts options of a `highcharts` node — exactly the
 * `infile` the library posts to the export server: the theme's (and the
 * document's) `componentDefaults.highcharts.options` beneath the node's own,
 * the theme's chart palette when the node sets no `colors`, and the
 * document's type at the size the chart is placed at. Pure: no service is
 * called.
 */
export function resolveHighchartsOptions(
  input: ResolveHighchartsOptionsInput
): HighchartsProps['options'] {
  return resolveHighchartsRequest(input).infile;
}
