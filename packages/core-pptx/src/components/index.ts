/**
 * PPTX Component Renderers
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig, PptxComponentInput } from '../types';
import { renderTextComponent } from './text';
import { renderImageComponent } from './image';
import { renderShapeComponent } from './shape';
import { renderTableComponent } from './table';

export { renderTextComponent } from './text';
export { renderImageComponent } from './image';
export { renderShapeComponent } from './shape';
export { renderTableComponent } from './table';

export function renderComponent(
  slide: PptxGenJS.Slide,
  component: PptxComponentInput,
  theme: PptxThemeConfig,
  pptx: PptxGenJS
): void {
  if (component.enabled === false) return;

  const { name, props } = component;
  const p = props as any;

  switch (name) {
  case 'text':
    renderTextComponent(slide, p, theme);
    break;
  case 'image':
    renderImageComponent(slide, p, theme);
    break;
  case 'shape':
    renderShapeComponent(slide, p, theme, pptx);
    break;
  case 'table':
    renderTableComponent(slide, p, theme);
    break;
  default:
    console.warn(`Unknown PPTX component type: ${name}`);
  }
}
