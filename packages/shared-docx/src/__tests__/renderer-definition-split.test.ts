import { describe, expect, it } from 'vitest';
import { convertToJsonSchema, unionBranches } from '@json-to-office/shared';
import { generateUnifiedDocumentSchema } from '../schemas/generator';
import {
  DOCX_RENDERER_IDS,
  docxComponentDefinitionName,
  type DocxRendererId,
} from '../schemas/renderer';
import { TABLE_CELL_COMPONENTS } from '../schemas/components/table';

/**
 * Every position that reaches components through the recursive definition —
 * a section header or footer, `componentDefaults` — has to get the rules of
 * the document's *own* renderer. A table cell's content reaches its narrower
 * set of components inlined rather than through the definition, and is held
 * to the same rule below.
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
      // Built from the *static* section props, so this one reaches the
      // definition through an untyped placeholder rather than a live ref.
      const defaults = variant(renderer, 'docx').properties.props.properties
        .componentDefaults.properties.section.properties;

      for (const [label, position] of [
        ['section header', section.header],
        ['section footer', section.footer],
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

  it('narrows table cell content to what a cell renders, in each renderer’s own terms', () => {
    const cellContents = (renderer: DocxRendererId) => {
      const column = variant(renderer, 'table').properties.props.properties
        .columns.items.properties;
      return [
        column.cells.items.properties.content,
        column.header.properties.content,
      ];
    };
    for (const renderer of DOCX_RENDERER_IDS) {
      for (const content of cellContents(renderer)) {
        const [text, components] = content.anyOf;
        expect(text).toEqual({ type: 'string' });
        expect(
          unionBranches(components).map(
            (branch: any) => branch.properties.name.const
          )
        ).toEqual([...TABLE_CELL_COMPONENTS]);
        // Inlined: no renderer's recursive definition — its own or another's
        // — is reachable from a cell.
        for (const id of DOCX_RENDERER_IDS) {
          expect(JSON.stringify(content)).not.toContain(
            `#/definitions/${docxComponentDefinitionName(id)}`
          );
        }
      }
    }
    // Both renderers draw a native visual, in a cell as anywhere else.
    expect(JSON.stringify(cellContents('office-open'))).toContain(
      'DocxVisualNativeProps'
    );
    expect(JSON.stringify(cellContents('docxjs'))).toContain(
      'DocxVisualNativeProps'
    );
  });

  it('carries each renderer’s own rules into those positions', () => {
    const docxjs = JSON.stringify(definitionFor('docxjs'));
    const officeOpen = JSON.stringify(definitionFor('office-open'));

    // office-open cannot thread comments; docxjs can.
    expect(docxjs).toContain('"replies"');
    expect(officeOpen).not.toContain('"replies"');
    // Both draw a native visual, so threads are the difference.
    expect(officeOpen).toContain('DocxVisualNativeProps');
    expect(docxjs).toContain('DocxVisualNativeProps');
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
