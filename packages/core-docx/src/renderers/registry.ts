/**
 * DOCX renderer registry.
 *
 * Adapters are registered as async factories so an optional backend is only
 * imported when it is actually selected — choosing `docxjs` never loads
 * `@office-open/docx`, and a missing optional dependency surfaces as an
 * actionable install hint rather than a bare module-resolution failure.
 */

import { RendererRegistry } from '@json-to-office/shared/rendering';
import type { DocxFeature } from '../ir/features';
import type { DocxIR } from '../ir/types';
import {
  DEFAULT_DOCX_RENDERER_ID,
  type DocxRenderer,
  type DocxRendererId,
} from './types';

const registry = new RendererRegistry<DocxIR, DocxFeature, DocxRendererId>(
  'docx',
  DEFAULT_DOCX_RENDERER_ID
);

registry.register('docxjs', async () => {
  const { createDocxJsRenderer } = await import('./docxjs/index');
  return createDocxJsRenderer();
});

registry.register('office-open', async () => {
  const { createOfficeOpenDocxRenderer } = await import('./office-open/index');
  return createOfficeOpenDocxRenderer();
});

/** Resolve a renderer by id, defaulting to `docxjs`. */
export function resolveDocxRenderer(
  id?: DocxRendererId
): Promise<DocxRenderer> {
  return registry.resolve(id);
}

/** Renderer ids registered for DOCX. */
export function docxRendererIds(): readonly DocxRendererId[] {
  return registry.ids();
}

export function isDocxRendererId(value: string): value is DocxRendererId {
  return registry.has(value);
}
