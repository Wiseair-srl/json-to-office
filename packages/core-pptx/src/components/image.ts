/**
 * Image Component Renderer
 */

import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig } from '../types';

interface ImageComponentProps {
  path?: string;
  base64?: string;
  x?: number | string;
  y?: number | string;
  w?: number | string;
  h?: number | string;
  sizing?: { type: string; w?: number; h?: number };
  rotate?: number;
  rounding?: boolean;
  shadow?: {
    type?: string;
    color?: string;
    blur?: number;
    offset?: number;
    angle?: number;
    opacity?: number;
  };
  hyperlink?: { url?: string; slide?: number; tooltip?: string };
  alt?: string;
}

export function renderImageComponent(
  slide: PptxGenJS.Slide,
  props: ImageComponentProps,
  _theme: PptxThemeConfig
): void {
  const opts: Record<string, unknown> = {};

  // Source
  if (props.path) {
    opts.path = props.path;
  } else if (props.base64) {
    opts.data = props.base64;
  } else {
    console.warn('Image component missing both path and base64');
    return;
  }

  // Position
  if (props.x !== undefined) opts.x = props.x;
  if (props.y !== undefined) opts.y = props.y;
  if (props.w !== undefined) opts.w = props.w;
  if (props.h !== undefined) opts.h = props.h;

  // Sizing
  if (props.sizing) {
    opts.sizing = props.sizing;
  }

  // Rotation
  if (props.rotate !== undefined) opts.rotate = props.rotate;

  // Rounding
  if (props.rounding) opts.rounding = true;

  // Shadow
  if (props.shadow) {
    opts.shadow = {
      type: props.shadow.type ?? 'outer',
      color: props.shadow.color ?? '000000',
      blur: props.shadow.blur ?? 3,
      offset: props.shadow.offset ?? 3,
      angle: props.shadow.angle ?? 45,
      opacity: props.shadow.opacity ?? 0.5,
    };
  }

  // Hyperlink
  if (props.hyperlink) {
    if (props.hyperlink.url) {
      opts.hyperlink = {
        url: props.hyperlink.url,
        tooltip: props.hyperlink.tooltip,
      };
    } else if (props.hyperlink.slide) {
      opts.hyperlink = {
        slide: props.hyperlink.slide,
        tooltip: props.hyperlink.tooltip,
      };
    }
  }

  // Alt text
  if (props.alt) opts.altText = props.alt;

  slide.addImage(opts as any);
}
