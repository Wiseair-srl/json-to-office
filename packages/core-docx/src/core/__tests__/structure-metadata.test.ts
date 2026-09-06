import { describe, expect, it } from 'vitest';
import { createDocumentMetadata } from '../structure';

describe('document metadata', () => {
  it('keeps the generation date when the display date does not parse', () => {
    const generated = new Date('2026-09-06T00:00:00Z');
    expect(
      createDocumentMetadata(
        { metadata: { date: '{{Month YYYY}}' } } as never,
        generated
      ).date
    ).toBe(generated);
    expect(
      createDocumentMetadata(
        { metadata: { date: '2026-03-01' } } as never,
        generated
      ).date.toISOString()
    ).toBe('2026-03-01T00:00:00.000Z');
  });
});
