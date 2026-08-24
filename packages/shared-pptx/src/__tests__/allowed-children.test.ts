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
 * A named placeholder is a position on the slide, so it holds exactly what the
 * slide's `children` hold. The record used to be typed with the whole recursive
 * component union, which let a `slide` — or the `pptx` root — sit in a title
 * slot: schema-valid, and at generation time a PLACEHOLDER_NO_POSITION warning
 * on a container that can never be placed. Both the exported schema and the
 * deep walk read `slide`'s `allowedChildren` for this now.
 */
describe('placeholder values are slide content', () => {
  // Both schema spellings: the internal union and the per-renderer document
  // schema an agent actually reads. They are built by the same narrowing pass,
  // so a fix that reached only one of them would be a fix for nobody.
  const published = generateUnifiedDocumentSchema({ customComponents: [] });
  const inPlaceholder = (child: unknown) => ({
    name: 'pptx',
    props: {},
    children: [{ name: 'slide', props: { placeholders: { title: child } } }],
  });

  it.each(['slide', 'pptx'])('rejects a %s as a placeholder value', (name) => {
    const document = inPlaceholder({ name, props: {} });
    expect(Value.Check(PptxComponentDefinitionSchema, document)).toBe(false);
    expect(Value.Check(published, document)).toBe(false);
    expect(validatePresentationDocument(document).valid).toBe(false);
  });

  it('rejects a container in a placeholder even with no props to check', () => {
    // The propless spelling: `slide` may omit `props`, so nothing inside the
    // node is wrong — only where the node sits.
    const document = inPlaceholder({ name: 'slide' });
    expect(Value.Check(PptxComponentDefinitionSchema, document)).toBe(false);
    expect(Value.Check(published, document)).toBe(false);
    expect(validatePresentationDocument(document).valid).toBe(false);
  });

  it('still accepts the content components a slot exists for', () => {
    for (const child of [
      { name: 'text', props: { text: 'Title' } },
      { name: 'image', props: { path: 'cover.png' } },
    ]) {
      const document = inPlaceholder(child);
      expect(Value.Check(PptxComponentDefinitionSchema, document)).toBe(true);
      expect(Value.Check(published, document)).toBe(true);
      expect(validatePresentationDocument(document).errors).toEqual([]);
    }
  });

  it('names the slot in the error, not just the slide', () => {
    const errors = validatePresentationDocument(
      inPlaceholder({ name: 'slide' })
    ).errors;
    expect(errors.map((error) => error.path)).toContain(
      '/children/0/props/placeholders/title/name'
    );
  });
});
