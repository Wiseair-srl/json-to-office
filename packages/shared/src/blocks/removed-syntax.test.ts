import { describe, expect, it } from 'vitest';
import { explainRemovedBlockSyntax } from './removed-syntax';

describe('explainRemovedBlockSyntax', () => {
  it('keeps every error and its message, and adds only what it can explain', () => {
    const document = { name: 'pptx', props: {}, children: [] };
    const errors = [
      { path: '/props/templates', code: '42', message: 'Unexpected property' },
      { path: '/props/title', code: '54', message: 'Expected string' },
    ];
    const explained = explainRemovedBlockSyntax(document, 'pptx', errors);
    expect(explained).toHaveLength(2);
    expect(explained[0]).toMatchObject({
      message: 'Unexpected property',
      suggestion: expect.stringMatching(/JSON blocks/),
    });
    expect(explained[1]).toBe(errors[1]);
  });

  it('reads slide templates as removed in a deck only', () => {
    const document = { name: 'docx', props: {}, children: [] };
    const [error] = explainRemovedBlockSyntax(document, 'docx', [
      { path: '/props/templates', message: 'Unexpected property' },
    ]);
    expect(error.suggestion).toBeUndefined();
  });
});
