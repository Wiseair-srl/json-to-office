import { describe, it, expect } from 'vitest';
import { mutateDocumentAtPath } from '../doc-mutations';

describe('mutateDocumentAtPath', () => {
  it('writes a top-level key on an empty object', () => {
    const next = mutateDocumentAtPath({}, ['title'], 'Hello');
    expect(next).toEqual({ title: 'Hello' });
  });

  it('writes into a nested theme.fonts.heading path', () => {
    const doc = { colors: { primary: '#000' } };
    const next = mutateDocumentAtPath(doc, ['fonts', 'heading'], 'Inter');
    expect(next).toEqual({
      colors: { primary: '#000' },
      fonts: { heading: 'Inter' },
    });
    // Input not mutated.
    expect(doc).toEqual({ colors: { primary: '#000' } });
  });

  it('preserves siblings at the leaf level', () => {
    const doc = { fonts: { heading: 'A', body: 'B' } };
    const next = mutateDocumentAtPath(doc, ['fonts', 'heading'], 'C');
    expect(next).toEqual({ fonts: { heading: 'C', body: 'B' } });
  });

  it('walks into arrays using numeric keys', () => {
    const doc = {
      slides: [{ components: [{ props: { font: { family: 'A' } } }] }],
    };
    const next = mutateDocumentAtPath(
      doc,
      ['slides', 0, 'components', 0, 'props', 'font', 'family'],
      'Inter'
    );
    expect((next as any).slides[0].components[0].props.font.family).toBe(
      'Inter'
    );
    // Siblings stay put.
    expect((next as any).slides[0].components[0].props.font).toEqual({
      family: 'Inter',
    });
  });

  it('creates intermediate arrays when walking through numeric keys', () => {
    const next = mutateDocumentAtPath({}, ['items', 0, 'name'], 'a');
    expect(next).toEqual({ items: [{ name: 'a' }] });
  });

  it('overwrites non-container values at intermediate positions', () => {
    const doc = { fonts: 'old-string' };
    const next = mutateDocumentAtPath(doc, ['fonts', 'heading'], 'Inter');
    expect(next).toEqual({ fonts: { heading: 'Inter' } });
  });

  it('returns newValue when path is empty', () => {
    const next = mutateDocumentAtPath({ a: 1 }, [], 42);
    expect(next).toBe(42);
  });
});
