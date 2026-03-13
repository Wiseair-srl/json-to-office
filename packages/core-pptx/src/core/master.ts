/**
 * Master Slide Builder
 * Converts internal MasterSlideDefinition to pptxgenjs SlideMasterProps
 */

import type { MasterSlideDefinition, PptxThemeConfig, GridConfig } from '../types';
import { resolveGridPosition, mergeGridConfigs } from './grid';
import { resolveColor } from '../utils/color';

export function buildSlideMasterProps(
  def: MasterSlideDefinition,
  theme: PptxThemeConfig,
  gridConfig: GridConfig | undefined,
  slideW: number,
  slideH: number
): Record<string, any> {
  const effectiveGrid = mergeGridConfigs(gridConfig, def.grid);
  const result: Record<string, any> = { title: def.name };

  // Background
  if (def.background) {
    if (def.background.color) {
      result.background = { color: resolveColor(def.background.color, theme) };
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
    if (def.slideNumber.color) result.slideNumber.color = resolveColor(def.slideNumber.color, theme);
    if (def.slideNumber.fontSize) result.slideNumber.fontSize = def.slideNumber.fontSize;
  }

  // Objects array (fixed elements + placeholders)
  const objects: Record<string, any>[] = [];

  // Fixed objects (grid resolved here, not in structure.ts which only handles placeholders)
  if (def.objects) {
    for (const obj of def.objects) {
      if ('image' in obj) {
        const img = obj.image;
        let { x, y, w, h } = img;
        if (img.grid) {
          const g = resolveGridPosition(img.grid, effectiveGrid, slideW, slideH);
          if (x == null) x = g.x; if (y == null) y = g.y;
          if (w == null) w = g.w; if (h == null) h = g.h;
        }
        const entry: Record<string, any> = { x, y, w, h };
        if (img.path) entry.path = img.path;
        if (img.data) entry.data = img.data;
        objects.push({ image: entry });
      } else if ('text' in obj) {
        const txt = obj.text;
        let { x, y, w, h } = txt;
        if (txt.grid) {
          const g = resolveGridPosition(txt.grid, effectiveGrid, slideW, slideH);
          if (x == null) x = g.x; if (y == null) y = g.y;
          if (w == null) w = g.w; if (h == null) h = g.h;
        }
        const opts: Record<string, any> = { x, y, w, h };
        if (txt.fontSize) opts.fontSize = txt.fontSize;
        if (txt.fontFace) opts.fontFace = txt.fontFace;
        if (txt.color) opts.color = resolveColor(txt.color, theme);
        if (txt.bold) opts.bold = true;
        if (txt.italic) opts.italic = true;
        if (txt.align) opts.align = txt.align;
        objects.push({ text: { text: txt.text, options: opts } });
      } else if ('rect' in obj) {
        const r = obj.rect;
        let { x, y, w, h } = r;
        if (r.grid) {
          const g = resolveGridPosition(r.grid, effectiveGrid, slideW, slideH);
          if (x == null) x = g.x; if (y == null) y = g.y;
          if (w == null) w = g.w; if (h == null) h = g.h;
        }
        const opts: Record<string, any> = { x, y, w, h };
        if (r.fill) opts.fill = { color: resolveColor(r.fill, theme) };
        if (r.line) {
          opts.line = {};
          if (r.line.color) opts.line.color = resolveColor(r.line.color, theme);
          if (r.line.width) opts.line.width = r.line.width;
        }
        objects.push({ rect: opts });
      } else if ('line' in obj) {
        const l = obj.line;
        let { x, y, w, h } = l;
        if (l.grid) {
          const g = resolveGridPosition(l.grid, effectiveGrid, slideW, slideH);
          if (x == null) x = g.x; if (y == null) y = g.y;
          if (w == null) w = g.w; if (h == null) h = g.h;
        }
        const opts: Record<string, any> = { x, y, w, h };
        // Support both nested { line: { color, width } } and flat { color, width }
        const lineStyle = l.line ?? (l as Record<string, any>);
        const lineColor = lineStyle.color as string | undefined;
        const lineWidth = lineStyle.width as number | undefined;
        if (lineColor || lineWidth) {
          opts.line = {};
          if (lineColor) opts.line.color = resolveColor(lineColor, theme);
          if (lineWidth) opts.line.width = lineWidth;
        }
        objects.push({ line: opts });
      }
    }
  }

  // Placeholders
  if (def.placeholders) {
    for (const ph of def.placeholders) {
      // Placeholder grid already resolved in structure.ts (objects grid resolved above)
      const { x, y, w, h } = ph;

      const opts: Record<string, any> = { name: ph.name, type: ph.type };
      if (x != null) opts.x = x;
      if (y != null) opts.y = y;
      if (w != null) opts.w = w;
      if (h != null) opts.h = h;
      if (ph.fontSize) opts.fontSize = ph.fontSize;
      if (ph.fontFace) opts.fontFace = ph.fontFace;
      if (ph.color) opts.color = resolveColor(ph.color, theme);
      if (ph.align) opts.align = ph.align;
      if (ph.valign) opts.valign = ph.valign;
      if (ph.margin !== undefined) opts.margin = ph.margin;

      objects.push({ placeholder: { options: opts, text: ph.text ?? '' } });
    }
  }

  if (objects.length > 0) result.objects = objects;

  return result;
}
