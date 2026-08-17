/**
 * Validation coverage for paragraph indentation (props.indent), tab stops
 * (props.tabStops), and character width scaling (font.scale).
 */
import { describe, it, expect } from 'vitest';
import { validate } from '../validation/unified';
import { collectIndentConflicts } from '../validation/unified/deep-validator';

const doc = (children: unknown[]) =>
  JSON.stringify({
    name: 'docx',
    props: { theme: 'minimal' },
    children,
  });

describe('paragraph indent validation', () => {
  it('accepts indent with left/right/firstLine on a paragraph', () => {
    const result = validate.jsonDocument(
      doc([
        {
          name: 'paragraph',
          props: {
            text: 'Indented.',
            indent: { left: 720, right: 360, firstLine: 240 },
          },
        },
      ])
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('accepts indent with hanging on a heading', () => {
    const result = validate.jsonDocument(
      doc([
        {
          name: 'heading',
          props: {
            text: 'Hanging Heading',
            level: 2,
            indent: { left: 720, hanging: 360 },
          },
        },
      ])
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects hanging and firstLine together with a pointer path', () => {
    const result = validate.jsonDocument(
      doc([
        {
          name: 'paragraph',
          props: {
            text: 'Conflict.',
            indent: { hanging: 360, firstLine: 240 },
          },
        },
      ])
    );
    expect(result.valid).toBe(false);
    const conflict = (result.errors ?? []).find(
      (e) => e.code === 'mutually_exclusive'
    );
    expect(conflict).toBeDefined();
    expect(conflict?.path).toBe('/children/0/props/indent');
    expect(conflict?.message).toMatch(/hanging.*firstLine/);
  });

  it('finds indent conflicts on nested components', () => {
    const errors = collectIndentConflicts({
      name: 'docx',
      props: { theme: 'minimal' },
      children: [
        {
          name: 'section',
          props: {},
          children: [
            {
              name: 'heading',
              props: {
                text: 'Nested',
                level: 3,
                indent: { hanging: 100, firstLine: 100 },
              },
            },
          ],
        },
      ],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0].path).toBe('/children/0/children/0/props/indent');
  });

  it('rejects unknown properties inside indent with a pointer path', () => {
    const result = validate.jsonDocument(
      doc([
        {
          name: 'paragraph',
          props: { text: 'Typo.', indent: { lft: 720 } },
        },
      ])
    );
    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some((e) =>
        e.path.includes('/children/0/props/indent')
      )
    ).toBe(true);
  });

  it('rejects a negative hanging value', () => {
    const result = validate.jsonDocument(
      doc([
        {
          name: 'paragraph',
          props: { text: 'Bad.', indent: { hanging: -10 } },
        },
      ])
    );
    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some((e) =>
        e.path.includes('/children/0/props/indent/hanging')
      )
    ).toBe(true);
  });
});

describe('tab stops validation', () => {
  it('accepts tabStops with type/position/leader on a paragraph', () => {
    const result = validate.jsonDocument(
      doc([
        {
          name: 'paragraph',
          props: {
            text: 'Label\t42',
            tabStops: [
              { type: 'right', position: 9000, leader: 'dot' },
              { type: 'center', position: 4500 },
            ],
          },
        },
      ])
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects an invalid tab stop type with a pointer path', () => {
    const result = validate.jsonDocument(
      doc([
        {
          name: 'paragraph',
          props: {
            text: 'Bad.',
            tabStops: [{ type: 'weird', position: 100 }],
          },
        },
      ])
    );
    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some((e) =>
        e.path.includes('/children/0/props/tabStops/0')
      )
    ).toBe(true);
  });

  it('rejects a tab stop missing its position', () => {
    const result = validate.jsonDocument(
      doc([
        {
          name: 'paragraph',
          props: { text: 'Bad.', tabStops: [{ type: 'left' }] },
        },
      ])
    );
    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some((e) =>
        e.path.includes('/children/0/props/tabStops/0')
      )
    ).toBe(true);
  });
});

describe('font.scale validation', () => {
  it('accepts font.scale within 1-600', () => {
    const result = validate.jsonDocument(
      doc([
        {
          name: 'paragraph',
          props: { text: 'Compressed.', font: { scale: 55 } },
        },
        {
          name: 'heading',
          props: { text: 'Expanded', level: 1, font: { scale: 115 } },
        },
      ])
    );
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects font.scale above 600 with a pointer path', () => {
    const result = validate.jsonDocument(
      doc([
        {
          name: 'paragraph',
          props: { text: 'Too wide.', font: { scale: 700 } },
        },
      ])
    );
    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some((e) =>
        e.path.includes('/children/0/props/font/scale')
      )
    ).toBe(true);
  });

  it('rejects font.scale of 0', () => {
    const result = validate.jsonDocument(
      doc([
        {
          name: 'paragraph',
          props: { text: 'Zero.', font: { scale: 0 } },
        },
      ])
    );
    expect(result.valid).toBe(false);
    expect(
      (result.errors ?? []).some((e) =>
        e.path.includes('/children/0/props/font/scale')
      )
    ).toBe(true);
  });
});
