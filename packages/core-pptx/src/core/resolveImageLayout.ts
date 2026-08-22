/**
 * Image layout resolution, before compilation.
 *
 * Fitting an image needs its intrinsic pixel size, and getting that means I/O —
 * reading a file, or fetching a URL. That makes it a pre-pass rather than part
 * of the compiler, which stays synchronous and pure. What arrives at the
 * compiler is an image component whose `w`/`h` (and `sizing`, where it
 * survives) are already decided.
 *
 * Three cases need the intrinsic size:
 *
 * - exactly one of `w`/`h` given, no `sizing` — the other is derived from the
 *   aspect ratio
 * - `sizing.type === 'contain'` — the image is fitted inside the box and
 *   centred here, because the backend's own `contain` produces negative crop
 *   values when the aspect ratios differ
 * - `sizing.type === 'cover'` — the backend crops correctly once it is given
 *   the real intrinsic dimensions
 */

import path from 'node:path';
import probe from 'probe-image-size';
import type {
  PipelineWarning,
  PptxComponentInput,
  ProcessedPresentation,
} from '../types';
import { resolveFromBaseDir } from '../utils/baseDirContext';
import { isAllowedLocalPath, resolveImageSource } from '../utils/imageSource';
import { W, warn } from '../utils/warn';

interface ImageSizing {
  type: string;
  w?: number | string;
  h?: number | string;
}

/** Resolve every image component's geometry across the presentation. */
export async function resolveImageLayout(
  presentation: ProcessedPresentation,
  warnings: PipelineWarning[]
): Promise<ProcessedPresentation> {
  const resolve = (components: PptxComponentInput[]) =>
    resolveList(components, presentation, warnings);

  const [slides, templates] = await Promise.all([
    Promise.all(
      presentation.slides.map(async (slide) => ({
        ...slide,
        components: await resolve(slide.components),
        ...(slide.placeholders
          ? {
              placeholders: Object.fromEntries(
                await Promise.all(
                  Object.entries(slide.placeholders).map(
                    async ([name, component]) =>
                      [name, (await resolve([component]))[0]] as const
                  )
                )
              ),
            }
          : {}),
      }))
    ),
    presentation.templates
      ? Promise.all(
          presentation.templates.map(async (template) => ({
            ...template,
            ...(template.objects
              ? { objects: await resolve(template.objects) }
              : {}),
          }))
        )
      : Promise.resolve(presentation.templates),
  ]);

  return { ...presentation, slides, templates };
}

async function resolveList(
  components: PptxComponentInput[],
  presentation: ProcessedPresentation,
  warnings: PipelineWarning[]
): Promise<PptxComponentInput[]> {
  const out: PptxComponentInput[] = [];
  for (const component of components) {
    out.push(
      component.name === 'image'
        ? await resolveOne(component, presentation, warnings)
        : component
    );
  }
  return out;
}

async function resolveOne(
  component: PptxComponentInput,
  presentation: ProcessedPresentation,
  warnings: PipelineWarning[]
): Promise<PptxComponentInput> {
  const props = component.props as Record<string, unknown>;
  const source = resolveImageSource(
    props as Parameters<typeof resolveImageSource>[0]
  );
  if (!source) return component;

  const sizing = props.sizing as ImageSizing | undefined;
  const hasWidth = props.w !== undefined;
  const hasHeight = props.h !== undefined;
  const slideWidth = presentation.slideWidth;
  const slideHeight = presentation.slideHeight;

  const needsIntrinsic =
    (hasWidth !== hasHeight && !sizing) ||
    sizing?.type === 'contain' ||
    sizing?.type === 'cover';
  const intrinsic = needsIntrinsic
    ? await probeIntrinsicSize(source, warnings)
    : undefined;

  const next: Record<string, unknown> = { ...props };

  // Derive the missing dimension from the aspect ratio.
  if (hasWidth !== hasHeight && !sizing) {
    if (intrinsic && intrinsic.width > 0 && intrinsic.height > 0) {
      const aspect = intrinsic.width / intrinsic.height;
      if (hasWidth) {
        const width = toInches(props.w as number | string, slideWidth);
        next.w = width;
        next.h = width / aspect;
      } else {
        const height = toInches(props.h as number | string, slideHeight);
        next.h = height;
        next.w = height * aspect;
      }
    }
    return { ...component, props: next };
  }

  if (!sizing) return component;

  if (sizing.type !== 'contain' && sizing.type !== 'cover') {
    next.sizing = {
      ...sizing,
      w: toInches((sizing.w ?? props.w ?? 0) as number | string, slideWidth),
      h: toInches((sizing.h ?? props.h ?? 0) as number | string, slideHeight),
    };
    return { ...component, props: next };
  }

  const boxWidth = toInches(
    (sizing.w ?? props.w ?? 0) as number | string,
    slideWidth
  );
  const boxHeight = toInches(
    (sizing.h ?? props.h ?? 0) as number | string,
    slideHeight
  );

  if (boxWidth <= 0 || boxHeight <= 0) {
    warn(
      warnings,
      W.IMAGE_ZERO_BOX,
      `Image sizing box resolved to zero (${boxWidth}x${boxHeight})`,
      { component: 'image' }
    );
  }

  const usable =
    intrinsic &&
    intrinsic.width > 0 &&
    intrinsic.height > 0 &&
    boxWidth > 0 &&
    boxHeight > 0;

  if (!usable) {
    next.sizing = { ...sizing, w: boxWidth, h: boxHeight };
    return { ...component, props: next };
  }

  const imageAspect = intrinsic.width / intrinsic.height;

  if (sizing.type === 'contain') {
    // Fit inside the box, preserving the aspect ratio, centred. The element
    // ends up exactly the fitted size, so no sizing is passed on.
    const boxAspect = boxWidth / boxHeight;
    const fitWidth =
      imageAspect > boxAspect ? boxWidth : boxHeight * imageAspect;
    const fitHeight =
      imageAspect > boxAspect ? boxWidth / imageAspect : boxHeight;
    const baseX = toInches((props.x ?? 0) as number | string, slideWidth);
    const baseY = toInches((props.y ?? 0) as number | string, slideHeight);

    next.x = baseX + (boxWidth - fitWidth) / 2;
    next.y = baseY + (boxHeight - fitHeight) / 2;
    next.w = fitWidth;
    next.h = fitHeight;
    delete next.sizing;
    return { ...component, props: next };
  }

  // Cover: the backend crops correctly once given the real intrinsic size.
  next.w = intrinsic.width;
  next.h = intrinsic.height;
  next.sizing = { type: 'cover', w: boxWidth, h: boxHeight };
  return { ...component, props: next };
}

/**
 * Resolve a dimension to inches.
 *
 * Deliberately the plain rule — a number is inches, a percent resolves against
 * the axis — because these values feed the fitting arithmetic, where "inches"
 * is the only interpretation that makes sense.
 */
function toInches(value: number | string, axisInches: number): number {
  if (typeof value === 'number') return value;
  if (value.endsWith('%')) {
    const pct = Number.parseFloat(value);
    return !Number.isNaN(pct) && pct >= 0 ? (pct / 100) * axisInches : 0;
  }
  const n = Number(value);
  return Number.isNaN(n) ? 0 : n;
}

/** Block requests to private, loopback and link-local hosts. */
function isPrivateUrl(urlString: string): boolean {
  try {
    const { hostname } = new URL(urlString);
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
    ) {
      return true;
    }
    if (hostname.startsWith('172.')) {
      const second = Number.parseInt(hostname.split('.')[1], 10);
      if (second >= 16 && second <= 31) return true;
    }
    return false;
  } catch {
    return true;
  }
}

async function probeIntrinsicSize(
  source: string,
  warnings: PipelineWarning[]
): Promise<{ width: number; height: number } | undefined> {
  try {
    if (/^data:image\//.test(source)) {
      const base64Data = source.split(',')[1];
      if (!base64Data) return undefined;
      const result = probe.sync(Buffer.from(base64Data, 'base64'));
      return result
        ? { width: result.width, height: result.height }
        : undefined;
    }

    if (/^https?:\/\//.test(source)) {
      if (isPrivateUrl(source)) return undefined;
      const result = await probe(source, { timeout: 5000 });
      return { width: result.width, height: result.height };
    }

    // Local file — restricted to the document base directory (or CWD) to
    // prevent path traversal (#142).
    const resolved = path.resolve(resolveFromBaseDir(source));
    if (!isAllowedLocalPath(resolved)) return undefined;
    const { createReadStream } = await import('fs');
    const result = await probe(createReadStream(resolved));
    return result ? { width: result.width, height: result.height } : undefined;
  } catch (error) {
    warn(
      warnings,
      W.IMAGE_PROBE_FAILED,
      `Image probe failed: ${error instanceof Error ? error.message : String(error)}`,
      { component: 'image' }
    );
    return undefined;
  }
}
