/**
 * DOCX renderer registry.
 *
 * Adapters are registered as async factories so a backend is only imported
 * when it is actually selected — choosing `docxjs` never loads
 * `@office-open/docx`, and a backend that cannot be loaded at all (an
 * `--omit=optional` install, a broken tree) surfaces as an actionable install
 * hint rather than a bare module-resolution failure. `statuses()` asks the
 * same question up front, so a discovery surface never advertises a renderer
 * that would fail on the first render.
 */

import {
  RendererRegistry,
  type RendererStatus,
} from '@json-to-office/shared/rendering';
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

/**
 * Every registered renderer with whether its backend can be loaded here.
 *
 * Registration is not availability: the factory only runs on selection, so an
 * id alone says nothing about whether the render behind it will work. Callers
 * that advertise renderers — `jto_info`, `jto_discover` — report this instead
 * of docxRendererIds() so a renderer that cannot run is never offered as one
 * that can.
 */
export function docxRendererStatuses(): Promise<
  RendererStatus<DocxRendererId>[]
> {
  return registry.statuses();
}

export function isDocxRendererId(value: string): value is DocxRendererId {
  return registry.has(value);
}
