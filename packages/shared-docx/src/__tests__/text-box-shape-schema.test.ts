/**
 * The two shape limits, expressed in the JSON Schema the editor validates
 * against.
 *
 * `collectTextBoxShapeConflicts` already rejects these documents, but it only
 * runs when one is generated — so an author learned that a shape needs a
 * height by pressing Run. Monaco checks the buffer against this schema as it
 * is typed, and `if`/`then` is the only place a cross-field rule can live
 * where Monaco will see it.
 */
import { describe, it, expect } from 'vitest';
import Ajv from 'ajv';
import { TextBoxPropsSchema } from '../schemas/components/text-box';

const validate = new Ajv({ strict: false }).compile(
  TextBoxPropsSchema as object
);

const errorsFor = (props: Record<string, unknown>): string => {
  validate(props);
  return (validate.errors ?? [])
    .map((e) => `${e.instancePath} ${e.message}`)
    .join('; ');
};

describe('text-box shape rules in the editor schema', () => {
  it('requires a height when renderAs is shape', () => {
    expect(errorsFor({ renderAs: 'shape', width: 260 })).toContain('height');
  });

  it('requires a width when renderAs is shape', () => {
    expect(errorsFor({ renderAs: 'shape', height: 120 })).toContain('width');
  });

  it('accepts a shape that carries both', () => {
    expect(errorsFor({ renderAs: 'shape', width: 260, height: 120 })).toBe('');
  });

  it.each(['dashed', 'dotted', 'double'])(
    'rejects a %s border on a shape',
    (style) => {
      expect(
        errorsFor({
          renderAs: 'shape',
          width: 260,
          height: 120,
          style: { border: { top: { style, width: 2 } } },
        })
      ).not.toBe('');
    }
  );

  it('allows a solid border on a shape', () => {
    expect(
      errorsFor({
        renderAs: 'shape',
        width: 260,
        height: 120,
        style: { border: { top: { style: 'solid', width: 2 } } },
      })
    ).toBe('');
  });

  it('leaves table text-boxes alone — no size, any border style', () => {
    // The default rendering auto-fits and draws every border style, so none of
    // the shape rules may reach it. The annual-report templates carry hundreds
    // of exactly these.
    expect(errorsFor({})).toBe('');
    expect(
      errorsFor({ style: { border: { left: { style: 'dashed', width: 2 } } } })
    ).toBe('');
    expect(errorsFor({ renderAs: 'table', width: 260 })).toBe('');
  });
});
