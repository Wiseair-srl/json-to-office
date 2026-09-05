/**
 * The key-takeaways block's slot bounds, as a validator reports them.
 *
 * A block's count bounds are schema bounds so an agent gets a path-addressed
 * error at the slot it overfilled, not a rendered box with six bullets.
 */
import { describe, expect, it } from 'vitest';
import { validateStrict } from '../validation/unified';
import { KEY_TAKEAWAYS_BUDGET } from '../schemas/components/key-takeaways';

const doc = (items: unknown, extra: Record<string, unknown> = {}) => ({
  name: 'docx',
  props: {},
  children: [
    {
      name: 'section',
      children: [{ name: 'key-takeaways', props: { items, ...extra } }],
    },
  ],
});

const paths = (document: unknown) =>
  validateStrict.document(document).errors.map((error) => error.path);

describe('key-takeaways schema', () => {
  it('accepts three to five one-line items and an optional label', () => {
    expect(validateStrict.document(doc(['a', 'b', 'c'])).valid).toBe(true);
    expect(
      validateStrict.document(
        doc(['a', 'b', 'c', 'd', 'e'], { label: 'What matters' })
      ).valid
    ).toBe(true);
    expect(KEY_TAKEAWAYS_BUDGET.items).toEqual({
      min: 3,
      max: 5,
      maxWords: 25,
    });
  });

  it('reports too few or too many items at the items slot', () => {
    expect(paths(doc(['a', 'b']))).toContain(
      '/children/0/children/0/props/items'
    );
    expect(paths(doc(['a', 'b', 'c', 'd', 'e', 'f']))).toContain(
      '/children/0/children/0/props/items'
    );
  });

  it('reports an empty or multi-line item at that item, and rejects unknown props', () => {
    expect(paths(doc(['a', '', 'c']))).toContain(
      '/children/0/children/0/props/items/1'
    );
    expect(paths(doc(['a', 'one\nline\rtwo', 'c']))).toContain(
      '/children/0/children/0/props/items/1'
    );
    expect(validateStrict.document(doc(['a', 'b c', 'd'])).valid).toBe(true);
    expect(
      validateStrict.document(doc(['a', 'b', 'c'], { fill: '#FFFFFF' })).valid
    ).toBe(false);
  });

  it('is a leaf: authored children are rejected', () => {
    const document = doc(['a', 'b', 'c']);
    (document.children[0].children[0] as Record<string, unknown>).children = [
      { name: 'paragraph', props: { text: 'x' } },
    ];
    expect(validateStrict.document(document).valid).toBe(false);
  });
});
