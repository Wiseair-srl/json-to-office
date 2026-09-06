/**
 * Turn components that need an external service into plain `image` components,
 * before anything else looks at the document.
 *
 * A `visual` is a nested presentation rendered by LibreOffice; a `highcharts`
 * is a chart rendered by an export server. Both end up as a PNG in the package,
 * and neither has an OOXML form of its own — so rather than teaching the
 * compiler about services, they are desugared here and the compiler only ever
 * sees an image.
 *
 * That keeps compilation a pure function of the document. Everything that can
 * fail, block on a network call or depend on a machine's LibreOffice happens in
 * this pass; what comes out is a document that builds anywhere.
 */

import {
  clampVisualDpi,
  DEFAULT_VISUAL_DPI,
  type RasterizeFontFace,
  type ServicesConfig,
  type GenerationWarning,
} from '@json-to-office/shared';
import {
  isNativeVisualProps,
  type VisualProps,
  type VisualRasterProps,
  type HighchartsProps,
} from '@json-to-office/shared-docx';
import type { ThemeConfig } from '../styles';
import {
  buildVisualPresentation,
  effectiveVisualServerUrl,
  rasterizeVisualSlide,
  visualRasterKey,
  visualToImageProps,
} from '../components/visual';
import { renderChartToImageProps } from '../components/highcharts';
import { prerasterizeVisuals } from './prerasterizeVisuals';
import { transformComponents, withNodeIdentity } from './componentTransform';

export interface DesugarExternalsOptions {
  theme: ThemeConfig;
  services?: ServicesConfig;
  /** Directory relative asset paths inside a visual resolve against. */
  baseDir?: string;
  /** Font faces staged for each visual's LibreOffice render. */
  visualFonts?: readonly RasterizeFontFace[];
  /** Font faces a chart's export server is handed as inline `@font-face`. */
  chartFonts?: readonly RasterizeFontFace[];
  /** Where a chart posted to a remote export server is reported. */
  warnings?: GenerationWarning[];
}

/**
 * Replace every `visual` and `highcharts` in `document` with its image.
 *
 * Visuals are rasterized in one batch first: the document walk is sequential,
 * and without the batch each visual would cost its own service round trip and
 * its own LibreOffice launch — about twenty-five of each for the bundled
 * templates. The batch is only an accelerator, though: anything it misses, or a
 * batch that fails outright, falls back to rasterizing that visual on its own.
 */
export async function desugarExternals<T>(
  document: T,
  options: DesugarExternalsOptions
): Promise<T> {
  const prerastered = await prerasterizeVisuals(
    document,
    options.services?.pptx,
    {
      ...(options.baseDir !== undefined ? { baseDir: options.baseDir } : {}),
      ...(options.visualFonts ? { fonts: options.visualFonts } : {}),
    }
  ).catch(() => new Map<string, never>());

  return transformComponents(document, async (node) => {
    // A disabled component is filtered out before it renders, so paying a
    // service call for it would be wasted work.
    if (node.enabled === false) return undefined;

    if (node.name === 'visual') {
      // A native visual has no external form to desugar into: the compiler
      // lowers it to a drawing group and the backend draws it. Leaving the
      // node in place is what keeps a native-only document from ever touching
      // `services.pptx`.
      if (isNativeVisualProps(node.props as VisualProps)) return undefined;
      return withNodeIdentity(node, {
        name: 'image',
        props: await visualImageProps(
          node.props as VisualRasterProps,
          prerastered,
          options
        ),
      });
    }

    if (node.name === 'highcharts') {
      return withNodeIdentity(node, {
        name: 'image',
        props: await renderChartToImageProps(
          node.props as HighchartsProps,
          options.theme,
          options.services?.highcharts,
          options.chartFonts,
          options.warnings
        ),
      });
    }

    return undefined;
  });
}

async function visualImageProps(
  props: VisualRasterProps,
  prerastered: ReadonlyMap<string, { ok: boolean }>,
  options: DesugarExternalsOptions
): Promise<Record<string, unknown>> {
  const serviceConfig = options.services?.pptx;
  const presentation = buildVisualPresentation(props);
  const dpi = clampVisualDpi(
    props.dpi ?? serviceConfig?.dpi ?? DEFAULT_VISUAL_DPI
  );

  // A hit uses the batch's pixels. A recorded per-visual failure surfaces here,
  // where the error is attributable to this component rather than to the batch.
  const hit = prerastered.get(
    visualRasterKey(
      presentation,
      dpi,
      effectiveVisualServerUrl(props, serviceConfig)
    )
  ) as
    | { ok: true; base64DataUri: string }
    | { ok: false; error: string }
    | undefined;

  if (hit) {
    if (!hit.ok) throw new Error(hit.error);
    return visualToImageProps(props, hit.base64DataUri);
  }

  // Relative asset paths inside the nested presentation must resolve against
  // the document's own directory: the rasterizer runs in another process, with
  // another working directory.
  const result = await rasterizeVisualSlide(
    presentation,
    dpi,
    props.serverUrl,
    serviceConfig,
    options.baseDir,
    options.visualFonts
  );
  return visualToImageProps(props, result.base64DataUri);
}
