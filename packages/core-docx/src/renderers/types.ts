/**
 * DOCX renderer contracts.
 *
 * Format-specific bindings of the shared `OfficeRenderer` contract. Nothing in
 * this file imports a backend; the adapters under `docxjs/` and `office-open/`
 * do, and they are the only places allowed to.
 */

import type {
  OfficeRenderer,
  RenderOptions,
} from '@json-to-office/shared/rendering';
import type { GenerationWarning } from '@json-to-office/shared';
import type { DocxFeature } from '../ir/features';
import type { DocxIR } from '../ir/types';
import {
  DEFAULT_DOCX_RENDERER_ID,
  type DocxRendererId,
} from '@json-to-office/shared-docx';

/**
 * Renderer ids available for DOCX.
 *
 * `docxjs` is the default and must keep producing today's output.
 * `office-open` is experimental and opt-in.
 */
export { DEFAULT_DOCX_RENDERER_ID };
export type { DocxRendererId };

/**
 * Render options for DOCX.
 *
 * Adds a warning sink to the shared contract: post-render repairs can find
 * problems the author should hear about, and those belong in the same
 * structured list as the rest of the pipeline rather than on `console`.
 */
export interface DocxRenderOptions extends RenderOptions {
  warnings?: GenerationWarning[];
}

export interface DocxRenderer
  extends OfficeRenderer<DocxIR, DocxFeature, DocxRendererId> {
  render(document: DocxIR, options?: DocxRenderOptions): Promise<Uint8Array>;
}

export type { RenderOptions };
