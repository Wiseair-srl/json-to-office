/**
 * PPTX renderer contracts.
 *
 * Format-specific bindings of the shared `OfficeRenderer` contract. Nothing in
 * this file imports a backend; the adapters under `pptxgenjs/` and
 * `office-open/` do, and they are the only places allowed to.
 */

import type {
  OfficeRenderer,
  RenderOptions,
} from '@json-to-office/shared/rendering';
import type { PptxFeature } from '../ir/features';
import type { PptxIR } from '../ir/types';
import type { PipelineWarning } from '../types';
import {
  DEFAULT_PPTX_RENDERER_ID,
  type PptxRendererId,
} from '@json-to-office/shared-pptx';

/**
 * Renderer ids available for PPTX.
 *
 * `pptxgenjs` is the default and must keep producing today's output.
 * `office-open` is experimental and opt-in.
 */
export { DEFAULT_PPTX_RENDERER_ID };
export type { PptxRendererId };

/**
 * Render options for PPTX.
 *
 * Adds a warning sink to the shared contract. Post-render repairs — the SVG
 * preview fix, for one — can find problems that the author should hear about,
 * and those have to reach the same structured warning list the rest of the
 * pipeline uses rather than `console.warn`.
 */
export interface PptxRenderOptions extends RenderOptions {
  warnings?: PipelineWarning[];
}

export interface PptxRenderer
  extends OfficeRenderer<PptxIR, PptxFeature, PptxRendererId> {
  render(document: PptxIR, options?: PptxRenderOptions): Promise<Uint8Array>;
}

export type { RenderOptions };
