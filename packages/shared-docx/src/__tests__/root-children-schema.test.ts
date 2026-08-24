/**
 * Root `children` must describe what the runtime actually accepts.
 *
 * The exported schema narrowed the root to `section` alone, while the
 * validator and generator both take content components placed directly under
 * `docx` (examples/contract-v1.docx.json is written that way). Schema-driven
 * editors trusted the schema and reddened valid documents, and autocomplete on
 * a root child offered one value (#131).
 */
import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import { generateUnifiedDocumentSchema } from '../schemas/generator';
import { convertToJsonSchema } from '../schemas/export';
import { getStandardComponent } from '../schemas/component-registry';
import { unionBranches } from '@json-to-office/shared';

function rootChildNames(renderer?: 'office-open'): string[] {
  const json = convertToJsonSchema(
    generateUnifiedDocumentSchema({ customComponents: [] })
  ) as Record<string, any>;
  const profile = renderer
    ? unionBranches(json).find(
        (branch: any) =>
          branch.properties?.renderer?.const === renderer ||
          branch.properties?.renderer?.enum?.includes(renderer)
      )
    : unionBranches(json).find(
        (branch: any) => !branch.required?.includes('renderer')
      );
  const items = profile.properties.children.items;
  const variants = unionBranches(items);
  const branches = variants.length > 0 ? variants : [items];
  return branches
    .map((v: any) => v?.properties?.name?.const)
    .filter(Boolean) as string[];
}

describe('root children schema', () => {
  /**
   * What a section accepts *on this renderer*.
   *
   * A component the backend cannot draw is absent from that renderer's branch
   * entirely, so the root must not offer it either. Reading the raw registry
   * list here would demand `chart` of `docxjs`, which has no chart primitive.
   */
  function sectionAllowsOn(renderer: 'docxjs' | 'office-open'): string[] {
    return [...(getStandardComponent('section')?.allowedChildren ?? [])].filter(
      (child) => {
        const component = getStandardComponent(child);
        return !component?.renderers || component.renderers.includes(renderer);
      }
    );
  }

  it('accepts section plus everything a section accepts', () => {
    const names = rootChildNames();
    expect(names).toContain('section');
    for (const child of sectionAllowsOn('docxjs')) {
      expect(names, `${child} missing from root children`).toContain(child);
    }
  });

  it('offers office-open its own components at the root', () => {
    const names = rootChildNames('office-open');
    expect(names).toContain('section');
    for (const child of sectionAllowsOn('office-open')) {
      expect(names, `${child} missing from root children`).toContain(child);
    }
    // The point of the renderer dimension: one branch has it, the other does
    // not, and both are checked against their own expectation.
    expect(names).toContain('chart');
    expect(rootChildNames()).not.toContain('chart');
  });

  it('does not allow a nested docx root', () => {
    expect(rootChildNames()).not.toContain('docx');
  });

  it('validates a document whose children are content components', () => {
    const schema = generateUnifiedDocumentSchema({ customComponents: [] });
    const flat = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        { name: 'heading', props: { text: 'Flat heading', level: 1 } },
        { name: 'paragraph', props: { text: 'Flat paragraph.' } },
      ],
    };
    expect(Value.Check(schema, flat)).toBe(true);
  });

  it('still validates a document wrapped in a section', () => {
    const schema = generateUnifiedDocumentSchema({ customComponents: [] });
    const sectioned = {
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {},
          children: [{ name: 'paragraph', props: { text: 'Inside.' } }],
        },
      ],
    };
    expect(Value.Check(schema, sectioned)).toBe(true);
  });

  it('rejects an unknown component at root', () => {
    const schema = generateUnifiedDocumentSchema({ customComponents: [] });
    const bogus = {
      name: 'docx',
      props: {},
      children: [{ name: 'not-a-real-component', props: {} }],
    };
    expect(Value.Check(schema, bogus)).toBe(false);
  });
});
