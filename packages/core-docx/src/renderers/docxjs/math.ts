/**
 * Word equations, through docx's own math.
 *
 * `latexToMath` turns the LaTeX the IR carries into docx's `Math*` components
 * — `MathFraction`, `MathRadical`, `MathSum`, `MathMatrix` and the rest — and
 * docx writes them as `m:oMath`, the equations Word's editor makes. Nothing
 * here builds XML: the renderer draws the equation with docx's own classes,
 * exactly as it draws a chart with `ChartRun`.
 *
 * `docx/math` is loaded when `render()` starts rather than with the package:
 * see `docxSubpath.ts`. Only types come from it statically.
 */

import type { ParagraphChild } from 'docx';
import type { DocxIrMathRun } from '../../ir/types';
import { docxSubpath } from './docxSubpath';

const math = docxSubpath(
  'docx/math',
  'equation',
  () => import('docx/math'),
  '9.15.1'
);

/**
 * Load `docx/math`, once per process. Never rejects: a docx without the entry
 * fails only a document that has an equation, when it is emitted. `render()`
 * awaits it; a caller of `buildDocument` with equations must too.
 */
export function loadDocxMath(): Promise<void> {
  return math.load();
}

/**
 * Why `latexToMath` cannot read `latex`, in its own words (which say where),
 * or nothing when it can. The renderer's `checkFormula`.
 */
export async function checkFormula(latex: string): Promise<string | undefined> {
  await math.load();
  const { latexToMath } = math.get();
  try {
    latexToMath(latex);
    return undefined;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return message.replace(/^latexToMath:\s*/, '');
  }
}

/** One equation, as docx's `Math` holding what `latexToMath` built. */
export function emitMath(run: DocxIrMathRun): ParagraphChild {
  const { Math, latexToMath } = math.get();
  let children: ReturnType<typeof latexToMath>;
  try {
    children = latexToMath(run.latex);
  } catch (error) {
    // Validation refuses a formula that will not convert, so reaching here
    // means a caller skipped it. Say which formula, not just where in it.
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `The equation ${JSON.stringify(run.latex)} cannot be written: ${detail}`
    );
  }
  // `Math` is a paragraph child in docx; its declared type is narrower than
  // the union `Paragraph` takes only because the union is not exported whole.
  return new Math({ children }) as unknown as ParagraphChild;
}
