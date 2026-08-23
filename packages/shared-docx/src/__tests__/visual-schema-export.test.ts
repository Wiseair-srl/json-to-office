import { describe, expect, it } from 'vitest';
import { convertToJsonSchema, unionBranches } from '@json-to-office/shared';
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
    // Exported unions are restructured into if/then dispatch — iterate the
    // branch objects shape-agnostically.
    const variants = unionBranches(slideContent) as Array<
      Record<string, unknown>
    >;

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

  it('hoists both visual props shapes instead of inlining them', () => {
    // `visual.props` is the largest props schema in the registry, and it now
    // has two shapes. Inlined at every position a component can appear, the
    // pair pushed the exported `ComponentDefinition` deep enough that Ajv
    // overflowed compiling it — for an ordinary raster visual in a section
    // header, nothing to do with native mode. Hoisting each shape into its own
    // definition is what keeps that depth flat, so this pins the structure
    // rather than the symptom, which only reproduces at some stack sizes.
    const schema = convertToJsonSchema(
      generateUnifiedDocumentSchema({ includeStandardComponents: true })
    );
    const definitions = schema.definitions as Record<string, unknown>;

    expect(definitions).toHaveProperty('DocxVisualRasterProps');
    expect(definitions).toHaveProperty('DocxVisualNativeProps');

    const branches = (schema as { anyOf?: unknown[] }).anyOf ?? [];
    const [docxjs, officeOpen] = branches.map((branch) =>
      JSON.stringify(branch)
    );

    // Both shapes reach the document only through a `$ref`…
    expect(docxjs).toContain('#/definitions/DocxVisualRasterProps');
    expect(officeOpen).toContain('#/definitions/DocxVisualRasterProps');
    expect(officeOpen).toContain('#/definitions/DocxVisualNativeProps');
    // …and the default backend, which cannot draw a group, is not offered one.
    expect(docxjs).not.toContain('#/definitions/DocxVisualNativeProps');
  });
});
