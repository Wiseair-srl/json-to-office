import { describe, expect, it } from 'vitest';
import { convertToJsonSchema } from '@json-to-office/shared';
import { generateUnifiedDocumentSchema } from '../schemas/generator';

function collectRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectRefs(item, refs));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') refs.push(child);
      else collectRefs(child, refs);
    }
  }
  return refs;
}

describe('visual JSON Schema export', () => {
  it('hoists one six-variant slide-content definition with resolved refs', () => {
    const schema = convertToJsonSchema(
      generateUnifiedDocumentSchema({ includeStandardComponents: true })
    );
    const definitions = schema.definitions as Record<
      string,
      Record<string, unknown>
    >;
    const slideContent = definitions.PptxSlideContent;
    const variants = slideContent.anyOf as Array<Record<string, unknown>>;

    expect(
      Object.keys(definitions).filter((name) => name === 'PptxSlideContent')
    ).toHaveLength(1);
    expect(variants).toHaveLength(6);
    expect(
      variants.map(
        (variant) =>
          (variant.properties as Record<string, Record<string, unknown>>).name
            .const
      )
    ).toEqual(['text', 'image', 'shape', 'table', 'highcharts', 'chart']);

    for (const ref of collectRefs(schema)) {
      if (!ref.startsWith('#/definitions/')) continue;
      expect(definitions).toHaveProperty(ref.slice('#/definitions/'.length));
    }
  });
});
