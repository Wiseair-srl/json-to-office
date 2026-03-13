/**
 * Render Pipeline
 * Internal model -> pptxgenjs calls
 */

import PptxGenJS from 'pptxgenjs';
import type { ProcessedPresentation } from '../types';
import { renderComponent } from '../components';
import { resolveComponentGridPosition, mergeGridConfigs } from './grid';
import { resolveColor } from '../utils/color';
import { buildSlideMasterProps } from './master';

export async function renderPresentation(
  processed: ProcessedPresentation
): Promise<PptxGenJS> {
  const pptx = new PptxGenJS();

  // Set presentation metadata
  if (processed.metadata.title) pptx.title = processed.metadata.title;
  if (processed.metadata.author) pptx.author = processed.metadata.author;
  if (processed.metadata.subject) pptx.subject = processed.metadata.subject;
  if (processed.metadata.company) pptx.company = processed.metadata.company;

  // Set layout dimensions
  pptx.defineLayout({
    name: 'CUSTOM',
    width: processed.slideWidth,
    height: processed.slideHeight,
  });
  pptx.layout = 'CUSTOM';

  // Set RTL mode
  if (processed.rtlMode) {
    pptx.rtlMode = true;
  }

  // Set theme fonts
  pptx.theme = {
    headFontFace: processed.theme.fonts.heading,
    bodyFontFace: processed.theme.fonts.body,
  };

  // Register master slides
  const masterMap = new Map(processed.masters?.map(m => [m.name, m]) ?? []);
  if (processed.masters) {
    for (const masterDef of processed.masters) {
      const masterProps = buildSlideMasterProps(
        masterDef, processed.theme, processed.theme.grid,
        processed.slideWidth, processed.slideHeight
      );
      pptx.defineSlideMaster(masterProps as any);
    }
  }

  // Render each slide
  for (const slideData of processed.slides) {
    const slide = slideData.master
      ? pptx.addSlide({ masterName: slideData.master })
      : pptx.addSlide();

    // Apply slide background
    if (slideData.background) {
      if (slideData.background.color) {
        slide.background = { color: resolveColor(slideData.background.color, processed.theme) };
      } else if (slideData.background.image) {
        if (slideData.background.image.path) {
          slide.background = { path: slideData.background.image.path };
        } else if (slideData.background.image.base64) {
          slide.background = { data: slideData.background.image.base64 };
        }
      }
    }

    // Apply hidden flag
    if (slideData.hidden) {
      slide.hidden = true;
    }

    // Determine effective grid for this slide (master grid merged with theme grid)
    const masterDef = slideData.master ? masterMap.get(slideData.master) : undefined;
    const effectiveGrid = mergeGridConfigs(processed.theme.grid, masterDef?.grid);

    // Render components (resolve grid positions first)
    for (const component of slideData.components) {
      const resolved = resolveComponentGridPosition(
        component,
        effectiveGrid,
        processed.slideWidth,
        processed.slideHeight
      );
      await renderComponent(slide, resolved, processed.theme, pptx);
    }

    // Render placeholder content
    if (slideData.placeholders && masterDef) {
      for (const [phName, components] of Object.entries(slideData.placeholders)) {
        const phDef = masterDef.placeholders?.find(p => p.name === phName);
        if (!phDef) { console.warn(`Unknown placeholder: ${phName}`); continue; }
        for (const component of components) {
          const resolved = resolveComponentGridPosition(
            component, effectiveGrid,
            processed.slideWidth, processed.slideHeight
          );
          // Inherit placeholder bounds as position defaults
          if (resolved.props.x == null && phDef.x != null) resolved.props.x = phDef.x;
          if (resolved.props.y == null && phDef.y != null) resolved.props.y = phDef.y;
          if (resolved.props.w == null && phDef.w != null) resolved.props.w = phDef.w;
          if (resolved.props.h == null && phDef.h != null) resolved.props.h = phDef.h;
          // Inherit placeholder text defaults
          if (resolved.props.fontSize == null && phDef.fontSize) resolved.props.fontSize = phDef.fontSize;
          if (resolved.props.fontFace == null && phDef.fontFace) resolved.props.fontFace = phDef.fontFace;
          if (resolved.props.color == null && phDef.color) resolved.props.color = phDef.color;
          // Inherit placeholder alignment
          if (resolved.props.align == null && phDef.align) resolved.props.align = phDef.align;
          if (resolved.props.valign == null && phDef.valign) resolved.props.valign = phDef.valign;
          if (resolved.props.margin == null && phDef.margin !== undefined) resolved.props.margin = phDef.margin;
          await renderComponent(slide, resolved, processed.theme, pptx);
        }
      }
    }

    // Add speaker notes
    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }
  }

  return pptx;
}
