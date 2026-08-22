/**
 * The experimental `@office-open/pptx` renderer.
 *
 * Selecting it is explicit and opt-in; `pptxgenjs` stays the default. The
 * backend is an optional dependency, so this module resolves it at call time
 * and lets `RendererRegistry` turn a missing package into an install hint
 * rather than a bare module-resolution failure.
 *
 * The capability set is deliberately narrow and will only widen for features
 * proven by a test against the real package — never from README claims. Until
 * a feature is proven, it is absent here, which makes the compiler's
 * capability check fail before any bytes are produced instead of quietly
 * dropping content.
 */

import type { PptxRenderer, PptxRendererId } from '../types';

export const OFFICE_OPEN_PPTX_RENDERER_ID: PptxRendererId = 'office-open';

/**
 * Module specifier held in a variable so TypeScript does not try to resolve the
 * optional dependency at build time, and so the import failure surfaces at
 * selection time with an actionable message.
 */
const OFFICE_OPEN_PPTX = '@office-open/pptx';

export async function createOfficeOpenPptxRenderer(): Promise<PptxRenderer> {
  // Throws `Cannot find package '@office-open/pptx'` when the optional
  // dependency is absent; the registry rewrites that into an install hint.
  const backend = (await import(
    /* @vite-ignore */ OFFICE_OPEN_PPTX
  )) as unknown;

  throw new Error(
    'The "office-open" PPTX renderer is not implemented yet. ' +
      `The backend resolved (${typeof backend}), but no IR adapter has been ` +
      'written for it, so selecting it would silently produce nothing. Use the ' +
      'default "pptxgenjs" renderer.'
  );
}
