import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  PPTX_STANDARD_COMPONENTS_REGISTRY,
  getPptxContainerComponents,
} from '../schemas/component-registry';
import { PptxComponentDefinitionSchema } from '../schemas/component-union';

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
