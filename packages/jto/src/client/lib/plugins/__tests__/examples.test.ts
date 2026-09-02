import { describe, expect, it } from 'vitest';
import { extractPluginExamples } from '../examples';

describe('extractPluginExamples', () => {
  it('reads captioned and plain fenced JSON examples, reducing components to props', () => {
    const source = `
/**
 * Weather.
 *
 * @example <caption>Metric</caption>
 * \`\`\`json
 * { "name": "weather", "props": { "city": "London", "units": "metric" } }
 * \`\`\`
 *
 * @example
 * \`\`\`json
 * { "city": "Tokyo" }
 * \`\`\`
 */
export const x = 1;
// Example: {"city":"Rome","days":2}
`;
    expect(extractPluginExamples(source)).toEqual([
      { title: 'Metric', props: { city: 'London', units: 'metric' } },
      { title: undefined, props: { city: 'Tokyo' } },
      { props: { city: 'Rome', days: 2 } },
    ]);
  });

  it('accepts a TypeScript object literal with unquoted keys', () => {
    const source = `
/**
 * @example
 * \`\`\`ts
 * generator.generate({ name: 'kpi', props: { label: 'ARR', value: 42 } })
 * \`\`\`
 */
`;
    expect(extractPluginExamples(source)).toEqual([
      { title: undefined, props: { label: 'ARR', value: 42 } },
    ]);
  });

  it('ignores blocks that hold no object', () => {
    expect(
      extractPluginExamples('/** @example ```json\n * just words\n * ``` */')
    ).toEqual([]);
    expect(extractPluginExamples('const a = 1;')).toEqual([]);
  });
});
