/**
 * Math in DOCX documents: the inline syntax, and where formulas sit.
 *
 * Shared by the compiler, which splits text into prose and formulas, and by
 * the formula check, which asks the renderer whether each one converts — one
 * definition, so a span the check passed is exactly the span the compiler
 * turns into an equation.
 *
 * Nothing here reads LaTeX. Whether a formula converts is the renderer's
 * question — `docxjs` answers it with the same docx function it draws the
 * equation with — so the answer lives with the renderer, behind its
 * `checkFormula`, and this module only says where the formulas are.
 */

/**
 * `\(…\)`, a formula inside a sentence, as LaTeX writes inline math.
 *
 * Not `$…$`: a dollar sign is far more often a price in business prose than a
 * formula, and a stray pair would silently turn the text between two prices
 * into math. A `\(` preceded by a backslash is the author's literal `\\(`, not
 * an opening, and is left alone.
 */
export const INLINE_MATH_PATTERN = /(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g;

/** One `\(…\)` span: where it starts in the text, and the LaTeX inside it. */
export interface InlineMathSpan {
  /** Index of the `\(` in the text. */
  index: number;
  /** Length of the whole span, delimiters included. */
  length: number;
  latex: string;
}

/** Every `\(…\)` span in `text`, in order. */
export function inlineMathSpans(text: string): InlineMathSpan[] {
  if (!text.includes('\\(')) return [];
  return [...text.matchAll(INLINE_MATH_PATTERN)].map((match) => ({
    index: match.index!,
    length: match[0].length,
    latex: match[1]!,
  }));
}

/** A formula in a document, and where an author would go to fix it. */
export interface FormulaSite {
  latex: string;
  /** RFC 6901 pointer to the string that holds the formula. */
  path: string;
  /** Whether it is an `equation`'s `latex` or a `\(…\)` span in text. */
  kind: 'equation' | 'inline';
}

/**
 * Every formula in a document: each `equation`'s `latex`, and every `\(…\)`
 * span in the text that takes inline math — a paragraph's, a list item's and
 * a table cell's string. Anywhere else the delimiters are plain characters,
 * so they are not formulas and are not reported.
 */
export function collectFormulas(document: unknown): FormulaSite[] {
  const sites: FormulaSite[] = [];

  const inText = (text: unknown, path: string): void => {
    if (typeof text !== 'string') return;
    for (const span of inlineMathSpans(text)) {
      sites.push({ latex: span.latex, path, kind: 'inline' });
    }
  };

  const visit = (node: unknown, path: string, inTable: boolean): void => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}/${i}`, inTable));
      return;
    }
    if (!node || typeof node !== 'object') return;
    const object = node as Record<string, unknown>;
    const props = object.props as Record<string, unknown> | undefined;
    const named = typeof object.name === 'string';

    if (named && props && typeof props === 'object') {
      if (object.name === 'equation' && typeof props.latex === 'string') {
        sites.push({
          latex: props.latex,
          path: `${path}/props/latex`,
          kind: 'equation',
        });
      }
      if (object.name === 'paragraph') inText(props.text, `${path}/props/text`);
      if (object.name === 'list' && Array.isArray(props.items)) {
        props.items.forEach((item, i) => {
          const at = `${path}/props/items/${i}`;
          if (typeof item === 'string') inText(item, at);
          else if (item && typeof item === 'object')
            inText((item as { text?: unknown }).text, `${at}/text`);
        });
      }
    } else if (inTable && !named) {
      // A table cell or header: `{ content: "…" }`, or a paragraph in it,
      // which the walk reaches as a component of its own.
      inText(object.content, `${path}/content`);
    }

    const table = named ? object.name === 'table' : inTable;
    for (const [key, value] of Object.entries(object)) {
      visit(value, `${path}/${key}`, table);
    }
  };

  visit(document, '', false);
  return sites;
}
