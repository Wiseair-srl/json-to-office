import { Value } from '@sinclair/typebox/value';
import { Type } from '@sinclair/typebox';
import { describe, expect, it } from 'vitest';
import { generateUnifiedDocumentSchema } from '../schemas/generator';
import { validatePresentationDocument } from '../validation/unified';
import { convertToJsonSchema } from '@json-to-office/shared';

function deck(renderer?: 'pptxgenjs' | 'office-open') {
  return {
    name: 'pptx',
    ...(renderer ? { renderer } : {}),
    props: {},
    children: [{ name: 'slide', props: {}, children: [] }],
  };
}

describe('renderer-discriminated PPTX schema', () => {
  const schema = generateUnifiedDocumentSchema();

  it('uses pptxgenjs when renderer is omitted', () => {
    expect(Value.Check(schema, deck())).toBe(true);
    const value = deck();
    value.children[0].props = { transition: { type: 'fade' } } as never;
    expect(Value.Check(schema, value)).toBe(false);
  });

  it('selects office-open features with the discriminator', () => {
    const value = deck('office-open');
    value.children[0].props = { transition: { type: 'fade' } } as never;
    expect(Value.Check(schema, value)).toBe(true);
  });

  it('removes office-open gaps from its branch', () => {
    const svg = deck('office-open');
    svg.children[0].children = [
      { name: 'image', props: { svg: '<svg />' } },
    ] as never;
    expect(Value.Check(schema, svg)).toBe(false);
  });

  it('offers office-open the native chart it can now draw', () => {
    // The component used to be pruned from this branch outright, on the
    // grounds that the backend could not ship an editable chart. It can now,
    // so the branch carries it and both renderers accept the same deck.
    for (const renderer of ['pptxgenjs', 'office-open'] as const) {
      const chart = deck(renderer);
      chart.children[0].children = [
        {
          name: 'chart',
          props: { type: 'bar', data: [{ labels: ['A'], values: [1] }] },
        },
      ] as never;
      expect(Value.Check(schema, chart), renderer).toBe(true);
    }
  });

  it('exports resolvable recursive refs for both profiles', () => {
    const json = convertToJsonSchema(schema) as Record<string, any>;
    const definitions = json.definitions ?? {};
    const refs: string[] = [];
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      const object = value as Record<string, unknown>;
      if (typeof object.$ref === 'string') refs.push(object.$ref);
      Object.values(object).forEach(visit);
    };
    visit(json);

    for (const ref of refs.filter((value) =>
      value.startsWith('#/definitions/')
    )) {
      expect(
        definitions[ref.slice('#/definitions/'.length)],
        ref
      ).toBeDefined();
    }
  });

  it('preserves plugins in both renderer branches', () => {
    const pluginSchema = generateUnifiedDocumentSchema({
      customComponents: [
        {
          name: 'callout',
          versions: [
            {
              version: '1.0.0',
              propsSchema: Type.Object({ text: Type.String() }),
            },
          ],
        },
      ],
    });
    for (const renderer of ['pptxgenjs', 'office-open'] as const) {
      const value = deck(renderer);
      value.children[0].children = [
        { name: 'callout', props: { text: renderer } },
      ] as never;
      expect(Value.Check(pluginSchema, value)).toBe(true);
    }
  });
});

describe('renderer-aware PPTX validation', () => {
  it('reports unsupported default and explicit renderer features', () => {
    const transition = deck();
    transition.children[0].props = {
      transition: { type: 'fade' },
    } as never;
    expect(validatePresentationDocument(transition).errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/props/transition',
        code: 'unsupported_renderer_feature',
      })
    );

    const svg = deck('office-open');
    svg.children[0].children = [
      { name: 'image', props: { svg: '<svg />' } },
    ] as never;
    expect(validatePresentationDocument(svg).errors).toContainEqual(
      expect.objectContaining({
        path: '/children/0/children/0/props/svg',
        code: 'unsupported_renderer_feature',
      })
    );
  });
});
