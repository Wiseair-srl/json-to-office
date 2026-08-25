/**
 * PPTX renderer registry.
 *
 * Adapters are registered as async factories so a backend is only imported
 * when it is actually selected — choosing `pptxgenjs` never loads
 * `@office-open/pptx`, and a backend that cannot be loaded at all (an
 * `--omit=optional` install, a broken tree) surfaces as an actionable install
 * hint rather than a bare module-resolution failure. `statuses()` asks the
 * same question up front, so a discovery surface never advertises a renderer
 * that would fail on the first render.
 */

import {
  RendererRegistry,
  type RendererStatus,
} from '@json-to-office/shared/rendering';
import type { PptxFeature } from '../ir/features';
import type { PptxIR } from '../ir/types';
import {
  DEFAULT_PPTX_RENDERER_ID,
  type PptxRenderer,
  type PptxRendererId,
} from './types';

const registry = new RendererRegistry<PptxIR, PptxFeature, PptxRendererId>(
  'pptx',
  DEFAULT_PPTX_RENDERER_ID
);

registry.register('pptxgenjs', async () => {
  const { createPptxGenJsRenderer } = await import('./pptxgenjs/index');
  return createPptxGenJsRenderer();
});

registry.register('office-open', async () => {
  const { createOfficeOpenPptxRenderer } = await import('./office-open/index');
  return createOfficeOpenPptxRenderer();
});

/** Resolve a renderer by id, defaulting to `pptxgenjs`. */
export function resolvePptxRenderer(
  id?: PptxRendererId
): Promise<PptxRenderer> {
  return registry.resolve(id);
}

/** Renderer ids registered for PPTX. */
export function pptxRendererIds(): readonly PptxRendererId[] {
  return registry.ids();
}

/**
 * Every registered renderer with whether its backend can be loaded here.
 *
 * Registration is not availability: the factory only runs on selection, so an
 * id alone says nothing about whether the render behind it will work. Callers
 * that advertise renderers — `jto_info`, `jto_discover` — report this instead
 * of pptxRendererIds() so a renderer that cannot run is never offered as one
 * that can.
 */
export function pptxRendererStatuses(): Promise<
  RendererStatus<PptxRendererId>[]
> {
  return registry.statuses();
}

export function isPptxRendererId(value: string): value is PptxRendererId {
  return registry.has(value);
}
