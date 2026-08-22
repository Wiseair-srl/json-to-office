/**
 * The shapes a `list` has to accept.
 *
 * The corpus pins the bytes; what is left to say here is that every shape
 * compiles to one paragraph per item bound to one numbering definition, and
 * that the degenerate shapes — no items, no props at all — produce nothing
 * rather than throwing.
 */

import { describe, it, expect } from 'vitest';
import { compileDocumentToIr } from '../../core/generateFromIr';
import type { DocxIR } from '../../ir/types';
import type { ReportComponentDefinition } from '../../types';

async function compileList(props: Record<string, unknown>): Promise<DocxIR> {
  const compiled = await compileDocumentToIr({
    name: 'docx',
    props: {},
    children: [{ name: 'list', props }],
  } as unknown as ReportComponentDefinition);
  return compiled.ir;
}

const CASES: Array<[string, Record<string, unknown>, number]> = [
  ['bullets', { items: ['Item 1', 'Item 2', 'Item 3'] }, 3],
  ['numbers', { items: ['First', 'Second', 'Third'], format: 'numbered' }, 3],
  [
    'a custom bullet glyph',
    { items: ['Apple', 'Banana', 'Cherry'], bullet: '→' },
    3,
  ],
  [
    'its own spacing',
    {
      items: ['Spaced item 1', 'Spaced item 2'],
      spacing: { before: 240, after: 240 },
    },
    2,
  ],
  ['an indent as a number', { items: ['Indented item'], indent: 720 }, 1],
  [
    'an indent as an object',
    { items: ['Custom indented item'], indent: { left: 720, hanging: 360 } },
    1,
  ],
  [
    'an explicit start',
    { items: ['One', 'Two', 'Three'], format: 'numbered', start: 4 },
    3,
  ],
  ['a single item', { items: ['Only one'] }, 1],
  [
    'a long item',
    {
      items: [
        'A list item long enough to wrap several times over in any sensible measure, which is exactly the case that used to be worth checking.',
      ],
    },
    1,
  ],
  [
    'nested levels',
    {
      items: [
        'Parent item 1',
        { text: 'Nested item 1.1', level: 1 },
        { text: 'Nested item 1.2', level: 1 },
        'Parent item 2',
        { text: 'Nested item 2.1', level: 1 },
      ],
    },
    5,
  ],
];

describe('components/list', () => {
  it.each(CASES)(
    'compiles a list with %s',
    async (_name, props, expectedItems) => {
      const ir = await compileList(props);

      expect(ir.sections[0].children).toHaveLength(expectedItems);
      for (const block of ir.sections[0].children) {
        expect(block.kind).toBe('paragraph');
      }
    }
  );

  it.each(['left', 'center', 'right', 'justify'] as const)(
    'compiles a list aligned %s',
    async (alignment) => {
      const ir = await compileList({ items: ['Aligned item'], alignment });
      const [block] = ir.sections[0].children;

      expect(block.kind === 'paragraph' && block.formatting?.alignment).toBe(
        alignment === 'justify' ? 'justified' : alignment
      );
    }
  );

  it('binds every item to one numbering definition', async () => {
    const ir = await compileList({
      items: ['A', { text: 'A.1', level: 1 }, 'B'],
    });

    expect(ir.numbering).toHaveLength(1);
    const reference = ir.numbering[0].reference;
    const levels = ir.sections[0].children.map((block) =>
      block.kind === 'paragraph' && block.numbering && !block.numbering.none
        ? [block.numbering.reference, block.numbering.level]
        : undefined
    );

    expect(levels).toEqual([
      [reference, 0],
      [reference, 1],
      [reference, 0],
    ]);
  });

  it('defines a level for every depth the items reach', async () => {
    const ir = await compileList({
      items: ['A', { text: 'A.1', level: 1 }, { text: 'A.1.1', level: 2 }],
    });

    expect(ir.numbering[0].levels.map((level) => level.level)).toEqual([
      0, 1, 2,
    ]);
  });

  it('compiles nothing for a list with no items', async () => {
    const ir = await compileList({ items: [] });
    expect(ir.sections[0].children).toEqual([]);
  });

  it('compiles nothing for a list with no props at all', async () => {
    const ir = await compileList({});
    expect(ir.sections[0].children).toEqual([]);
  });
});
