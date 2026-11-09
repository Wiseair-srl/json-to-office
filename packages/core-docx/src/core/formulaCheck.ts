/**
 * Whether a document's formulas will convert, asked of the renderer that will
 * draw them.
 *
 * A formula is a string to the schema; only the backend can say whether it is
 * one it can write, so the question goes to the renderer's `checkFormula`
 * rather than to a LaTeX reader of this package's own. That keeps every
 * backend import behind the adapters, and makes "validates" mean "renders".
 *
 * A renderer that draws no equations is not asked: the renderer-profile check
 * already refuses every formula for it, by name.
 */

import {
  DEFAULT_DOCX_RENDERER_ID,
  collectFormulas,
  type DocxRendererId,
} from '@json-to-office/shared-docx';
import type { ValidationError } from '@json-to-office/shared';
import { isDocxRendererId, resolveDocxRenderer } from '../renderers/registry';

/**
 * Every formula in `document` the selected renderer cannot write, as a
 * path-addressed `invalid_latex` error. Empty when there are none, when the
 * document has no formulas (no renderer is loaded then), or when the renderer
 * cannot be loaded or draws no equations — each of those is reported by a
 * check of its own.
 */
export async function checkDocxFormulas(
  document: unknown,
  renderer?: string
): Promise<ValidationError[]> {
  const sites = collectFormulas(document);
  if (sites.length === 0) return [];

  const id = rendererId(document, renderer);
  if (!id) return [];
  let backend: Awaited<ReturnType<typeof resolveDocxRenderer>>;
  try {
    backend = await resolveDocxRenderer(id);
  } catch {
    return [];
  }
  if (!backend.capabilities.has('math') || !backend.checkFormula) return [];

  const errors: ValidationError[] = [];
  for (const site of sites) {
    const where =
      site.kind === 'equation'
        ? "The equation's LaTeX"
        : `The formula \\(${site.latex}\\)`;
    const problem = site.latex.trim()
      ? await backend.checkFormula(site.latex)
      : 'it is empty';
    if (problem === undefined) continue;
    errors.push({
      path: site.path,
      message: `${where} cannot be converted to a Word equation: ${problem}`,
      code: 'invalid_latex',
      value: site.latex,
      suggestion:
        'Write standard LaTeX math, with every backslash doubled in JSON (\\\\frac, not \\frac).',
    });
  }
  return errors;
}

/** The renderer a call names, else the one the document names, else the default. */
function rendererId(
  document: unknown,
  override: string | undefined
): DocxRendererId | undefined {
  const named =
    override ??
    (document && typeof document === 'object'
      ? (document as { renderer?: unknown }).renderer
      : undefined) ??
    DEFAULT_DOCX_RENDERER_ID;
  return typeof named === 'string' && isDocxRendererId(named)
    ? named
    : undefined;
}
