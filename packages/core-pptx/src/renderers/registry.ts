/**
 * PPTX renderer registry.
 *
 * Adapters are registered as async factories so an optional backend is only
 * imported when it is actually selected — choosing `pptxgenjs` never loads
 * `@office-open/pptx`, and a missing optional dependency surfaces as an
 * actionable install hint rather than a bare module-resolution failure.
 */

import { RendererRegistry } from '@json-to-office/shared/rendering';
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

export function isPptxRendererId(value: string): value is PptxRendererId {
  return registry.has(value);
}
