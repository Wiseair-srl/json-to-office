/**
 * One reading of an authored dimension: a number is inches, `"NN%"` is a
 * fraction of the axis it sits on. Layout and fit both need it, and both must
 * read the same number for the same prop.
 */
export function dimensionInches(
  value: unknown,
  axisIn: number
): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().endsWith('%')) {
    const pct = Number(value.trim().slice(0, -1));
    return Number.isFinite(pct) ? (pct / 100) * axisIn : undefined;
  }
  return undefined;
}
