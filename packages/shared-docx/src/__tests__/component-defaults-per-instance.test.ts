/**
 * Regression: per-instance props must not be settable through
 * `componentDefaults`.
 *
 * `ComponentDefaultsSchema` is embedded in every theme, so a default
 * `revision` would silently replace every paragraph's text at render time and
 * a default `comment` would attach the same review comment to every component
 * — with the registry allocating a fresh id per copy.
 *
 * The table is driven by `PER_INSTANCE_PROPS`, so adding a prop there without
 * covering it here fails rather than quietly shipping the leak.
 */
import { describe, it, expect } from 'vitest';
import { validate } from '../validation/unified';
import {
  PER_INSTANCE_PROPS,
  type PerInstanceProp,
} from '../schemas/component-defaults';

/** One valid value per per-instance prop, used for both halves of the check. */
const SAMPLES: Record<PerInstanceProp, unknown> = {
  revision: { segments: [{ type: 'insert', text: 'INJECTED' }] },
  comment: { text: 'INJECTED' },
  footnotes: [{ id: 'x', text: 'INJECTED' }],
  endnotes: [{ id: 'x', text: 'INJECTED' }],
};

/** Components carrying per-instance props, with a minimal valid props object. */
const COMPONENTS: {
  name: string;
  props: Record<string, unknown>;
  carries: PerInstanceProp[];
}[] = [
  {
    name: 'heading',
    props: { text: 'Title', level: 1 },
    carries: ['revision', 'comment'],
  },
  {
    name: 'paragraph',
    props: { text: 'real text' },
    carries: ['revision', 'comment', 'footnotes', 'endnotes'],
  },
  { name: 'list', props: { items: ['One'] }, carries: ['comment'] },
];

function document(props: Record<string, unknown>, child: unknown): string {
  return JSON.stringify({
    name: 'docx',
    props: { theme: 'minimal', ...props },
    children: [child],
  });
}

describe('componentDefaults cannot carry per-instance props', () => {
  it('covers every declared per-instance prop', () => {
    expect(Object.keys(SAMPLES).sort()).toEqual([...PER_INSTANCE_PROPS].sort());
    for (const prop of PER_INSTANCE_PROPS) {
      expect(
        COMPONENTS.some((component) => component.carries.includes(prop)),
        `no component covers "${prop}"`
      ).toBe(true);
    }
  });

  for (const component of COMPONENTS) {
    for (const prop of component.carries) {
      it(`rejects ${prop} inside componentDefaults.${component.name}`, () => {
        const result = validate.jsonDocument(
          document(
            {
              componentDefaults: {
                [component.name]: { [prop]: SAMPLES[prop] },
              },
            },
            { name: component.name, props: component.props }
          )
        );
        expect(result.valid).toBe(false);
      });

      it(`still accepts ${prop} on a ${component.name} instance`, () => {
        const result = validate.jsonDocument(
          document(
            {},
            {
              name: component.name,
              props: { ...component.props, [prop]: SAMPLES[prop] },
            }
          )
        );
        expect(result.valid).toBe(true);
      });
    }
  }
});
