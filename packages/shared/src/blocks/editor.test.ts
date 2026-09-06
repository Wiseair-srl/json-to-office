import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyDocumentBlocksToSchema,
  blockDependencies,
  blockInvocationExample,
  blockInvocationPropsSchema,
  blockReferencesFromDocument,
} from './editor';
import { readBlockDefinitions, validateBlockInvocations } from './evaluator';
import type { JsonBlockDefinition } from './schema';

const deck = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../../jto/src/client/public/templates/consulting-deck-blocks.pptx.json',
        import.meta.url
      ),
      'utf8'
    )
  );
const definitions = (): Record<string, JsonBlockDefinition> => ({
  chrome: { slots: {}, body: [{ name: 'text', props: { text: 'x' } }] },
  'kpi-row': {
    description: 'Two to four metrics.',
    slots: {
      metrics: {
        type: 'array',
        required: true,
        minItems: 2,
        maxItems: 4,
        items: {
          type: 'object',
          properties: {
            value: { type: 'string', required: true, maxWords: 3 },
            label: { type: 'string', required: true },
            note: { type: 'string' },
          },
        },
      },
      source: { type: 'string', role: 'source', maxWords: 20 },
      accent: { type: 'boolean' },
      columns: { type: 'integer', minimum: 2, maximum: 4 },
      chart: { type: 'component' },
    },
    body: [
      { name: 'block', props: { ref: 'chrome' } },
      { $each: '/metrics', template: { name: 'text', props: { text: 'x' } } },
    ],
  },
  cover: {
    slots: { title: { type: 'string', required: true } },
    body: [
      { name: 'block', props: { ref: 'kpi-row', slots: { metrics: [] } } },
    ],
  },
});

describe('block invocation props schema', () => {
  it('enumerates the document’s definitions with their descriptions and dispatches slots', () => {
    const schema = blockInvocationPropsSchema(definitions());
    expect(schema.properties.ref.anyOf.map((e: any) => e.const)).toEqual([
      'chrome',
      'kpi-row',
      'cover',
    ]);
    expect(schema.properties.ref.anyOf[1].description).toBe(
      'Two to four metrics.'
    );
    const kpi = schema.allOf.find(
      (e: any) => e.if.properties.ref.const === 'kpi-row'
    );
    expect(kpi.then.properties.slots.required).toEqual(['metrics']);
    expect(kpi.then.properties.slots.additionalProperties).toBe(false);
    const metrics = kpi.then.properties.slots.properties.metrics;
    expect(metrics.minItems).toBe(2);
    expect(metrics.items.required).toEqual(['value', 'label']);
    expect(metrics.markdownDescription).toContain('Required');
    expect(metrics.markdownDescription).toContain('2–4 entries');
    expect(
      kpi.then.properties.slots.properties.source.markdownDescription
    ).toContain('20 words');
  });
  it('types component slots by the component reference and keeps placement out', () => {
    const schema = blockInvocationPropsSchema(definitions(), {
      $ref: '#/definitions/Component',
    });
    const chart = schema.allOf.find(
      (e: any) => e.if.properties.ref.const === 'kpi-row'
    ).then.properties.slots.properties.chart;
    expect(chart.allOf[0]).toEqual({ $ref: '#/definitions/Component' });
    expect(JSON.stringify(chart)).toContain('"grid"');
  });
  it('leaves the reference free when the document defines nothing', () => {
    const schema = blockInvocationPropsSchema({});
    expect(schema.properties.ref.anyOf).toBeUndefined();
    expect(schema.allOf).toBeUndefined();
  });
  it('installs the document-aware props on every block branch inside the targeted definitions', () => {
    const block = () => ({
      type: 'object',
      properties: { name: { const: 'block' }, props: { type: 'object' } },
    });
    const schema: any = {
      definitions: {
        A: {
          anyOf: [
            {
              properties: {
                name: { const: 'slide' },
                // A container's inline copy of the block branch.
                children: { items: { anyOf: [block()] } },
              },
            },
            block(),
          ],
        },
        B: { allOf: [{ if: {}, then: block() }] },
        // Reached only through a reference: left alone.
        C: { anyOf: [block()] },
      },
    };
    schema.definitions.A.anyOf.push({ $ref: '#/definitions/C' });
    applyDocumentBlocksToSchema(schema, definitions(), [
      { name: 'A', componentRef: { $ref: '#/definitions/Content' } },
      { name: 'B' },
      { name: 'missing' },
    ]);
    for (const branch of [
      schema.definitions.A.anyOf[1],
      schema.definitions.A.anyOf[0].properties.children.items.anyOf[0],
      schema.definitions.B.allOf[0].then,
    ]) {
      expect(branch.properties.props.properties.ref.anyOf).toHaveLength(3);
      expect(
        branch.properties.props.allOf[0].then.properties.slots.properties
      ).toBeDefined();
    }
    expect(
      schema.definitions.A.anyOf[1].properties.props.allOf[1].then.properties
        .slots.properties.chart.allOf[0]
    ).toEqual({ $ref: '#/definitions/Content' });
    expect(
      schema.definitions.B.allOf[0].then.properties.props.allOf[1].then
        .properties.slots.properties.chart.required
    ).toEqual(['name']);
    expect(schema.definitions.C.anyOf[0].properties.props).toEqual({
      type: 'object',
    });
  });
});

describe('block invocation examples', () => {
  it('takes the first invocation of the source document when there is one', () => {
    const document = deck();
    const example = blockInvocationExample(
      'action-chart',
      document.props.blocks['action-chart'],
      { document, format: 'pptx' }
    );
    expect(example).toEqual(document.children[1].children[0]);
    expect(example).not.toBe(document.children[1].children[0]);
  });
  it('synthesizes a valid example at typical cardinality otherwise', () => {
    const defs = definitions();
    const example = blockInvocationExample('kpi-row', defs['kpi-row'], {
      format: 'pptx',
    });
    expect(example.name).toBe('block');
    expect(example.props.ref).toBe('kpi-row');
    const slots = example.props.slots as Record<string, any>;
    // Required, or role-bearing chrome a profile may ask for; nothing else.
    expect(Object.keys(slots)).toEqual(['metrics', 'source']);
    expect(slots.metrics).toHaveLength(3);
    expect(Object.keys(slots.metrics[0])).toEqual(['value', 'label']);
    const document = {
      name: 'pptx',
      props: { blocks: defs },
      children: [{ name: 'slide', children: [example] }],
    };
    expect(validateBlockInvocations(document, defs, 'pptx')).toEqual([]);
  });
  it('respects bounds, enums and component slots when synthesizing', () => {
    const definition: JsonBlockDefinition = {
      slots: {
        count: { type: 'integer', required: true, minimum: 5, maximum: 6 },
        tone: { type: 'string', required: true, enum: ['calm', 'bold'] },
        on: { type: 'boolean', required: true },
        items: { type: 'array', required: true, maxItems: 2 },
        visual: { type: 'component', required: true },
        settings: {
          type: 'object',
          required: true,
          properties: { depth: { type: 'number', required: true } },
        },
      },
      body: [],
    };
    for (const format of ['docx', 'pptx'] as const) {
      const example = blockInvocationExample('x', definition, { format });
      const slots = example.props.slots as Record<string, any>;
      expect(slots.count).toBe(5);
      expect(slots.tone).toBe('calm');
      expect(slots.on).toBe(true);
      expect(slots.items).toHaveLength(2);
      expect(slots.visual.name).toBe(format === 'docx' ? 'paragraph' : 'text');
      expect(slots.settings).toEqual({ depth: 0 });
      expect(
        validateBlockInvocations(
          {
            name: format,
            props: { blocks: { x: definition } },
            children: [example],
          },
          { x: definition },
          format
        )
      ).toEqual([]);
    }
  });
});

describe('block dependencies and references', () => {
  it('lists transitive dependencies, dependencies first, without the block itself', () => {
    const defs = definitions();
    expect(blockDependencies(defs, 'cover')).toEqual(['chrome', 'kpi-row']);
    expect(blockDependencies(defs, 'kpi-row')).toEqual(['chrome']);
    expect(blockDependencies(defs, 'chrome')).toEqual([]);
    expect(blockDependencies(defs, 'missing')).toEqual([]);
  });
  it('survives a cycle and an undefined reference', () => {
    const defs: Record<string, JsonBlockDefinition> = {
      a: { slots: {}, body: [{ name: 'block', props: { ref: 'b' } }] },
      b: {
        slots: {},
        body: [
          { name: 'block', props: { ref: 'a' } },
          { name: 'block', props: { ref: 'nowhere' } },
        ],
      },
    };
    expect(blockDependencies(defs, 'a')).toEqual(['b']);
  });
  it('derives references from a complete document', () => {
    const document = deck();
    const references = blockReferencesFromDocument(document, {
      template: 'consulting-deck-blocks',
      format: 'pptx',
    });
    expect(references).toHaveLength(1);
    const [reference] = references;
    expect(reference).toMatchObject({
      name: 'action-chart',
      format: 'pptx',
      template: 'consulting-deck-blocks',
      definitionPointer: '/props/blocks/action-chart',
      dependencies: [],
    });
    expect(reference.description).toBe(
      document.props.blocks['action-chart'].description
    );
    expect(reference.definition).toEqual(document.props.blocks['action-chart']);
    expect(reference.slotsSchema.required).toEqual(['title', 'chart']);
    expect(reference.example).toEqual(document.children[1].children[0]);
    expect(
      validateBlockInvocations(
        {
          name: 'pptx',
          props: { blocks: { 'action-chart': reference.definition } },
          children: [{ name: 'slide', children: [reference.example] }],
        },
        readBlockDefinitions(document),
        'pptx'
      )
    ).toEqual([]);
  });
  it('skips a document whose definitions do not validate', () => {
    expect(
      blockReferencesFromDocument(
        { name: 'pptx', props: { blocks: { bad: { slots: {} } } } },
        { template: 't', format: 'pptx' }
      )
    ).toEqual([]);
  });
});
