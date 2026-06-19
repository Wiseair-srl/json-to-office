/**
 * Image source resolution (PPTX)
 *
 * Resolves the three mutually-exclusive image sources into a single string that
 * can be probed and handed to pptxgenjs. Precedence mirrors core-docx:
 * `svg > base64 > path`. Raw SVG markup is wrapped into an `image/svg+xml`
 * data URI so it embeds as a vector (PowerPoint 2016+).
 */
/** A source field counts only when it carries a non-empty (non-whitespace) value. */
const hasValue = (v?: string): v is string =>
  typeof v === 'string' && v.trim().length > 0;

export function resolveImageSource(props: {
  svg?: string;
  base64?: string;
  path?: string;
}): string | undefined {
  if (hasValue(props.svg)) {
    const encoded = Buffer.from(props.svg, 'utf-8').toString('base64');
    return `data:image/svg+xml;base64,${encoded}`;
  }
  // Mirror the conflict-validator predicate: blank base64/path are treated as
  // absent, so a whitespace-only value can't shadow a real later source.
  if (hasValue(props.base64)) return props.base64;
  if (hasValue(props.path)) return props.path;
  return undefined;
}
