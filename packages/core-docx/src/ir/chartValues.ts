/**
 * Reading a chart's category labels as numbers.
 *
 * The docx `chart` component spells every series as labels and values, the
 * vocabulary it shares with the pptx component. A scatter chart has no
 * categories, though: each point needs an x. The label is that x when it reads
 * as a finite number; text is placed at its position, 1, 2, 3… in order.
 * A numeric label outside the finite range is refused rather than moved to a
 * different x. Both renderers write the x values as numbers. The compiler
 * warns about text labels once, so both renderers say the same thing about it.
 */

/** Decimal syntax, optionally signed and in exponent form. */
const NUMERIC_LABEL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** A numeric label's value, or nothing for text. May be non-finite. */
function numericLabelValue(label: string): number | undefined {
  const value = label.trim();
  return NUMERIC_LABEL.test(value) ? Number(value) : undefined;
}

/** Whether a label reads as a finite number. */
export function isNumericLabel(label: string): boolean {
  const value = numericLabelValue(label);
  return value !== undefined && Number.isFinite(value);
}

/** Whether a numeric label exceeds the range a chart can plot. */
export function isOutOfRangeNumericLabel(label: string): boolean {
  const value = numericLabelValue(label);
  return value !== undefined && !Number.isFinite(value);
}

/** The x of a scatter chart's point `index`: its label, or its position. */
export function scatterX(labels: readonly string[], index: number): number {
  const label = labels[index];
  const value = label === undefined ? undefined : numericLabelValue(label);
  if (value === undefined) return index + 1;
  if (!Number.isFinite(value)) {
    throw new RangeError(
      `Scatter x label ${JSON.stringify(label)} is not finite.`
    );
  }
  return value;
}
