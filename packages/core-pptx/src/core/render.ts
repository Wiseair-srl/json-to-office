/**
 * Render Pipeline
 * Internal model -> pptxgenjs calls
 */

import PptxGenJS from 'pptxgenjs';
import type { ProcessedPresentation } from '../types';
import { renderComponent } from '../components';
import { resolveComponentGridPosition } from './grid';
import { toHex } from '../utils/color';

export function renderPresentation(
  processed: ProcessedPresentation
): PptxGenJS {
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

  // Render each slide
  for (const slideData of processed.slides) {
    const slide = pptx.addSlide();

    // Apply slide background
    if (slideData.background) {
      if (slideData.background.color) {
        slide.background = { color: toHex(slideData.background.color) };
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

    // Render components (resolve grid positions first)
    for (const component of slideData.components) {
      const resolved = resolveComponentGridPosition(
        component,
        processed.theme.grid,
        processed.slideWidth,
        processed.slideHeight
      );
      renderComponent(slide, resolved, processed.theme, pptx);
    }

    // Add speaker notes
    if (slideData.notes) {
      slide.addNotes(slideData.notes);
    }
  }

  return pptx;
}
