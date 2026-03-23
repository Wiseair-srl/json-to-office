/**
 * PPTX Component Renderers
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig, PptxComponentInput, PipelineWarning, SlideContext } from '../types';
import { warn, W } from '../utils/warn';
import { renderTextComponent } from './text';
import { renderImageComponent } from './image';
import { renderShapeComponent } from './shape';
import { renderTableComponent } from './table';
import { renderHighchartsComponent } from './highcharts';
import { renderChartComponent } from './chart';

export { renderTextComponent } from './text';
export { renderImageComponent } from './image';
export { renderShapeComponent } from './shape';
export { renderTableComponent } from './table';
export { renderHighchartsComponent } from './highcharts';
export { renderChartComponent } from './chart';

export async function renderComponent(
  slide: PptxGenJS.Slide,
  component: PptxComponentInput,
  theme: PptxThemeConfig,
  pptx: PptxGenJS,
  warnings?: PipelineWarning[],
  slideCtx?: SlideContext
): Promise<void> {
  if (component.enabled === false) return;

  const { name, props } = component;
  const p = props as any;

  switch (name) {
  case 'text':
    renderTextComponent(slide, p, theme, warnings, slideCtx);
    break;
  case 'image':
    renderImageComponent(slide, p, theme, warnings);
    break;
  case 'shape':
    renderShapeComponent(slide, p, theme, pptx, warnings);
    break;
  case 'table':
    renderTableComponent(slide, p, theme, pptx, warnings);
    break;
  case 'highcharts':
    await renderHighchartsComponent(slide, p, theme, warnings);
    break;
  case 'chart':
    renderChartComponent(slide, p, theme, pptx, warnings);
    break;
  default:
    warn(warnings, W.UNKNOWN_COMPONENT, `Unknown PPTX component type: ${name}`, { component: name });
  }
}
