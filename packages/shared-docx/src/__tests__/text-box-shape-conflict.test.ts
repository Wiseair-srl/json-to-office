/**
 * `renderAs: 'shape'` asks for a WPS DrawingML shape, and two of its limits are
 * decidable before anything renders: a shape has no autofit, so it needs an
 * explicit size, and its outline carries no dash pattern.
 *
 * Every field involved is independently optional, so the structural schema
 * accepts both combinations; these are the semantic rules that reject them.
 */
import { describe, it, expect } from 'vitest';
import { collectTextBoxShapeConflicts } from '../validation/unified/deep-validator';
import { validate } from '../validation/unified';

const child = { name: 'paragraph', props: { text: 'Boxed.' } };

function textBox(props: Record<string, unknown>) {
  return { name: 'text-box', props, children: [child] };
}

describe('collectTextBoxShapeConflicts — size', () => {
  it('flags a shape with neither dimension', () => {
    const errors = collectTextBoxShapeConflicts(textBox({ renderAs: 'shape' }));

    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('/props/width');
    expect(errors[0].code).toBe('required');
    expect(errors[0].message).toContain('width and height');
    expect(errors[0].message).toContain('renderAs "table"');
  });

  it.each([
    ['height', { renderAs: 'shape', width: 200 }, '/props/height'],
    ['width', { renderAs: 'shape', height: 100 }, '/props/width'],
  ])('flags a shape missing %s', (_axis, props, path) => {
    const errors = collectTextBoxShapeConflicts(textBox(props));

    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe(path);
  });

  it('accepts percentage sizes, which resolve eagerly', () => {
    expect(
      collectTextBoxShapeConflicts(
        textBox({ renderAs: 'shape', width: '50%', height: '30%' })
      )
    ).toHaveLength(0);
  });

  it('leaves the table rendering alone, explicitly or by default', () => {
    expect(collectTextBoxShapeConflicts(textBox({}))).toHaveLength(0);
    expect(
      collectTextBoxShapeConflicts(textBox({ renderAs: 'table' }))
    ).toHaveLength(0);
  });
});

describe('collectTextBoxShapeConflicts — border style', () => {
  const sized = (border: Record<string, unknown>) =>
    textBox({ renderAs: 'shape', width: 200, height: 100, style: { border } });

  it.each(['dashed', 'dotted', 'double'])(
    'flags a %s border a shape outline cannot draw',
    (style) => {
      const errors = collectTextBoxShapeConflicts(
        sized({ top: { style, width: 2 } })
      );

      expect(errors).toHaveLength(1);
      expect(errors[0].path).toBe('/props/style/border/top/style');
      expect(errors[0].code).toBe('unsupported_value');
      expect(errors[0].message).toContain(`"${style}"`);
    }
  );

  it('reports every offending side', () => {
    const errors = collectTextBoxShapeConflicts(
      sized({ top: { style: 'dashed' }, left: { style: 'dotted' } })
    );

    expect(errors.map((e) => e.path)).toEqual([
      '/props/style/border/top/style',
      '/props/style/border/left/style',
    ]);
  });

  it('accepts solid and none', () => {
    expect(
      collectTextBoxShapeConflicts(
        sized({ top: { style: 'solid', width: 2 }, left: { style: 'none' } })
      )
    ).toHaveLength(0);
  });

  it('leaves a dashed border on the table rendering alone', () => {
    expect(
      collectTextBoxShapeConflicts(
        textBox({ style: { border: { top: { style: 'dashed' } } } })
      )
    ).toHaveLength(0);
  });
});

describe('collectTextBoxShapeConflicts — traversal', () => {
  it('finds a text box nested inside another component', () => {
    const errors = collectTextBoxShapeConflicts({
      name: 'section',
      props: {},
      children: [
        {
          name: 'columns',
          props: { columns: 2 },
          children: [textBox({ renderAs: 'shape', width: 200 })],
        },
      ],
    });

    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('/children/0/children/0/props/height');
  });
});

describe('document validation', () => {
  const document = (props: Record<string, unknown>) =>
    JSON.stringify({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'section', props: {}, children: [textBox(props)] }],
    });

  it('rejects a shape with no height', () => {
    const result = validate.jsonDocument(
      document({ renderAs: 'shape', width: 200 })
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('no autofit'))).toBe(
      true
    );
  });

  it('rejects a shape with a dashed border', () => {
    const result = validate.jsonDocument(
      document({
        renderAs: 'shape',
        width: 200,
        height: 100,
        style: { border: { top: { style: 'dashed', width: 2 } } },
      })
    );

    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.message.includes('no dash pattern'))
    ).toBe(true);
  });

  it('accepts a well-formed shape', () => {
    const result = validate.jsonDocument(
      document({
        renderAs: 'shape',
        width: 200,
        height: 100,
        style: { border: { top: { style: 'solid', width: 2 } } },
      })
    );

    expect(result.valid).toBe(true);
  });
});
