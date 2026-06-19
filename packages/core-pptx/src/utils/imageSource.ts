/**
 * Image source resolution (PPTX)
 *
 * Resolves the three mutually-exclusive image sources into a single string that
 * can be probed and handed to pptxgenjs. Precedence mirrors core-docx:
 * `svg > base64 > path`. Raw SVG markup is wrapped into an `image/svg+xml`
 * data URI so it embeds as a vector (PowerPoint 2016+).
 */
export function resolveImageSource(props: {
  svg?: string;
  base64?: string;
  path?: string;
}): string | undefined {
  if (props.svg && props.svg.trim()) {
    const encoded = Buffer.from(props.svg, 'utf-8').toString('base64');
    return `data:image/svg+xml;base64,${encoded}`;
  }
  return props.base64 || props.path;
}
