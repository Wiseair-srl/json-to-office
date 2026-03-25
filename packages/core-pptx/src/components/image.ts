/**
 * Image Component Renderer
 */

import path from 'path';
import probe from 'probe-image-size';
import type PptxGenJS from 'pptxgenjs';
import type { PptxThemeConfig, PipelineWarning } from '../types';
import { resolveColor } from '../utils/color';
import { warn, W } from '../utils/warn';

/** Block requests to private/loopback/link-local hosts. */
function isPrivateUrl(urlStr: string): boolean {
  try {
    const { hostname } = new URL(urlStr);
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('169.254.') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')
    ) return true;
    if (hostname.startsWith('172.')) {
      const second = parseInt(hostname.split('.')[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    return false;
  } catch { return true; }
}

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

/**
 * Probe the intrinsic dimensions of an image (URL, file path, or base64).
 * Returns width/height in pixels, or undefined on failure.
 */
async function probeImageSize(
  imagePath: string,
  warnings?: PipelineWarning[]
): Promise<{ width: number; height: number } | undefined> {
  try {
    if (/^data:image\//.test(imagePath)) {
      const base64Data = imagePath.split(',')[1];
      if (!base64Data) return undefined;
      const buf = Buffer.from(base64Data, 'base64');
      const result = probe.sync(buf);
      return result ? { width: result.width, height: result.height } : undefined;
    }

    if (/^https?:\/\//.test(imagePath)) {
      if (isPrivateUrl(imagePath)) return undefined;
      const result = await probe(imagePath, { timeout: 5000 });
      return { width: result.width, height: result.height };
    }

    // Local file — restrict to CWD to prevent path traversal
    const resolved = path.resolve(imagePath);
    if (!resolved.startsWith(process.cwd())) return undefined;
    const { createReadStream } = await import('fs');
    const result = await probe(createReadStream(resolved));
    return result ? { width: result.width, height: result.height } : undefined;
  } catch (err) {
    warn(warnings, W.IMAGE_PROBE_FAILED, `Image probe failed: ${err instanceof Error ? err.message : String(err)}`, { component: 'image' });
    return undefined;
  }
}

export async function renderImageComponent(
  slide: PptxGenJS.Slide,
  props: ImageComponentProps,
  theme: PptxThemeConfig,
  warnings?: PipelineWarning[]
): Promise<void> {
  const opts: Record<string, unknown> = {};

  // Source
  if (props.path) {
    opts.path = props.path;
  } else if (props.base64) {
    opts.data = props.base64;
  } else {
    warn(warnings, W.IMAGE_NO_SOURCE, 'Image component missing both path and base64', { component: 'image' });
    return;
  }

  // Position
  if (props.x !== undefined) opts.x = props.x;
  if (props.y !== undefined) opts.y = props.y;
  if (props.w !== undefined) opts.w = props.w;
  if (props.h !== undefined) opts.h = props.h;

  // Sizing — pptxgenjs's contain implementation produces negative srcRect
  // values when the image aspect ratio differs from the box, causing
  // stretching. We handle contain ourselves: probe intrinsic dimensions,
  // calculate fitted size, and center within the box. Cover is delegated to
  // pptxgenjs with correct intrinsic dimensions.
  if (props.sizing && (props.sizing.type === 'contain' || props.sizing.type === 'cover')) {
    const source = props.path || props.base64;
    const intrinsic = source ? await probeImageSize(source, warnings) : undefined;

    const boxW = Number(props.sizing.w ?? props.w);
    const boxH = Number(props.sizing.h ?? props.h);

    if (intrinsic && !isNaN(boxW) && !isNaN(boxH)) {
      const imgAspect = intrinsic.width / intrinsic.height;

      if (props.sizing.type === 'contain') {
        // Fit image inside box, preserving aspect ratio, centered
        const boxAspect = boxW / boxH;
        let fitW: number, fitH: number;
        if (imgAspect > boxAspect) {
          // Image is wider than box — width-limited
          fitW = boxW;
          fitH = boxW / imgAspect;
        } else {
          // Image is taller than box — height-limited
          fitH = boxH;
          fitW = boxH * imgAspect;
        }
        // Center within the box
        const baseX = Number(props.x ?? 0);
        const baseY = Number(props.y ?? 0);
        opts.x = baseX + (boxW - fitW) / 2;
        opts.y = baseY + (boxH - fitH) / 2;
        opts.w = fitW;
        opts.h = fitH;
        // No sizing — element is already the correct size
      } else {
        // Cover: pptxgenjs handles this correctly with real intrinsic dims
        opts.w = intrinsic.width;
        opts.h = intrinsic.height;
        opts.sizing = { type: 'cover', w: boxW, h: boxH };
      }
    } else {
      // Fallback: pass sizing through with w/h auto-filled from outer dims
      opts.sizing = { ...props.sizing, w: boxW, h: boxH };
    }
  } else if (props.sizing) {
    opts.sizing = {
      ...props.sizing,
      w: props.sizing.w ?? props.w,
      h: props.sizing.h ?? props.h,
    };
  }

  // Rotation
  if (props.rotate !== undefined) opts.rotate = props.rotate;

  // Rounding
  if (props.rounding) opts.rounding = true;

  // Shadow
  if (props.shadow) {
    opts.shadow = {
      type: props.shadow.type ?? 'outer',
      color: resolveColor(props.shadow.color ?? '000000', theme, warnings),
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
