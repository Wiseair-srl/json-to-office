import { describe, expect, it } from 'vitest';
import { convertToJsonSchema, unionBranches } from '@json-to-office/shared';
import { generateUnifiedDocumentSchema } from '../schemas/generator';
import {
  DOCX_RENDERER_IDS,
  docxComponentDefinitionName,
  type DocxRendererId,
} from '../schemas/renderer';

/**
 * Every position that reaches components through the recursive definition —
 * a section header or footer, a table cell's content, `componentDefaults` —
 * has to get the rules of the document's *own* renderer.
 *
 * Both branches used to embed that definition under one shared
 * `$id: 'ComponentDefinition'`, and the export pass keys `definitions` by
 * `$id` with a plain overwrite, so the last branch walked — office-open —
 * won for both. Positions reached through a per-branch narrowed child union
 * (a direct child of `docx` or of `section`) stayed correct, which is what
 * made the leak look local: the same `visual` was refused in a section body
 * and accepted in that section's header.
 */
const schema = convertToJsonSchema(
  generateUnifiedDocumentSchema({ includeStandardComponents: true })
) as Record<string, any>;

const definitionFor = (renderer: DocxRendererId) =>
  schema.definitions[docxComponentDefinitionName(renderer)];

/** The exported variant for one component name, in one renderer's view. */
function variant(renderer: DocxRendererId, name: string): any {
  // Exported unions are restructured into if/then dispatch — iterate the
  // branch objects shape-agnostically.
  const found = (unionBranches(definitionFor(renderer)) as any[]).find(
    (branch) => branch?.properties?.name?.const === name
  );
  expect(found, `no "${name}" variant for ${renderer}`).toBeDefined();
  return found;
}

describe('per-renderer component definitions', () => {
  it('hoists one definition per renderer, not one shared one', () => {
    for (const renderer of DOCX_RENDERER_IDS) {
      expect(schema.definitions).toHaveProperty(
        docxComponentDefinitionName(renderer)
      );
    }
    // The shared name is what the two branches used to collide on.
    expect(schema.definitions).not.toHaveProperty('ComponentDefinition');
    expect(JSON.stringify(definitionFor('docxjs'))).not.toEqual(
      JSON.stringify(definitionFor('office-open'))
    );
  });

  it('keeps every recursive position inside its own renderer branch', () => {
    for (const [index, renderer] of DOCX_RENDERER_IDS.entries()) {
      const own = `#/definitions/${docxComponentDefinitionName(renderer)}`;
      const other = DOCX_RENDERER_IDS.filter((id) => id !== renderer).map(
        (id) => `#/definitions/${docxComponentDefinitionName(id)}`
      );

      const section = variant(renderer, 'section').properties.props.properties;
      const table = variant(renderer, 'table').properties.props.properties;
      const cell = table.columns.items.properties.cells.items;
      // Built from the *static* section props, so this one reaches the
      // definition through an untyped placeholder rather than a live ref.
      const defaults = variant(renderer, 'docx').properties.props.properties
        .componentDefaults.properties.section.properties;

      for (const [label, position] of [
        ['section header', section.header],
        ['section footer', section.footer],
        ['table cell content', cell.properties.content],
        ['componentDefaults section header', defaults.header],
      ] as const) {
        const refs = JSON.stringify(position);
        expect(refs, `${renderer}: ${label}`).toContain(own);
        for (const foreign of other) {
          expect(refs, `${renderer}: ${label}`).not.toContain(foreign);
        }
      }

      // The document branch itself, and everything it inlines, likewise.
      const branch = JSON.stringify(schema.anyOf[index]);
      expect(branch).toContain(own);
      for (const foreign of other) expect(branch).not.toContain(foreign);
    }
  });

  it('carries each renderer’s own rules into those positions', () => {
    const docxjs = JSON.stringify(definitionFor('docxjs'));
    const officeOpen = JSON.stringify(definitionFor('office-open'));

    // office-open cannot thread comments; docxjs can.
    expect(docxjs).toContain('"replies"');
    expect(officeOpen).not.toContain('"replies"');
    // Only office-open draws a native visual.
    expect(officeOpen).toContain('DocxVisualNativeProps');
    expect(docxjs).not.toContain('DocxVisualNativeProps');
  });

  it('resolves every reference it emits', () => {
    const names = new Set(Object.keys(schema.definitions));
    const unresolved = new Set<string>();
    (function walk(node: unknown): void {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === '$ref' && typeof value === 'string') {
          const name = value.replace('#/definitions/', '');
          if (value === name || !names.has(name)) unresolved.add(value);
        } else walk(value);
      }
    })(schema);
    expect([...unresolved]).toEqual([]);
  });
});
