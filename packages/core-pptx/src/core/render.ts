/**
 * Render Pipeline
 * Internal model -> pptxgenjs calls
 */

import PptxGenJS from 'pptxgenjs';
import type { ProcessedPresentation, PipelineWarning } from '../types';
import { renderComponent } from '../components';
import { resolveComponentGridPosition, mergeGridConfigs } from './grid';
import { resolveColor } from '../utils/color';
import { warn, W } from '../utils/warn';
import { buildSlideMasterProps } from './master';

export async function renderPresentation(
  processed: ProcessedPresentation,
  warnings?: PipelineWarning[]
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
      const masterProps = buildSlideMasterProps(masterDef, processed.theme, warnings);
      pptx.defineSlideMaster(masterProps as any);
    }
  }

  // Render each slide
  for (let slideIdx = 0; slideIdx < processed.slides.length; slideIdx++) {
    const slideData = processed.slides[slideIdx];
    const slide = slideData.master
      ? pptx.addSlide({ masterName: slideData.master })
      : pptx.addSlide();

    // Apply slide background
    if (slideData.background) {
      if (slideData.background.color) {
        slide.background = { color: resolveColor(slideData.background.color, processed.theme, warnings) };
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
      warn(warnings, W.MISSING_MASTER, `Unknown master "${slideData.master}". Available: ${[...masterMap.keys()].join(', ')}`, { slide: slideIdx });
    }
    const effectiveGrid = mergeGridConfigs(processed.grid, masterDef?.grid);

    // Render master fixed objects (grid already resolved in structure.ts)
    if (masterDef?.objects) {
      for (const obj of masterDef.objects) {
        await renderComponent(slide, obj, processed.theme, pptx, warnings);
      }
    }

    // Render slide components (resolve grid positions first)
    for (const component of slideData.components) {
      const resolved = resolveComponentGridPosition(
        component,
        effectiveGrid,
        processed.slideWidth,
        processed.slideHeight,
        warnings
      );
      await renderComponent(slide, resolved, processed.theme, pptx, warnings);
    }

    // Render placeholder content
    if (slideData.placeholders) {
      if (masterDef) {
        const phMap = new Map(masterDef.placeholders?.map(p => [p.name, p]) ?? []);

        for (const [phName, component] of Object.entries(slideData.placeholders)) {
          const phDef = phMap.get(phName);
          if (!phDef) {
            warn(warnings, W.UNKNOWN_PLACEHOLDER, `Unknown placeholder "${phName}" in master "${slideData.master}". Available: ${[...phMap.keys()].join(', ')}`, { slide: slideIdx });
            continue;
          }

          const gridResolved = resolveComponentGridPosition(
            component, effectiveGrid,
            processed.slideWidth, processed.slideHeight, warnings
          );

          // Position from placeholder, then defaults props, then component props (most specific wins)
          const posDefaults: Record<string, any> = {};
          if (phDef.x != null) posDefaults.x = phDef.x;
          if (phDef.y != null) posDefaults.y = phDef.y;
          if (phDef.w != null) posDefaults.w = phDef.w;
          if (phDef.h != null) posDefaults.h = phDef.h;

          const props = { ...posDefaults, ...(phDef.defaults?.props ?? {}), ...gridResolved.props };
          await renderComponent(slide, { ...gridResolved, props }, processed.theme, pptx, warnings);
        }
      } else {
        // No master found — render placeholders at their own positions if available
        for (const [phName, component] of Object.entries(slideData.placeholders)) {
          const hasPosition = component.props.x != null || component.props.y != null || component.props.grid;
          if (hasPosition) {
            const resolved = resolveComponentGridPosition(
              component, effectiveGrid,
              processed.slideWidth, processed.slideHeight, warnings
            );
            await renderComponent(slide, resolved, processed.theme, pptx, warnings);
          } else {
            warn(warnings, W.PLACEHOLDER_NO_POSITION, `Placeholder "${phName}" has no master and no explicit position — skipped`, { slide: slideIdx });
          }
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
