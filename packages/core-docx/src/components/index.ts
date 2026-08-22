/**
 * Components with behaviour of their own.
 *
 * Not a renderer registry: the DocxIR compiler knows every standard component
 * by name. What is left here is the two components that need an external
 * service before they can become anything — a `visual` and a `highcharts`, both
 * of which desugar to an image — and the bundled custom component.
 */

export {
  buildVisualPresentation,
  defaultVisualWidthPx,
  effectiveVisualServerUrl,
  rasterizeVisualSlide,
  visualRasterKey,
  visualToImageOptions,
  visualToImageProps,
  type ImageOptions,
} from './visual';

export {
  renderChartToImageProps,
  type ChartGenerationResult,
  type HighchartsProps,
} from './highcharts';

export { textSpaceAfterComponent } from './text-space-after';
