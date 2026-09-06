import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  PPTX_STANDARD_COMPONENTS_REGISTRY,
  getPptxContainerComponents,
} from '../schemas/component-registry';
import { PptxComponentDefinitionSchema } from '../schemas/component-union';
import { validatePresentationDocument } from '../validation/unified';
import { generateUnifiedDocumentSchema } from '../schemas/generator';

describe('allowedChildren coverage', () => {
  const containers = getPptxContainerComponents();
  const allAllowed = containers.flatMap((c) => c.allowedChildren ?? []);
  const nonRootComponents = PPTX_STANDARD_COMPONENTS_REGISTRY.filter(
    (c) => c.name !== 'pptx'
  );

  it('every non-root standard component appears in at least one allowedChildren', () => {
    for (const comp of nonRootComponents) {
      expect(
        allAllowed,
        `${comp.name} not in any container's allowedChildren`
      ).toContain(comp.name);
    }
  });

  it('every allowedChildren entry references an existing component', () => {
    const allNames = PPTX_STANDARD_COMPONENTS_REGISTRY.map((c) => c.name);
    for (const container of containers) {
      for (const child of container.allowedChildren ?? []) {
        expect(
          allNames,
          `${container.name}.allowedChildren references unknown "${child}"`
        ).toContain(child);
      }
    }
  });

  it('every container with hasChildren has allowedChildren defined', () => {
    for (const c of containers) {
      expect(
        c.allowedChildren,
        `${c.name} has hasChildren=true but no allowedChildren`
      ).toBeDefined();
    }
  });
});

describe('narrowed children validation', () => {
  it('rejects content component as direct child of pptx (only slide allowed)', () => {
    const pres = {
      name: 'pptx',
      props: {},
      children: [
        { name: 'text', props: { text: 'Bad', x: 0, y: 0, w: 1, h: 1 } },
      ],
    };
    const valid = Value.Check(PptxComponentDefinitionSchema, pres);
    expect(valid).toBe(false);
  });

  it('accepts slide as child of pptx', () => {
    const pres = {
      name: 'pptx',
      props: {},
      children: [{ name: 'slide', props: {} }],
    };
    const valid = Value.Check(PptxComponentDefinitionSchema, pres);
    expect(valid).toBe(true);
  });

  it('accepts content components as children of slide', () => {
    const slide = {
      name: 'slide',
      props: {},
      children: [
        { name: 'text', props: { text: 'Hello', x: 0, y: 0, w: 5, h: 1 } },
        { name: 'image', props: { path: 'test.png', x: 0, y: 0, w: 5, h: 5 } },
      ],
    };
    const valid = Value.Check(PptxComponentDefinitionSchema, slide);
    expect(valid).toBe(true);
  });

  it('rejects pptx nested inside slide', () => {
    const slide = {
      name: 'slide',
      props: {},
      children: [{ name: 'pptx', props: {} }],
    };
    const valid = Value.Check(PptxComponentDefinitionSchema, slide);
    expect(valid).toBe(false);
  });

  it('rejects slide nested inside slide', () => {
    const slide = {
      name: 'slide',
      props: {},
      children: [{ name: 'slide', props: {} }],
    };
    const valid = Value.Check(PptxComponentDefinitionSchema, slide);
    expect(valid).toBe(false);
  });
});

/**
 * A group is a transparent container: it holds exactly what the slide's
 * `children` hold, itself and blocks included, and never a `slide` or the
 * `pptx` root. Both the exported schema and the deep walk read its
 * `allowedChildren` for this.
 */
describe('group children are slide content', () => {
  // Both schema spellings: the internal union and the per-renderer document
  // schema an agent actually reads. They are built by the same narrowing pass,
  // so a fix that reached only one of them would be a fix for nobody.
  const published = generateUnifiedDocumentSchema({ customComponents: [] });
  const inGroup = (child: unknown) => ({
    name: 'pptx',
    props: {},
    children: [
      { name: 'slide', children: [{ name: 'group', children: [child] }] },
    ],
  });

  it.each(['slide', 'pptx'])('rejects a %s inside a group', (name) => {
    const document = inGroup({ name, props: {} });
    expect(Value.Check(PptxComponentDefinitionSchema, document)).toBe(false);
    expect(Value.Check(published, document)).toBe(false);
    expect(validatePresentationDocument(document).valid).toBe(false);
  });

  it('accepts content, a nested group and a block inside a group', () => {
    for (const child of [
      { name: 'text', props: { text: 'Title' } },
      { name: 'image', props: { path: 'cover.png' } },
      { name: 'group', children: [{ name: 'text', props: { text: 'x' } }] },
    ]) {
      const document = inGroup(child);
      expect(Value.Check(PptxComponentDefinitionSchema, document)).toBe(true);
      expect(Value.Check(published, document)).toBe(true);
      expect(validatePresentationDocument(document).errors).toEqual([]);
    }
    const withBlock = inGroup({ name: 'block', props: { ref: 'x' } });
    (withBlock.props as any).blocks = { x: { slots: {}, body: [] } };
    expect(Value.Check(published, withBlock)).toBe(true);
    expect(validatePresentationDocument(withBlock).errors).toEqual([]);
  });

  it('names the nested node in the error, not just the slide', () => {
    const errors = validatePresentationDocument(
      inGroup({ name: 'slide' })
    ).errors;
    expect(errors.map((error) => error.path)).toContain(
      '/children/0/children/0/children/0/name'
    );
  });
});
