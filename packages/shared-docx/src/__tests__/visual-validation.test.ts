import { describe, it, expect } from 'vitest';
import { validate } from '../validation/unified';

const docWithVisual = (elements: unknown[]) => ({
  name: 'docx',
  props: { theme: 'minimal' },
  children: [
    {
      name: 'section',
      props: {},
      children: [
        {
          name: 'visual',
          props: { canvas: { width: 6, height: 3 }, elements },
        },
      ],
    },
  ],
});

describe('visual: first-class pptx element validation', () => {
  it('accepts valid pptx slide elements (text + shape)', () => {
    const result = validate.jsonDocument(
      JSON.stringify(
        docWithVisual([
          {
            name: 'text',
            props: {
              text: 'Hi',
              x: 1,
              y: 1,
              w: 4,
              h: 1,
              align: 'center',
              bold: true,
            },
          },
          {
            name: 'shape',
            props: {
              type: 'chevron',
              x: 0.3,
              y: 0.6,
              w: 1.6,
              h: 1.2,
              fill: { color: '8FB9FF' },
            },
          },
        ])
      )
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts a visual with no elements', () => {
    const result = validate.jsonDocument(JSON.stringify(docWithVisual([])));
    expect(result.valid).toBe(true);
  });

  it('rejects an unknown prop on a text element (additionalProperties)', () => {
    const result = validate.jsonDocument(
      JSON.stringify(
        docWithVisual([{ name: 'text', props: { text: 'Hi', bogusProp: 1 } }])
      )
    );
    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some((e) => e.path.includes('/elements/0'))
    ).toBe(true);
  });

  it('rejects an invalid prop type on an element', () => {
    const result = validate.jsonDocument(
      JSON.stringify(
        docWithVisual([{ name: 'shape', props: { type: 'not-a-real-shape' } }])
      )
    );
    expect(result.valid).toBe(false);
  });

  it('rejects an unknown pptx component name', () => {
    const result = validate.jsonDocument(
      JSON.stringify(docWithVisual([{ name: 'frobnicate', props: {} }]))
    );
    expect(result.valid).toBe(false);
  });
});
