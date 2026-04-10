/**
 * Render Pipeline
 * Internal model -> pptxgenjs calls
 */

import PptxGenJS from 'pptxgenjs';
import type {
  ProcessedPresentation,
  PipelineWarning,
  SlideContext,
} from '../types';
import { renderComponent } from '../components';
import { resolveComponentGridPosition, mergeGridConfigs } from './grid';
import { resolveColor } from '../utils/color';
import { warn, W } from '../utils/warn';
import { buildSlideTemplateProps } from './template';
import { getDefaultsForType } from '../utils/componentDefaults';
import { resolveComponentDefaults } from '../utils/resolveComponentTree';
import { mergeWithDefaults } from '@json-to-office/shared';

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

  // Register template slides
  const templateMap = new Map(
    processed.templates?.map((m) => [m.name, m]) ?? []
  );
  if (processed.templates) {
    for (const templateDef of processed.templates) {
      const templateProps = buildSlideTemplateProps(
        templateDef,
        processed.theme,
        warnings
      );
      pptx.defineSlideMaster(templateProps as any);
    }
  }

  // Render each slide
  const totalSlides = processed.slides.length;
  for (let slideIdx = 0; slideIdx < totalSlides; slideIdx++) {
    const slideData = processed.slides[slideIdx];
    const slideCtx: SlideContext = {
      slideNumber: slideIdx + 1,
      totalSlides,
      pageNumberFormat: processed.pageNumberFormat,
    };
    const slide = slideData.template
      ? pptx.addSlide({ masterName: slideData.template })
      : pptx.addSlide();

    // Apply slide background
    if (slideData.background) {
      if (slideData.background.color) {
        slide.background = {
          color: resolveColor(
            slideData.background.color,
            processed.theme,
            warnings
          ),
        };
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

    // Determine effective grid for this slide (template grid merged with presentation grid)
    const templateDef = slideData.template
      ? templateMap.get(slideData.template)
      : undefined;
    if (slideData.template && !templateDef) {
      warn(
        warnings,
        W.MISSING_TEMPLATE,
        `Unknown template "${slideData.template}". Available: ${[...templateMap.keys()].join(', ')}`,
        { slide: slideIdx }
      );
    }
    const effectiveGrid = mergeGridConfigs(processed.grid, templateDef?.grid);

    // Render template fixed objects (grid already resolved in structure.ts)
    if (templateDef?.objects) {
      for (const obj of templateDef.objects) {
        await renderComponent(
          slide,
          obj,
          processed.theme,
          pptx,
          warnings,
          slideCtx,
          processed.services
        );
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
      await renderComponent(
        slide,
        resolved,
        processed.theme,
        pptx,
        warnings,
        slideCtx,
        processed.services
      );
    }

    // Render placeholder content
    if (slideData.placeholders) {
      if (templateDef) {
        const phMap = new Map(
          templateDef.placeholders?.map((p) => [p.name, p]) ?? []
        );

        for (const [phName, component] of Object.entries(
          slideData.placeholders
        )) {
          const phDef = phMap.get(phName);
          if (!phDef) {
            warn(
              warnings,
              W.UNKNOWN_PLACEHOLDER,
              `Unknown placeholder "${phName}" in template "${slideData.template}". Available: ${[...phMap.keys()].join(', ')}`,
              { slide: slideIdx }
            );
            continue;
          }

          const gridResolved = resolveComponentGridPosition(
            component,
            effectiveGrid,
            processed.slideWidth,
            processed.slideHeight,
            warnings
          );

          // Precedence: componentDefaults < phDef position < phDef defaults < component props
          const typeDefaults = getDefaultsForType(
            component.name,
            processed.theme
          );
          const posDefaults: Record<string, any> = {};
          if (phDef.x != null) posDefaults.x = phDef.x;
          if (phDef.y != null) posDefaults.y = phDef.y;
          if (phDef.w != null) posDefaults.w = phDef.w;
          if (phDef.h != null) posDefaults.h = phDef.h;

          let props = mergeWithDefaults(posDefaults, typeDefaults);
          props = mergeWithDefaults(phDef.defaults?.props ?? {}, props);
          props = mergeWithDefaults(gridResolved.props, props);
          await renderComponent(
            slide,
            { ...gridResolved, props },
            processed.theme,
            pptx,
            warnings,
            slideCtx,
            processed.services
          );
        }
      } else {
        // No template found — render placeholders at their own positions if available
        for (const [phName, component] of Object.entries(
          slideData.placeholders
        )) {
          const defaulted = resolveComponentDefaults(
            component,
            processed.theme
          );
          const hasPosition =
            defaulted.props.x != null ||
            defaulted.props.y != null ||
            defaulted.props.grid;
          if (hasPosition) {
            const resolved = resolveComponentGridPosition(
              defaulted,
              effectiveGrid,
              processed.slideWidth,
              processed.slideHeight,
              warnings
            );
            await renderComponent(
              slide,
              resolved,
              processed.theme,
              pptx,
              warnings,
              slideCtx,
              processed.services
            );
          } else {
            warn(
              warnings,
              W.PLACEHOLDER_NO_POSITION,
              `Placeholder "${phName}" has no template and no explicit position — skipped`,
              { slide: slideIdx }
            );
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
