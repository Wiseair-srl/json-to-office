/**
 * Reading a chart's category labels as numbers.
 *
 * The docx `chart` component spells every series as labels and values, the
 * vocabulary it shares with the pptx component. A scatter chart has no
 * categories, though: each point needs an x. The label is that x when it reads
 * as a number; one that does not is placed at its position, 1, 2, 3… in order —
 * which is what readers already do with office-open's scatter parts, whose x
 * values are written as text. The compiler warns about such a chart once, so
 * both renderers say the same thing about it.
 */

/** A decimal number, optionally signed and in exponent form, and nothing else. */
const NUMERIC_LABEL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Whether a label reads as a number, ignoring surrounding whitespace. */
export function isNumericLabel(label: string): boolean {
  return NUMERIC_LABEL.test(label.trim());
}

/** The x of a scatter chart's point `index`: its label, or its position. */
export function scatterX(labels: readonly string[], index: number): number {
  const label = labels[index];
  return label !== undefined && isNumericLabel(label)
    ? Number(label)
    : index + 1;
}
