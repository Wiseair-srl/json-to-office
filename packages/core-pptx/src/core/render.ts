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
        masterDef, processed.theme, processed.grid,
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

    // Determine effective grid for this slide (master grid merged with presentation grid)
    const masterDef = slideData.master ? masterMap.get(slideData.master) : undefined;
    const effectiveGrid = mergeGridConfigs(processed.grid, masterDef?.grid);

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
          const gridResolved = resolveComponentGridPosition(
            component, effectiveGrid,
            processed.slideWidth, processed.slideHeight
          );
          // Shallow-copy scalar props so we never mutate the original input document
          // (only scalar assignments below — deep copy not needed)
          const props = { ...gridResolved.props };
          // Inherit placeholder bounds as position defaults
          if (props.x == null && phDef.x != null) props.x = phDef.x;
          if (props.y == null && phDef.y != null) props.y = phDef.y;
          if (props.w == null && phDef.w != null) props.w = phDef.w;
          if (props.h == null && phDef.h != null) props.h = phDef.h;
          // Inherit placeholder explicit props
          if (props.fontSize == null && phDef.fontSize) props.fontSize = phDef.fontSize;
          if (props.fontFace == null && phDef.fontFace) props.fontFace = phDef.fontFace;
          if (props.color == null && phDef.color) props.color = phDef.color;
          if (props.bold == null && phDef.bold != null) props.bold = phDef.bold;
          if (props.italic == null && phDef.italic != null) props.italic = phDef.italic;
          if (props.align == null && phDef.align) props.align = phDef.align;
          if (props.valign == null && phDef.valign) props.valign = phDef.valign;
          if (props.margin == null && phDef.margin !== undefined) props.margin = phDef.margin;
          if (props.charSpacing == null && phDef.charSpacing !== undefined) props.charSpacing = phDef.charSpacing;
          if (props.lineSpacing == null && phDef.lineSpacing !== undefined) props.lineSpacing = phDef.lineSpacing;
          // Propagate placeholder style name so component renderers get heading font auto-selection
          if (props.style == null && phDef.style) props.style = phDef.style;
          const resolved = { ...gridResolved, props };
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
