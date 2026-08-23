/**
 * Every semantic rule has to reach a document through both validation entry
 * points: `validate.document` takes an object, `validate.jsonDocument` takes
 * JSON, and callers reach for whichever fits.
 *
 * The two used to run hand-maintained copies of the same collector list, so a
 * rule wired into one and not the other was invisible until a document arrived
 * by the other path — which is exactly what happened when the text-box shape
 * rule was added. This locks the parity down rather than the list's shape, so
 * it keeps working however the collectors end up being applied.
 */
import { describe, it, expect } from 'vitest';
import { validate } from '../validation/unified';

const document = (child: Record<string, unknown>) => ({
  name: 'docx',
  props: { theme: 'minimal' },
  children: [{ name: 'section', props: {}, children: [child] }],
});

/** One offending document per semantic rule, with the phrase it must report. */
const OFFENDERS: [string, Record<string, unknown>, string][] = [
  [
    'image with two sources',
    { name: 'image', props: { path: 'a.png', base64: 'AAAA' } },
    'only one source',
  ],
  [
    'indent with hanging and firstLine',
    {
      name: 'paragraph',
      props: { text: 'x', indent: { hanging: 100, firstLine: 100 } },
    },
    'not both',
  ],
  [
    'notes on a revised paragraph',
    {
      name: 'paragraph',
      props: {
        text: 'new[^a]',
        revision: {
          segments: [
            { type: 'delete', text: 'old' },
            { type: 'insert', text: 'new' },
          ],
        },
        footnotes: [{ id: 'a', text: 'body' }],
      },
    },
    'cannot apply to the same text',
  ],
  [
    'shape text box with no height',
    {
      name: 'text-box',
      props: { renderAs: 'shape', width: 200 },
      children: [{ name: 'paragraph', props: { text: 'x' } }],
    },
    'no autofit',
  ],
  [
    'a native visual under the default renderer',
    {
      name: 'visual',
      props: {
        renderMode: 'native',
        canvas: { width: 3, height: 2 },
        elements: [{ name: 'shape', props: { type: 'rect' } }],
      },
    },
    'Only the "office-open" renderer draws a native visual',
  ],
];

describe.each(OFFENDERS)('%s', (_label, child, phrase) => {
  it('is rejected by validate.document', () => {
    const result = validate.document(document(child));

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(phrase))).toBe(true);
  });

  it('is rejected by validate.jsonDocument', () => {
    const result = validate.jsonDocument(JSON.stringify(document(child)));

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes(phrase))).toBe(true);
  });
});

describe('a document breaking no semantic rule', () => {
  const clean = document({ name: 'paragraph', props: { text: 'Fine.' } });

  it('passes both entry points', () => {
    expect(validate.document(clean).valid).toBe(true);
    expect(validate.jsonDocument(JSON.stringify(clean)).valid).toBe(true);
  });
});
