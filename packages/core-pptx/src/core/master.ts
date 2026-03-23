/**
 * Master Slide Builder
 * Converts internal MasterSlideDefinition to pptxgenjs SlideMasterProps
 *
 * Fixed objects (shapes, text, images) are no longer rendered here — they use
 * the unified component pipeline and are rendered per-slide in render.ts.
 */

import type { MasterSlideDefinition, PptxThemeConfig, PipelineWarning } from '../types';
import { resolveColor } from '../utils/color';

export function buildSlideMasterProps(
  def: MasterSlideDefinition,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[]
): Record<string, any> {
  const result: Record<string, any> = { title: def.name };

  // Background
  if (def.background) {
    if (def.background.color) {
      result.background = { color: resolveColor(def.background.color, theme, warnings) };
    } else if (def.background.image) {
      if (def.background.image.path) {
        result.background = { path: def.background.image.path };
      } else if (def.background.image.base64) {
        result.background = { data: def.background.image.base64 };
      }
    }
  }

  // Margin
  if (def.margin !== undefined) result.margin = def.margin;

  // Slide number
  if (def.slideNumber) {
    result.slideNumber = {
      x: def.slideNumber.x,
      y: def.slideNumber.y,
    };
    if (def.slideNumber.w !== undefined) result.slideNumber.w = def.slideNumber.w;
    if (def.slideNumber.h !== undefined) result.slideNumber.h = def.slideNumber.h;
    if (def.slideNumber.color) result.slideNumber.color = resolveColor(def.slideNumber.color, theme, warnings);
    if (def.slideNumber.fontSize) result.slideNumber.fontSize = def.slideNumber.fontSize;
  }

  // Placeholders (registered in pptxgenjs master for OOXML placeholder support)
  const objects: Record<string, any>[] = [];

  if (def.placeholders) {
    for (const ph of def.placeholders) {
      const opts: Record<string, any> = { name: ph.name, type: 'body' };
      if (ph.x != null) opts.x = ph.x;
      if (ph.y != null) opts.y = ph.y;
      if (ph.w != null) opts.w = ph.w;
      if (ph.h != null) opts.h = ph.h;
      objects.push({ placeholder: { options: opts, text: '' } });
    }
  }

  if (objects.length > 0) result.objects = objects;

  return result;
}
