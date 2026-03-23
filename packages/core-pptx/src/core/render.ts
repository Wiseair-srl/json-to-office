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
      const masterProps = buildSlideMasterProps(masterDef, processed.theme);
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
    if (slideData.master && !masterDef) {
      console.warn(`Unknown master "${slideData.master}". Available: ${[...masterMap.keys()].join(', ')}`);
    }
    const effectiveGrid = mergeGridConfigs(processed.grid, masterDef?.grid);

    // Render master fixed objects (grid already resolved in structure.ts)
    if (masterDef?.objects) {
      for (const obj of masterDef.objects) {
        await renderComponent(slide, obj, processed.theme, pptx);
      }
    }

    // Render slide components (resolve grid positions first)
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
      const phMap = new Map(masterDef.placeholders?.map(p => [p.name, p]) ?? []);

      for (const [phName, component] of Object.entries(slideData.placeholders)) {
        const phDef = phMap.get(phName);
        if (!phDef) {
          console.warn(`Unknown placeholder "${phName}" in master "${slideData.master}". Available: ${[...phMap.keys()].join(', ')}`);
          continue;
        }

        const gridResolved = resolveComponentGridPosition(
          component, effectiveGrid,
          processed.slideWidth, processed.slideHeight
        );

        // Position from placeholder, then defaults props, then component props (most specific wins)
        const posDefaults: Record<string, any> = {};
        if (phDef.x != null) posDefaults.x = phDef.x;
        if (phDef.y != null) posDefaults.y = phDef.y;
        if (phDef.w != null) posDefaults.w = phDef.w;
        if (phDef.h != null) posDefaults.h = phDef.h;

        const props = { ...posDefaults, ...(phDef.defaults?.props ?? {}), ...gridResolved.props };
        await renderComponent(slide, { ...gridResolved, props }, processed.theme, pptx);
      }
    }

    // Add speaker notes
    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }
  }

  return pptx;
}
