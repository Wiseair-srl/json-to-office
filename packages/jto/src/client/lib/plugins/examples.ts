import type { PluginExample } from './types';

/**
 * Usage examples embedded in a plugin's source.
 *
 * The same two conventions disk discovery reads (`PluginMetadataExtractor`
 * in jto-cli): a JSDoc `@example` carrying a fenced JSON/TypeScript block,
 * optionally captioned, and a `// Example: {...}` line. A block that holds a
 * whole `{ name, props }` component is reduced to its `props`, so the
 * example is always the props object documents put under the component.
 */
export function extractPluginExamples(source: string): PluginExample[] {
  const examples: PluginExample[] = [];
  const normalize = (input: unknown): unknown =>
    input && typeof input === 'object' && 'props' in input
      ? (input as { props: unknown }).props
      : input;

  const fenced =
    /@example\s*(?:<caption>(.*?)<\/caption>)?\s*\*?\s*```(?:json|typescript|ts)?\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = fenced.exec(source)) !== null) {
    const title = match[1]?.trim() || undefined;
    const block = match[2]
      .split('\n')
      .map((line) => line.replace(/^\s*\*\s?/, ''))
      .join('\n')
      .trim();
    const json = block.match(/\{[\s\S]*\}/);
    if (!json) continue;
    try {
      examples.push({ title, props: normalize(JSON.parse(json[0])) });
    } catch {
      // A TypeScript object literal rather than JSON: quote the keys and
      // swap single quotes, which covers the examples plugins actually carry.
      const propsMatch = block.match(/props:\s*\{[\s\S]*?\}/);
      if (!propsMatch) continue;
      try {
        const cleaned = propsMatch[0]
          .replace(/props:\s*/, '')
          .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')
          .replace(/'/g, '"')
          .replace(/,(\s*[}\]])/g, '$1')
          .replace(/,\s*$/, '');
        examples.push({ title, props: JSON.parse(cleaned) });
      } catch {}
    }
  }

  const inline = /\/\/\s*Example:\s*(\{.*?\})/g;
  while ((match = inline.exec(source)) !== null) {
    try {
      examples.push({ props: normalize(JSON.parse(match[1])) });
    } catch {}
  }

  return examples;
}
