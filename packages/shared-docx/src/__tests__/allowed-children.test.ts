import { describe, it, expect } from 'vitest';
import { Value } from '@sinclair/typebox/value';
import {
  STANDARD_COMPONENTS_REGISTRY,
  getContainerComponents,
} from '../schemas/component-registry';
import { ComponentDefinitionSchema } from '../schemas/components';

describe('allowedChildren coverage', () => {
  const containers = getContainerComponents();
  const allAllowed = containers.flatMap((c) => c.allowedChildren ?? []);
  const excludeFromCoverage = new Set(['docx']);
  const nonRootComponents = STANDARD_COMPONENTS_REGISTRY.filter(
    (c) => !excludeFromCoverage.has(c.name)
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
    const allNames = STANDARD_COMPONENTS_REGISTRY.map((c) => c.name);
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
  it('rejects a slide-like component as child of docx (only section allowed)', () => {
    const doc = {
      name: 'docx',
      props: {},
      children: [{ name: 'heading', props: { text: 'Bad', level: 1 } }],
    };
    const valid = Value.Check(ComponentDefinitionSchema, doc);
    expect(valid).toBe(false);
  });

  it('accepts section as child of docx', () => {
    const doc = {
      name: 'docx',
      props: {},
      children: [{ name: 'section', props: {} }],
    };
    const valid = Value.Check(ComponentDefinitionSchema, doc);
    expect(valid).toBe(true);
  });

  it('accepts content components as children of section', () => {
    const section = {
      name: 'section',
      props: {},
      children: [
        { name: 'heading', props: { text: 'Hello', level: 1 } },
        { name: 'paragraph', props: { text: 'World' } },
      ],
    };
    const valid = Value.Check(ComponentDefinitionSchema, section);
    expect(valid).toBe(true);
  });

  it('rejects docx nested inside section', () => {
    const section = {
      name: 'section',
      props: {},
      children: [{ name: 'docx', props: {} }],
    };
    const valid = Value.Check(ComponentDefinitionSchema, section);
    expect(valid).toBe(false);
  });

  it('rejects toc inside text-box (only heading/paragraph/image allowed)', () => {
    const textBox = {
      name: 'text-box',
      props: {},
      children: [{ name: 'toc', props: {} }],
    };
    const valid = Value.Check(ComponentDefinitionSchema, textBox);
    expect(valid).toBe(false);
  });

  it('accepts paragraph inside text-box', () => {
    const textBox = {
      name: 'text-box',
      props: {},
      children: [{ name: 'paragraph', props: { text: 'Hello' } }],
    };
    const valid = Value.Check(ComponentDefinitionSchema, textBox);
    expect(valid).toBe(true);
  });
});
