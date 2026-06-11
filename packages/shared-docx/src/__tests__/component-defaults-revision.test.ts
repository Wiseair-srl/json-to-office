/**
 * Regression: `revision` is per-instance tracked-change data and must not be
 * settable through componentDefaults — a shared default revision would
 * silently replace every paragraph/heading text at render time.
 */
import { describe, it, expect } from 'vitest';
import { validate } from '../validation/unified';

const docWithDefaultRevision = JSON.stringify({
  name: 'docx',
  props: {
    theme: 'minimal',
    componentDefaults: {
      paragraph: {
        revision: { segments: [{ type: 'insert', text: 'INJECTED' }] },
      },
    },
  },
  children: [{ name: 'paragraph', props: { text: 'real text' } }],
});

describe('componentDefaults cannot carry revision', () => {
  it('rejects revision inside componentDefaults.paragraph', () => {
    const result = validate.jsonDocument(docWithDefaultRevision);
    expect(result.valid).toBe(false);
  });

  it('still accepts revision on a component instance', () => {
    const result = validate.jsonDocument(
      JSON.stringify({
        name: 'docx',
        props: { theme: 'minimal' },
        children: [
          {
            name: 'paragraph',
            props: {
              text: 'new',
              revision: {
                segments: [
                  { type: 'delete', text: 'old' },
                  { type: 'insert', text: 'new' },
                ],
              },
            },
          },
        ],
      })
    );
    expect(result.valid).toBe(true);
  });
});
