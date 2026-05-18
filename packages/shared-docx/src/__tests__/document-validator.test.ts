import { describe, it, expect } from 'vitest';
import { validate } from '../validation/unified';
import { isValidDocument } from '../validation/unified/document-validator';

describe('validateJsonDocument: docx root recognition', () => {
  it('accepts a minimal docx document with a heading child', () => {
    const json = JSON.stringify({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'heading', props: { text: 'Q1 Report', level: 1 } }],
    });

    const result = validate.jsonDocument(json);

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts a section-wrapped docx document', () => {
    const json = JSON.stringify({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {},
          children: [
            { name: 'heading', props: { text: 'Q1 Report', level: 1 } },
          ],
        },
      ],
    });

    const result = validate.jsonDocument(json);

    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('never reports the root docx name as an unknown component', () => {
    // Force a real downstream error so the catch-all union path is exercised.
    const json = JSON.stringify({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'heading',
              // bad: level must be 1-6
              props: { text: 'oops', level: 99 },
            },
          ],
        },
      ],
    });

    const result = validate.jsonDocument(json);

    expect(result.valid).toBe(false);
    const messages = (result.errors ?? []).map((e) => e.message);
    expect(messages.some((m) => /Unknown component "docx"/.test(m))).toBe(
      false
    );
    expect(
      messages.some((m) => /Invalid component configuration for 'docx'/.test(m))
    ).toBe(false);
  });

  it('reports a real props validation error without the docx false-positive', () => {
    const json = JSON.stringify({
      name: 'docx',
      // theme must be a string
      props: { theme: 42 },
      children: [],
    });

    const result = validate.jsonDocument(json);

    expect(result.valid).toBe(false);
    const messages = (result.errors ?? []).map((e) => e.message);
    expect(messages.some((m) => /Unknown component "docx"/.test(m))).toBe(
      false
    );
    // At least one error must point at /props/theme.
    expect(
      (result.errors ?? []).some((e) => e.path.includes('/props/theme'))
    ).toBe(true);
  });

  it('flags an invalid root name with the expected message', () => {
    const json = JSON.stringify({
      name: 'slideshow',
      props: {},
      children: [],
    });

    const result = validate.jsonDocument(json);

    expect(result.valid).toBe(false);
    const nameErrors = (result.errors ?? []).filter((e) => e.path === '/name');
    expect(nameErrors.length).toBeGreaterThan(0);
    expect(
      nameErrors.some((e) => /Invalid name "slideshow"/.test(e.message))
    ).toBe(true);
  });

  it('rejects explicit null props on the root component', () => {
    const json = JSON.stringify({
      name: 'docx',
      props: null,
      children: [],
    });

    const result = validate.jsonDocument(json);

    expect(result.valid).toBe(false);
    expect((result.errors ?? []).some((e) => e.path.startsWith('/props'))).toBe(
      true
    );
  });

  it('populates `data` whenever `valid` is true (isValidDocument contract)', () => {
    // Triggers TypeBox failure (heading is not in docx.allowedChildren) so the
    // deep validator is the one declaring the doc valid. Even on that path,
    // `data` must be populated so `isValidDocument` returns true.
    const json = JSON.stringify({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [{ name: 'heading', props: { text: 'Hi', level: 1 } }],
    });

    const result = validate.jsonDocument(json);

    expect(result.valid).toBe(true);
    expect(result.data).toBeDefined();
    expect(isValidDocument(result)).toBe(true);
  });
});
