import { describe, expect, it } from 'vitest';
import { DocxFormatAdapter, PptxFormatAdapter } from './format-adapter';

function deck(textProps: Record<string, unknown>) {
  return {
    name: 'pptx',
    props: {},
    children: [
      {
        name: 'slide',
        props: {},
        children: [{ name: 'text', props: textProps }],
      },
    ],
  };
}

describe('PptxFormatAdapter.validateDocument', () => {
  it('accepts a valid presentation', () => {
    const result = new PptxFormatAdapter().validateDocument(
      deck({ text: 'Hello' })
    );

    expect(result).toEqual({ valid: true });
  });

  it('returns deep schema errors instead of hardcoded success', () => {
    const result = new PptxFormatAdapter().validateDocument(
      deck({ text: 'Hello', fontColor: 'CC785C' })
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: expect.stringContaining('/children/0/children/0/props'),
          message: expect.stringMatching(/fontColor/),
        }),
      ])
    );
  });
});

describe('DocxFormatAdapter.validateDocument', () => {
  it('returns real schema errors', () => {
    const result = new DocxFormatAdapter().validateDocument({
      name: 'docx',
      props: { unknown: true },
      children: [],
    });

    expect(result.valid).toBe(false);
    expect(result.errors?.length).toBeGreaterThan(0);
  });
});
